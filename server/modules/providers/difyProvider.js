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
            // 暂存文件 → Dify 文件类型映射（技能隐式依赖：隐患检测要 image、会议纪要要 audio、
            // 视频生成要 video；不映射的话音频/视频会被当成 document，Dify 侧直接拒绝）
            const fType = f.type || inferDifyFileType(f.mimeType, f.name);
            uploaded.push({ type: fType, transfer_method: 'local_file', upload_file_id: r.id });
        }

        // ── 2. 按执行模式分流 ────────────────────────────────────
        const mode = skill?.execution_mode || 'async';
        const kind = config.endpoint_kind;

        if (mode === 'chat' || kind === 'chat') {
            const given = inputs.message || inputs.query || inputs.prompt || inputs.text || '';
            // 有些技能（会议纪要）的输入全是文件/结构化字段，没有消息正文；
            // chat-messages 的 query 不能为空，这里给一个可读的兜底指令，避免 400。
            const query =
                given ||
                (uploaded.length
                    ? `请处理上传的附件（${files.map((f) => f.name).filter(Boolean).join('、') || '附件'}），按「${skill?.name || '任务'}」的要求输出结果。`
                    : '');
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

        // 工作流文件输入变量映射：Dify workflows/run 的文件必须按输入变量名放进 inputs
        // （绑定可声明 file_input_var，如 quote_verify.file → quote_file）；顶层 files 仅 chat-messages 约定
        // 🔴 2026-09-20 修正：workflow 类技能的文件槽位此前**没有任何通道**送进 Dify
        //   （绑定里普遍未声明 file_input_var），文件被静默丢弃。现在缺配置时按技能
        //   input_schema 里第一个文件槽位的 key 推断变量名，与 Dify 侧变量名对齐。
        const fileVar = config.file_input_var || inferWorkflowFileVar(skill);
        const wfInputs = fileVar && uploaded.length ? { ...inputs, [fileVar]: uploaded } : inputs;

        const raw = await runWorkflow(config, {
            inputs: wfInputs,
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

/**
 * 推断 workflow 的文件输入变量名（绑定未声明 file_input_var 时的兜底）。
 * 取 input_schema 中第一个文件槽位的 key —— 与 Dify 工作流的文件变量名约定一致。
 * @param {object} skill
 * @returns {string|null}
 */
export function inferWorkflowFileVar(skill) {
    const props = skill?.input_schema?.properties || {};
    for (const [key, def] of Object.entries(props)) {
        if (def?.format === 'binary' || def?.type === 'file' || /^files?$/i.test(key)) return key;
    }
    return null;
}

/**
 * 暂存文件 → Dify 文件类型
 *
 * Dify 的 files[].type 只认 image / document / audio / video，类型错了会被直接拒绝。
 * 优先按 MIME 判定，MIME 缺失（application/octet-stream）时回退到扩展名。
 */
export function inferDifyFileType(mimeType = '', name = '') {
    const mime = String(mimeType || '').toLowerCase();
    const ext = String(name || '').toLowerCase().split('.').pop() || '';
    if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) return 'image';
    if (mime.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'amr'].includes(ext)) return 'audio';
    if (mime.startsWith('video/') || ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'video';
    return 'document';
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
