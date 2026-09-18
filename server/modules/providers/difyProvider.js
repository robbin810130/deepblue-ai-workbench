/**
 * DifyProvider —— WorkflowProvider 协议的 Dify 实现
 *
 * 文档 04 §2 定义的 Provider 抽象：
 *     class WorkflowProvider(Protocol):
 *         async def upload_file(...)
 *         async def run_workflow(...)
 *         async def get_run(...)
 *         async def cancel_run(...)
 *
 * 本文件是该协议在 JS 侧的落地。**业务 Service 只依赖本模块暴露的 4 个方法，
 * 不拼装任何 Dify HTTP 请求**（文档 04 §1）。
 *
 * 与 normalizer 的分工：
 *   difyProvider 负责「把请求发对、把文件传对、把错误识别对」
 *   normalizer   负责「把响应读懂」
 */

import {
    uploadFile,
    runWorkflow,
    runChat,
    getWorkflowRun,
    stopWorkflow,
    streamWorkflow,
    newTraceId as newTraceIdSafe,
} from './difyClient.js';
import { normalizeWorkflowResult, normalizeChatResult, normalizeError } from './normalizer.js';

/**
 * 以标准输入（文档 04 §4）驱动一次 Provider 调用。
 *
 * @param {object} config   resolveBinding 产出的运行时配置（含 base_url / api_key / timeout_ms）
 * @param {object} skill    技能定义（用于归一化时对齐 output_schema）
 * @param {object} standardInput  标准输入
 * @param {string} standardInput.task_id
 * @param {{id:string, name:string}} standardInput.user
 * @param {object} standardInput.inputs
 * @param {Array<{file_id:string, name:string, buffer?:Buffer, mimeType?:string}>} [standardInput.files]
 * @param {{trace_id?:string, locale?:string}} [standardInput.context]
 * @returns {Promise<object>} 标准输出（文档 04 §5）
 */
export async function execute(config, skill, standardInput = {}) {
    const startedAt = Date.now();
    const traceId = standardInput?.context?.trace_id || newTraceIdSafe();
    const user = standardInput?.user?.id || standardInput?.user?.name || 'system';
    const inputs = standardInput?.inputs || {};
    const files = Array.isArray(standardInput?.files) ? standardInput.files : [];
    const skillKey = skill?.skill_key || null;

    try {
        // ── 1. 文件先传到 Provider（文档 04 §7：平台先收，再按需上传 Dify）──
        const uploaded = [];
        for (const f of files) {
            if (f.provider_file_id) {
                uploaded.push({ type: f.type || 'document', transfer_method: 'local_file', upload_file_id: f.provider_file_id });
                continue;
            }
            if (!f.buffer) continue; // 只有元数据、无内容时跳过（调用方已上传过）
            const r = await uploadFile(config, {
                buffer: f.buffer,
                filename: f.name || 'file',
                mimeType: f.mimeType,
                user,
                trace_id: traceId,
            });
            uploaded.push({ type: f.type || 'document', transfer_method: 'local_file', upload_file_id: r.id });
        }

        // ── 2. 按执行模式分流 ────────────────────────────────────
        const mode = skill?.execution_mode || 'async';
        const kind = config.endpoint_kind;

        if (mode === 'chat' || kind === 'chat') {
            const query =
                inputs.message || inputs.query || inputs.prompt || inputs.text || '';
            const raw = await runChat(config, {
                query,
                inputs: stripChatInputs(inputs),
                user,
                conversation_id: inputs.conversation_id,
                files: uploaded,
                trace_id: traceId,
                skill_key: skillKey,
            });
            return normalizeChatResult({
                raw,
                skill,
                duration_ms: Date.now() - startedAt,
                conversation_id: inputs.conversation_id,
            });
        }

        const raw = await runWorkflow(config, {
            inputs,
            user,
            files: uploaded,
            trace_id: traceId,
            skill_key: skillKey,
        });
        return normalizeWorkflowResult({
            raw,
            skill,
            binding_key: config.binding_key,
            duration_ms: Date.now() - startedAt,
            aliases: skill?.output_field_aliases,
        });
    } catch (e) {
        const normalized = normalizeError(e);
        const err = new Error(normalized.message);
        err.code = normalized.code;
        err.http_status = normalized.http_status;
        err.detail = normalized.detail;
        err.binding_key = config?.binding_key || null;
        err.trace_id = traceId;
        throw err;
    }
}

/** chat 模式下，消息正文已单独传，inputs 里去掉它避免重复 */
function stripChatInputs(inputs) {
    const { message, query, prompt, text, conversation_id, ...rest } = inputs || {};
    return rest;
}

/** 查询运行状态（文档 04 §9 轮询） */
export async function getRun(config, runId, context = {}) {
    return getWorkflowRun(config, runId, context);
}

/** 取消运行（文档 04 §2 cancel_run） */
export async function cancelRun(config, taskId, user, context = {}) {
    return stopWorkflow(config, taskId, user, context);
}

/** 流式执行（文档 03 §7 SSE） */
export async function executeStream(config, skill, standardInput = {}, onEvent = () => {}) {
    const traceId = standardInput?.context?.trace_id || newTraceIdSafe();
    return streamWorkflow(config, {
        inputs: standardInput?.inputs || {},
        user: standardInput?.user?.id || 'system',
        files: [],
        trace_id: traceId,
        skill_key: skill?.skill_key,
        onEvent,
    });
}

export default { execute, getRun, cancelRun, executeStream };
