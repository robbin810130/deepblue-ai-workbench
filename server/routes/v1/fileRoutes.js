/**
 * /api/v1/files —— 文件暂存与签名下载（M4，PRD §7/§9）
 *
 *   POST /api/v1/files/upload                    multipart 上传 → 暂存（需登录）
 *   GET  /api/v1/files/:kind/:id                 元信息（需登录 + 权限）
 *   GET  /api/v1/files/:kind/:id/download-url    签发短时下载 URL（需登录 + 权限）
 *   GET  /api/v1/files/download                  签名下载（**无 JWT**，签名即凭证）
 */

import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import * as store from '../../modules/tasks/taskStore.js';
import * as fileStore from '../../modules/files/fileStore.js';
import { sendOk, sendFail, asyncHandler } from '../../modules/common/apiResponse.js';
import { AppError } from '../../modules/common/errors.js';

const router = express.Router();

fileStore.ensureFilesTables().catch((err) => console.error('[Files DDL] 暂存文件表初始化失败:', err.message));

router.use((req, _res, next) => {
    if (!req.trace_id) req.trace_id = `t-file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    next();
});

// multer 落系统临时目录（saveStagedFile 会同盘 rename 进正式存储）
const uploadTmp = multer({
    dest: path.join(fileStore.TASK_STORAGE_DIR, 'tmp'),
    limits: { fileSize: 400 * 1024 * 1024 }, // 与平台 upload 中间件同上限
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(res, err, traceId) {
    if (err instanceof AppError) return sendFail(res, err, { trace_id: traceId });
    const code = err?.code === 'RESOURCE_NOT_FOUND' ? 'RESOURCE_NOT_FOUND'
        : err?.code === 'FORBIDDEN' ? 'FORBIDDEN'
        : 'VALIDATION_FAILED';
    return sendFail(res, new AppError(code, err.message), { trace_id: traceId });
}

/** 权限：staged → 上传人/admin；artifact → 任务归属（复用 service.canAccess 的口径） */
async function assertCanAccessFile(kind, id, user) {
    if (kind === 'staged') {
        const rec = await fileStore.getStagedFile(id);
        if (!rec) throw new AppError('RESOURCE_NOT_FOUND', '文件不存在');
        if (user.role !== 'admin' && rec.uploaded_by !== user.id) {
            // 已绑定任务的暂存文件，按任务归属放行
            if (rec.task_id) {
                const task = await store.getTaskById(rec.task_id);
                if (task && (task.created_by === user.id || task.assigned_to === user.id)) return rec;
            }
            throw new AppError('FORBIDDEN', '无权访问该文件');
        }
        return rec;
    }
    if (kind === 'artifact') {
        const rec = await fileStore.getArtifact(id);
        if (!rec) throw new AppError('RESOURCE_NOT_FOUND', '产物不存在');
        const task = await store.getTaskById(rec.task_id);
        if (!task) throw new AppError('RESOURCE_NOT_FOUND', '产物不存在');
        if (user.role !== 'admin' && task.created_by !== user.id && task.assigned_to !== user.id) {
            throw new AppError('FORBIDDEN', '无权访问该产物');
        }
        return rec;
    }
    throw new AppError('RESOURCE_NOT_FOUND', '未知的文件类别');
}

// ── 上传 ─────────────────────────────────────────────────────

router.post(
    '/files/upload',
    uploadTmp.single('file'),
    asyncHandler(async (req, res) => {
        if (!req.file) {
            return fail(res, new AppError('VALIDATION_FAILED', '缺少文件字段 file'), req.trace_id);
        }
        try {
            const rec = await fileStore.saveStagedFile({
                tmpPath: req.file.path,
                originalName: Buffer.from(req.file.originalname, 'latin1').toString('utf8'), // multer 对中文文件名的 latin1 误读修正
                mimeType: req.file.mimetype,
                uploadedBy: req.user.id,
            });
            return sendOk(res, {
                file_id: rec.id,
                name: rec.original_name,
                mime_type: rec.mime_type,
                size_bytes: rec.size_bytes,
            }, { trace_id: req.trace_id });
        } catch (e) {
            return fail(res, e, req.trace_id);
        }
    }),
);

// ── 元信息 / 签发下载 URL ────────────────────────────────────

router.get(
    '/files/:kind/:id',
    asyncHandler(async (req, res) => {
        const { kind, id } = req.params;
        if (!UUID_RE.test(String(id))) return fail(res, new AppError('RESOURCE_NOT_FOUND', '文件不存在'), req.trace_id);
        try {
            const rec = await assertCanAccessFile(kind, id, req.user);
            return sendOk(res, {
                kind,
                id: rec.id,
                name: rec.original_name || rec.name,
                mime_type: rec.mime_type,
                size_bytes: rec.size_bytes,
                created_at: rec.created_at,
            }, { trace_id: req.trace_id });
        } catch (e) {
            return fail(res, e, req.trace_id);
        }
    }),
);

router.get(
    '/files/:kind/:id/download-url',
    asyncHandler(async (req, res) => {
        const { kind, id } = req.params;
        if (!UUID_RE.test(String(id))) return fail(res, new AppError('RESOURCE_NOT_FOUND', '文件不存在'), req.trace_id);
        try {
            await assertCanAccessFile(kind, id, req.user); // 权限校验在前，签名在后（PRD §9）
            const signed = fileStore.signDownload(kind, id);
            return sendOk(res, signed, { trace_id: req.trace_id });
        } catch (e) {
            return fail(res, e, req.trace_id);
        }
    }),
);

// ── 签名下载（无 JWT；签名 + 有效期即凭证）──────────────────

router.get(
    '/files/download',
    asyncHandler(async (req, res) => {
        const { kind, id, exp, sig } = req.query;
        if (!fileStore.verifyDownload({ kind, id, exp, sig })) {
            return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: '下载链接无效或已过期' } });
        }
        try {
            const rec = kind === 'staged'
                ? await fileStore.getStagedFile(id)
                : await fileStore.getArtifact(id);
            if (!rec || !rec.stored_path || !fs.existsSync(rec.stored_path)) {
                return res.status(404).json({ success: false, error: { code: 'RESOURCE_NOT_FOUND', message: '文件不存在或已被清理' } });
            }
            res.setHeader('Content-Type', rec.mime_type || 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(rec.original_name || rec.name || 'file')}`);
            fs.createReadStream(rec.stored_path).pipe(res);
        } catch (e) {
            return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: '文件读取失败' } });
        }
    }),
);

export default router;
