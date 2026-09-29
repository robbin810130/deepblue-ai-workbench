/**
 * 输出归一化 —— 把 Dify 的任意返回形态收敛为**平台标准输出**
 *
 * 文档依据：
 *   - 04_Dify接入规范 §1  Dify 返回必须转换为平台标准输出后再持久化和返回
 *   - 04_Dify接入规范 §5  标准输出：{status, summary, data, artifacts, metrics}
 *   - 04_Dify接入规范 §12 禁止把 Dify 返回 JSON 原样当作平台长期接口契约
 *   - 09 §3              输出最低要求：summary / status / data / artifacts / warnings
 *
 * 🔴 现状问题（全仓静态扫描实测）：取 Dify 输出有 **15 种不同写法**，例如
 *      bodyData?.data?.outputs || bodyData?.data || bodyData      ×8
 *      resultData?.data?.outputs || {}                             ×4
 *      event?.data?.outputs || {}                                  ×4
 *      data.data.outputs                                           ×2（无空值保护）
 *    → 没有任何一处代码能代表「Dify 返回什么」。本文件就是那个唯一代表。
 *
 * 设计原则：**宽进严出**。
 *   宽进：兼容 Dify 已知的全部返回形态（blocking / streaming / chat / 纯文本）
 *   严出：只吐标准输出，消费方永远不需要知道 Dify 长什么样
 */

/** 平台标准状态（文档 04 §5 + 09 §3） */
export const STANDARD_STATUS = Object.freeze(['succeeded', 'failed', 'need_confirmation', 'partial']);

/**
 * 尝试把值解析为 JSON。
 * Dify 的 outputs 里经常是「JSON 字符串」，而且常被 ```json 包裹。
 * @param {unknown} value
 * @returns {unknown} 解析成功返回对象，否则原样返回
 */
export function parseMaybeJson(value) {
    if (typeof value !== 'string') return value;

    let text = value.trim();

    // 剥掉 Markdown 代码围栏
    const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fence) text = fence[1].trim();

    if (!text) return value;
    const first = text[0];
    if (first !== '{' && first !== '[') return value;

    try {
        return JSON.parse(text);
    } catch {
        return value;
    }
}

/**
 * 定位真正的 outputs 对象。
 *
 * 按优先级依次尝试 5 条已知路径，覆盖现状统计到的全部写法的语义：
 *   ① body.data.outputs                       —— workflow blocking 标准形态
 *   ② body.data.data.outputs                  —— 部分代理层多包一层
 *   ③ body.outputs                            —— 直传
 *   ④ body.data                               —— 已被上游展平
 *   ⑤ body                                    —— 裸对象
 *
 * @param {unknown} raw
 * @returns {{outputs: object, path: string}} path 用于诊断（谁在返回非标准结构）
 */
export function extractOutputs(raw) {
    if (!raw || typeof raw !== 'object') {
        return { outputs: {}, path: 'none' };
    }
    const body = /** @type {Record<string, any>} */ (raw);

    const pick = (node) => (node && typeof node === 'object' && !Array.isArray(node) ? node : null);

    const d = pick(body.data);

    const candidates = [
        ['data.outputs', d ? pick(d.outputs) : null],
        ['data.data.outputs', d && pick(d.data) ? pick(d.data.outputs) : null],
        ['outputs', pick(body.outputs)],
        ['data', d],
        ['root', body],
    ];

    for (const [path, node] of candidates) {
        if (node && Object.keys(node).length > 0) {
            return { outputs: node, path };
        }
    }
    return { outputs: {}, path: 'empty' };
}

/**
 * 取 Dify 的原始业务状态，映射为平台标准状态。
 * 文档 04 §9：Provider 状态必须映射为平台标准状态，页面不得依赖 Dify 原始状态值。
 * @param {unknown} rawStatus
 * @param {object} [outputs]
 */
export function mapStatus(rawStatus, outputs = {}) {
    const s = String(rawStatus || '').toLowerCase();

    if (['succeeded', 'success', 'completed', 'finished'].includes(s)) return 'succeeded';
    if (['failed', 'error', 'stopped'].includes(s)) return 'failed';
    if (['running', 'queued', 'pending'].includes(s)) return 'partial';

    // 业务层显式要求人工确认（文档 09 §3 status 可为 need_confirmation）
    const bizStatus = String(outputs?.status || '').toLowerCase();
    if (['need_confirmation', 'need-confirmation', 'requires_confirmation'].includes(bizStatus)) {
        return 'need_confirmation';
    }
    if (['success', 'succeeded'].includes(bizStatus)) return 'succeeded';
    if (['failed', 'error'].includes(bizStatus)) return 'failed';

    return s ? 'partial' : 'succeeded';
}

/**
 * 按技能的 output_schema 挑选字段，并做别名映射。
 *
 * 这是「过渡期双写」的落点（见 Skill Manifest 草案 §5）：
 * 例如隐患检测的 Dify 原生字段 total_hazards_detected，
 * 由本函数映射到 schema 字段，前端改读 schema 字段，下个迭代再统一命名。
 *
 * @param {object} data          已解析的业务数据
 * @param {object} [skill]       技能定义（取 output_schema）
 * @param {object} [aliases]     显式别名映射 {schemaField: difyField}
 * @returns {{data: object, unmapped: string[]}}
 */
export function mapToSchema(data, skill, aliases = {}) {
    const schema = skill?.output_schema;
    if (!schema?.properties || !data) return { data: data || {}, unmapped: [] };

    const allowed = Object.keys(schema.properties);
    // 别名反向表：difyField → schemaField
    const reverse = {};
    for (const [schemaField, difyField] of Object.entries(aliases)) {
        reverse[difyField] = schemaField;
    }

    const result = {};
    const unmapped = [];

    for (const [k, v] of Object.entries(data)) {
        if (allowed.includes(k)) {
            result[k] = v;
        } else if (reverse[k]) {
            result[reverse[k]] = v;
        } else {
            unmapped.push(k);
        }
    }

    // 未映射到的字段不丢弃 —— 放进 _extra，避免信息损失（但不进契约）
    if (unmapped.length > 0) {
        result._extra = unmapped.reduce((acc, k) => {
            acc[k] = data[k];
            return acc;
        }, {});
    }

    return { data: result, unmapped };
}

/**
 * 生成用户可直接看的简短结论（文档 09 §3 要求 summary 必填）。
 * 优先用工作流自己给的 summary，其次按技能类型兜底组合。
 * @param {object} data
 * @param {object} [skill]
 * @param {string} [fallbackText]
 */
export function buildSummary(data, skill, fallbackText) {
    if (!data) return fallbackText || '';

    for (const key of ['summary', 'conclusion', 'result_summary', 'overview']) {
        const v = data[key];
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    // chat 类返回的 answer 本身就是摘要
    for (const key of ['answer', 'content', 'text']) {
        const v = data[key];
        if (typeof v === 'string' && v.trim() && v.trim().length <= 200) return v.trim();
    }
    if (fallbackText) return fallbackText;

    const n = Object.keys(data).length;
    return n > 0 ? `已完成「${skill?.name || '任务'}」，产出 ${n} 个字段。` : `已完成「${skill?.name || '任务'}」。`;
}

/**
 * 归一化 Dify Workflow 的返回。
 *
 * @param {object} params
 * @param {unknown} params.raw             HTTP 响应体（任意形态）
 * @param {object} [params.skill]          技能定义
 * @param {string} [params.binding_key]
 * @param {number} [params.duration_ms]
 * @param {object} [params.aliases]        字段别名映射
 * @returns {object} 文档 04 §5 标准输出
 */
export function normalizeWorkflowResult({ raw, skill, binding_key, duration_ms, aliases } = {}) {
    const body = raw && typeof raw === 'object' ? /** @type {Record<string, any>} */ (raw) : {};
    const { outputs, path } = extractOutputs(body);

    // outputs 的值经常是 JSON 字符串，逐字段尝试解析
    const expanded = {};
    for (const [k, v] of Object.entries(outputs)) {
        expanded[k] = parseMaybeJson(v);
    }

    // 如果只有单个字段且解析出对象，展开它（Dify 常见：outputs = { result: {…} }）
    // 包装键记进 metrics 供排查，**不混入业务数据** —— 否则它会变成 _extra 污染契约
    let candidate = expanded;
    let wrappedIn = null;
    const keys = Object.keys(expanded);
    if (keys.length === 1 && expanded[keys[0]] && typeof expanded[keys[0]] === 'object' && !Array.isArray(expanded[keys[0]])) {
        candidate = { .../** @type {object} */ (expanded[keys[0]]) };
        wrappedIn = keys[0];
    }

    const { data, unmapped } = mapToSchema(candidate, skill, aliases || {});

    const rawStatus = body?.data?.status ?? body?.status;
    const status = mapStatus(rawStatus, expanded);

    const warnings = [];
    if (unmapped.length > 0) {
        warnings.push(`以下字段不在 output_schema 中，已收进 _extra：${unmapped.join(', ')}`);
    }
    const rawError = body?.data?.error ?? body?.error;
    if (rawError) warnings.push(`工作流返回了 error 字段：${String(rawError).slice(0, 200)}`);

    return {
        status,
        summary: buildSummary(candidate, skill, body?.data?.summary),
        data,
        artifacts: [],
        warnings,
        metrics: {
            provider_duration_ms: duration_ms ?? body?.data?.elapsed_time_ms ?? null,
            total_tokens: body?.data?.total_tokens ?? null,
            workflow_run_id: body?.data?.id ?? body?.workflow_run_id ?? null,
            output_path: path, // 诊断用：这条响应是从哪个路径取到 outputs 的
            wrapped_in: wrappedIn, // 诊断用：业务数据被包在哪一层（如 result / text）
        },
    };
}

/**
 * 归一化 Dify Chat（chat-messages）的返回。
 * @param {object} params
 */
export function normalizeChatResult({ raw, skill, duration_ms, conversation_id } = {}) {
    const body = raw && typeof raw === 'object' ? /** @type {Record<string, any>} */ (raw) : {};

    // chat 的正文可能在 answer / message / data.answer
    const answer =
        (typeof body.answer === 'string' && body.answer) ||
        (typeof body.message === 'string' && body.message) ||
        (typeof body?.data?.answer === 'string' && body.data.answer) ||
        '';

    const convId = body.conversation_id || body?.data?.conversation_id || conversation_id || null;

    // 兼容「answer 里塞 JSON」的写法
    const parsed = parseMaybeJson(answer);
    const isStructured = parsed !== answer && typeof parsed === 'object';

    const base = isStructured
        ? { .../** @type {object} */ (parsed), conversation_id: convId }
        : { answer, conversation_id: convId };

    const { data } = mapToSchema(base, skill);

    return {
        status: 'succeeded',
        summary: buildSummary(base, skill, isStructured ? undefined : answer.slice(0, 120)),
        data,
        artifacts: [],
        warnings: [],
        metrics: {
            provider_duration_ms: duration_ms ?? null,
            total_tokens: body?.metadata?.usage?.total_tokens ?? body?.data?.total_tokens ?? null,
            message_id: body.message_id ?? null,
        },
    };
}

/**
 * 从 Provider 原始错误里尽量抠出「人能看懂」的那句话（Dify 的 message 字段）。
 *
 * Dify 的 4xx 响应体形如 {"code":"invalid_param","message":"...","status":400}，
 * 但上游可能已把它包进一句话里（如 `Dify 流式对话接口返回 400：{...}`）。
 * 这里两种形态都尝试解析；解析不出来就返回空串，由调用方回退到通用文案。
 *
 * @param {string} rawMsg
 * @returns {string} 提取到的原始 message（未截断前可能很长）
 */
function extractProviderMessage(rawMsg) {
    const s = String(rawMsg || '').trim();
    if (!s) return '';
    const asJson = (t) => {
        try {
            return JSON.parse(t);
        } catch {
            return null;
        }
    };
    let obj = asJson(s);
    if (!obj) {
        // 形如 "...返回 400：{...}" —— 抠出第一个 { 到最后一个 }
        const i = s.indexOf('{');
        const j = s.lastIndexOf('}');
        if (i >= 0 && j > i) obj = asJson(s.slice(i, j + 1));
    }
    if (obj && typeof obj === 'object') {
        const m = obj.message ?? obj.error ?? obj.msg;
        if (typeof m === 'string' && m.trim()) return m.trim();
        if (m !== undefined && m !== null) {
            try {
                return JSON.stringify(m);
            } catch {
                /* ignore */
            }
        }
    }
    return '';
}

/**
 * 把 Provider 侧的错误归一化为**文档 03 §11 规定的错误码**。
 *
 * 现状问题：status 500 一律 `res.status(500).json({error: err.message})`，
 * 前端无法区分「输入不对」和「外面挂了」，也就无法给用户不同的提示。
 *
 * @param {unknown} err
 * @returns {{code: string, http_status: number, message: string, detail: string}}
 */
export function normalizeError(err) {
    const e = /** @type {any} */ (err || {});
    const status = e.status || e.statusCode || e.response?.status;
    const rawMsg = String(e.message || e.error || '未知错误');

    if (e.code === 'ETIMEDOUT' || e.code === 'ECONNABORTED' || /timeout/i.test(rawMsg)) {
        return { code: 'PROVIDER_TIMEOUT', http_status: 504, message: 'AI 服务响应超时，请稍后重试', detail: rawMsg };
    }
    if (status === 429 || e.code === 'RATE_LIMITED') {
        return { code: 'RATE_LIMITED', http_status: 429, message: '请求过于频繁，请稍后重试', detail: rawMsg };
    }
    if (status === 401 || status === 403) {
        return {
            code: 'PROVIDER_ERROR',
            http_status: 502,
            message: 'AI 服务鉴权失败，请联系管理员检查密钥配置',
            detail: rawMsg,
        };
    }
    if (status >= 400 && status < 500) {
        // 🔴 不再一律吞成「输入不满足技能要求」——把 Dify 的原始 message 透传出来，
        //   否则排查时看到的是假信息（例如真实原因是「缺少变量 category」）。
        const real = extractProviderMessage(rawMsg).slice(0, 300);
        return {
            code: 'VALIDATION_FAILED',
            http_status: 422,
            message: real ? `输入不满足技能要求：${real}` : '输入不满足技能要求',
            detail: rawMsg,
        };
    }
    if (status >= 500 || e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND') {
        return { code: 'PROVIDER_ERROR', http_status: 502, message: 'AI 服务暂时不可用，请稍后重试', detail: rawMsg };
    }
    if (String(e.code || '').startsWith('BINDING_')) {
        return { code: 'PROVIDER_ERROR', http_status: 502, message: 'AI 服务未正确配置', detail: rawMsg };
    }
    return { code: 'PROVIDER_ERROR', http_status: 502, message: '任务执行失败，请稍后重试', detail: rawMsg };
}
