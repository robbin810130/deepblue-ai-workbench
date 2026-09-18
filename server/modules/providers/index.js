/**
 * providers 模块出口 —— 统一执行入口
 *
 * 文档 07 §4 定义的 Service 编排职责中，**Provider 这一段**由本模块承担：
 *     resolve WorkflowBinding → provider.run_workflow() → normalize result
 * 任务状态机、TaskRun 落库、事件与产物属于 tasks 模块（P2 阶段），不在这里。
 *
 * 业务代码的正确写法：
 *     import { runSkill } from '../modules/providers/index.js';
 *     const result = await runSkill('contract_review', { inputs, files, user });
 *
 * ❌ 禁止的写法（现状有 114 处）：
 *     fetch(process.env.DIFY_XXX_API_URL || 'http://39.108.221.22/v1/chat-messages', ...)
 */

import { getSkill } from '../catalog/index.js';
import { resolveBinding, checkAllBindings, listBindings, getBinding, BINDINGS, PROVIDER_TYPES } from './bindings.js';
import * as difyProvider from './difyProvider.js';
import * as arkProvider from './arkProvider.js';
import { ProviderError, newTraceId, normalizeBaseUrl, setProviderLogger } from './difyClient.js';
import {
    normalizeWorkflowResult,
    normalizeChatResult,
    normalizeError,
    extractOutputs,
    mapStatus,
    mapToSchema,
    parseMaybeJson,
} from './normalizer.js';

/**
 * 执行一个技能 —— 平台**唯一**的 AI 调用入口。
 *
 * @param {string} skillKey   技能 key（catalog 注册表中登记过）
 * @param {object} standardInput  标准输入（文档 04 §4）
 * @param {string} [standardInput.task_id]
 * @param {{id:string, name:string}} [standardInput.user]
 * @param {object} [standardInput.inputs]
 * @param {Array} [standardInput.files]
 * @param {{trace_id?:string, locale?:string}} [standardInput.context]
 * @param {object} [options]
 * @param {string} [options.binding_key]  覆盖默认绑定（如 risk_detection 按 scope 分流到 .rnd）
 * @returns {Promise<object>} 标准输出（文档 04 §5）
 */
export async function runSkill(skillKey, standardInput = {}, options = {}) {
    // ── 1. 技能必须存在（文档 03 §11 无权限/不存在一律不可见）──────
    const skill = getSkill(skillKey);
    if (!skill) {
        const err = new Error(`技能不存在：${skillKey}`);
        err.code = 'RESOURCE_NOT_FOUND';
        err.http_status = 404;
        throw err;
    }

    // ── 2. 解析绑定（缺配置就在这里明确失败，绝不静默回退）────────
    const bindingKey = options.binding_key || skill.binding_key;
    const resolved = resolveBinding(bindingKey);
    if (!resolved.ok) {
        const err = new Error(resolved.reason);
        err.code = 'BINDING_INCOMPLETE';
        err.http_status = 502;
        err.missing = resolved.missing;
        err.binding_key = bindingKey;
        throw err;
    }
    const config = resolved.config;

    // ── 3. 按 Provider 分派 ─────────────────────────────────────
    if (config.provider === 'internal') {
        const err = new Error(
            `技能「${skill.name}」为平台内部实现（binding_key=internal），不经 Provider 调用。` +
                `请直接调用对应业务接口。`,
        );
        err.code = 'VALIDATION_FAILED';
        err.http_status = 422;
        throw err;
    }

    const providerImpl = config.provider === 'ark' ? arkProvider : difyProvider;

    // ── 4. 补齐标准输入的上下文 ─────────────────────────────────
    const enriched = {
        task_id: standardInput.task_id || null,
        user: standardInput.user || { id: 'system', name: 'system' },
        inputs: standardInput.inputs || {},
        files: standardInput.files || [],
        context: {
            locale: 'zh-CN',
            ...(standardInput.context || {}),
            trace_id: standardInput.context?.trace_id || newTraceId(),
        },
    };

    return providerImpl.execute(config, skill, enriched);
}

/**
 * 绑定与配置体检 —— 供运维页 / 健康检查使用。
 * 不泄露任何密钥值，只报告「配没配」。
 */
export function healthCheck() {
    const report = checkAllBindings();
    const pending = listBindings({ status: 'pending' });
    return {
        ...report,
        pending_keys: pending.map((b) => b.binding_key),
        provider_types: [...PROVIDER_TYPES],
    };
}

export {
    // 绑定
    BINDINGS,
    getBinding,
    listBindings,
    resolveBinding,
    checkAllBindings,
    // Provider 实现
    difyProvider,
    arkProvider,
    // 底层工具（供灰度迁移期的存量代码渐进接入）
    ProviderError,
    newTraceId,
    normalizeBaseUrl,
    setProviderLogger,
    normalizeError as normalizeProviderErrorRaw,
    // 归一化
    normalizeWorkflowResult,
    normalizeChatResult,
    extractOutputs,
    mapStatus,
    mapToSchema,
    parseMaybeJson,
};
