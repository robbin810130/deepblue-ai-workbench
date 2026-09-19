/**
 * 技能清单 · 企业知识（scene: enterprise_knowledge）
 *
 * 🔴 本组是「幽灵技能」重灾区：6 条里有 4 条 live:false。
 *    这 4 条的共同特征：前端组件、后端路由、Dify 工作流、密钥**全部就绪**，
 *    但因为没写进 appRegistry.ts，用户界面上根本看不见（注册表是单一数据源，
 *    没注册 = 桌面不显示 / 权限勾不到 / 无法进入）。
 *
 *    合计沉睡资产：约 2,106 行前端代码 + 17 个后端路由 + 5 个 Dify 工作流。
 *    把它们在 Manifest 里从 false 改成 true，边际成本极低 ——
 *    这是文档 09「发布清单」意义上最划算的一批上线动作。
 */

/** @type {import('../skillTypes.js').SkillManifest[]} */
export const enterpriseKnowledgeSkills = [
    {
        skill_key: 'knowledge_base',
        name: '知识库',
        scene: 'enterprise_knowledge',
        summary: '企业知识空间的文档管理与检索问答入口。',
        icon: 'BookOpen',
        workflow_version: '1.0',
        execution_mode: 'chat',
        requires_confirmation: false,
        supported_files: ['.pdf', '.docx', '.doc', '.txt', '.md', '.xlsx'],
        input_schema: {
            type: 'object',
            properties: {
                message: { type: 'string', title: '提问内容' },
                file: { type: 'string', format: 'binary', title: '待入库文档' },
                space_id: { type: 'string', title: '知识空间' },
            },
            required: [],
        },
        output_schema: {
            type: 'object',
            properties: {
                answer: { type: 'string', title: '回答（Markdown）' },
                references: { type: 'array', items: { type: 'object' }, title: '引用片段' },
                space_id: { type: 'string', title: '知识空间' },
            },
            required: [],
        },
        binding_key: 'knowledge_base',
        artifact_kind: 'markdown',
        permission: { code: 'skill:knowledge_base:run', data_scope: 'all' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: {
            app_id: 'rules',
            routes: ['/api/knowledge/*'],
            note: '名称错位：appRegistry 里 id=rules 但 label 是「知识库」，与公司制度助手（rules_assistant）不是同一个；绑定主知识库 DIFY_KNOWLEDGE_DATASET_ID',
        },
    },
    {
        skill_key: 'daily_news',
        name: '每日推送',
        scene: 'enterprise_knowledge',
        summary: '每日聚合行业资讯并生成摘要推送给团队成员。',
        icon: 'Newspaper',
        workflow_version: '1.0',
        execution_mode: 'async',
        requires_confirmation: false,
        supported_files: [],
        input_schema: {
            type: 'object',
            properties: {
                date: { type: 'string', format: 'date', title: '推送日期' },
                categories: { type: 'array', items: { type: 'string' }, title: '资讯分类' },
            },
            required: [],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '当日摘要' },
                items: {
                    type: 'array',
                    title: '资讯条目',
                    items: {
                        type: 'object',
                        properties: {
                            title: { type: 'string' },
                            source: { type: 'string' },
                            digest: { type: 'string', title: '摘要' },
                            url: { type: 'string' },
                        },
                    },
                },
            },
            required: ['items'],
        },
        binding_key: 'daily_news',
        artifact_kind: 'markdown',
        permission: { code: 'skill:daily_news:run', data_scope: 'all' },
        task: { trackable: true, idempotent: true },
        live: true,
        legacy: {
            app_id: 'news',
            routes: ['/api/daily-news'],
            note: '双工作流：资讯抓取 + 摘要分析',
        },
    },
    {
        skill_key: 'meeting_minutes',
        name: '会议纪要',
        scene: 'enterprise_knowledge',
        summary: '上传会议录音，自动转写并输出结构化纪要与待办。',
        icon: 'Mic',
        workflow_version: '1.0',
        execution_mode: 'async',
        requires_confirmation: true,
        supported_files: ['.mp3', '.wav', '.m4a'],
        input_schema: {
            type: 'object',
            properties: {
                file: { type: 'string', format: 'binary', title: '会议录音' },
                meeting_title: { type: 'string', title: '会议主题' },
                attendees: { type: 'array', items: { type: 'string' }, title: '参会人' },
            },
            required: ['file'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '会议摘要' },
                transcript: { type: 'string', title: '转写全文' },
                decisions: { type: 'array', items: { type: 'string' }, title: '决议事项' },
                todos: {
                    type: 'array',
                    title: '待办',
                    items: {
                        type: 'object',
                        properties: {
                            content: { type: 'string', title: '事项' },
                            owner: { type: 'string', title: '负责人' },
                            due: { type: 'string', title: '截止时间' },
                        },
                    },
                },
            },
            required: ['summary', 'todos'],
        },
        binding_key: 'meeting_minutes',
        artifact_kind: 'markdown',
        permission: { code: 'skill:meeting_minutes:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: {
            app_id: null,
            routes: ['/api/meeting-minutes/*'],
            note: '👻 幽灵技能 #1：MeetingMinutes.tsx（690 行）+ 9 个后端路由 + 转写与导出双工作流全部就绪，未在 appRegistry 注册所以用户不可见。5 个幽灵里体量最大，建议优先开门。',
        },
    },
    {
        skill_key: 'digital_employee',
        name: '数字员工',
        scene: 'enterprise_knowledge',
        summary: '以对话方式提供全能助理，串联企业内部知识与技能。',
        icon: 'Bot',
        workflow_version: '1.0',
        execution_mode: 'chat',
        requires_confirmation: false,
        supported_files: [],
        input_schema: {
            type: 'object',
            properties: {
                message: { type: 'string', title: '提问内容' },
                conversation_id: { type: 'string', title: '会话 ID' },
            },
            required: ['message'],
        },
        output_schema: {
            type: 'object',
            properties: {
                answer: { type: 'string', title: '回答（Markdown）' },
                conversation_id: { type: 'string', title: '会话 ID' },
                tool_calls: { type: 'array', items: { type: 'object' }, title: '技能调用记录' },
            },
            required: ['answer'],
        },
        binding_key: 'digital_employee',
        artifact_kind: 'markdown',
        permission: { code: 'skill:digital_employee:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: {
            app_id: null,
            routes: ['/api/digital-employee/*'],
            note: '👻 幽灵技能 #2：DigitalEmployee.tsx（557 行）+ 2 个路由 + 工作流就绪未注册。另有待裁决项：是否干脆改为全局助手并入首页输入框，而不是独立入口。',
        },
    },
    {
        skill_key: 'doc_drafting',
        name: '文档起草',
        scene: 'enterprise_knowledge',
        summary: '按输入要求起草公文、通知、方案等企业文档。',
        icon: 'FilePen',
        workflow_version: '1.0',
        execution_mode: 'blocking',
        requires_confirmation: false,
        supported_files: ['.docx', '.pdf'],
        input_schema: {
            type: 'object',
            properties: {
                query: { type: 'string', title: '起草要求' },
                doc_type: { type: 'string', title: '文档类型' },
                reference: { type: 'string', format: 'binary', title: '参考文件' },
            },
            required: ['query'],
        },
        output_schema: {
            type: 'object',
            properties: {
                content: { type: 'string', title: '文档正文（Markdown）' },
                outline: { type: 'array', items: { type: 'string' }, title: '大纲' },
            },
            required: ['content'],
        },
        binding_key: 'doc_drafting',
        artifact_kind: 'markdown',
        permission: { code: 'skill:doc_drafting:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: {
            app_id: null,
            routes: ['/api/doc-drafting/*'],
            note: '👻 幽灵技能 #3：DocDrafting.tsx（499 行）+ 4 个路由就绪未注册。与已上线的 doc_copywriting（文档文案）业务相近，开门前建议先做去重裁决。',
        },
    },
    {
        skill_key: 'rules_assistant',
        name: '公司制度助手',
        scene: 'enterprise_knowledge',
        summary: '基于公司规章制度问答，回答附条文出处。',
        icon: 'Scale',
        workflow_version: '1.0',
        execution_mode: 'chat',
        requires_confirmation: false,
        supported_files: [],
        input_schema: {
            type: 'object',
            properties: {
                message: { type: 'string', title: '提问内容' },
                conversation_id: { type: 'string', title: '会话 ID' },
            },
            required: ['message'],
        },
        output_schema: {
            type: 'object',
            properties: {
                answer: { type: 'string', title: '回答（Markdown）' },
                citations: {
                    type: 'array',
                    title: '条文出处',
                    items: {
                        type: 'object',
                        properties: {
                            doc: { type: 'string', title: '制度文件' },
                            clause: { type: 'string', title: '条款' },
                        },
                    },
                },
            },
            required: ['answer'],
        },
        binding_key: 'rules_assistant',
        artifact_kind: 'markdown',
        permission: { code: 'skill:rules_assistant:run', data_scope: 'all' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: {
            app_id: null,
            routes: ['/api/company-rules/*'],
            note: '👻 幽灵技能 #4：CompanyRulesAssistant.tsx（360 行）+ 2 个路由就绪未注册。同一个工作流还被「合同审核」复用做条款比对，属于复合用途。',
        },
    },
];
