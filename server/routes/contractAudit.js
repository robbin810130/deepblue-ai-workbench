/**
 * contractAudit 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import fs from 'fs';
import { logAudit } from '../infra/audit.js';
import * as legacyBridge from '../modules/tasks/legacyBridge.js';
import { loadStagedBuffers } from '../modules/files/fileStore.js';

export function segContractAudit1(app, __ctx) {
app.post('/api/contract-audit/run', async (req, res) => {
    try {
        const apiKey = process.env.DIFY_CONTRACT_AUDIT_API_KEY;
        const apiUrl = process.env.DIFY_CONTRACT_AUDIT_API_URL || 'http://39.108.221.22/v1/chat-messages';
        logAudit(req, { module: 'CONTRACT_AUDIT', action: 'RUN_AUDIT' });

        // ── D4 试点迁移（TASK_CENTER_PILOT 含 contract_review 时启用）──────────
        // 建任务 → 执行 → 通知闭环；响应改为完整 JSON（前端按 content-type 双模式兼容）。
        if (legacyBridge.isPilotSkill('contract_review')) {
            try {
                const body = req.body || {};
                const fileIds = Array.isArray(body.file_ids) ? body.file_ids.map(String) : [];
                const r = await legacyBridge.runThroughTaskCenter({
                    skillKey: 'contract_review',
                    title: `合同审核：${String(body.query || '').slice(0, 24)}`,
                    user: req.user?.id ? req.user : { id: 0, username: 'contract_anonymous', role: 'user' },
                    inputs: { message: body.query || '请审核这份合同' },
                    files: fileIds,
                });
                if (!r.ok) {
                    console.error(`[合同审核-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                    return res.status(500).json({ success: false, message: `任务执行失败（${r.taskNo}）：${r.message}` });
                }
                const text = String(
                    r.outputs?._extra?.answer ?? r.outputs?.answer
                    ?? legacyBridge.extractAnswerText(r.outputs ?? {}) ?? '',
                );
                return res.json({ success: true, data: text });
            } catch (err) {
                console.error('[合同审核-任务中心] 异常:', err.message);
                if (!res.headersSent) return res.status(500).json({ success: false, message: `AI 诊断异常: ${err.message}` });
                return;
            }
        }

        if (!apiKey) {
            return res.status(503).json({ error: '后端 DIFY_CONTRACT_AUDIT_API_KEY 未配置，请联系管理员。' });
        }

        console.log('[合同审核引擎] 转发合同审核分析请求');

        // 旧直连路径：前端已改传平台暂存 file_ids —— 这里水合后转传 Dify（行为对齐旧协议）
        let payload = {
            ...req.body,
            user: req.user?.username || req.body.user || 'web-client-user'
        };
        if (Array.isArray(req.body?.file_ids) && req.body.file_ids.length > 0) {
            const baseUpload = String(apiUrl).replace(/\/chat-messages.*$/, '/files/upload');
            const bufs = await loadStagedBuffers(req.body.file_ids.map(String));
            const difyFiles = [];
            for (const f of bufs) {
                const fd = new FormData();
                fd.append('file', new Blob([f.buffer], { type: f.mimeType }), f.name);
                fd.append('user', payload.user);
                const upRes = await fetch(baseUpload, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${apiKey}` },
                    body: fd,
                });
                if (!upRes.ok) {
                    const errText = await upRes.text().catch(() => `HTTP ${upRes.status}`);
                    throw new Error(`Dify 文件上传失败 (${upRes.status}): ${errText.slice(0, 200)}`);
                }
                const upData = await upRes.json();
                difyFiles.push({
                    type: String(f.mimeType || '').startsWith('image/') ? 'image' : 'document',
                    transfer_method: 'local_file',
                    upload_file_id: upData.id,
                });
            }
            delete payload.file_ids;
            payload.files = difyFiles;
        }

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
            console.error(`[合同审核引擎] 接口错误: ${difyRes.status}`, errText);
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
            console.error('[合同审核引擎] 流式转发中断:', e);
        } finally {
            res.end();
        }
    } catch (error) {
        console.error('[合同审核引擎] 系统错误:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// 2. 合同文件上传代理
app.post('/api/contract-audit/upload', __ctx.upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: '未检测到上传文件' });
        logAudit(req, { module: 'CONTRACT_AUDIT', action: 'UPLOAD_FILE', target_data: req.file.originalname });

        const apiKey = process.env.DIFY_CONTRACT_AUDIT_API_KEY;
        const apiUrl = (process.env.DIFY_CONTRACT_AUDIT_API_URL || 'http://39.108.221.22/v1').replace(/\/chat-messages$/, '').replace(/\/$/, '');

        if (!apiKey) {
            return res.status(503).json({ error: 'DIFY_CONTRACT_AUDIT_API_KEY 未配置' });
        }

        console.log(`[合同审核上传] 系统转发文件: ${req.file.originalname}`);

        const { Blob: NodeBlob } = await import('buffer');
        const formData = new FormData();
        // 诊改优化：从磁盘读取暂存文件内容转发至 Dify
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
            console.error('[合同审核上传] 失败:', difyRes.status, data);
            return res.status(difyRes.status).json(data);
        }

        res.json(data);
    } catch (error) {
        console.error('[合同审核上传] 异常:', error);
        res.status(500).json({ error: error.message });
    }
})
}
