#!/usr/bin/env node
/**
 * provision-local-dify.mjs —— 在**本地 Dify** 上「发布草稿应用 + 签发 API Key」，
 * 产出 dify-bundle/local-overrides.json 供 gen-env-from-dify.mjs 使用。
 *
 * 为什么需要它：
 *   binding-map.json 的 10 条 inactive 绑定，在源生产环境本就为空（未启用）。
 *   本地 Dify 里这批应用**不但没签发 token，而且从未发布过**（apps.workflow_id = NULL，
 *   只有 version='draft' 的 workflows 行）→ 即使签了 token，调 /workflows/run 也会
 *   400 app_unavailable。所以「补凭据」= 发布 + 签 token 两件事。
 *
 * 鉴权（Dify 1.14 实测）：
 *   POST /console/api/login  body.password 必须是 **base64(明文)**；
 *   响应体只有 {result:'success'}，token 在 Set-Cookie 里（access_token / refresh_token / csrf_token）。
 *   之后所有 console 请求都要带 Cookie + `X-CSRF-Token`（两者齐全才行；
 *   只带 Authorization: Bearer <access_token> 会被 CSRF 中间件 401）。
 *
 * 用法：
 *   DIFY_EMAIL=r.c@yeah.net DIFY_PASSWORD=xx node scripts/provision-local-dify.mjs            # 只做，不写盘预览
 *   DIFY_EMAIL=... DIFY_PASSWORD=... node scripts/provision-local-dify.mjs --apply            # 落盘 local-overrides.json
 *   DIFY_CONSOLE=http://localhost:8088 可覆盖
 *
 * 幂等：应用已发布则跳过发布；应用已有 api-key 则复用（不重复签发）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUNDLE = path.join(ROOT, 'dify-bundle');

const CONSOLE = (process.env.DIFY_CONSOLE || 'http://localhost:8088').replace(/\/+$/, '');
const EMAIL = process.env.DIFY_EMAIL;
const PASSWORD = process.env.DIFY_PASSWORD;
const APPLY = process.argv.includes('--apply');

if (!EMAIL || !PASSWORD) {
    console.error('缺少 DIFY_EMAIL / DIFY_PASSWORD');
    process.exit(2);
}

/**
 * 本地 Dify 里「源生产为空、但本地有对应应用」的绑定。
 * 判定依据 = 路由传入的 Dify 入参名 与 应用 start 节点变量名逐一对齐（见 note）。
 */
const LOCAL_APPS = [
    {
        binding_key: 'key_account',
        app_name: '大客户档案',
        note: 'start 变量 prompt；mode=workflow',
    },
    {
        binding_key: 'review_partner',
        app_name: '出行搭子运营数据合并（广告-专区-We分析）',
        note: 'start 变量 summary_json/ad_json/zone_json/we_json ← 主流程 3 个 Excel(概述/广告/专区)+素材',
        risk: '⚠️ 路由传的是 index_json，应用要 summary_json，名字对不上（见 reviewPartnerRoutes.js:367）',
    },
    {
        binding_key: 'review_partner.mini_program',
        app_name: '小程序访问情况数据整理',
        note: 'start 变量 uv_pv_json/core_metrics_json/begin_date/end_date 全部命中；路由多传的 click_json 会被忽略',
    },
    {
        binding_key: 'review_partner.order_page',
        app_name: '点餐聚合页数据整理',
        note: 'start 变量 promotion_data_json/begin_date/end_date 全部命中',
    },
    {
        binding_key: 'review_partner.transaction',
        app_name: '交易情况数据整理',
        note: 'start 变量 order_list_json/local_life_json 全部命中',
    },
    {
        binding_key: 'product_library',
        app_name: '选品工作流',
        note: 'start 变量 query/rerank_level/category_str/brand_str/price_mode 等与 productLibraryRoutes.js 逐字一致',
    },
    {
        binding_key: 'invoice_verify',
        app_name: '财务侧-发票上传与校验 内部版本',
        note: 'start 变量 invoice_files/statement_files(file-list) 与 routes/invoiceVerify.js 一致；模型 tongyi/deepseek-v4-flash',
        alt: '另有「大模型版本」用 ollama/qwen3.5:9b-q4_K_M（本地 Ollama，未必在跑），故取内部版本',
    },
];

// ── HTTP 辅助（手工护持 Cookie + CSRF）──────────────────────
let cookieHeader = '';
let csrfToken = '';

const parseSetCookie = (res) => {
    const jar = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    const map = {};
    for (const c of jar) {
        const kv = c.split(';')[0];
        const i = kv.indexOf('=');
        if (i > 0) map[kv.slice(0, i).trim()] = kv.slice(i + 1);
    }
    return map;
};

async function api(method, url, body) {
    const headers = { 'X-CSRF-Token': csrfToken };
    if (cookieHeader) headers.Cookie = cookieHeader;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${CONSOLE}${url}`, {
        method, headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON（如 500 HTML） */ }
    return { status: res.status, json, text };
}

async function login() {
    const res = await fetch(`${CONSOLE}/console/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: EMAIL,
            password: Buffer.from(PASSWORD, 'utf8').toString('base64'),
            language: 'zh-Hans',
            remember_me: true,
        }),
    });
    const cookies = parseSetCookie(res);
    if (!cookies.access_token || !cookies.csrf_token) {
        throw new Error(`登录未拿到 cookie（HTTP ${res.status}）：${(await res.text()).slice(0, 200)}`);
    }
    cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    csrfToken = cookies.csrf_token;
}

// ── 主流程 ────────────────────────────────────────────────
await login();
const me = await api('GET', '/console/api/account/profile');
console.log(`登录成功：${me.json?.email} (${me.json?.name})`);

const list = await api('GET', '/console/api/apps?page=1&limit=100');
if (list.status !== 200) throw new Error(`列应用失败 HTTP ${list.status}: ${list.text.slice(0, 200)}`);
const apps = list.json.data || [];
const byName = new Map();
for (const a of apps) byName.set(a.name, a);
console.log(`本地应用 ${list.json.total} 个\n`);

const results = [];
for (const spec of LOCAL_APPS) {
    const app = byName.get(spec.app_name);
    if (!app) {
        console.log(`❌ ${spec.binding_key.padEnd(28)} 找不到应用「${spec.app_name}」`);
        results.push({ ...spec, error: 'app-not-found' });
        continue;
    }

    // 1) 发布（workflow_id 为空 = 从未发布，签名也是 app_unavailable）
    let published = false;
    if (app.mode === 'workflow' && !app.workflow?.id) {
        const pub = await api('POST', `/console/api/apps/${app.id}/workflows/publish`, {});
        if (pub.status !== 200) {
            console.log(`⚠️ ${spec.binding_key.padEnd(28)} 发布失败 HTTP ${pub.status}: ${pub.text.slice(0, 160)}`);
        } else {
            published = true;
        }
    } else if (app.workflow?.id) {
        published = true; // 早就发过
    }

    // 2) 现有 key 复用，否则签发
    const keysRes = await api('GET', `/console/api/apps/${app.id}/api-keys`);
    let token = (keysRes.json?.data || [])[0]?.token || null;
    let created = false;
    if (!token) {
        const res = await api('POST', `/console/api/apps/${app.id}/api-keys`, {});
        if (res.status !== 201 && res.status !== 200) {
            console.log(`❌ ${spec.binding_key.padEnd(28)} 签发失败 HTTP ${res.status}: ${res.text.slice(0, 160)}`);
            results.push({ ...spec, app_id: app.id, error: 'issue-failed' });
            continue;
        }
        token = res.json.token;
        created = true;
    }

    console.log(`✅ ${spec.binding_key.padEnd(28)} ${app.mode.padEnd(8)} ${published ? '已发布' : '未发布'} · ${created ? '新签发' : '复用已有'} · ${spec.app_name}`);
    if (spec.risk) console.log(`     ${spec.risk}`);
    results.push({ ...spec, app_id: app.id, app_mode: app.mode, token, published });
}

const okRows = results.filter((r) => r.token);
const out = {
    generated_at: new Date().toISOString(),
    dify_console: CONSOLE,
    note: '本地 Dify 补充凭据：源生产为空、但本地有对应应用的绑定。由 scripts/provision-local-dify.mjs 生成。',
    bindings: Object.fromEntries(okRows.map((r) => [r.binding_key, {
        app_id: r.app_id,
        app_name: r.app_name,
        mode: r.app_mode,
        token: r.token,
        note: r.note,
        ...(r.risk ? { risk: r.risk } : {}),
    }])),
};

console.log(`\n成功 ${okRows.length}/${LOCAL_APPS.length} 条`);
if (APPLY) {
    const p = path.join(BUNDLE, 'local-overrides.json');
    fs.writeFileSync(p, JSON.stringify(out, null, 2) + '\n');
    console.log(`已写入 ${path.relative(ROOT, p)}`);
} else {
    console.log('（未写盘；加 --apply 落盘 local-overrides.json）');
}
