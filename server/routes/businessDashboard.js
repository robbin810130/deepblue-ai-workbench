/**
 * businessDashboard 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import fs from 'fs';
import * as legacyBridge from '../modules/tasks/legacyBridge.js';

export function segBusinessDashboard1(app, __ctx) {
app.post('/api/business-dashboard/upload', __ctx.upload.single('file'), async (req, res) => {
    try {
        const DIFY_API_KEY = process.env.DIFY_BUSINESS_DASHBOARD_API_KEY || process.env.DIFY_WORKFLOW_API_KEY;
        const DIFY_BASE_URL = (process.env.DIFY_BUSINESS_DASHBOARD_BASE_URL || process.env.DIFY_API_BASE_URL || 'http://39.108.221.22/v1').replace(/\/$/, '');

        if (!DIFY_API_KEY) {
            return res.status(503).json({ error: 'DIFY_BUSINESS_DASHBOARD_API_KEY 未配置，请在 .env 中填入业务看板应用的 API Key' });
        }
        if (!req.file) {
            return res.status(400).json({ error: '未收到上传的文件' });
        }

        console.log(`[业务看板代理] 上传文件: ${req.file.originalname} (${req.file.size} bytes)`);

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
            console.error('[业务看板代理] 文件上传失败:', difyRes.status, data);
            return res.status(difyRes.status).json(data);
        }

        console.log(`[业务看板代理] 文件上传成功, File ID: ${data.id}`);
        res.json(data);
    } catch (error) {
        console.error('[业务看板代理] 文件上传错误:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
    }
});

app.post('/api/business-dashboard/chat', async (req, res) => {
    try {
        // ── D4 试点迁移（TASK_CENTER_PILOT 含 business_dashboard 时启用）──────────
        // 旧路径为 Dify 透传代理（SSE/JSON 双形态）；试点返回完整 JSON（前端双模式兼容）。
        // 多轮：前端 conversation_id 随 body 传入，provider 透传 Dify 保持会话语义。
        const bdBody = req.body || {};
        if (legacyBridge.isPilotSkill('business_dashboard')) {
            try {
                const r = await legacyBridge.runThroughTaskCenter({
                    skillKey: 'business_dashboard',
                    title: `业务看板：${String(bdBody.query || '').slice(0, 24)}`,
                    user: req.user?.id ? req.user : { id: 0, username: 'dashboard_anonymous', role: 'user' },
                    inputs: {
                        query: bdBody.query || bdBody.inputs?.query || '请提供业务经营分析建议',
                        conversation_id: bdBody.conversation_id,
                    },
                });
                if (!r.ok) {
                    console.error(`[业务看板-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                    return res.status(500).json({ error: `任务执行失败（${r.taskNo}）：${r.message}` });
                }
                return res.json({
                    success: true,
                    data: { answer: legacyBridge.stripThinkTags(legacyBridge.extractAnswer(r.outputs)) },
                });
            } catch (error) {
                console.error('[业务看板-任务中心] 异常:', error.message);
                return res.status(500).json({ error: error.message });
            }
        }
        const DIFY_API_KEY = process.env.DIFY_BUSINESS_DASHBOARD_API_KEY || process.env.DIFY_WORKFLOW_API_KEY;
        const DIFY_URL = process.env.DIFY_BUSINESS_DASHBOARD_API_URL || 'http://39.108.221.22/v1/chat-messages';

        if (!DIFY_API_KEY) {
            return res.status(503).json({
                error: 'DIFY_BUSINESS_DASHBOARD_API_KEY 未配置',
                message: '请在根目录 .env 文件中添加 DIFY_BUSINESS_DASHBOARD_API_KEY=app-xxxxxx 并填入 Dify 业务看板机器人的有效 API Key。'
            });
        }

        console.log('[业务看板代理] 转发请求至 Dify:', DIFY_URL);

        const bodyData = {
            ...req.body,
            user: req.user?.username || req.body.user || 'web_client_user'
        };

        const difyRes = await fetch(DIFY_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${DIFY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(bodyData)
        });

        if (!difyRes.ok) {
            const errText = await difyRes.text();
            console.error(`[业务看板代理] Dify 返回错误 (${difyRes.status}):`, errText);
            return res.status(difyRes.status).json({
                error: `Dify 接口调用失败 (HTTP ${difyRes.status})`,
                details: errText
            });
        }

        const contentType = difyRes.headers.get('content-type') || '';
        if (contentType.includes('text/event-stream')) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');

            const reader = difyRes.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(decoder.decode(value, { stream: true }));
            }
            res.end();
        } else {
            const data = await difyRes.json();
            res.json(data);
        }
    } catch (error) {
        console.error('[业务看板代理] 转发异常:', error);
        res.status(500).json({ error: error.message });
    }
})
}
