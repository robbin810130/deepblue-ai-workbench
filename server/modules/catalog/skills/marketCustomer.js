/**
 * 技能清单 · 市场与客户（scene: market_customer）
 *
 * 来源：src/config/appRegistry.ts 实测条目 + .env.example 实测绑定
 * 说明：binding_key 指向 providers/bindings.js，不直接写环境变量名（文档 04 §3 禁止）
 */

/** @type {import('../skillTypes.js').SkillManifest[]} */
export const marketCustomerSkills = [
    {
        skill_key: 'market_insight',
        name: '市场洞察',
        scene: 'market_customer',
        summary: '输入行业或品类关键词，输出市场容量、竞争格局与机会点分析。',
        icon: 'Search',
        workflow_version: '1.0',
        execution_mode: 'blocking',
        requires_confirmation: false,
        supported_files: [],
        input_schema: {
            type: 'object',
            properties: {
                query: { type: 'string', title: '洞察主题', description: '行业 / 品类 / 关键词' },
                region: { type: 'string', title: '区域', default: '全国' },
            },
            required: ['query'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '结论摘要' },
                market_size: { type: 'string', title: '市场规模' },
                competitors: { type: 'array', items: { type: 'object' }, title: '竞争格局' },
                opportunities: { type: 'array', items: { type: 'string' }, title: '机会点' },
            },
            required: ['summary'],
        },
        binding_key: 'market_insight',
        artifact_kind: 'json',
        permission: { code: 'skill:market_insight:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: true },
        live: true,
        legacy: { app_id: 'market', routes: ['/api/market-insight'] },
    },
    {
        skill_key: 'marketing_forecast',
        name: '营销预测',
        scene: 'market_customer',
        summary: '基于历史销售与品牌数据，预测月度/季度销售走势。',
        icon: 'BarChart3',
        workflow_version: '1.0',
        execution_mode: 'blocking',
        requires_confirmation: false,
        supported_files: [],
        input_schema: {
            type: 'object',
            properties: {
                period: { type: 'string', enum: ['month', 'quarter'], title: '预测周期', default: 'month' },
                brand: { type: 'string', title: '品牌' },
                months: { type: 'integer', title: '回溯月数', default: 12 },
            },
            required: ['period'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '预测结论' },
                rows: { type: 'array', items: { type: 'object' }, title: '预测明细' },
                confidence: { type: 'number', title: '置信度' },
            },
            required: ['summary', 'rows'],
        },
        binding_key: 'marketing_forecast',
        artifact_kind: 'table',
        permission: { code: 'skill:marketing_forecast:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: {
            app_id: 'prediction',
            routes: ['/api/generate-monthly-forecast'],
            note: '绑定 DIFY_CHATFLOW_*（非独立 key），调用前经 maskingUtils 做品牌脱敏',
        },
    },
    {
        skill_key: 'customer_analysis',
        name: '客户分析',
        scene: 'market_customer',
        summary: '输入客户与交易特征，输出客户分层、价值评估与维护建议。',
        icon: 'Users',
        workflow_version: '1.0',
        execution_mode: 'blocking',
        requires_confirmation: false,
        // 🔴 不参与对话式入口（2026-09-20 P1-4 实测裁定）
        // 本技能绑定「批量整理客户名称特征映射」，其 Dify start 变量是
        //   customer_batch_json (paragraph, 必填) = [{"id":"C001","name":"某某公司"}, ...]
        // 且 LLM 提示词要求「不可遗漏任何 id、不可改变原始 id」—— 实测输出按 id 精确回填。
        // id 只能来自业务库客户表主键，所以它本质是「读全量客户 → 批量脱敏打标 → 回写」的数据作业，
        // 不是「聊一句办一件事」。单值输入在语义上不成立（没有 id，结果无处回写）。
        // → 保持表单/任务中心入口，见 legacy.routes。
        conversational: false,
        supported_files: [],
        input_schema: {
            type: 'object',
            properties: {
                customer_name: { type: 'string', title: '客户名称' },
                features: { type: 'object', title: '客户特征', description: '交易频次、金额、品类等' },
            },
            required: ['customer_name'],
        },
        output_schema: {
            type: 'object',
            properties: {
                tier: { type: 'string', enum: ['S', 'A', 'B', 'C'], title: '客户分层' },
                summary: { type: 'string', title: '分析结论' },
                suggestions: { type: 'array', items: { type: 'string' }, title: '维护建议' },
            },
            required: ['summary'],
        },
        binding_key: 'customer_analysis',
        artifact_kind: 'json',
        permission: { code: 'skill:customer_analysis:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: true },
        live: true,
        legacy: { app_id: 'customer', routes: ['/api/customer-analysis'] },
    },
    {
        skill_key: 'marketing_analysis',
        name: '营销分析',
        scene: 'market_customer',
        summary: '以对话方式追问营销数据，逐步产出可执行的分析结论。',
        icon: 'TrendingUp',
        workflow_version: '1.0',
        execution_mode: 'chat',
        requires_confirmation: false,
        supported_files: [],
        input_schema: {
            type: 'object',
            properties: {
                message: { type: 'string', title: '提问内容' },
                conversation_id: { type: 'string', title: '会话 ID', description: '多轮对话时回填' },
            },
            required: ['message'],
        },
        output_schema: {
            type: 'object',
            properties: {
                answer: { type: 'string', title: '回答（Markdown）' },
                conversation_id: { type: 'string', title: '会话 ID' },
                references: { type: 'array', items: { type: 'object' }, title: '引用来源' },
            },
            required: ['answer'],
        },
        binding_key: 'marketing_analysis',
        artifact_kind: 'markdown',
        permission: { code: 'skill:marketing_analysis:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: { app_id: 'marketing_analysis', routes: ['/api/marketing-analysis'] },
    },
    {
        skill_key: 'review_partner',
        name: '复盘搭子',
        scene: 'market_customer',
        summary: '汇总订单与交易数据，生成经营复盘看板与改进建议。',
        icon: 'BarChart3',
        workflow_version: '1.0',
        execution_mode: 'async',
        requires_confirmation: false,
        // 🔴 不参与对话式入口（2026-09-20 P1-4 实测裁定）
        // 本技能绑定「出行搭子运营数据合并（广告-专区-We分析）」，是纯数据工程 ETL：
        //   start → code 解析数据与ID匹配 → LLM 语义匹配(专区) → code 清理
        //         → LLM 语义匹配(We分析) → code 清理 → code 最终合并 → end
        // 其 Dify start 变量为 ad_json / summary_json / zone_json（必填）+ we_json（选填），
        // 代码里是 json.loads 硬解析（非 JSON 直接抛异常、整条工作流挂掉），
        // 变量 label 亦明示是「概述表数据(JSON)/广告位数据(JSON)/专区页数据(JSON)/We分析推广数据(JSON)」
        // —— 即四份不同报表的导出文件，靠 id 做多表关联后合并。
        // manifest 里原本声明的 period 是错误残留（该应用根本不需要周期）。
        // → 保留「上传多份报表」的表单入口，见 legacy.routes。
        conversational: false,
        supported_files: ['.xlsx', '.xls', '.csv'],
        input_schema: {
            type: 'object',
            properties: {
                period: { type: 'string', title: '复盘周期' },
                file: { type: 'string', format: 'binary', title: '交易数据文件' },
                focus: { type: 'string', title: '关注重点' },
            },
            required: ['period'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '复盘结论' },
                metrics: { type: 'object', title: '关键指标' },
                findings: { type: 'array', items: { type: 'object' }, title: '问题清单' },
                actions: { type: 'array', items: { type: 'string' }, title: '改进行动' },
            },
            required: ['summary'],
        },
        binding_key: 'review_partner',
        artifact_kind: 'dashboard',
        permission: { code: 'skill:review_partner:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: {
            app_id: 'review_partner',
            routes: ['/api/review-partner/*'],
            note: '复合技能：绑定 4 个工作流（主流程 + 小程序 + 订单页 + 交易），路由文件 reviewPartnerRoutes.js',
        },
    },
    {
        skill_key: 'sea_marketing',
        name: '出海营销',
        scene: 'market_customer',
        summary: '输入目标国家与品类，输出海外市场进入策略与本地化建议。',
        icon: 'Globe',
        workflow_version: '1.0',
        execution_mode: 'blocking',
        requires_confirmation: false,
        supported_files: [],
        input_schema: {
            type: 'object',
            properties: {
                country: { type: 'string', title: '目标国家/地区' },
                category: { type: 'string', title: '品类' },
                budget: { type: 'string', title: '预算区间' },
            },
            required: ['country', 'category'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '策略摘要' },
                channels: { type: 'array', items: { type: 'object' }, title: '渠道建议' },
                risks: { type: 'array', items: { type: 'string' }, title: '合规风险' },
            },
            required: ['summary'],
        },
        binding_key: 'sea_marketing',
        artifact_kind: 'markdown',
        permission: { code: 'skill:sea_marketing:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: true },
        live: true,
        legacy: { app_id: 'seamarketing', routes: ['/api/sea-marketing'] },
    },
    {
        skill_key: 'key_account',
        name: '大客户档案',
        scene: 'market_customer',
        summary: '维护大客户档案，辅助生成客户画像与拜访策略建议。',
        icon: 'Building2',
        workflow_version: '1.0',
        execution_mode: 'blocking',
        execution_mode_note:
            '迁移期保留同步调用（现有实现即为同步返回）。待任务中心落地后按文档 03 §7 迁移为 async。',
        requires_confirmation: false,
        // 2026-09-20 P1-4：Dify「大客户档案」start 节点只有 prompt 一个变量，无文件入参
        supported_files: [],
        input_schema: {
            type: 'object',
            properties: {
                // 🔴 key 必须严格等于 Dify 应用 start 节点变量名 prompt（2026-09-20 P1-4 对齐）
                // 该应用的 LLM 提示词要的是「客户原始信息」一整段（接触记录 / 基本资料 / 组织架构 /
                // 业务需求 / 技术环境 / 推进障碍 / 我方动作 / 方案），并强调「严格忠实于输入、
                // 缺失即留空填『未提供』」。
                // ⚠️ 原先声明的 account_name（只给一个客户名）会让输出满屏「未提供」，档案等于废纸。
                prompt: {
                    type: 'string',
                    title: '客户原始资料',
                    description:
                        '把这个客户的资料整段发我：公司全称 / 行业 / 规模、接触记录与阶段、组织架构与决策人、业务痛点与需求、现有系统技术环境、推进障碍、我方已做的动作与方案。缺失的部分我会留「未提供」。',
                },
            },
            required: ['prompt'],
        },
        output_schema: {
            // 2026-09-20 P1-5：原声明 summary/tags/strategy 与该应用真实输出**不一致** ——
            // 实测（本机真跑）应用返回的是一份 8 字段档案，全部落进 _extra、结果卡片渲染为空。
            // 这里按**真实输出**声明，normalizer.mapToSchema 才会把它们提到顶层供卡片展示。
            // ⚠️ output_schema 仅用于字段挑选，不强制 required —— 缺失字段填「未提供」属正常。
            type: 'object',
            properties: {
                basic_info: { type: 'string', title: '基本资料' },
                org_structure: { type: 'string', title: '组织架构' },
                presales: { type: 'string', title: '售前接触记录' },
                business_needs: { type: 'string', title: '业务需求' },
                tech_integration: { type: 'string', title: '技术对接情况' },
                presales_pain_points: { type: 'string', title: '推进障碍' },
                youshi_involvement: { type: 'string', title: '我方动作' },
                solution: { type: 'string', title: '方案' },
            },
            required: [],
        },
        binding_key: 'key_account',
        artifact_kind: 'json',
        permission: { code: 'skill:key_account:run', data_scope: 'dept_tree' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: { app_id: 'keyaccount', routes: ['/api/key-accounts/*'] },
    },
    {
        skill_key: 'order_suggestion',
        name: '订货建议',
        scene: 'market_customer',
        summary: '基于客户分层/单客户 RFM 特征，输出订货策略与补货建议。',
        icon: 'ShoppingCart',
        workflow_version: '1.0',
        execution_mode: 'blocking',
        requires_confirmation: false,
        supported_files: [],
        input_schema: {
            type: 'object',
            properties: {
                analysis_type: { type: 'string', enum: ['group_strategy', 'single_customer'], title: '分析类型' },
                tier: { type: 'string', title: '客户分层（分组策略必填）' },
                analysis_data: { type: 'string', title: '分析数据 JSON' },
            },
            required: ['analysis_type'],
        },
        output_schema: {
            type: 'object',
            properties: {
                text: { type: 'string', title: '建议文本（Markdown）' },
            },
            required: ['text'],
        },
        binding_key: 'order_suggestion',
        artifact_kind: 'markdown',
        permission: { code: 'skill:order_suggestion:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: true },
        live: true,
        legacy: { app_id: 'customer', routes: ['/api/order-suggestion'] },
    },
];