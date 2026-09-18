/**
 * Skill Manifest 字段规范（catalog 模块）
 *
 * 这是「业务场景 → 技能 → 任务 → Agent/Dify」五层模型里**技能层**的契约定义。
 * 字段名严格对齐文档 `09_Dify_Workflow标准模板与接入清单` §7 的 Skill Manifest 示例，
 * 扩展字段以 `x_` 语义收在 permission / task / legacy 三个子对象里，避免污染文档字段。
 *
 * ── 与文档的对应关系 ─────────────────────────────────────────────
 *   文档 09 §1  Skill Key  = snake_case（示例 contract_review）
 *   文档 09 §7  skill_key / name / workflow_version / execution_mode /
 *               requires_confirmation / supported_files / input_schema / output_schema
 *   文档 04 §3  Skill 是稳定业务对象，WorkflowBinding 是可替换技术实现
 *               → 本模块用 binding_key 指向 Provider 层，不直接写环境变量名
 */

/** 执行模式：文档 09 §7 execution_mode */
export const EXECUTION_MODES = Object.freeze(['async', 'blocking', 'chat']);

/**
 * 输入形态 —— 决定前端渲染哪种表单（文档 03 §4 /skills/{key}/prepare 的落点）
 * 由 input_schema 自动推导，不单独配置，避免两处说法打架。
 */
export const INPUT_KINDS = Object.freeze(['file', 'file_multi', 'text', 'form', 'chat', 'none']);

/** 产物形态 —— 对应 task_artifact 的类型（文档 05 §9） */
export const ARTIFACT_KINDS = Object.freeze(['json', 'markdown', 'table', 'image', 'video', 'pdf', 'dashboard']);

/** 数据范围四级：文档 11 权限体系设计 */
export const DATA_SCOPES = Object.freeze(['own', 'dept', 'dept_tree', 'all']);

/**
 * @typedef {Object} SkillManifest
 * @property {string}  skill_key             唯一标识，snake_case，发布后不可改（会进任务记录）
 * @property {string}  name                  展示名（与 appRegistry.label 对齐）
 * @property {import('./scenes.js').SceneKey} scene  所属业务场景（封闭枚举）
 * @property {string}  summary               一句话说明，硬性 ≤ 2 行
 * @property {string}  icon                  lucide-react 图标名
 *
 * @property {string}  workflow_version      major.minor，文档 09 §1
 * @property {'async'|'blocking'|'chat'} execution_mode  文档 09 §7
 * @property {boolean} requires_confirmation 是否需要人工确认（文档 05 §6）
 * @property {string[]} supported_files      支持的文件扩展名（无文件则为 []）
 * @property {object}  input_schema          JSON Schema，前端据此生成表单
 * @property {object}  output_schema         JSON Schema，**消费方只允许读这个结构**
 *
 * @property {string}  binding_key           指向 providers/bindings.js 的 WorkflowBinding
 * @property {'json'|'markdown'|'table'|'image'|'video'|'pdf'|'dashboard'} artifact_kind
 *
 * @property {{code:string, data_scope:'own'|'dept'|'dept_tree'|'all'}} permission
 * @property {{trackable:boolean, idempotent:boolean}} task
 *
 * @property {boolean} live                  是否已上线；false = 幽灵技能（做完了没开门）
 * @property {{app_id?:string, routes:string[], note?:string}} [legacy]  现存实现载体，便于灰度迁移
 */

/**
 * 必填字段清单 —— 校验器逐项检查，缺一不可。
 * 这里的每一条都对应文档里的硬性要求，不是风格偏好。
 */
export const REQUIRED_FIELDS = Object.freeze([
    'skill_key',
    'name',
    'scene',
    'summary',
    'workflow_version',
    'execution_mode',
    'requires_confirmation',
    'supported_files',
    'input_schema',
    'output_schema',
    'binding_key',
    'artifact_kind',
    'permission',
    'task',
    'live',
]);

/** skill_key 命名规则：snake_case，小写字母开头，仅含小写字母/数字/下划线 */
export const SKILL_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/** workflow_version 规则：major.minor */
export const WORKFLOW_VERSION_PATTERN = /^\d+\.\d+$/;

/** 权限码规则：skill:<skill_key>:<action> */
export const PERMISSION_CODE_PATTERN = /^skill:[a-z0-9_]+:[a-z_]+$/;

/**
 * 约定值：binding_key = 'internal' 表示该技能由平台自身实现，没有外部 Provider。
 * 系统类技能（用户/权限/个人中心/审计）与纯聚合类技能使用该值。
 */
export const INTERNAL_BINDING = 'internal';

/**
 * 从 input_schema 推导输入形态，避免「配置说一套、Schema 写另一套」。
 * @param {Partial<SkillManifest>} manifest
 * @returns {'file'|'file_multi'|'text'|'form'|'chat'|'none'}
 */
export function inferInputKind(manifest) {
    const schema = manifest?.input_schema;
    if (!schema || typeof schema !== 'object') return 'none';

    const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    const keys = Object.keys(props);
    if (keys.length === 0) return 'none';

    if (props.files || props.file_ids) return 'file_multi';
    if (props.file) return 'file';
    if (props.message || props.query || props.prompt) return 'chat';
    if (manifest.execution_mode === 'chat') return 'chat';
    if (props.text && keys.length === 1) return 'text';
    return 'form';
}
