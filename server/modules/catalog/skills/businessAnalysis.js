/**
 * 技能清单 · 经营分析（scene: business_analysis）
 *
 * 注：本场景目前只有 2 条。原草案里列的 order_suggestion（订单建议）
 *     在 appRegistry 中没有对应应用 —— 但 .env 里**确实存在**
 *     DIFY_ORDER_SUGGESTION_API_KEY。这个「有绑定、无技能」的反向缺口
 *     已在 providers/bindings.js 里单独登记，供后续裁决（是补 UI 还是下线）。
 */

/** @type {import('../skillTypes.js').SkillManifest[]} */
export const businessAnalysisSkills = [
    {
        skill_key: 'business_dashboard',
        name: '看板生成助手',
        scene: 'business_analysis',
        summary: '上传经营数据，自动生成可发布的业务看板页面。',
        icon: 'BarChart3',
        workflow_version: '1.0',
        execution_mode: 'async',
        requires_confirmation: false,
        supported_files: ['.xlsx', '.xls', '.csv'],
        input_schema: {
            type: 'object',
            properties: {
                file: { type: 'string', format: 'binary', title: '经营数据' },
                title: { type: 'string', title: '看板标题' },
                metrics: { type: 'array', items: { type: 'string' }, title: '关注指标' },
            },
            required: ['file'],
        },
        output_schema: {
            type: 'object',
            properties: {
                summary: { type: 'string', title: '生成结论' },
                dashboard_url: { type: 'string', title: '看板地址' },
                charts: { type: 'array', items: { type: 'object' }, title: '图表清单' },
            },
            required: ['dashboard_url'],
        },
        binding_key: 'business_dashboard',
        artifact_kind: 'dashboard',
        permission: { code: 'skill:business_dashboard:run', data_scope: 'dept' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: {
            app_id: 'business_dashboard',
            routes: ['/api/business-dashboard/*'],
            note: '产物落盘 public/dashboard-files 并通过 /dashboard-files 静态托管（须在鉴权前，iframe 不带 JWT 头）；绑定关系待 Provider 层确认',
        },
    },
    {
        skill_key: 'dashboard_center',
        name: '业务看板',
        scene: 'business_analysis',
        summary: '聚合各业务看板，统一查看与切换。',
        icon: 'LayoutDashboard',
        workflow_version: '1.0',
        execution_mode: 'blocking',
        requires_confirmation: false,
        supported_files: [],
        input_schema: {
            type: 'object',
            properties: {
                scene: { type: 'string', title: '看板场景' },
                date_from: { type: 'string', format: 'date', title: '起始日期' },
                date_to: { type: 'string', format: 'date', title: '截止日期' },
            },
            required: [],
        },
        output_schema: {
            type: 'object',
            properties: {
                dashboards: {
                    type: 'array',
                    title: '看板列表',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                            url: { type: 'string' },
                            updated_at: { type: 'string' },
                        },
                    },
                },
                metrics: { type: 'object', title: '汇总指标' },
            },
            required: ['dashboards'],
        },
        binding_key: 'internal',
        artifact_kind: 'dashboard',
        permission: { code: 'skill:dashboard_center:view', data_scope: 'dept' },
        task: { trackable: false, idempotent: true },
        live: true,
        // 2026-09-21：本技能是「聚合视图」而非「执行型技能」——它既不调 Dify，
        // 也不产出任务。此前没有声明，新界面只能拿 input_schema 渲染成一个空表单，
        // 点「开始执行」必然建出一个没有执行体的任务（=用户看到的「用不了」）。
        // 声明 view_panel 后，catalog 下发 interaction_mode='view'，技能页渲染
        // 专属面板（看板列表/预览），不再走表单与任务中心。
        view_panel: 'business_dashboard_center',
        legacy: {
            app_id: 'dashboard_center',
            routes: ['/api/dashboards/*', '/api/business-dashboard'],
            note: '纯聚合技能，不直接调用 Dify（binding_key=internal 表示平台内部实现）；数据源为 sys_dashboards（外部登记）+ business_dashboard（AI 发布）',
        },
    },
];
