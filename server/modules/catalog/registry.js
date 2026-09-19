/**
 * Skill Registry —— 技能层的唯一权威数据源
 *
 * 定位（文档 00 §五层模型）：
 *   业务场景 → 【技能】 ← 本模块
 *            → 任务 → Agent/Dify
 *
 * 三类消费方：
 *   1. 前端  → GET /api/v1/skills，用于场景导航与 Schema 驱动表单
 *   2. 任务中心 → 创建任务时校验 skill_key 是否合法、输入是否满足 input_schema
 *   3. 权限模块 → 按 permission.code 判权（取代现在的「appId 数组」粗粒度模型）
 *
 * 与 appRegistry.ts 的关系：**不是替换，是分层**。
 *   appRegistry 管「桌面怎么摆」（D3 决策后该职责正在下线）；
 *   本模块管「技能是什么、吃什么、吐什么、谁能用」。
 */

import { marketCustomerSkills } from './skills/marketCustomer.js';
import { contractTenderSkills } from './skills/contractTender.js';
import { productSupplySkills } from './skills/productSupply.js';
import { contentMarketingSkills } from './skills/contentMarketing.js';
import { enterpriseKnowledgeSkills } from './skills/enterpriseKnowledge.js';
import { businessAnalysisSkills } from './skills/businessAnalysis.js';
import { systemSkills } from './skills/system.js';
import { SCENES, getSceneDefinition } from './scenes.js';
import { inferInputKind } from './skillTypes.js';
import { assertRegistryValid, validateRegistry } from './validator.js';

/** 全量技能清单（顺序 = 场景顺序） */
export const ALL_SKILLS = Object.freeze([
    ...marketCustomerSkills,
    ...contractTenderSkills,
    ...productSupplySkills,
    ...contentMarketingSkills,
    ...enterpriseKnowledgeSkills,
    ...businessAnalysisSkills,
    ...systemSkills,
]);

/** skill_key → skill 的索引 */
const SKILL_INDEX = new Map(ALL_SKILLS.map((s) => [s.skill_key, s]));

/** 启动即校验：注册表不合法直接抛错，不让带病的服务跑起来 */
const REGISTRY_STATS = assertRegistryValid([...ALL_SKILLS]);

// ─────────────────────────────────────────────────────────────
// 查询能力
// ─────────────────────────────────────────────────────────────

/**
 * 列出技能，支持多条件筛选。
 * @param {Object} [options]
 * @param {string}  [options.scene]      按场景过滤
 * @param {boolean} [options.live]       只列已上线（true）/ 只列幽灵（false）
 * @param {string}  [options.query]      按 name / skill_key / summary 模糊检索
 * @param {boolean} [options.business_only] 排除系统类
 * @returns {object[]}
 */
export function listSkills(options = {}) {
    let result = [...ALL_SKILLS];

    if (options.scene) {
        result = result.filter((s) => s.scene === options.scene);
    }
    if (typeof options.live === 'boolean') {
        result = result.filter((s) => s.live === options.live);
    }
    if (options.business_only) {
        result = result.filter((s) => s.scene !== 'system');
    }
    if (options.query) {
        const q = String(options.query).trim().toLowerCase();
        if (q) {
            result = result.filter(
                (s) =>
                    s.skill_key.toLowerCase().includes(q) ||
                    String(s.name).toLowerCase().includes(q) ||
                    String(s.summary).toLowerCase().includes(q),
            );
        }
    }
    return result;
}

/**
 * 按 skill_key 取技能定义。
 * @param {string} skillKey
 * @returns {object|null}
 */
export function getSkill(skillKey) {
    return SKILL_INDEX.get(skillKey) || null;
}

/** 技能是否存在 */
export function hasSkill(skillKey) {
    return SKILL_INDEX.has(skillKey);
}

/**
 * 列出全部场景（可选带上该场景下的技能）。
 * @param {Object} [options]
 * @param {boolean} [options.with_skills=false]
 * @param {boolean} [options.business_only=false]
 */
export function listScenes(options = {}) {
    let scenes = [...SCENES];
    if (options.business_only) {
        scenes = scenes.filter((s) => s.is_business);
    }
    if (!options.with_skills) return scenes;

    return scenes.map((scene) => {
        const skills = listSkills({ scene: scene.scene_key });
        // skill_count 与 skills 一并派生：前端场景总览卡片只需计数，
        // 缺失该字段会渲染成「0 个技能」（契约见 03_API接口规范 §4 / 06_PRD §2）。
        return { ...scene, skill_count: skills.length, skills };
    });
}

/**
 * 场景详情：场景定义 + 该场景下技能。
 * @param {string} sceneKey
 * @returns {object|null}
 */
export function getScene(sceneKey) {
    const scene = getSceneDefinition(sceneKey);
    if (!scene) return null;
    return { ...scene, skills: listSkills({ scene: sceneKey }) };
}

/** 注册表统计（供运维页 / 健康检查） */
export function getStats() {
    return { ...REGISTRY_STATS };
}

/** 完整校验报告（供 selftest / CI 消费，不抛错） */
export function getValidationReport() {
    return validateRegistry([...ALL_SKILLS]);
}

// ─────────────────────────────────────────────────────────────
// 输入校验（文档 03 §4 POST /skills/{skillKey}/prepare 的落点）
// ─────────────────────────────────────────────────────────────

/**
 * 轻量 JSON Schema 校验 —— 只覆盖本注册表实际用到的子集
 * （type / required / enum / array / object / number / integer / string）。
 *
 * 刻意不引第三方依赖：契约是自有的、字段可控，引入 ajv 反而增加供应链面。
 * 若后续 Schema 复杂度上升（allOf / $ref / 条件），再切换实现。
 *
 * @param {string} skillKey
 * @param {object} input
 * @returns {{ok: boolean, errors: {field: string, message: string}[], skill: object|null}}
 */
export function validateSkillInput(skillKey, input = {}) {
    const skill = getSkill(skillKey);
    if (!skill) {
        return { ok: false, errors: [{ field: '_skill', message: `技能不存在：${skillKey}` }], skill: null };
    }

    const schema = skill.input_schema || {};
    const errors = [];
    const props = schema.properties || {};
    const required = Array.isArray(schema.required) ? schema.required : [];

    // 必填项
    for (const field of required) {
        const v = input[field];
        const missing =
            v === undefined ||
            v === null ||
            v === '' ||
            (Array.isArray(v) && v.length === 0);
        if (missing) {
            errors.push({ field, message: `缺少必填项：${props[field]?.title || field}` });
        }
    }

    // 类型与枚举
    for (const [field, def] of Object.entries(props)) {
        const v = input[field];
        if (v === undefined || v === null) continue;

        if (Array.isArray(def.enum) && !def.enum.includes(v)) {
            errors.push({ field, message: `${field} 必须是 ${def.enum.join(' / ')} 之一，当前为 "${v}"` });
            continue;
        }

        switch (def.type) {
            case 'string':
            case 'binary':
                if (typeof v !== 'string') errors.push({ field, message: `${field} 必须是字符串` });
                break;
            case 'integer':
                if (!Number.isInteger(v)) errors.push({ field, message: `${field} 必须是整数` });
                break;
            case 'number':
                if (typeof v !== 'number' || Number.isNaN(v)) errors.push({ field, message: `${field} 必须是数字` });
                break;
            case 'boolean':
                if (typeof v !== 'boolean') errors.push({ field, message: `${field} 必须是布尔值` });
                break;
            case 'array':
                if (!Array.isArray(v)) errors.push({ field, message: `${field} 必须是数组` });
                break;
            case 'object':
                if (typeof v !== 'object' || Array.isArray(v)) errors.push({ field, message: `${field} 必须是对象` });
                break;
            default:
                break;
        }
    }

    // 文件类技能的扩展名检查（有 file 字段时）
    const kind = inferInputKind(skill);
    const fileValues = [input.file, input.files, input.file_ids].filter(Boolean);
    if ((kind === 'file' || kind === 'file_multi') && fileValues.length === 0 && required.includes('file')) {
        // 已在 required 检查里报过，这里不重复
    }

    return { ok: errors.length === 0, errors, skill };
}

/**
 * 把技能转换为**面向 API 的响应形状**（文档 03 §4）。
 * 去掉内部字段，补上派生的 input_kind，避免前端自己猜。
 * @param {object} skill
 */
export function toApiShape(skill) {
    if (!skill) return null;
    const sceneDef = getSceneDefinition(skill.scene);
    return {
        skill_key: skill.skill_key,
        name: skill.name,
        scene: skill.scene,
        scene_name: sceneDef?.name || skill.scene,
        summary: skill.summary,
        icon: skill.icon,
        workflow_version: skill.workflow_version,
        execution_mode: skill.execution_mode,
        requires_confirmation: skill.requires_confirmation,
        supported_files: skill.supported_files,
        input_kind: inferInputKind(skill),
        artifact_kind: skill.artifact_kind,
        input_schema: skill.input_schema,
        output_schema: skill.output_schema,
        permission: skill.permission,
        live: skill.live,
    };
}
