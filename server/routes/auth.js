/**
 * auth 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { logger } from '../infra/logger.js';
import { authenticateToken, JWT_SECRET } from '../infra/auth.js';
import { logAudit } from '../infra/audit.js';
import pool from '../db.js';

export function segAuth1(app, __ctx) {
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: '请提供有效的用户名和密码' });
    }

    try {
        // 从 PG sys_users 表查询
        const result = await pool.query(
            'SELECT id, username, password_hash, role, is_active, display_name FROM sys_users WHERE username = $1',
            [username]
        );

        if (result.rowCount === 0) {
            logAudit(req, { module: 'AUTH', action: 'LOGIN_FAIL', details: { username, reason: 'USER_NOT_FOUND' } });
            return res.status(401).json({ success: false, message: '用户不存在' });
        }

        const user = result.rows[0];

        if (!user.is_active) {
            return res.status(403).json({ success: false, message: '账号已被禁用，请联系管理员' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            logAudit(req, { module: 'AUTH', action: 'LOGIN_FAIL', details: { username, reason: 'PASSWORD_ERROR' } });
            return res.status(401).json({ success: false, message: '密码错误' });
        }

        // 更新最后登录时间
        pool.query('UPDATE sys_users SET last_login_at = NOW() WHERE id = $1', [user.id]).catch(() => { });

        // --- 刷新自动登出/会话清理优化 ---
        // 我们不再强制清理同 IP 的旧会话，以避免误杀。改为交给下方的总数限制逻辑统一处理。
        const rawUA = req.headers['user-agent'] || '';
        const deviceInfoStr = rawUA.length > 120 ? rawUA.slice(0, 120) + '...' : rawUA;
        const rawIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
        const ipAddrStr = __ctx.normalizeIp(rawIP);

        // 检查并发登录限制 (上限 5 个活跃会话)
        const sessionCountRes = await pool.query(
            'SELECT COUNT(*) FROM sys_user_sessions WHERE user_id = $1 AND revoked = FALSE AND expires_at > NOW()',
            [user.id]
        );
        const activeSessions = parseInt(sessionCountRes.rows[0].count);

        // 如果达到 5 个限制，则踢出最早的一个会话 (实现“强制登出第一个登陆的人”)
        if (activeSessions >= 5) {
            try {
                const oldestSession = await pool.query(
                    'SELECT jti FROM sys_user_sessions WHERE user_id = $1 AND revoked = FALSE AND expires_at > NOW() ORDER BY created_at ASC LIMIT 1',
                    [user.id]
                );
                if (oldestSession.rowCount > 0) {
                    const oldJti = oldestSession.rows[0].jti;
                    await pool.query(
                        'UPDATE sys_user_sessions SET revoked = TRUE, revoked_at = NOW() WHERE jti = $1',
                        [oldJti]
                    );
                    logger.info(`[SessionLimit] 账号 ${user.username} 达到 5 人上限，已强制登出最早会话 ${oldJti}`);
                }
            } catch (e) {
                logger.error('[SessionCleanup] Failed to kick oldest session:', e);
            }
        }

        // 生成唯一会话 ID (jti)
        const jti = crypto.randomBytes(24).toString('hex');
        const expiresAt = new Date(Date.now() + 5 * 60 * 60 * 1000); // 5小时

        // 解析设备信息
        const ua = req.headers['user-agent'] || '';
        const deviceInfo = ua.length > 120 ? ua.slice(0, 120) + '...' : ua;
        const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';

        // 写入会话记录
        pool.query(
            'INSERT INTO sys_user_sessions (user_id, jti, device_info, ip_address, expires_at) VALUES ($1, $2, $3, $4, $5)',
            [user.id, jti, deviceInfo, ipAddrStr, expiresAt]
        ).catch(() => { });

        // 记录登录审计
        logAudit({ ...req, user: { id: user.id, username: user.username } },
            { module: 'AUTH', action: 'LOGIN_SUCCESS', details: { username: user.username } });

        // 签发 Token，过期限定在 2小时，内嵌 jti
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, jti },
            JWT_SECRET,
            { expiresIn: '4h' }
        );

        logger.info(`用户 ${username} 登陆成功，下发凭证`);
        return res.json({
            success: true,
            message: '登录成功',
            data: {
                token: token,
                username: user.username,
                display_name: user.display_name || user.username,
                role: user.role
            }
        });
    } catch (err) {
        logger.error('登录系统异常', err);
        return res.status(500).json({ success: false, message: '系统内部验证错误' });
    }
});

// API路由: 用户登出 (吊销当前 JTI)
app.post('/api/auth/logout', authenticateToken, async (req, res) => {
    try {
        if (req.user && req.user.jti) {
            await pool.query(
                'UPDATE sys_user_sessions SET revoked = TRUE, revoked_at = NOW() WHERE jti = $1',
                [req.user.jti]
            );
            logAudit(req, { module: 'AUTH', action: 'LOGOUT', details: { username: req.user.username } });
            logger.info(`用户 ${req.user.username} 登出，会话 ${req.user.jti} 已吊销`);
        }
        res.clearCookie(__ctx.DSH_ACCESS_COOKIE, { ...__ctx.dshCookieOptions(), maxAge: undefined });
        res.json({ success: true, message: '已成功退出登录' });
    } catch (err) {
        logger.error('登出失败：' + err.message);
        res.status(500).json({ success: false, message: '登出操作失败' });
    }
});

// Beacon 专用静默登出 (不返回 JSON，由浏览器在关闭/刷新时自动触发)
app.post('/api/auth/logout-beacon', async (req, res) => {
    try {
        const { token } = req.body;
        if (token) {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded && decoded.jti) {
                await pool.query(
                    'UPDATE sys_user_sessions SET revoked = TRUE, revoked_at = NOW() WHERE jti = $1',
                    [decoded.jti]
                );
                const rawIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
                const ua = req.headers['user-agent'] || 'Unknown';
                logger.info(`[Beacon] 会话 ${decoded.jti} (用户: ${decoded.username}, IP: ${__ctx.normalizeIp(rawIP)}, UA: ${ua}) 已通过浏览器刷新/关闭自动吊销`);
            }
        }
        res.status(204).end();
    } catch (err) {
        res.status(204).end(); // 始终返回成功以防阻塞
    }
})
}
