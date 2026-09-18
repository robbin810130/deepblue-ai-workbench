/**
 * 文件暂存层 —— PRD §7/§9 的落地面
 *
 * 职责：
 *   1. 上传暂存：POST /files/upload 的文件落平台磁盘（先存平台，再按需传 Provider，文档 04 §7）
 *   2. 产物登记：Provider 产出的报告/图片落 task_artifacts（M3 已建表）
 *   3. 签名下载：下载地址必须经权限校验后签发短时签名 URL（PRD §9）
 *
 * 签名方案：HMAC-SHA256(kind|id|exp) → hex。校验失败/过期一律 403，
 * 下载端点**不查 JWT** —— 签名即凭证（与平台 DSH 票据、business-dashboard 内部令牌同思路）。
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 存储根目录（环境变量可覆盖；默认 server/storage/tasks） */
export const TASK_STORAGE_DIR = process.env.TASK_STORAGE_DIR
    ? path.resolve(process.env.TASK_STORAGE_DIR)
    : path.join(__dirname, '..', 'storage', 'tasks');

const STAGED_DIR = path.join(TASK_STORAGE_DIR, 'staged');
const ARTIFACT_DIR = path.join(TASK_STORAGE_DIR, 'artifacts');

/** 签名密钥：优先专用变量，回退 JWT 密钥 */
const SIGNING_SECRET = process.env.TASK_FILE_SIGNING_SECRET || process.env.JWT_SECRET || 'blue-os-super-secret-key';

/** 默认下载有效期：10 分钟（PRD §9「短时」） */
export const DEFAULT_DOWNLOAD_TTL_MS = 10 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
// 表
// ─────────────────────────────────────────────────────────────

export async function ensureFilesTables() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS task_staged_files (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id       UUID,
            original_name VARCHAR(255) NOT NULL,
            stored_path   TEXT NOT NULL,
            mime_type     VARCHAR(120),
            size_bytes    BIGINT,
            uploaded_by   INTEGER,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_staged_files_task ON task_staged_files (task_id);
    `);
}

// ─────────────────────────────────────────────────────────────
// 暂存
// ─────────────────────────────────────────────────────────────

/** 清洗文件名：去路径分隔与控制字符，防目录穿越 */
function sanitizeName(name) {
    const base = path.basename(String(name || 'file'));
    return base.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(0, 200) || 'file';
}

/**
 * 保存暂存文件（multer 已落 tmp，这里移入正式目录）
 * @param {object} p
 * @param {string} p.tmpPath multer 落盘的临时路径
 * @param {string} p.originalName
 * @param {string} [p.mimeType]
 * @param {number} [p.uploadedBy]
 * @param {string} [p.taskId] 可选，事后可绑定
 */
export async function saveStagedFile({ tmpPath, originalName, mimeType, uploadedBy, taskId = null }) {
    const { rows } = await pool.query(
        `INSERT INTO task_staged_files (task_id, original_name, stored_path, mime_type, size_bytes, uploaded_by)
         VALUES ($1,$2,'',$3,0,$4) RETURNING id`,
        [taskId, sanitizeName(originalName), mimeType || null, uploadedBy ?? null],
    );
    const id = rows[0].id;
    const dir = path.join(STAGED_DIR, id);
    fs.mkdirSync(dir, { recursive: true });
    const storedPath = path.join(dir, sanitizeName(originalName));
    fs.renameSync(tmpPath, storedPath); // 同盘 rename，原子
    const size = fs.statSync(storedPath).size;
    await pool.query('UPDATE task_staged_files SET stored_path = $2, size_bytes = $3 WHERE id = $1', [id, storedPath, size]);
    return getStagedFile(id);
}

export async function getStagedFile(id) {
    const { rows } = await pool.query('SELECT * FROM task_staged_files WHERE id = $1', [id]);
    return rows[0] || null;
}

/** 按文件 ID 列表读取内容（任务执行时喂给 Provider） */
export async function loadStagedBuffers(fileIds) {
    const out = [];
    for (const raw of fileIds || []) {
        const id = typeof raw === 'string' ? raw : raw?.file_id;
        if (!id) continue;
        const rec = await getStagedFile(id);
        if (!rec || !fs.existsSync(rec.stored_path)) {
            const err = new Error(`暂存文件不存在或已被清理：${rec?.original_name || id}`);
            err.code = 'VALIDATION_FAILED';
            err.http_status = 422;
            throw err;
        }
        out.push({
            file_id: rec.id,
            name: rec.original_name,
            mimeType: rec.mime_type || 'application/octet-stream',
            buffer: fs.readFileSync(rec.stored_path),
        });
    }
    return out;
}

/** 任务 ↔ 暂存文件绑定（创建任务时回填 task_id，便于追溯与权限） */
export async function bindFilesToTask(fileIds, taskId) {
    const ids = (fileIds || []).map((f) => (typeof f === 'string' ? f : f?.file_id)).filter(Boolean);
    if (!ids.length) return;
    await pool.query('UPDATE task_staged_files SET task_id = $2 WHERE id = ANY($1::uuid[])', [ids, taskId]);
}

// ─────────────────────────────────────────────────────────────
// 产物落盘（Provider 返回文件类产物时由调用方登记）
// ─────────────────────────────────────────────────────────────

export async function saveArtifact({ taskId, runId = null, name, buffer, mimeType }) {
    const { rows } = await pool.query(
        `INSERT INTO task_artifacts (task_id, run_id, kind, name, mime_type, size_bytes, storage_path)
         VALUES ($1,$2,'file',$3,$4,$5,'') RETURNING id`,
        [taskId, runId, sanitizeName(name), mimeType || null, buffer.length],
    );
    const id = rows[0].id;
    const dir = path.join(ARTIFACT_DIR, taskId, id);
    fs.mkdirSync(dir, { recursive: true });
    const storedPath = path.join(dir, sanitizeName(name));
    fs.writeFileSync(storedPath, buffer);
    await pool.query('UPDATE task_artifacts SET storage_path = $2 WHERE id = $1', [id, storedPath]);
    return id;
}

export async function getArtifact(id) {
    const { rows } = await pool.query('SELECT * FROM task_artifacts WHERE id = $1', [id]);
    return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────
// 签名 URL（PRD §9：权限校验后签发，短时有效）
// ─────────────────────────────────────────────────────────────

/**
 * 为已通过权限校验的文件签发下载 URL。
 * @param {'staged'|'artifact'} kind
 * @param {string} id
 * @param {number} [ttlMs]
 */
export function signDownload(kind, id, ttlMs = DEFAULT_DOWNLOAD_TTL_MS) {
    const exp = Date.now() + ttlMs;
    const sig = hmacFor(kind, id, exp);
    const qs = new URLSearchParams({ kind, id, exp: String(exp), sig });
    return { url: `/api/v1/files/download?${qs.toString()}`, expires_in_seconds: Math.round(ttlMs / 1000) };
}

function hmacFor(kind, id, exp) {
    return crypto.createHmac('sha256', SIGNING_SECRET).update(`${kind}|${id}|${exp}`).digest('hex');
}

/** 校验签名与有效期；合法返回 true */
export function verifyDownload({ kind, id, exp, sig }) {
    if (!kind || !id || !exp || !sig) return false;
    if (kind !== 'staged' && kind !== 'artifact') return false;
    const expNum = Number(exp);
    if (!Number.isFinite(expNum) || expNum < Date.now()) return false;
    const expected = hmacFor(kind, id, expNum);
    const a = Buffer.from(String(sig));
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
