/**
 * 技能清单 · 商品与供应链（scene: product_supply）
 *
 * ⚠️ 本组含 1 个幽灵技能：
 *    material_quote（物料报价）—— 后端 3 个路由 + Dify 工作流 + 密钥全部就绪，
 *    但**没有前端组件、未在 appRegistry 注册**，用户界面上完全不可见。
 *    Manifest 里以 live:false 显式标记，让「做完了没开门」变成待办项而不是暗资产。
 */

/** @type {import('../skillTypes.js').SkillManifest[]} */
export const productSupplySkills = [
    {
        skill_key: 'order_recognition',
        name: '订单识别',
        scene: 'product_supply',
        summary: '上传订单截图或单据，自动识别订单要素并结构化入库。',
        icon: 'Package',
        workflow_version: '1.0',
        execution_mode: 'async',
        requires_confirmation: false,
        supported_files: ['.pdf', '.jpg', '.jpeg', '.png', '.xlsx'],
        input_schema: {
            type: 'object',
            properties: {
                file: { type: 'string', format: 'binary', title: '订单单据' },
                source: { type: 'string', title: '来源渠道' },
            },
            required: ['file'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '识别结论' },
                order_no: { type: 'string', title: '订单号' },
                items: { type: 'array', items: { type: 'object' }, title: '商品明细' },
                amount: { type: 'number', title: '订单金额' },
            },
            required: ['items'],
        },
        binding_key: 'order_recognition',
        artifact_kind: 'table',
        permission: { code: 'skill:order_recognition:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: {
            app_id: 'orderrecognition',
            routes: ['/api/order-recognition'],
            note: '绑定关系待 Provider 层二次确认（可能与知识库/记忆工作流共用）',
        },
    },
    {
        skill_key: 'product_entry',
        name: '商品库录入',
        scene: 'product_supply',
        summary: '上传商品资料，自动抽取字段并生成标准商品条目。',
        icon: 'Database',
        workflow_version: '1.0',
        execution_mode: 'async',
        requires_confirmation: false,
        // ⚠️ 该应用后半段走 PGSQL 工具 + HTTP 请求做「品牌自动入库」——**有写副作用**，
        //    改此技能前请确认入库目标库/表（2026-09-20 仅做静态分析，未真跑）。
        supported_files: ['.xlsx', '.xls', '.csv', '.txt'],
        // 附件 → 文本槽抽取规则（2026-09-20 P1-4）：应用只吃 goods_name_list 文本，
        // 用户在对话里上传表格时，由服务端抽出品名列拼成多行文本再注入（modules/chat/fileTextAdapter.js）。
        file_to_text: { slot: 'goods_name_list', column: 'auto' },
        input_schema: {
            type: 'object',
            properties: {
                // 🔴 key 严格等于 Dify「批量产品名提取品牌自动入库」start 变量名 goods_name_list（2026-09-20 P1-4 对齐）
                // 消费代码对格式很宽容：先试 json.loads（JSON 数组），失败则退化为按 \n 分割。
                // → 所以「批量」不需要拼 JSON，一行一个商品名即可。
                goods_name_list: {
                    type: 'string',
                    title: '商品名称列表',
                    description: '一行一个商品名；也可以直接上传 Excel/CSV，我会自动抽出商品名列。',
                },
            },
            required: ['goods_name_list'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '录入结论' },
                product: {
                    type: 'object',
                    title: '商品条目',
                    properties: {
                        name: { type: 'string' },
                        brand: { type: 'string' },
                        specs: { type: 'object' },
                        category: { type: 'string' },
                    },
                },
                missing_fields: { type: 'array', items: { type: 'string' }, title: '缺失字段' },
            },
            required: ['product'],
        },
        binding_key: 'product_entry',
        artifact_kind: 'json',
        permission: { code: 'skill:product_entry:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: { app_id: 'productentry', routes: ['/api/product-entry'] },
    },
    {
        skill_key: 'product_selection',
        name: '选品策略',
        scene: 'product_supply',
        summary: '输入选品条件或上传候选清单，输出选品建议与理由。',
        icon: 'Target',
        workflow_version: '1.0',
        execution_mode: 'async',
        requires_confirmation: false,
        supported_files: ['.xlsx', '.xls', '.csv'],
        input_schema: {
            type: 'object',
            properties: {
                file: { type: 'string', format: 'binary', title: '候选商品清单' },
                category: { type: 'string', title: '目标品类' },
                price_range: { type: 'string', title: '价格区间' },
                channels: { type: 'array', items: { type: 'string' }, title: '目标渠道' },
            },
            required: [],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '选品结论' },
                recommendations: {
                    type: 'array',
                    title: '推荐商品',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            score: { type: 'number', title: '推荐分' },
                            reason: { type: 'string', title: '推荐理由' },
                        },
                    },
                },
            },
            required: ['recommendations'],
        },
        binding_key: 'product_selection',
        artifact_kind: 'json',
        permission: { code: 'skill:product_selection:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: { app_id: 'productselectionstrategy', routes: ['/api/product-selection'] },
    },
    {
        skill_key: 'product_library',
        name: '选品库',
        scene: 'product_supply',
        summary: '维护选品库，支持按条件检索与自动打标。',
        icon: 'Package',
        workflow_version: '1.0',
        execution_mode: 'async',
        requires_confirmation: false,
        // 2026-09-20 P1-4：Dify「选品工作流」无文件入参，全部为文本/数字/枚举
        supported_files: [],
        input_schema: {
            type: 'object',
            properties: {
                // 🔴 所有 key 严格等于 Dify「选品工作流」start 节点变量名（2026-09-20 P1-4 对齐）
                // 原声明的 action(enum import|tag|search) 是残留字段，应用不认（实测发它只报「缺 query」）。
                query: {
                    type: 'string',
                    title: '选品需求',
                    description: '用一段话描述你要选什么品，例如「找适合夏天卖的便携小风扇，客单价 30 以内」。上限 2000 字。',
                },
                category_str: { type: 'string', title: '分类（选填）' },
                brand_str: { type: 'string', title: '品牌（选填）' },
                price_min: { type: 'number', title: '价格下限（选填）' },
                price_max: { type: 'number', title: '价格上限（选填）' },
                profit_min: { type: 'number', title: '毛利下限（选填）' },
                profit_max: { type: 'number', title: '毛利上限（选填）' },
                supply_mode: {
                    type: 'string',
                    enum: ['全部', '代发', '集采'],
                    title: '供货方式（选填）',
                    default: '全部',
                },
                rerank_level: {
                    type: 'string',
                    enum: ['高', '低'],
                    title: '相似度（选填）',
                    default: '高',
                },
            },
            required: ['query'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '处理结论' },
                items: { type: 'array', items: { type: 'object' }, title: '选品条目' },
                tags: { type: 'array', items: { type: 'string' }, title: '标签' },
            },
            required: ['summary'],
        },
        binding_key: 'product_library',
        artifact_kind: 'table',
        permission: { code: 'skill:product_library:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: { app_id: 'productLibrary', routes: ['/api/product-library/*'] },
    },
    {
        skill_key: 'quote_verify',
        name: '核查报价',
        scene: 'product_supply',
        summary: '上传报价单，比对基准价并标出偏差与建议价。',
        icon: 'FileSearch',
        workflow_version: '1.0',
        execution_mode: 'async',
        requires_confirmation: true,
        supported_files: ['.pdf', '.xlsx', '.xls'],
        input_schema: {
            type: 'object',
            properties: {
                file: { type: 'string', format: 'binary', title: '报价单' },
                baseline: { type: 'string', title: '基准价来源' },
            },
            required: ['file'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '核查结论' },
                matched: { type: 'boolean', title: '是否一致' },
                deviations: {
                    type: 'array',
                    title: '偏差项',
                    items: {
                        type: 'object',
                        properties: {
                            item: { type: 'string', title: '物料' },
                            quoted: { type: 'number', title: '报价' },
                            baseline: { type: 'number', title: '基准价' },
                            diff_pct: { type: 'number', title: '偏差百分比' },
                        },
                    },
                },
                suggested_price: { type: 'number', title: '建议报价' },
            },
            required: ['summary', 'matched'],
        },
        binding_key: 'quote_verify',
        artifact_kind: 'json',
        permission: { code: 'skill:quote_verify:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: true },
        live: true,
        legacy: {
            app_id: 'quoteverify',
            routes: ['/api/quote-verify/*'],
            note: '双工作流：文本比对 + 文件解析（DIFY_QUOTE_VERIFY_FILE_*）',
        },
    },
    {
        skill_key: 'invoice_verify',
        name: '发票校验',
        scene: 'product_supply',
        summary: '上传发票，校验抬头、税号、金额与明细一致性。',
        icon: 'Receipt',
        workflow_version: '1.0',
        execution_mode: 'blocking',
        execution_mode_note:
            '迁移期保留同步调用（现有实现即为同步返回，单张发票识别耗时可控）。待任务中心落地后按文档 03 §7 迁移为 async。',
        requires_confirmation: true,
        supported_files: ['.pdf', '.jpg', '.jpeg', '.png'],
        input_schema: {
            type: 'object',
            properties: {
                file: { type: 'string', format: 'binary', title: '发票文件' },
                expected_amount: { type: 'number', title: '应收金额' },
                expected_tax_no: { type: 'string', title: '应收税号' },
            },
            required: ['file'],
        },
        output_schema: {
            type: 'object',
            properties: {
                valid: { type: 'boolean', title: '是否校验通过' },
                invoice_no: { type: 'string', title: '发票号码' },
                amount: { type: 'number', title: '金额' },
                mismatches: { type: 'array', items: { type: 'string' }, title: '不一致项' },
                summary: { type: 'string', title: '结论' },
            },
            required: ['valid', 'summary'],
        },
        binding_key: 'invoice_verify',
        artifact_kind: 'json',
        permission: { code: 'skill:invoice_verify:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: true },
        live: true,
        legacy: {
            app_id: 'invoiceverify',
            routes: ['/api/invoice-verify'],
            note: '★ D4 试点技能之一：文件输入 + 结构化输出，用于验证任务闭环',
        },
    },
    {
        skill_key: 'material_quote',
        name: '物料报价',
        scene: 'product_supply',
        summary: '上传物料清单，输出成本拆解与对外报价建议。',
        icon: 'Calculator',
        workflow_version: '1.0',
        execution_mode: 'async',
        requires_confirmation: true,
        supported_files: ['.xlsx', '.xls', '.pdf'],
        input_schema: {
            type: 'object',
            properties: {
                file: { type: 'string', format: 'binary', title: '物料清单' },
                margin_target: { type: 'number', title: '目标毛利率' },
            },
            required: ['file'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '报价结论' },
                cost_breakdown: { type: 'array', items: { type: 'object' }, title: '成本拆解' },
                quoted_price: { type: 'number', title: '建议对外报价' },
                margin: { type: 'number', title: '预计毛利率' },
            },
            required: ['summary'],
        },
        binding_key: 'material_quote',
        artifact_kind: 'json',
        permission: { code: 'skill:material_quote:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: {
            app_id: null,
            routes: ['/api/material-quote/*'],
            note: '👻 幽灵技能：后端 3 个路由 + Dify 工作流（DIFY_MATERIAL_QUOTE_*）+ 定价分析服务（pricingAnalysisService）全部就绪，但缺前端组件、未在 appRegistry 注册，用户不可见。补一个 UI 即可上线。',
        },
    },
    {
        skill_key: 'logistics_fee',
        name: '物流费计算',
        scene: 'product_supply',
        summary: '输入货物与目的地参数，测算各物流方案费用与时效。',
        icon: 'Truck',
        workflow_version: '1.0',
        execution_mode: 'blocking',
        execution_mode_note:
            '运费测算为纯计算场景，无 AI 长流程，blocking 属于合理选择；文件仅用于导入报价表。',
        requires_confirmation: false,
        supported_files: ['.xlsx', '.xls'],
        input_schema: {
            type: 'object',
            properties: {
                destination: { type: 'string', title: '目的地' },
                weight: { type: 'number', title: '重量(kg)' },
                volume: { type: 'number', title: '体积(m³)' },
                file: { type: 'string', format: 'binary', title: '物流报价表' },
            },
            required: ['destination'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '测算结论' },
                options: {
                    type: 'array',
                    title: '物流方案',
                    items: {
                        type: 'object',
                        properties: {
                            carrier: { type: 'string', title: '承运商' },
                            fee: { type: 'number', title: '费用' },
                            days: { type: 'integer', title: '时效(天)' },
                        },
                    },
                },
            },
            required: ['options'],
        },
        binding_key: 'logistics_fee',
        artifact_kind: 'table',
        permission: { code: 'skill:logistics_fee:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: true },
        live: true,
        legacy: { app_id: 'logistics_fee', routes: ['/api/logistics-config/*', '/api/logistics-fee'] },
    },
    {
        skill_key: 'beauty_rnd',
        name: '美妆研发',
        scene: 'product_supply',
        summary: '输入配方或原料诉求，输出配方建议与合规提示。',
        icon: 'FlaskConical',
        workflow_version: '1.0',
        execution_mode: 'blocking',
        requires_confirmation: false,
        supported_files: [],
        input_schema: {
            type: 'object',
            properties: {
                query: { type: 'string', title: '研发诉求' },
                category: { type: 'string', title: '品类', description: '如 面霜 / 精华 / 面膜' },
                constraints: { type: 'array', items: { type: 'string' }, title: '限制条件' },
            },
            required: ['query'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '方案摘要' },
                formula: { type: 'array', items: { type: 'object' }, title: '配方建议' },
                compliance_notes: { type: 'array', items: { type: 'string' }, title: '合规提示' },
            },
            required: ['summary'],
        },
        binding_key: 'beauty_rnd',
        artifact_kind: 'markdown',
        permission: { code: 'skill:beauty_rnd:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: true },
        live: true,
        legacy: {
            app_id: 'beautyrnd',
            routes: ['/api/beauty-rnd'],
            note: '名称冲突：桌面叫「美妆研发」，权限配置 UI 叫「美妆配方」，待裁决统一',
        },
    },
];
