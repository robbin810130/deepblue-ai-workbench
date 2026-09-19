/**
 * 权限判定（M6 完整版）
 *
 * 判定链（自上而下，首个命中即返回）：
 *   1. admin 一律放行（与存量 requireModulePermission 同口径）
 *   2. sys_skill_permissions 显式授权（M6 完整版：permission_code 语义 + data_scope）
 *      —— granted=true → granted；granted=false → denied（显式拒绝优先）
 *   3. 旧版 sys_roles.permissions（appId 数组，'*' 全量）—— 存量角色无感回落
 *   4. 以上皆无 → not_evaluated（诚实三态，绝不假装已判定）
 *
 * 映射来源：src/config/appRegistry.ts 的 36 个旧版应用（id ↔ label 逐一对照技能名）。
 */

import pool from '../../db.js';
import { getExplicit } from './skillPermissionStore.js';

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
 * @returns {Promise<{status:'granted'|'denied'|'not_evaluated', reason:string, data_scope?:string, source?:string}>}
 */
export async function evaluateSkillPermission(skill, user) {
    // 1. admin 一律放行
    if (user?.role === 'admin') {
        return { status: 'granted', reason: '管理员角色', source: 'admin' };
    }

    const skillKey = skill?.skill_key;

    // 2. M6 完整版：技能级显式授权（命中即返回，拒绝优先）
    if (skillKey && user?.role) {
        try {
            const explicit = await getExplicit(skillKey, user.role);
            if (explicit) {
                return explicit.granted
                    ? {
                        status: 'granted',
                        reason: `技能级授权已授予角色「${user.role}」`,
                        data_scope: explicit.data_scope,
                        source: 'skill_permission',
                    }
                    : {
                        status: 'denied',
                        reason: `技能级授权显式拒绝角色「${user.role}」`,
                        data_scope: explicit.data_scope,
                        source: 'skill_permission',
                    };
            }
        } catch {
            // 授权表不可读 → 继续回落旧版链，不误伤
        }
    }

    // 3. 旧版映射回落
    const appId = LEGACY_APP_MAP[skillKey];
    if (!appId) {
        return {
            status: 'not_evaluated',
            reason: '技能级授权未配置，且技能未登记旧版权限映射（访问控制由任务归属保证）',
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
        return { status: 'granted', reason: `角色「${user.role}」已授予旧版模块 ${appId}`, source: 'legacy_app' };
    }
    return { status: 'denied', reason: `角色「${user.role}」未授予旧版模块 ${appId}`, source: 'legacy_app' };
}
