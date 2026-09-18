/**
 * Dify HTTP 客户端 —— **全平台唯一的 Dify 出口**
 *
 * 文档依据：
 *   - 04_Dify接入规范 §12 禁止为每个页面各写一套 Dify Client
 *   - 04_Dify接入规范 §7  平台先接收文件并保存自身对象存储，再按 Workflow 需要上传 Dify
 *   - 04_Dify接入规范 §8  超时、重试与熔断策略
 *   - 04_Dify接入规范 §10 可观测性：trace_id / skill_key / binding_version / duration_ms / status_code
 *
 * 设计要点：
 *   1. 只暴露 6 个语义化方法（上传 / 跑工作流 / 跑对话 / 查运行 / 停止 / 流式），
 *      业务代码永远不需要拼 URL、拼 header、拼 body。
 *   2. base_url 自动规范化 —— 现状里同一个变量有的带 `/chat-messages` 后缀、
 *      有的不带，代码里靠正则打补丁（`.replace(/\/chat-messages$/, '')`）纠正。
 *      这一层统一剥掉，从源头消灭「同一变量两种写法」。
 *   3. 重试严格按 §8：只重试网络错误与 5xx；4xx 一律不重试（输入错误重试没有意义）。
 *   4. 任何响应都不在这里解释业务语义 —— 那是 normalizer 的职责（关注点分离）。
 */

/** 可重试的 HTTP 状态码与错误码（文档 04 §8） */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']);

/** Dify 的端点后缀，规范化时剥掉 */
const ENDPOINT_SUFFIXES = [
    '/chat-messages',
    '/workflows/run',
    '/workflows/tasks',
    '/completion-messages',
    '/files/upload',
    '/parameters',
];

/** 默认日志器（可被宿主覆盖，如 server.js 的 winston） */
let logger = {
    info: (...args) => console.log('[provider]', ...args),
    warn: (...args) => console.warn('[provider]', ...args),
    error: (...args) => console.error('[provider]', ...args),
};

/** 注入宿主日志器 */
export function setProviderLogger(customLogger) {
    if (customLogger && typeof customLogger.info === 'function') logger = customLogger;
}

/** Provider 侧统一错误类型 */
export class ProviderError extends Error {
    constructor(message, { status = null, code = 'PROVIDER_ERROR', body = null, binding_key = null } = {}) {
        super(message);
        this.name = 'ProviderError';
        this.status = status;
        this.code = code;
        this.body = body;
        this.binding_key = binding_key;
    }
}

/**
 * 规范化 base_url：剥掉端点后缀与尾部斜杠，得到 API 根地址。
 *
 * 现状痛点：DIFY_*_API_URL 有的配成 `http://host/v1`，
 * 有的配成 `http://host/v1/chat-messages`，代码里靠 replace 打补丁。
 * 在这里一次性归一，调用方无需关心。
 *
 * @param {string} url
 * @returns {string} 形如 http://host/v1
 */
export function normalizeBaseUrl(url) {
    let u = String(url || '').trim();
    if (!u) return '';
    u = u.replace(/\/+$/, '');
    let changed = true;
    // 可能同时带多层后缀（虽然罕见），循环剥干净
    while (changed) {
        changed = false;
        for (const suffix of ENDPOINT_SUFFIXES) {
            if (u.endsWith(suffix)) {
                u = u.slice(0, -suffix.length).replace(/\/+$/, '');
                changed = true;
            }
        }
    }
    u = u.replace(/\/+(v1|v2)$/i, '/$1');
    // Dify API 恒以 /v1 为前缀：配置里若漏写（如 http://host），这里自动补全，
    // 否则调用方拼出的 http://host/files/upload 会 404
    if (!/\/v[12]$/.test(u)) u = `${u}/v1`;
    return u;
}

/** 生成 trace_id（文档 03 §1：服务端缺失时生成） */
function newTraceId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 10);
    return `t-${ts}-${rand}`;
}

/**
 * 统一请求封装：超时 / 重试 / 日志 / 错误包装
 * @param {string} url
 * @param {RequestInit} options
 * @param {object} ctx
 */
async function request(url, options, ctx) {
    const {
        timeoutMs = 120000,
        retries = 2,
        trace_id = newTraceId(),
        binding_key = 'unknown',
        skill_key = null,
        expect = 'json',
    } = ctx || {};

    let lastErr = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        const startedAt = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            const durationMs = Date.now() - startedAt;
            clearTimeout(timer);

            logger.info('provider_call', {
                trace_id,
                binding_key,
                skill_key,
                attempt,
                status_code: res.status,
                duration_ms: durationMs,
                url_path: new URL(url).pathname,
            });

            if (!res.ok) {
                const text = await res.text().catch(() => '');
                const err = new ProviderError(
                    `Dify 返回 ${res.status}：${text.slice(0, 300)}`,
                    { status: res.status, body: text.slice(0, 2000), binding_key },
                );
                // 4xx 不重试（文档 04 §8：输入错误重试没有意义）
                if (!RETRYABLE_STATUS.has(res.status) || attempt === retries) throw err;
                lastErr = err;
                const waitMs = res.status === 429
                    ? Math.min(Number(res.headers.get('retry-after') || 2) * 1000, 10000)
                    : 2 ** attempt * 500;
                await sleep(waitMs);
                continue;
            }

            if (expect === 'text') return await res.text();
            return await res.json();
        } catch (e) {
            clearTimeout(timer);
            const durationMs = Date.now() - startedAt;
            const aborted = e?.name === 'AbortError';

            if (aborted) {
                // 读取超时不自动无限重跑（文档 04 §8）
                logger.warn('provider_timeout', { trace_id, binding_key, timeout_ms: timeoutMs, duration_ms: durationMs });
                throw new ProviderError(`Provider 调用超时（${timeoutMs}ms）`, {
                    code: 'PROVIDER_TIMEOUT',
                    binding_key,
                });
            }

            if (e instanceof ProviderError) throw e;

            const code = e?.cause?.code || e?.code || 'PROVIDER_ERROR';
            const retryable = RETRYABLE_CODES.has(code);
            if (!retryable || attempt === retries) {
                throw new ProviderError(`Provider 连接失败：${e?.message || code}`, { code, binding_key });
            }
            lastErr = e;
            await sleep(2 ** attempt * 500);
        }
    }

    throw lastErr || new ProviderError('Provider 调用失败', { binding_key });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 组装鉴权头 */
function authHeaders(config) {
    return { Authorization: `Bearer ${config.api_key}` };
}

/**
 * 上传文件到 Dify（文档 04 §7）
 * @param {object} config        resolveBinding 产出的运行时配置
 * @param {{buffer: Buffer|Uint8Array, filename: string, mimeType?: string, user: string, trace_id?: string}} params
 * @returns {Promise<{id: string, name: string, size: number}>}
 */
export async function uploadFile(config, { buffer, filename, mimeType = 'application/octet-stream', user, trace_id }) {
    const base = normalizeBaseUrl(config.base_url);
    const form = new FormData();
    const blob = new Blob([buffer], { type: mimeType });
    form.append('file', blob, filename);
    form.append('user', user || 'system');

    const body = await request(
        `${base}/files/upload`,
        { method: 'POST', headers: authHeaders(config), body: form },
        {
            timeoutMs: config.timeout_ms || 120000,
            trace_id,
            binding_key: config.binding_key,
        },
    );
    return body;
}

/**
 * 跑工作流（blocking 模式）
 * @param {object} config
 * @param {{inputs: object, user: string, files?: object[], trace_id?: string, skill_key?: string}} params
 */
export async function runWorkflow(config, { inputs = {}, user, files = [], trace_id, skill_key }) {
    const base = normalizeBaseUrl(config.base_url);
    const payload = {
        inputs,
        response_mode: 'blocking',
        user: user || 'system',
    };
    if (files.length > 0) {
        payload.files = files.map((f) => ({
            type: f.type || 'document',
            transfer_method: f.transfer_method || 'local_file',
            upload_file_id: f.upload_file_id || f.id,
        }));
    }

    return request(
        `${base}/workflows/run`,
        {
            method: 'POST',
            headers: { ...authHeaders(config), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        },
        {
            timeoutMs: config.timeout_ms || 120000,
            trace_id,
            binding_key: config.binding_key,
            skill_key,
        },
    );
}

/**
 * 跑对话（chat-messages，blocking 模式）
 * @param {object} config
 * @param {{query: string, inputs?: object, user: string, conversation_id?: string, files?: object[], trace_id?: string, skill_key?: string}} params
 */
export async function runChat(config, { query, inputs = {}, user, conversation_id, files = [], trace_id, skill_key }) {
    const base = normalizeBaseUrl(config.base_url);
    const payload = {
        inputs,
        query,
        response_mode: 'blocking',
        user: user || 'system',
    };
    if (conversation_id) payload.conversation_id = conversation_id;
    if (files.length > 0) {
        payload.files = files.map((f) => ({
            type: f.type || 'document',
            transfer_method: f.transfer_method || 'local_file',
            upload_file_id: f.upload_file_id || f.id,
        }));
    }

    return request(
        `${base}/chat-messages`,
        {
            method: 'POST',
            headers: { ...authHeaders(config), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        },
        {
            timeoutMs: config.timeout_ms || 120000,
            trace_id,
            binding_key: config.binding_key,
            skill_key,
        },
    );
}

/**
 * 流式跑工作流（SSE）—— 文档 03 §7 用于需要步骤/文本流的场景
 * @param {object} config
 * @param {{inputs?: object, user: string, files?: object[], trace_id?: string, skill_key?: string, onEvent: (evt: object) => void, signal?: AbortSignal}} params
 */
export async function streamWorkflow(config, { inputs = {}, user, files = [], trace_id, skill_key, onEvent, signal }) {
    const base = normalizeBaseUrl(config.base_url);
    const payload = { inputs, response_mode: 'streaming', user: user || 'system' };
    if (files.length > 0) {
        payload.files = files.map((f) => ({
            type: f.type || 'document',
            transfer_method: f.transfer_method || 'local_file',
            upload_file_id: f.upload_file_id || f.id,
        }));
    }

    const res = await fetch(`${base}/workflows/run`, {
        method: 'POST',
        headers: { ...authHeaders(config), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
    });

    if (!res.ok || !res.body) {
        throw new ProviderError(`Dify 流式接口返回 ${res.status}`, { status: res.status, binding_key: config.binding_key });
    }

    logger.info('provider_stream_start', { trace_id, binding_key: config.binding_key, skill_key });

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE 以 \n\n 分隔事件
        let sep;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const chunk = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const line = chunk.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === '[DONE]') continue;
            try {
                onEvent(JSON.parse(raw));
            } catch {
                onEvent({ event: 'raw', data: raw });
            }
        }
    }
    logger.info('provider_stream_end', { trace_id, binding_key: config.binding_key, skill_key });
}

/**
 * 查询工作流运行状态（文档 04 §9 首版后台轮询的落点）
 * @param {object} config
 * @param {string} runId
 */
export async function getWorkflowRun(config, runId, { trace_id } = {}) {
    const base = normalizeBaseUrl(config.base_url);
    return request(
        `${base}/workflows/run/${encodeURIComponent(runId)}`,
        { method: 'GET', headers: authHeaders(config) },
        { timeoutMs: 30000, trace_id, binding_key: config.binding_key, retries: 1 },
    );
}

/**
 * 停止工作流任务
 * @param {object} config
 * @param {string} taskId
 * @param {string} user
 */
export async function stopWorkflow(config, taskId, user, { trace_id } = {}) {
    const base = normalizeBaseUrl(config.base_url);
    return request(
        `${base}/workflows/tasks/${encodeURIComponent(taskId)}/stop`,
        {
            method: 'POST',
            headers: { ...authHeaders(config), 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: user || 'system' }),
        },
        { timeoutMs: 30000, trace_id, binding_key: config.binding_key, retries: 0 },
    );
}

export { newTraceId };
