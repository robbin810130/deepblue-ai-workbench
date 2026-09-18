/**
 * Skill Manifest 校验器（catalog 模块）
 *
 * 两条使用路径：
 *   1. 启动期 `assertRegistryValid()` —— 有任何 error 直接抛错，**不让带病的注册表起服务**
 *   2. 开发期 `validateRegistry()` —— 返回结构化报告，供 selftest / CI 消费
 *
 * 校验的每一条都对应文档里的硬性约束，不是风格检查：
 *   - 文档 09 §1  skill_key 必须 snake_case，发布后不可改（会进任务记录）
 *   - 文档 09 §7  execution_mode / requires_confirmation / supported_files 是必填
 *   - 文档 04 §1  Dify 返回必须转换为平台标准输出 → output_schema 必填（否则又回到「15 种写法」）
 *   - 文档 11     数据范围四级
 */

import {
    EXECUTION_MODES,
    ARTIFACT_KINDS,
    DATA_SCOPES,
    REQUIRED_FIELDS,
    SKILL_KEY_PATTERN,
    WORKFLOW_VERSION_PATTERN,
    PERMISSION_CODE_PATTERN,
    INTERNAL_BINDING,
    inferInputKind,
} from './skillTypes.js';
import { SCENE_KEYS } from './scenes.js';

/** 判断是否为一个「像样的」JSON Schema 对象 */
function isPlainSchema(node) {
    return node && typeof node === 'object' && !Array.isArray(node);
}

/**
 * 校验单个 manifest。
 * @param {import('./skillTypes.js').SkillManifest} manifest
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateSkill(manifest) {
    const errors = [];
    const warnings = [];
    const where = manifest?.skill_key || '<未命名技能>';

    if (!manifest || typeof manifest !== 'object') {
        return { errors: ['manifest 不是对象'], warnings };
    }

    // ── 1. 必填字段 ────────────────────────────────────────────
    for (const field of REQUIRED_FIELDS) {
        const v = manifest[field];
        if (v === undefined || v === null || v === '') {
            errors.push(`${where}: 缺少必填字段 ${field}`);
        }
    }

    // ── 2. skill_key ───────────────────────────────────────────
    if (typeof manifest.skill_key === 'string') {
        if (!SKILL_KEY_PATTERN.test(manifest.skill_key)) {
            errors.push(
                `${where}: skill_key 必须是 snake_case（小写字母开头，仅含小写字母/数字/下划线），当前 "${manifest.skill_key}"`,
            );
        }
        if (manifest.skill_key.length > 64) {
            errors.push(`${where}: skill_key 过长（>64）`);
        }
    }

    // ── 3. scene 封闭枚举 ──────────────────────────────────────
    if (manifest.scene !== undefined && !SCENE_KEYS.includes(manifest.scene)) {
        errors.push(
            `${where}: scene "${manifest.scene}" 不在允许的 6+1 场景枚举内。` +
                `允许值：${SCENE_KEYS.join(' / ')}`,
        );
    }

    // ── 4. execution_mode / requires_confirmation ──────────────
    if (manifest.execution_mode !== undefined && !EXECUTION_MODES.includes(manifest.execution_mode)) {
        errors.push(`${where}: execution_mode 必须是 ${EXECUTION_MODES.join('/')}`);
    }
    if (manifest.requires_confirmation !== undefined && typeof manifest.requires_confirmation !== 'boolean') {
        errors.push(`${where}: requires_confirmation 必须是 boolean`);
    }

    // ── 5. supported_files ─────────────────────────────────────
    if (manifest.supported_files !== undefined) {
        if (!Array.isArray(manifest.supported_files)) {
            errors.push(`${where}: supported_files 必须是数组`);
        } else if (manifest.supported_files.some((e) => typeof e !== 'string' || !e.startsWith('.'))) {
            errors.push(`${where}: supported_files 元素必须是带点的扩展名（如 ".pdf"）`);
        }
    }

    // ── 6. input_schema / output_schema ────────────────────────
    if (!isPlainSchema(manifest.input_schema)) {
        errors.push(`${where}: input_schema 必须是 JSON Schema 对象`);
    }
    if (!isPlainSchema(manifest.output_schema)) {
        errors.push(`${where}: output_schema 必须是 JSON Schema 对象`);
    } else if (!manifest.output_schema.properties || Object.keys(manifest.output_schema.properties).length === 0) {
        // 决策 S2：输出契约必填。空 schema 等于没有契约，会重新退化成「谁爱怎么读就怎么读」。
        errors.push(`${where}: output_schema.properties 不能为空 —— 输出契约是本次重构的核心，必须显式声明`);
    }

    // ── 7. 输入形态自洽性 ──────────────────────────────────────
    if (isPlainSchema(manifest.input_schema)) {
        const kind = inferInputKind(manifest);
        if ((kind === 'file' || kind === 'file_multi') && (!manifest.supported_files || manifest.supported_files.length === 0)) {
            errors.push(`${where}: 输入形态为 ${kind}，但 supported_files 为空`);
        }
        if (kind === 'none' && manifest.execution_mode !== 'chat') {
            warnings.push(`${where}: input_schema 无可填字段且非 chat 模式，确认是否漏写输入契约`);
        }
        if (manifest.execution_mode === 'blocking') {
            const hasFile = kind === 'file' || kind === 'file_multi';
            // 文档 03 §7：仅短耗时、无文件、无人工节点的技能可使用 blocking。
            // 若技能已用 execution_mode_note 显式登记该偏离，则不再告警（属于有据可查的技术债务，
            // 而不是被忽略的违规）—— 待任务中心落地后统一迁移为 async。
            if (hasFile && !manifest.execution_mode_note) {
                warnings.push(
                    `${where}: execution_mode=blocking 但存在文件输入 —— 文档 03 §7 建议文件类技能走 async。` +
                        `若为迁移期的有意保留，请补 execution_mode_note 说明`,
                );
            }
        }
    }

    // ── 8. binding_key / workflow_version ──────────────────────
    if (
        typeof manifest.binding_key === 'string' &&
        manifest.binding_key !== manifest.skill_key &&
        manifest.binding_key !== INTERNAL_BINDING
    ) {
        // 允许别名，但必须显式，避免「名字对不上」的隐性耦合
        warnings.push(
            `${where}: binding_key("${manifest.binding_key}") 与 skill_key 不一致，` +
                `确认是有意复用同一个 WorkflowBinding（文档 04 §3 允许，但需登记）`,
        );
    }
    if (manifest.workflow_version !== undefined && !WORKFLOW_VERSION_PATTERN.test(String(manifest.workflow_version))) {
        errors.push(`${where}: workflow_version 必须是 major.minor（如 "1.2"）`);
    }

    // ── 9. artifact_kind ───────────────────────────────────────
    if (manifest.artifact_kind !== undefined && !ARTIFACT_KINDS.includes(manifest.artifact_kind)) {
        errors.push(`${where}: artifact_kind 必须是 ${ARTIFACT_KINDS.join('/')}`);
    }

    // ── 10. permission ─────────────────────────────────────────
    const perm = manifest.permission;
    if (perm !== undefined) {
        if (!perm || typeof perm !== 'object') {
            errors.push(`${where}: permission 必须是对象`);
        } else {
            if (!PERMISSION_CODE_PATTERN.test(String(perm.code || ''))) {
                errors.push(`${where}: permission.code 必须形如 skill:<skill_key>:<action>`);
            } else {
                const codeKey = String(perm.code).split(':')[1];
                if (codeKey !== manifest.skill_key) {
                    // 决策 S4：权限码与技能解耦必须显式，防止「能开 App = 能做所有事」重现
                    errors.push(
                        `${where}: permission.code 里的技能段 "${codeKey}" 与 skill_key "${manifest.skill_key}" 不一致`,
                    );
                }
            }
            if (!DATA_SCOPES.includes(perm.data_scope)) {
                errors.push(`${where}: permission.data_scope 必须是 ${DATA_SCOPES.join('/')}`);
            }
        }
    }

    // ── 11. task ───────────────────────────────────────────────
    const task = manifest.task;
    if (task !== undefined) {
        if (!task || typeof task !== 'object') {
            errors.push(`${where}: task 必须是对象`);
        } else {
            if (typeof task.trackable !== 'boolean') errors.push(`${where}: task.trackable 必须是 boolean`);
            if (typeof task.idempotent !== 'boolean') errors.push(`${where}: task.idempotent 必须是 boolean`);
        }
    }

    // ── 12. 幽灵技能标记 ───────────────────────────────────────
    if (manifest.live === false && !manifest.legacy?.note) {
        warnings.push(`${where}: live=false（幽灵技能）但未写 legacy.note 说明现状，后续接手的人会一头雾水`);
    }
    if (manifest.live === true && !manifest.binding_key) {
        errors.push(`${where}: 已上线技能必须有 binding_key 才能找到执行体`);
    }

    return { errors, warnings };
}

/**
 * 校验整个注册表：逐条校验 + 全局唯一性检查。
 * @param {import('./skillTypes.js').SkillManifest[]} manifests
 * @returns {{errors: string[], warnings: string[], stats: object}}
 */
export function validateRegistry(manifests) {
    const errors = [];
    const warnings = [];

    if (!Array.isArray(manifests)) {
        return { errors: ['注册表不是数组'], warnings, stats: {} };
    }

    const seenKeys = new Map();
    const seenPermCodes = new Map();

    for (const m of manifests) {
        const r = validateSkill(m);
        errors.push(...r.errors);
        warnings.push(...r.warnings);

        if (m?.skill_key) {
            if (seenKeys.has(m.skill_key)) {
                errors.push(`skill_key 重复：${m.skill_key}（注册表内必须全局唯一）`);
            }
            seenKeys.set(m.skill_key, true);
        }
        if (m?.permission?.code) {
            if (seenPermCodes.has(m.permission.code)) {
                errors.push(`permission.code 重复：${m.permission.code}`);
            }
            seenPermCodes.set(m.permission.code, true);
        }
    }

    const byScene = {};
    for (const m of manifests) {
        if (!m?.scene) continue;
        byScene[m.scene] = (byScene[m.scene] || 0) + 1;
    }

    const stats = {
        total: manifests.length,
        live: manifests.filter((m) => m?.live === true).length,
        ghost: manifests.filter((m) => m?.live === false).length,
        calls_ai: manifests.filter((m) => m?.scene !== 'system').length,
        pure_business: manifests.filter((m) => m?.scene === 'system').length,
        requires_confirmation: manifests.filter((m) => m?.requires_confirmation === true).length,
        by_scene: byScene,
    };

    return { errors, warnings, stats };
}

/** 启动期硬校验：有问题直接抛，不启动带病服务 */
export function assertRegistryValid(manifests) {
    const { errors, stats } = validateRegistry(manifests);
    if (errors.length > 0) {
        const msg = [
            '',
            '❌ Skill 注册表校验失败，服务拒绝启动：',
            ...errors.map((e) => `   · ${e}`),
            '',
            `   共 ${errors.length} 个错误。修复后重试。`,
            '',
        ].join('\n');
        const err = new Error(msg);
        err.code = 'SKILL_REGISTRY_INVALID';
        err.details = errors;
        throw err;
    }
    return stats;
}
