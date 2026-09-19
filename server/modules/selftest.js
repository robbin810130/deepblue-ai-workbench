/**
 * M1/M2 模块自检 —— 不启动 HTTP 服务，直接验证核心契约。
 *
 * 运行：node server/modules/selftest.js
 * 退出码：0 = 全部通过；1 = 存在失败项。
 *
 * 覆盖：
 *   1. 注册表完整性（数量 / 唯一性 / 校验零错零警）
 *   2. 场景与技能查询能力
 *   3. 输入校验（prepare 契约）
 *   4. 绑定注册表体检（bindings × 环境变量）
 *   5. Dify 输出归一化（多种返回形态）
 */

import {
    ALL_SKILLS,
    listSkills,
    getSkill,
    listScenes,
    getStats,
    getValidationReport,
    validateSkillInput,
    toApiShape,
} from './catalog/index.js';
import { healthCheck } from './providers/index.js';
import { normalizeWorkflowResult } from './providers/normalizer.js';
import { normalizeBaseUrl } from './providers/difyClient.js';
import {
    TASK_STATUSES,
    STATUS_LABELS,
    canTransition,
    can as canAction,
    nextStatuses,
} from './tasks/states.js';

const results = [];
/** @param {string} name @param {boolean} ok @param {string} [note] */
function check(name, ok, note = '') {
    results.push({ name, ok, note });
    console.log(`${ok ? '✅' : '❌'} ${name}${note ? ` —— ${note}` : ''}`);
}

console.log('\n========== M1/M2 自检 ==========\n');

// ── 1. 注册表完整性 ──────────────────────────────────────────
const stats = getStats();
const report = getValidationReport();
check('注册表非空', ALL_SKILLS.length > 0, `共 ${ALL_SKILLS.length} 条技能`);
check('启动期校验零错误', report.errors.length === 0, report.errors.join(' | ') || '无');
check('启动期校验零警告', report.warnings.length === 0, report.warnings.join(' | ') || '无');

const keys = ALL_SKILLS.map((s) => s.skill_key);
check('skill_key 全局唯一', new Set(keys).size === keys.length);
check('skill_key 均为 snake_case', keys.every((k) => /^[a-z][a-z0-9_]*$/.test(k)));
// 2026-09-19：5 个幽灵技能（meeting_minutes / digital_employee / doc_drafting /
// rules_assistant / material_quote）已全部开门，注册表应无 live:false 残留。
// 若再次出现，说明有人新加了未上线的技能 → 属于需要复核的「暗资产」。
const ghosts = ALL_SKILLS.filter((s) => s.live === false);
check(
    '技能注册表无 live:false 暗资产（幽灵技能已开门）',
    ghosts.length === 0,
    ghosts.length ? `仍有：${ghosts.map((g) => g.skill_key).join(', ')}` : `live 共 ${stats.live}/${stats.total}`,
);

// ── 2. 查询能力 ──────────────────────────────────────────────
const scenes = listScenes();
check('场景清单 ≥ 6 个业务场景', scenes.filter((s) => s.is_business).length >= 6, `共 ${scenes.length} 个（含系统分类）`);
const byScene = listSkills({ scene: 'market_customer' });
check('按场景筛选有效', byScene.length > 0 && byScene.every((s) => s.scene === 'market_customer'), `${byScene.length} 条`);
check('getSkill 命中', getSkill('contract_review')?.name === '合同审核');
check('getSkill 未命中返回 null', getSkill('__nope__') === null || getSkill('__nope__') === undefined);

// ── 3. 输入校验（prepare 契约）───────────────────────────────
const skill = getSkill('contract_review');
if (skill) {
    const missing = validateSkillInput('contract_review', {});
    const ok = validateSkillInput('contract_review', buildMinimalInput(skill));
    check('缺输入被拦下', missing.ok === false, missing.errors?.map((e) => e.field).join(',') || '');
    check('齐输入放行', ok.ok === true);
} else {
    check('contract_review 存在', false);
}

/** 从 input_schema 的 required + properties 类型构造最小合法输入 */
function buildMinimalInput(s) {
    const required = s.input_schema?.required || [];
    const props = s.input_schema?.properties || {};
    const out = {};
    for (const key of required) {
        const type = props[key]?.type || 'string';
        if (type === 'object') out[key] = {};
        else if (type === 'array') out[key] = [];
        else if (type === 'number') out[key] = 1;
        else if (type === 'boolean') out[key] = true;
        else out[key] = 'x';
    }
    return out;
}

// ── 4. 绑定体检 ──────────────────────────────────────────────
const hc = healthCheck();
check('绑定注册表非空', hc.total > 0, `共 ${hc.total} 条`);
check('pending 绑定已登记且不崩溃', typeof hc.pending === 'number', `pending=${hc.pending} (${hc.pending_keys.join(',') || '无'})`);

// ── 5. base_url 归一化 ──────────────────────────────────────
check('base_url 规范为带 /v1 根地址', normalizeBaseUrl('http://h:80/v1') === 'http://h:80/v1');
check('base_url 剥 /chat-messages', normalizeBaseUrl('http://h:80/v1/chat-messages') === 'http://h:80/v1');
check('base_url 剥 /workflows/run', normalizeBaseUrl('http://h:80/v1/workflows/run') === 'http://h:80/v1');
check('base_url 漏写 /v1 自动补全', normalizeBaseUrl('http://h:80') === 'http://h:80/v1');

// ── 6. 输出归一化 ────────────────────────────────────────────
const fakeSkill = {
    skill_key: 'selftest',
    name: '自检',
    output_schema: { type: 'object', properties: { summary: { type: 'string' } } },
};
const shapes = [
    ['outputs 直出', { data: { status: 'succeeded', outputs: { summary: 'A' } } }, 'A'],
    ['data.outputs 嵌套', { data: { data: { outputs: { summary: 'B' } } } }, 'B'],
    ['JSON 字符串', { data: { outputs: { result: '{"summary":"C"}' } } }, 'C'],
    ['代码围栏', { data: { outputs: { result: '```json\n{"summary":"D"}\n```' } } }, 'D'],
];
for (const [label, raw, expect] of shapes) {
    const r = normalizeWorkflowResult({ raw, skill: fakeSkill, duration_ms: 5 });
    check(`归一化：${label}`, r.status === 'succeeded' && r.summary === expect, `summary="${r.summary}"`);
}
const failed = normalizeWorkflowResult({
    raw: { data: { status: 'failed', error: 'boom' } },
    skill: fakeSkill,
    duration_ms: 5,
});
check('归一化：失败状态透传', failed.status === 'failed');

// ── 7. API Shape 冒烟 ────────────────────────────────────────
const shape = toApiShape(getSkill('contract_review'));
check('toApiShape 输出 snake_case 键', ['skill_key', 'name', 'scene', 'input_kind'].every((k) => k in shape));

// ── 8. 任务状态机（M3，PRD §2–§3）────────────────────────────
check('状态机：八态封闭枚举', TASK_STATUSES.length === 8 && Object.keys(STATUS_LABELS).length === 8);
check('状态机：主链 draft→queued→running', canTransition('draft', 'queued') && canTransition('queued', 'running'));
check('状态机：running→成功/失败/取消/待确认', ['succeeded', 'failed', 'cancelled', 'waiting_confirmation'].every((s) => canTransition('running', s)));
check('状态机：待确认→确认(成功)/驳回(取消)', canTransition('waiting_confirmation', 'succeeded') && canTransition('waiting_confirmation', 'cancelled'));
check('状态机：重试 failed/cancelled→queued（新 Run）', canTransition('failed', 'queued') && canTransition('cancelled', 'queued'));
check('状态机：归档 succeeded→archived', canTransition('succeeded', 'archived'));
check('状态机：非法迁移被拦（archived 不可复活/终态不可互跳）', !canTransition('archived', 'queued') && !canTransition('succeeded', 'failed') && !canTransition('draft', 'running'));
check('状态机：草稿允许执行/编辑/删除', ['execute', 'edit', 'delete'].every((a) => canAction('draft', a)));
check('状态机：待确认允许 confirm/reject', canAction('waiting_confirmation', 'confirm') && canAction('waiting_confirmation', 'reject'));
check('状态机：nextStatuses(queued) = running+cancelled', nextStatuses('queued').sort().join(',') === 'cancelled,running');

// ── 9. 文件签名 URL（M4，PRD §9）────────────────────────────
import { signDownload, verifyDownload, DEFAULT_DOWNLOAD_TTL_MS } from './files/fileStore.js';
{
    const { url } = signDownload('artifact', 'a1b2c3', 60_000);
    const q = Object.fromEntries(new URL(url, 'http://x').searchParams);
    check('签名URL：合法签名通过校验', verifyDownload(q) === true);
    check('签名URL：过期被拒', verifyDownload({ ...q, exp: String(Date.now() - 1) }) === false);
    check('签名URL：篡改 id 被拒', verifyDownload({ ...q, id: 'hacked' }) === false);
    check('签名URL：篡改 sig 被拒', verifyDownload({ ...q, sig: 'deadbeef'.repeat(8) }) === false);
    check('签名URL：kind 混用被拒（staged≠artifact）', verifyDownload({ ...q, kind: 'staged' }) === false);
    check('签名URL：默认 TTL = 10 分钟', DEFAULT_DOWNLOAD_TTL_MS === 600_000);
}

// ── 10. 权限评估器（M6 先行版）──────────────────────────────
import { LEGACY_APP_MAP, evaluateSkillPermission } from './permissions/evaluator.js';
{
    const mappedCount = Object.keys(LEGACY_APP_MAP).length;
    check('权限映射：36 旧应用映射非空', mappedCount >= 30, `映射 ${mappedCount} 个技能`);
    const granted = await evaluateSkillPermission({ skill_key: 'contract_review' }, { id: 1, role: 'admin' });
    check('权限判定：admin 直接放行', granted.status === 'granted', granted.reason);
}

// ── 汇总 ─────────────────────────────────────────────────────
const failedCount = results.filter((r) => !r.ok).length;
console.log(`\n========== 结果：${results.length - failedCount}/${results.length} 通过 ==========\n`);
process.exit(failedCount > 0 ? 1 : 0);
