// ============================================================
// server/dashboardRoutes.js — 业务看板聚合中心路由
//
// 功能：
// - sys_dashboards 表：管理员配置的外部看板（URL + 角色授权）
// - GET  /api/dashboards          当前用户可见的看板列表（按角色过滤）
// - CRUD /api/dashboards/admin/*  管理员维护看板（含角色授权）
// ============================================================
import express from 'express';
import pool from './db.js';

const router = express.Router();

// ─── 自动 DDL（幂等） ─────────────────────────────────────────
export async function ensureDashboardTables() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sys_dashboards (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,                 -- 看板名称
            url TEXT NOT NULL,                          -- 外部看板 URL（iframe 嵌入）
            description VARCHAR(500) DEFAULT '',        -- 看板说明
            category VARCHAR(50) DEFAULT '通用',        -- 看板分组
            allowed_roles JSONB NOT NULL DEFAULT '[]',  -- 可见角色名数组，['*'] 表示所有人可见
            sort_order INTEGER NOT NULL DEFAULT 0,      -- 排序（小的在前）
            created_by VARCHAR(50) DEFAULT '',          -- 创建人
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sys_dashboards_sort ON sys_dashboards(sort_order);`);
}

// ─── 鉴权辅助 ─────────────────────────────────────────────────
const requireLogin = (req, res, next) => {
    if (!req.user?.username) {
        return res.status(401).json({ success: false, message: '未登录或会话已过期' });
    }
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.user?.username) {
        return res.status(401).json({ success: false, message: '未登录或会话已过期' });
    }
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: '权限不足：需要管理员权限' });
    }
    next();
};

const getAudit = (req) => req.app.get('logAudit') || (() => {});

// ─── 用户端：当前用户可见的看板列表 ───────────────────────────
// GET /api/dashboards
router.get('/', requireLogin, async (req, res) => {
    try {
        const role = req.user.role || '';
        let rows;
        if (role === 'admin') {
            // 管理员看全部
            rows = (await pool.query('SELECT * FROM sys_dashboards ORDER BY sort_order ASC, id ASC')).rows;
        } else {
            // 普通用户：allowed_roles 含 '*' 或包含自身角色名
            rows = (await pool.query(
                `SELECT * FROM sys_dashboards
                 WHERE allowed_roles @> '"*"'::jsonb
                    OR allowed_roles @> $1::jsonb
                 ORDER BY sort_order ASC, id ASC`,
                [JSON.stringify([role])]
            )).rows;
        }
        return res.json({ success: true, data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: '获取看板列表失败: ' + err.message });
    }
});

// ─── 管理端：看板 CRUD ────────────────────────────────────────
// GET /api/dashboards/admin — 全量列表（含角色授权信息）
router.get('/admin', requireAdmin, async (req, res) => {
    try {
        const rows = (await pool.query('SELECT * FROM sys_dashboards ORDER BY sort_order ASC, id ASC')).rows;
        return res.json({ success: true, data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: '获取看板列表失败: ' + err.message });
    }
});

// POST /api/dashboards/admin — 新建看板
router.post('/admin', requireAdmin, async (req, res) => {
    try {
        const { name, url, description = '', category = '通用', allowed_roles = ['*'], sort_order = 0 } = req.body || {};
        if (!name?.trim() || !url?.trim()) {
            return res.status(400).json({ success: false, message: '看板名称和 URL 不能为空' });
        }
        if (!/^https?:\/\//i.test(url.trim())) {
            return res.status(400).json({ success: false, message: 'URL 必须以 http:// 或 https:// 开头' });
        }
        if (!Array.isArray(allowed_roles) || allowed_roles.length === 0) {
            return res.status(400).json({ success: false, message: '至少选择一个可见角色' });
        }
        const result = await pool.query(
            `INSERT INTO sys_dashboards (name, url, description, category, allowed_roles, sort_order, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [name.trim(), url.trim(), description.trim(), category.trim() || '通用',
             JSON.stringify(allowed_roles), Number(sort_order) || 0, req.user.username]
        );
        getAudit(req)({ module: '业务看板', action: 'CREATE', details: { name: name.trim(), by: req.user.username } });
        return res.json({ success: true, message: '看板创建成功', data: result.rows[0] });
    } catch (err) {
        return res.status(500).json({ success: false, message: '创建看板失败: ' + err.message });
    }
});

// PUT /api/dashboards/admin/:id — 更新看板
router.put('/admin/:id', requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ success: false, message: '无效的看板 ID' });
        }
        const existing = await pool.query('SELECT id FROM sys_dashboards WHERE id = $1', [id]);
        if (existing.rowCount === 0) {
            return res.status(404).json({ success: false, message: '看板不存在' });
        }
        const { name, url, description, category, allowed_roles, sort_order } = req.body || {};
        if (!name?.trim() || !url?.trim()) {
            return res.status(400).json({ success: false, message: '看板名称和 URL 不能为空' });
        }
        if (!/^https?:\/\//i.test(url.trim())) {
            return res.status(400).json({ success: false, message: 'URL 必须以 http:// 或 https:// 开头' });
        }
        if (!Array.isArray(allowed_roles) || allowed_roles.length === 0) {
            return res.status(400).json({ success: false, message: '至少选择一个可见角色' });
        }
        await pool.query(
            `UPDATE sys_dashboards
             SET name = $1, url = $2, description = $3, category = $4,
                 allowed_roles = $5, sort_order = $6, updated_at = NOW()
             WHERE id = $7`,
            [name.trim(), url.trim(), (description || '').trim(), (category || '通用').trim(),
             JSON.stringify(allowed_roles), Number(sort_order) || 0, id]
        );
        getAudit(req)({ module: '业务看板', action: 'UPDATE', details: { id, name: name.trim(), by: req.user.username } });
        return res.json({ success: true, message: '看板更新成功' });
    } catch (err) {
        return res.status(500).json({ success: false, message: '更新看板失败: ' + err.message });
    }
});

// DELETE /api/dashboards/admin/:id — 删除看板
router.delete('/admin/:id', requireAdmin, async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ success: false, message: '无效的看板 ID' });
        }
        const result = await pool.query('DELETE FROM sys_dashboards WHERE id = $1 RETURNING name', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: '看板不存在' });
        }
        getAudit(req)({ module: '业务看板', action: 'DELETE', details: { id, name: result.rows[0].name, by: req.user.username } });
        return res.json({ success: true, message: '看板删除成功' });
    } catch (err) {
        return res.status(500).json({ success: false, message: '删除看板失败: ' + err.message });
    }
});

export default router;
