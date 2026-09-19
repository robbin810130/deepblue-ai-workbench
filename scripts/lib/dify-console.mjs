/**
 * dify-console.mjs —— 本地 Dify 控制台 API 的最小客户端
 *
 * Dify 1.14 鉴权实测（踩过的坑全在这）：
 *   1. POST /console/api/login 的 body.password 必须是 **base64(明文)**，不是真加密；
 *   2. 响应体只有 {"result":"success"}，**拿不到 access_token** —— token 在 Set-Cookie 里
 *      （access_token / refresh_token / csrf_token 三个）；
 *   3. 后续请求必须 **同时**带 Cookie 和 `X-CSRF-Token`。只带
 *      `Authorization: Bearer <access_token>`（不带 CSRF）会被 401
 *      `{"code":"unauthorized","message":"CSRF token is missing or invalid."}`。
 *
 * 用法：
 *   const api = await connect();              // 用 DIFY_CONSOLE/DIFY_EMAIL/DIFY_PASSWORD
 *   await api.get('/console/api/apps?page=1&limit=100')
 *   await api.post(`/console/api/apps/${id}/workflows/publish`, {})
 */
export async function connect(opts = {}) {
    const CONSOLE = (opts.console || process.env.DIFY_CONSOLE || 'http://localhost:8088').replace(/\/+$/, '');
    const EMAIL = opts.email || process.env.DIFY_EMAIL;
    const PASSWORD = opts.password || process.env.DIFY_PASSWORD;
    if (!EMAIL || !PASSWORD) throw new Error('缺少 DIFY_EMAIL / DIFY_PASSWORD');

    let cookieHeader = '';
    let csrfToken = '';

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
    const jar = {};
    for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
        const kv = c.split(';')[0];
        const i = kv.indexOf('=');
        if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1);
    }
    if (!jar.access_token || !jar.csrf_token) {
        throw new Error(`登录失败（HTTP ${res.status}）：${(await res.text()).slice(0, 200)}`);
    }
    cookieHeader = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    csrfToken = jar.csrf_token;

    async function call(method, url, body) {
        const headers = { Cookie: cookieHeader, 'X-CSRF-Token': csrfToken };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const r = await fetch(`${CONSOLE}${url}`, {
            method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await r.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* HTML 错误页等 */ }
        return { status: r.status, json, text };
    }

    return {
        console: CONSOLE,
        get: (u) => call('GET', u),
        post: (u, b) => call('POST', u, b ?? {}),
        /** 租户可用模型 → 拥有该模型名的供应商集合 */
        async modelOwners() {
            const r = await call('GET', '/console/api/workspaces/current/models/model-types/llm');
            if (r.status !== 200) throw new Error(`取模型清单失败 HTTP ${r.status}`);
            const owners = new Map();
            for (const p of (r.json.data || [])) {
                for (const m of (p.models || [])) {
                    if (!owners.has(m.model)) owners.set(m.model, new Set());
                    owners.get(m.model).add(p.provider);
                }
            }
            return owners;
        },
        async apps() {
            const r = await call('GET', '/console/api/apps?page=1&limit=100');
            if (r.status !== 200) throw new Error(`列应用失败 HTTP ${r.status}`);
            return r.json.data || [];
        },
        async draft(appId) {
            const r = await call('GET', `/console/api/apps/${appId}/workflows/draft`);
            if (r.status !== 200) throw new Error(`取草稿失败 HTTP ${r.status}`);
            return r.json;
        },
        /**
         * 同步草稿。⚠️ 必须回传 GET 拿到的 `hash`：服务端做乐观并发校验
         * （`sync_draft_workflow(..., unique_hash=args.get("hash"))`），
         * 不带或对不上就 409 `draft_workflow_not_sync`。
         * 只送必要字段，避免覆盖 tool_published 等只读项。
         */
        async saveDraft(appId, draft) {
            return call('POST', `/console/api/apps/${appId}/workflows/draft`, {
                graph: draft.graph,
                features: draft.features,
                hash: draft.hash,
                environment_variables: draft.environment_variables,
                conversation_variables: draft.conversation_variables,
            });
        },
        publish: (appId) => call('POST', `/console/api/apps/${appId}/workflows/publish`, {}),
    };
}
