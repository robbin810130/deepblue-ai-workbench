#!/usr/bin/env node
/**
 * fix-dify-model-providers.mjs —— 审计并修复 Dify 应用里 LLM 节点的 provider/model 错配
 *
 * 背景（本地 Dify 实测踩出来的）：
 *   LLM 节点里 `model.provider` 与 `model.name` 必须出自同一个供应商 —— 校验是
 *   「拿 provider 去问它认不认这个 model 名」，认不出就 400 `Model xxx not exist.`。
 *   本地这批 DSL 里有一类系统性笔误：模型名对、供应商写错。典型：
 *     · provider=langgenius/deepseek/deepseek + name=qwen3-max   ← qwen3-max 只在通义下
 *     · provider=langgenius/tongyi/tongyi     + name=deepseek-v4-flash ← 只在 deepseek 下
 *   症状是技能一定失败，但 /parameters 却是 200 —— 只看「配齐了没」会漏掉。
 *
 * 判定：拿「租户可用模型清单」（控制台 API）算 `model → 拥有它的供应商集合`：
 *   · name 不在清单里      → 无法自动修（本地根本没这个模型），只报告
 *   · provider 不拥有 name → 可自动修：把 provider 改成拥有该 name 的那家（name 不动）
 *
 * 用法：
 *   node scripts/fix-dify-model-providers.mjs                       # 只审计
 *   DIFY_EMAIL=.. DIFY_PASSWORD=.. node scripts/fix-dify-model-providers.mjs --apply
 *   --apply 会：改草稿 → 发布 → 写 dify-bundle/model-provider-fixes.json（含 before，可回滚）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './lib/dify-console.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUNDLE = path.join(ROOT, 'dify-bundle');
const APPLY = process.argv.includes('--apply');
/** --only=子串1,子串2 只处理名字命中的应用（限制改动面：未被绑定引用的同病副本先不动） */
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').replace('--only=', '')
    .split(',').map((s) => s.trim()).filter(Boolean);
const inScope = (name) => !ONLY.length || ONLY.some((s) => name.includes(s));

const api = await connect();
const owners = await api.modelOwners();
const apps = await api.apps();
console.log(`登录成功 · 租户可用模型 ${owners.size} 个 · 应用 ${apps.length} 个\n`);

const fixable = [];   // 可自动修
const blocked = [];   // 模型名本地不存在，修不了

for (const app of apps) {
    // ⚠️ 不要按 mode 过滤：advanced-chat（chatflow）的 LLM 节点同样在 workflows.graph 里，
    //    物料匹配&报价审核_0818 就是 advanced-chat —— 早先按 mode==='workflow' 过滤时它被整片漏掉。
    if (!inScope(app.name)) continue;
    let draft;
    try { draft = await api.draft(app.id); } catch { continue; }
    const nodes = draft.graph?.nodes || [];
    for (const n of nodes) {
        const m = n.data?.model;
        if (!m || typeof m !== 'object' || !m.name) continue;
        const ps = owners.get(m.name);
        if (!ps) {
            blocked.push({ app: app.name, app_id: app.id, node_id: n.id, provider: m.provider, name: m.name });
        } else if (!ps.has(m.provider)) {
            fixable.push({ app: app.name, app_id: app.id, node_id: n.id, provider: m.provider, name: m.name, to: [...ps] });
        }
    }
}

console.log(`❌ 模型名本地不存在（无法自动修）${blocked.length} 处：`);
for (const b of blocked) console.log(`   ${b.app.padEnd(34)} ${b.provider} / ${b.name}`);
console.log(`\n🔧 provider 写错但模型名可用（可自动修）${fixable.length} 处：`);
for (const f of fixable) console.log(`   ${f.app.padEnd(34)} ${f.provider} / ${f.name}  →  ${f.to.join('|')}`);

if (!fixable.length) { console.log('\n无需修复。'); process.exit(0); }
if (!APPLY) { console.log('\n（未改动；加 --apply 执行）'); process.exit(0); }

// ── 按应用分组执行：改草稿 → 发布 ─────────────────────────────
const byApp = new Map();
for (const f of fixable) {
    if (!byApp.has(f.app_id)) byApp.set(f.app_id, { name: f.app, items: [] });
    byApp.get(f.app_id).items.push(f);
}

const record = [];
let ok = 0;
for (const [appId, { name, items }] of byApp) {
    const draft = await api.draft(appId);
    let touched = 0;
    for (const n of (draft.graph?.nodes || [])) {
        const m = n.data?.model;
        if (!m || typeof m !== 'object' || !m.name) continue;
        const ps = owners.get(m.name);
        if (!ps || ps.has(m.provider)) continue;
        const to = [...ps][0];
        record.push({ app: name, app_id: appId, node_id: n.id, from: m.provider, to, model: m.name });
        m.provider = to;
        touched++;
    }
    if (!touched) { console.log(`⏭  ${name}：无改动`); continue; }

    const saved = await api.saveDraft(appId, draft);
    if (saved.status !== 200) {
        console.log(`❌ ${name}：草稿保存失败 HTTP ${saved.status} ${saved.text.slice(0, 140)}`);
        continue;
    }
    const pub = await api.publish(appId);
    if (pub.status !== 200) {
        console.log(`❌ ${name}：发布失败 HTTP ${pub.status} ${pub.text.slice(0, 140)}`);
        continue;
    }
    console.log(`✅ ${name}：修 ${touched} 个节点并已发布`);
    ok++;
}

const out = {
    generated_at: new Date().toISOString(),
    console: api.console,
    note: 'LLM 节点 provider/model 纠错记录。from 为原供应商，据此可回滚。',
    fixes: record,
};
fs.writeFileSync(path.join(BUNDLE, 'model-provider-fixes.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`\n成功修复 ${ok}/${byApp.size} 个应用，共 ${record.length} 个节点`);
console.log(`已写入 ${path.relative(ROOT, path.join(BUNDLE, 'model-provider-fixes.json'))}`);
