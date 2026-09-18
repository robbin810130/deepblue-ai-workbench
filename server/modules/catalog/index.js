/**
 * catalog 模块出口 —— 业务场景与技能目录
 *
 * 文档 07 §2 定义的后端模块之一：
 *   catalog | 业务场景、技能目录 | 依赖 Workflow Binding
 *
 * 使用方式：
 *   import { listSkills, getSkill, validateSkillInput } from '../modules/catalog/index.js';
 */

export {
    ALL_SKILLS,
    listSkills,
    getSkill,
    hasSkill,
    listScenes,
    getScene,
    getStats,
    getValidationReport,
    validateSkillInput,
    toApiShape,
} from './registry.js';

export { SCENES, SCENE_KEYS, BUSINESS_SCENE_KEYS, getSceneDefinition } from './scenes.js';

export {
    EXECUTION_MODES,
    ARTIFACT_KINDS,
    DATA_SCOPES,
    INPUT_KINDS,
    inferInputKind,
} from './skillTypes.js';

export { validateSkill, validateRegistry, assertRegistryValid } from './validator.js';
