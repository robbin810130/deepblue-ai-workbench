/**
 * beautyRnd 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import { logAudit } from '../infra/audit.js';
import pool from '../db.js';
import * as legacyBridge from '../modules/tasks/legacyBridge.js';

export function segBeautyRnd1(app, __ctx) {
app.post('/api/beauty-rnd/generate', async (req, res) => {
    try {
// 美妆研发（try 入口即拦截：避免未配置 key 时 503 先于试点分支）
        // ── D4 试点迁移（TASK_CENTER_PILOT 含 beauty_rnd 时启用）──────────
        // 响应对齐旧形状（前端取 resData.data?.answer）。会话历史类子路由（conversations/
        // messages）不属任务形态，保留旧直连。
        const b = req.body || {};
        if (legacyBridge.isPilotSkill('beauty_rnd')) {
            try {
                const r = await legacyBridge.runThroughTaskCenter({
                    skillKey: 'beauty_rnd',
                    title: `美妆研发报告：${String(b.product_type || '').slice(0, 24)}`,
                    user: req.user?.id ? req.user : { id: 0, username: 'beauty_anonymous', role: 'user' },
                    inputs: {
                        query: `Product Type: ${b.product_type}`,
                        product_type: b.product_type, target_market: b.target_market, pain_point: b.pain_point, cert_require: b.cert_require,
                        cost_limit: b.cost_limit, product_form: b.product_form, skin_type: b.skin_type, blacklist: b.blacklist, data_source: b.data_source,
                    },
                });
                if (!r.ok) {
                    console.error(`[美妆研发-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                    return res.status(500).json({ error: `任务执行失败（${r.taskNo}）：${r.message}` });
                }
                return res.json({ success: true, data: { answer: legacyBridge.stripThinkTags(legacyBridge.extractAnswer(r.outputs)) } });
            } catch (err) {
                console.error('[beauty-rnd-任务中心] 异常:', err.message);
                return res.status(500).json({ error: '研发报告生成失败：' + err.message });
            }
        }

        const apiKey = process.env.DIFY_BEAUTY_RND_API_KEY;
        const apiUrl = process.env.DIFY_BEAUTY_RND_API_URL || 'http://39.108.221.22/v1/chat-messages';
        if (!apiKey) {
            return res.status(503).json({ error: '服务端未配置美妆研发大模型的 API Key。' });
        }
        const { product_type, target_market, pain_point, cert_require, cost_limit, product_form, skin_type, blacklist, data_source } = req.body;
        logAudit(req, { module: 'BEAUTY_RND', action: 'GENERATE_REPORT', details: { product_type, target_market } });

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: {
                    product_type,
                    target_market,
                    pain_point,
                    cert_require,
                    cost_limit,
                    product_form,
                    skin_type,
                    blacklist,
                    data_source
                },
                query: `Product Type: ${product_type}`,
                response_mode: 'blocking',
                user: req.user ? req.user.username : 'system'
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`分析引擎接口请求失败: ${errText}`);
        }

        const data = await response.json();
        res.json({ success: true, data });
    } catch (err) {
        console.error('[beauty-rnd] 出错: ' + err.message);
        res.status(500).json({ error: '研发报告生成失败：' + err.message });
    }
});

// 获取会话列表
app.get('/api/beauty-rnd/conversations', async (req, res) => {
    try {
        const apiKey = process.env.DIFY_BEAUTY_RND_API_KEY;
        const apiUrl = (process.env.DIFY_BEAUTY_RND_API_URL || 'http://39.108.221.22/v1/chat-messages').replace(/\/chat-messages$/, '').replace(/\/$/, '');
        if (!apiKey) return res.status(503).json({ error: 'API Key 未配置' });

        const user = req.user?.username || req.query.user || 'system';
        const limit = req.query.limit || 50;

        const response = await fetch(`${apiUrl}/conversations?user=${user}&limit=${limit}`, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 获取会话详情消息
app.get('/api/beauty-rnd/messages', async (req, res) => {
    try {
        const apiKey = process.env.DIFY_BEAUTY_RND_API_KEY;
        const apiUrl = (process.env.DIFY_BEAUTY_RND_API_URL || 'http://39.108.221.22/v1/chat-messages').replace(/\/chat-messages$/, '').replace(/\/$/, '');
        if (!apiKey) return res.status(503).json({ error: 'API Key 未配置' });

        const user = req.user?.username || req.query.user || 'system';
        const conversation_id = req.query.conversation_id;

        if (!conversation_id) return res.status(400).json({ error: '缺少 conversation_id 参数' });

        const response = await fetch(`${apiUrl}/messages?user=${user}&conversation_id=${conversation_id}`, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 删除单个会话
app.delete('/api/beauty-rnd/conversations/:id', async (req, res) => {
    try {
        const apiKey = process.env.DIFY_BEAUTY_RND_API_KEY;
        const apiUrl = (process.env.DIFY_BEAUTY_RND_API_URL || 'http://39.108.221.22/v1/chat-messages').replace(/\/chat-messages$/, '').replace(/\/$/, '');
        if (!apiKey) return res.status(503).json({ error: 'API Key 未配置' });

        const user = req.user?.username || req.body.user || 'system';
        const response = await fetch(`${apiUrl}/conversations/${req.params.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ user })
        });
        
        let data = {};
        try {
            data = await response.json();
        } catch (e) {
            // Dify might return 204 No Content or empty string
            data = { result: 'success' };
        }
        
        res.json(data);
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// 清空所有会话 (后端迭代删除)
app.delete('/api/beauty-rnd/conversations', async (req, res) => {
    try {
        const apiKey = process.env.DIFY_BEAUTY_RND_API_KEY;
        const apiUrl = (process.env.DIFY_BEAUTY_RND_API_URL || 'http://39.108.221.22/v1/chat-messages').replace(/\/chat-messages$/, '').replace(/\/$/, '');
        if (!apiKey) return res.status(503).json({ error: 'API Key 未配置' });

        const user = req.user?.username || 'system';

        // 1. 获取列表
        const listRes = await fetch(`${apiUrl}/conversations?user=${user}&limit=100`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        const listData = await listRes.json();

        if (listData.data && listData.data.length > 0) {
            // 2. 迭代删除
            const deletePromises = listData.data.map(conv =>
                fetch(`${apiUrl}/conversations/${conv.id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user })
                })
            );
            await Promise.all(deletePromises);
        }

        res.json({ success: true, message: 'All history cleared' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 获取自定义配方版本
app.get('/api/beauty-rnd/versions', async (req, res) => {
    try {
        const { conversation_id } = req.query;
        if (!conversation_id) return res.status(400).json({ error: '缺少 conversation_id' });
        const result = await pool.query(
            'SELECT version_id as "versionId", version_name as "versionName", timestamp, ingredients FROM sys_beauty_rnd_versions WHERE conversation_id = $1 ORDER BY id ASC',
            [conversation_id]
        );
        res.json({ success: true, versions: result.rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 保存自定义配方版本
app.post('/api/beauty-rnd/versions', async (req, res) => {
    try {
        const { conversation_id, version_id, version_name, timestamp, ingredients } = req.body;
        if (!conversation_id || !version_id || !ingredients) return res.status(400).json({ error: '缺少必要参数' });
        await pool.query(
            `INSERT INTO sys_beauty_rnd_versions (conversation_id, version_id, version_name, timestamp, ingredients) 
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (conversation_id, version_id) 
             DO UPDATE SET version_name = EXCLUDED.version_name, timestamp = EXCLUDED.timestamp, ingredients = EXCLUDED.ingredients`,
            [conversation_id, version_id, version_name, timestamp, JSON.stringify(ingredients)]
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
})
}
