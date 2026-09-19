#!/usr/bin/env node
/**
 * check-bindings.mjs —— 绑定就绪体检 + **真实接口探测**
 *
 * 与 selftest 的区别：
 *   selftest 只回答"配置齐不齐"（读 env 判断），本脚本额外回答"**真的调得通吗**"——
 *   对每条已配置的 dify 绑定发一次 `GET {base}/parameters`，能区分：
 *     ✅ 200        密钥有效 + 应用已发布 + 应用状态正常
 *     ❌ 400 app_unavailable   应用未发布工作流（本地 Dify 里真实存在的情况）
 *     ❌ 401        密钥无效/被吊销
 *     ❌ 404        地址配错
 *   端点形态（chat vs workflow）的对错由 app.mode 静态比对保证，见 gen-env-from-dify.mjs。
 *
 * 用法： node --env-file=.env scripts/check-bindings.mjs [--probe]
 *        （不带 --probe 只做静态体检，不发任何网络请求）
 */
import { checkAllBindings, resolveBinding } from '../server/modules/providers/bindings.js';
import { normalizeBaseUrl } from '../server/modules/providers/difyClient.js';

const PROBE = process.argv.includes('--probe');
const TIMEOUT_MS = 15000;

const r = checkAllBindings();
console.log(`\n绑定体检：共 ${r.total} · 就绪 ${r.ready} · 缺配置 ${r.not_ready} · inactive ${r.disabled}\n`);

const notReady = r.items.filter((i) => !i.ready && i.status !== 'inactive');
if (notReady.length) {
    console.log('❌ 缺配置（active 但 env 不全）：');
    for (const i of notReady) console.log(`   ${i.binding_key.padEnd(32)} missing=${(i.missing || []).join(',')}`);
    console.log('');
}

if (!PROBE) { console.log('（加 --probe 做真实接口探测）\n'); process.exit(0); }

const probe = async (binding_key) => {
    const res = resolveBinding(binding_key);
    if (!res.ok) return { binding_key, ok: false, note: '配置不全' };
    const { base_url, api_key } = res.config;
    const url = `${normalizeBaseUrl(base_url)}/parameters`;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${api_key}` }, signal: ctl.signal });
        const body = await resp.text();
        let code = '';
        try { code = JSON.parse(body)?.code || ''; } catch { /* 非 JSON */ }
        return { binding_key, ok: resp.ok, status: resp.status, code, note: code || (resp.ok ? 'OK' : body.slice(0, 90)) };
    } catch (e) {
        return { binding_key, ok: false, note: e.name === 'AbortError' ? '超时' : e.message };
    } finally { clearTimeout(t); }
};

const difyReady = r.items.filter((i) => i.ready && i.provider === 'dify');
console.log(`真实探测 ${difyReady.length} 条 dify 绑定 ...\n`);
const results = [];
for (const i of difyReady) results.push(await probe(i.binding_key));

const bad = results.filter((x) => !x.ok);
for (const x of results.sort((a, b) => Number(a.ok) - Number(b.ok))) {
    console.log(`  ${x.ok ? '✅' : '❌'} ${x.binding_key.padEnd(32)} ${x.status ?? ''} ${x.code ? `[${x.code}]` : ''} ${x.note}`);
}
console.log(`\n可直连 ${results.length - bad.length}/${results.length}；异常 ${bad.length} 条`);
