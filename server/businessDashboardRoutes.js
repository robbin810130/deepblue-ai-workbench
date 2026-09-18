// ============================================================
// server/businessDashboardRoutes.js — AI 发布看板（Dify 发布能力）
//
// 功能（对应《业务平台「业务看板」发布能力开发说明》）：
// - business_dashboard 表：已发布的 AI 看板元数据
// - POST /api/business-dashboard/publish   Dify 发布 HTML 看板
//   · X-Internal-Token 内部令牌鉴权（DASHBOARD_PUBLISH_TOKEN）
//   · multipart/form-data 或 JSON 均可
//   · request_id 幂等：重复提交返回原记录
//   · tmp 写入 → DB 登记 → rename 正式目录，避免孤立文件
// - GET  /api/business-dashboard           已发布看板列表（关键词/领域/分页）
// - GET  /api/business-dashboard/:id       看板元数据详情
//
// 静态访问：/dashboard-files/{dashboard_id}/index.html
// （由 server.js 在鉴权中间件之前挂载 express.static 托管）
// ============================================================
import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import pool from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

// ─── 存储目录 ─────────────────────────────────────────────────
// 环境变量 DASHBOARD_STORAGE_DIR 可覆盖；默认 server/storage/business-dashboards
export const businessDashboardStorageDir = process.env.DASHBOARD_STORAGE_DIR
    ? path.resolve(process.env.DASHBOARD_STORAGE_DIR)
    : path.join(__dirname, 'storage', 'business-dashboards');

// multipart 文本字段解析（html_content 为字符串字段，不收文件上传）
const parseMultipart = multer({ storage: multer.memoryStorage() }).none();

// ─── 自动 DDL（幂等） ─────────────────────────────────────────
export async function ensureBusinessDashboardTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS business_dashboard (
            id BIGSERIAL PRIMARY KEY,
            dashboard_id VARCHAR(64) NOT NULL UNIQUE,
            title VARCHAR(255) NOT NULL,
            domain VARCHAR(50) DEFAULT 'other',
            description VARCHAR(1000) DEFAULT '',
            html_path VARCHAR(500) NOT NULL,
            view_url VARCHAR(1000) NOT NULL,
            source VARCHAR(50) NOT NULL DEFAULT 'dify',
            request_id VARCHAR(64),
            status VARCHAR(20) NOT NULL DEFAULT 'published',
            allowed_roles JSONB NOT NULL DEFAULT '[]', -- 可见角色名数组，['*'] 表示所有人可见
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);
    // 已有部署的表补列（幂等迁移）
    await pool.query(`ALTER TABLE business_dashboard ADD COLUMN IF NOT EXISTS allowed_roles JSONB NOT NULL DEFAULT '[]';`);
    // request_id 幂等唯一约束（仅对已发布记录生效）
    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_business_dashboard_request_id
        ON business_dashboard (request_id)
        WHERE request_id IS NOT NULL AND status = 'published';
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_business_dashboard_published ON business_dashboard (published_at DESC);`);
}

// ─── 工具函数 ─────────────────────────────────────────────────
const DOMAIN_WHITELIST = ['finance', 'warehouse', 'sales', 'procurement', 'production', 'other'];

// 解析并校验 allowed_roles：接受 JSON 数组（application/json）或 JSON 字符串（multipart 字段）
// 默认 ['*']（所有人可见）；非法格式/空数组一律拒绝，避免「配错=全锁死」或「配错=裸奔」二义性
const parseAllowedRoles = (raw) => {
    if (raw === undefined || raw === null || raw === '') return { ok: true, roles: ['*'] }; // 未传 = 所有人
    let arr = raw;
    if (typeof raw === 'string') {
        try { arr = JSON.parse(raw); } catch { return { ok: false, reason: 'allowed_roles 必须是合法的 JSON 角色数组，例如 ["*"] 或 ["finance","admin"]' }; }
    }
    if (!Array.isArray(arr)) return { ok: false, reason: 'allowed_roles 必须是数组' };
    const roles = arr.map(r => String(r).trim()).filter(Boolean);
    if (roles.length === 0) return { ok: false, reason: 'allowed_roles 不能为空数组（传 ["*"] 表示所有人可见）' };
    if (roles.length > 20) return { ok: false, reason: 'allowed_roles 最多 20 个角色' };
    if (roles.some(r => r.length > 50)) return { ok: false, reason: 'allowed_roles 单个角色名不能超过 50 字符' };
    return { ok: true, roles: [...new Set(roles)] }; // 去重
};

const fail = (res, httpStatus, error, message) =>
    res.status(httpStatus).json({ success: false, error, message });

// 最低 HTML 校验（文档 §9）：不修复、只接受或拒绝
const isValidHtml = (html) =>
    typeof html === 'string'
        && html.trim().length > 0
        && html.includes('<html')
        && html.includes('<body')
        && html.includes('</html>');

// 生成 d_<短码>，碰撞时重试（文档 §6）
const genDashboardId = async () => {
    for (let i = 0; i < 5; i++) {
        const id = 'd_' + crypto.randomBytes(6).toString('hex'); // 12 位短码
        const dup = await pool.query('SELECT 1 FROM business_dashboard WHERE dashboard_id = $1', [id]);
        if (dup.rowCount === 0) return id;
    }
    throw new Error('dashboard_id 生成失败（连续碰撞）');
};

// 结构化发布日志（文档 §20：禁止记录完整 HTML）
const logPublish = (fields) => {
    const { request_id, dashboard_id, title, domain, source, allowed_roles, html_length, cost_ms, result, err } = fields;
    console.log('[BusinessDashboard Publish]',
        JSON.stringify({ time: new Date().toISOString(), request_id, dashboard_id, title, domain, source, allowed_roles, html_length, cost_ms, result, error: err || undefined }));
};

// ─── 发布 API ─────────────────────────────────────────────────
// POST /api/business-dashboard/publish
router.post('/publish', parseMultipart, async (req, res) => {
    console.log('[DEBUG PUBLISH]', req.body ? Object.keys(req.body) : 'NO BODY');

    const startedAt = Date.now();
    try {
        // 0) 内部令牌鉴权（文档 §22）：未配置则拒绝，安全默认
        const expectedToken = process.env.DASHBOARD_PUBLISH_TOKEN;
        if (!expectedToken) {
            logPublish({ request_id: null, dashboard_id: null, title: null, domain: null, source: null, html_length: 0, cost_ms: 0, result: 'REJECTED', err: 'PUBLISH_TOKEN_NOT_CONFIGURED' });
            return fail(res, 500, 'PUBLISH_TOKEN_NOT_CONFIGURED', '服务端未配置 DASHBOARD_PUBLISH_TOKEN，发布功能不可用');
        }
        const token = req.get('X-Internal-Token');
        if (!token || token !== expectedToken) {
            return fail(res, 401, 'UNAUTHORIZED', '内部令牌缺失或不正确');
        }

        // 1) 字段校验（文档 §8/§9）
        const title = (req.body?.title || '').trim();
        const domain = (req.body?.domain || 'other').trim() || 'other';
        const source = (req.body?.source || 'dify').trim() || 'dify';
        const description = (req.body?.description || '').trim();
        const request_id = (req.body?.request_id || '').trim();
        const htmlContent = req.body?.html_content;

        if (!title) return fail(res, 400, 'INVALID_REQUEST', 'title 不能为空');
        if (title.length > 255) return fail(res, 400, 'INVALID_REQUEST', 'title 超过 255 字符');
        if (!DOMAIN_WHITELIST.includes(domain)) return fail(res, 400, 'INVALID_REQUEST', `domain 必须是 ${DOMAIN_WHITELIST.join(' / ')} 之一`);
        if (!isValidHtml(htmlContent)) return fail(res, 400, 'INVALID_HTML', 'html_content 无效：必须包含 <html>、<body> 与 </html> 的完整 HTML');
        if (request_id && request_id.length > 64) return fail(res, 400, 'INVALID_REQUEST', 'request_id 超过 64 字符');

        // 1b) 角色可见性（默认 ['*'] 所有人可见）
        const rolesResult = parseAllowedRoles(req.body?.allowed_roles);
        if (!rolesResult.ok) return fail(res, 400, 'INVALID_REQUEST', rolesResult.reason);
        const allowedRoles = rolesResult.roles;

        // 2) request_id 幂等：已成功发布过则直接返回原记录（文档 §19）
        if (request_id) {
            const existing = await pool.query(
                `SELECT dashboard_id, title, domain, view_url, published_at
                 FROM business_dashboard
                 WHERE request_id = $1 AND status = 'published'`,
                [request_id]
            );
            if (existing.rowCount > 0) {
                const row = existing.rows[0];
                logPublish({ request_id, dashboard_id: row.dashboard_id, title: row.title, domain: row.domain, source, html_length: htmlContent.length, cost_ms: Date.now() - startedAt, result: 'DUPLICATE_RETURNED' });
                return res.json({
                    success: true,
                    dashboard_id: row.dashboard_id,
                    title: row.title,
                    domain: row.domain,
                    view_url: row.view_url,
                    published_at: row.published_at,
                    duplicated: true,
                });
            }
        }

        // 3) 生成 ID 与目录（客户端不可传 html_path，文档 §21）
        const dashboardId = await genDashboardId();
        const finalDir = path.join(businessDashboardStorageDir, dashboardId); // dashboard_id 服务端生成，无路径穿越风险
        const tmpFile = path.join(businessDashboardStorageDir, `.tmp-${dashboardId}-${Date.now()}`);
        const finalFile = path.join(finalDir, 'index.html'); // 文件名固定（文档 §7/§21）

        try {
            // 4) 数据一致性（文档 §29）：tmp 写 HTML → DB 写入 → rename 正式目录
            fs.mkdirSync(businessDashboardStorageDir, { recursive: true });
            fs.writeFileSync(tmpFile, htmlContent, 'utf8'); // 强制 UTF-8（文档 §21）

            const baseUrl = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
            const htmlPath = `/dashboard-files/${dashboardId}/index.html`;
            const viewUrl = baseUrl ? `${baseUrl}${htmlPath}` : htmlPath; // 未配置 APP_BASE_URL 时返回相对路径

            const inserted = await pool.query(
                `INSERT INTO business_dashboard
                    (dashboard_id, title, domain, description, html_path, view_url, source, request_id, status, allowed_roles)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published', $9::jsonb)
                 RETURNING dashboard_id, title, domain, view_url, published_at`,
                [dashboardId, title, domain, description, htmlPath, viewUrl, source, request_id || null, JSON.stringify(allowedRoles)]
            );
            const row = inserted.rows[0];

            fs.mkdirSync(finalDir, { recursive: true });
            fs.renameSync(tmpFile, finalFile);

            logPublish({ request_id: request_id || null, dashboard_id: row.dashboard_id, title, domain, source, allowed_roles: allowedRoles, html_length: htmlContent.length, cost_ms: Date.now() - startedAt, result: 'SUCCESS' });
            return res.status(200).json({
                success: true,
                dashboard_id: row.dashboard_id,
                title: row.title,
                domain: row.domain,
                view_url: row.view_url,
                published_at: row.published_at,
            });
        } catch (err) {
            // 失败清理：删临时文件；若 DB 已写入则回滚删除（文档 §29）
            try { fs.rmSync(finalDir, { recursive: true, force: true }); } catch { /* ignore */ }
            try { fs.rmSync(tmpFile, { force: true }); } catch { /* ignore */ }
            try { await pool.query('DELETE FROM business_dashboard WHERE dashboard_id = $1', [dashboardId]); } catch { /* ignore */ }
            logPublish({ request_id: request_id || null, dashboard_id: dashboardId, title, domain, source, html_length: htmlContent?.length || 0, cost_ms: Date.now() - startedAt, result: 'FAILED', err: err.message });
            return fail(res, 500, 'SAVE_FAILED', 'Dashboard 保存失败');
        }
    } catch (err) {
        logPublish({ request_id: null, dashboard_id: null, title: null, domain: null, source: null, html_length: 0, cost_ms: Date.now() - startedAt, result: 'FAILED', err: err.message });
        return fail(res, 500, 'INTERNAL_ERROR', '服务内部错误');
    }
});

// ─── Dify Chatflow 人工介入代理 ────────────────────────────────
// 这两个固定路径必须在 /:dashboardId 详情路由之前注册。否则 messages
// 会被当作 dashboard_id，导致第二个人工介入节点的表单无法被前端读取。
const getDifyConfig = () => ({
    apiKey: process.env.DIFY_BUSINESS_DASHBOARD_API_KEY || process.env.DIFY_WORKFLOW_API_KEY,
    baseUrl: (process.env.DIFY_BUSINESS_DASHBOARD_BASE_URL || process.env.DIFY_API_BASE_URL || 'http://39.108.221.22/v1').replace(/\/$/, ''),
});

// GET /api/business-dashboard/messages?conversation_id=...
// 提交一个人工介入表单后，前端通过此接口读取下一个 PENDING 表单。
router.get('/messages', async (req, res) => {
    try {
        const { apiKey, baseUrl } = getDifyConfig();
        const conversationId = String(req.query.conversation_id || '').trim();
        if (!apiKey) return res.status(503).json({ error: 'DIFY_API_KEY_MISSING' });
        if (!conversationId) return res.status(400).json({ error: 'conversation_id is required' });

        const user = req.user?.username || 'web_client_user';
        const upstream = await fetch(
            `${baseUrl}/messages?user=${encodeURIComponent(user)}&conversation_id=${encodeURIComponent(conversationId)}&limit=10`,
            { headers: { Authorization: `Bearer ${apiKey}` } }
        );
        const data = await upstream.json().catch(() => ({}));
        return res.status(upstream.status).json(data);
    } catch (error) {
        console.error('[BusinessDashboard] 获取 Dify 消息失败:', error);
        return res.status(500).json({ error: '获取消息异常', details: error.message });
    }
});

// POST /api/business-dashboard/chat-submit
// 将当前人工介入节点的选择提交给 Dify，随后由 /messages 取得下一节点。
router.post('/chat-submit', async (req, res) => {
    try {
        const { apiKey, baseUrl } = getDifyConfig();
        const formToken = String(req.body?.form_token || '').trim();
        if (!apiKey) return res.status(503).json({ error: 'DIFY_API_KEY_MISSING' });
        if (!formToken) return res.status(400).json({ error: 'form_token is required' });

        const upstream = await fetch(`${baseUrl}/form/human_input/${encodeURIComponent(formToken)}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: req.body?.action,
                inputs: req.body?.inputs || {},
                user: req.user?.username || 'web_client_user',
            }),
        });
        const data = await upstream.json().catch(() => ({}));
        return res.status(upstream.status).json(data);
    } catch (error) {
        console.error('[BusinessDashboard] 提交 Dify 人工介入失败:', error);
        return res.status(500).json({ error: '人工介入提交异常', details: error.message });
    }
});

// ─── 列表 API ─────────────────────────────────────────────────
// GET /api/business-dashboard?keyword=&domain=&page=1&page_size=20
router.get('/', async (req, res) => {
    try {
        const keyword = (req.query.keyword || '').toString().trim();
        const domain = (req.query.domain || '').toString().trim();
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(req.query.page_size, 10) || 20));

        const statusQuery = req.query.status === 'archived' ? 'archived' : 'published';
        const conditions = [`status = '${statusQuery}'`];
        const params = [];
        if (keyword) {
            params.push(`%${keyword}%`);
            conditions.push(`(title ILIKE $${params.length} OR description ILIKE $${params.length})`);
        }
        if (domain) {
            params.push(domain);
            conditions.push(`domain = $${params.length}`);
        }
        // 角色可见性过滤：admin 全量；普通用户仅见 ['*'] 或包含自身角色的看板
        const role = req.user?.role || '';
        if (role !== 'admin') {
            params.push(JSON.stringify([role]));
            conditions.push(`(allowed_roles @> '"*"'::jsonb OR allowed_roles @> $${params.length}::jsonb)`);
        }
        const where = conditions.join(' AND ');

        const total = (await pool.query(`SELECT COUNT(*)::int AS cnt FROM business_dashboard WHERE ${where}`, params)).rows[0].cnt;
        params.push(pageSize, (page - 1) * pageSize);
        const rows = (await pool.query(
            `SELECT dashboard_id, title, domain, description, view_url, source, allowed_roles, published_at
             FROM business_dashboard
             WHERE ${where}
             ORDER BY published_at DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        )).rows;

        return res.json({ success: true, data: { items: rows, total, page, page_size: pageSize } });
    } catch (err) {
        return fail(res, 500, 'INTERNAL_ERROR', '获取看板列表失败');
    }
});

// ─── 详情元数据 API ───────────────────────────────────────────
// GET /api/business-dashboard/:dashboard_id
router.get('/:dashboardId', async (req, res, next) => {
    try {
        const dashboardId = (req.params.dashboardId || '').toString();
        if (!/^d_[a-z0-9]+$/.test(dashboardId)) {
            return next(); // 让 /messages 等其他非 ID 路由继续匹配
        }
        const rows = await pool.query(
            `SELECT dashboard_id, title, domain, description, html_path, view_url, source, allowed_roles, published_at
             FROM business_dashboard
             WHERE dashboard_id = $1 AND status = 'published'`,
            [dashboardId]
        );
        if (rows.rowCount === 0) {
            return fail(res, 404, 'NOT_FOUND', '看板不存在或已删除');
        }
        // 角色可见性：admin 全量；普通用户需匹配 ['*'] 或自身角色（404 不暴露存在性）
        const detailRole = req.user?.role || '';
        if (detailRole !== 'admin') {
            const allowed = rows.rows[0].allowed_roles || [];
            if (!allowed.includes('*') && !allowed.includes(detailRole)) {
                return fail(res, 404, 'NOT_FOUND', '看板不存在或已删除');
            }
        }
        return res.json({ success: true, data: rows.rows[0] });
    } catch (err) {
        return fail(res, 500, 'INTERNAL_ERROR', '获取看板详情失败');
    }
});




// PUT /api/business-dashboard/status
router.put('/status', async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ success: false, message: '只有管理员可以操作看板状态' });
        }
        const { dashboard_ids, status } = req.body;
        if (!Array.isArray(dashboard_ids) || dashboard_ids.length === 0) {
            return res.status(400).json({ success: false, message: '未提供任何看板ID' });
        }
        const targetStatus = status === 'archived' ? 'archived' : 'published';

        const result = await pool.query(
            `UPDATE business_dashboard SET status = $1 WHERE dashboard_id = ANY($2) RETURNING dashboard_id`,
            [targetStatus, dashboard_ids]
        );
        return res.json({ success: true, message: `成功更新 ${result.rowCount} 个看板状态`, count: result.rowCount });
    } catch (err) {
        console.error('Update status error:', err);
        return res.status(500).json({ success: false, message: '更新看板状态失败' });
    }
});

// PUT /api/business-dashboard/:dashboardId/roles
// 管理员调整已发布看板的可视角色；角色名称必须来自 sys_roles，避免保存无效权限。
router.put('/:dashboardId/roles', async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ success: false, message: '只有管理员可以调整看板可视权限' });
        }

        const dashboardId = String(req.params.dashboardId || '').trim();
        if (!/^d_[a-z0-9]+$/.test(dashboardId)) {
            return res.status(400).json({ success: false, message: '无效的看板 ID' });
        }

        const rolesResult = parseAllowedRoles(req.body?.allowed_roles);
        if (!rolesResult.ok) return res.status(400).json({ success: false, message: rolesResult.reason });
        const allowedRoles = rolesResult.roles;

        // ['*'] 表示全部角色；其他值必须是当前系统已存在的角色标识。
        const namedRoles = allowedRoles.filter(role => role !== '*');
        if (namedRoles.length > 0) {
            const knownRoles = await pool.query('SELECT name FROM sys_roles WHERE name = ANY($1::text[])', [namedRoles]);
            const knownRoleNames = new Set(knownRoles.rows.map(row => row.name));
            const unknownRoles = namedRoles.filter(role => !knownRoleNames.has(role));
            if (unknownRoles.length > 0) {
                return res.status(400).json({ success: false, message: `角色不存在：${unknownRoles.join('、')}` });
            }
        }

        const updated = await pool.query(
            `UPDATE business_dashboard
             SET allowed_roles = $1::jsonb, updated_at = NOW()
             WHERE dashboard_id = $2
             RETURNING dashboard_id, allowed_roles`,
            [JSON.stringify(allowedRoles), dashboardId]
        );
        if (updated.rowCount === 0) {
            return res.status(404).json({ success: false, message: '看板不存在或已删除' });
        }

        console.log('[BusinessDashboard Permissions]', JSON.stringify({
            dashboard_id: dashboardId,
            allowed_roles: allowedRoles,
            updated_by: req.user?.username || '',
        }));
        return res.json({ success: true, message: '可视角色已更新', data: updated.rows[0] });
    } catch (err) {
        console.error('Update business dashboard roles error:', err);
        return res.status(500).json({ success: false, message: '更新看板可视权限失败' });
    }
});

// DELETE /api/business-dashboard/:id
router.delete('/:id', async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'ֻ�й���Ա����ɾ������' });
        }
        const dashboardId = req.params.id;
        const result = await pool.query('DELETE FROM business_dashboard WHERE dashboard_id = $1 RETURNING dashboard_id', [dashboardId]);
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: '���岻����' });
        }
        // ����ɾ�������ļ�
        try {
            const fsPath = require('path').join(businessDashboardStorageDir, dashboardId);
            require('fs').rmSync(fsPath, { recursive: true, force: true });
        } catch(e) {
            // ignore file delete error
        }
        return res.json({ success: true, message: 'ɾ���ɹ�' });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'ɾ��ʧ��' });
    }
});

export default router;

