/**
 * dsh 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import jwt from 'jsonwebtoken';
import { logger } from '../infra/logger.js';
import { logAudit } from '../infra/audit.js';
import pool from '../db.js';

export function segDsh1(app, __ctx) {
app.get('/api/dsh/verify-access', async (req, res) => {
    const dshSecret = process.env.DSH_ACCESS_SECRET;
    const ticket = __ctx.parseCookies(req.headers.cookie)[__ctx.DSH_ACCESS_COOKIE];
    if (!dshSecret || !ticket) return res.status(401).end();

    try {
        const payload = jwt.verify(ticket, dshSecret);
        if (payload?.purpose !== 'dsh-access' || !payload?.jti || !payload?.id) {
            return res.status(403).end();
        }
        const session = await pool.query(
            'SELECT 1 FROM sys_user_sessions WHERE jti = $1 AND revoked = FALSE AND expires_at > NOW()',
            [payload.jti]
        );
        if (session.rowCount === 0) return res.status(401).end();
        return res.status(204).end();
    } catch (error) {
        logger.warn('[DSH Access] 无效访问票据: ' + error.message);
        return res.status(401).end();
    }
})
}

export function segDsh2(app, __ctx) {
app.post('/api/dsh/access-ticket', async (req, res) => {
    const dshSecret = process.env.DSH_ACCESS_SECRET;
    if (!dshSecret) {
        return res.status(503).json({ success: false, message: 'DSH 访问服务尚未完成生产配置' });
    }
    if (!req.user?.jti || !req.user?.id) {
        return res.status(401).json({ success: false, message: '登录会话无效，请重新登录' });
    }
    try {
        const ticket = jwt.sign(
            { purpose: 'dsh-access', id: req.user.id, username: req.user.username, jti: req.user.jti },
            dshSecret,
            { expiresIn: '10m' }
        );
        res.cookie(__ctx.DSH_ACCESS_COOKIE, ticket, __ctx.dshCookieOptions());
        logAudit(req, { module: 'DSH', action: 'ACCESS_TICKET_ISSUED', details: { username: req.user.username } });
        return res.json({ success: true, expires_in_seconds: __ctx.DSH_ACCESS_TTL_MS / 1000 });
    } catch (error) {
        logger.error('[DSH Access] 签发访问票据失败: ' + error.message);
        return res.status(500).json({ success: false, message: 'DSH 访问授权失败' });
    }
})
}
