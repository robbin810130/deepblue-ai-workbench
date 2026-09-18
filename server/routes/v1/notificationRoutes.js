/**
 * /api/v1/notifications —— 任务通知与待办（M4，PRD §8）
 *
 *   GET  /notifications?unread_only=&todos_only=   列表
 *   GET  /notifications/unread-count               未读数（铃铛角标轮询）
 *   POST /notifications/:id/read                   标记已读
 *   POST /notifications/read-all                   全部已读
 *   POST /notifications/:id/complete-todo          完成待办
 */

import express from 'express';
import * as notify from '../../modules/notifications/notify.js';
import { sendOk, sendFail, asyncHandler } from '../../modules/common/apiResponse.js';
import { AppError } from '../../modules/common/errors.js';

const router = express.Router();

notify.ensureNotificationsTable().catch((err) => console.error('[Notify DDL] 通知表初始化失败:', err.message));

router.use((req, _res, next) => {
    if (!req.trace_id) req.trace_id = `t-ntf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    next();
});

router.get(
    '/notifications',
    asyncHandler(async (req, res) => {
        const rows = await notify.listNotifications(req.user.id, {
            unread_only: req.query.unread_only === 'true',
            todos_only: req.query.todos_only === 'true',
            limit: req.query.limit ? Number(req.query.limit) : 20,
            offset: req.query.offset ? Number(req.query.offset) : 0,
        });
        return sendOk(res, rows, { trace_id: req.trace_id, meta: { total: rows.length } });
    }),
);

router.get(
    '/notifications/unread-count',
    asyncHandler(async (req, res) => {
        const n = await notify.unreadCount(req.user.id);
        return sendOk(res, { unread: n }, { trace_id: req.trace_id });
    }),
);

router.post(
    '/notifications/read-all',
    asyncHandler(async (req, res) => {
        await notify.markAllRead(req.user.id);
        return sendOk(res, { done: true }, { trace_id: req.trace_id });
    }),
);

router.post(
    '/notifications/:id/read',
    asyncHandler(async (req, res) => {
        const ok = await notify.markRead(Number(req.params.id), req.user.id);
        if (!ok) return sendFail(res, new AppError('RESOURCE_NOT_FOUND', '通知不存在或已读'), { trace_id: req.trace_id });
        return sendOk(res, { done: true }, { trace_id: req.trace_id });
    }),
);

router.post(
    '/notifications/:id/complete-todo',
    asyncHandler(async (req, res) => {
        const ok = await notify.completeTodo(Number(req.params.id), req.user.id);
        if (!ok) return sendFail(res, new AppError('RESOURCE_NOT_FOUND', '待办不存在'), { trace_id: req.trace_id });
        return sendOk(res, { done: true }, { trace_id: req.trace_id });
    }),
);

export default router;
