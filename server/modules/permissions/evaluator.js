/**
 * 权限判定（M6 先行版）
 *
 * 当前权限模型：sys_roles.permissions（旧版 appId 数组，'*' 全量）。
 * 文档 06 要求迁移到 permission_code + 数据范围 —— 那需要技能表接管权限语义（M6 完整版）。
 *
 * 先行版策略（诚实三态，绝不假装已判定）：
 *   granted        角色权限含 '*' 或该技能映射的旧版 appId → 可以执行
 *   denied         角色权限明确存在但不含该 appId → 不可执行
 *   not_evaluated  ①技能无旧版映射（幽灵技能/纯新增）②角色或权限数据不可读 → 不判定，
 *                  放行到任务创建的访问控制层（M3 已保证：仅本人/被分配人/admin 可见任务）
 *
 * 映射来源：src/config/appRegistry.ts 的 36 个旧版应用（id ↔ label 逐一对照技能名）。
 * 幽灵技能（live:false，未在旧系统注册）无映射 —— 开放时在旧权限系统补 appId 后填入。
 */

import pool from '../../db.js';

/** skill_key → 旧版权限 appId */
export const LEGACY_APP_MAP = Object.freeze({
    // 市场与客户
    market_insight: 'market',
    marketing_forecast: 'prediction',
    customer_analysis: 'customer',
    marketing_analysis: 'marketing_analysis',
    review_partner: 'review_partner',
    sea_marketing: 'seamarketing',
    key_account: 'keyaccount',
    // 合同与招投标
    contract_review: 'contractaudit',
    qualification: 'qualification',
    tender_search: 'tendersearch',
    bid_assistant: 'bidassistant',
    enterprise_qualification: 'enterprisequalification',
    // 商品与供应链
    order_recognition: 'orderrecognition',
    product_entry: 'productentry',
    product_selection: 'productselectionstrategy',
    product_library: 'productLibrary',
    quote_verify: 'quoteverify',
    invoice_verify: 'invoiceverify',
    logistics_fee: 'logistics_fee',
    beauty_rnd: 'beautyrnd',
    // 内容与营销
    ai_image: 'aiimage',
    layout_compare: 'layoutcompare',
    video_gen: 'videogen',
    doc_copywriting: 'doccopywriting',
    risk_detection: 'riskdetection',
    hazard_detection: 'hazarddetection',
    // 企业知识
    knowledge_base: 'rules',
    daily_news: 'news',
    // 经营分析
    business_dashboard: 'business_dashboard',
    dashboard_center: 'dashboard_center',
    // 系统类
    sys_user_manage: 'usermanage',
    sys_permission: 'permissions',
    sys_profile: 'profile',
    sys_audit_log: 'auditlog',
});

/** 读取角色的权限数组；数据不可读返回 null（触发 not_evaluated） */
async function getRolePermissions(roleName) {
    if (!roleName) return null;
    try {
        const { rows } = await pool.query('SELECT permissions FROM sys_roles WHERE name = $1', [roleName]);
        const perms = rows[0]?.permissions;
        return Array.isArray(perms) ? perms : null;
    } catch {
        return null; // 表不存在/连接失败 —— 不判定，不误伤
    }
}

/**
 * 判定用户能否执行某技能。
 * @param {object} skill 技能清单条目
 * @param {{id:number, role?:string}} user JWT 载荷
 * @returns {Promise<{status:'granted'|'denied'|'not_evaluated', reason:string}>}
 */
export async function evaluateSkillPermission(skill, user) {
    // admin 一律放行（与存量 requireModulePermission 同口径）
    if (user?.role === 'admin') {
        return { status: 'granted', reason: '管理员角色' };
    }

    const appId = LEGACY_APP_MAP[skill?.skill_key];
    if (!appId) {
        return {
            status: 'not_evaluated',
            reason: '技能未登记旧版权限映射（M6 技能表接管后启用精确判定）',
        };
    }

    const perms = await getRolePermissions(user?.role);
    if (perms === null) {
        return {
            status: 'not_evaluated',
            reason: '角色权限数据不可读，暂不判定（访问控制由任务归属保证）',
        };
    }

    if (perms.includes('*') || perms.includes(appId)) {
        return { status: 'granted', reason: `角色「${user.role}」已授予旧版模块 ${appId}` };
    }
    return { status: 'denied', reason: `角色「${user.role}」未授予旧版模块 ${appId}` };
}
