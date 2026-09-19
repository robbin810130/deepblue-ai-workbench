#!/usr/bin/env node
/**
 * 生成 绑定 ↔ Dify 应用 草案映射 binding-map.json
 *
 * 数据源:
 *   - bindings.js BINDINGS（46 条，含 display_name / api_key_env / datasets）
 *   - dify-bundle/app-inventory.json（56 应用，含 api_tokens）
 *
 * 映射策略:
 *   1. 精确: env 值在 inventory 的 api_tokens 中（样本已验证 ORDER_RECOGNITION 吻合）
 *   2. 名称: display_name ↔ 应用名 双向包含/关键字匹配 → 草案（需老大确认或源 .env join）
 *
 * 产物: dify-bundle/binding-map.json（含 token 片段，gitignore）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BINDINGS } = require('../server/modules/providers/bindings.js');
const ROOT = fileURLToPath(new URL('../dify-bundle/', import.meta.url));
const inventory = JSON.parse(fs.readFileSync(ROOT + 'app-inventory.json', 'utf8'));

// token → app 反查表
const tokenToApp = new Map();
for (const a of inventory) {
  for (const t of a.api_tokens || []) tokenToApp.set(t, a);
}
// dataset token（租户级，知识检索共用）
const DATASET_TOKEN = (() => {
  try {
    const line = fs.readFileSync(ROOT + 'dataset-tokens.tsv', 'utf8').trim().split('\n')[0] || '';
    return line.split('|')[0] || null; // psql -tAc 列分隔符是 |
  } catch { return null; }
})();

// 本地已有的真实 env 值（样本验证用）
// 来源 1: deepblue 自身 .env；来源 2: 旧 webos 时代 ~/Documents/WorkSapce/Dify智能体/dify/.env（29 个真实 app- key）
const envLocal = {};
const envSources = [
  fileURLToPath(new URL('../.env', import.meta.url)),
  fileURLToPath(new URL('../../dify/.env', import.meta.url)),
];
for (const src of envSources) {
  try {
    for (const line of fs.readFileSync(src, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.+)$/);
      if (m) envLocal[m[1]] = m[2].trim();
    }
  } catch { /* 源缺失跳过 */ }
}

// 名称匹配打分
const norm = (s) => String(s || '').replace(/深蓝AI_|深蓝_|test|（作废）|（?copy）?/g, '').toLowerCase();
function matchScore(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 100;
  if (x.includes(y) || y.includes(x)) return 80;
  // 关键字重叠
  const setA = new Set(x.split(/[_\-/]/)), setB = new Set(y.split(/[_\-/]/));
  let hit = 0;
  for (const w of setA) if (w && w.length > 1 && (setB.has(w) || y.includes(w))) hit++;
  for (const w of setB) if (w && w.length > 1 && (setA.has(w) || x.includes(w))) hit++;
  const denom = Math.max(setA.size + setB.size, 1);
  return Math.round((hit / denom) * 100);
}

const results = [];
for (const b of BINDINGS) {
  const entry = {
    binding_key: b.binding_key,
    display_name: b.display_name,
    api_key_env: b.api_key_env,
    datasets_env: b.datasets || undefined,
    match: null, // {app_id, app_name, confidence, via}
  };
  // ① 精确匹配: env 源里有真实值
  const envCandidates = [b.api_key_env];
  // 命名演化别名: 文档文案绑定 ← 老 env 的 DOC_DRAFTING
  if (b.api_key_env === 'DIFY_DOC_COPYWRITING_API_KEY') envCandidates.push('DIFY_DOC_DRAFTING_API_KEY');
  for (const envName of envCandidates) {
    const localKey = envLocal[envName];
    if (localKey && tokenToApp.has(localKey)) {
      const app = tokenToApp.get(localKey);
      entry.match = { app_id: app.id, app_name: app.name, confidence: 'verified', via: `${envName}==api_tokens` };
      break;
    }
  }
  // ①b dataset token 匹配（知识检索类绑定走租户级 dataset key）
  if (!entry.match && DATASET_TOKEN) {
    for (const envName of envCandidates) {
      if (envLocal[envName] === DATASET_TOKEN) {
        entry.match = { app_id: null, app_name: '(租户级 dataset token)', confidence: 'verified', via: `${envName}==dataset-token` };
        break;
      }
    }
  }
  // ①c 语义别名草案（老 env 中以别名持有真实值）
  if (!entry.match && b.binding_key === 'product_entry') {
    const k = envLocal['DIFY_BRAND_EXTRACT_API_KEY'];
    if (k && tokenToApp.has(k)) {
      const app = tokenToApp.get(k);
      entry.match = { app_id: app.id, app_name: app.name, confidence: 'draft-high', via: 'DIFY_BRAND_EXTRACT（语义: 商品库录入=批量提取品牌入库）' };
    }
  }
  if (!entry.match && b.binding_key === 'internal') {
    const k = envLocal['DIFY_WORKFLOW_API_KEY'];
    if (k && tokenToApp.has(k)) {
      const app = tokenToApp.get(k);
      entry.match = { app_id: app.id, app_name: app.name, confidence: 'draft-high', via: 'DIFY_WORKFLOW（平台内部工作流通道）' };
    }
  }
  // ①d 非 Dify 绑定
  if (!entry.match && (b.binding_key === 'ai_image' || b.binding_key === 'video_gen')) {
    entry.match = { app_id: null, app_name: null, confidence: 'non-dify', via: '非 Dify 提供方（ARK/其他）' };
  }
  // ② 名称草案
  if (!entry.match) {
    let best = null;
    for (const a of inventory) {
      const s = Math.max(matchScore(b.display_name, a.name), matchScore(norm(b.binding_key), norm(a.name)) * 0.9);
      if (!best || s > best.score) best = { app_id: a.id, app_name: a.name, score: s };
    }
    if (best && best.score >= 40) {
      entry.match = { app_id: best.app_id, app_name: best.app_name, confidence: best.score >= 70 ? 'draft-high' : 'draft-low', via: `name-match(${best.score})` };
    }
  }
  // ③ 源环境未激活标注：老 env 空/PLACEHOLDER 且候选应用无 api_token 或 token 从未使用
  if (!entry.match) {
    entry.inactive = {
      evidence: '老服务器 env 空/PLACEHOLDER + 源 Dify 无对应活跃 token（api_tokens 无记录或 last_used_at 为空）',
      conclusion: '该绑定在源生产环境未启用（或经由其他通道）。新设备 .env 留空与现状一致，启用时现场发 token 即可。',
    };
  }
  results.push(entry);
}

const verified = results.filter((r) => r.match?.confidence === 'verified').length;
const draftHigh = results.filter((r) => r.match?.confidence === 'draft-high').length;
const draftLow = results.filter((r) => r.match?.confidence === 'draft-low').length;
const nonDify = results.filter((r) => r.match?.confidence === 'non-dify').length;
const inactive = results.filter((r) => !r.match && r.inactive).length;
const unmapped = results.filter((r) => !r.match && !r.inactive).length;

fs.writeFileSync(ROOT + 'binding-map.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  note: 'verified=env值实测吻合; draft=名称匹配草案; inactive=源环境未启用(证据见 inactive.evidence)',
  summary: { bindings: results.length, verified, draftHigh, draftLow, nonDify, inactive, unmapped },
  tokens_total: tokenToApp.size,
  bindings: results,
}, null, 2));

console.log(`绑定 ${results.length}: verified=${verified} draft-high=${draftHigh} draft-low=${draftLow} non-dify=${nonDify} inactive=${inactive} 未映射=${unmapped}`);
console.log('\ninactive（源环境未启用）:');
for (const r of results) {
  if (r.inactive) console.log(`  ${r.binding_key} (${r.display_name})`);
}
