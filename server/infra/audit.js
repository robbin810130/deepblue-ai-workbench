/**
 * server/infra/audit.js — 审计日志（XO-01 拆解：自 server.js 原样迁出）
 * 落 sys_audit_logs；调用方仍可通过 req.app.get('logAudit') 获取（兼容存量路由文件）。
 */
import pool from '../db.js';
import { logger } from './logger.js';

export async function logAudit(req, { module, action, target_data, details, status = 'SUCCESS' }) {
    try {
        if (!req) req = {};
        const user = req.user || {}; // 从 authenticateToken 获取
        const ip = req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
        const ua = req.headers?.['user-agent'] || '';
        await pool.query(
            `INSERT INTO sys_audit_logs (user_id, username, module, action, target_data, details, status, ip_address, user_agent) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                user.id || user.userId || null,
                user.username || 'ANONYMOUS',
                module,
                action,
                target_data ? (typeof target_data === 'string' ? target_data : JSON.stringify(target_data)) : '',
                details ? (typeof details === 'string' ? details : JSON.stringify(details)) : '',
                status,
                ip,
                ua
            ]
        );
    } catch (err) {
        logger.error('[AuditLog Error] ' + err.message);
    }
}
