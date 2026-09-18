/**
 * 技能清单 · 系统管理（scene: system）
 *
 * 这 4 条**不调 AI**，是纯业务能力。放进同一张技能表的原因：
 *   - 权限模型要统一（文档 11：权限必须精确到「技能 + 动作」，而不是「能不能开这个 App」）
 *   - 侧栏导航要从一个数据源出（D3 决策：桌面隐喻下线后，入口由场景 + 系统区组成）
 *   - 它们同样需要被审计（文档 03 §10：管理接口必须服务端检查管理权限）
 *
 * binding_key = 'internal' 表示平台内部实现，无外部 Provider。
 * 校验器接受该约定值（见 providers/bindings.js 的 internal 绑定）。
 */

/** @type {import('../skillTypes.js').SkillManifest[]} */
export const systemSkills = [
    {
        skill_key: 'sys_user_manage',
        name: '用户管理',
        scene: 'system',
        summary: '维护系统用户、组织结构与账号状态。',
        icon: 'ShieldCheck',
        workflow_version: '1.0',
        execution_mode: 'blocking',
        requires_confirmation: false,
        supported_files: [],
        input_schema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'create', 'update', 'disable'], title: '动作', default: 'list' },
                keyword: { type: 'string', title: '检索关键词' },
            },
            required: ['action'],
        },
        output_schema: {
            type: 'object',
            properties: {
                users: {
                    type: 'array',
                    title: '用户列表',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            username: { type: 'string' },
                            name: { type: 'string' },
                            status: { type: 'string' },
                        },
                    },
                },
                total: { type: 'integer', title: '总数' },
            },
            required: ['users'],
        },
        binding_key: 'internal',
        artifact_kind: 'table',
        permission: { code: 'skill:sys_user_manage:manage', data_scope: 'all' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: {
            app_id: 'usermanage',
            routes: ['/api/admin/users/*'],
            note: 'D3 决策：入口从桌面移到侧栏底部 / 头像菜单',
        },
    },
    {
        skill_key: 'sys_permission',
        name: '权限管理',
        scene: 'system',
        summary: '配置角色与技能权限，管理数据范围。',
        icon: 'Lock',
        workflow_version: '1.0',
        execution_mode: 'blocking',
        requires_confirmation: true,
        supported_files: [],
        input_schema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'grant', 'revoke'], title: '动作', default: 'list' },
                role_id: { type: 'string', title: '角色 ID' },
                skill_keys: { type: 'array', items: { type: 'string' }, title: '技能列表' },
            },
            required: ['action'],
        },
        output_schema: {
            type: 'object',
            properties: {
                roles: { type: 'array', items: { type: 'object' }, title: '角色列表' },
                permissions: { type: 'array', items: { type: 'object' }, title: '权限明细' },
            },
            required: ['roles'],
        },
        binding_key: 'internal',
        artifact_kind: 'table',
        permission: { code: 'skill:sys_permission:manage', data_scope: 'all' },
        task: { trackable: true, idempotent: false },
        live: true,
        legacy: {
            app_id: 'permissions',
            routes: ['/api/admin/roles/*', '/api/admin/permissions/*'],
            note: '现状是 appId 数组存权限（sys_roles.permissions JSONB），无 permission_code、无数据范围。后续按 M6 由本表接管权限语义。',
        },
    },
    {
        skill_key: 'sys_profile',
        name: '个人中心',
        scene: 'system',
        summary: '查看与维护个人资料、密码与偏好设置。',
        icon: 'User',
        workflow_version: '1.0',
        execution_mode: 'blocking',
        requires_confirmation: false,
        supported_files: ['.jpg', '.jpeg', '.png'],
        input_schema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['view', 'update', 'change_password'], title: '动作', default: 'view' },
                avatar: { type: 'string', format: 'binary', title: '头像' },
            },
            required: ['action'],
        },
        output_schema: {
            type: 'object',
            properties: {
                profile: {
                    type: 'object',
                    title: '个人资料',
                    properties: {
                        id: { type: 'string' },
                        username: { type: 'string' },
                        name: { type: 'string' },
                        avatar_url: { type: 'string' },
                    },
                },
            },
            required: ['profile'],
        },
        binding_key: 'internal',
        artifact_kind: 'json',
        permission: { code: 'skill:sys_profile:view', data_scope: 'own' },
        task: { trackable: false, idempotent: true },
        live: true,
        legacy: {
            app_id: 'profile',
            routes: ['/api/user/profile'],
            note: 'alwaysVisible 特例：任何人恒可见，不参与权限勾选',
        },
    },
    {
        skill_key: 'sys_audit_log',
        name: '操作日志',
        scene: 'system',
        summary: '查询系统操作审计日志，支持按用户、模块与时间筛选。',
        icon: 'ClipboardList',
        workflow_version: '1.0',
        execution_mode: 'blocking',
        requires_confirmation: false,
        supported_files: [],
        input_schema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', title: '操作人' },
                module: { type: 'string', title: '模块' },
                date_from: { type: 'string', format: 'date' },
                date_to: { type: 'string', format: 'date' },
            },
            required: [],
        },
        output_schema: {
            type: 'object',
            properties: {
                logs: {
                    type: 'array',
                    title: '日志条目',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            user_id: { type: 'string' },
                            action: { type: 'string' },
                            module: { type: 'string' },
                            created_at: { type: 'string' },
                        },
                    },
                },
                total: { type: 'integer', title: '总数' },
            },
            required: ['logs'],
        },
        binding_key: 'internal',
        artifact_kind: 'table',
        permission: { code: 'skill:sys_audit_log:view', data_scope: 'all' },
        task: { trackable: false, idempotent: true },
        live: true,
        legacy: {
            app_id: 'auditlog',
            routes: ['/api/admin/audit-logs'],
            note: '底层表 sys_audit_logs 已存在（文档 02 §审计），健康资产',
        },
    },
];
