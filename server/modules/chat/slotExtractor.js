/**
 * slotExtractor —— 参数提取器（对话式改造 P1）
 *
 * 设计动机：参数提取是「对话式填表」体验的核心，但它**不能依赖 Dify**：
 *   ① Dify 侧模型可能不可用/欠费（本机实测 DeepSeek 402），业务技能会跟着一起哑掉；
 *   ② 提取是高频小任务，走业务应用会污染应用日志与配额；
 *   ③ 私有化部署（appliance）客户环境不一定有 Dify 之外的能力。
 *
 * 因此做成**可插拔 + 明确降级**：
 *   llm   —— 任何 OpenAI 兼容端点（本机 llama.cpp / 通义 / DeepSeek / Ollama…），
 *            由 WEBOS_SLOT_LLM_* 配置；未配置或调用失败 → 自动降级 rules。
 *   rules —— 纯本地规则提取（slotFilling.extractSlots），零依赖、永远可用。
 *
 * 🔴 降级绝不静默：调用方会把实际生效的 extractor 写进消息 meta，前端展示给用户。
 */

import { extractSlots } from './slotFilling.js';

const DEFAULT_TIMEOUT_MS = 8000;

/** 当前提取器配置状态（不泄露密钥） */
export function extractorStatus() {
    const baseUrl = (process.env.WEBOS_SLOT_LLM_BASE_URL || '').trim();
    const model = (process.env.WEBOS_SLOT_LLM_MODEL || '').trim();
    if (!baseUrl) {
        return {
            mode: 'rules',
            ready: false,
            model: null,
            reason: '未配置 WEBOS_SLOT_LLM_BASE_URL —— 使用本地规则提取',
        };
    }
    return {
        mode: 'llm',
        ready: true,
        model: model || 'default',
        base_url: baseUrl,
        extra_body_keys: Object.keys(extraBody()),
    };
}

/**
 * 端点专属参数（JSON 字符串，合并进请求体）。
 *
 * 为什么需要它：不同 OpenAI 兼容端点有各自的私有开关，最典型的是**通义 DashScope 的
 * qwen3 系列**——非流式调用必须显式带 `enable_thinking:false`，否则直接报错；
 * 而 llama.cpp / Ollama 这类本地端点则可能需要 `chat_template_kwargs` 等。
 * 与其为每个厂商写分支，不如留一个通用注入位。
 *
 *   WEBOS_SLOT_LLM_EXTRA_BODY={"enable_thinking":false}
 */
function extraBody() {
    const raw = (process.env.WEBOS_SLOT_LLM_EXTRA_BODY || '').trim();
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function buildPrompt({ plan, inputs, text, lastAsk }) {
    const lines = [];
    lines.push(`技能：${plan.skill_name}`);
    if (plan.summary) lines.push(`技能说明：${plan.summary}`);
    lines.push(`今天是 ${new Date().toISOString().slice(0, 10)}。`);
    lines.push('');
    lines.push('参数清单：');
    for (const s of plan.slots) {
        const meta = [];
        meta.push(s.required ? '必填' : '选填');
        meta.push(s.type);
        if (s.enum) meta.push(`枚举=${s.enum.join('|')}`);
        if (s.isFile) meta.push('文件类，无法从文本提取');
        if (s.description) meta.push(s.description);
        lines.push(`- ${s.key}（${s.title}）: ${meta.join('；')}`);
    }
    lines.push('');
    lines.push(`已收集参数：${JSON.stringify(inputs || {})}`);
    if (lastAsk && lastAsk.length) {
        lines.push(`上一轮向用户追问的参数顺序：${lastAsk.join(' → ')}`);
    }
    lines.push('');
    lines.push('用户这句话：');
    lines.push(text);
    return lines.join('\n');
}

const SYSTEM_PROMPT = [
    '你是企业 AI 平台的参数抽取器。用户正在用自然语言填写一个业务技能的参数。',
    '请从用户最新这句话中抽取参数值，返回严格 JSON。',
    '',
    '规则：',
    '1. 只输出 JSON 对象本身，不要解释、不要 markdown 代码块。',
    '2. 格式：{"inputs": {"参数key": 值}}。抽不到的 key 不要出现在结果里。',
    '3. 枚举型参数必须返回枚举内的值之一。',
    '4. 数字型返回数字（不要带单位）；数组型返回字符串数组。',
    '5. 拿不准就不要填 —— 宁可留空让系统继续追问，也不要猜。',
    '6. 若用户在按顺序回答且未指明参数名，按「上一轮追问顺序」依次对应。',
    '7. 已收集参数中已有的值，除非用户明确纠正，否则不要改动。',
    '8. 日期型参数一律换算成 YYYY-MM-DD 绝对日期（「最近一个月」「上季度」等按今天推算），不要回填口语说法。',
    '   区间类表达（「最近一个月/本季度/上个月」）要同时填起始与结束两个日期参数。',
    '9. 值应当是可直接送进接口的干净值，不要带「帮我找」「一下」这类语气词。',
].join('\n');

/** 从模型输出里抠出 JSON（容忍围栏/前后缀） */
function parseJsonLoose(s) {
    if (!s) return null;
    let t = String(s).trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
        return JSON.parse(t.slice(start, end + 1));
    } catch {
        return null;
    }
}

/**
 * LLM 提取。不可用/失败时**返回 null**，由调用方降级到规则提取。
 * @returns {Promise<{patch:object, hits:Array, extractor:'llm'} | null>}
 */
export async function llmExtract({ plan, inputs = {}, text = '', lastAsk = [], signal }) {
    const st = extractorStatus();
    if (!st.ready) return null;

    const timeoutMs = Number(process.env.WEBOS_SLOT_LLM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
        const res = await fetch(`${st.base_url.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(process.env.WEBOS_SLOT_LLM_API_KEY
                    ? { Authorization: `Bearer ${process.env.WEBOS_SLOT_LLM_API_KEY}` }
                    : {}),
            },
            body: JSON.stringify({
                model: st.model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: buildPrompt({ plan, inputs, text, lastAsk }) },
                ],
                temperature: 0,
                max_tokens: 600,
                stream: false,
                ...extraBody(),
            }),
            signal: controller.signal,
        });
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        const content = data?.choices?.[0]?.message?.content;
        const parsed = parseJsonLoose(content);
        const raw = parsed?.inputs;
        if (!raw || typeof raw !== 'object') return null;

        // 只接受计划里存在的槽位，且文件槽不接受文本值
        const patch = {};
        const hits = [];
        for (const slot of plan.slots) {
            if (slot.isFile) continue;
            const v = raw[slot.key];
            if (v === undefined || v === null || String(v).trim() === '') continue;
            if (slot.enum && !slot.enum.map(String).includes(String(v))) continue;
            patch[slot.key] = v;
            hits.push({ key: slot.key, value: v, via: 'llm' });
        }
        if (Object.keys(patch).length === 0) return null;
        return { patch, hits, extractor: 'llm' };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}

/**
 * 统一提取入口：先试 LLM，失败落规则 —— 并**如实回报**用了哪个。
 * @returns {Promise<{patch:object, hits:Array, extractor:'llm'|'rules', degraded:boolean}>}
 */
export async function extractWithFallback({ plan, inputs = {}, text = '', lastAsk = [], signal }) {
    if (extractorStatus().ready) {
        const r = await llmExtract({ plan, inputs, text, lastAsk, signal });
        if (r) return { ...r, degraded: false };
        const rules = extractSlots({ plan, inputs, text, lastAsk });
        return { ...rules, extractor: 'rules', degraded: true };
    }
    const rules = extractSlots({ plan, inputs, text, lastAsk });
    return { ...rules, extractor: 'rules', degraded: false };
}
