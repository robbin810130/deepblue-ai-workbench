/**
 * /api/v1/permissions —— 技能级授权管理（M6 完整版，文档 06）
 *
 *   GET    /permissions/roles                     角色清单（sys_roles）
 *   GET    /permissions/skills?role=<role>        某角色 × 全部技能的授权视图（合并 catalog）
 *   PUT    /permissions/skills/:skillKey          设置显式授权/拒绝（admin）
 *          body: { role_name, granted, data_scope? }
 *   DELETE /permissions/skills/:skillKey?role=    清除显式授权（回落旧版映射）
 *
 * 写操作仅 admin；GET 视图登录即可（前端权限页需展示，判定由 evaluator 完成）。
 */

import express from 'express';
import pool from '../../db.js';
import * as store from '../../modules/permissions/skillPermissionStore.js';
import { listSkills, getSkill } from '../../modules/catalog/index.js';
import { evaluateSkillPermission } from '../../modules/permissions/evaluator.js';
import { sendOk, sendFail, asyncHandler } from '../../modules/common/apiResponse.js';
import { AppError } from '../../modules/common/errors.js';

const router = express.Router();

store.ensureSkillPermissionsTable().catch((err) =>
    console.error('[Permissions DDL] 技能授权表初始化失败:', err.message),
);

router.use((req, _res, next) => {
    if (!req.trace_id) req.trace_id = `t-perm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    next();
});

function requireAdmin(req) {
    if (req.user?.role !== 'admin') {
        throw new AppError('FORBIDDEN', '仅管理员可管理技能授权');
    }
}

// ── 角色清单 ─────────────────────────────────────────────────

router.get(
    '/permissions/roles',
    asyncHandler(async (req, res) => {
        let roles = [];
        try {
            const { rows } = await pool.query(
                'SELECT name, display_name, is_builtin FROM sys_roles ORDER BY is_builtin DESC, name',
            );
            roles = rows;
        } catch {
            // 表不可读不炸接口 —— 返回空清单，前端提示
        }
        return sendOk(res, roles, { trace_id: req.trace_id, meta: { total: roles.length } });
    }),
);

// ── 角色 × 技能授权视图 ──────────────────────────────────────

router.get(
    '/permissions/skills',
    asyncHandler(async (req, res) => {
        const role = String(req.query.role || '').trim();
        if (!role) {
            return sendFail(res, new AppError('VALIDATION_FAILED', '缺少 role 参数'), { trace_id: req.trace_id });
        }

        const skills = listSkills({}).filter((s) => s.live !== false);
        const view = await Promise.all(skills.map(async (s) => {
            const r = await evaluateSkillPermission(s, { id: null, role });
            return {
                skill_key: s.skill_key,
                name: s.name,
                scene: s.scene,
                status: r.status,
                reason: r.reason,
                data_scope: r.data_scope || null,
                source: r.source || null,
            };
        }));

        return sendOk(res, view, { trace_id: req.trace_id, meta: { role, total: view.length } });
    }),
);

// ── 设置 / 清除显式授权 ──────────────────────────────────────

router.put(
    '/permissions/skills/:skillKey',
    asyncHandler(async (req, res) => {
        requireAdmin(req);
        const { role_name, granted, data_scope } = req.body || {};
        if (!role_name || typeof granted !== 'boolean') {
            return sendFail(res, new AppError('VALIDATION_FAILED', '缺少 role_name 或 granted（boolean）'), {
                trace_id: req.trace_id,
            });
        }
        if (!getSkill(req.params.skillKey)) {
            return sendFail(res, new AppError('RESOURCE_NOT_FOUND', `技能不存在：${req.params.skillKey}`), {
                trace_id: req.trace_id,
            });
        }
        const row = await store.setPermission({
            skill_key: req.params.skillKey,
            role_name: String(role_name),
            granted,
            data_scope: data_scope ? String(data_scope) : 'self',
            granted_by: req.user.id,
        });
        return sendOk(res, row, { trace_id: req.trace_id });
    }),
);

router.delete(
    '/permissions/skills/:skillKey',
    asyncHandler(async (req, res) => {
        requireAdmin(req);
        const role = String(req.query.role || '').trim();
        if (!role) {
            return sendFail(res, new AppError('VALIDATION_FAILED', '缺少 role 查询参数'), { trace_id: req.trace_id });
        }
        const removed = await store.clearPermission(req.params.skillKey, role);
        return sendOk(res, { removed }, { trace_id: req.trace_id });
    }),
);

export default router;
