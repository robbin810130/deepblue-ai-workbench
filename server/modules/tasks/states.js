/**
 * 任务八态状态机 —— 文档 `05_任务中心详细PRD` §2–§3 的唯一权威实现
 *
 * 迁移图（PRD §2 原文）：
 *   draft → queued → running → waiting_confirmation → succeeded → archived
 *   异常分支：running → failed / cancelled
 *   重试：failed → queued（新建 TaskRun，不覆盖旧 Run）
 *
 * 本文件之外的任何状态计算都必须 import 这里，禁止散落字符串比较 ——
 * 状态机一旦出现第二份实现，迁移合法性就会开始漂移。
 */

/** @typedef {'draft'|'queued'|'running'|'waiting_confirmation'|'succeeded'|'failed'|'cancelled'|'archived'} TaskStatus */

/** 八态封闭枚举 */
export const TASK_STATUSES = Object.freeze([
    'draft',
    'queued',
    'running',
    'waiting_confirmation',
    'succeeded',
    'failed',
    'cancelled',
    'archived',
]);

/** 结局态：不会再变化的最终状态（archived 除外 —— 归档自结局态进入） */
export const END_STATUSES = Object.freeze(['succeeded', 'failed', 'cancelled']);

/** 中文展示名（PRD §3「用户含义」列） */
export const STATUS_LABELS = Object.freeze({
    draft: '草稿',
    queued: '排队中',
    running: '执行中',
    waiting_confirmation: '等待人工确认',
    succeeded: '已完成',
    failed: '失败',
    cancelled: '已取消',
    archived: '已归档',
});

/** 各状态允许的操作（PRD §3「允许操作」列；操作名 = taskService 的方法名） */
export const ALLOWED_ACTIONS = Object.freeze({
    draft: Object.freeze(['edit', 'delete', 'execute']),
    queued: Object.freeze(['cancel']),
    running: Object.freeze(['view_progress', 'cancel']),
    waiting_confirmation: Object.freeze(['confirm', 'reject', 'cancel']),
    succeeded: Object.freeze(['view', 'download', 'share', 'rerun', 'archive']),
    failed: Object.freeze(['view_reason', 'retry', 'archive']),
    cancelled: Object.freeze(['rerun', 'archive']),
    archived: Object.freeze(['view']),
});

/**
 * 合法迁移表。键 = from，值 = { to: 迁移时记录的 TaskEvent 类型 }。
 *
 * 设计决策 D-M3-1（人工确认的语义）：
 *   PRD §6「用户确认后触发后续执行或完成」。当前平台的确认节点位于
 *   Workflow 成功返回之后（人对 AI 结果把关，而非执行中途打断），
 *   因此 M3 取「确认 → 完成（succeeded）」：
 *     - confirm  : waiting_confirmation → succeeded（采纳结果）
 *     - reject   : waiting_confirmation → cancelled（驳回即放弃本次结果，
 *                  原因强制记录 TaskEvent；用户可 rerun 再次执行）
 *   若后续出现「执行中途确认」类技能（如外部写入前确认），
 *   再引入 waiting_confirmation → running 分支，不改本表已有键值。
 */
const TRANSITIONS = {
    draft: {
        queued: 'task_submitted', // 执行草稿
    },
    queued: {
        running: 'task_started',
        cancelled: 'task_cancelled',
    },
    running: {
        waiting_confirmation: 'confirmation_requested',
        succeeded: 'task_succeeded',
        failed: 'task_failed',
        cancelled: 'task_cancelled',
    },
    waiting_confirmation: {
        succeeded: 'confirmation_accepted', // D-M3-1
        cancelled: 'confirmation_rejected', // 驳回，原因必填
    },
    failed: {
        queued: 'task_retried', // 新建 TaskRun，不覆盖旧 Run
    },
    cancelled: {
        queued: 'task_rerun', // PRD §3「已取消 → 再次执行」
    },
    succeeded: {
        archived: 'task_archived',
    },
};

/**
 * 是否允许从 from 迁移到 to。
 * @param {TaskStatus} from
 * @param {TaskStatus} to
 * @returns {boolean}
 */
export function canTransition(from, to) {
    return Boolean(TRANSITIONS[from]?.[to]);
}

/**
 * 迁移对应的 TaskEvent 类型（无迁移权限返回 null）。
 * @param {TaskStatus} from
 * @param {TaskStatus} to
 * @returns {string|null}
 */
export function transitionEvent(from, to) {
    return TRANSITIONS[from]?.[to] ?? null;
}

/** 列出某状态的所有合法去向（诊断/前端按钮态用） */
export function nextStatuses(from) {
    return Object.keys(TRANSITIONS[from] || {});
}

/**
 * 某状态下是否允许执行某操作。
 * @param {TaskStatus} status
 * @param {string} action
 */
export function can(status, action) {
    return (ALLOWED_ACTIONS[status] || []).includes(action);
}

/** 运行时防呆：非法状态值直接抛错，防止脏数据流入状态机 */
export function assertStatus(status) {
    if (!TASK_STATUSES.includes(status)) {
        throw new Error(`非法任务状态：${status}`);
    }
    return status;
}
