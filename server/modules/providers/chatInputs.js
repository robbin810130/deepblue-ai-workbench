/**
 * chat 类技能的「对话式入参契约」（对话式改造 P0-1）
 *
 * 背景（2026-09-20 端到端复验实测）：
 *   chat 类技能（chatflow / advanced-chat）此前一律以 `inputs: {}` 直连 Dify，
 *   但 10 个 chat 应用的 **start 节点声明了必填变量**。Dify 在 streaming 模式下
 *   遇到缺参 **既不回 error、也不关连接**，只反复发 `event: ping` —— 前端只能干等
 *   到读超时（实测 90~240s），用户看到的就是「一直思考中，最后失败」。
 *
 * 因此这里为这些应用显式声明入参契约，交给对话式收集器（modules/chat/slotFilling）
 * 在聊天里问齐，再随 /chat-messages 一并下发。
 *
 * 🔴 铁律
 *   1. `key` 必须与 **Dify 应用 start 节点的变量名严格一致** —— 否则 Dify 会回
 *      `invalid_param`（缺参/多参同样报错）。改这里前先用复验报告里的 SQL 核对。
 *   2. 未在此声明的 chat 应用 **保持原样**（空 inputs 直连），不要凭技能 input_schema
 *      推断 —— 技能 schema 与 Dify 应用变量名并不同源（例如 market_insight 技能写
 *      query/region，而应用实际要 category/timeRange）。
 *   3. 只做「对话收集」，不做业务值校验。
 *
 * 数据来源：本地 Dify 库 `workflows.graph` 的 start 节点（version='draft'），
 * 与 apps/api_tokens 按令牌对齐绑定。核对 SQL：
 *   SELECT a.name, v->>'variable', (v->>'required')::bool
 *   FROM apps a JOIN workflows w ON w.app_id=a.id AND w.version='draft',
 *        jsonb_array_elements(w.graph::jsonb->'nodes') n,
 *        jsonb_array_elements(COALESCE(n->'data'->'variables','[]'::jsonb)) v
 *   WHERE n->'data'->>'type'='start';
 */

/**
 * @typedef {object} ChatInput
 * @property {string} key        Dify 应用 start 节点变量名（严格一致）
 * @property {string} title      对话里展示的中文名
 * @property {boolean} [required] 是否必填（对应 Dify 的 required）
 * @property {string} [type]     string | number | integer | array | file
 */

/** @type {Record<string, ChatInput[]>} binding_key → 入参契约 */
export const CHAT_INPUTS = {
    // 深蓝AI_市场洞察/爆款分析
    market_insight: [
        { key: 'category', title: '目标品类', required: true },
        { key: 'timeRange', title: '时间范围', required: true, description: '如「最近三个月」「2026 Q2」' },
        { key: 'channel', title: '渠道' },
        { key: 'priceRange', title: '价格区间' },
        { key: 'sellingPoint', title: '核心卖点' },
        { key: 'userGroup', title: '目标人群' },
        { key: 'extra', title: '补充说明' },
    ],
    // 深蓝AI_商品月度/季度销售分析
    chatflow: [
        { key: 'current_date', title: '数据日期', required: true, format: 'date' },
        { key: 'data_summary', title: '数据摘要', required: true },
    ],
    // 深蓝AI_品牌出海本地化营销内容生成
    sea_marketing: [
        { key: 'product_name', title: '产品名称', required: true },
        { key: 'product_info', title: '产品信息', required: true },
        { key: 'target_market', title: '目标市场', required: true },
        { key: 'target_language', title: '目标语言', required: true },
        { key: 'target_platform', title: '目标平台', required: true },
        { key: 'marketing_style', title: '营销风格', required: true },
        { key: 'ingredient', title: '成分 / 配方' },
    ],
    // 资质识别入库
    qualification: [
        { key: 'kind', title: '识别类型', required: true },
    ],
    // 深蓝AI_美妆智能研发
    beauty_rnd: [
        { key: 'product_type', title: '产品类型', required: true },
        { key: 'product_form', title: '产品形态', required: true },
        { key: 'skin_type', title: '适用肤质', required: true },
        { key: 'target_market', title: '目标市场', required: true },
        { key: 'pain_point', title: '用户痛点', required: true },
        { key: 'data_source', title: '数据来源', required: true },
        { key: 'blacklist', title: '禁用成分' },
        { key: 'cert_require', title: '认证要求' },
        { key: 'cost_limit', title: '成本上限' },
    ],
    // 文档起草（复制写 / 起草两个绑定指向同一应用）
    doc_copywriting: [
        { key: 'doc_type', title: '文档类型', required: true },
    ],
    doc_drafting: [
        { key: 'doc_type', title: '文档类型', required: true },
    ],
    // 电商风险检测
    risk_detection: [
        { key: 'country', title: '国家 / 地区', required: true },
        { key: 'industry', title: '行业', required: true },
        { key: 'title', title: '主题标题' },
        { key: 'description', title: '补充描述' },
    ],
    // 配方风险检测
    rnd_risk: [
        { key: 'country', title: '国家 / 地区', required: true },
        { key: 'industry', title: '行业', required: true },
        { key: 'ingredient_text', title: '成分文本' },
    ],
    // 深蓝AI_新闻解析
    news_analyze: [
        { key: 'news_context', title: '新闻内容', required: true },
    ],
};

/**
 * 取某绑定的 chat 入参契约（无声明返回 null → 调用方保持「空 inputs 直连」旧行为）。
 * @param {string} bindingKey
 * @returns {ChatInput[]|null}
 */
export function getChatInputs(bindingKey) {
    const v = CHAT_INPUTS[bindingKey];
    return Array.isArray(v) && v.length > 0 ? v : null;
}

/** 该绑定是否需要「对话式收集」（存在必填项） */
export function needsChatCollection(bindingKey) {
    const v = getChatInputs(bindingKey);
    return !!v && v.some((s) => s.required);
}
