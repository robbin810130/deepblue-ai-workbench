/**
 * 技能级授权存储（M6 完整版）—— 文档 06：permission_code + 数据范围
 *
 * 表 sys_skill_permissions：角色 × 技能 的显式授权/拒绝记录。
 *   - 命中 granted = true  → granted（携带 data_scope）
 *   - 命中 granted = false → denied（显式拒绝优先级最高）
 *   - 未命中              → 回落旧版 sys_roles.permissions 映射（M6 先行版，保存量角色无感）
 *   - 旧映射也没有        → not_evaluated（诚实三态，绝不假装判定）
 *
 * DDL 与平台 dashboardRoutes 的自建模式一致（启动期幂等执行）。
 */

import pool from '../../db.js';

let ddlPromise = null;

/** 启动期建表（幂等；并发安全 —— 多个 worker 同时执行只会各成功一次） */
export function ensureSkillPermissionsTable() {
    if (!ddlPromise) {
        ddlPromise = pool.query(`
            CREATE TABLE IF NOT EXISTS sys_skill_permissions (
                id          SERIAL PRIMARY KEY,
                skill_key   VARCHAR(80)  NOT NULL,
                role_name   VARCHAR(80)  NOT NULL,
                granted     BOOLEAN      NOT NULL DEFAULT TRUE,
                data_scope  VARCHAR(20)  NOT NULL DEFAULT 'self',
                granted_by  INTEGER,
                created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                UNIQUE (skill_key, role_name)
            );
            CREATE INDEX IF NOT EXISTS idx_skill_perm_role ON sys_skill_permissions(role_name);
        `).catch((err) => {
            ddlPromise = null; // 失败可重试
            throw err;
        });
    }
    return ddlPromise;
}

/** 角色的全部显式授权记录（含拒绝项） */
export async function listForRole(roleName) {
    await ensureSkillPermissionsTable();
    const { rows } = await pool.query(
        `SELECT skill_key, granted, data_scope, granted_by, updated_at
           FROM sys_skill_permissions WHERE role_name = $1
           ORDER BY skill_key`,
        [roleName],
    );
    return rows;
}

/** 查单条显式授权；无记录返回 null（进入回落链） */
export async function getExplicit(skillKey, roleName) {
    await ensureSkillPermissionsTable();
    const { rows } = await pool.query(
        `SELECT skill_key, granted, data_scope, granted_by, updated_at
           FROM sys_skill_permissions WHERE skill_key = $1 AND role_name = $2`,
        [skillKey, roleName],
    );
    return rows[0] || null;
}

/**
 * 设置（授权/拒绝/改数据范围）—— upsert。
 * @param {{skill_key:string, role_name:string, granted:boolean, data_scope?:string, granted_by?:number}} p
 */
export async function setPermission({ skill_key, role_name, granted, data_scope = 'self', granted_by = null }) {
    await ensureSkillPermissionsTable();
    const scope = ['self', 'dept', 'all'].includes(data_scope) ? data_scope : 'self';
    const { rows } = await pool.query(
        `INSERT INTO sys_skill_permissions (skill_key, role_name, granted, data_scope, granted_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (skill_key, role_name)
         DO UPDATE SET granted = EXCLUDED.granted,
                      data_scope = EXCLUDED.data_scope,
                      granted_by = EXCLUDED.granted_by,
                      updated_at = NOW()
         RETURNING skill_key, role_name, granted, data_scope, granted_by, updated_at`,
        [skill_key, role_name, granted === true, scope, granted_by],
    );
    return rows[0];
}

/** 删除显式授权（回落到旧版映射语义） */
export async function clearPermission(skillKey, roleName) {
    await ensureSkillPermissionsTable();
    const { rowCount } = await pool.query(
        `DELETE FROM sys_skill_permissions WHERE skill_key = $1 AND role_name = $2`,
        [skillKey, roleName],
    );
    return rowCount > 0;
}
