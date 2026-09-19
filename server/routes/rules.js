/**
 * rules 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import { logAudit } from '../infra/audit.js';

export function segRules1(app, __ctx) {
app.post('/api/rules/chat-messages', async (req, res) => {
    try {
        logAudit(req, { module: 'RULES_ASSISTANT', action: 'CHAT', details: { query: req.body.query } });
        const response = await fetch(`${__ctx.rulesBaseUrl}/chat-messages`, {
            method: 'POST',
            headers: __ctx.getRulesHeaders(),
            body: JSON.stringify(req.body)
        });
        if (!response.ok) {
            const err = await response.text();
            return res.status(response.status).json({ error: err });
        }
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value, { stream: true }));
        }
        res.end();
    } catch (error) {
        if (!res.headersSent) res.status(500).json({ error: error.message });
    }
});

// 2. 获取会话列表
app.get('/api/rules/conversations', async (req, res) => {
    try {
        const user = req.query.user || 'web_user';
        const limit = req.query.limit || 20;
        const response = await fetch(`${__ctx.rulesBaseUrl}/conversations?user=${user}&limit=${limit}`, {
            headers: { 'Authorization': __ctx.getRulesHeaders().Authorization }
        });
        const data = await response.json();
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. 获取历史消息
app.get('/api/rules/messages', async (req, res) => {
    try {
        const { user = 'web_user', conversation_id } = req.query;
        if (!conversation_id) return res.status(400).json({ error: 'Missing conversation_id' });
        const response = await fetch(`${__ctx.rulesBaseUrl}/messages?user=${user}&conversation_id=${conversation_id}`, {
            headers: { 'Authorization': __ctx.getRulesHeaders().Authorization }
        });
        const data = await response.json();
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. 重命名会话
app.post('/api/rules/conversations/:id/name', async (req, res) => {
    try {
        const { name, user = 'web_user' } = req.body;
        const auto_generate = req.body.auto_generate ?? false;
        const response = await fetch(`${__ctx.rulesBaseUrl}/conversations/${req.params.id}/name`, {
            method: 'POST',
            headers: __ctx.getRulesHeaders(),
            body: JSON.stringify({ name, auto_generate, user })
        });
        const data = await response.json();
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. 删除会话
app.delete('/api/rules/conversations/:id', async (req, res) => {
    try {
        const { user = 'web_user' } = req.body;
        const response = await fetch(`${__ctx.rulesBaseUrl}/conversations/${req.params.id}`, {
            method: 'DELETE',
            headers: __ctx.getRulesHeaders(),
            body: JSON.stringify({ user })
        });
        const data = await response.json();
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
})
}
