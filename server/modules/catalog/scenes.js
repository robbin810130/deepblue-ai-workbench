/**
 * 业务场景定义（catalog 模块 · 唯一权威）
 *
 * 来源：文档 `00_总指导文档` §五层模型 + `06_前端页面详细PRD` 第 75 行
 *      —— 场景只允许 6 个业务场景 + 1 个系统分类（系统类不占场景名额）。
 *
 * ⚠️ 设计决策 S1：scene 是**封闭枚举**。半年后如果冒出第 7、8 个场景，
 *    说明有人绕过了这张表 —— 校验器会在启动时直接抛错拦住。
 *
 * 字段命名与文档 `09_Dify_Workflow标准模板与接入清单` §1 保持一致（snake_case）。
 */

/** @typedef {'market_customer'|'contract_tender'|'product_supply'|'content_marketing'|'enterprise_knowledge'|'business_analysis'|'system'} SceneKey */

/**
 * @typedef {Object} SceneDefinition
 * @property {SceneKey} scene_key      场景稳定标识（snake_case，发布后不可改）
 * @property {string}   name           展示名
 * @property {string}   summary        一句话说明
 * @property {string}   icon           lucide-react 图标名（前端按名取图）
 * @property {string}   theme_color    主题色（与前端 tokens.css 同名场景保持一致）
 * @property {number}   order          侧栏/导航排序
 * @property {boolean}  is_business    是否计入 6 个业务场景（false = 系统分类）
 */

/** @type {readonly SceneDefinition[]} */
export const SCENES = Object.freeze([
    {
        scene_key: 'market_customer',
        name: '市场与客户',
        summary: '市场洞察、客户分析、营销预测与复盘',
        icon: 'TrendingUp',
        theme_color: '#2F6BFF',
        order: 1,
        is_business: true,
    },
    {
        scene_key: 'contract_tender',
        name: '合同与招投标',
        summary: '合同审核、资质管理、招标与投标辅助',
        icon: 'FileText',
        theme_color: '#12B76A',
        order: 2,
        is_business: true,
    },
    {
        scene_key: 'product_supply',
        name: '商品与供应链',
        summary: '选品、商品库、报价核查、订单与物流',
        icon: 'Package',
        theme_color: '#F79009',
        order: 3,
        is_business: true,
    },
    {
        scene_key: 'content_marketing',
        name: '内容与营销',
        summary: '电商生图、视频生成、版式对比与风险检测',
        icon: 'Sparkles',
        theme_color: '#F25C9C',
        order: 4,
        is_business: true,
    },
    {
        scene_key: 'enterprise_knowledge',
        name: '企业知识',
        summary: '知识库、每日推送、会议纪要与文档起草',
        icon: 'BookOpen',
        theme_color: '#8B5CF6',
        order: 5,
        is_business: true,
    },
    {
        scene_key: 'business_analysis',
        name: '经营分析',
        summary: '业务看板、看板生成与经营建议',
        icon: 'LayoutDashboard',
        theme_color: '#06A4B5',
        order: 6,
        is_business: true,
    },
    {
        scene_key: 'system',
        name: '系统管理',
        summary: '用户、权限、个人中心、操作日志与系统配置',
        icon: 'Settings',
        theme_color: '#667085',
        order: 99,
        is_business: false,
    },
]);

/** 全部 scene_key，供校验器快速判定合法性 */
export const SCENE_KEYS = Object.freeze(SCENES.map((s) => s.scene_key));

/** 业务场景（不含系统类），前端首页/场景页使用 */
export const BUSINESS_SCENE_KEYS = Object.freeze(
    SCENES.filter((s) => s.is_business).map((s) => s.scene_key),
);

/** 按 key 取场景定义 */
export function getSceneDefinition(sceneKey) {
    return SCENES.find((s) => s.scene_key === sceneKey) || null;
}
