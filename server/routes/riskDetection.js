/**
 * riskDetection 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import fs from 'fs';
import { authenticateToken } from '../infra/auth.js';
import { logAudit } from '../infra/audit.js';
import * as legacyBridge from '../modules/tasks/legacyBridge.js';

export function segRiskDetection1(app, __ctx) {
app.post('/api/risk-detection/ecommerce/upload', authenticateToken, __ctx.upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '未找到文件数据' });
        }
        logAudit(req, { module: 'RISK_DETECTION', action: 'ECOM_UPLOAD_FILE', target_data: __ctx.fixUploadedFileName(req.file.originalname) });

        const apiKey = process.env.DIFY_ECOM_RISK_API_KEY;
        let apiUrl = process.env.DIFY_ECOM_RISK_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '系统未配置 DIFY_ECOM_RISK_API_KEY' });
        }

        const formData = new FormData();
        const fileContent = fs.readFileSync(req.file.path);
        const { Blob: NodeBlob } = await import('buffer');
        const blob = new NodeBlob([fileContent], { type: req.file.mimetype });
        formData.append('file', blob, req.file.originalname);
        formData.append('user', req.user?.username || 'web_os_user');

        const difyRes = await fetch(`${apiUrl}/files/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: formData
        });

        const resText = await difyRes.text();
        if (!difyRes.ok) throw new Error(`Dify 文件上传报错 (${difyRes.status}): ${resText.substring(0, 200)}`);

        const data = JSON.parse(resText);
        res.json({ success: true, file_id: data.id });
    } catch (e) {
        console.error('[电商风控图片上传失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/risk-detection/ecommerce/run', authenticateToken, async (req, res) => {
    try {
        const { country, industry, detectionType, title, description, fileId } = req.body;
        logAudit(req, { module: 'RISK_DETECTION', action: 'RUN_ECOM_RISK', details: { country, industry, detectionType, titleLength: title?.length, hasFile: !!fileId } });

        // ── D4 试点迁移（TASK_CENTER_PILOT 含 risk_detection 时启用）──────────
        // 文本模式直接接；图片模式需新前端传平台暂存 file_ids（旧 fileId=Dify id 走旧路径）。
        // 注：研发线（rnd）绑定需 scope→binding 路由支持，本批仅接电商线。
        if (legacyBridge.isPilotSkill('risk_detection')
            && (detectionType !== 'image' || Array.isArray(req.body?.file_ids))) {
            try {
                const q = title ? `检测标题：${title}\n描述：${description || ''}` : (description || '请开始执行合规风险检测任务。');
                const inputs = { query: q, country: country || '', industry: industry || '' };
                if (detectionType === 'text') { inputs.title = title || ''; inputs.description = description || ''; }
                const r = await legacyBridge.runThroughTaskCenter({
                    skillKey: 'risk_detection',
                    title: `电商风险检测：${String(title || description || '图片检测').slice(0, 24)}`,
                    user: req.user?.id ? req.user : { id: 0, username: 'risk_anonymous', role: 'user' },
                    inputs,
                    files: detectionType === 'image' ? req.body.file_ids.map(String) : [],
                });
                if (!r.ok) {
                    console.error(`[电商风控-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                    return res.status(500).json({ success: false, message: `任务执行失败（${r.taskNo}）：${r.message}` });
                }
                return res.json({ success: true, data: legacyBridge.stripThinkTags(legacyBridge.extractAnswer(r.outputs)) });
            } catch (e) {
                console.error('[电商风控-任务中心] 异常:', e.message);
                return res.status(500).json({ success: false, message: e.message });
            }
        }

        const apiKey = process.env.DIFY_ECOM_RISK_API_KEY;
        let apiUrl = process.env.DIFY_ECOM_RISK_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;

        if (!apiKey || !apiUrl) return res.status(500).json({ success: false, message: '系统未配置电商风险检测 API' });

        const inputs = {
            country: country || '',
            industry: industry || '',
        };

        if (detectionType === 'text') {
            inputs.title = title || '';
            inputs.description = description || '';
        }

        const payload = {
            inputs,
            response_mode: 'blocking',
            user: req.user?.username || 'web_os_user'
        };

        if (detectionType === 'image' && fileId) {
            payload.files = [{
                type: 'image',
                transfer_method: 'local_file',
                upload_file_id: fileId
            }];
        }

        let endpoint = `${apiUrl}/chat-messages`;
        payload.query = inputs.title ? `检测标题：${inputs.title}\n描述：${inputs.description}` : (inputs.description || '请开始执行合规风险检测任务。');

        const difyRes = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const resText = await difyRes.text();

        if (!difyRes.ok) throw new Error(`电商风控大模型调用失败 (${difyRes.status}): ${resText.substring(0, 200)}`);

        const bodyData = JSON.parse(resText);
        let rawReport = '';

        // 兼容 chat 和 completion 模式的返回
        if (bodyData.answer) {
            rawReport = bodyData.answer;
        } else {
            // 兼容 workflows 模式的返回
            const outputs = bodyData?.data?.outputs || bodyData?.data || bodyData;
            if (outputs && typeof outputs === 'object' && Object.keys(outputs).length > 0) {
                rawReport = outputs.text || outputs.result || outputs.output || Object.values(outputs)[0] || '';
                rawReport = typeof rawReport === 'object' ? JSON.stringify(rawReport) : String(rawReport);
            } else {
                rawReport = JSON.stringify(bodyData);
            }
        }

        res.json({ success: true, data: rawReport });
    } catch (e) {
        console.error('[电商风控请求失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ====================== 研发配方法规检测整合 ======================

app.post('/api/risk-detection/rnd/upload', authenticateToken, __ctx.upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '未找到文件数据' });
        }
        logAudit(req, { module: 'RISK_DETECTION', action: 'RND_UPLOAD_FILE', target_data: __ctx.fixUploadedFileName(req.file.originalname) });

        const apiKey = process.env.DIFY_RND_RISK_API_KEY;
        let apiUrl = process.env.DIFY_RND_RISK_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '系统未配置 DIFY_RND_RISK_API_KEY' });
        }

        const formData = new FormData();
        const fileContent = fs.readFileSync(req.file.path);
        const { Blob: NodeBlob } = await import('buffer');
        const blob = new NodeBlob([fileContent], { type: req.file.mimetype });
        formData.append('file', blob, req.file.originalname);
        formData.append('user', req.user?.username || 'web_os_user');

        const difyRes = await fetch(`${apiUrl}/files/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: formData
        });

        const resText = await difyRes.text();
        if (!difyRes.ok) throw new Error(`Dify 文件上传报错 (${difyRes.status}): ${resText.substring(0, 200)}`);

        const data = JSON.parse(resText);
        res.json({ success: true, file_id: data.id });
    } catch (e) {
        console.error('[研发配方附件上传失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/risk-detection/rnd/run', authenticateToken, async (req, res) => {
    try {
        const { country, industry, detectionType, ingredient_text, fileId } = req.body;
        logAudit(req, { module: 'RISK_DETECTION', action: 'RUN_RND_RISK', details: { country, industry, detectionType, hasText: !!ingredient_text, hasFile: !!fileId } });

        // ── D4 试点迁移（TASK_CENTER_PILOT 含 risk_detection 时启用，scope=rnd）──────
        // 文本模式直连；图片模式需新前端传平台暂存 file_ids（旧 fileId=Dify id 走旧路径）。
        if (legacyBridge.isPilotSkill('risk_detection')
            && (detectionType !== 'image' || Array.isArray(req.body?.file_ids))) {
            try {
                const q = ingredient_text || '请开始执行研发配方法规检测任务。';
                const r = await legacyBridge.runThroughTaskCenter({
                    skillKey: 'risk_detection',
                    title: `研发风控检测：${String(country || industry || '配方检测').slice(0, 24)}`,
                    user: req.user,
                    inputs: { query: q, country: country || '', industry: industry || '', scene: 'rnd' },
                    bindingScope: 'rnd',
                    files: detectionType === 'image' ? req.body.file_ids.map(String) : [],
                });
                if (!r.ok) {
                    console.error(`[研发风控-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                    return res.status(500).json({ success: false, message: `任务执行失败（${r.taskNo}）：${r.message}` });
                }
                return res.json({ success: true, data: legacyBridge.stripThinkTags(legacyBridge.extractAnswer(r.outputs)) });
            } catch (e) {
                console.error('[研发风控-任务中心] 异常:', e.message);
                return res.status(500).json({ success: false, message: e.message });
            }
        }

        const apiKey = process.env.DIFY_RND_RISK_API_KEY;
        let apiUrl = process.env.DIFY_RND_RISK_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;

        if (!apiKey || !apiUrl) return res.status(500).json({ success: false, message: '系统未配置研发风险检测 API' });

        const inputs = {
            country: country || '',
            industry: industry || '',
        };

        if (detectionType === 'text') {
            inputs.ingredient_text = ingredient_text || '';
        }

        const payload = {
            inputs,
            response_mode: 'blocking',
            user: req.user?.username || 'web_os_user'
        };

        if ((detectionType === 'image' || detectionType === 'document') && fileId) {
            payload.files = [{
                type: detectionType === 'image' ? 'image' : 'document',
                transfer_method: 'local_file',
                upload_file_id: fileId
            }];
        }

        let endpoint = `${apiUrl}/chat-messages`;
        payload.query = inputs.ingredient_text ? `检测配方：\n${inputs.ingredient_text}` : '请开始执行配方合规风险检测任务。';

        const difyRes = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const resText = await difyRes.text();

        if (!difyRes.ok) throw new Error(`研发配方风控大模型调用失败 (${difyRes.status}): ${resText.substring(0, 200)}`);

        const bodyData = JSON.parse(resText);
        let rawReport = '';

        if (bodyData.answer) {
            rawReport = bodyData.answer;
        } else {
            const outputs = bodyData?.data?.outputs || bodyData?.data || bodyData;
            if (outputs && typeof outputs === 'object' && Object.keys(outputs).length > 0) {
                rawReport = outputs.text || outputs.result || outputs.output || Object.values(outputs)[0] || '';
                rawReport = typeof rawReport === 'object' ? JSON.stringify(rawReport) : String(rawReport);
            } else {
                rawReport = JSON.stringify(bodyData);
            }
        }

        res.json({ success: true, data: rawReport });
    } catch (e) {
        console.error('[研发风控请求失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
})
}
