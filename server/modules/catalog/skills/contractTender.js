/**
 * 技能清单 · 合同与招投标（scene: contract_tender）
 *
 * ★ 含 D4 决策的试点技能：contract_review（合同审核）、qualification（资质管理）
 *   试点选取标准：文件输入 + 结构化输出，最能体现任务闭环价值。
 */

/** @type {import('../skillTypes.js').SkillManifest[]} */
export const contractTenderSkills = [
    {
        skill_key: 'contract_review',
        name: '合同审核',
        scene: 'contract_tender',
        summary: '上传合同文件，自动识别风险条款并给出修改建议。',
        icon: 'FileText',
        workflow_version: '1.0',
        execution_mode: 'async',
        requires_confirmation: true,
        supported_files: ['.pdf', '.docx', '.doc'],
        input_schema: {
            type: 'object',
            properties: {
                file: { type: 'string', format: 'binary', title: '合同文件' },
                review_focus: {
                    type: 'array',
                    items: { type: 'string' },
                    title: '审核重点',
                    description: '如 付款条款 / 违约责任 / 保密条款',
                },
                counterparty: { type: 'string', title: '对方主体' },
            },
            required: ['file'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '总体结论' },
                risk_level: { type: 'string', enum: ['high', 'medium', 'low'], title: '整体风险等级' },
                risk_items: {
                    type: 'array',
                    title: '风险条款',
                    items: {
                        type: 'object',
                        properties: {
                            level: { type: 'string', enum: ['high', 'medium', 'low'] },
                            clause: { type: 'string', title: '条款原文' },
                            issue: { type: 'string', title: '问题描述' },
                            suggestion: { type: 'string', title: '修改建议' },
                        },
                    },
                },
                reviewed_at: { type: 'string', format: 'date-time', title: '审核时间' },
            },
            required: ['summary', 'risk_items'],
        },
        binding_key: 'contract_review',
        artifact_kind: 'json',
        permission: { code: 'skill:contract_review:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: true },
        live: true,
        legacy: {
            app_id: 'contractaudit',
            routes: ['/api/contract/audit'],
            note: '高风险技能，需人工确认（文档 05 §6）；同时绑定 DIFY_RULES_ASSISTANT 做条款比对',
        },
    },
    {
        skill_key: 'qualification',
        name: '资质管理',
        scene: 'contract_tender',
        summary: '上传资质证件，自动识别证种、编号与有效期，提示到期风险。',
        icon: 'FileBadge',
        workflow_version: '1.0',
        execution_mode: 'blocking',
        execution_mode_note:
            '迁移期保留同步调用（现有实现即为同步返回）。待任务中心落地后按文档 03 §7 迁移为 async。',
        requires_confirmation: true,
        supported_files: ['.pdf', '.jpg', '.jpeg', '.png'],
        input_schema: {
            type: 'object',
            properties: {
                file: { type: 'string', format: 'binary', title: '资质证件' },
                cert_type: { type: 'string', title: '证件类型', description: '留空则自动识别' },
            },
            required: ['file'],
        },
        output_schema: {
            type: 'object',
            properties: {
                cert_type: { type: 'string', title: '证件类型' },
                cert_no: { type: 'string', title: '证件编号' },
                valid_until: { type: 'string', format: 'date', title: '有效期至' },
                confidence: { type: 'number', title: '识别置信度' },
                summary: { type: 'string', title: '结论' },
            },
            required: ['cert_type', 'summary'],
        },
        binding_key: 'qualification',
        artifact_kind: 'json',
        permission: { code: 'skill:qualification:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: true },
        live: true,
        legacy: { app_id: 'qualification', routes: ['/api/qualification/*'] },
    },
    {
        skill_key: 'tender_search',
        name: '招标',
        scene: 'contract_tender',
        summary: '按关键词检索招标信息，输出项目清单与匹配度评估。',
        icon: 'Search',
        workflow_version: '1.0',
        execution_mode: 'blocking',
        requires_confirmation: false,
        supported_files: [],
        input_schema: {
            type: 'object',
            properties: {
                keyword: { type: 'string', title: '检索关键词' },
                region: { type: 'string', title: '地区' },
                date_from: { type: 'string', format: 'date', title: '起始日期' },
                date_to: { type: 'string', format: 'date', title: '截止日期' },
            },
            required: ['keyword'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '检索结论' },
                items: {
                    type: 'array',
                    title: '招标项目',
                    items: {
                        type: 'object',
                        properties: {
                            title: { type: 'string', title: '项目名称' },
                            issuer: { type: 'string', title: '招标方' },
                            deadline: { type: 'string', title: '截止时间' },
                            match_score: { type: 'number', title: '匹配度' },
                            url: { type: 'string', title: '原文链接' },
                        },
                    },
                },
            },
            required: ['items'],
        },
        binding_key: 'tender_search',
        artifact_kind: 'table',
        permission: { code: 'skill:tender_search:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: true },
        live: true,
        legacy: {
            app_id: 'tendersearch',
            routes: ['/api/tender/*'],
            note: '复合技能：检索 / 详情 / 结果 三步各一个工作流；含招投标知识库 DIFY_TENDER_KNOWLEDGE_DATASET_ID',
        },
    },
    {
        skill_key: 'bid_assistant',
        name: '投标',
        scene: 'contract_tender',
        summary: '基于招标文件与公司资料，辅助生成投标文件要点与应答内容。',
        icon: 'FileText',
        workflow_version: '1.0',
        execution_mode: 'async',
        requires_confirmation: true,
        supported_files: ['.pdf', '.docx', '.doc', '.xlsx'],
        input_schema: {
            type: 'object',
            properties: {
                files: { type: 'array', title: '招标文件与公司资料' },
                project_name: { type: 'string', title: '项目名称' },
                sections: { type: 'array', items: { type: 'string' }, title: '需生成的章节' },
            },
            required: ['project_name'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '应答要点摘要' },
                sections: {
                    type: 'array',
                    title: '章节内容',
                    items: {
                        type: 'object',
                        properties: {
                            title: { type: 'string' },
                            content: { type: 'string', title: '正文（Markdown）' },
                        },
                    },
                },
                checklist: { type: 'array', items: { type: 'string' }, title: '提交前核对清单' },
            },
            required: ['sections'],
        },
        binding_key: 'bid_assistant',
        artifact_kind: 'markdown',
        permission: { code: 'skill:bid_assistant:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: {
            app_id: 'bidassistant',
            routes: ['/api/bid-assistant/*'],
            note: '路由文件 bidAssistantRoutes.js（42KB），绑定关系待 Provider 层登记时二次确认',
        },
    },
    {
        skill_key: 'enterprise_qualification',
        name: '企业资质库',
        scene: 'contract_tender',
        summary: '识别企业资质材料并入库，供投标与合同场景检索引用。',
        icon: 'ShieldCheck',
        workflow_version: '1.0',
        execution_mode: 'async',
        requires_confirmation: true,
        supported_files: ['.pdf', '.jpg', '.jpeg', '.png'],
        input_schema: {
            type: 'object',
            properties: {
                file: { type: 'string', format: 'binary', title: '资质材料' },
                category: { type: 'string', title: '资质分类' },
            },
            required: ['file'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '识别结论' },
                cert_type: { type: 'string', title: '资质类型' },
                cert_no: { type: 'string', title: '证书编号' },
                issuer: { type: 'string', title: '发证机构' },
                valid_until: { type: 'string', format: 'date', title: '有效期至' },
            },
            required: ['summary'],
        },
        binding_key: 'enterprise_qualification',
        artifact_kind: 'json',
        permission: { code: 'skill:enterprise_qualification:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: {
            app_id: 'enterprisequalification',
            routes: ['/api/enterprise-qualification/*'],
            note: '识别工作流 + 独立资质知识库（DIFY_EQ_KNOWLEDGE_*）双绑定；与「资质管理」业务语义重叠，建议合并到同一场景入口',
        },
    },
];
