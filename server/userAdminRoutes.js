// ============================================================
// userAdminRoutes.js — 用户管理 + 角色管理 API 路由
// ============================================================
import express from 'express';
import bcrypt from 'bcryptjs';
import pool from './db.js';
import winston from 'winston';
import { createLogger, format, transports } from 'winston';

const router = express.Router();

const logger = winston.createLogger({
    level: 'info',
    format: format.combine(
        format.timestamp({
            format: () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 23)
        }),
        format.printf(({ timestamp, level, message }) => `[${timestamp}] ${level.toUpperCase()}: ${message}`)
    ),
    transports: [new transports.Console()]
});

// ------ 权限中间件：仅 admin 可通过 ------
const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ success: false, message: '权限不足：需要管理员权限' });
    }
    next();
};

// 模块权限中间件：admin 放行；其他角色需在 sys_roles.permissions 中拥有对应模块（或 * 全量）
const requireModulePermission = (moduleKey) => {
    return async (req, res, next) => {
        try {
            if (req.user?.role === 'admin') return next();
            const result = await pool.query('SELECT permissions FROM sys_roles WHERE name = $1', [req.user?.role]);
            const perms = result.rows[0]?.permissions;
            if (Array.isArray(perms) && (perms.includes('*') || perms.includes(moduleKey))) return next();
            return res.status(403).json({ success: false, message: '权限不足：当前角色未授予该模块权限' });
        } catch (err) {
            logger.error('模块权限校验失败：' + err.message);
            return res.status(500).json({ success: false, message: '权限校验失败' });
        }
    };
};

// 辅助：获取审计函数
const getAudit = (req) => req.app.get('logAudit') || (() => {});

// ============================================================
// ■ 角色管理 API
// ============================================================

// GET /api/admin/roles — 获取所有角色列表（含权限）
router.get('/roles', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, display_name, is_builtin, permissions, created_at FROM sys_roles ORDER BY is_builtin DESC, created_at ASC'
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        logger.error('查询角色列表失败：' + err.message);
        res.status(500).json({ success: false, message: '查询角色列表失败' });
    }
});

// GET /api/roles — 公开接口：任何已登录用户获取角色列表（用于下拉框）
router.get('/roles-public', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT name, display_name FROM sys_roles ORDER BY is_builtin DESC, created_at ASC'
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: '查询角色失败' });
    }
});

// GET /api/admin/roles/my-permissions — 获取当前用户角色的权限（用于 RoleContext 初始化）
router.get('/my-permissions', async (req, res) => {
    try {
        const role = req.user?.role;
        if (!role) return res.json({ success: true, data: [] });
        // admin 固定返回全量
        if (role === 'admin') {
            const result = await pool.query("SELECT permissions FROM sys_roles WHERE name = 'admin'");
            return res.json({ success: true, data: result.rows[0]?.permissions || [] });
        }
        const result = await pool.query('SELECT permissions FROM sys_roles WHERE name = $1', [role]);
        res.json({ success: true, data: result.rows[0]?.permissions || [] });
    } catch (err) {
        res.status(500).json({ success: false, message: '查询权限失败' });
    }
});

// POST /api/admin/roles — 创建自定义角色
router.post('/roles', requireAdmin, async (req, res) => {
    try {
        const { name, display_name, permissions = [] } = req.body;
        if (!name || !display_name) return res.status(400).json({ success: false, message: '角色标识和显示名不能为空' });
        if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(name)) return res.status(400).json({ success: false, message: '角色标识仅支持英文、数字、下划线、中文' });
        if (!Array.isArray(permissions)) return res.status(400).json({ success: false, message: 'permissions 必须为数组' });
        const result = await pool.query(
            `INSERT INTO sys_roles (name, display_name, is_builtin, permissions)
             VALUES ($1, $2, FALSE, $3::jsonb)
             RETURNING id, name, display_name, is_builtin, permissions, created_at`,
            [name, display_name, JSON.stringify(permissions)]
        );
        getAudit(req)(req, { module: 'ROLE_MANAGE', action: 'CREATE_ROLE', target_data: name, details: { display_name, permissions } });
        res.json({ success: true, message: '角色创建成功', data: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ success: false, message: '角色标识已存在' });
        logger.error('创建角色失败：' + err.message);
        res.status(500).json({ success: false, message: '创建角色失败' });
    }
});

// PUT /api/admin/roles/:id — 修改角色显示名或权限
router.put('/roles/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { display_name, permissions } = req.body;
        if (permissions !== undefined && !Array.isArray(permissions)) {
            return res.status(400).json({ success: false, message: 'permissions 必须为数组' });
        }
        const result = await pool.query(
            `UPDATE sys_roles SET
               display_name = COALESCE($1, display_name),
               permissions  = COALESCE($2::jsonb, permissions)
             WHERE id = $3
             RETURNING id, name, display_name, is_builtin, permissions`,
            [display_name || null, permissions !== undefined ? JSON.stringify(permissions) : null, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ success: false, message: '角色不存在' });
        getAudit(req)(req, { module: 'ROLE_MANAGE', action: 'UPDATE_ROLE', target_data: `ID=${id}`, details: { display_name, permissions } });
        res.json({ success: true, message: '角色已更新', data: result.rows[0] });
    } catch (err) {
        logger.error('修改角色失败：' + err.message);
        res.status(500).json({ success: false, message: '修改角色失败' });
    }
});

// DELETE /api/admin/roles/:id — 删除自定义角色（内置角色不可删）
router.delete('/roles/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const target = await pool.query('SELECT name, is_builtin FROM sys_roles WHERE id = $1', [id]);
        if (target.rowCount === 0) return res.status(404).json({ success: false, message: '角色不存在' });
        if (target.rows[0].is_builtin) return res.status(400).json({ success: false, message: '内置角色不允许删除' });
        const roleName = target.rows[0].name;

        // 检查该角色下是否还有绑定的用户
        const usersCount = await pool.query('SELECT COUNT(*) FROM sys_users WHERE role = $1', [roleName]);
        if (parseInt(usersCount.rows[0].count) > 0) {
            return res.status(400).json({ success: false, message: '该角色下仍有关联用户，无法删除！请先将相关用户修改为其他角色。' });
        }

        await pool.query('DELETE FROM sys_roles WHERE id = $1', [id]);
        getAudit(req)(req, { module: 'ROLE_MANAGE', action: 'DELETE_ROLE', target_data: roleName });
        res.json({ success: true, message: '角色已删除' });
    } catch (err) {
        logger.error('删除角色失败：' + err.message);
        res.status(500).json({ success: false, message: '删除角色失败' });
    }
});

// ============================================================
// ■ 用户管理 API
// ============================================================

// GET /api/admin/users — 查询用户列表
router.get('/users', requireAdmin, async (req, res) => {
    try {
        const { search = '', role = '', page = 1, pageSize = 50 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(pageSize);
        const conditions = [];
        const params = [];
        let idx = 1;

        if (search) {
            conditions.push(`(u.username ILIKE $${idx} OR u.display_name ILIKE $${idx} OR u.email ILIKE $${idx})`);
            params.push(`%${search}%`);
            idx++;
        }
        if (role) {
            conditions.push(`u.role = $${idx}`);
            params.push(role);
            idx++;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const countResult = await pool.query(`SELECT COUNT(*) FROM sys_users u ${where}`, params);
        const total = parseInt(countResult.rows[0].count);

        const result = await pool.query(
            `SELECT u.id, u.username, u.display_name, u.email, u.role,
                    COALESCE(r.display_name, u.role) AS role_label,
                    u.is_active, u.avatar_url, u.created_at, u.last_login_at
             FROM sys_users u
             LEFT JOIN sys_roles r ON r.name = u.role
             ${where}
             ORDER BY u.created_at ASC
             LIMIT $${idx} OFFSET $${idx + 1}`,
            [...params, parseInt(pageSize), offset]
        );
        res.json({ success: true, data: { list: result.rows, total, page: parseInt(page), pageSize: parseInt(pageSize) } });
    } catch (err) {
        logger.error('查询用户列表失败：' + err.message);
        res.status(500).json({ success: false, message: '查询用户列表失败' });
    }
});

// GET /api/admin/users/minimal — 获取所有账号的简要信息（仅 id, username, display_name）
// 供操作日志、资质管理等非管理员模块的筛选/选择下拉使用：已登录即可访问
router.get('/users/minimal', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, display_name FROM sys_users ORDER BY username ASC');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: '获取用户简要列表失败' });
    }
});

// POST /api/admin/users — 创建用户（角色从 sys_roles 动态校验）
router.post('/users', requireAdmin, async (req, res) => {
    try {
        const { username, password, display_name, email, role = 'user' } = req.body;
        if (!username || !password) return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
        if (username.length < 3) return res.status(400).json({ success: false, message: '用户名至少需要 3 位' });
        if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(username)) return res.status(400).json({ success: false, message: '用户名仅支持英文、数字、下划线、中文' });
        // 动态校验角色是否存在
        const roleCheck = await pool.query('SELECT name FROM sys_roles WHERE name = $1', [role]);
        if (roleCheck.rowCount === 0) return res.status(400).json({ success: false, message: '角色不存在' });
        const passwordHash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO sys_users (username, password_hash, display_name, email, role)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, username, display_name, email, role, is_active, created_at`,
            [username, passwordHash, display_name || username, email || null, role]
        );
        getAudit(req)(req, { module: 'USER_MANAGE', action: 'CREATE_USER', target_data: username, details: { role, display_name } });
        res.json({ success: true, message: '用户创建成功', data: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ success: false, message: '用户名已存在' });
        logger.error('创建用户失败：' + err.message);
        res.status(500).json({ success: false, message: '创建用户失败' });
    }
});

// PUT /api/admin/users/:id — 修改用户信息（角色动态校验）
router.put('/users/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { display_name, email, role } = req.body;
        if (role) {
            const roleCheck = await pool.query('SELECT name FROM sys_roles WHERE name = $1', [role]);
            if (roleCheck.rowCount === 0) return res.status(400).json({ success: false, message: '角色不存在' });
        }
        const result = await pool.query(
            `UPDATE sys_users SET
               display_name = COALESCE($1, display_name),
               email        = COALESCE($2, email),
               role         = COALESCE($3, role)
             WHERE id = $4
             RETURNING id, username, display_name, email, role, is_active`,
            [display_name || null, email || null, role || null, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ success: false, message: '用户不存在' });
        getAudit(req)(req, { module: 'USER_MANAGE', action: 'UPDATE_USER', target_data: `ID=${id}`, details: { display_name, email, role } });
        res.json({ success: true, message: '用户信息已更新', data: result.rows[0] });
    } catch (err) {
        logger.error('修改用户失败：' + err.message);
        res.status(500).json({ success: false, message: '修改用户失败' });
    }
});

// PUT /api/admin/users/:id/status — 启用/禁用账号
router.put('/users/:id/status', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;
        const target = await pool.query('SELECT username FROM sys_users WHERE id = $1', [id]);
        if (target.rows[0]?.username === req.user.username) return res.status(400).json({ success: false, message: '不能禁用自己的账号' });
        const result = await pool.query(
            `UPDATE sys_users SET is_active = $1 WHERE id = $2 RETURNING id, username, is_active`,
            [!!is_active, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ success: false, message: '用户不存在' });
        const actionStr = is_active ? '启用' : '禁用';
        getAudit(req)(req, { module: 'USER_MANAGE', action: is_active ? 'ENABLE_USER' : 'DISABLE_USER', target_data: `ID=${id}` });
        res.json({ success: true, message: `账号已${actionStr}`, data: result.rows[0] });
    } catch (err) {
        logger.error('修改账号状态失败：' + err.message);
        res.status(500).json({ success: false, message: '修改状态失败' });
    }
});

// POST /api/admin/users/:id/reset-password
router.post('/users/:id/reset-password', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { new_password } = req.body;
        if (!new_password || new_password.length < 6) return res.status(400).json({ success: false, message: '新密码至少 6 位' });
        const passwordHash = await bcrypt.hash(new_password, 10);
        const result = await pool.query(
            `UPDATE sys_users SET password_hash = $1 WHERE id = $2 RETURNING id, username`,
            [passwordHash, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ success: false, message: '用户不存在' });
        getAudit(req)(req, { module: 'USER_MANAGE', action: 'RESET_PASSWORD', target_data: `ID=${id}` });
        res.json({ success: true, message: '密码已重置' });
    } catch (err) {
        logger.error('重置密码失败：' + err.message);
        res.status(500).json({ success: false, message: '重置密码失败' });
    }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const target = await pool.query('SELECT username FROM sys_users WHERE id = $1', [id]);
        if (target.rows[0]?.username === req.user.username) return res.status(400).json({ success: false, message: '不能删除自己的账号' });
        const result = await pool.query('DELETE FROM sys_users WHERE id = $1 RETURNING id, username', [id]);
        if (result.rowCount === 0) return res.status(404).json({ success: false, message: '用户不存在' });
        getAudit(req)(req, { module: 'USER_MANAGE', action: 'DELETE_USER', target_data: result.rows[0].username });
        res.json({ success: true, message: '用户已删除' });
    } catch (err) {
        logger.error('删除用户失败：' + err.message);
        res.status(500).json({ success: false, message: '删除用户失败' });
    }
});

// GET /api/user/profile
router.get('/profile', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.id, u.username, u.display_name, u.email, u.role, u.department,
                    COALESCE(r.display_name, u.role) AS role_label,
                    u.is_active, u.avatar_url, u.created_at, u.last_login_at
             FROM sys_users u LEFT JOIN sys_roles r ON r.name = u.role
             WHERE u.username = $1`,
            [req.user.username]
        );
        if (result.rowCount === 0) return res.status(404).json({ success: false, message: '用户不存在' });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        logger.error('查询个人信息失败：' + err.message);
        res.status(500).json({ success: false, message: '查询个人信息失败' });
    }
});

// PUT /api/user/profile — 修改姓名/部门/邮箱
router.put('/profile', async (req, res) => {
    try {
        const { display_name, department, email } = req.body;
        if (!display_name?.trim()) return res.status(400).json({ success: false, message: '显示姓名不能为空' });
        await pool.query(
            'UPDATE sys_users SET display_name = $1, department = $2, email = $3 WHERE username = $4',
            [display_name.trim(), (department || '').trim(), (email || '').trim(), req.user.username]
        );
        getAudit(req)(req, { module: 'PROFILE', action: 'UPDATE_PROFILE', details: { department, email } });
        res.json({ success: true, message: '个人信息已更新' });
    } catch (err) {
        logger.error('更新个人信息失败：' + err.message);
        res.status(500).json({ success: false, message: '更新个人信息失败' });
    }
});

// POST /api/user/change-password
router.post('/change-password', async (req, res) => {
    try {
        const { old_password, new_password } = req.body;
        if (!old_password || !new_password) return res.status(400).json({ success: false, message: '旧密码和新密码不能为空' });
        if (new_password.length < 6) return res.status(400).json({ success: false, message: '新密码至少 6 位' });
        const userResult = await pool.query('SELECT password_hash FROM sys_users WHERE username = $1', [req.user.username]);
        if (userResult.rowCount === 0) return res.status(404).json({ success: false, message: '用户不存在' });
        const isMatch = await bcrypt.compare(old_password, userResult.rows[0].password_hash);
        if (!isMatch) return res.status(401).json({ success: false, message: '旧密码错误' });
        const newHash = await bcrypt.hash(new_password, 10);
        await pool.query('UPDATE sys_users SET password_hash = $1 WHERE username = $2', [newHash, req.user.username]);
        // 吊销当前 jti 之外的所有会话
        if (req.user.jti) {
            await pool.query(
                `UPDATE sys_user_sessions SET revoked = TRUE, revoked_at = NOW()
                 WHERE user_id = (SELECT id FROM sys_users WHERE username = $1)
                   AND jti != $2 AND revoked = FALSE`,
                [req.user.username, req.user.jti]
            ).catch(() => {});
        }
        getAudit(req)(req, { module: 'PROFILE', action: 'CHANGE_PASSWORD' });
        res.json({ success: true, message: '密码已修改，其他登录设备已下线' });
    } catch (err) {
        logger.error('修改密码失败：' + err.message);
        res.status(500).json({ success: false, message: '修改密码失败' });
    }
});

// POST /api/user/avatar — 上传头像（base64 DataURL）
router.post('/avatar', async (req, res) => {
    try {
        const { avatar_data } = req.body; // base64 DataURL
        if (!avatar_data) return res.status(400).json({ success: false, message: '请提供头像数据' });
        if (avatar_data.length > 500000) return res.status(400).json({ success: false, message: '头像文件过大（限 ~350KB）' });
        await pool.query('UPDATE sys_users SET avatar_url = $1 WHERE username = $2', [avatar_data, req.user.username]);
        getAudit(req)(req, { module: 'PROFILE', action: 'UPDATE_AVATAR' });
        res.json({ success: true, message: '头像已更新' });
    } catch (err) {
        logger.error('更新头像失败：' + err.message);
        res.status(500).json({ success: false, message: '更新头像失败' });
    }
});

// GET /api/user/sessions — 查询当前账号所有会话
router.get('/sessions', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT s.jti, s.device_info, s.ip_address, s.created_at, s.expires_at, s.revoked,
                    (s.jti = $1) AS is_current
             FROM sys_user_sessions s
             WHERE s.user_id = (SELECT id FROM sys_users WHERE username = $2)
               AND s.revoked = FALSE AND s.expires_at > NOW()
             ORDER BY s.created_at DESC`,
            [req.user.jti || '', req.user.username]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        logger.error('查询会话列表失败：' + err.message);
        res.status(500).json({ success: false, message: '查询会话列表失败' });
    }
});

// DELETE /api/user/sessions/:jti — 吊销指定会话（踢出设备）
router.delete('/sessions/:jti', async (req, res) => {
    try {
        const { jti } = req.params;
        if (jti === req.user.jti) return res.status(400).json({ success: false, message: '不能退出当前设备，请使用退出登录功能' });
        await pool.query(
            `UPDATE sys_user_sessions SET revoked = TRUE, revoked_at = NOW()
             WHERE jti = $1 AND user_id = (SELECT id FROM sys_users WHERE username = $2)`,
            [jti, req.user.username]
        );
        res.json({ success: true, message: '设备已踢出' });
    } catch (err) {
        logger.error('踢出设备失败：' + err.message);
        res.status(500).json({ success: false, message: '踢出设备失败' });
    }
});

// DELETE /api/user/sessions — 吊销所有其他会话（退出所有其他设备）
router.delete('/sessions', async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE sys_user_sessions SET revoked = TRUE, revoked_at = NOW()
             WHERE user_id = (SELECT id FROM sys_users WHERE username = $1)
               AND jti != $2 AND revoked = FALSE`,
            [req.user.username, req.user.jti || '']
        );
        logger.info(`用户 ${req.user.username} 退出了所有其他设备，共 ${result.rowCount} 个`);
        res.json({ success: true, message: `已退出其他 ${result.rowCount} 个设备` });
    } catch (err) {
        logger.error('退出其他设备失败：' + err.message);
        res.status(500).json({ success: false, message: '退出其他设备失败' });
    }
});

// ============================================================
// ■ 操作审计日志 API
// ============================================================

// GET /api/admin/audit-logs — 查询审计日志（admin 或拥有 auditlog 模块权限的角色可访问）
router.get('/audit-logs', requireModulePermission('auditlog'), async (req, res) => {
    try {
        const { username = '', module = '', action = '', page = 1, pageSize = 50 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(pageSize);
        const conditions = [];
        const params = [];
        let idx = 1;

        if (username) {
            conditions.push(`username ILIKE $${idx}`);
            params.push(`%${username}%`);
            idx++;
        }
        if (module) {
            conditions.push(`module = $${idx}`);
            params.push(module);
            idx++;
        }
        if (action) {
            conditions.push(`action = $${idx}`);
            params.push(action);
            idx++;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const countResult = await pool.query(`SELECT COUNT(*) FROM sys_audit_logs ${where}`, params);
        const total = parseInt(countResult.rows[0].count);

        const result = await pool.query(
            `SELECT id, user_id, username, module, action, target_data, details, status, ip_address, user_agent, created_at
             FROM sys_audit_logs
             ${where}
             ORDER BY created_at DESC
             LIMIT $${idx} OFFSET $${idx + 1}`,
            [...params, parseInt(pageSize), offset]
        );
        res.json({ success: true, data: { list: result.rows, total, page: parseInt(page), pageSize: parseInt(pageSize) } });
    } catch (err) {
        logger.error('查询审计日志失败：' + err.message);
        res.status(500).json({ success: false, message: '查询审计日志失败' });
    }
});

export default router;

