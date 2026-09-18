/**
 * 通知与待办 —— PRD §8 的落地面
 *
 * 四类事件（PRD §8 原文）：
 *   任务完成      → 通知是，待办否
 *   任务失败      → 通知是，待办视业务（M4 先只发通知）
 *   需要人工确认  → 通知是，待办是
 *   被分配任务    → 通知是，待办是
 *
 * 设计原则：
 *   - notify() **永不抛错**：通知失败不能把任务主流程带崩（fire-and-forget + 兜底日志）。
 *   - TodoItem 接入点：waiting_confirmation / assigned 时同时调用 markTodo()，
 *     M4 先以 notifications 表的 is_todo 标记承接（前端待办面板据此过滤），
 *     后续接入独立待办系统时只换 markTodo 实现，钩子位置不变。
 */

import pool from '../../db.js';

export async function ensureNotificationsTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS task_notifications (
            id         BIGSERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL,
            type       VARCHAR(32) NOT NULL,
            title      VARCHAR(200) NOT NULL,
            body       TEXT,
            task_id    UUID,
            is_todo    BOOLEAN NOT NULL DEFAULT FALSE,
            todo_done  BOOLEAN NOT NULL DEFAULT FALSE,
            read_at    TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_task_notifications_user ON task_notifications (user_id, created_at DESC);
    `);
}

/**
 * 发通知（永不抛错）。
 * @param {number|number[]} userIds
 * @param {object} p
 * @param {'task_succeeded'|'task_failed'|'task_need_confirm'|'task_assigned'} p.type
 * @param {string} p.title
 * @param {string} [p.body]
 * @param {string} [p.taskId]
 * @param {boolean} [p.isTodo]
 */
export function notify(userIds, { type, title, body = null, taskId = null, isTodo = false }) {
    const ids = Array.isArray(userIds) ? [...new Set(userIds.filter((v) => v != null))] : [userIds];
    if (!ids.length || !ids[0]) return Promise.resolve();
    return pool.query(
        `INSERT INTO task_notifications (user_id, type, title, body, task_id, is_todo)
         SELECT x, $2, $3, $4, $5, $6 FROM unnest($1::int[]) AS x`,
        [ids, type, title, body, taskId, isTodo],
    ).catch((e) => console.error('[notify] 通知写入失败（不阻断主流程）:', e.message));
}

/** 待办完成（用户在待办面板处理完确认/驳回后调用） */
export async function completeTodo(notificationId, userId) {
    const { rowCount } = await pool.query(
        'UPDATE task_notifications SET todo_done = TRUE WHERE id = $1 AND user_id = $2',
        [notificationId, userId],
    );
    return rowCount > 0;
}

export async function listNotifications(userId, { unread_only = false, todos_only = false, limit = 20, offset = 0 }) {
    const where = ['user_id = $1'];
    const params = [userId];
    const add = (v) => {
        params.push(v);
        return `$${params.length}`;
    };
    if (unread_only) where.push(`read_at IS NULL`);
    if (todos_only) where.push(`is_todo = TRUE`);
    params.push(Math.min(Number(limit) || 20, 100));
    const lim = `$${params.length}`;
    params.push(Math.max(Number(offset) || 0, 0));
    const off = `$${params.length}`;
    const { rows } = await pool.query(
        `SELECT * FROM task_notifications WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`,
        params,
    );
    return rows;
}

export async function unreadCount(userId) {
    const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM task_notifications WHERE user_id = $1 AND read_at IS NULL',
        [userId],
    );
    return rows[0]?.n ?? 0;
}

export async function markRead(id, userId) {
    const { rowCount } = await pool.query(
        'UPDATE task_notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 AND read_at IS NULL',
        [id, userId],
    );
    return rowCount > 0;
}

export async function markAllRead(userId) {
    await pool.query('UPDATE task_notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL', [userId]);
}
