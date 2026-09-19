/**
 * WorkflowBinding 注册表 —— 技能与执行体之间的**唯一映射层**
 *
 * 文档依据：
 *   - 04_Dify接入规范 §3  Skill 是稳定业务对象，WorkflowBinding 是可替换技术实现
 *   - 04_Dify接入规范 §6  配置规范：DIFY_BASE_URL 不得硬编码
 *   - 04_Dify接入规范 §12 禁止为每个页面各写一套 Dify Client
 *   - 09 §1              版本号 major.minor
 *
 * 本层一次性解决四个现状问题：
 *   ① 97 个 DIFY_* 变量散落在 84 行配置里，与业务技能无任何关联
 *   ② 生产 IP 39.108.221.22 硬编码 40 次 / 14 个文件（漏配环境变量会把数据静默发到生产）
 *   ③ 工作流没有版本概念，改了变量名线上任务直接崩
 *   ④ 换 Dify 实例要改 14 个文件
 *
 * ⚠️ 铁律：本文件**只登记环境变量名，不登记任何真实地址与密钥**。
 *    没有默认值可以回退到公网地址 —— 缺配置就报错，绝不静默连生产。
 */

/** Provider 类型 */
export const PROVIDER_TYPES = Object.freeze(['dify', 'ark', 'internal']);

/**
 * @typedef {Object} WorkflowBinding
 * @property {string} binding_key        绑定标识（与 skill_key 同名，或复用时显式登记）
 * @property {'dify'|'ark'|'internal'} provider
 * @property {string} display_name       人类可读名（用于运维页与错误信息）
 * @property {string} [base_url_env]     主地址环境变量名
 * @property {string[]} [base_url_fallback_envs] 回退链（按顺序尝试）
 * @property {string} [api_key_env]      主密钥环境变量名
 * @property {string[]} [api_key_fallback_envs]
 * @property {'workflow'|'chat'|'file'|'none'} endpoint_kind
 * @property {string} [extra_model_env]  图像/视频类模型名环境变量
 * @property {string} version            major.minor，文档 09 §1
 * @property {number} timeout_ms
 * @property {'active'|'inactive'|'pending'} status
 * @property {string[]} [datasets]       关联的知识库（可选）
 * @property {string} [note]
 */

/** 全局回退链：仅在绑定自身未配置时使用（文档 04 §6 要求集中配置） */
const GLOBAL_URL_FALLBACKS = ['DIFY_API_BASE_URL', 'DIFY_BASE_URL'];
const GLOBAL_KEY_FALLBACKS = ['DIFY_API_KEY'];

/**
 * 全量绑定清单。
 * 顺序与 catalog 的场景顺序一致，便于人工核对。
 * @type {readonly WorkflowBinding[]}
 */
export const BINDINGS = Object.freeze([
    // ── 市场与客户 ────────────────────────────────────────────
    {
        binding_key: 'market_insight',
        provider: 'dify',
        display_name: '市场洞察',
        base_url_env: 'DIFY_MARKET_INSIGHT_API_URL',
        api_key_env: 'DIFY_MARKET_INSIGHT_API_KEY',
        endpoint_kind: 'chat',
        version: '1.0',
        timeout_ms: 120000,
        status: 'active',
    },
    {
        binding_key: 'marketing_forecast',
        provider: 'dify',
        display_name: '营销预测（月度/季度）',
        base_url_env: 'DIFY_CHATFLOW_API_URL',
        api_key_env: 'DIFY_CHATFLOW_API_KEY',
        endpoint_kind: 'chat',
        version: '1.0',
        timeout_ms: 120000,
        status: 'active',
        note: '调用前经 maskingUtils 做品牌脱敏；该工作流被多处复用，改名需评估影响面',
    },
    {
        binding_key: 'customer_analysis',
        provider: 'dify',
        display_name: '客户分析（特征提取）',
        base_url_env: 'DIFY_CUSTOMER_FEATURE_EXTRACT_API_URL',
        api_key_env: 'DIFY_CUSTOMER_FEATURE_EXTRACT_API_KEY',
        endpoint_kind: 'workflow',
        version: '1.0',
        timeout_ms: 120000,
        status: 'active',
    },
    {
        binding_key: 'marketing_analysis',
        provider: 'dify',
        display_name: '营销分析',
        base_url_env: 'DIFY_MARKETING_ANALYSIS_API_URL',
        api_key_env: 'DIFY_MARKETING_ANALYSIS_API_KEY',
        endpoint_kind: 'chat',
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
    },
    {
        binding_key: 'review_partner',
        provider: 'dify',
        display_name: '复盘搭子（主流程）',
        base_url_env: 'DIFY_REVIEW_PARTNER_API_URL',
        api_key_env: 'DIFY_REVIEW_PARTNER_API_KEY',
        endpoint_kind: 'workflow',
        version: '1.0',
        timeout_ms: 300000,
        status: 'active',
        note: '复合技能，另绑定 3 个专项工作流：review_partner.mini_program / .order_page / .transaction',
    },
    {
        binding_key: 'review_partner.mini_program',
        provider: 'dify',
        display_name: '复盘搭子 · 小程序',
        base_url_env: 'DIFY_MINI_PROGRAM_API_URL',
        api_key_env: 'DIFY_MINI_PROGRAM_API_KEY',
        endpoint_kind: 'workflow',
        version: '1.0',
        timeout_ms: 300000,
        status: 'active',
    },
    {
        binding_key: 'review_partner.order_page',
        provider: 'dify',
        display_name: '复盘搭子 · 订单页',
        base_url_env: 'DIFY_ORDER_PAGE_API_URL',
        api_key_env: 'DIFY_ORDER_PAGE_API_KEY',
        endpoint_kind: 'workflow',
        version: '1.0',
        timeout_ms: 300000,
        status: 'active',
    },
    {
        binding_key: 'review_partner.transaction',
        provider: 'dify',
        display_name: '复盘搭子 · 交易分析',
        base_url_env: 'DIFY_TRANSACTION_API_URL',
        api_key_env: 'DIFY_TRANSACTION_API_KEY',
        endpoint_kind: 'workflow',
        version: '1.0',
        timeout_ms: 300000,
        status: 'active',
    },
    {
        binding_key: 'sea_marketing',
        provider: 'dify',
        display_name: '出海营销',
        base_url_env: 'DIFY_SEA_MARKETING_API_URL',
        api_key_env: 'DIFY_SEA_MARKETING_API_KEY',
        endpoint_kind: 'chat', // 旧执行体 chat-messages（2026-09-19 试点批次修正）,
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
    },
    {
        binding_key: 'key_account',
        provider: 'dify',
        display_name: '大客户档案',
        base_url_env: 'DIFY_KA_ACCOUNT_API_URL',
        api_key_env: 'DIFY_KA_ACCOUNT_API_KEY',
        endpoint_kind: 'workflow',
        version: '1.0',
        timeout_ms: 120000,
        status: 'active',
    },

    // ── 合同与招投标 ──────────────────────────────────────────
    {
        binding_key: 'contract_review',
        provider: 'dify',
        display_name: '合同审核',
        base_url_env: 'DIFY_CONTRACT_AUDIT_API_URL',
        api_key_env: 'DIFY_CONTRACT_AUDIT_API_KEY',
        endpoint_kind: 'chat', // 旧执行体 chat-messages（SSE chatflow），2026-09-19 修正
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
        note: '★ 试点技能；另复用 rules_assistant 工作流做条款比对',
    },
    {
        binding_key: 'qualification',
        provider: 'dify',
        display_name: '资质管理',
        base_url_env: 'DIFY_QUALIFICATION_API_URL',
        api_key_env: 'DIFY_QUALIFICATION_API_KEY',
        // 2026-09-19 实测修正 workflow→chat：源应用「资质识别入库」是 advanced-chat；
        // 旧执行体 server.js 也把 env 里的 `/chat-messages` 后缀剥掉后按 chat 调用。
        // 实测 /workflows/run → 400 not_workflow_app；/chat-messages → 400 "kind is required"（形态正确）
        endpoint_kind: 'chat',
        version: '1.0',
        timeout_ms: 90000,
        status: 'active',
    },
    {
        binding_key: 'tender_search',
        provider: 'dify',
        display_name: '招标检索',
        base_url_env: 'DIFY_TENDER_SEARCH_API_URL',
        api_key_env: 'DIFY_TENDER_SEARCH_API_KEY',
        endpoint_kind: 'workflow',
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
        datasets: ['DIFY_TENDER_KNOWLEDGE_DATASET_ID'],
        note: '复合技能，另有 tender_search.detail / tender_search.result 两个子绑定',
    },
    {
        binding_key: 'tender_search.detail',
        provider: 'dify',
        display_name: '招标 · 详情解析',
        base_url_env: 'DIFY_TENDER_DETAIL_API_URL',
        api_key_env: 'DIFY_TENDER_DETAIL_API_KEY',
        endpoint_kind: 'workflow',
        version: '1.0',
        timeout_ms: 120000,
        status: 'active',
    },
    {
        binding_key: 'tender_search.result',
        provider: 'dify',
        display_name: '招标 · 结果分析',
        base_url_env: 'DIFY_TENDER_RESULT_API_URL',
        api_key_env: 'DIFY_TENDER_RESULT_API_KEY',
        endpoint_kind: 'workflow',
        version: '1.0',
        timeout_ms: 120000,
        status: 'active',
    },
    {
        binding_key: 'bid_assistant',
        provider: 'dify',
        display_name: '投标助手',
        base_url_env: 'DIFY_BID_ASSISTANT_API_URL',
        api_key_env: 'DIFY_BID_ASSISTANT_API_KEY',
        endpoint_kind: 'workflow',
        version: '1.0',
        timeout_ms: 300000,
        status: 'inactive',
        note: '🏁 2026-09-19 裁决：bidAssistantRoutes.js 为纯本地 docx 链路（解析/模板/替换/导出），全文件无 Dify 调用；catalog 亦无对应技能 —— 反向缺口，保留登记存档，不分配密钥',
    },
    {
        binding_key: 'enterprise_qualification',
        provider: 'dify',
        display_name: '企业资质库（识别）',
        base_url_env: 'DIFY_EQ_AI_RECOGNIZE_API_URL',
        api_key_env: 'DIFY_EQ_AI_RECOGNIZE_API_KEY',
        endpoint_kind: 'workflow',
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
        datasets: ['DIFY_EQ_KNOWLEDGE_DATASET_ID'],
        note: '另绑定独立资质知识库 DIFY_EQ_KNOWLEDGE_*',
    },
    {
        binding_key: 'enterprise_qualification.knowledge',
        // 🔴 2026-09-19 修正：同 knowledge_base —— 这是「资质知识库 dataset 通道」，
        //   密钥是租户级 dataset token（DIFY_EQ_KNOWLEDGE_API_KEY，源生产与主库共用同一把），
        //   真实通道是 routes 里的 /sync/trigger 往 Dify dataset 推文档（enterpriseQualificationRoutes.js:724），
        //   不是 workflows/run。原登记 workflow 会让 runSkill 打到 /workflows/run → 401/400。
        provider: 'internal',
        display_name: '企业资质库 · 知识检索',
        endpoint_kind: 'none',
        version: '1.0',
        timeout_ms: 0,
        status: 'active',
        note: '平台内部编排：走 /datasets 文档同步与检索；dataset token 由路由直读',
    },

    // ── 商品与供应链 ──────────────────────────────────────────
    {
        binding_key: 'order_recognition',
        provider: 'dify',
        display_name: '订单识别',
        base_url_env: 'DIFY_ORDER_RECOGNITION_API_URL',
        api_key_env: 'DIFY_ORDER_RECOGNITION_API_KEY',
        endpoint_kind: 'chat',
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
        note: '✅ 2026-09-19 补齐：本地 Dify(8088)「订单识别」应用（advanced-chat），/parameters 确认无输入表单变量，文件走 message files，故 endpoint_kind=chat',
    },
    {
        binding_key: 'product_entry',
        provider: 'dify',
        display_name: '商品库录入',
        base_url_env: 'DIFY_PRODUCT_ENTRY_API_URL',
        api_key_env: 'DIFY_PRODUCT_ENTRY_API_KEY',
        endpoint_kind: 'workflow',
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
    },
    {
        binding_key: 'product_selection',
        provider: 'dify',
        display_name: '选品策略',
        base_url_env: 'DIFY_PRODUCT_SELECTION_API_URL',
        api_key_env: 'DIFY_PRODUCT_SELECTION_API_KEY',
        endpoint_kind: 'workflow',
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
    },
    {
        binding_key: 'product_library',
        provider: 'dify',
        display_name: '选品库',
        base_url_env: 'DIFY_PRODUCT_LIBRARY_API_URL',
        api_key_env: 'DIFY_PRODUCT_LIBRARY_API_KEY',
        endpoint_kind: 'workflow',
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
    },
    {
        binding_key: 'quote_verify',
        provider: 'dify',
        display_name: '核查报价',
        base_url_env: 'DIFY_QUOTE_VERIFY_API_URL',
        api_key_env: 'DIFY_QUOTE_VERIFY_API_KEY',
        // 2026-09-19 实测修正 workflow→chat：源应用「物料匹配&报价审核」是 advanced-chat，
        // 源生产 env 的 DIFY_QUOTE_VERIFY_API_URL 即以 /v1/chat-messages 结尾
        endpoint_kind: 'chat',
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
        note: '另绑定文件解析工作流 quote_verify.file（该子绑定同应用，实为 chat——见其注释）',
    },
    {
        binding_key: 'quote_verify.file',
        provider: 'dify',
        display_name: '核查报价 · 文件解析',
        base_url_env: 'DIFY_QUOTE_VERIFY_FILE_API_URL',
        api_key_env: 'DIFY_QUOTE_VERIFY_FILE_API_KEY',
        file_input_var: 'quote_file', // Dify 工作流B文件输入变量名（workflows/run 需按变量名放进 inputs；chat 形态下改用顶层 files）
        // 🔴 2026-09-19 实测修正 workflow→chat，并发现**源生产此链路本就是坏的**：
        //   绑定指向的应用「物料匹配&报价审核_0818」是 advanced-chat，而旧执行体
        //   routes/quoteVerify.js:184 硬编码打 `${apiUrl}/workflows/run` → 线上必然 400 not_workflow_app。
        //   实测确认：/workflows/run → not_workflow_app；/chat-messages → 正常受理。
        endpoint_kind: 'chat',
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
        note: '文件解析；chat 形态下文件走消息附件（与 material_quote 同一应用不同入口）',
    },
    {
        binding_key: 'invoice_verify',
        provider: 'dify',
        display_name: '发票校验',
        base_url_env: 'DIFY_INVOICE_VERIFY_API_URL',
        api_key_env: 'DIFY_INVOICE_VERIFY_API_KEY',
        endpoint_kind: 'workflow',
        version: '1.0',
        timeout_ms: 90000,
        status: 'active',
        note: '★ 试点技能',
    },
    {
        binding_key: 'material_quote',
        provider: 'dify',
        display_name: '物料报价',
        base_url_env: 'DIFY_MATERIAL_QUOTE_API_URL',
        api_key_env: 'DIFY_MATERIAL_QUOTE_API_KEY',
        endpoint_kind: 'chat', // 旧执行体 chat-messages（SSE chatflow），2026-09-19 修正
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
        note: '👻 技能已于 2026-09-19 开门（live: true）（缺前端入口）；另有本地定价分析服务 pricingAnalysisService 参与计算',
    },
    {
        binding_key: 'logistics_fee',
        provider: 'dify',
        display_name: '物流费计算',
        base_url_env: 'DIFY_LOGISTICS_RECOGNIZE_API_URL',
        api_key_env: 'DIFY_LOGISTICS_RECOGNIZE_API_KEY',
        endpoint_kind: 'workflow',
        version: '1.0',
        timeout_ms: 120000,
        status: 'active',
    },
    {
        binding_key: 'beauty_rnd',
        provider: 'dify',
        display_name: '美妆研发',
        base_url_env: 'DIFY_BEAUTY_RND_API_URL',
        api_key_env: 'DIFY_BEAUTY_RND_API_KEY',
        endpoint_kind: 'chat', // 旧执行体 chat-messages（2026-09-19 试点批次修正）,
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
    },

    // ── 内容与营销 ────────────────────────────────────────────
    {
        binding_key: 'ai_image',
        provider: 'ark',
        display_name: '电商生图（火山方舟 Doubao）',
        base_url_env: 'ARK_BASE_URL',
        api_key_env: 'ARK_API_KEY',
        extra_model_env: 'ARK_IMAGE_MODEL',
        endpoint_kind: 'none',
        version: '1.0',
        timeout_ms: 300000,
        status: 'active',
        note: '⚠️ 该技能**不走 Dify**：实现直连火山方舟 Doubao（model 默认 doubao-seedream-4-5-251128），是 Provider 抽象必须支持多实现方的直接证据',
    },
    {
        binding_key: 'layout_compare',
        provider: 'dify',
        display_name: '版式对比',
        base_url_env: 'DIFY_LAYOUT_COMPARE_API_URL',
        api_key_env: 'DIFY_LAYOUT_COMPARE_API_KEY',
        endpoint_kind: 'workflow',
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
    },
    {
        binding_key: 'video_gen',
        provider: 'dify',
        display_name: '视频生成',
        base_url_env: 'DIFY_VIDEOGEN_API_URL',
        api_key_env: 'DIFY_VIDEOGEN_API_KEY',
        endpoint_kind: 'chat', // 旧执行体 chat-messages blocking（2026-09-19 修正）,
        version: '1.0',
        timeout_ms: 600000,
        status: 'active',
    },
    {
        binding_key: 'doc_copywriting',
        provider: 'dify',
        display_name: '文档文案',
        base_url_env: 'DIFY_DOC_COPYWRITING_API_URL',
        api_key_env: 'DIFY_DOC_COPYWRITING_API_KEY',
        // 2026-09-19 实测修正 workflow→chat：绑定的应用「文档起草」是 advanced-chat（与 doc_drafting 同应用）
        endpoint_kind: 'chat',
        version: '1.0',
        timeout_ms: 120000,
        status: 'inactive',
        note: '🏁 2026-09-19 裁决：全库无执行体、catalog 无对应技能（文案生成类需求由 sea_marketing 绑定「品牌出海本地化营销内容生成」覆盖）—— 反向缺口，保留登记存档',
    },
    {
        binding_key: 'risk_detection',
        provider: 'dify',
        display_name: '风险检测（电商）',
        base_url_env: 'DIFY_ECOM_RISK_API_URL',
        api_key_env: 'DIFY_ECOM_RISK_API_KEY',
        endpoint_kind: 'chat', // 旧执行体 chat-messages（2026-09-19 试点批次修正）,
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
        note: '按 scope 分流：电商线用本条，研发线用 risk_detection.rnd',
    },
    {
        binding_key: 'risk_detection.rnd',
        provider: 'dify',
        display_name: '风险检测（研发）',
        base_url_env: 'DIFY_RND_RISK_API_URL',
        api_key_env: 'DIFY_RND_RISK_API_KEY',
        endpoint_kind: 'chat', // 旧执行体 chat-messages（2026-09-19 试点批次修正）,
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
    },
    {
        binding_key: 'hazard_detection',
        provider: 'dify',
        display_name: '隐患检测',
        base_url_env: 'DIFY_API_BASE_URL',
        api_key_env: 'DIFY_API_KEY_HAZARD',
        // 旧执行体是 chat-messages（chatflow，图片走 files 参数），2026-09-19 实测修正
        endpoint_kind: 'chat',
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
        note: '该绑定只有专属密钥（DIFY_API_KEY_HAZARD），地址复用全局 DIFY_API_BASE_URL；kind=chat 与旧 dify-detect 的 chat-messages 对齐',
    },

    // ── 企业知识 ──────────────────────────────────────────────
    {
        binding_key: 'knowledge_base',
        // 🔴 2026-09-19 修正：本绑定**不是**单个 Dify 应用，是「租户级 dataset 通道」。
        //   原先登记为 provider=dify + endpoint_kind=chat，配的是 dataset token，
        //   一旦经 runSkill 执行就会 POST /v1/chat-messages → 401 unauthorized
        //   （实测确认；dataset token 只能打 /datasets/*）。
        //   真实通道：检索走 /api/knowledge/*（services/difyKnowledgeService.js，用
        //   DIFY_KNOWLEDGE_API_KEY + DIFY_KNOWLEDGE_DATASET_ID），生成复用 rules_assistant。
        provider: 'internal',
        display_name: '知识库',
        endpoint_kind: 'none',
        version: '1.0',
        timeout_ms: 0,
        status: 'active',
        note: '平台内部编排：dataset 检索 + rules_assistant 生成。相关 env（DIFY_KNOWLEDGE_API_KEY / DIFY_KNOWLEDGE_DATASET_ID）仍须配置，但由 /api/knowledge/* 直读，不属本绑定的 app 凭据',
    },
    {
        binding_key: 'daily_news',
        provider: 'dify',
        display_name: '每日推送',
        base_url_env: 'DIFY_NEWS_ANALYZE_API_URL',
        api_key_env: 'DIFY_NEWS_ANALYZE_API_KEY',
        endpoint_kind: 'chat', // 旧执行体 chat-messages（2026-09-19 试点批次修正）,
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
        note: '另绑定 daily_news.fetch（资讯抓取）',
    },
    {
        binding_key: 'daily_news.fetch',
        provider: 'dify',
        display_name: '每日推送 · 资讯抓取',
        base_url_env: 'DIFY_NEWS_API_URL',
        api_key_env: 'DIFY_NEWS_API_KEY',
        endpoint_kind: 'workflow',
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
    },
    {
        binding_key: 'meeting_minutes',
        provider: 'dify',
        display_name: '会议纪要',
        base_url_env: 'DIFY_MEETING_MINUTES_API_URL',
        api_key_env: 'DIFY_MEETING_MINUTES_API_KEY',
        endpoint_kind: 'chat', // 旧执行体 /api/meeting-minutes/summarize 是 {inputs,query,response_mode:blocking} 且读 data.answer，2026-09-19 修正 workflow→chat
        version: '1.0',
        timeout_ms: 900000,
        status: 'active',
        note: '👻 技能已于 2026-09-19 开门（live: true）；另绑定导出工作流 meeting_minutes.export。音频转写耗时长，超时放宽至 15 分钟',
    },
    {
        binding_key: 'meeting_minutes.export',
        provider: 'dify',
        display_name: '会议纪要 · 导出',
        base_url_env: 'DIFY_MEETING_MINUTES_EXPORT_API_URL',
        api_key_env: 'DIFY_MEETING_MINUTES_EXPORT_API_KEY',
        // 2026-09-19 实测修正 workflow→chat：应用「会议纪要Markdown转docx」是 advanced-chat；
        // 旧执行体 routes/meetingMinutes.js 直接 POST 该 URL（源值是 .../v1/chat-messages），
        // 请求体带 query + response_mode，读 data.files / data.answer —— 全是 chat-messages 形状。
        // 实测 /chat-messages → 200 且返回 event=message
        endpoint_kind: 'chat',
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
    },
    {
        binding_key: 'digital_employee',
        provider: 'dify',
        display_name: '数字员工',
        base_url_env: 'DIFY_DIGITAL_EMPLOYEE_API_URL',
        api_key_env: 'DIFY_DIGITAL_EMPLOYEE_API_KEY',
        endpoint_kind: 'chat',
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
        note: '👻 技能已于 2026-09-19 开门（live: true）',
    },
    {
        binding_key: 'doc_drafting',
        provider: 'dify',
        display_name: '文档起草',
        base_url_env: 'DIFY_DOC_DRAFTING_API_URL',
        api_key_env: 'DIFY_DOC_DRAFTING_API_KEY',
        endpoint_kind: 'chat', // 旧执行体 /api/doc-drafting/generate 是 {inputs:{doc_type},query,response_mode:blocking} 且读 data.answer，2026-09-19 修正 workflow→chat
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
        note: '👻 技能已于 2026-09-19 开门（live: true）',
    },
    {
        binding_key: 'rules_assistant',
        provider: 'dify',
        display_name: '公司制度助手',
        base_url_env: 'DIFY_RULES_ASSISTANT_API_URL',
        api_key_env: 'DIFY_RULES_ASSISTANT_API_KEY',
        endpoint_kind: 'chat',
        version: '1.0',
        timeout_ms: 180000,
        status: 'active',
        note: '👻 技能已于 2026-09-19 开门（live: true）；同时被 contract_review 复用做条款比对',
    },

    // ── 经营分析 ──────────────────────────────────────────────
    {
        binding_key: 'business_dashboard',
        provider: 'dify',
        display_name: '看板生成助手',
        base_url_env: 'DIFY_BUSINESS_DASHBOARD_BASE_URL',
        base_url_fallback_envs: ['DIFY_API_BASE_URL'],
        api_key_env: 'DIFY_BUSINESS_DASHBOARD_API_KEY',
        api_key_fallback_envs: ['DIFY_WORKFLOW_API_KEY'],
        endpoint_kind: 'chat', // 旧执行体为 chat-messages 透传（2026-09-19 修正）,
        version: '1.0',
        timeout_ms: 300000,
        status: 'active',
        note: '🔴 现有实现有一处硬编码 IP 回退（|| http://39.108.221.22/v1）。纳入本表后必须去掉该回退，否则客户私有化部署会静默把数据发到生产环境',
    },

    // ── 系统（平台内部实现，无外部 Provider）───────────────────
    {
        binding_key: 'internal',
        provider: 'internal',
        display_name: '平台内部实现',
        endpoint_kind: 'none',
        version: '1.0',
        timeout_ms: 0,
        status: 'active',
        note: '约定值：用户/权限/个人中心/审计/看板聚合等纯业务技能使用，不涉及任何外部 AI 调用',
    },

    // ── 已存在但暂无对应技能（反向缺口，供裁决）─────────────────
    {
        binding_key: 'order_suggestion',
        provider: 'dify',
        display_name: '订货建议',
        base_url_env: 'DIFY_ORDER_SUGGESTION_API_URL',
        api_key_env: 'DIFY_ORDER_SUGGESTION_API_KEY',
        endpoint_kind: 'chat', // 旧执行体 chat-messages streaming（XO 专项A 激活，2026-09-19；原 workflow 错标修正）
        version: '1.0',
        timeout_ms: 600000,
        status: 'active',
        note: 'XO 专项A：技能 manifest（marketCustomer.order_suggestion）+ /api/order-suggestion 试点已接入；JIT 脱敏链路保留在路由内',
    },
]);

/** binding_key → binding */
const BINDING_INDEX = new Map(BINDINGS.map((b) => [b.binding_key, b]));

/**
 * 取绑定定义（不解析环境变量）。
 * @param {string} bindingKey
 */
export function getBinding(bindingKey) {
    return BINDING_INDEX.get(bindingKey) || null;
}

/** 列出全部绑定，可筛选 */
export function listBindings(options = {}) {
    let result = [...BINDINGS];
    if (options.status) result = result.filter((b) => b.status === options.status);
    if (options.provider) result = result.filter((b) => b.provider === options.provider);
    return result;
}

/** 绑定是否存在 */
export function hasBinding(bindingKey) {
    return BINDING_INDEX.has(bindingKey);
}

/**
 * 按回退链解析环境变量（先找主变量，再依次找回退变量）。
 * @param {string} primary
 * @param {string[]} [fallbacks]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{value: string|null, from: string|null}}
 */
function resolveEnv(primary, fallbacks = [], env = process.env) {
    const chain = [primary, ...fallbacks].filter(Boolean);
    for (const name of chain) {
        const v = env[name];
        if (typeof v === 'string' && v.trim() !== '') {
            return { value: v.trim(), from: name };
        }
    }
    return { value: null, from: null };
}

/**
 * 解析绑定为**可执行的运行时配置**。
 *
 * 🔴 关键行为：解析失败时返回明确原因，**绝不回退到任何硬编码地址**。
 *    宁可调用失败并暴露配置问题，也不允许数据被静默发往生产环境。
 *
 * @param {string} bindingKey
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ok: true, config: object} | {ok: false, reason: string, missing: string[], binding: object|null}}
 */
export function resolveBinding(bindingKey, env = process.env) {
    const binding = getBinding(bindingKey);
    if (!binding) {
        return { ok: false, reason: `未登记的绑定：${bindingKey}`, missing: [], binding: null };
    }

    // internal：无需任何配置
    if (binding.provider === 'internal') {
        return {
            ok: true,
            config: { ...binding, resolved_at: new Date().toISOString() },
        };
    }

    const missing = [];

    const url = resolveEnv(
        binding.base_url_env,
        binding.base_url_fallback_envs ? [...binding.base_url_fallback_envs, ...GLOBAL_URL_FALLBACKS] : GLOBAL_URL_FALLBACKS,
        env,
    );
    if (!url.value) {
        missing.push(binding.base_url_env || 'DIFY_API_BASE_URL');
    }

    const key = resolveEnv(
        binding.api_key_env,
        binding.api_key_fallback_envs ? [...binding.api_key_fallback_envs, ...GLOBAL_KEY_FALLBACKS] : GLOBAL_KEY_FALLBACKS,
        env,
    );
    if (!key.value) {
        missing.push(binding.api_key_env || 'DIFY_API_KEY');
    }

    if (missing.length > 0) {
        return {
            ok: false,
            reason:
                `绑定 "${bindingKey}"（${binding.display_name}）缺少配置：${missing.join(', ')}。` +
                `请在 .env 中补齐后重试 —— 本平台不会回退到任何硬编码地址。`,
            missing,
            binding,
        };
    }

    return {
        ok: true,
        config: {
            ...binding,
            base_url: url.value,
            api_key: key.value,
            base_url_from: url.from,
            api_key_from: key.from,
            model: binding.extra_model_env ? resolveEnv(binding.extra_model_env, [], env).value : null,
            resolved_at: new Date().toISOString(),
        },
    };
}

/** 仅判断是否已配置（不返回密钥，供健康检查/运维页安全展示） */
export function checkBinding(bindingKey, env = process.env) {
    const binding = getBinding(bindingKey);
    if (!binding) return { binding_key: bindingKey, registered: false, ready: false };
    if (binding.provider === 'internal') {
        return { binding_key: bindingKey, registered: true, ready: true, provider: 'internal' };
    }
    const r = resolveBinding(bindingKey, env);
    return {
        binding_key: bindingKey,
        registered: true,
        ready: r.ok,
        provider: binding.provider,
        status: binding.status,
        version: binding.version,
        missing: r.ok ? [] : r.missing,
    };
}

/**
 * 全量配置体检 —— 供运维页与 selftest 使用。
 * 返回每一个绑定的就绪状态，**不泄露密钥值**。
 */
export function checkAllBindings(env = process.env) {
    const items = BINDINGS.map((b) => checkBinding(b.binding_key, env));
    return {
        total: items.length,
        ready: items.filter((i) => i.ready).length,
        // inactive（裁决存档/反向缺口）不缺 env 属预期，不计入 not_ready
        not_ready: items.filter((i) => !i.ready && i.status !== 'inactive').length,
        disabled: items.filter((i) => i.status === 'inactive').length,
        pending: items.filter((i) => i.status === 'pending').length,
        items,
    };
}
