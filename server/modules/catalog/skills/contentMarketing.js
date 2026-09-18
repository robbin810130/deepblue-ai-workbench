/**
 * 技能清单 · 内容与营销（scene: content_marketing）
 *
 * ⚠️ 归属争议保留（文档未明确，需业务侧拍板）：
 *    risk_detection（风险检测）从工作流看分「电商 / 研发」两条线，
 *    业务上更贴近「商品与供应链」，但现有分组放在专业工具。
 *    hazard_detection（隐患检测）同理。
 *    → 本次按草案暂挂本场景，改动成本极低（只改 scene 一个字段）。
 */

/** @type {import('../skillTypes.js').SkillManifest[]} */
export const contentMarketingSkills = [
    {
        skill_key: 'ai_image',
        name: '电商生图',
        scene: 'content_marketing',
        summary: '输入商品描述或参考图，生成符合电商规范的营销图片。',
        icon: 'Sparkles',
        workflow_version: '1.0',
        execution_mode: 'async',
        requires_confirmation: false,
        supported_files: ['.jpg', '.jpeg', '.png', '.webp'],
        input_schema: {
            type: 'object',
            properties: {
                prompt: { type: 'string', title: '画面描述' },
                reference_image: { type: 'string', format: 'binary', title: '参考图' },
                size: { type: 'string', title: '尺寸', default: '1024x1024' },
                style: { type: 'string', title: '风格' },
            },
            required: ['prompt'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '生成说明' },
                images: {
                    type: 'array',
                    title: '生成图片',
                    items: {
                        type: 'object',
                        properties: {
                            url: { type: 'string', title: '图片地址' },
                            width: { type: 'integer' },
                            height: { type: 'integer' },
                        },
                    },
                },
            },
            required: ['images'],
        },
        binding_key: 'ai_image',
        artifact_kind: 'image',
        permission: { code: 'skill:ai_image:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: {
            app_id: 'aiimage',
            routes: ['/api/generate-image'],
            note: '绑定待 Provider 层确认（该模块可能走非 Dify 的图像服务，勿默认按 Dify 登记）',
        },
    },
    {
        skill_key: 'layout_compare',
        name: '版式对比',
        scene: 'content_marketing',
        summary: '上传两版设计稿，输出差异点清单与优化建议。',
        icon: 'Columns',
        workflow_version: '1.0',
        execution_mode: 'async',
        requires_confirmation: false,
        supported_files: ['.jpg', '.jpeg', '.png', '.pdf'],
        input_schema: {
            type: 'object',
            properties: {
                files: { type: 'array', title: '待对比的版式文件（2 个）' },
                focus: { type: 'array', items: { type: 'string' }, title: '对比维度' },
            },
            required: ['files'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '对比结论' },
                diffs: {
                    type: 'array',
                    title: '差异点',
                    items: {
                        type: 'object',
                        properties: {
                            area: { type: 'string', title: '区域' },
                            description: { type: 'string', title: '差异描述' },
                            suggestion: { type: 'string', title: '建议' },
                        },
                    },
                },
            },
            required: ['summary', 'diffs'],
        },
        binding_key: 'layout_compare',
        artifact_kind: 'json',
        permission: { code: 'skill:layout_compare:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: true },
        live: true,
        legacy: { app_id: 'layoutcompare', routes: ['/api/layout-compare'] },
    },
    {
        skill_key: 'video_gen',
        name: '视频生成',
        scene: 'content_marketing',
        summary: '输入脚本或商品素材，生成短视频成片。',
        icon: 'Film',
        workflow_version: '1.0',
        execution_mode: 'async',
        requires_confirmation: false,
        supported_files: ['.jpg', '.jpeg', '.png', '.mp4'],
        input_schema: {
            type: 'object',
            properties: {
                prompt: { type: 'string', title: '视频脚本/描述' },
                materials: { type: 'array', title: '素材文件' },
                duration: { type: 'integer', title: '时长(秒)', default: 15 },
                ratio: { type: 'string', title: '画幅', default: '9:16' },
            },
            required: ['prompt'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '生成说明' },
                video_url: { type: 'string', title: '视频地址' },
                cover_url: { type: 'string', title: '封面地址' },
                duration: { type: 'integer', title: '实际时长' },
            },
            required: ['video_url'],
        },
        binding_key: 'video_gen',
        artifact_kind: 'video',
        permission: { code: 'skill:video_gen:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: { app_id: 'videogen', routes: ['/api/video-generation'] },
    },
    {
        skill_key: 'doc_copywriting',
        name: '文档文案',
        scene: 'content_marketing',
        summary: '输入商品或活动信息，生成详情页、推广语等文案。',
        icon: 'Pen',
        workflow_version: '1.0',
        execution_mode: 'blocking',
        requires_confirmation: false,
        supported_files: [],
        input_schema: {
            type: 'object',
            properties: {
                query: { type: 'string', title: '文案诉求' },
                doc_type: { type: 'string', title: '文案类型', description: '详情页 / 推广语 / 朋友圈' },
                tone: { type: 'string', title: '语气风格' },
            },
            required: ['query'],
        },
        output_schema: {
            type: 'object',
            properties: {
                content: { type: 'string', title: '文案正文（Markdown）' },
                variants: { type: 'array', items: { type: 'string' }, title: '备选版本' },
            },
            required: ['content'],
        },
        binding_key: 'doc_copywriting',
        artifact_kind: 'markdown',
        permission: { code: 'skill:doc_copywriting:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: {
            app_id: 'doccopywriting',
            routes: ['/api/doc-copywriting'],
            note: '与幽灵技能 doc_drafting（文档起草）业务相近，建议合并评估后再定去留',
        },
    },
    {
        skill_key: 'risk_detection',
        name: '风险检测',
        scene: 'content_marketing',
        summary: '上传商品或研发资料，识别合规、知识产权与经营风险。',
        icon: 'ShieldCheck',
        workflow_version: '1.0',
        execution_mode: 'async',
        requires_confirmation: true,
        supported_files: ['.pdf', '.docx', '.jpg', '.jpeg', '.png'],
        input_schema: {
            type: 'object',
            properties: {
                file: { type: 'string', format: 'binary', title: '待检测资料' },
                scope: { type: 'string', enum: ['ecom', 'rnd'], title: '检测范围', default: 'ecom' },
            },
            required: ['file'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '检测结论' },
                risk_level: { type: 'string', enum: ['high', 'medium', 'low'], title: '风险等级' },
                categories: { type: 'array', items: { type: 'string' }, title: '风险分类' },
                details: {
                    type: 'array',
                    title: '风险明细',
                    items: {
                        type: 'object',
                        properties: {
                            category: { type: 'string' },
                            description: { type: 'string' },
                            suggestion: { type: 'string' },
                        },
                    },
                },
            },
            required: ['summary', 'risk_level'],
        },
        binding_key: 'risk_detection',
        artifact_kind: 'json',
        permission: { code: 'skill:risk_detection:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: {
            app_id: 'riskdetection',
            routes: ['/api/risk-detection'],
            note: '按 scope 分流到两个工作流（电商 / 研发），Provider 层需支持 scope→binding 的路由',
        },
    },
    {
        skill_key: 'hazard_detection',
        name: '隐患检测',
        scene: 'content_marketing',
        summary: '批量上传现场图片，识别安全隐患并输出整改建议。',
        icon: 'Scan',
        workflow_version: '1.0',
        execution_mode: 'async',
        requires_confirmation: true,
        supported_files: ['.jpg', '.jpeg', '.png'],
        input_schema: {
            type: 'object',
            properties: {
                files: { type: 'array', title: '现场图片（≤10 张）' },
                site: { type: 'string', title: '场所/区域' },
            },
            required: ['files'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '检测结论' },
                total_hazards_detected: { type: 'integer', title: '隐患总数' },
                overall_risk_level: { type: 'string', enum: ['high', 'medium', 'low'], title: '整体风险等级' },
                findings: {
                    type: 'array',
                    title: '隐患明细',
                    items: {
                        type: 'object',
                        properties: {
                            type: { type: 'string', title: '隐患类型' },
                            description: { type: 'string', title: '描述' },
                            severity: { type: 'string', title: '严重程度' },
                            suggestion: { type: 'string', title: '整改建议' },
                        },
                    },
                },
            },
            required: ['total_hazards_detected', 'findings'],
        },
        binding_key: 'hazard_detection',
        artifact_kind: 'json',
        permission: { code: 'skill:hazard_detection:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: {
            app_id: 'hazarddetection',
            routes: ['/api/hazard-detection/*'],
            note: '★ 输出字段刻意沿用 Dify 现名（total_hazards_detected / overall_risk_level / findings）：前端 HazardDetectionModule.tsx 有 41 处引用，过渡期由 Adapter 做字段映射，下个迭代再统一命名',
        },
    },
];
