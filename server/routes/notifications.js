/**
 * notifications 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import { logger } from '../infra/logger.js';
import { authenticateToken } from '../infra/auth.js';
import * as notifyStore from '../modules/notifications/notify.js';

export function segNotifications1(app, __ctx) {
app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const userId = await __ctx.getUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: '无法识别用户身份' });

        await notifyStore.ensureNotificationsTable();
        const rows = await notifyStore.listAppNotifications(userId);

        const formatItem = (row) => ({
            id: row.id,
            userId: row.user_id,
            appId: row.app_id,
            appName: row.app_name,
            title: row.title,
            message: row.message,
            isRead: row.is_read,
            timestamp: new Date(row.created_at).getTime()
        });

        res.json({ success: true, data: rows.map(formatItem) });
    } catch (e) {
        logger.error('[PG] Get notifications error:', e);
        res.status(500).json({ success: false, message: '获取通知失败' });
    }
});

/** POST /api/notifications - 发送推送系统通知给指定用户（XO-07 P1：写入切到 task_notifications，source='app'） */
app.post('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const userId = await __ctx.getUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: '无法识别用户身份' });

        const { id, appId, appName, title, message } = req.body;
        await notifyStore.ensureNotificationsTable();
        const r = await notifyStore.notifyApp({ userId, appId, appName, title, message, clientRef: id || null });
        res.json({ success: true, id: r.id });
    } catch (e) {
        logger.error('[PG] Save notification error:', e);
        res.status(500).json({ success: false, message: '存储通知失败' });
    }
});

/** PUT /api/notifications/:id/read - 标记通知为已读（XO-07 P1：新旧两表同打） */
app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
    try {
        const userId = await __ctx.getUserId(req);
        await notifyStore.ensureNotificationsTable();
        await notifyStore.markAppRead(req.params.id, userId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

/** DELETE /api/notifications/:id - 删除单条通知（XO-07 P1：新旧两表同删） */
app.delete('/api/notifications/:id', authenticateToken, async (req, res) => {
    try {
        const userId = await __ctx.getUserId(req);
        await notifyStore.ensureNotificationsTable();
        await notifyStore.deleteAppNotification(req.params.id, userId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

/** DELETE /api/notifications - 清空当前用户所有通知（XO-07 P1：新旧两表同清，仅应用域） */
app.delete('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const userId = await __ctx.getUserId(req);
        await notifyStore.ensureNotificationsTable();
        await notifyStore.clearAppNotifications(userId);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
})
}
