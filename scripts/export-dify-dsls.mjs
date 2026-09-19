#!/usr/bin/env node
/**
 * Dify DSL 批量导出（Dify 本地化打包 · 第一步）
 *
 * 用法:
 *   DIFY_CONSOLE_EMAIL=xx@yy.com DIFY_CONSOLE_PASSWORD=*** \
 *     node scripts/export-dify-dsls.mjs [--base http://localhost:8088] [--all] [--only 关键词]
 *
 * 流程: console 登录 → 拉应用列表 → 逐应用导出 DSL（include_secret=false）
 *       → dify-bundle/dsls/<序号>-<安全名>.yml + dsl-manifest.json
 *
 * 凭据不落盘；manifest 不含密钥。
 */
const BASE = (() => {
  const i = process.argv.indexOf('--base');
  return i > 0 ? process.argv[i + 1] : 'http://localhost:8088';
})();
const ALL = process.argv.includes('--all');
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx > 0 ? process.argv[onlyIdx + 1] : null;
const EMAIL = process.env.DIFY_CONSOLE_EMAIL;
const PASSWORD = process.env.DIFY_CONSOLE_PASSWORD;
const OUT_DIR = new URL('../dify-bundle/', import.meta.url).pathname;
const DSL_DIR = OUT_DIR + 'dsls/';
import fs from 'node:fs';

if (!EMAIL || !PASSWORD) {
  console.error('需要 DIFY_CONSOLE_EMAIL / DIFY_CONSOLE_PASSWORD 环境变量（console 登录凭据，不落盘）');
  process.exit(64);
}

const log = (...m) => console.log('[export-dsls]', ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts = {}, token) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  });
  return res;
}

// 1. 登录
const loginRes = await api('/console/api/login', {
  method: 'POST',
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, remember_me: true }),
});
if (!loginRes.ok) {
  console.error(`登录失败 HTTP ${loginRes.status}: ${(await loginRes.text()).slice(0, 200)}`);
  process.exit(1);
}
const loginData = await loginRes.json();
const TOKEN = loginData.data?.access_token || loginData.access_token;
if (!TOKEN) { console.error('登录响应无 access_token:', JSON.stringify(loginData).slice(0, 200)); process.exit(1); }
log('登录成功');

// 2. 应用列表
const apps = [];
for (let page = 1; ; page++) {
  const res = await api(`/console/api/apps?page=${page}&limit=100`, {}, TOKEN);
  if (!res.ok) { console.error(`应用列表失败 HTTP ${res.status}`); process.exit(1); }
  const data = await res.json();
  apps.push(...(data.data || []));
  if (!data.has_more || !(data.data || []).length) break;
}
log(`应用总数: ${apps.length}`);

let targets = apps.filter((a) => a.mode !== 'completion' || ALL);
if (ONLY) targets = targets.filter((a) => a.name.includes(ONLY));
log(`导出目标: ${targets.length} 个${ALL ? '（--all 全量）' : ''}`);

// 3. 逐应用导出 DSL
fs.mkdirSync(DSL_DIR, { recursive: true });
const safe = (s) => s.replace(/[\\/:*?"<>|&\s]+/g, '_').slice(0, 60);
const manifest = [];
let ok = 0, fail = 0;
for (let i = 0; i < targets.length; i++) {
  const a = targets[i];
  const file = `${String(i + 1).padStart(2, '0')}-${safe(a.name)}.yml`;
  try {
    const res = await api(`/console/api/apps/${a.id}/export/download?include_secret=false&include_model=true`, { method: 'GET' }, TOKEN);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.includes('app:')) throw new Error('产物不像 DSL（无 app: 头）');
    fs.writeFileSync(DSL_DIR + file, text);
    manifest.push({ app_id: a.id, name: a.name, mode: a.mode, dsl_file: `dsls/${file}`, exported_at: new Date().toISOString() });
    ok++;
    log(`  [${i + 1}/${targets.length}] ✅ ${a.name} → ${file} (${(text.length / 1024).toFixed(0)}KB)`);
  } catch (e) {
    fail++;
    manifest.push({ app_id: a.id, name: a.name, mode: a.mode, error: String(e.message) });
    log(`  [${i + 1}/${targets.length}] ❌ ${a.name}: ${e.message}`);
  }
  await sleep(300); // 温和限速
}

fs.writeFileSync(OUT_DIR + 'dsl-manifest.json', JSON.stringify({ base: BASE, total: targets.length, ok, fail, exported_at: new Date().toISOString(), apps: manifest }, null, 2));
log(`════════════════════════════════`);
log(`完成: 成功 ${ok} / 失败 ${fail} → ${DSL_DIR}`);
log(`manifest: ${OUT_DIR}dsl-manifest.json`);
