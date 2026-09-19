#!/usr/bin/env node
/**
 * gen-env-from-dify.mjs —— 用**本地 Dify** 的真实应用/Tokens 生成 .env 的 DIFY_* 段落
 *
 * 为什么要这个脚本（而不是手抄）：
 *   46 条 WorkflowBinding 对应 90 个环境变量，手抄必错；且绑定↔应用的对应关系来自
 *   源生产环境的实测吻合（binding-map.json）。脚本化后，换 Dify 实例只需改 DIFY_BASE 重跑。
 *
 * 数据源（全部只读）：
 *   1. server/modules/providers/bindings.js   —— 权威绑定清单（env 变量名 + endpoint_kind）
 *   2. dify-bundle/binding-map.json           —— 绑定 ↔ Dify 应用（verified/draft-high/inactive）
 *   3. dify-bundle/app-inventory.json         —— 应用清单（含 api_tokens 与 mode）
 *   4. dify-bundle/dataset-tokens.tsv         —— 租户级 dataset token（知识检索类共用）
 *   5. ../../dify/.env                        —— 源生产 env（用于在「一个应用多把 token」时选定正确那把）
 *   6. dify-bundle/local-overrides.json       —— 本地 Dify 补齐的凭据（优先级最高）
 *      源生产为空的绑定，本地若有对应应用（且已发布）则由 provision-local-dify.mjs 签发，
 *      覆盖 binding-map 的 inactive/unmapped 判定 —— 让这些技能在本地可跑。
 *
 * 产物：
 *   - dify-bundle/.env.generated              可直接覆盖 .env 的完整内容
 *   - stdout                                  体检报告（配置齐/未映射/代码引用但未配置）
 *
 * 用法：
 *   node scripts/gen-env-from-dify.mjs                      # 默认 http://localhost:8088/v1
 *   DIFY_BASE=http://nginx/v1 node scripts/gen-env-from-dify.mjs   # 生成装机版
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BINDINGS } = require('../server/modules/providers/bindings.js');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUNDLE = path.join(ROOT, 'dify-bundle');
const DIFY_BASE = (process.env.DIFY_BASE || 'http://localhost:8088/v1').replace(/\/+$/, '');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const readEnvFile = (p) => {
    const out = {};
    if (!fs.existsSync(p)) return out;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (m) out[m[1]] = m[2].trim();
    }
    return out;
};

const inventory = readJson(path.join(BUNDLE, 'app-inventory.json'));
const bindingMap = readJson(path.join(BUNDLE, 'binding-map.json'));
const legacyEnv = readEnvFile(path.join(ROOT, '..', 'dify', '.env')); // 源生产 env（只读参考）
const currentEnv = readEnvFile(path.join(ROOT, '.env'));

const appById = new Map(inventory.map((a) => [a.id, a]));
const tokenOwner = new Map(); // token → app
for (const a of inventory) for (const t of a.api_tokens || []) tokenOwner.set(t, a);

const DATASET_TOKEN = (() => {
    try {
        const line = fs.readFileSync(path.join(BUNDLE, 'dataset-tokens.tsv'), 'utf8').trim().split('\n')[0] || '';
        return line.split('|')[0] || null;
    } catch { return null; }
})();

const mapByKey = new Map(bindingMap.bindings.map((b) => [b.binding_key, b]));

/** 本地 Dify 补齐的凭据（源生产为空、本地有应用）：优先级最高 */
const localOverrides = (() => {
    const p = path.join(BUNDLE, 'local-overrides.json');
    if (!fs.existsSync(p)) return new Map();
    try {
        const j = readJson(p);
        return new Map(Object.entries(j.bindings || {}).map(([k, v]) => [k, {
            id: v.app_id, name: v.app_name, mode: v.mode, _token: v.token, _note: v.note, _risk: v.risk,
        }]));
    } catch { return new Map(); }
})();

/** 别名：源生产 env 里绑定的值挂在别的变量名下（命名演化） */
const KEY_ENV_ALIASES = {
    DIFY_DOC_COPYWRITING_API_KEY: ['DIFY_DOC_DRAFTING_API_KEY'],
    DIFY_PRODUCT_ENTRY_API_KEY: ['DIFY_BRAND_EXTRACT_API_KEY'],
    DIFY_PRODUCT_LIBRARY_API_KEY: ['DIFY_BRAND_EXTRACT_API_KEY'],
    DIFY_MARKETING_ANALYSIS_API_KEY: ['DIFY_CHATFLOW_API_KEY'],
};

/** 应用模式 → 该应用支持的端点半型 */
const modeKind = (mode) => (mode === 'workflow' ? 'workflow' : 'chat');

/** 选定该绑定要用的 token */
function pickToken(b) {
    const m = mapByKey.get(b.binding_key);
    if (!m) return { token: null, how: 'no-map-entry' };

    // ⓪ 本地补签（源生产为空的绑定，本地已发布应用 + 已签发 token）——最高优先级
    const ov = localOverrides.get(b.binding_key);
    if (ov?._token) {
        return { token: ov._token, how: 'local-override', app: ov };
    }

    // ① dataset token 类（知识检索）
    if (m.match?.via?.includes('dataset-token')) {
        return { token: DATASET_TOKEN, how: 'dataset-token', app: null };
    }
    // ② 应用型
    if (m.match?.app_id) {
        const app = appById.get(m.match.app_id);
        if (!app) return { token: null, how: 'app-missing-in-inventory' };
        const tokens = app.api_tokens || [];
        if (!tokens.length) return { token: null, how: 'app-has-no-token', app };
        // 生产 env 里该绑定实测用的那把（多 token 应用必须选同一把，否则历史会话/统计分裂）
        const names = [b.api_key_env, ...(KEY_ENV_ALIASES[b.api_key_env] || [])];
        for (const n of names) {
            if (legacyEnv[n] && tokens.includes(legacyEnv[n])) return { token: legacyEnv[n], how: `legacy:${n}`, app };
        }
        return { token: tokens[0], how: 'first-token', app };
    }
    return { token: null, how: 'unmapped', app: null };
}

// ── 逐条解析 ────────────────────────────────────────────────
const rows = [];
for (const b of BINDINGS) {
    if (b.provider === 'internal') { rows.push({ b, state: 'internal' }); continue; }
    if (b.provider !== 'dify') { rows.push({ b, state: 'non-dify' }); continue; }
    const { token, how, app } = pickToken(b);
    rows.push({
        b, token, how, app,
        state: token ? 'ready' : (mapByKey.get(b.binding_key)?.inactive ? 'source-inactive' : 'gap'),
        kindMismatch: app ? modeKind(app.mode) !== b.endpoint_kind : false,
    });
}

const ready = rows.filter((r) => r.state === 'ready');
const gaps = rows.filter((r) => r.state === 'gap');
const inactive = rows.filter((r) => r.state === 'source-inactive');

// ── 生成 .env ──────────────────────────────────────────────
const L = [];
const section = (title) => { L.push(''); L.push(`# ${'─'.repeat(4)} ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`); };

L.push('# ============================================================');
L.push('# 深蓝工作台 · 本地开发环境变量（不入 git，.gitignore 已覆盖）');
L.push('# 生产部署：同步到 Windows 生产机 PM2 工作目录，勿提交仓库');
L.push(`# 本文件由 scripts/gen-env-from-dify.mjs 生成（DIFY_BASE=${DIFY_BASE}）`);
L.push(`# 生成时间：${new Date().toISOString()}`);
L.push('# 密钥来源：本地 Dify 库 api_tokens（与源生产同库同 token，换实例重跑脚本即可）');
L.push('# ============================================================');
L.push('');
L.push('# ── 全局 Dify 出口 ─────────────────────────────────────────');
L.push('# 供 difyKnowledgeService 与 hazard_detection 等无专属地址的绑定使用');
L.push(`DIFY_API_BASE_URL=${DIFY_BASE}`);
L.push('# 兼容旧执行体（server/routes/*.js 直读该变量）');
L.push(`DIFY_API_URL=${DIFY_BASE}/chat-messages`);
L.push('# 平台内部工作流通道（business_dashboard 的回退链）');
L.push(`DIFY_WORKFLOW_BASE_URL=${DIFY_BASE}`);
if (legacyEnv.DIFY_WORKFLOW_API_KEY && tokenOwner.has(legacyEnv.DIFY_WORKFLOW_API_KEY)) {
    L.push(`DIFY_WORKFLOW_API_KEY=${legacyEnv.DIFY_WORKFLOW_API_KEY}`);
}
L.push('# 知识检索类共用租户级 dataset token');
if (DATASET_TOKEN) L.push(`DIFY_KNOWLEDGE_API_KEY=${DATASET_TOKEN}`);
L.push(`DIFY_KNOWLEDGE_DATASET_ID=${legacyEnv.DIFY_KNOWLEDGE_DATASET_ID || ''}`);
if (DATASET_TOKEN) L.push(`DIFY_EQ_KNOWLEDGE_API_KEY=${DATASET_TOKEN}`);
L.push(`DIFY_EQ_KNOWLEDGE_API_URL=${DIFY_BASE}`);
if (DATASET_TOKEN) L.push(`DIFY_MEMORY_API_KEY=${DATASET_TOKEN}`);

// 按场景分组输出（顺序沿用 bindings.js 的申报顺序）
let lastDisplayPrefix = null;
for (const r of rows) {
    const b = r.b;
    if (b.provider === 'internal') continue;
    const grp = b.binding_key.includes('.') ? b.binding_key.split('.')[0] : b.binding_key;
    const prefix = grp.replace(/[^a-z]/gi, '').slice(0, 3);
    if (prefix !== lastDisplayPrefix) { lastDisplayPrefix = prefix; }
    section(`${b.display_name}（${b.binding_key}）`);
    if (r.state === 'non-dify') {
        L.push(`# ⚠️ 非 Dify 提供方（provider=${b.provider}），未配置；源生产同样为空`);
        continue;
    }
    const urlName = b.base_url_env || 'DIFY_API_BASE_URL';
    const keyName = b.api_key_env;
    if (r.state === 'ready') {
        const appNote = r.app ? `${r.app.name}[${r.app.mode}]` : 'dataset token';
        L.push(`# ${appNote} · endpoint_kind=${b.endpoint_kind}${r.kindMismatch ? ' ⚠️ 与上面应用模式不符！' : ''} · token 取自 ${r.how}`);
        if (r.app?._risk) L.push(`# ${r.app._risk}`);
        L.push(`${urlName}=${DIFY_BASE}`);
        L.push(`${keyName}=${r.token}`);
    } else {
        L.push(`# ❌ 未配置：${r.state === 'source-inactive' ? '源生产环境同样未启用（inactive，非本次遗漏）' : '本地无对应应用或应用未签发 token'}`);
        L.push(`${urlName}=`);
        L.push(`${keyName}=`);
    }
}

// 旧执行体仍直读的历史变量名（与 binding 变量名不同名的补上）
section('旧执行体历史变量名（保持兼容）');
L.push(`DIFY_BUSINESS_DASHBOARD_API_URL=${DIFY_BASE}/chat-messages`);
// product_entry 绑定用 DIFY_PRODUCT_ENTRY_*，但旧 routes/productEntry.js 直读 DIFY_BRAND_EXTRACT_*
{
    const pe = rows.find((r) => r.b.binding_key === 'product_entry');
    if (pe?.token) {
        L.push('# product_entry 的旧变量名（routes/productEntry.js 直读）');
        L.push(`DIFY_BRAND_EXTRACT_API_KEY=${pe.token}`);
        L.push(`DIFY_BRAND_EXTRACT_API_URL=${DIFY_BASE}`);
    }
}
L.push('# 知识库检索的库 ID（源环境为空，留白即"未指定"）');
L.push(`DIFY_TENDER_KNOWLEDGE_DATASET_ID=${legacyEnv.DIFY_TENDER_KNOWLEDGE_DATASET_ID || ''}`);
L.push(`DIFY_PRODUCT_DATASET_ID=${legacyEnv.DIFY_PRODUCT_DATASET_ID || ''}`);

// 保留原文件中与 Dify 无关的自有配置
const KEEP = ['TASK_CENTER_PILOT', 'JWT_SECRET'];
section('平台自有配置（沿用原值）');
for (const k of KEEP) if (currentEnv[k] !== undefined) L.push(`${k}=${currentEnv[k]}`);
L.push('');

const outPath = path.join(BUNDLE, '.env.generated');
fs.writeFileSync(outPath, L.join('\n') + '\n');

// ── 体检报告 ────────────────────────────────────────────────
console.log(`\n绑定 ${rows.length} 条：配置齐 ${ready.length} · 源环境未启用 ${inactive.length} · 缺口 ${gaps.length}\n`);
console.log('⚠️ endpoint_kind 与应用模式不符（会 400，须修 binding）：');
const mm = rows.filter((r) => r.kindMismatch);
if (!mm.length) console.log('  （无）');
for (const r of mm) console.log(`  ${r.b.binding_key.padEnd(32)} binding=${r.b.endpoint_kind} app=${r.app.name}[${r.app.mode}]`);
console.log('\n❌ 仍缺凭据的绑定：');
for (const r of [...gaps, ...inactive]) {
    console.log(`  ${r.b.binding_key.padEnd(32)} ${r.state === 'gap' ? '缺应用/缺token' : '源环境未启用'}  (${r.b.display_name})`);
}

// 代码引用但 .env 未覆盖的 DIFY_* 变量
const referenced = new Set();
const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.(js|mjs|cjs|ts|tsx)$/.test(e.name)) continue;
        const txt = fs.readFileSync(p, 'utf8');
        for (const m of txt.matchAll(/process\.env\.([A-Z0-9_]*(?:DIFY|ARK)[A-Z0-9_]*)/g)) referenced.add(m[1]);
    }
};
walk(path.join(ROOT, 'server'));
const written = new Set(L.filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => l.split('=')[0]));
const missing = [...referenced].filter((n) => !written.has(n) && !n.endsWith('_URL') && n !== 'DIFY_API_KEY');
console.log('\n📎 代码引用但 .env 未覆盖的变量（含空值即视为已覆盖）：');
if (!missing.length) console.log('  （无）');
for (const n of missing.sort()) console.log(`  ${n}`);
console.log(`\n已写入 ${path.relative(ROOT, outPath)}（${L.length} 行）`);
