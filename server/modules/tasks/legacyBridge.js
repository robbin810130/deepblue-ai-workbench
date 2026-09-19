/**
 * legacyBridge —— 存量应用 → 任务中心 迁移桥（改造清单 D4 决策：先试点后铺开）
 *
 * 背景：存量 34 应用有 ~112 处散落的 Dify 直连调用，一次性全部改造风险过大。
 * 本桥提供「每技能灰度开关」：
 *   - 环境变量 TASK_CENTER_PILOT 列出纳入任务闭环的 skill_key（逗号分隔）。
 *     未列出的技能走旧直连路径，行为 100% 不变。
 *   - 试点技能的旧路由在入口处调用 runThroughTaskCenter：
 *     建任务(execute_now) → 执行 → （通知/事件/重试全套闭环）→ 把结果映射回旧响应形状。
 *
 * 兼容性裁决（写代码前定死，别临场发挥）：
 *   1. 旧路由是同步请求-响应，而试点技能多为 requires_confirmation:true ——
 *      任务会停在 waiting_confirmation。旧调用方就是请求人本人且明确要立刻拿结果，
 *      因此桥默认 autoConfirm=true：以请求人身份自动确认（闭环完整保留：任务、
 *      事件、通知都有；确认人=请求人）。
 *   2. SSE 流式接口（contract-audit / material-quote）与任务闭环的阻塞取结果模型
 *      冲突，不纳入试点 —— 待前端改为轮询任务详情后单独接入。
 *   3. 权限先行：试点路由入口同样走 evaluateSkillPermission，denied 直接 403，
 *      与 /api/v1 同口径（M6）。
 *
 * 试点清单（V2 清单 §D4）：invoice_verify、quote_verify、hazard_detection。
 */

import * as store from './taskStore.js';
import {
    createTask,
    confirmTask,
    getTaskDetail,
} from './taskService.js';
import { getSkill } from '../catalog/index.js';
import { evaluateSkillPermission } from '../permissions/evaluator.js';
import { AppError } from '../common/errors.js';

/** 终态集合（与 tasks/states.js 的八态一致；archived 只能由 succeeded 而来） */
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'archived']);

/** 试点技能开关（TASK_CENTER_PILOT=invoice_verify,quote_verify,...） */
export function isPilotSkill(skillKey) {
    const raw = process.env.TASK_CENTER_PILOT || '';
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .includes(String(skillKey));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 经任务中心执行一次技能（同步语义，供旧路由复用）。
 *
 * @param {object} p
 * @param {string} p.skillKey      技能 key（必须存在于 catalog）
 * @param {string} [p.title]       任务标题（缺省用技能名）
 * @param {object} p.user          JWT 载荷（{id, username, role}，id 必须为数字）
 * @param {object} [p.inputs]      技能输入（按该技能绑定的 Dify 变量名构造）
 * @param {string[]} [p.files]     暂存文件 file_id 列表（可选）
 * @param {boolean} [p.autoConfirm=true] waiting_confirmation 时以请求人身份自动确认
 * @param {number} [p.timeoutMs=600000]  轮询超时（默认 10 分钟，对齐绑定 timeout 上限）
 * @returns {Promise<{ok:boolean, status:string, taskId:string, taskNo:string,
 *   outputs:*, summary:string|null, errorCode:string|null, message:string|null}>}
 * @throws AppError RESOURCE_NOT_FOUND / FORBIDDEN / PROVIDER_TIMEOUT
 */
export async function runThroughTaskCenter({
    skillKey,
    title,
    user,
    inputs = {},
    files = [],
    autoConfirm = true,
    timeoutMs = 600000,
    pollMs = 500,
}) {
    const skill = getSkill(skillKey);
    if (!skill) {
        throw new AppError('RESOURCE_NOT_FOUND', `技能不存在：${skillKey}`, { http_status: 404 });
    }

    // 权限先行（M6 三段判定）：denied 拦下；not_evaluated 放行（与 /api/v1 一致，
    // 访问控制由任务归属保证）
    const perm = await evaluateSkillPermission(skill, user);
    if (perm.status === 'denied') {
        throw new AppError('FORBIDDEN', `无权使用技能「${skill.name}」：${perm.reason}`, {
            http_status: 403,
        });
    }

    // 建任务即执行（blocking 技能在 createTask 内同步跑完；async 技能靠下方轮询收口）
    const task = await createTask({
        skill_key: skillKey,
        title: title || `${skill.name}（存量路由）`,
        inputs,
        files,
        execute_now: true,
        user,
        assigned_to: null,
    });

    const deadline = Date.now() + timeoutMs;
    let row = await store.getTaskById(task.id);
    let detail = null;

    while (Date.now() < deadline) {
        if (row.status === 'waiting_confirmation' && autoConfirm) {
            await confirmTask(row, user);
        }
        if (TERMINAL_STATUSES.has(row.status)) break;
        await sleep(pollMs);
        row = await store.getTaskById(task.id);
    }
    if (!TERMINAL_STATUSES.has(row.status)) {
        throw new AppError('PROVIDER_TIMEOUT', `任务 ${row.task_no} 执行超时（${timeoutMs}ms）`, {
            http_status: 504,
        });
    }

    detail = await getTaskDetail(row, user);
    const lastRun = detail.runs?.at(-1) || null;
    const outputs = detail.task.result ?? lastRun?.result ?? null;

    const ok = row.status === 'succeeded';
    return {
        ok,
        status: row.status,
        taskId: row.id,
        taskNo: row.task_no,
        outputs,
        summary: detail.task.summary ?? null,
        errorCode: ok ? null : lastRun?.error_code ?? null,
        message: ok
            ? null
            : lastRun?.error?.message || lastRun?.error || `任务终态 ${row.status}`,
    };
}

/**
 * 从归一化输出中提取文本（对齐旧路由的 outputs.text / .result / .output / 首键 逐级回落）。
 * 供 quote_verify 等纯文本型试点路由复用。
 */
export function extractAnswerText(rawOutputs) {
    const raw = rawOutputs && typeof rawOutputs === 'object' ? rawOutputs : {};
    if (raw.text !== undefined) {
        return typeof raw.text === 'object' ? JSON.stringify(raw.text, null, 2) : String(raw.text);
    }
    if (raw.result !== undefined) {
        return typeof raw.result === 'object'
            ? JSON.stringify(raw.result, null, 2)
            : String(raw.result);
    }
    if (raw.output !== undefined) {
        return typeof raw.output === 'object'
            ? JSON.stringify(raw.output, null, 2)
            : String(raw.output);
    }
    const values = Object.values(raw);
    if (values.length === 0) return '';
    const first = values[0];
    return typeof first === 'object' ? JSON.stringify(first, null, 2) : String(first);
}

/** 过滤思考标签并规范换行（旧路由的既有行为，原样保留） */
export function stripThinkTags(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/<think>[\s\S]*?<\/think>(\\n|\s)*/gi, '')
        .trim()
        .replace(/\\n/g, '\n');
}
