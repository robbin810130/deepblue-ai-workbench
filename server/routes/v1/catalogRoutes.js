/**
 * /api/v1 —— 场景与技能接口
 *
 * 文档 `03_API接口规范` §4「场景与技能 API」的落地：
 *   GET  /scenes                    获取当前用户可见场景
 *   GET  /scenes/{sceneKey}         场景详情与可见技能
 *   GET  /skills                    技能检索/筛选
 *   GET  /skills/{skillKey}         技能定义、输入 Schema、权限状态
 *   POST /skills/{skillKey}/prepare 校验输入并返回任务预览/所需字段
 *
 * 鉴权：本路由挂载在 server.js 的全局 `app.use(authenticateToken)` **之后**，
 *       因此所有接口天然要求登录（未登录 → 401），无需重复实现。
 *
 * ⚠️ 权限状态说明：文档要求 `/skills/{skillKey}` 返回「权限状态」。
 *    当前权限模型仍是 `sys_roles.permissions`（appId 数组），缺少 permission_code 与数据范围，
 *    无法精确回答「这个用户能不能跑这个技能」。
 *    因此本版返回 `permission_status: 'not_evaluated'` 并附原因 ——
 *    **不假装已判定**，待 M6 阶段由技能表接管权限语义后启用真实判定。
 */

import express from 'express';
import {
    listSkills,
    getSkill,
    listScenes,
    getScene,
    toApiShape,
    validateSkillInput,
    getStats,
} from '../../modules/catalog/index.js';
import { sendOk, sendFail, asyncHandler, startTimer, resolveTraceId } from '../../modules/common/apiResponse.js';
import { AppError } from '../../modules/common/errors.js';
import { evaluateSkillPermission } from '../../modules/permissions/evaluator.js';
import { getBinding } from '../../modules/providers/bindings.js';

const router = express.Router();

// 链路追踪（文档 03 §1）：X-Trace-Id 客户端可传，缺失时服务端生成
router.use((req, _res, next) => {
    req.trace_id = resolveTraceId(req);
    next();
});

// ─────────────────────────────────────────────────────────────
// 场景
// ─────────────────────────────────────────────────────────────

router.get(
    '/scenes',
    asyncHandler(async (req, res) => {
        const elapsed = startTimer();
        const withSkills = req.query.with_skills === 'true';
        const businessOnly = req.query.business_only === 'true';

        const scenes = listScenes({ with_skills: withSkills, business_only: businessOnly });

        return sendOk(res, scenes, {
            trace_id: req.trace_id,
            meta: { request_time_ms: elapsed(), total: scenes.length },
        });
    }),
);

router.get(
    '/scenes/:sceneKey',
    asyncHandler(async (req, res) => {
        const elapsed = startTimer();
        const scene = getScene(req.params.sceneKey);
        if (!scene) {
            return sendFail(res, new AppError('RESOURCE_NOT_FOUND', `场景不存在：${req.params.sceneKey}`), {
                trace_id: req.trace_id,
            });
        }
        return sendOk(
            res,
            { ...scene, skills: scene.skills.map(toApiShape) },
            { trace_id: req.trace_id, meta: { request_time_ms: elapsed() } },
        );
    }),
);

// ─────────────────────────────────────────────────────────────
// 技能
// ─────────────────────────────────────────────────────────────

router.get(
    '/skills',
    asyncHandler(async (req, res) => {
        const elapsed = startTimer();
        const { scene, query, live, business_only } = req.query;

        const skills = listSkills({
            scene: scene ? String(scene) : undefined,
            query: query ? String(query) : undefined,
            live: live === 'true' ? true : live === 'false' ? false : undefined,
            business_only: business_only === 'true',
        });

        return sendOk(
            res,
            skills.map(toApiShape),
            {
                trace_id: req.trace_id,
                meta: { request_time_ms: elapsed(), total: skills.length },
            },
        );
    }),
);

router.get(
    '/skills/:skillKey',
    asyncHandler(async (req, res) => {
        const elapsed = startTimer();
        const skill = getSkill(req.params.skillKey);
        if (!skill) {
            return sendFail(res, new AppError('RESOURCE_NOT_FOUND', `技能不存在：${req.params.skillKey}`), {
                trace_id: req.trace_id,
            });
        }
        // M6 完整版：技能级显式授权优先 → 旧版映射回落 → 诚实 not_evaluated
        // （判定链见 permissions/evaluator.js；source 标明判定来源）
        const permission = await evaluateSkillPermission(skill, req.user);
        // 对话式改造 P0：暴露绑定的执行形态，前端据此决定默认进入对话模式还是表单模式
        const binding = getBinding(skill.binding_key || skill.skill_key);
        // 2026-09-20 P1-4：显式声明 conversational: false 的技能（批量数据作业 / 多文件 ETL）
        // 一律不进对话式入口 —— interaction_mode 为 null、interactive_enabled 为 false，
        // 前端据此回落到表单模式（这些技能的既有入口见各自 legacy.routes）。
        const conversational = skill.conversational !== false;
        // 2026-09-21：视图型技能（声明了 view_panel，如 dashboard_center）—— 它没有
        // 「执行」语义，前端应渲染专属面板而非表单/对话。interaction_mode 是前端唯一判据，
        // 故在此扩展出 'view'；未声明 view_panel 的技能行为完全不变（零回归）。
        const viewPanel = skill.view_panel || null;
        return sendOk(
            res,
            {
                ...toApiShape(skill),
                endpoint_kind: binding?.endpoint_kind || null,
                chat_enabled:
                    !viewPanel && conversational && binding?.provider === 'dify' && binding?.endpoint_kind === 'chat',
                // 对话式改造 P1：workflow 类技能走「对话收集参数 → 确认 → 执行」，
                // 前端据此决定默认进入哪种对话模式（interaction_mode 是唯一判据）
                slot_enabled: !viewPanel && conversational && binding?.endpoint_kind === 'workflow',
                interaction_mode: viewPanel
                    ? 'view'
                    : !conversational
                      ? null
                      : binding?.endpoint_kind === 'workflow'
                        ? 'slot'
                        : binding?.provider === 'dify' && binding?.endpoint_kind === 'chat'
                          ? 'chat'
                          : null,
                interactive_enabled:
                    !viewPanel &&
                    conversational &&
                    (binding?.endpoint_kind === 'workflow' ||
                        (binding?.provider === 'dify' && binding?.endpoint_kind === 'chat')),
                view_panel: viewPanel,
                permission_status: permission.status,
                permission_status_reason: permission.reason,
                permission_source: permission.source || null,
                permission_data_scope: permission.data_scope || null,
            },
            { trace_id: req.trace_id, meta: { request_time_ms: elapsed() } },
        );
    }),
);

/**
 * POST /skills/{skillKey}/prepare
 * 文档 03 §4：校验输入并返回任务预览/所需字段。
 *
 * 用途：前端在提交前先问一次「我这次输入齐了吗」，
 *       缺什么直接高亮，而不是等任务创建失败才知道。
 */
router.post(
    '/skills/:skillKey/prepare',
    asyncHandler(async (req, res) => {
        const elapsed = startTimer();
        const skill = getSkill(req.params.skillKey);
        if (!skill) {
            return sendFail(res, new AppError('RESOURCE_NOT_FOUND', `技能不存在：${req.params.skillKey}`), {
                trace_id: req.trace_id,
            });
        }

        const input = req.body?.inputs || req.body || {};
        const check = validateSkillInput(skill.skill_key, input);

        if (!check.ok) {
            return sendFail(
                res,
                new AppError('VALIDATION_FAILED', '输入不满足技能要求', {
                    detail: check.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
                    extra: check.errors,
                }),
                { trace_id: req.trace_id, exposeDetail: true },
            );
        }

        return sendOk(
            res,
            {
                skill_key: skill.skill_key,
                name: skill.name,
                scene: skill.scene,
                execution_mode: skill.execution_mode,
                requires_confirmation: skill.requires_confirmation,
                input_kind: toApiShape(skill).input_kind,
                // 任务预览：告诉前端这次提交会长什么样
                preview: {
                    title_suggestion: `${skill.name}`,
                    will_track: skill.task?.trackable === true,
                    will_need_confirmation: skill.requires_confirmation === true,
                    artifact_kind: skill.artifact_kind,
                },
                normalized_inputs: input,
            },
            { trace_id: req.trace_id, meta: { request_time_ms: elapsed() } },
        );
    }),
);

// ─────────────────────────────────────────────────────────────
// 健康检查（供运维页与部署校验，不含敏感配置）
// ─────────────────────────────────────────────────────────────

router.get(
    '/health/skills',
    asyncHandler(async (req, res) => {
        const elapsed = startTimer();
        const stats = getStats();
        const report = await import('../../modules/catalog/index.js').then((m) => m.getValidationReport());

        return sendOk(
            res,
            {
                registry: stats,
                validation: { errors: report.errors.length, warnings: report.warnings.length },
            },
            { trace_id: req.trace_id, meta: { request_time_ms: elapsed() } },
        );
    }),
);

export default router;
