/**
 * /api/v1/chat —— 通用对话式技能接口（对话式交互改造 P0 + P1）
 *
 * 背景：技能「填表单 → 创建任务」的交互被裁决为不可接受，改为对话式。
 *      按技能的 endpoint_kind 分两种会话模式（chat_sessions.mode）：
 *
 *   mode='chat'（chatflow/advanced-chat 技能）
 *      直连 Dify /chat-messages，SSE 流式，conversation_id 维系多轮上下文。
 *
 *   mode='slot'（workflow 类技能，P1 新增）
 *      workflow 没有对话入口，但它的 input_schema 天然就是「待填槽位清单」。
 *      本路由把参数收集变成对话：
 *        用户说话 → modules/chat/slotExtractor 提取参数 → 缺什么问什么
 *        → 齐了给确认卡片 → POST .../execute 真正驱动 workflow
 *        → 结果以卡片消息回到对话里。
 *      参数收集**不走 Dify**，Dify 只在最后执行那一次被调用。
 *
 * 设计要点：
 *   1. 会话与消息落库 chat_sessions / chat_messages（server.js ddl#55~63），
 *      slot_state 记录已收集参数与上一轮追问顺序，刷新可恢复。
 *   2. Dify 调用一律走 modules/providers/difyClient.js（文档 04 §12 唯一出口），
 *      workflow 执行一律走 modules/tasks/taskService.js（任务中心是唯一执行体）。
 *   3. 附件沿用 /api/v1/files/upload 暂存（task_staged_files）。
 *   4. SSE 事件协议（发往前端）：
 *        data: {"event":"slot","card":{...}}             槽位状态卡（进度/缺失）
 *        data: {"event":"delta","text":"..."}           增量文本
 *        data: {"event":"done","message_id":1,...}      完成
 *        data: {"event":"error","message":"..."}        失败
 *   5. 权限：会话严格属主隔离（user_id = JWT id）。
 *
 * 鉴权：挂载在全局 authenticateToken 之后，req.user = { id, username, role, jti }。
 */

import express from 'express';
import pool from '../../db.js';
import { getSkill } from '../../modules/catalog/index.js';
import { getBinding, resolveBinding } from '../../modules/providers/bindings.js';
import { getChatInputs } from '../../modules/providers/chatInputs.js';
import { streamChat, uploadFile, newTraceId, submitHumanInput, fetchConversationMessages } from '../../modules/providers/difyClient.js';
import { inferDifyFileType } from '../../modules/providers/difyProvider.js';
import { loadStagedBuffers } from '../../modules/files/fileStore.js';
import { createTask, executeTask, getTaskDetail } from '../../modules/tasks/taskService.js';
import { getTaskById } from '../../modules/tasks/taskStore.js';
import {
    buildSlotPlan,
    slotStatus,
    mergeInputs,
    composeOpening,
    composeAsk,
    composeSummary,
} from '../../modules/chat/slotFilling.js';
import { extractWithFallback, extractorStatus } from '../../modules/chat/slotExtractor.js';
import { extractNamesFromFile, namesToSlotText } from '../../modules/chat/fileTextAdapter.js';
import { buildResultCard, buildSlotCard } from '../../modules/chat/resultCard.js';
import { sendOk, sendFail, asyncHandler, startTimer, resolveTraceId } from '../../modules/common/apiResponse.js';
import { AppError } from '../../modules/common/errors.js';
import { logger } from '../../infra/logger.js';

const router = express.Router();

/** workflow 执行可能跑很久（review_partner/bid_assistant 超时 300s），
 *  因此 execute 只负责**提交**，结果由 GET .../execution 轮询取回 —— 对代理超时免疫。 */
const SLOT_TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

router.use((req, _res, next) => {
    req.trace_id = resolveTraceId(req);
    next();
});

/** Dify 侧 end-user 标识：稳定、可追溯到平台用户 */
function difyUserOf(user) {
    return `webos-${user.username || user.id}`;
}

/**
 * 从 Dify 流事件里抽出「人工介入」信息（chatflow 的 human-in-the-loop）。
 *
 * Dify 对同一次暂停会发**两个**事件，内容等价、结构不同：
 *   · human_input_required —— data 是扁平的：{form_token, form_content, actions, node_title}
 *   · workflow_paused      —— data.reasons[] 才是内容：{TYPE:'human_input_required', form_token, ...}
 * 两者都认，按 form_token 去重（调用方负责），避免同一张表单出现两次。
 *
 * @returns {null | {kind:'human_input', form_token:string, form_content:string,
 *                   actions:Array<{id:string,title:string,button_style?:string}>, node_title:string}}
 */
function extractHumanInput(evt) {
    const d = evt?.data || {};
    const reason = Array.isArray(d.reasons)
        ? d.reasons.find((x) => x && x.TYPE === 'human_input_required')
        : null;
    const src = reason || (d.form_token ? d : null);
    if (!src || !src.form_token) return null;
    const rawActions = Array.isArray(src.actions) ? src.actions : Array.isArray(src.user_actions) ? src.user_actions : [];
    return {
        kind: 'human_input',
        form_token: String(src.form_token),
        form_content: src.form_content || '',
        node_title: src.node_title || d.node_title || '人工介入',
        actions: rawActions
            .map((a) => ({ id: a?.id, title: a?.title, button_style: a?.button_style }))
            .filter((a) => a.id),
    };
}

// ── 人工介入续跑（human-in-the-loop）──────────────────────────────────
// 提交动作后 Dify 把工作流丢给 worker **异步**跑，SSE 早已关闭，
// 唯一能拿回结果的地方是 GET /v1/messages。实测结论（2026-09-21 探针）：
//   · 一轮对话在 /v1/messages 里是**一条**记录，`extra_contents[]` 累积本轮所有表单
//     （已提交的 submitted=true，当前待填的 submitted=false）；
//   · `status` 为 paused/running 表示仍在推进，落到其它值即终态，`answer` 是最终回复；
//   · `created_at` 是 **Unix 秒**（不是 ISO 串）。
const HUMAN_POLL_INTERVAL_MS = Number(process.env.CHAT_HUMAN_POLL_INTERVAL_MS || 2500);
const HUMAN_POLL_TIMEOUT_MS = Number(process.env.CHAT_HUMAN_POLL_TIMEOUT_MS || 180000);
const HUMAN_RUNNING_STATUS = new Set(['paused', 'running']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** /v1/messages 里最新的一条会话消息（created_at 是 Unix 秒） */
function latestDifyMessage(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return null;
    return [...messages].sort((a, b) => (Number(b?.created_at) || 0) - (Number(a?.created_at) || 0))[0];
}

/**
 * 从 /v1/messages 的一条消息里挑出「待用户提交」的人工介入表单。
 *
 * @param {object|null} message
 * @param {string} excludeToken  刚提交过的 form_token（它会被标成 submitted=true，
 *                               但保险起见显式排除，避免竞态下把同一张表单再报一次）
 * @returns {null | {kind:'human_input', form_token, form_content, node_title, actions, submitted:false}}
 */
function pickPendingForm(message, excludeToken) {
    const contents = Array.isArray(message?.extra_contents) ? message.extra_contents : [];
    for (const c of [...contents].reverse()) {
        if (c?.type !== 'human_input' || c.submitted !== false) continue;
        const fd = c.form_definition || {};
        const token = fd.form_token;
        if (!token || token === excludeToken) continue;
        const rawActions = Array.isArray(fd.actions)
            ? fd.actions
            : Array.isArray(fd.user_actions)
                ? fd.user_actions
                : [];
        return {
            kind: 'human_input',
            form_token: String(token),
            form_content: fd.form_content || '',
            node_title: fd.node_title || '人工介入',
            actions: rawActions
                .map((a) => ({ id: a?.id, title: a?.title, button_style: a?.button_style }))
                .filter((a) => a.id),
            submitted: false,
        };
    }
    return null;
}

/**
 * chat 应用的「对话式入参契约」→ 槽位计划（复用 slotFilling 的 buildSlotPlan）。
 *
 * chat 应用不像普通 chatflow 可以空 inputs 直连：start 节点声明了必填变量时，
 * Dify 在 streaming 模式只发 ping、不报错也不关连接，前端干等超时。
 * 契约在 modules/providers/chatInputs.js 里按 **Dify 应用变量名** 显式声明。
 *
 * @returns {object|null} 无契约 / 无必填项 → null（保持「空 inputs 直连」旧行为）
 */
function buildChatPlan(skill, bindingKey) {
    const declared = getChatInputs(bindingKey);
    if (!declared) return null;
    const properties = {};
    const required = [];
    for (const it of declared) {
        if (!it || !it.key) continue;
        properties[it.key] = {
            type: it.type || 'string',
            title: it.title || it.key,
            ...(it.description ? { description: it.description } : {}),
            ...(it.format ? { format: it.format } : {}),
            ...(Array.isArray(it.enum) ? { enum: it.enum } : {}),
            ...(it.default !== undefined ? { default: it.default } : {}),
        };
        if (it.required) required.push(it.key);
    }
    if (required.length === 0) return null;
    return buildSlotPlan({
        skill_key: skill.skill_key,
        name: skill.name,
        summary: skill.summary,
        input_schema: { type: 'object', properties, required },
    });
}

/**
 * 技能 → 会话模式与执行配置。
 * @returns {{skill:object, mode:'chat'|'slot', config?:object, plan?:object} | {error:{code:string,message:string}}}
 */
function resolveSkillRoute(skillKey, { forChat = true } = {}) {
    const skill = getSkill(skillKey);
    if (!skill) {
        return { error: { code: 'RESOURCE_NOT_FOUND', message: `技能不存在：${skillKey}` } };
    }
    // 2026-09-20 P1-4：显式声明 conversational: false 的技能（批量数据作业 / 多文件 ETL）
    // 不支持对话式会话 —— 明确拒绝，别让用户在聊天里撞到入参错误。
    if (skill.conversational === false) {
        return {
            error: {
                code: 'CHAT_NOT_SUPPORTED',
                message: `技能「${skill.name}」属于批量/数据作业，不支持对话模式，请在技能页用表单入口提交。`,
            },
        };
    }
    const bindingKey = skill.binding_key || skillKey;
    const binding = getBinding(bindingKey);

    if (!binding || binding.provider === 'internal') {
        return { error: { code: 'CHAT_NOT_SUPPORTED', message: `技能「${skill.name}」为平台内部功能，不支持对话模式` } };
    }
    if (binding.endpoint_kind === 'none') {
        return { error: { code: 'CHAT_NOT_SUPPORTED', message: `技能「${skill.name}」暂不支持对话模式` } };
    }

    // workflow 类 → 槽位收集模式（不需要 Dify 连接配置，最后执行时才解析）
    if (binding.endpoint_kind === 'workflow') {
        return { skill, mode: 'slot', plan: buildSlotPlan(skill) };
    }

    // chat 类 → 直连对话（应用声明的必填入参由对话式收集，见 buildChatPlan）
    if (binding.provider !== 'dify') {
        return { error: { code: 'CHAT_NOT_SUPPORTED', message: `技能「${skill.name}」暂不支持对话模式` } };
    }
    const chatPlan = buildChatPlan(skill, bindingKey);
    if (!forChat) {
        return { skill, mode: 'chat', plan: chatPlan };
    }
    const r = resolveBinding(bindingKey);
    if (!r.ok) {
        return { error: { code: 'PROVIDER_NOT_READY', message: r.reason } };
    }
    return { skill, mode: 'chat', config: r.config, plan: chatPlan };
}

/** 取会话并校验属主 */
async function getOwnedSession(req, sessionId) {
    const { rows } = await pool.query('SELECT * FROM chat_sessions WHERE id = $1', [sessionId]);
    const s = rows[0];
    if (!s || s.user_id !== req.user.id) return null;
    return s;
}

/** 会话内的槽位状态（含默认值兜底） */
function slotContext(session, plan) {
    const st = session.slot_state && typeof session.slot_state === 'object' ? session.slot_state : {};
    const inputs = st.inputs && typeof st.inputs === 'object' ? st.inputs : {};
    // 未填的选填项套用 schema 默认值，避免用户对着空值确认
    for (const s of plan.slots) {
        if ((inputs[s.key] === undefined || inputs[s.key] === null || inputs[s.key] === '') && s.defaultValue !== undefined) {
            inputs[s.key] = s.defaultValue;
        }
    }
    return { inputs, lastAsk: Array.isArray(st.last_ask) ? st.last_ask : [] };
}

async function persistSlotState(sessionId, inputs, lastAsk, executor = null) {
    await pool.query(
        'UPDATE chat_sessions SET slot_state = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify({ inputs, last_ask: lastAsk, extractor: executor }), sessionId],
    );
}

// ─────────────────────────────────────────────────────────────
// 会话 CRUD
// ─────────────────────────────────────────────────────────────

/** POST /chat/sessions —— 新建会话（body: { skill_key, title? }） */
router.post(
    '/sessions',
    asyncHandler(async (req, res) => {
        const elapsed = startTimer();
        const skillKey = String(req.body?.skill_key || '').trim();
        if (!skillKey) {
            return sendFail(res, new AppError('VALIDATION_FAILED', '缺少 skill_key'), { trace_id: req.trace_id });
        }
        const r = resolveSkillRoute(skillKey);
        if (r.error) {
            return sendFail(res, new AppError(r.error.code, r.error.message), { trace_id: req.trace_id });
        }
        const title = String(req.body?.title || '新会话').slice(0, 200);
        const { rows } = await pool.query(
            'INSERT INTO chat_sessions (user_id, skill_key, title, mode, status, slot_state) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [req.user.id, skillKey, title, r.mode, r.mode === 'slot' ? 'collecting' : 'done', r.mode === 'slot' ? JSON.stringify({ inputs: {}, last_ask: [] }) : null],
        );
        const session = rows[0];

        // slot 模式：新建即给出开场引导（列出必填项），用户一进来就知道要说什么
        if (r.mode === 'slot') {
            const opening = composeOpening(r.plan);
            const card = buildSlotCard({ plan: r.plan, inputs: {}, status: slotStatus(r.plan, {}) , askKeys: opening.lastAsk });
            await pool.query(
                'INSERT INTO chat_messages (session_id, role, content, meta, trace_id) VALUES ($1, $2, $3, $4, $5)',
                [session.id, 'assistant', opening.content, JSON.stringify({ kind: 'slot_ask', card, expr: extractorStatus().mode }), req.trace_id],
            );
            await persistSlotState(session.id, {}, opening.lastAsk, null);
        }
        return sendOk(res, session, { trace_id: req.trace_id, meta: { request_time_ms: elapsed() } });
    }),
);

/** GET /chat/sessions?skill_key= —— 我的会话列表（可按技能过滤） */
router.get(
    '/sessions',
    asyncHandler(async (req, res) => {
        const elapsed = startTimer();
        const params = [req.user.id];
        let sql = 'SELECT id, user_id, skill_key, title, dify_conversation_id, mode, slot_state, task_id, status, created_at, updated_at FROM chat_sessions WHERE user_id = $1';
        if (req.query.skill_key) {
            params.push(String(req.query.skill_key));
            sql += ` AND skill_key = $${params.length}`;
        }
        sql += ' ORDER BY updated_at DESC LIMIT 100';
        const { rows } = await pool.query(sql, params);
        return sendOk(res, rows, { trace_id: req.trace_id, meta: { request_time_ms: elapsed(), total: rows.length } });
    }),
);

/** GET /chat/sessions/:id/messages —— 会话历史消息 */
router.get(
    '/sessions/:id/messages',
    asyncHandler(async (req, res) => {
        const elapsed = startTimer();
        const session = await getOwnedSession(req, req.params.id);
        if (!session) {
            return sendFail(res, new AppError('RESOURCE_NOT_FOUND', '会话不存在'), { trace_id: req.trace_id });
        }
        const { rows } = await pool.query(
            'SELECT id, session_id, role, content, files, meta, trace_id, created_at FROM chat_messages WHERE session_id = $1 ORDER BY id ASC LIMIT 500',
            [session.id],
        );
        return sendOk(res, { session, messages: rows }, { trace_id: req.trace_id, meta: { request_time_ms: elapsed() } });
    }),
);

/** PATCH /chat/sessions/:id —— 改名（body: { title }） */
router.patch(
    '/sessions/:id',
    asyncHandler(async (req, res) => {
        const elapsed = startTimer();
        const session = await getOwnedSession(req, req.params.id);
        if (!session) {
            return sendFail(res, new AppError('RESOURCE_NOT_FOUND', '会话不存在'), { trace_id: req.trace_id });
        }
        const title = String(req.body?.title || '').trim().slice(0, 200);
        if (!title) {
            return sendFail(res, new AppError('VALIDATION_FAILED', '标题不能为空'), { trace_id: req.trace_id });
        }
        const { rows } = await pool.query(
            'UPDATE chat_sessions SET title = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
            [title, session.id],
        );
        return sendOk(res, rows[0], { trace_id: req.trace_id, meta: { request_time_ms: elapsed() } });
    }),
);

/** DELETE /chat/sessions/:id —— 删除会话（消息级联删除） */
router.delete(
    '/sessions/:id',
    asyncHandler(async (req, res) => {
        const elapsed = startTimer();
        const session = await getOwnedSession(req, req.params.id);
        if (!session) {
            return sendFail(res, new AppError('RESOURCE_NOT_FOUND', '会话不存在'), { trace_id: req.trace_id });
        }
        await pool.query('DELETE FROM chat_sessions WHERE id = $1', [session.id]);
        return sendOk(res, { deleted: true }, { trace_id: req.trace_id, meta: { request_time_ms: elapsed() } });
    }),
);

// ─────────────────────────────────────────────────────────────
// 槽位模式：手动补充/修改参数（对话内迷你表单卡）
// ─────────────────────────────────────────────────────────────

/**
 * PATCH /chat/sessions/:id/slots —— body: { inputs: {...}, silent?: boolean }
 * 用户在对话里点开「一次填完」卡片时走这里；也会在对话里留一条记录保证可回溯。
 */
router.patch(
    '/sessions/:id/slots',
    asyncHandler(async (req, res) => {
        const elapsed = startTimer();
        const session = await getOwnedSession(req, req.params.id);
        if (!session) {
            return sendFail(res, new AppError('RESOURCE_NOT_FOUND', '会话不存在'), { trace_id: req.trace_id });
        }
        if (session.mode !== 'slot') {
            return sendFail(res, new AppError('VALIDATION_FAILED', '该会话不是参数收集模式'), { trace_id: req.trace_id });
        }
        const skill = getSkill(session.skill_key);
        const plan = buildSlotPlan(skill);
        const ctx = slotContext(session, plan);
        const patch = req.body?.inputs && typeof req.body.inputs === 'object' ? req.body.inputs : {};
        const merged = mergeInputs(ctx.inputs, patch);
        const status = slotStatus(plan, merged);

        await persistSlotState(session.id, merged, status.requiredMissing.map((s) => s.key));
        await pool.query(`UPDATE chat_sessions SET status = $1, updated_at = NOW() WHERE id = $2`, [
            status.ready ? 'ready' : 'collecting',
            session.id,
        ]);

        let messageId = null;
        if (!req.body?.silent) {
            const changed = Object.keys(patch).filter((k) => String(patch[k] ?? '').trim() !== '');
            const head = changed.length ? `已更新参数：${changed.map((k) => `**${plan.slots.find((s) => s.key === k)?.title || k}**`).join('、')}` : '参数已刷新';
            const content = status.ready ? `${head}\n\n${composeSummary({ plan, inputs: merged })}` : `${head}\n\n${composeAsk({ plan, inputs: merged, hits: [] }).content}`;
            const card = buildSlotCard({ plan, inputs: merged, status, askKeys: status.requiredMissing.map((s) => s.key) });
            const { rows } = await pool.query(
                'INSERT INTO chat_messages (session_id, role, content, meta, trace_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                [session.id, 'assistant', content, JSON.stringify({ kind: 'slot_ask', card, source: 'form' }), req.trace_id],
            );
            messageId = rows[0].id;
        }

        const card = buildSlotCard({ plan, inputs: merged, status, askKeys: status.requiredMissing.map((s) => s.key) });
        return sendOk(
            res,
            { inputs: merged, ready: status.ready, card, message_id: messageId },
            { trace_id: req.trace_id, meta: { request_time_ms: elapsed() } },
        );
    }),
);

// ─────────────────────────────────────────────────────────────
// 槽位模式：提交执行（异步；结果由 /execution 轮询取回）
// ─────────────────────────────────────────────────────────────

router.post(
    '/sessions/:id/execute',
    asyncHandler(async (req, res) => {
        const elapsed = startTimer();
        const session = await getOwnedSession(req, req.params.id);
        if (!session) {
            return sendFail(res, new AppError('RESOURCE_NOT_FOUND', '会话不存在'), { trace_id: req.trace_id });
        }
        if (session.mode !== 'slot') {
            return sendFail(res, new AppError('VALIDATION_FAILED', '该会话不是参数收集模式'), { trace_id: req.trace_id });
        }
        if (session.status === 'executing') {
            return sendFail(res, new AppError('CONFLICT', '该会话已有任务在执行中'), { trace_id: req.trace_id });
        }
        const skill = getSkill(session.skill_key);
        const plan = buildSlotPlan(skill);
        const ctx = slotContext(session, plan);
        const status = slotStatus(plan, ctx.inputs);
        if (!status.ready) {
            return sendFail(
                res,
                new AppError('VALIDATION_FAILED', `参数未收集完整：${status.requiredMissing.map((s) => s.title).join('、')}`),
                { trace_id: req.trace_id },
            );
        }

        // 槽位里的文件引用 → taskService 的暂存文件格式
        const files = [];
        for (const s of plan.slots) {
            if (!s.isFile) continue;
            const v = ctx.inputs[s.key];
            const arr = Array.isArray(v) ? v : v ? [v] : [];
            for (const f of arr) {
                if (f && typeof f === 'object' && f.file_id) files.push({ file_id: f.file_id, name: f.name || '附件' });
            }
        }

        // 给任务的 inputs 去掉文件字段（文件走 files 通道，避免重复）
        const wfInputs = {};
        for (const [k, v] of Object.entries(ctx.inputs)) {
            const slot = plan.slots.find((s) => s.key === k);
            if (slot?.isFile) continue;
            if (v === undefined || v === null || String(v).trim() === '') continue;
            wfInputs[k] = v;
        }

        const task = await createTask({
            skill_key: session.skill_key,
            title: `${skill.name} · 对话执行`,
            inputs: wfInputs,
            files,
            execute_now: false,
            user: req.user,
        });

        await pool.query(`UPDATE chat_sessions SET status = 'executing', task_id = $1, updated_at = NOW() WHERE id = $2`, [
            task.id,
            session.id,
        ]);

        const submitContent = `已提交执行（任务 ${task.task_no}）⏳\n\n${composeSummary({ plan, inputs: ctx.inputs })}`;
        const { rows: msgRows } = await pool.query(
            'INSERT INTO chat_messages (session_id, role, content, meta, trace_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [
                session.id,
                'assistant',
                submitContent,
                JSON.stringify({
                    kind: 'result',
                    card: { kind: 'result', task_id: task.id, task_no: task.task_no, status: 'running', fields: [], warnings: [], can_retry: false, skill_name: skill.name },
                }),
                req.trace_id,
            ],
        );

        // 后台驱动：不 await（blocking 技能可能跑 5 分钟）；异常已在 taskService 内闭环为 failed 任务
        executeTask(task, req.user, { inputs: wfInputs, files }).catch((e) => {
            logger.error('[chat] 槽位会话后台执行异常：' + (e?.message || e));
        });

        return sendOk(
            res,
            { task_id: task.id, task_no: task.task_no, status: 'executing', message_id: msgRows[0].id },
            { trace_id: req.trace_id, meta: { request_time_ms: elapsed() } },
        );
    }),
);

/**
 * GET /chat/sessions/:id/execution —— 轮询执行结果。
 * 任务到达终态且结果尚未落消息时，写入一条结果卡片消息（幂等：按 meta->task_id 去重）。
 */
router.get(
    '/sessions/:id/execution',
    asyncHandler(async (req, res) => {
        const elapsed = startTimer();
        const session = await getOwnedSession(req, req.params.id);
        if (!session) {
            return sendFail(res, new AppError('RESOURCE_NOT_FOUND', '会话不存在'), { trace_id: req.trace_id });
        }
        if (session.mode !== 'slot' || !session.task_id) {
            return sendOk(res, { status: 'none', message_id: null }, { trace_id: req.trace_id, meta: { request_time_ms: elapsed() } });
        }

        const taskRow = await getTaskById(session.task_id);
        if (!taskRow) {
            return sendOk(res, { status: 'unknown', task_id: session.task_id, message_id: null }, { trace_id: req.trace_id, meta: { request_time_ms: elapsed() } });
        }
        const detail = await getTaskDetail(taskRow, req.user);
        const task = detail?.task || taskRow;
        const status = task?.status || 'unknown';

        if (!SLOT_TERMINAL.has(status)) {
            return sendOk(res, { status, task_id: session.task_id, message_id: null }, { trace_id: req.trace_id, meta: { request_time_ms: elapsed() } });
        }

        // 结果消息幂等落库
        const { rows: existing } = await pool.query(
            `SELECT id FROM chat_messages WHERE session_id = $1 AND meta->>'kind' = 'result' AND meta->>'task_id' = $2 LIMIT 1`,
            [session.id, String(session.task_id)],
        );
        let messageId = existing[0]?.id ?? null;
        let card = null;
        if (!messageId) {
            const skill = getSkill(session.skill_key);
            const { content, card: c } = buildResultCard(task, { skillName: skill?.name });
            card = c;
            const { rows } = await pool.query(
                'INSERT INTO chat_messages (session_id, role, content, meta, trace_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                [session.id, 'assistant', content, JSON.stringify(c), req.trace_id],
            );
            messageId = rows[0].id;
            await pool.query(`UPDATE chat_sessions SET status = $1, updated_at = NOW() WHERE id = $2`, ['done', session.id]);
        } else {
            const { rows } = await pool.query('SELECT meta FROM chat_messages WHERE id = $1', [messageId]);
            card = rows[0]?.meta ?? null;
        }

        return sendOk(
            res,
            { status, task_id: session.task_id, message_id: messageId, card },
            { trace_id: req.trace_id, meta: { request_time_ms: elapsed() } },
        );
    }),
);

// ─────────────────────────────────────────────────────────────
// chat 模式：人工介入（human-in-the-loop）—— 提交动作 + 取回续跑结果
// ─────────────────────────────────────────────────────────────

/**
 * POST /chat/sessions/:id/human-input
 * body: { action: string }
 *
 * chatflow 在「人工介入」节点暂停时，发消息的 SSE 会以 done+pending 收尾并落一条
 * `meta.kind='human_input'` 消息（见上面 pausedCard 分支）。本端点负责把用户点的按钮
 * 提交给 Dify，并把**续跑后的结果**带回来：
 *
 *   1. 取会话里最近一条待提交（submitted=false）的 human_input 消息 → form_token
 *      （顺带校验 action 确实在该表单声明的动作里，防越权/误传）；
 *   2. 幂等标记 submitted=true，并落一条 user 消息记录「点了什么」（可回溯）；
 *   3. POST /v1/form/human_input/<token> —— Dify 返回 200 后在 worker 里异步续跑；
 *   4. 轮询 GET /v1/messages 直到：出现**下一张**待填表单（再次暂停）
 *      或消息落到终态（拿到 answer）；
 *   5. 结果落 chat_messages，返回 { status:'paused'|'finished'|'running', card?, answer? }。
 *
 * 之所以不在 SSE 里等，是因为暂停后连接就断了、且续跑可能几分钟 —— 交由前端轮询/重取消息。
 */
router.post(
    '/sessions/:id/human-input',
    asyncHandler(async (req, res) => {
        const elapsed = startTimer();
        const session = await getOwnedSession(req, req.params.id);
        if (!session) {
            return sendFail(res, new AppError('RESOURCE_NOT_FOUND', '会话不存在'), { trace_id: req.trace_id });
        }
        if (session.mode !== 'chat') {
            return sendFail(res, new AppError('VALIDATION_FAILED', '该会话不是对话模式'), { trace_id: req.trace_id });
        }
        const action = String(req.body?.action || '').trim();
        if (!action) {
            return sendFail(res, new AppError('VALIDATION_FAILED', '缺少 action'), { trace_id: req.trace_id });
        }

        // 最近一条待提交的人工介入消息
        const { rows: pendingRows } = await pool.query(
            `SELECT id, meta FROM chat_messages
             WHERE session_id = $1
               AND meta->>'kind' = 'human_input'
               AND COALESCE((meta->>'submitted')::boolean, false) = false
             ORDER BY id DESC LIMIT 1`,
            [session.id],
        );
        const pending = pendingRows[0];
        if (!pending) {
            return sendFail(res, new AppError('VALIDATION_FAILED', '当前没有待确认的人工介入表单'), { trace_id: req.trace_id });
        }
        const token = String(pending.meta?.form_token || '');
        const actions = Array.isArray(pending.meta?.actions) ? pending.meta.actions : [];
        const picked = actions.find((a) => a?.id === action);
        if (!token || !picked) {
            return sendFail(res, new AppError('VALIDATION_FAILED', `无效的操作：${action}`), { trace_id: req.trace_id });
        }

        const route = resolveSkillRoute(session.skill_key);
        if (route.error) {
            return sendFail(res, new AppError(route.error.code, route.error.message), { trace_id: req.trace_id });
        }
        const { config } = route;
        const difyUser = difyUserOf(req.user);
        const conversationId = session.dify_conversation_id;
        if (!conversationId) {
            return sendFail(res, new AppError('VALIDATION_FAILED', '会话缺少 Dify conversation_id，无法续跑'), { trace_id: req.trace_id });
        }

        // 幂等：先落「已提交」，重复点击不会二次提交给 Dify
        await pool.query(
            `UPDATE chat_messages SET meta = meta || '{"submitted": true}'::jsonb WHERE id = $1`,
            [pending.id],
        );
        await pool.query(
            'INSERT INTO chat_messages (session_id, role, content, meta, trace_id) VALUES ($1, $2, $3, $4, $5)',
            [
                session.id,
                'user',
                picked.title || action,
                JSON.stringify({ kind: 'human_action', action, form_token: token }),
                req.trace_id,
            ],
        );

        await submitHumanInput(config, {
            form_token: token,
            action,
            inputs: {},
            user: difyUser,
            trace_id: req.trace_id,
        });

        // ── 轮询续跑结果 ────────────────────────────────────────
        const deadline = Date.now() + HUMAN_POLL_TIMEOUT_MS;
        let nextCard = null;
        let finalAnswer = null;
        while (Date.now() < deadline) {
            await sleep(HUMAN_POLL_INTERVAL_MS);
            let payload;
            try {
                payload = await fetchConversationMessages(config, {
                    conversation_id: conversationId,
                    user: difyUser,
                    limit: 20,
                    trace_id: req.trace_id,
                });
            } catch (e) {
                // 单次拉取失败不致命（网络抖动），继续轮询直到超时
                logger.warn('human_input_poll_failed', { trace_id: req.trace_id, error: e?.message });
                continue;
            }
            const latest = latestDifyMessage(payload?.data);
            if (!latest) continue;
            const form = pickPendingForm(latest, token);
            if (form) {
                nextCard = form;
                break;
            }
            if (latest.status && !HUMAN_RUNNING_STATUS.has(latest.status)) {
                finalAnswer = typeof latest.answer === 'string' ? latest.answer : '';
                break;
            }
        }

        if (nextCard) {
            const content = nextCard.form_content || nextCard.node_title || '工作流需要你确认后才能继续。';
            const { rows } = await pool.query(
                'INSERT INTO chat_messages (session_id, role, content, meta, trace_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                [session.id, 'assistant', content, JSON.stringify(nextCard), req.trace_id],
            );
            await pool.query(`UPDATE chat_sessions SET status = 'collecting', updated_at = NOW() WHERE id = $1`, [session.id]);
            return sendOk(
                res,
                { status: 'paused', message_id: rows[0].id, card: nextCard },
                { trace_id: req.trace_id, meta: { request_time_ms: elapsed() } },
            );
        }

        if (finalAnswer !== null) {
            const { rows } = await pool.query(
                'INSERT INTO chat_messages (session_id, role, content, meta, trace_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                [session.id, 'assistant', finalAnswer, JSON.stringify({ kind: 'human_done', form_token: token }), req.trace_id],
            );
            await pool.query(`UPDATE chat_sessions SET status = 'done', updated_at = NOW() WHERE id = $1`, [session.id]);
            return sendOk(
                res,
                { status: 'finished', message_id: rows[0].id, answer: finalAnswer },
                { trace_id: req.trace_id, meta: { request_time_ms: elapsed() } },
            );
        }

        // 超时仍在跑：动作已提交，让用户稍后刷新会话看结果（不谎报失败）
        await pool.query(`UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1`, [session.id]);
        return sendOk(
            res,
            { status: 'running', message_id: null },
            { trace_id: req.trace_id, meta: { request_time_ms: elapsed() } },
        );
    }),
);

// ─────────────────────────────────────────────────────────────
// 发消息（SSE 流式）
// ─────────────────────────────────────────────────────────────

/**
 * POST /chat/sessions/:id/messages
 * body: { query?: string, files?: [{ file_id, name? }] }
 *
 * chat 模式 → Dify chat-messages 流式透传
 * slot 模式 → 本地参数提取 + 追问（不调用 Dify）
 */
router.post('/sessions/:id/messages', async (req, res) => {
    const traceId = req.trace_id || newTraceId();

    /** 已进入 SSE 模式后的错误统一以事件收尾 */
    const sseError = (message) => {
        if (!res.headersSent) return false;
        res.write(`data: ${JSON.stringify({ event: 'error', message })}\n\n`);
        res.end();
        return true;
    };

    try {
        const session = await getOwnedSession(req, req.params.id);
        if (!session) {
            return sendFail(res, new AppError('RESOURCE_NOT_FOUND', '会话不存在'), { trace_id: traceId });
        }

        const query = String(req.body?.query || '').trim();
        const fileRefs = Array.isArray(req.body?.files) ? req.body.files : [];
        if (!query && fileRefs.length === 0) {
            return sendFail(res, new AppError('VALIDATION_FAILED', '消息内容为空'), { trace_id: traceId });
        }

        const r = resolveSkillRoute(session.skill_key);
        if (r.error) {
            return sendFail(res, new AppError(r.error.code, r.error.message), { trace_id: traceId });
        }

        // 用户消息落库（两种模式共用）
        await pool.query(
            'INSERT INTO chat_messages (session_id, role, content, files, trace_id) VALUES ($1, $2, $3, $4, $5)',
            [session.id, 'user', query || '（发送了附件）', fileRefs.length ? JSON.stringify(fileRefs) : null, traceId],
        );

        // SSE 通道就绪
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        const controller = new AbortController();
        req.on('close', () => controller.abort());

        // ══════════════════════════════════════════════════════════
        // 分支 A：槽位收集（workflow 类技能）
        // ══════════════════════════════════════════════════════════
        if (r.mode === 'slot') {
            const plan = r.plan;
            const ctx = slotContext(session, plan);

            // 附件 → 空着的文件槽位（多槽位按顺序分配，单槽位全收）
            const fileSlots = plan.slots.filter((s) => s.isFile);
            const filePatch = {};
            if (fileRefs.length > 0 && fileSlots.length > 0) {
                const emptySlots = fileSlots.filter((s) => {
                    const v = ctx.inputs[s.key];
                    return !v || (Array.isArray(v) && v.length === 0);
                });
                const targets = emptySlots.length ? emptySlots : [fileSlots[0]];
                fileRefs.forEach((f, i) => {
                    const slot = targets[Math.min(i, targets.length - 1)];
                    const prev = filePatch[slot.key] ?? (Array.isArray(ctx.inputs[slot.key]) ? ctx.inputs[slot.key] : []);
                    filePatch[slot.key] = [...prev, { file_id: f.file_id, name: f.name || '附件' }];
                });
            }

            // 附件 → 文本槽 抽取（P1-4）：技能声明了 file_to_text 时，应用其实只吃**文本**
            // （没有文件通道），所以服务端把表格里的那一列抽出来拼成多行文本注入。
            const f2t = r.skill?.file_to_text;
            const textPatch = {};
            let adapterNotice = '';
            if (f2t && f2t.slot && fileRefs.length > 0) {
                const staged = await loadStagedBuffers(fileRefs);
                if (staged.length === 0) {
                    adapterNotice = '⚠️ 附件没读到内容，请重新上传。';
                } else {
                    const res1 = extractNamesFromFile(staged[0], { column: f2t.column || 'auto' });
                    if (res1.ok) {
                        const out = namesToSlotText(res1.values, res1);
                        textPatch[f2t.slot] = out.text;
                        adapterNotice = `✅ ${out.notice}`;
                    } else {
                        // 猜不出就明说，让用户补 —— 绝不静默塞一列无关数据进工作流
                        adapterNotice = `⚠️ ${res1.error}`;
                    }
                }
            }

            const ex = await extractWithFallback({
                plan,
                inputs: ctx.inputs,
                text: query,
                lastAsk: ctx.lastAsk,
                signal: controller.signal,
            });
            if (controller.signal.aborted) return;

            // 顺序即优先级：本地文件抽取（明确的用户产物）> 对话文本抽取
            const merged = mergeInputs(mergeInputs(mergeInputs(ctx.inputs, filePatch), ex.patch), textPatch);
            const status = slotStatus(plan, merged);

            const ask = composeAsk({ plan, inputs: merged, patch: ex.patch, hits: ex.hits });
            let content = ask.content;

            // 用户补的是文件（文本为空）时，给一句明确反馈
            if (!query && Object.keys(filePatch).length > 0) {
                const names = fileRefs.map((f) => f.name || '附件').join('、');
                content = `已收到附件：${names} ✅\n\n${ask.content}`;
            }
            // 附件抽取结果（成功或失败）都要告知，不静默
            if (adapterNotice) {
                content = `${adapterNotice}\n\n${content}`;
            }
            // 技能不接受文件却没配抽取规则 → 明说，不静默丢弃
            if (fileRefs.length > 0 && fileSlots.length === 0 && !f2t) {
                content = `ℹ️ 技能「${plan.skill_name}」不接收文件参数，本次附件已忽略。\n\n${content}`;
            }
            if (status.ready) {
                content = `${content}\n\n${composeSummary({ plan, inputs: merged })}`;
            }

            const card = buildSlotCard({ plan, inputs: merged, status, askKeys: ask.lastAsk });
            res.write(`data: ${JSON.stringify({ event: 'slot', card })}\n\n`);
            res.write(`data: ${JSON.stringify({ event: 'delta', text: content })}\n\n`);

            const { rows } = await pool.query(
                'INSERT INTO chat_messages (session_id, role, content, meta, trace_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                [
                    session.id,
                    'assistant',
                    content,
                    JSON.stringify({
                        kind: 'slot_ask',
                        card,
                        extractor: ex.extractor,
                        degraded: !!ex.degraded,
                        hits: ex.hits,
                    }),
                    traceId,
                ],
            );
            await persistSlotState(session.id, merged, ask.lastAsk, ex.extractor);
            await pool.query(
                `UPDATE chat_sessions
                 SET status = $1, updated_at = NOW(),
                     title = CASE WHEN title = '新会话' THEN $3 ELSE title END
                 WHERE id = $2`,
                [status.ready ? 'ready' : 'collecting', session.id, (query || r.skill.name).slice(0, 20)],
            );

            res.write(
                `data: ${JSON.stringify({
                    event: 'done',
                    message_id: rows[0].id,
                    ready: status.ready,
                    extractor: ex.extractor,
                    degraded: !!ex.degraded,
                    card,
                })}\n\n`,
            );
            res.end();
            return;
        }

        // ══════════════════════════════════════════════════════════
        // 分支 B：直连 Dify 对话（chat 类技能）
        // ══════════════════════════════════════════════════════════
        const { skill, config, plan: chatPlan } = r;
        const difyUser = difyUserOf(req.user);

        // ── 对话式入参收集（P0-1）────────────────────────────────────
        // chat 应用的 start 节点若声明了必填变量，空 inputs 直连会被 Dify 静默挂起
        // （只发 ping，触发 difyClient 的首事件超时）。因此调 Dify 前先在对话里问齐必填项，
        // 没齐就不发起 Dify 调用。用户一句话说全时不会被打断。
        let chatInputs = {};
        if (chatPlan) {
            const st = session.slot_state && typeof session.slot_state === 'object' ? session.slot_state : {};
            const collected = st.inputs && typeof st.inputs === 'object' ? st.inputs : {};
            const lastAsk = Array.isArray(st.last_ask) ? st.last_ask : [];
            const ex = await extractWithFallback({
                plan: chatPlan,
                inputs: collected,
                text: query,
                lastAsk,
                signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            const merged = mergeInputs(collected, ex.patch);
            const status = slotStatus(chatPlan, merged);

            if (!status.ready) {
                const ask = composeAsk({ plan: chatPlan, inputs: merged, patch: ex.patch, hits: ex.hits });
                const card = buildSlotCard({ plan: chatPlan, inputs: merged, status, askKeys: ask.lastAsk });
                res.write(`data: ${JSON.stringify({ event: 'slot', card })}\n\n`);
                res.write(`data: ${JSON.stringify({ event: 'delta', text: ask.content })}\n\n`);
                const { rows } = await pool.query(
                    'INSERT INTO chat_messages (session_id, role, content, meta, trace_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                    [
                        session.id,
                        'assistant',
                        ask.content,
                        JSON.stringify({
                            kind: 'slot_ask',
                            card,
                            extractor: ex.extractor,
                            degraded: !!ex.degraded,
                            hits: ex.hits,
                            scope: 'chat_inputs',
                        }),
                        traceId,
                    ],
                );
                await persistSlotState(session.id, merged, ask.lastAsk, ex.extractor);
                res.write(
                    `data: ${JSON.stringify({
                        event: 'done',
                        message_id: rows[0].id,
                        ready: false,
                        extractor: ex.extractor,
                        degraded: !!ex.degraded,
                        card,
                    })}\n\n`,
                );
                res.end();
                return;
            }

            // 齐了：只把「契约里声明过」的项随 inputs 下发（文件槽走附件通道，不在此送）
            for (const s of chatPlan.slots) {
                const v = merged[s.key];
                if (v === undefined || v === null || String(v).trim() === '') continue;
                if (s.isFile) continue;
                chatInputs[s.key] = v;
            }
            await persistSlotState(session.id, merged, [], ex.extractor);
        }

        const uploaded = [];
        if (fileRefs.length > 0) {
            const staged = await loadStagedBuffers(fileRefs);
            for (const f of staged) {
                const up = await uploadFile(config, {
                    buffer: f.buffer,
                    filename: f.name,
                    mimeType: f.mimeType,
                    user: difyUser,
                    trace_id: traceId,
                });
                uploaded.push({
                    type: inferDifyFileType(f.mimeType, f.name),
                    transfer_method: 'local_file',
                    upload_file_id: up.id,
                });
            }
        }

        const effectiveQuery =
            query ||
            `请处理上传的附件（${fileRefs.map((f) => f.name).filter(Boolean).join('、') || '附件'}），按「${skill.name}」的要求输出结果。`;

        let answer = '';
        let conversationId = session.dify_conversation_id || null;
        let failed = null;
        let pausedCard = null;

        await streamChat(config, {
            query: effectiveQuery,
            inputs: chatInputs,
            user: difyUser,
            conversation_id: conversationId,
            files: uploaded,
            trace_id: traceId,
            skill_key: session.skill_key,
            signal: controller.signal,
            onEvent: (evt) => {
                // advanced-chat 应用不一定发 message_end（以 workflow_finished 收尾），
                // 但每个事件都带 conversation_id —— 见到就存，保证多轮上下文不断
                if (evt.conversation_id) conversationId = evt.conversation_id;
                if (evt.event === 'message' || evt.event === 'agent_message') {
                    const delta = evt.answer || '';
                    answer += delta;
                    if (delta) res.write(`data: ${JSON.stringify({ event: 'delta', text: delta })}\n\n`);
                } else if (evt.event === 'message_end') {
                    conversationId = evt.conversation_id || conversationId;
                } else if (evt.event === 'error') {
                    failed = evt.message || 'Dify 对话失败';
                } else if (evt.event === 'human_input_required' || evt.event === 'workflow_paused') {
                    // chatflow 人工介入（human-in-the-loop）：工作流在此暂停，等用户点按钮。
                    // Dify 对同一次暂停会发两个等价事件，按 form_token 去重后只推一张卡。
                    // 此前这里**直接丢弃** → 用户看到一条空回复（「用不了」的直接原因）。
                    const card = extractHumanInput(evt);
                    if (card && card.form_token !== pausedCard?.form_token) {
                        pausedCard = card;
                        res.write(`data: ${JSON.stringify({ event: 'human_input', card })}\n\n`);
                    }
                }
                // ping / tts / workflow 节点事件不向前端转发
            },
        });

        if (controller.signal.aborted) return; // 客户端已断开，不再写库/写响应
        if (failed) {
            sseError(failed);
            return;
        }

        // ── 暂停在人工介入节点：落一条「待确认」消息 + 以 done 收尾 ──────────────
        // 表单信息进 meta，刷新/换设备后按钮可恢复；续跑由
        // POST /sessions/:id/human-input 负责。
        if (pausedCard) {
            const content = pausedCard.form_content || '工作流需要你确认后才能继续。';
            const { rows } = await pool.query(
                'INSERT INTO chat_messages (session_id, role, content, meta, trace_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                [session.id, 'assistant', content, JSON.stringify({ ...pausedCard, submitted: false }), traceId],
            );
            await pool.query(
                `UPDATE chat_sessions
                 SET dify_conversation_id = $1, updated_at = NOW(),
                     title = CASE WHEN title = '新会话' THEN $3 ELSE title END
                 WHERE id = $2`,
                [conversationId, session.id, (query || skill.name).slice(0, 20)],
            );
            res.write(
                `data: ${JSON.stringify({
                    event: 'done',
                    message_id: rows[0].id,
                    conversation_id: conversationId,
                    card: { ...pausedCard, submitted: false },
                    pending: true,
                })}\n\n`,
            );
            res.end();
            return;
        }

        const { rows } = await pool.query(
            'INSERT INTO chat_messages (session_id, role, content, trace_id) VALUES ($1, $2, $3, $4) RETURNING id',
            [session.id, 'assistant', answer, traceId],
        );
        const autoTitle = (query || skill.name).slice(0, 20);
        await pool.query(
            `UPDATE chat_sessions
             SET dify_conversation_id = $1,
                 updated_at = NOW(),
                 title = CASE WHEN title = '新会话' THEN $3 ELSE title END
             WHERE id = $2`,
            [conversationId, session.id, autoTitle],
        );

        res.write(
            `data: ${JSON.stringify({ event: 'done', message_id: rows[0].id, conversation_id: conversationId, answer })}\n\n`,
        );
        res.end();
    } catch (e) {
        if (sseError(e.message || '对话失败')) return;
        return sendFail(
            res,
            new AppError(e.code || 'PROVIDER_ERROR', e.message || '对话失败'),
            { trace_id: traceId },
        );
    }
});

export default router;
