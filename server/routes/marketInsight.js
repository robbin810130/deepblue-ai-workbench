/**
 * marketInsight 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import fs from 'fs';
import { logAudit } from '../infra/audit.js';
import * as legacyBridge from '../modules/tasks/legacyBridge.js';

export function segMarketInsight1(app, __ctx) {
app.post('/api/market-insight/run', async (req, res) => {
    try {
        const apiKey = process.env.DIFY_MARKET_INSIGHT_API_KEY;
        const apiUrl = process.env.DIFY_MARKET_INSIGHT_API_URL || 'http://39.108.221.22/v1/chat-messages';
        logAudit(req, { module: 'MARKET_INSIGHT', action: 'RUN_CHATFLOW', details: { query: req.body.query } });

        // ── D4 试点迁移（TASK_CENTER_PILOT 含 market_insight 时启用）──────────
        // 建任务 → 执行 → 通知闭环；响应改为完整 JSON（弃 SSE）。
        // ⚠️ 本仓库暂无该模块新前端消费此路由，启用前需消费方支持 JSON。
        if (legacyBridge.isPilotSkill('market_insight')) {
            try {
                const r = await legacyBridge.runThroughTaskCenter({
                    skillKey: 'market_insight',
                    title: `市场洞察：${String(req.body?.query || '默认分析').slice(0, 24)}`,
                    user: req.user?.id ? req.user : { id: 0, username: 'market_anonymous', role: 'user' },
                    inputs: { message: req.body?.query || '进行市场洞察分析' },
                });
                if (!r.ok) {
                    console.error(`[市场洞察-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                    return res.status(500).json({ success: false, message: `任务执行失败（${r.taskNo}）：${r.message}` });
                }
                return res.json({ success: true, data: legacyBridge.stripThinkTags(legacyBridge.extractAnswer(r.outputs)) });
            } catch (err) {
                console.error('[市场洞察-任务中心] 异常:', err.message);
                return res.status(500).json({ success: false, message: `AI 诊断异常: ${err.message}` });
            }
        }

        if (!apiKey) {
            console.warn('[市场分析引擎] API_KEY 未配置，请在.env中填写');
            return res.status(503).json({ error: '后端 API_KEY 未配置，请联系管理员。' });
        }

        console.log('[市场分析引擎] 转发市场洞察分析请求');

        // Chatflow 必须包含 query，如果前端没传则补齐
        const payload = {
            ...req.body,
            user: req.user?.username || req.body.user || 'web-client-user'
        };
        if (!payload.query) payload.query = "进行市场洞察分析";

        // 审计日志：打印输入的变量结构（脱敏处理 Key 但保留结构）
        console.log('[市场分析引擎] 发送至分析引擎的完整 Payload:', JSON.stringify({
            ...payload,
            inputs: { ...payload.inputs }
        }, null, 2));

        const difyRes = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!difyRes.ok) {
            const errText = await difyRes.text();
            console.error(`[市场分析引擎] 接口错误: ${difyRes.status}`, errText);
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
                if (done) break;
                res.write(decoder.decode(value, { stream: true }));
            }
        } catch (e) {
            console.error('[市场分析引擎] 流式转发中断:', e);
        } finally {
            res.end();
        }
    } catch (error) {
        console.error('[市场分析引擎] 系统错误:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// 市场洞察专用文件上传代理
app.post('/api/market-insight/upload', __ctx.upload.single('file'), async (req, res) => {
    // ... (现有逻辑保持不变)
    try {
        if (!req.file) return res.status(400).json({ error: '未检测到上传文件' });
        logAudit(req, { module: 'MARKET_INSIGHT', action: 'UPLOAD_FILE', target_data: req.file.originalname });

        const apiKey = process.env.DIFY_MARKET_INSIGHT_API_KEY;
        const apiUrl = (process.env.DIFY_MARKET_INSIGHT_API_URL || 'http://39.108.221.22/v1').replace(/\/chat-messages$/, '').replace(/\/$/, '');

        if (!apiKey) {
            return res.status(503).json({ error: 'DIFY_MARKET_INSIGHT_API_KEY 未配置' });
        }

        console.log(`[市场洞察上传] 系统转发图片: ${req.file.originalname}`);

        const { Blob: NodeBlob } = await import('buffer');
        const formData = new FormData();
        // 诊改优化：从磁盘读取暂存文件转发至 Dify
        const fileContent = fs.readFileSync(req.file.path);
        const blob = new NodeBlob([fileContent], { type: req.file.mimetype });
        formData.append('file', blob, req.file.originalname);
        formData.append('user', req.user?.username || req.body.user || 'web-client-user');

        const difyRes = await fetch(`${apiUrl}/files/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: formData
        });

        const data = await difyRes.json();
        if (!difyRes.ok) {
            console.error('[市场洞察上传] 失败:', difyRes.status, data);
            return res.status(difyRes.status).json(data);
        }

        res.json(data);
    } catch (error) {
        console.error('[市场洞察上传] 异常:', error);
        res.status(500).json({ error: error.message });
    }
})
}
