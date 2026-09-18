/**
 * /api/v1/tasks —— 任务中心接口（文档 05_任务中心详细PRD）
 *
 * 路由层职责：参数解析、鉴权与访问控制、调用 taskService、翻译错误。
 * 任何业务判断（状态机/权限/编排）都不在这里 —— 在 tasks 模块内。
 *
 * 挂载：server.js `app.use('/api/v1', ...)` 在全局 authenticateToken 之后，
 *      所有接口天然要求登录；user 由 req.user（JWT 载荷）提供。
 */

import express from 'express';
import pool from '../../db.js';
import * as store from '../../modules/tasks/taskStore.js';
import * as service from '../../modules/tasks/taskService.js';
import { sendOk, sendFail, asyncHandler, startTimer } from '../../modules/common/apiResponse.js';
import { AppError, ERROR_CODES } from '../../modules/common/errors.js';
import { STATUS_LABELS } from '../../modules/tasks/states.js';

const router = express.Router();

// 启动期建表（幂等，沿用平台 dashboardRoutes 的自建模式）
store.ensureTasksTables().catch((err) => console.error('[Tasks DDL] 任务表初始化失败:', err.message));

// 链路追踪（与 catalogRoutes 一致）
router.use((req, _res, next) => {
    if (!req.trace_id) req.trace_id = `t-task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    next();
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 取任务并做访问控制；不存在按 RESOURCE_NOT_FOUND，越权按 FORBIDDEN */
async function loadTaskFor(req, id) {
    if (!UUID_RE.test(String(id))) throw new AppError('RESOURCE_NOT_FOUND', '任务不存在或不可见');
    const task = await store.getTaskById(id);
    if (!task) throw new AppError('RESOURCE_NOT_FOUND', '任务不存在或不可见');
    if (!service.canAccess(task, req.user)) throw new AppError('FORBIDDEN', '无权访问该任务');
    return task;
}

/** 统一把 service 抛出的业务错误翻译为标准错误体（保留原错误码语义） */
function fail(res, err, traceId) {
    if (err instanceof AppError) return sendFail(res, err, { trace_id: traceId });
    const code = err?.code && ERROR_CODES[err.code] ? err.code : 'VALIDATION_FAILED';
    return sendFail(res, new AppError(code, err.message), { trace_id: traceId });
}

// ─────────────────────────────────────────────────────────────
// 查询
// ─────────────────────────────────────────────────────────────

/**
 * GET /api/v1/tasks
 * 筛选：status / scene / skill / since / until；搜索：q（标题、任务编号）—— PRD §4
 */
router.get(
    '/tasks',
    asyncHandler(async (req, res) => {
        const elapsed = startTimer();
        const { status, scene, skill, since, until, q, limit, offset } = req.query;
        const tasks = await store.listTasks({
            userId: req.user.id,
            isAdmin: req.user.role === 'admin',
            status: status ? String(status) : undefined,
            scene: scene ? String(scene) : undefined,
            skill: skill ? String(skill) : undefined,
            since: since ? new Date(String(since)) : undefined,
            until: until ? new Date(String(until)) : undefined,
            q: q ? String(q) : undefined,
            limit: limit ? Number(limit) : 20,
            offset: offset ? Number(offset) : 0,
        });
        return sendOk(res, tasks.map(toListItem), {
            trace_id: req.trace_id,
            meta: { request_time_ms: elapsed(), total: tasks.length },
        });
    }),
);

/** 列表只放必要字段（PRD §4：避免堆叠输入摘要） */
function toListItem(t) {
    return {
        id: t.id,
        task_no: t.task_no,
        title: t.title,
        skill_key: t.skill_key,
        scene: t.scene,
        status: t.status,
        status_label: STATUS_LABELS[t.status] || t.status,
        run_count: t.run_count,
        created_by: t.created_by,
        created_by_name: t.created_by_name,
        created_at: t.created_at,
        updated_at: t.updated_at,
        summary: t.summary,
    };
}

/**
 * GET /api/v1/tasks/metrics —— 任务指标（PRD §11）
 * 定义：完成率 = succeeded/已结束；失败率 = failed/已结束；
 *      人工确认率 = 进入过 waiting_confirmation 的任务占比；平均耗时 = succeeded 的 completed-started。
 * ⚠️ 必须注册在 /tasks/:id 之前，否则 "metrics" 会被当作任务 ID 捕获。
 */
router.get(
    '/tasks/metrics',
    asyncHandler(async (req, res) => {
        const elapsed = startTimer();
        const scoped = req.user.role === 'admin' ? '' : 'WHERE created_by = $1';
        const params = req.user.role === 'admin' ? [] : [req.user.id];
        const q = async (sql) => (await pool.query(sql, params)).rows[0] || {};

        const totals = await q(`
            SELECT COUNT(*)::int AS created,
                   COUNT(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
                   COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
                   COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
                   COUNT(*) FILTER (WHERE status IN ('queued','running'))::int AS in_flight,
                   COUNT(*) FILTER (WHERE status = 'waiting_confirmation')::int AS waiting,
                   COUNT(*) FILTER (WHERE status = 'draft')::int AS drafts,
                   AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))
                       FILTER (WHERE status = 'succeeded' AND started_at IS NOT NULL AND completed_at IS NOT NULL) AS avg_success_seconds
            FROM tasks ${scoped}
        `);
        const confirmRows = await pool.query(`
            SELECT COUNT(DISTINCT e.task_id)::int AS n
            FROM task_events e ${scoped ? 'JOIN tasks t ON t.id = e.task_id AND t.created_by = $1' : ''}
            WHERE e.event_type = 'confirmation_requested'
        `, params);
        const byScene = (await pool.query(`
            SELECT scene, COUNT(*)::int AS n FROM tasks ${scoped} GROUP BY scene ORDER BY n DESC
        `, params)).rows;
        const byDay = (await pool.query(`
            SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS n
            FROM tasks ${scoped ? scoped.replace('WHERE', 'WHERE') + ' AND' : 'WHERE'} created_at > NOW() - INTERVAL '14 days'
            GROUP BY 1 ORDER BY 1
        `, params)).rows;

        const ended = (totals.succeeded || 0) + (totals.failed || 0) + (totals.cancelled || 0);
        return sendOk(res, {
            created: totals.created || 0,
            by_status: {
                draft: totals.drafts || 0,
                queued_running: totals.in_flight || 0,
                waiting_confirmation: totals.waiting || 0,
                succeeded: totals.succeeded || 0,
                failed: totals.failed || 0,
                cancelled: totals.cancelled || 0,
            },
            success_rate: ended ? Number(((totals.succeeded || 0) / ended).toFixed(4)) : null,
            failure_rate: ended ? Number(((totals.failed || 0) / ended).toFixed(4)) : null,
            confirmation_rate: totals.created ? Number(((confirmRows.rows[0]?.n || 0) / totals.created).toFixed(4)) : null,
            avg_success_seconds: totals.avg_success_seconds ? Number(Number(totals.avg_success_seconds).toFixed(1)) : null,
            by_scene: Object.fromEntries(byScene.map((r) => [r.scene, r.n])),
            by_day: Object.fromEntries(byDay.map((r) => [r.day, r.n])),
        }, { trace_id: req.trace_id, meta: { request_time_ms: elapsed() } });
    }),
);

/** GET /api/v1/tasks/:id —— 详情（含 Run 记录、事件时间线、产物，PRD §5） */
router.get(
    '/tasks/:id',
    asyncHandler(async (req, res) => {
        const elapsed = startTimer();
        const task = await loadTaskFor(req, req.params.id);
        const detail = await service.getTaskDetail(task, req.user);
        return sendOk(res, { ...detail, task: { ...detail.task, status_label: STATUS_LABELS[detail.task.status] } }, {
            trace_id: req.trace_id,
            meta: { request_time_ms: elapsed() },
        });
    }),
);

// ─────────────────────────────────────────────────────────────
// 创建与生命周期操作
// ─────────────────────────────────────────────────────────────

/** POST /api/v1/tasks  body: { skill_key, title?, inputs?, execute_now? } */
router.post(
    '/tasks',
    asyncHandler(async (req, res) => {
        const elapsed = startTimer();
        const { skill_key, title, inputs, execute_now } = req.body || {};
        if (!skill_key) {
            return fail(res, new AppError('VALIDATION_FAILED', '缺少 skill_key'), req.trace_id);
        }
        try {
            const task = await service.createTask({
                skill_key: String(skill_key),
                title: title ? String(title) : undefined,
                inputs: inputs || {},
                files: Array.isArray(req.body?.files) ? req.body.files : [],
                execute_now: execute_now === true,
                user: req.user,
                assigned_to: req.body?.assigned_to ?? null,
            });
            return sendOk(res, task, { trace_id: req.trace_id, meta: { request_time_ms: elapsed() } });
        } catch (e) {
            return fail(res, e, req.trace_id);
        }
    }),
);

/** POST /api/v1/tasks/:id/execute —— 草稿执行 */
router.post(
    '/tasks/:id/execute',
    asyncHandler(async (req, res) => {
        const task = await loadTaskFor(req, req.params.id);
        try {
            const updated = await service.executeTask(task, req.user, {
                inputs: req.body?.inputs,
                files: Array.isArray(req.body?.files) ? req.body.files : [],
            });
            return sendOk(res, updated, { trace_id: req.trace_id });
        } catch (e) {
            return fail(res, e, req.trace_id);
        }
    }),
);

/** POST /api/v1/tasks/:id/cancel  body: { reason? } */
router.post(
    '/tasks/:id/cancel',
    asyncHandler(async (req, res) => {
        const task = await loadTaskFor(req, req.params.id);
        try {
            return sendOk(res, await service.cancelTask(task, req.user, { reason: req.body?.reason }), { trace_id: req.trace_id });
        } catch (e) {
            return fail(res, e, req.trace_id);
        }
    }),
);

/** POST /api/v1/tasks/:id/confirm —— 人工确认采纳结果（D-M3-1 → succeeded） */
router.post(
    '/tasks/:id/confirm',
    asyncHandler(async (req, res) => {
        const task = await loadTaskFor(req, req.params.id);
        try {
            return sendOk(res, await service.confirmTask(task, req.user), { trace_id: req.trace_id });
        } catch (e) {
            return fail(res, e, req.trace_id);
        }
    }),
);

/** POST /api/v1/tasks/:id/reject  body: { reason }（原因必填，PRD §6） */
router.post(
    '/tasks/:id/reject',
    asyncHandler(async (req, res) => {
        const task = await loadTaskFor(req, req.params.id);
        try {
            return sendOk(res, await service.rejectTask(task, req.user, { reason: req.body?.reason }), { trace_id: req.trace_id });
        } catch (e) {
            return fail(res, e, req.trace_id);
        }
    }),
);

/** POST /api/v1/tasks/:id/retry  body: { inputs? }（修改输入重试将打标记，PRD §7） */
router.post(
    '/tasks/:id/retry',
    asyncHandler(async (req, res) => {
        const task = await loadTaskFor(req, req.params.id);
        try {
            return sendOk(res, await service.retryTask(task, req.user, { inputs: req.body?.inputs }), { trace_id: req.trace_id });
        } catch (e) {
            return fail(res, e, req.trace_id);
        }
    }),
);

/** POST /api/v1/tasks/:id/rerun —— 再次执行：复制为新任务 */
router.post(
    '/tasks/:id/rerun',
    asyncHandler(async (req, res) => {
        const task = await loadTaskFor(req, req.params.id);
        try {
            return sendOk(res, await service.rerunTask(task, req.user, { execute_now: req.body?.execute_now === true }), { trace_id: req.trace_id });
        } catch (e) {
            return fail(res, e, req.trace_id);
        }
    }),
);

/** POST /api/v1/tasks/:id/archive */
router.post(
    '/tasks/:id/archive',
    asyncHandler(async (req, res) => {
        const task = await loadTaskFor(req, req.params.id);
        try {
            return sendOk(res, await service.archiveTask(task, req.user), { trace_id: req.trace_id });
        } catch (e) {
            return fail(res, e, req.trace_id);
        }
    }),
);

/** PATCH /api/v1/tasks/:id —— 编辑草稿 */
router.patch(
    '/tasks/:id',
    asyncHandler(async (req, res) => {
        const task = await loadTaskFor(req, req.params.id);
        try {
            return sendOk(res, await service.editDraftTask(task, req.user, { title: req.body?.title, inputs: req.body?.inputs }), { trace_id: req.trace_id });
        } catch (e) {
            return fail(res, e, req.trace_id);
        }
    }),
);

/** DELETE /api/v1/tasks/:id —— 仅草稿 */
router.delete(
    '/tasks/:id',
    asyncHandler(async (req, res) => {
        const task = await loadTaskFor(req, req.params.id);
        try {
            const deleted = await service.deleteDraftTask(task, req.user);
            return sendOk(res, { deleted }, { trace_id: req.trace_id });
        } catch (e) {
            return fail(res, e, req.trace_id);
        }
    }),
);

export default router;
