/**
 * aiWorkflow 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import fs from 'fs';

export function segAiWorkflow1(app, __ctx) {
app.post('/api/ai-workflow/upload', __ctx.upload.single('file'), async (req, res) => {
    try {
        const DIFY_API_KEY = process.env.DIFY_WORKFLOW_API_KEY;
        const DIFY_BASE_URL = (process.env.DIFY_WORKFLOW_BASE_URL || 'http://39.108.221.22/v1').replace(/\/$/, '');

        if (!DIFY_API_KEY) {
            return res.status(503).json({ error: 'DIFY_WORKFLOW_API_KEY 未配置' });
        }
        if (!req.file) {
            return res.status(400).json({ error: '未收到文件' });
        }

        console.log(`[AI工作流代理] 上传文件: ${req.file.originalname} (${req.file.size} bytes)`);

        // 构造转发给分析引擎的 multipart 请求
        // 诊改优化：由于使用 diskStorage，从磁盘读取暂存文件内容
        const fileContent = fs.readFileSync(req.file.path);
        const { Blob: NodeBlob } = await import('buffer');
        const formData = new FormData();
        const blob = new NodeBlob([fileContent], { type: req.file.mimetype });
        formData.append('file', blob, req.file.originalname);
        formData.append('user', req.user?.username || req.body.user || 'web-client-user');

        const difyRes = await fetch(`${DIFY_BASE_URL}/files/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${DIFY_API_KEY}` },
            body: formData
        });

        const data = await difyRes.json();
        if (!difyRes.ok) {
            console.error('[AI工作流代理] 文件上传失败:', difyRes.status, data);
            return res.status(difyRes.status).json(data);
        }

        console.log(`[AI工作流代理] 文件上传成功, ID: ${data.id}`);
        res.json(data);
    } catch (error) {
        console.error('[AI工作流代理] 文件上传错误:', error);
        res.status(500).json({ error: error.message });
    }
});

// 代理：工作流执行 → 分析引擎 /workflows/run（流式转发）
app.post('/api/ai-workflow/run', async (req, res) => {
    try {
        const DIFY_API_KEY = process.env.DIFY_WORKFLOW_API_KEY;
        const DIFY_BASE_URL = (process.env.DIFY_WORKFLOW_BASE_URL || 'http://39.108.221.22/v1').replace(/\/$/, '');

        if (!DIFY_API_KEY) {
            return res.status(503).json({ error: 'DIFY_WORKFLOW_API_KEY 未配置' });
        }

        console.log('[AI工作流代理] 转发工作流执行请求');

        const difyRes = await fetch(`${DIFY_BASE_URL}/workflows/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${DIFY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ...req.body, user: req.user?.username || req.body.user || 'web-client-user' })
        });

        if (!difyRes.ok) {
            const errText = await difyRes.text();
            console.error(`[AI工作流代理] 分析引擎错误: ${difyRes.status}`);
            return res.status(difyRes.status).json({ error: `分析引擎接口错误: ${difyRes.status}`, details: errText });
        }

        // 流式转发 SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const reader = difyRes.body.getReader();
        const decoder = new TextDecoder();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) { console.log('[AI工作流代理] 流式响应完成'); break; }
                res.write(decoder.decode(value, { stream: true }));
            }
        } catch (e) {
            console.error('[AI工作流代理] 流式错误:', e);
        } finally {
            res.end();
        }
    } catch (error) {
        console.error('[AI工作流代理] 工作流执行错误:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
})
}
