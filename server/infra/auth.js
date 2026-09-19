/**
 * server/infra/auth.js — 全局 JWT 鉴权中间件（XO-01 拆解：自 server.js 原样迁出）
 * 行为零变化：放行清单、会话吊销检查（sys_user_sessions.jti）与原实现一致。
 */
import jwt from 'jsonwebtoken';
import pool from '../db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'blue-os-super-secret-key';

export const authenticateToken = async (req, res, next) => {
    // 诊改优化：放行 OPTIONS 预检请求及特定路径，解决直连 3001 时的跨域鉴权问题
    // 特别说明：/api/auth/logout-beacon 必须放行，因为 sendBeacon 无法携带 Authorization Header
    if (req.method === 'OPTIONS' || req.path === '/api/auth/login' || req.path === '/api/auth/logout-beacon' || req.path === '/api/health' || req.path === '/api/business-dashboard/publish' || req.path === '/api/v1/files/download') {
        // /api/business-dashboard/publish 由路由内部 X-Internal-Token 鉴权（Dify 服务端调用，无平台 JWT）
        // /api/v1/files/download 为短时签名 URL 下载（HMAC+有效期即凭证，PRD 05 §9），路由内部自行校验签名
        return next();
    }

    const isApiRequest = req.path.startsWith('/api/');
    const isSensitiveJson = req.path === '/sales_analysis_matrix.json' || req.path === '/monthly_forecast_baseline.json';

    if (isApiRequest || isSensitiveJson) {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: '未提供访问令牌，请先登录' });

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(403).json({ success: false, message: '令牌无效或已过期' });
        }

        // 若 Token 带 jti，检查会话是否被吊销
        if (decoded.jti) {
            try {
                const sess = await pool.query(
                    'SELECT revoked FROM sys_user_sessions WHERE jti = $1',
                    [decoded.jti]
                );
                if (sess.rowCount > 0 && sess.rows[0].revoked) {
                    return res.status(401).json({ success: false, message: '会话已在其他设备退出，请重新登录' });
                }
            } catch (_) { /* 查询失败时不阻断，降级通过 */ }
        }

        req.user = decoded;
        next();
    } else {
        next();
    }
};
