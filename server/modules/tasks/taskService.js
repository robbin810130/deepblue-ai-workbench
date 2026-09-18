/**
 * 任务编排服务 —— 把一次 AI 调用升级为可追踪的业务任务（PRD §1）
 *
 * 职责边界：
 *   - 状态合法性判断 → states.js（唯一权威，这里不出现裸字符串比较）
 *   - 数据读写     → taskStore.js
 *   - AI 执行     → providers 模块的 runSkill()（全平台唯一出口）
 *   - 本文件只做编排：迁移状态机、落事件、驱动 Provider、处置结果
 *
 * 执行模型（M3 决策 D-M3-2）：
 *   - execution_mode = async   → HTTP 立即返回（任务停在 running），后台执行完落库
 *   - execution_mode = blocking → 请求内等待 Provider 返回后落库再响应
 *   两种模式共用 _driveRun()，区别只是调用方是否 await。
 */

import { getSkill } from '../catalog/index.js';
import { runSkill, resolveBinding } from '../providers/index.js';
import { newTraceId } from '../providers/difyClient.js';
import { cancelRun } from '../providers/difyProvider.js';
import {
    can as canAction,
    canTransition,
    transitionEvent,
} from './states.js';
import * as store from './taskStore.js';
import pool from '../../db.js';

/** 事件里的操作者描述 */
function actorOf(user) {
    return user?.username || user?.name || String(user?.id ?? 'system');
}

/** 访问控制（PRD §12 验收 5：非本人任务 403/不可见） */
export function canAccess(task, user) {
    if (!task || !user) return false;
    if (user.role === 'admin') return true;
    return task.created_by === user.id || task.assigned_to === user.id;
}

function assertAccess(task, user) {
    if (!canAccess(task, user)) {
        const err = new Error('无权访问该任务');
        err.code = 'FORBIDDEN';
        err.http_status = 403;
        throw err;
    }
}

/** 状态迁移 + 事件落库（所有迁移的唯一通道） */
async function transition(task, toStatus, { runId = null, actor = 'system', detail = null, ...fields } = {}) {
    const fromStatus = task.status;
    if (!canTransition(fromStatus, toStatus)) {
        const err = new Error(`任务不允许从「${fromStatus}」迁移到「${toStatus}」`);
        err.code = 'VALIDATION_FAILED';
        err.http_status = 422;
        throw err;
    }
    const eventType = transitionEvent(fromStatus, toStatus);
    const updated = await store.updateTaskStatus(task.id, { status: toStatus, ...fields });
    await store.appendEvent(task.id, {
        run_id: runId,
        event_type: eventType || `to_${toStatus}`,
        from_status: fromStatus,
        to_status: toStatus,
        actor: actorOf(actor),
        detail,
    });
    return updated;
}

// ─────────────────────────────────────────────────────────────
// 创建与执行
// ─────────────────────────────────────────────────────────────

/**
 * 创建任务。
 * @param {object} p
 * @param {string} p.skill_key
 * @param {string} [p.title]
 * @param {object} [p.inputs]
 * @param {Array}  [p.files]
 * @param {boolean} [p.execute_now] true = 创建后立即执行（跳过草稿）
 * @param {{id:number,username?:string,name?:string,role?:string}} p.user
 * @param {number} [p.assigned_to]
 */
export async function createTask({ skill_key, title, inputs = {}, files = [], execute_now = false, user, assigned_to = null }) {
    const skill = getSkill(skill_key);
    if (!skill || skill.live === false) {
        const err = new Error(`技能不可用：${skill_key}`);
        err.code = 'RESOURCE_NOT_FOUND';
        err.http_status = 404;
        throw err;
    }
    // 内部实现类技能不经任务中心（PRD：任何「可执行技能」才落任务）
    if (skill.binding_key === 'internal') {
        const err = new Error(`技能「${skill.name}」为平台内部功能，不经任务中心执行`);
        err.code = 'VALIDATION_FAILED';
        err.http_status = 422;
        throw err;
    }

    const task = await store.insertTask({
        title: (title && String(title).trim()) || skill.name,
        skill_key: skill.skill_key,
        scene: skill.scene,
        status: execute_now ? 'queued' : 'draft',
        input: { inputs, files: (files || []).map(({ buffer, ...meta }) => meta) }, // 文件内容不落库
        user,
        assigned_to,
        trace_id: newTraceId(),
    });
    await store.appendEvent(task.id, {
        event_type: execute_now ? 'task_created_and_submitted' : 'task_created',
        to_status: task.status,
        actor: actorOf(user),
    });

    if (execute_now) {
        return executeTask(task, user, { inputs, files });
    }
    return task;
}

/**
 * 执行任务（draft → queued → running → …）。
 * async 技能返回 running 中的任务；blocking 技能等待最终状态。
 * @param {object} task 任务行
 * @param {object} user 操作者
 * @param {{inputs?:object, files?:Array, original?:object}} [patch] execute_now 场景下带入的原始输入
 */
export async function executeTask(task, user, patch = {}) {
    assertAccess(task, user);
    if (!canAction(task.status, 'execute')) {
        const err = new Error(`当前状态（${task.status}）不允许执行`);
        err.code = 'VALIDATION_FAILED';
        err.http_status = 422;
        throw err;
    }

    const skill = getSkill(task.skill_key);
    const inputs = patch.inputs ?? task.input?.inputs ?? {};
    const files = patch.files ?? task.input?.files ?? [];
    const traceId = task.trace_id || newTraceId();

    // draft → queued（直接提交时 createTask 已置 queued，这里跳过）
    let current = task;
    if (current.status === 'draft') {
        current = await transition(current, 'queued', { actor: user });
    }
    return _driveRun(current, skill, { inputs, files, traceId, actor: user, awaitResult: skill.execution_mode === 'blocking' });
}

/**
 * 执行核心：queued → running → Provider → 终态。
 * 单独抽出以便 executeTask / retryTask 复用（PRD §7 重试语义）。
 */
async function _driveRun(task, skill, { inputs, files, traceId, actor, awaitResult }) {
    const bindingResolved = _resolveProviderMeta(skill);
    // 排队 → 运行
    let current = await transition(task, 'running', { actor });
    const run = await store.insertRun(current.id, {
        provider: bindingResolved.provider,
        binding_key: bindingResolved.binding_key,
    });

    const exec = (async () => {
        try {
            const output = await runSkill(
                skill.skill_key,
                {
                    task_id: current.id,
                    user: { id: String(actor?.id ?? actor?.username ?? 'system'), name: actor?.username || actor?.name },
                    inputs,
                    files,
                    context: { trace_id: traceId },
                },
            );
            await store.finishRun(run.id, {
                status: output.status || 'succeeded',
                duration_ms: output.metrics?.duration_ms ?? null,
                workflow_run_id: output.metrics?.workflow_run_id ?? null,
            });

            // 人工确认把关（PRD §6）：技能要求确认时，结果先挂起
            if (skill.requires_confirmation === true && (output.status || 'succeeded') === 'succeeded') {
                current = await store.getTaskById(current.id);
                current = await transition(current, 'waiting_confirmation', {
                    runId: run.id,
                    actor,
                    result: output.data,
                    summary: output.summary ?? null,
                    detail: { note: '技能要求人工确认后交付', run_id: run.id },
                });
                // ⚠️ PRD §8：此处应同时创建 TodoItem + 发通知（M4 通知层接入点）
                return current;
            }

            current = await store.getTaskById(current.id);
            return transition(current, 'succeeded', {
                runId: run.id,
                actor,
                result: output.data,
                summary: output.summary ?? null,
                detail: { run_id: run.id, duration_ms: output.metrics?.duration_ms ?? null },
            });
        } catch (e) {
            await store.finishRun(run.id, {
                status: 'failed',
                error: { code: e.code || 'PROVIDER_ERROR', message: e.message, trace_id: e.trace_id || traceId },
            });
            current = await store.getTaskById(current.id);
            // running → failed（PRD §2 异常分支）
            return transition(current, 'failed', {
                runId: run.id,
                actor,
                error_code: e.code || 'PROVIDER_ERROR',
                error_message: e.message,
                detail: { trace_id: e.trace_id || traceId, binding_key: e.binding_key ?? null },
            });
        }
    })();

    if (awaitResult) return exec;
    // async：兜底捕获，防止未处理 rejection 把进程带崩
    exec.catch((e) => console.error('[tasks] async 执行异常（任务侧已兜底）', e));
    return store.getTaskById(current.id);
}

/** 解析绑定元信息（仅用于 TaskRun 登记；解析失败不阻断 —— 留给 runSkill 明确报错） */
function _resolveProviderMeta(skill) {
    try {
        const resolved = resolveBinding(skill.binding_key);
        return {
            provider: resolved.ok ? resolved.config.provider : 'unknown',
            binding_key: skill.binding_key,
        };
    } catch {
        return { provider: 'unknown', binding_key: skill.binding_key };
    }
}

// ─────────────────────────────────────────────────────────────
// 过程操作
// ─────────────────────────────────────────────────────────────

/** 取消（queued/running → cancelled）。running 时尽力通知 Provider 停止。 */
export async function cancelTask(task, user, { reason } = {}) {
    assertAccess(task, user);
    if (!canAction(task.status, 'cancel')) {
        const err = new Error(`当前状态（${task.status}）不允许取消`);
        err.code = 'VALIDATION_FAILED';
        err.http_status = 422;
        throw err;
    }
    const updated = await transition(task, 'cancelled', {
        actor: user,
        detail: reason ? { reason } : null,
    });

    // 运行中任务的 Provider 侧尽力停止（失败不影响本地状态 —— 本地取消已生效）
    if (task.status === 'running') {
        _tryProviderStop(task, user).catch(() => { /* 尽力而为 */ });
    }
    return updated;
}

async function _tryProviderStop(task, user) {
    try {
        const runs = await store.listRuns(task.id);
        const active = runs.find((r) => r.workflow_run_id);
        if (!active) return;
        const skill = getSkill(task.skill_key);
        const resolved = resolveBinding(skill?.binding_key);
        if (!resolved.ok) return;
        const { cancelRun } = await import('../providers/difyProvider.js');
        await cancelRun(resolved.config, active.workflow_run_id, String(user?.id ?? 'system'), { trace_id: task.trace_id });
        await store.appendEvent(task.id, {
            run_id: active.id,
            event_type: 'provider_stop_requested',
            actor: actorOf(user),
            detail: { workflow_run_id: active.workflow_run_id },
        });
    } catch (e) {
        await store.appendEvent(task.id, {
            event_type: 'provider_stop_failed',
            actor: actorOf(user),
            detail: { message: e.message },
        });
    }
}

/** 确认（waiting_confirmation → succeeded，决策 D-M3-1） */
export async function confirmTask(task, user) {
    assertAccess(task, user);
    if (!canAction(task.status, 'confirm')) {
        const err = new Error(`当前状态（${task.status}）不允许确认`);
        err.code = 'VALIDATION_FAILED';
        err.http_status = 422;
        throw err;
    }
    return transition(task, 'succeeded', { actor: user, detail: { confirmed_by: actorOf(user) } });
}

/** 驳回（waiting_confirmation → cancelled）。原因必填并形成 TaskEvent（PRD §6）。 */
export async function rejectTask(task, user, { reason }) {
    assertAccess(task, user);
    if (!canAction(task.status, 'reject')) {
        const err = new Error(`当前状态（${task.status}）不允许驳回`);
        err.code = 'VALIDATION_FAILED';
        err.http_status = 422;
        throw err;
    }
    if (!reason || !String(reason).trim()) {
        const err = new Error('驳回必须填写原因');
        err.code = 'VALIDATION_FAILED';
        err.http_status = 422;
        throw err;
    }
    return transition(task, 'cancelled', {
        actor: user,
        detail: { reason: String(reason).trim(), rejected: true },
    });
}

/**
 * 重试 / 再次执行（failed|cancelled → queued，新建 TaskRun 不覆盖旧 Run，PRD §7）。
 * 修改输入重试时传 inputs，将以「修改后重新执行」标记事件。
 */
export async function retryTask(task, user, { inputs } = {}) {
    assertAccess(task, user);
    if (!(task.status === 'failed' || task.status === 'cancelled')) {
        const err = new Error(`当前状态（${task.status}）不允许重试，仅失败/已取消可重试`);
        err.code = 'VALIDATION_FAILED';
        err.http_status = 422;
        throw err;
    }
    const modified = Boolean(inputs && Object.keys(inputs).length);
    if (modified) {
        const { rows } = await pool.query(
            'UPDATE tasks SET input = $2::jsonb, updated_at = NOW() WHERE id = $1 RETURNING *',
            [task.id, JSON.stringify({ ...task.input, inputs })],
        );
        task = rows[0];
    }
    const queued = await transition(task, 'queued', {
        actor: user,
        detail: modified ? { modified: true, note: '修改后重新执行' } : { reused_input: true },
    });
    const skill = getSkill(task.skill_key);
    const latest = task.input?.inputs ?? {};
    return _driveRun(queued, skill, {
        inputs: modified ? inputs : latest,
        files: task.input?.files ?? [],
        traceId: task.trace_id || newTraceId(),
        actor: user,
        awaitResult: skill.execution_mode === 'blocking',
    });
}

/** 再次执行（succeeded/cancelled → 复制为新任务，PRD §3「再次执行」） */
export async function rerunTask(task, user, { execute_now = false } = {}) {
    assertAccess(task, user);
    if (!canAction(task.status, 'rerun')) {
        const err = new Error(`当前状态（${task.status}）不允许再次执行`);
        err.code = 'VALIDATION_FAILED';
        err.http_status = 422;
        throw err;
    }
    const fresh = await store.cloneTask(task, { user });
    await store.appendEvent(fresh.id, {
        event_type: 'task_cloned_from',
        to_status: 'draft',
        actor: actorOf(user),
        detail: { source_task_id: task.id, source_task_no: task.task_no },
    });
    if (!execute_now) return fresh;
    return executeTask(fresh, user);
}

/** 归档（succeeded/failed/cancelled → archived） */
export async function archiveTask(task, user) {
    assertAccess(task, user);
    if (!canAction(task.status, 'archive')) {
        const err = new Error(`当前状态（${task.status}）不允许归档`);
        err.code = 'VALIDATION_FAILED';
        err.http_status = 422;
        throw err;
    }
    return transition(task, 'archived', { actor: user });
}

/** 编辑草稿（仅 draft：标题/输入） */
export async function editDraftTask(task, user, { title, inputs }) {
    assertAccess(task, user);
    if (!canAction(task.status, 'edit')) {
        const err = new Error('仅草稿任务可编辑');
        err.code = 'VALIDATION_FAILED';
        err.http_status = 422;
        throw err;
    }
    const { rows } = await pool.query(
        `UPDATE tasks SET
            title = COALESCE($2, title),
            input = COALESCE($3::jsonb, input),
            updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [task.id, title ?? null, inputs !== undefined ? JSON.stringify({ ...task.input, inputs }) : null],
    );
    await store.appendEvent(task.id, {
        event_type: 'task_edited',
        actor: actorOf(user),
        detail: { fields: [title !== undefined && 'title', inputs !== undefined && 'inputs'].filter(Boolean) },
    });
    return rows[0];
}

/** 删除草稿（仅 draft，物理删除） */
export async function deleteDraftTask(task, user) {
    assertAccess(task, user);
    if (!canAction(task.status, 'delete')) {
        const err = new Error('仅草稿任务可删除');
        err.code = 'VALIDATION_FAILED';
        err.http_status = 422;
        throw err;
    }
    return store.deleteDraftTask(task.id);
}

/** 详情聚合：任务 + Run 记录 + 事件时间线 + 产物登记 */
export async function getTaskDetail(task, user) {
    assertAccess(task, user);
    const [runs, events, artifacts] = await Promise.all([
        store.listRuns(task.id),
        store.listEvents(task.id),
        store.listArtifacts(task.id),
    ]);
    return { task, runs, events, artifacts };
}
