/**
 * digitalEmployee 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import { logger } from '../infra/logger.js';
import { authenticateToken } from '../infra/auth.js';

export function segDigitalEmployee1(app, __ctx) {
app.get('/api/digital-employee/parameters', authenticateToken, async (req, res) => {
    const apiKey = process.env.DIFY_DIGITAL_EMPLOYEE_API_KEY;
    const apiUrl = process.env.DIFY_DIGITAL_EMPLOYEE_API_URL;
    if (!apiKey || apiKey === 'app-xxxx') return res.status(500).json({ error: '配置缺失' });
    try {
        const paramUrl = apiUrl.replace('/chat-messages', '') + '/parameters';
        const response = await fetch(paramUrl, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        const data = await response.json();
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/digital-employee/chat', authenticateToken, async (req, res) => {
    const { query, inputs = {}, response_mode = 'streaming' } = req.body;
    const apiKey = process.env.DIFY_DIGITAL_EMPLOYEE_API_KEY;
    const apiUrl = process.env.DIFY_DIGITAL_EMPLOYEE_API_URL;

    if (!apiKey || apiKey === 'app-xxxx') {
        return res.status(500).json({ error: '系统未配置数字员工 Dify API Key，请联系管理员。' });
    }

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: inputs,
                query: query,
                response_mode: response_mode,
                user: req.user?.username || 'system-user'
            })
        });

        if (!response.ok) {
            const data = await response.text();
            throw new Error(`Dify请求失败: ${response.status} ${data}`);
        }

        if (response_mode === 'streaming') {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);
            }
            res.end();
        } else {
            const data = await response.json();
            res.json(data);
        }
    } catch (e) {
        logger.error('[Digital Employee Request Error] ' + e.message);
        if (!res.headersSent) {
            res.status(500).json({ error: e.message });
        } else {
            res.end();
        }
    }
})
}
