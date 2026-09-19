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

let notifDdlPromise = null;

/** 启动/首次调用期建表（幂等 + memo 化：多请求并发只执行一次） */
export function ensureNotificationsTable() {
    if (!notifDdlPromise) {
        notifDdlPromise = (async () => {
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
            // ── XO-07 P1 通知双轨合并：应用通知并入本表（source 区分来源），旧 sys_notifications 只读保留 ──
            await pool.query(`
                ALTER TABLE task_notifications ADD COLUMN IF NOT EXISTS source    VARCHAR(16)  NOT NULL DEFAULT 'task_center';
                ALTER TABLE task_notifications ADD COLUMN IF NOT EXISTS app_id    VARCHAR(80)  NULL;
                ALTER TABLE task_notifications ADD COLUMN IF NOT EXISTS app_name  VARCHAR(120) NULL;
                ALTER TABLE task_notifications ADD COLUMN IF NOT EXISTS client_ref VARCHAR(120) NULL;
                CREATE UNIQUE INDEX IF NOT EXISTS uq_task_notifications_client_ref
                    ON task_notifications (client_ref) WHERE client_ref IS NOT NULL;
            `);
        })().catch((e) => {
            notifDdlPromise = null; // 失败可重试
            throw e;
        });
    }
    return notifDdlPromise;
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

// ============================================================================
// XO-07 P1 应用通知并入：原 sys_notifications 五个端点的存储层实现。
// 写新（source='app'）+ 双读兜底旧表；旧表 sys_notifications 只读保留 30 天后废弃。
// ============================================================================

/** 应用通知写入（幂等：clientRef 相同的重复推送只落一条）。返回旧 API 形状的 id。 */
export async function notifyApp({ userId, appId = '', appName = 'System', title = '', message = '', clientRef = null }) {
    const ref = clientRef || `n-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const ins = await pool.query(
        `INSERT INTO task_notifications (user_id, type, title, body, source, app_id, app_name, client_ref)
         VALUES ($1, 'app_message', $2, $3, 'app', $4, $5, $6)
         ON CONFLICT (client_ref) WHERE client_ref IS NOT NULL DO NOTHING
         RETURNING id`,
        [userId, String(title || '').slice(0, 200), message, appId, appName, ref],
    );
    if (ins.rows.length) return { id: ref, created: true };
    const ex = await pool.query('SELECT id FROM task_notifications WHERE client_ref = $1', [ref]);
    return { id: ref, created: false, existingId: ex.rows[0]?.id ?? null };
}

/** 应用通知列表（双读：新表 source='app' + 旧表未被并入的行；旧表缺失时优雅降级只读新表） */
export async function listAppNotifications(userId) {
    const fresh = await pool.query(
        `SELECT COALESCE(client_ref, 'tn-' || id::text) AS id, user_id, app_id, app_name, title, body AS message,
                (read_at IS NOT NULL) AS is_read, created_at
           FROM task_notifications
          WHERE user_id = $1 AND source = 'app'`,
        [userId],
    );
    let legacyRows = [];
    try {
        const legacy = await pool.query(
            `SELECT n.id, n.user_id, n.app_id, n.app_name, n.title, n.message, n.is_read, n.created_at
               FROM sys_notifications n
              WHERE n.user_id = $1
                AND NOT EXISTS (SELECT 1 FROM task_notifications t WHERE t.client_ref = n.id)`,
            [userId],
        );
        legacyRows = legacy.rows;
    } catch (_) { /* 旧表不存在（全新部署/冒烟库）则只读新表 */ }
    return [...fresh.rows, ...legacyRows]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 100);
}

/** 标记已读：新旧两表同打（id 可能来自任一表） */
export async function markAppRead(id, userId) {
    let hit = 0;
    const r1 = await pool.query(
        `UPDATE task_notifications SET read_at = NOW()
          WHERE user_id = $2 AND read_at IS NULL AND (client_ref = $1 OR id::text = $1)`,
        [id, userId],
    );
    hit += r1.rowCount;
    try {
        const r2 = await pool.query(
            `UPDATE sys_notifications SET is_read = TRUE, updated_at = NOW()
              WHERE id = $1 AND user_id = $2 AND NOT is_read`,
            [id, userId],
        );
        hit += r2.rowCount;
    } catch (_) { /* 旧表不存在则忽略 */ }
    return hit > 0;
}

/** 删除单条：新旧两表同删 */
export async function deleteAppNotification(id, userId) {
    let hit = 0;
    const r1 = await pool.query(
        `DELETE FROM task_notifications WHERE user_id = $2 AND (client_ref = $1 OR id::text = $1)`,
        [id, userId],
    );
    hit += r1.rowCount;
    try {
        const r2 = await pool.query(`DELETE FROM sys_notifications WHERE id = $1 AND user_id = $2`, [id, userId]);
        hit += r2.rowCount;
    } catch (_) { /* 旧表不存在则忽略 */ }
    return hit > 0;
}

/** 清空当前用户全部应用通知（仅应用域，不碰任务通知）：新旧两表同清 */
export async function clearAppNotifications(userId) {
    await pool.query(`DELETE FROM task_notifications WHERE user_id = $1 AND source = 'app'`, [userId]);
    try {
        await pool.query(`DELETE FROM sys_notifications WHERE user_id = $1`, [userId]);
    } catch (_) { /* 旧表不存在则忽略 */ }
}
