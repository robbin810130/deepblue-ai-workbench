/**
 * quoteVerify 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import fs from 'fs';
import { authenticateToken } from '../infra/auth.js';
import { logAudit } from '../infra/audit.js';
import * as legacyBridge from '../modules/tasks/legacyBridge.js';

export function segQuoteVerify1(app, __ctx) {
app.post('/api/quote-verify/run', authenticateToken, async (req, res) => {
    try {
        const { supplierName } = req.body;
        if (!supplierName || !supplierName.trim()) {
            return res.status(400).json({ success: false, message: '请输入供应商名称' });
        }
        logAudit(req, { module: 'QUOTE_VERIFY', action: 'RUN_VERIFY', details: { supplierName } });

        // ── D4 试点迁移（TASK_CENTER_PILOT 含 quote_verify 时启用）──────────
        // 建任务 → 执行 → 通知闭环 → 归一化输出映射回旧响应形状；未启用走旧直连。
        if (legacyBridge.isPilotSkill('quote_verify')) {
            const r = await legacyBridge.runThroughTaskCenter({
                skillKey: 'quote_verify',
                title: `核查报价：${supplierName.trim()}`,
                user: req.user,
                inputs: { supplier_name: supplierName.trim() },
            });
            if (!r.ok) {
                console.error(`[核查报价A-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                return res.status(500).json({ success: false, message: `任务执行失败（${r.taskNo}）：${r.message}` });
            }
            const text = legacyBridge.stripThinkTags(legacyBridge.extractAnswerText(r.outputs ?? {}));
            return res.json({ success: true, data: text || '未获取到有效结果' });
        }

        const apiKey = process.env.DIFY_QUOTE_VERIFY_API_KEY;
        const apiUrl = process.env.DIFY_QUOTE_VERIFY_API_URL;
        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_QUOTE_VERIFY_API_KEY 或 DIFY_QUOTE_VERIFY_API_URL' });
        }

        const payload = {
            inputs: { supplier_name: supplierName.trim() },
            response_mode: 'blocking',
            user: req.user?.username || 'web_os_user'
        };

        const difyRes = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const chunks = [];
        if (difyRes.body) {
            for await (const chunk of difyRes.body) {
                chunks.push(Buffer.from(chunk));
            }
        }
        const resText = Buffer.concat(chunks).toString('utf-8');

        if (!difyRes.ok) {
            console.error(`[Dify 核查报价工作流A报错] 状态码: ${difyRes.status}, 响应: ${resText.substring(0, 500)}`);
            throw new Error(`Dify 工作流调用报错 (${difyRes.status}): ${resText.substring(0, 300)}`);
        }

        console.log(`[核查报价A] Dify 响应长度: ${resText.length} 字符`);

        try {
            const bodyData = JSON.parse(resText);
            let resultText = '';
            const rawOutputs = bodyData?.data?.outputs || bodyData?.data || bodyData;

            if (rawOutputs && typeof rawOutputs === 'object') {
                if (rawOutputs.text !== undefined) {
                    resultText = typeof rawOutputs.text === 'object' ? JSON.stringify(rawOutputs.text, null, 2) : String(rawOutputs.text);
                } else if (rawOutputs.result !== undefined) {
                    resultText = typeof rawOutputs.result === 'object' ? JSON.stringify(rawOutputs.result, null, 2) : String(rawOutputs.result);
                } else if (rawOutputs.output !== undefined) {
                    resultText = typeof rawOutputs.output === 'object' ? JSON.stringify(rawOutputs.output, null, 2) : String(rawOutputs.output);
                } else {
                    const firstKeyVal = Object.values(rawOutputs)[0];
                    resultText = typeof firstKeyVal === 'object' ? JSON.stringify(firstKeyVal, null, 2) : String(firstKeyVal);
                }
            }

            // 过滤 标签
            if (typeof resultText === 'string') {
                resultText = resultText.replace(/<think>[\s\S]*?<\/think>(\\n|\s)*/gi, '').trim();
                resultText = resultText.replace(/\\n/g, '\n');
            }

            res.json({ success: true, data: resultText || '未获取到有效结果' });
        } catch (parseErr) {
            console.error('[核查报价A JSON解析失败]', parseErr.message);
            throw new Error(`无法解析 Dify 响应: ${parseErr.message}`);
        }
    } catch (e) {
        console.error('[核查报价A请求失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 2. 核查报价 - 文件上传核查（工作流B）
app.post('/api/quote-verify/upload', authenticateToken, __ctx.upload.single('file'), async (req, res) => {
    try {

        // ── D4 试点迁移（TASK_CENTER_PILOT 含 quote_verify 时启用，scope=file）────────
        // 前端以 multipart 文本字段传平台暂存 file_ids（无需再传 file）；文件链路由
        // Provider 依绑定 file_input_var=quote_file 映射进工作流B输入。
        if (legacyBridge.isPilotSkill('quote_verify') && Array.isArray(req.body?.file_ids)) {
            try {
                const r = await legacyBridge.runThroughTaskCenter({
                    skillKey: 'quote_verify',
                    title: '核查报价（文件解析）',
                    user: req.user,
                    inputs: { query: '请解析报价单并执行核查' },
                    bindingScope: 'file',
                    files: req.body.file_ids.map(String),
                });
                if (!r.ok) {
                    console.error(`[核查报价B-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                    return res.status(500).json({ success: false, message: `任务执行失败（${r.taskNo}）：${r.message}` });
                }
                return res.json({ success: true, data: legacyBridge.stripThinkTags(legacyBridge.extractAnswer(r.outputs)) || '文件处理完成，未返回详细信息' });
            } catch (e) {
                console.error('[核查报价B-任务中心] 异常:', e.message);
                return res.status(500).json({ success: false, message: e.message });
            }
        }
        if (!req.file) {
            return res.status(400).json({ success: false, message: '未找到文件数据' });
        }
        logAudit(req, { module: 'QUOTE_VERIFY', action: 'UPLOAD_FILE', target_data: req.file.originalname });

        const apiKey = process.env.DIFY_QUOTE_VERIFY_FILE_API_KEY;
        let apiUrl = process.env.DIFY_QUOTE_VERIFY_FILE_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }
        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_QUOTE_VERIFY_FILE_API_KEY' });
        }

        // 1. 上传文件到 Dify
        const formData = new FormData();
        const fileContent = fs.readFileSync(req.file.path);
        const { Blob: NodeBlob } = await import('buffer');
        const blob = new NodeBlob([fileContent], { type: req.file.mimetype });
        formData.append('file', blob, req.file.originalname);
        formData.append('user', req.user?.username || 'web_os_user');

        const difyUploadRes = await fetch(`${apiUrl}/files/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: formData
        });

        const uploadResText = await difyUploadRes.text();
        if (!difyUploadRes.ok) {
            console.error(`[Dify 核查报价文件上传失败] 状态码: ${difyUploadRes.status}, 响应: ${uploadResText}`);
            throw new Error(`Dify 文件上传失败 (${difyUploadRes.status}): ${uploadResText.substring(0, 200)}`);
        }

        const uploadData = JSON.parse(uploadResText);
        const fileId = uploadData.id;

        // 2. 调用工作流B
        const payload = {
            inputs: {
                quote_file: [{
                    type: 'document',
                    transfer_method: 'local_file',
                    upload_file_id: fileId
                }]
            },
            response_mode: 'blocking',
            user: req.user?.username || 'web_os_user'
        };

        const difyRes = await fetch(`${apiUrl}/workflows/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const chunks = [];
        if (difyRes.body) {
            for await (const chunk of difyRes.body) {
                chunks.push(Buffer.from(chunk));
            }
        }
        const resText = Buffer.concat(chunks).toString('utf-8');

        if (!difyRes.ok) {
            console.error(`[Dify 核查报价工作流B报错] 状态码: ${difyRes.status}, 响应: ${resText.substring(0, 500)}`);
            throw new Error(`Dify 工作流调用报错 (${difyRes.status}): ${resText.substring(0, 300)}`);
        }

        console.log(`[核查报价B] Dify 响应长度: ${resText.length} 字符`);

        try {
            const bodyData = JSON.parse(resText);
            let resultText = '';
            const rawOutputs = bodyData?.data?.outputs || bodyData?.data || bodyData;

            if (rawOutputs && typeof rawOutputs === 'object') {
                if (rawOutputs.text !== undefined) {
                    resultText = typeof rawOutputs.text === 'object' ? JSON.stringify(rawOutputs.text, null, 2) : String(rawOutputs.text);
                } else if (rawOutputs.result !== undefined) {
                    resultText = typeof rawOutputs.result === 'object' ? JSON.stringify(rawOutputs.result, null, 2) : String(rawOutputs.result);
                } else if (rawOutputs.output !== undefined) {
                    resultText = typeof rawOutputs.output === 'object' ? JSON.stringify(rawOutputs.output, null, 2) : String(rawOutputs.output);
                } else {
                    const firstKeyVal = Object.values(rawOutputs)[0];
                    resultText = typeof firstKeyVal === 'object' ? JSON.stringify(firstKeyVal, null, 2) : String(firstKeyVal);
                }
            }

            if (typeof resultText === 'string') {
                resultText = resultText.replace(/<think>[\s\S]*?<\/think>(\\n|\s)*/gi, '').trim();
                resultText = resultText.replace(/\\n/g, '\n');
            }

            res.json({ success: true, data: resultText || '文件处理完成，未返回详细信息' });
        } catch (parseErr) {
            console.error('[核查报价B JSON解析失败]', parseErr.message);
            throw new Error(`无法解析 Dify 响应: ${parseErr.message}`);
        }
    } catch (e) {
        console.error('[核查报价B请求失败]', e);
        res.status(500).json({ success: false, message: e.message });
    } finally {
        if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch (_) { /* 忽略 */ } }
    }
})
}
