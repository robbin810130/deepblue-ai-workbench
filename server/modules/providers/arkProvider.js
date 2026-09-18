/**
 * ArkProvider —— 火山方舟（Doubao）实现
 *
 * 为什么平台需要第二个 Provider：
 *   「电商生图」技能实测**不走 Dify**，而是直连火山方舟 Doubao
 *   （server.js `/api/generate-image`，model 默认 doubao-seedream-4-5-251128，密钥 ARK_API_KEY）。
 *
 *   这正是文档 04 §2 把 WorkflowProvider 定义成 Protocol 而不是 DifyProvider 的原因 ——
 *   Provider 必须是可替换的实现方，否则「换模型供应商」就等于「改业务代码」。
 *
 * 当前范围说明：
 *   本实现覆盖图片生成（images/generations）这一条实际在用的路径，
 *   与 Dify 侧保持同样的「标准输入 → 标准输出」契约，业务层无需感知差异。
 */

import { ProviderError, newTraceId } from './difyClient.js';

/** 方舟默认端点（可用环境变量覆盖，绝不硬编码生产地址） */
const DEFAULT_ARK_ENDPOINT = '/api/v3/images/generations';

/**
 * 组装请求地址。base_url 可配成域名或含 /api/v3 的完整前缀。
 * @param {string} baseUrl
 */
function buildUrl(baseUrl) {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    if (!base) {
        throw new ProviderError('方舟 base_url 未配置', { code: 'BINDING_INCOMPLETE', binding_key: 'ai_image' });
    }
    if (/\/images\/generations$/.test(base)) return base;
    if (/\/api\/v\d+$/.test(base)) return `${base}/images/generations`;
    return `${base}${DEFAULT_ARK_ENDPOINT}`;
}

/**
 * 以标准输入驱动一次图像生成，返回标准输出（文档 04 §5）。
 *
 * @param {object} config resolveBinding 产出的运行时配置
 * @param {object} skill  技能定义
 * @param {object} standardInput 标准输入
 * @returns {Promise<object>} 标准输出
 */
export async function execute(config, skill, standardInput = {}) {
    const startedAt = Date.now();
    const traceId = standardInput?.context?.trace_id || newTraceId();
    const inputs = standardInput?.inputs || {};
    const files = Array.isArray(standardInput?.files) ? standardInput.files : [];

    const model = config.model || inputs.model || 'doubao-seedream-4-5-251128';
    const prompt = inputs.prompt || inputs.query || '';
    const size = inputs.size || '2048x2048';

    if (!prompt) {
        const err = new Error('缺少必填项：画面描述');
        err.code = 'VALIDATION_FAILED';
        err.http_status = 422;
        throw err;
    }

    const payload = {
        model,
        prompt,
        size,
        response_format: inputs.response_format || 'url',
    };

    // 图生图：把第一张参考图转成 data URI（现状实现同样走 base64）
    const ref = files[0];
    if (ref?.buffer) {
        const mime = ref.mimeType || 'image/jpeg';
        payload.image = `data:${mime};base64,${ref.buffer.toString('base64')}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeout_ms || 300000);

    try {
        const res = await fetch(buildUrl(config.base_url), {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.api_key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new ProviderError(`方舟返回 ${res.status}：${text.slice(0, 300)}`, {
                status: res.status,
                body: text.slice(0, 2000),
                binding_key: config.binding_key,
            });
        }

        const body = await res.json();
        const images = (body?.data || []).map((d) => ({
            url: d.url || null,
            b64: d.b64_json || null,
            width: Number(size.split('x')[0]) || null,
            height: Number(size.split('x')[1]) || null,
        }));

        return {
            status: 'succeeded',
            summary: `已生成 ${images.length} 张图片（${model} @ ${size}）。`,
            data: { images, model, size },
            artifacts: images
                .filter((i) => i.url)
                .map((i) => ({ type: 'image', name: '生成图片', url_ref: i.url })),
            warnings: [],
            metrics: {
                provider_duration_ms: Date.now() - startedAt,
                provider: 'ark',
                total_tokens: body?.usage?.total_tokens ?? null,
                trace_id: traceId,
            },
        };
    } catch (e) {
        clearTimeout(timer);
        if (e?.name === 'AbortError') {
            const err = new Error('AI 服务响应超时，请稍后重试');
            err.code = 'PROVIDER_TIMEOUT';
            err.http_status = 504;
            throw err;
        }
        throw e;
    }
}

export default { execute };
