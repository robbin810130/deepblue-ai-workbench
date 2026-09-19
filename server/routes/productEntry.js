/**
 * productEntry 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import fs from 'fs';
import { authenticateToken } from '../infra/auth.js';
import * as legacyBridge from '../modules/tasks/legacyBridge.js'; // XO 专项B：外部执行型跟踪
import { logAudit } from '../infra/audit.js';
import pool from '../db.js';

// ── XO 专项B：外部执行型跟踪（任务中心观测面；Dify 交互保持原样）──────
// fileId → { taskId, taskNo }；trackedByRun: workflowRunId → fileId（补全阶段反查）
const tracked = new Map();
const trackedByRun = new Map();
const trackOn = () => legacyBridge.isPilotSkill('product_entry');
/** 跟踪任务收口（幂等：仅 running 可迁移） */
async function trackFinish(key, fn) {
    if (!trackOn()) return;
    const t = tracked.get(key);
    if (!t) return;
    await fn(t.taskId);
    tracked.delete(key);
}
const trackFail = (key, code, message) => trackFinish(key, (id) => legacyBridge.failTrackedSession(id, { code, message }));
const trackDone = (key, result, summary) => trackFinish(key, (id) => legacyBridge.completeTrackedSession(id, { result, summary }));

export function segProductEntry1(app, __ctx) {
app.post('/api/product-entry/upload', authenticateToken, __ctx.upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '未找到文件数据' });
        }
        logAudit(req, { module: 'PRODUCT_ENTRY', action: 'UPLOAD_FILE', target_data: __ctx.fixUploadedFileName(req.file.originalname) });

        const apiKey = process.env.DIFY_PRODUCT_ENTRY_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_ENTRY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_PRODUCT_ENTRY_API_KEY' });
        }

        const formData = new FormData();
        const fileContent = fs.readFileSync(req.file.path);
        const { Blob: NodeBlob } = await import('buffer');
        const blob = new NodeBlob([fileContent], { type: req.file.mimetype });
        formData.append('file', blob, req.file.originalname);
        formData.append('user', req.user?.username || 'web_os_user');

        const difyRes = await fetch(`${apiUrl}/files/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });

        const resText = await difyRes.text();
        if (!difyRes.ok) {
            console.error(`[Dify 商品库录入上传失败] 状态码: ${difyRes.status}, 响应: ${resText}`);
            throw new Error(`Dify 文件上传失败 (${difyRes.status}): ${resText.substring(0, 200)}`);
        }

        try {
            const data = JSON.parse(resText);
            // ── XO 专项B：流程起点建跟踪任务 ──
            if (trackOn()) {
                const t = await legacyBridge.startTrackedSession({
                    skillKey: 'product_entry',
                    title: `商品库录入·${__ctx.fixUploadedFileName(req.file.originalname)}`,
                    user: req.user,
                    inputs: { file_name: req.file.originalname, dify_file_id: data.id },
                });
                if (t) tracked.set(data.id, t);
            }
            res.json({ success: true, file_id: data.id, task_no: tracked.get(data.id)?.taskNo || null });
        } catch (parseError) {
            throw new Error(`无法解析 Dify 响应为 JSON。收到的原始文本(部分): ${resText.substring(0, 200)}`);
        }
    } catch (e) {
        console.error('[商品库录入上传失败]', e);
        res.status(500).json({ success: false, message: e.message });
    } finally {
        // 清理临时文件
        if (req.file?.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkErr) {
                console.warn(`[商品库录入] 清理临时文件失败: ${unlinkErr.message}`);
            }
        }
    }
});

// 2. 商品库录入 - 获取 Sheet 列表（调用 Dify 工作流）
app.post('/api/product-entry/sheets', authenticateToken, async (req, res) => {
    try {
        const { fileId, fileName, supplier } = req.body;
        logAudit(req, { module: 'PRODUCT_ENTRY', action: 'GET_SHEETS', details: { fileId, fileName, supplier } });

        if (!fileId) {
            return res.status(400).json({ success: false, message: '必须提供文件ID' });
        }

        const apiKey = process.env.DIFY_PRODUCT_ENTRY_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_ENTRY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_PRODUCT_ENTRY_API_KEY' });
        }

        const fileRef = {
            type: 'document',
            transfer_method: 'local_file',
            upload_file_id: fileId
        };

        const payload = {
            inputs: {
                product_file: fileRef,
                supplier: supplier || ''
            },
            response_mode: 'streaming',
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

        if (!difyRes.ok) {
            const errChunks = [];
            for await (const chunk of difyRes.body) { errChunks.push(Buffer.from(chunk)); }
            const errText = Buffer.concat(errChunks).toString('utf-8');
            console.error(`[Dify 商品库获取Sheet列表报错] 状态码: ${difyRes.status}, 响应: ${errText.substring(0, 500)}`);
            throw new Error(`Dify 工作流调用报错 (${difyRes.status}): ${errText.substring(0, 300)}`);
        }

        // 流式模式：解析 SSE 事件
        let sheets = [];
        let brands = [];
        let suppliers = [];
        let formToken = null;
        let workflowRunId = null;
        let taskId = null;

        const sseReader = difyRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const streamTimeout = 120000;
        const streamStart = Date.now();

        while (Date.now() - streamStart < streamTimeout) {
            const { done, value } = await sseReader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const jsonStr = line.slice(6).trim();
                if (!jsonStr) continue;

                try {
                    const event = JSON.parse(jsonStr);
                    const eventType = event?.event;
                    // 只记录关键事件，跳过高频节点事件
                    if (!['node_started','node_finished','iteration_started','iteration_next','iteration_completed'].includes(eventType)) {
                        // SSE 事件日志已精简
                    }

                    // 捕获 task_id 和 workflow_run_id
                    if (!taskId && event?.task_id) {
                        taskId = event.task_id;
                    }
                    if (!workflowRunId && event?.workflow_run_id) {
                        workflowRunId = event.workflow_run_id;
                    }

                    // 更新解析进度（用 fileId 作为 key）
                    if (eventType === 'node_started') {
                        const nodeTitle = event?.data?.title || '';
                        if (nodeTitle && fileId) {
                            __ctx.workflowProgress.set(`parse_${fileId}`, `正在执行: ${nodeTitle}`);
                        }
                    } else if (eventType === 'node_finished') {
                        const nodeTitle = event?.data?.title || '';
                        if (nodeTitle && fileId) {
                            __ctx.workflowProgress.set(`parse_${fileId}`, `已完成: ${nodeTitle}`);
                        }
                    }

                    if (eventType === 'human_input_required') {
                        // 人工介入节点：提取 form_token 和 inputs（sheet/brand 列表）
                        formToken = event?.data?.form_token || event?.form_token || null;
                        const inputs = event?.data?.inputs || event?.inputs || [];

                        if (Array.isArray(inputs) && inputs.length > 0) {
                            const optionInputs = inputs.filter(inp => inp?.option_source?.value);

                            if (optionInputs.length >= 2) {
                                for (let i = 0; i < optionInputs.length; i++) {
                                    const inp = optionInputs[i];
                                    const value = inp.option_source.value;
                                    let parsed = [];
                                    if (typeof value === 'string') {
                                        try { parsed = JSON.parse(value); } catch (e) { parsed = value.split(',').map(s => s.trim()).filter(s => s); }
                                    } else if (Array.isArray(value)) { parsed = value; }

                                    const varName = inp?.variable || inp?.name || '';
                                    if (varName.includes('brand') || varName.includes('品牌')) {
                                        brands = parsed;
                                    } else if (varName.includes('supplier') || varName.includes('供应商')) {
                                        suppliers = parsed;
                                    } else if (varName.includes('sheet') || varName.includes('Sheet')) {
                                        sheets = parsed;
                                    } else {
                                        if (sheets.length === 0) {
                                            sheets = parsed;
                                        } else if (brands.length === 0) {
                                            brands = parsed;
                                        } else {
                                            suppliers = parsed;
                                        }
                                    }
                                }
                            } else if (optionInputs.length === 1) {
                                const value = optionInputs[0].option_source.value;
                                if (typeof value === 'string') {
                                    try { sheets = JSON.parse(value); } catch (e) { sheets = value.split(',').map(s => s.trim()).filter(s => s); }
                                } else if (Array.isArray(value)) { sheets = value; }
                            }
                        }
                        // 拿到人工介入数据后即可停止读取
                        try { sseReader.cancel(); } catch (_) {}
                        break;
                    }

                    if (eventType === 'workflow_finished' || eventType === 'workflow_failed' || eventType === 'error') {
                        break;
                    }
                } catch (parseErr) {
                    console.warn(`[商品库录入] SSE 事件解析失败: ${parseErr.message}`);
                }
            }

            if (formToken || sheets.length > 0) break;
        }

        console.log(`[商品库录入] 解析完成: sheets=${sheets.length}, brands=${brands.length}, suppliers=${suppliers.length}, formToken=${!!formToken}`);

        // 清理解析进度
        if (fileId) __ctx.workflowProgress.delete(`parse_${fileId}`);

        // ── XO 专项B：进度上报 + workflowRunId 反查登记 ──
        if (trackOn() && tracked.get(fileId)) {
            trackedByRun.set(workflowRunId, fileId);
            await legacyBridge.reportSessionProgress(tracked.get(fileId).taskId, `Sheet 解析完成（${sheets.length} 个 Sheet）`, { workflow_run_id: workflowRunId });
        }
        res.json({ success: true, sheets, brands, suppliers, formToken, workflowRunId, taskId, fileId, fileName });
    } catch (e) {
        console.error('[商品库录入获取Sheet列表失败]', e);
        if (trackOn() && fileId && tracked.get(fileId)) await trackFail(fileId, 'FLOW_ERROR', e?.message || '流程失败');
        if (trackOn() && fileId && tracked.get(fileId)) trackedByRun.delete(workflowRunId);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 3. 商品库录入 - 确认 Sheet 选择（恢复 Dify 人工介入工作流）
app.post('/api/product-entry/confirm-sheet', authenticateToken, async (req, res) => {
    try {
        const { fileId, fileName, selectedSheet, supplier, selectedBrand, selectedSupplier, formToken, workflowRunId } = req.body;
        logAudit(req, { module: 'PRODUCT_ENTRY', action: 'CONFIRM_SHEET', details: { fileId, fileName, selectedSheet, supplier, selectedBrand, selectedSupplier, workflowRunId } });

        if (!selectedSheet) {
            return res.status(400).json({ success: false, message: '必须选择 Sheet' });
        }
        if (!formToken || !workflowRunId) {
            return res.status(400).json({ success: false, message: '缺少工作流恢复信息（formToken/workflowRunId）' });
        }

        const apiKey = process.env.DIFY_PRODUCT_ENTRY_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_ENTRY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_PRODUCT_ENTRY_API_KEY' });
        }

        // 先获取表单定义，动态获取 action
        const formDefRes = await fetch(`${apiUrl}/form/human_input/${formToken}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        let submitAction = 'Select';
        if (formDefRes.ok) {
            const formDef = await formDefRes.json();
            const userActions = formDef?.user_actions;
            if (Array.isArray(userActions) && userActions.length > 0) {
                submitAction = userActions[0].id || userActions[0].action || userActions[0].name || 'Select';
            }
        }

        // 提交人工介入表单（恢复工作流）
        const submitPayload = {
            inputs: {
                selected_sheet: selectedSheet,
                selected_brand: selectedBrand || '',
                selected_vendor: selectedSupplier || ''
            },
            action: submitAction,
            user: req.user?.username || 'web_os_user'
        };
        if (supplier && supplier.trim()) {
            submitPayload.inputs.supplier = supplier.trim();
        }

        const difyRes = await fetch(`${apiUrl}/form/human_input/${formToken}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(submitPayload)
        });

        const chunks = [];
        const reader = difyRes.body;
        if (reader) {
            const streamReader = reader[Symbol.asyncIterator] ? reader : difyRes.body;
            for await (const chunk of streamReader) {
                chunks.push(Buffer.from(chunk));
            }
        }
        const resText = Buffer.concat(chunks).toString('utf-8');

        if (!difyRes.ok) {
            console.error(`[Dify 商品库提交表单报错] 状态码: ${difyRes.status}, 响应: ${resText.substring(0, 500)}`);
            throw new Error(`Dify 表单提交报错 (${difyRes.status}): ${resText.substring(0, 300)}`);
        }

        // 表单提交成功后，通过 SSE 事件流获取后续工作流事件
        const userName = submitPayload.user;
        const eventsUrl = `${apiUrl}/workflow/${workflowRunId}/events?user=${encodeURIComponent(userName)}&continue_on_pause=true`;

        let finalOutputs = {};
        let secondPauseData = null;
        let taskId = null;  // 用于停止工作流
        let workflowDone = false;

        try {
            const eventsRes = await fetch(eventsUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Accept': 'text/event-stream'
                }
            });

            if (!eventsRes.ok) {
                const errText = await eventsRes.text();
                console.error(`[商品库录入] SSE 连接失败: ${errText.substring(0, 300)}`);
                throw new Error(`SSE 事件流连接失败 (${eventsRes.status})`);
            }

            // 解析 SSE 事件流
            const sseReader = eventsRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            const streamTimeout = 900000; // 15分钟超时
            const streamStart = Date.now();

            while (Date.now() - streamStart < streamTimeout) {
                const { done, value } = await sseReader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // 保留不完整的行

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const jsonStr = line.slice(6).trim();
                    if (!jsonStr) continue;

                    try {
                        const event = JSON.parse(jsonStr);
                        const eventType = event?.event;
                        if (!['node_started','node_finished','iteration_started','iteration_next','iteration_completed'].includes(eventType)) {
                            // SSE 事件日志已精简
                        }

                        // 捕获 task_id（用于停止工作流）
                        if (!taskId && event?.task_id) {
                            taskId = event.task_id;
                        }

                        // 更新解析进度（用 workflowRunId 作为 key）
                        if (eventType === 'node_started') {
                            const nodeTitle = event?.data?.title || '';
                            if (nodeTitle && workflowRunId) {
                                __ctx.workflowProgress.set(`sheet_${workflowRunId}`, `正在执行: ${nodeTitle}`);
                            }
                        } else if (eventType === 'node_finished') {
                            const nodeTitle = event?.data?.title || '';
                            if (nodeTitle && workflowRunId) {
                                __ctx.workflowProgress.set(`sheet_${workflowRunId}`, `已完成: ${nodeTitle}`);
                            }
                        }

                        if (eventType === 'human_input_required') {
                            // 第二个人工介入节点！提取 form_token
                            const newFormToken = event?.data?.form_token || event?.form_token;
                            const nodeTitle = event?.data?.node_title || '';
                            // 更新进度：用节点标题提示用户
                            if (nodeTitle && workflowRunId) {
                                __ctx.workflowProgress.set(`sheet_${workflowRunId}`, `已完成: ${nodeTitle}，等待确认...`);
                            }

                            if (newFormToken) {
                                // 获取表单定义（包含解析出的商品数据）
                                const formDefRes = await fetch(`${apiUrl}/form/human_input/${newFormToken}`, {
                                    method: 'GET',
                                    headers: { 'Authorization': `Bearer ${apiKey}` }
                                });

                                if (formDefRes.ok) {
                                    const formDef = await formDefRes.json();

                                    const formInputs = formDef?.inputs || formDef?.fields || [];
                                    const parsedData = {};

                                    // 从 form_content 解析商品列表（JSON 字符串，可能尾部有变量引用）
                                    const formContent = formDef?.form_content;
                                    if (formContent && typeof formContent === 'string') {
                                        // 提取 JSON 数组部分（去掉尾部的 #$output.xxx# 等变量引用）
                                        const jsonMatch = formContent.match(/^\s*(\[[\s\S]*\])/);
                                        if (jsonMatch) {
                                            try {
                                                const productList = JSON.parse(jsonMatch[1]);
                                                if (Array.isArray(productList) && productList.length > 0) {
                                                    parsedData.productList = productList;
                                                }
                                            } catch (e) {
                                                console.warn(`[商品库录入] form_content JSON 解析失败: ${e.message}`);
                                            }
                                        }
                                    }

                                    // 也从 inputs 的 default.value 中提取
                                    for (const input of formInputs) {
                                        const varName = input?.output_variable_name;
                                        const defaultVal = input?.default?.value;
                                        const optionSource = input?.option_source;
                                        if (varName && optionSource?.value) {
                                            parsedData[varName] = optionSource.value;
                                        }
                                        if (varName && defaultVal && typeof defaultVal === 'string' && defaultVal.trim().startsWith('[')) {
                                            try {
                                                const arr = JSON.parse(defaultVal);
                                                if (Array.isArray(arr) && arr.length > 0 && !parsedData.productList) {
                                                    parsedData.productList = arr;
                                                }
                                            } catch (_) {}
                                        }
                                    }

                                    secondPauseData = {
                                        formToken: newFormToken,
                                        workflowRunId,
                                        data: parsedData
                                    };
                                } else {
                                    console.error(`[商品库录入] 获取表单定义失败: ${formDefRes.status}`);
                                    // 即使没有表单定义，也保存 formToken
                                    secondPauseData = { formToken: newFormToken, workflowRunId, data: {} };
                                }
                            }
                            break;
                        } else if (eventType === 'workflow_finished') {
                            const outputs = event?.data?.outputs || event?.data?.data?.outputs || {};
                            finalOutputs = outputs;
                            // 检查是否包含错误信息（包括用户主动停止）
                            const wfError = event?.data?.error || event?.data?.status;
                            if (wfError && wfError !== 'succeeded' && wfError !== 'finished') {
                                const errMsg = event?.data?.error || `工作流异常结束，状态: ${wfError}`;
                                // 用户主动停止，不视为错误
                                if (__ctx.isUserStop(errMsg)) {
                                    console.log(`[商品库录入] 工作流已被用户停止`);
                                    break;
                                }
                                console.error(`[商品库录入] 工作流完成但包含错误: ${errMsg}`);
                                throw new Error(`工作流执行失败: ${errMsg}`);
                            }
                            console.log(`[商品库录入] 工作流完成`);
                            break;
                        } else if (eventType === 'workflow_failed' || eventType === 'error') {
                            const errMsg = event?.data?.error || event?.message || '工作流执行失败';
                            // 用户主动停止，不视为错误
                            if (__ctx.isUserStop(errMsg)) {
                                console.log(`[商品库录入] 工作流已被用户停止`);
                                break;
                            }
                            console.error(`[商品库录入] 工作流失败: ${errMsg}`);
                            throw new Error(`工作流执行失败: ${errMsg}`);
                        }
                    } catch (parseErr) {
                        if (parseErr.message?.includes('工作流执行失败')) throw parseErr;
                        console.warn(`[商品库录入] SSE 事件解析失败: ${parseErr.message}`);
                    }
                }

                if (secondPauseData || Object.keys(finalOutputs).length > 0) break;
            }

            // 超时后取消读取器
            try { sseReader.cancel(); } catch (_) {}
        } catch (sseErr) {
            // SSE 连接终止是正常行为（工作流暂停时），只在真正异常时打印错误
            if (sseErr.message?.includes('terminated')) {
                console.log(`[商品库录入] SSE 事件流已终止: ${sseErr.message}`);
            } else {
                console.error(`[商品库录入] SSE 事件流异常: ${sseErr.message}`);
            }
            
            // SSE 断开后，持续重连等待
            if (!secondPauseData && Object.keys(finalOutputs).length === 0) {
                const maxReconnectAttempts = 5;
                const reconnectWaitMs = 3000;
                
                for (let attempt = 1; attempt <= maxReconnectAttempts; attempt++) {
                    await new Promise(resolve => setTimeout(resolve, reconnectWaitMs));
                    
                    try {
                        const reconnectRes = await fetch(eventsUrl, {
                            method: 'GET',
                            headers: {
                                'Authorization': `Bearer ${apiKey}`,
                                'Accept': 'text/event-stream'
                            }
                        });
                        if (!reconnectRes.ok) continue;
                        
                        const reconnectReader = reconnectRes.body.getReader();
                        const decoder = new TextDecoder();
                        let buffer = '';
                        const readTimeout = 60000;
                        const readStart = Date.now();
                        
                        while (Date.now() - readStart < readTimeout) {
                            const { done, value } = await reconnectReader.read();
                            if (done) break;
                            
                            buffer += decoder.decode(value, { stream: true });
                            const lines = buffer.split('\n');
                            buffer = lines.pop();
                            
                            for (const line of lines) {
                                if (!line.startsWith('data: ')) continue;
                                const jsonStr = line.slice(6).trim();
                                if (!jsonStr) continue;
                                
                                try {
                                    const event = JSON.parse(jsonStr);
                                    const eventType = event?.event;
                                    
                                    // 更新进度
                                    if (eventType === 'node_started') {
                                        const nodeTitle = event?.data?.title || '';
                                        if (nodeTitle && workflowRunId) {
                                            __ctx.workflowProgress.set(`sheet_${workflowRunId}`, `正在执行: ${nodeTitle}`);
                                        }
                                    } else if (eventType === 'node_finished') {
                                        const nodeTitle = event?.data?.title || '';
                                        if (nodeTitle && workflowRunId) {
                                            __ctx.workflowProgress.set(`sheet_${workflowRunId}`, `已完成: ${nodeTitle}`);
                                        }
                                    }
                                    
                                    if (eventType === 'human_input_required') {
                                        const newFormToken = event?.data?.form_token || event?.form_token;
                                        if (newFormToken) {
                                            const formDefRes = await fetch(`${apiUrl}/form/human_input/${newFormToken}`, {
                                                method: 'GET',
                                                headers: { 'Authorization': `Bearer ${apiKey}` }
                                            });
                                            if (formDefRes.ok) {
                                                const formDef = await formDefRes.json();
                                                const parsedData = {};
                                                const formContent = formDef?.form_content;
                                                if (formContent && typeof formContent === 'string') {
                                                    const jsonMatch = formContent.match(/^\s*(\[[\s\S]*\])/);
                                                    if (jsonMatch) {
                                                        try {
                                                            const productList = JSON.parse(jsonMatch[1]);
                                                            if (Array.isArray(productList)) parsedData.productList = productList;
                                                        } catch (e) {}
                                                    }
                                                }
                                                secondPauseData = { formToken: newFormToken, workflowRunId, data: parsedData };
                                            }
                                        }
                                        break;
                                    } else if (eventType === 'workflow_finished') {
                                        finalOutputs = event?.data?.outputs || {};
                                        // 检查是否包含错误信息（包括用户主动停止）
                                        const wfError = event?.data?.error || event?.data?.status;
                                        if (wfError && wfError !== 'succeeded' && wfError !== 'finished') {
                                            const errMsg = event?.data?.error || `状态: ${wfError}`;
                                            if (__ctx.isUserStop(errMsg)) {
                                                break;
                                            }
                                            throw new Error(`工作流执行失败: ${errMsg}`);
                                        }
                                        break;
                                    } else if (eventType === 'workflow_failed' || eventType === 'error') {
                                        const errMsg = event?.data?.error || event?.message || '未知错误';
                                        if (__ctx.isUserStop(errMsg)) {
                                            break;
                                        }
                                        throw new Error(`工作流执行失败: ${errMsg}`);
                                    }
                                } catch (parseErr) {
                                    if (parseErr.message?.includes('工作流执行失败')) throw parseErr;
                                }
                            }
                            if (secondPauseData || Object.keys(finalOutputs).length > 0) break;
                        }
                        try { reconnectReader.cancel(); } catch (_) {}
                        if (secondPauseData || Object.keys(finalOutputs).length > 0) break;
                    } catch (reconnectErr) {
                        console.error(`[商品库录入] 重连异常: ${reconnectErr.message}`);
                    }
                }
            }
        }

        // 检查是否超时（没有获取到任何结果）
        const noResult = !secondPauseData && Object.keys(finalOutputs).length === 0 && !workflowDone;
        if (noResult) {
            // 清理进度
            if (workflowRunId) __ctx.workflowProgress.delete(`sheet_${workflowRunId}`);
            res.json({ 
                success: false, 
                message: '工作流执行时间过长，未获取到结果。请尝试重新操作，或联系技术人员检查 Dify 工作流状态。',
                timeout: true,
                workflowRunId,
                fileId, 
                fileName 
            });
            return;
        }

        // 如果有第二个人工介入数据，返回给前端让用户确认
        if (secondPauseData) {
            console.log(`[商品库录入] 返回第二个人工介入数据给前端, taskId: ${taskId}`);
            // 清理进度
            if (workflowRunId) __ctx.workflowProgress.delete(`sheet_${workflowRunId}`);
            res.json({ 
                success: true, 
                paused: true, 
                formToken: secondPauseData.formToken,
                workflowRunId: secondPauseData.workflowRunId,
                taskId: taskId,  // 用于停止工作流
                parsedData: secondPauseData.data,
                fileId, 
                fileName 
            });
            return;
        }

        try {
            let markdownText = '';
            let skuList = [];

            // 提取 Markdown 文本
            markdownText = finalOutputs.text || finalOutputs.result || finalOutputs.markdown || '';

            // 提取结构化 SKU 数据
            const skuJsonStr = finalOutputs.sku_json || finalOutputs.sku_data || '';
            if (skuJsonStr) {
                try {
                    skuList = JSON.parse(typeof skuJsonStr === 'string' ? skuJsonStr : JSON.stringify(skuJsonStr));
                } catch (e) {
                    console.warn('[商品库录入] sku_json 解析失败', e);
                }
            }

            // 清理进度
            if (workflowRunId) __ctx.workflowProgress.delete(`sheet_${workflowRunId}`);
            // ── XO 专项B：Sheet 确认进度上报 ──
            if (trackOn() && tracked.get(fileId)) {
                await legacyBridge.reportSessionProgress(tracked.get(fileId).taskId, 'Sheet 已确认，工作流续跑完成', { workflow_run_id: workflowRunId });
            }
            res.json({ success: true, data: markdownText, skuList, fileId, fileName });
        } catch (parseError) {
            console.error('[商品库录入] 结果解析失败', parseError);
            res.json({ success: true, data: '', skuList: [], fileId, fileName });
        }
    } catch (e) {
        console.error('[商品库录入确认Sheet失败]', e);
        if (trackOn() && fileId && tracked.get(fileId)) await trackFail(fileId, 'FLOW_ERROR', e?.message || '流程失败');
        if (trackOn() && fileId && tracked.get(fileId)) trackedByRun.delete(workflowRunId);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 4. 商品库录入 - 调用解析工作流
app.post('/api/product-entry/parse', authenticateToken, async (req, res) => {
    try {
        const { fileIds, fileNames, supplier } = req.body;
        logAudit(req, { module: 'PRODUCT_ENTRY', action: 'PARSE', details: { fileIds, fileNames, supplier } });

        if (!fileIds || fileIds.length === 0) {
            return res.status(400).json({ success: false, message: '必须提供至少一个文件ID' });
        }

        const apiKey = process.env.DIFY_PRODUCT_ENTRY_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_ENTRY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_PRODUCT_ENTRY_API_KEY' });
        }

        // 构造文件引用对象（单个文件）
        const fileRef = {
            type: 'document',
            transfer_method: 'local_file',
            upload_file_id: fileIds[0]
        };

        // 构造 inputs，supplier 为可选参数
        const inputs = {
            product_file: fileRef
        };
        if (supplier && supplier.trim()) {
            inputs.supplier = supplier.trim();
        }

        const payload = {
            inputs,
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

        // 流式读取响应，避免大响应截断
        const chunks = [];
        const reader = difyRes.body;
        if (reader) {
            const streamReader = reader[Symbol.asyncIterator] ? reader : difyRes.body;
            for await (const chunk of streamReader) {
                chunks.push(Buffer.from(chunk));
            }
        }
        const resText = Buffer.concat(chunks).toString('utf-8');

        if (!difyRes.ok) {
            console.error(`[Dify 商品库解析工作流报错] 状态码: ${difyRes.status}, 响应: ${resText.substring(0, 500)}`);
            throw new Error(`Dify 工作流调用报错 (${difyRes.status}): ${resText.substring(0, 300)}`);
        }

        try {
            const bodyData = JSON.parse(resText);
            let markdownText = '';
            let skuList = [];

            const rawOutputs = bodyData?.data?.outputs || bodyData?.data || bodyData;

            if (rawOutputs && typeof rawOutputs === 'object') {
                // 提取 Markdown 文本
                markdownText = rawOutputs.text || rawOutputs.result || rawOutputs.markdown || '';
                if (!markdownText && rawOutputs.outputs) {
                    markdownText = rawOutputs.outputs.text || rawOutputs.outputs.result || '';
                }

                // 提取结构化 SKU 数据（如果 Dify 工作流输出了 sku_json）
                const skuJsonStr = rawOutputs.sku_json || rawOutputs.sku_data || '';
                if (skuJsonStr) {
                    try {
                        skuList = JSON.parse(typeof skuJsonStr === 'string' ? skuJsonStr : JSON.stringify(skuJsonStr));
                    } catch (e) {
                        console.warn('[商品库录入] sku_json 解析失败', e);
                    }
                }
            } else if (typeof rawOutputs === 'string') {
                markdownText = rawOutputs;
            }

            // ── XO 专项B：SKU 解析进度上报 ──
            if (trackOn() && tracked.get(fileIds?.[0])) {
                await legacyBridge.reportSessionProgress(tracked.get(fileIds[0]).taskId, `SKU 解析完成（${(skuList || []).length} 条）`);
            }
            res.json({ success: true, data: markdownText, skuList, fileIds, fileNames });
        } catch (parseError) {
            console.error('[商品库录入] Dify 响应解析失败', parseError);
            res.json({ success: true, data: resText.substring(0, 2000), skuList: [], fileIds, fileNames });
        }
    } catch (e) {
        console.error('[商品库录入解析失败]', e);
        if (trackOn() && fileIds?.[0] && tracked.get(fileIds?.[0])) await trackFail(fileIds?.[0], 'FLOW_ERROR', e?.message || '流程失败');
        res.status(500).json({ success: false, message: e.message });
    }
})
}

export function segProductEntry2(app, __ctx) {
app.get('/api/product-entry/confirm-progress/:workflowRunId', authenticateToken, async (req, res) => {
    try {
        const { workflowRunId } = req.params;
        const progress = __ctx.workflowProgress.get(workflowRunId);
        if (progress) {
            res.json({ success: true, progress });
        } else {
            res.json({ success: true, progress: '' });
        }
    } catch (e) {
        res.json({ success: true, progress: '' });
    }
});

// 商品库录入 - 获取解析进度（用 fileId 跟踪）
app.get('/api/product-entry/parse-progress/:fileId', authenticateToken, async (req, res) => {
    try {
        const { fileId } = req.params;
        const progress = __ctx.workflowProgress.get(`parse_${fileId}`);
        if (progress) {
            res.json({ success: true, progress });
        } else {
            res.json({ success: true, progress: '' });
        }
    } catch (e) {
        res.json({ success: true, progress: '' });
    }
});

// 商品库录入 - 获取 Sheet 确认进度（用 workflowRunId 跟踪）
app.get('/api/product-entry/sheet-progress/:workflowRunId', authenticateToken, async (req, res) => {
    try {
        const { workflowRunId } = req.params;
        const progress = __ctx.workflowProgress.get(`sheet_${workflowRunId}`);
        if (progress) {
            res.json({ success: true, progress });
        } else {
            res.json({ success: true, progress: '' });
        }
    } catch (e) {
        res.json({ success: true, progress: '' });
    }
});

// 5. 商品库录入 - 确认录入工作流（提交第二个人工介入表单）
app.post('/api/product-entry/confirm', authenticateToken, async (req, res) => {
    try {
        const { fileIds, fileNames, skuData, parseResult, supplier, formToken, workflowRunId } = req.body;
        logAudit(req, { module: 'PRODUCT_ENTRY', action: 'CONFIRM', details: { fileIds, fileNames, skuCount: skuData?.skus?.length, spuCount: skuData?.spu_groups?.length, supplier, formToken, workflowRunId } });

        if (!skuData) {
            return res.status(400).json({ success: false, message: '必须提供 SKU 数据' });
        }

        const apiKey = process.env.DIFY_PRODUCT_ENTRY_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_ENTRY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_PRODUCT_ENTRY_API_KEY' });
        }

        const userName = req.user?.username || 'web_os_user';

        // 如果有 formToken，说明是恢复暂停的工作流（提交第二个人工介入表单）
        if (formToken) {
            // 使用前端已转换的中文格式 product_groups，回退到旧格式
            const productGroups = skuData.product_groups || null;

            // 先获取表单定义，确定正确的 action 和 input 变量名
            const formDefRes = await fetch(`${apiUrl}/form/human_input/${formToken}`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });

            let submitAction = 'merge';
            let inputVarName = 'merge_product_list';

            if (formDefRes.ok) {
                const formDef = await formDefRes.json();

                const userActions = formDef?.user_actions;
                if (Array.isArray(userActions) && userActions.length > 0) {
                    submitAction = userActions[0].id || userActions[0].action || userActions[0].name || 'merge';
                }
                const inputs = formDef?.inputs;
                if (Array.isArray(inputs) && inputs.length > 0) {
                    inputVarName = inputs[0].output_variable_name || inputs[0].variable || inputs[0].name || 'merge_product_list';
                }
            }

            const submitData = productGroups || skuData.spu_groups.map(group => ({
                spu_name: group.spu_name,
                skus: group.sku_rows.map(rowNum => skuData.skus.find(s => s.row === rowNum) || {})
            }));

            const submitPayload = {
                inputs: {
                    [inputVarName]: JSON.stringify(submitData, null, 2)
                },
                action: submitAction,
                user: userName
            };

            const difyRes = await fetch(`${apiUrl}/form/human_input/${formToken}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(submitPayload)
            });

            const chunks = [];
            const reader = difyRes.body;
            if (reader) {
                const streamReader = reader[Symbol.asyncIterator] ? reader : difyRes.body;
                for await (const chunk of streamReader) {
                    chunks.push(Buffer.from(chunk));
                }
            }
            const resText = Buffer.concat(chunks).toString('utf-8');

            if (!difyRes.ok) {
                console.error(`[Dify 商品库提交表单报错] 状态码: ${difyRes.status}, 响应: ${resText.substring(0, 500)}`);
                throw new Error(`Dify 表单提交报错 (${difyRes.status}): ${resText.substring(0, 300)}`);
            }

            // 通过 SSE 事件流等待工作流完成
            let finalOutputs = {};
            let pausedAtCompletion = null; // 如果在第三步人工介入暂停
            let taskId = null;  // 用于停止工作流
            let workflowDone = false;  // 标记是否收到终止事件
            const eventsUrl = `${apiUrl}/workflow/${workflowRunId}/events?user=${encodeURIComponent(userName)}&continue_on_pause=true`;

            try {
                const eventsRes = await fetch(eventsUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Accept': 'text/event-stream'
                    }
                });

                if (!eventsRes.ok) {
                    const errText = await eventsRes.text();
                    console.error(`[商品库录入] SSE 连接失败: ${errText.substring(0, 300)}`);
                } else {
                    const sseReader = eventsRes.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';
                    const streamTimeout = 1200000;
                    const streamStart = Date.now();

                    while (Date.now() - streamStart < streamTimeout) {
                        const { done, value } = await sseReader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop();

                        for (const line of lines) {
                            if (!line.startsWith('data: ')) continue;
                            const jsonStr = line.slice(6).trim();
                            if (!jsonStr) continue;
                            try {
                                const event = JSON.parse(jsonStr);
                                const eventType = event?.event;
                                if (!['node_started','node_finished','iteration_started','iteration_next','iteration_completed'].includes(eventType)) {
                                    // SSE 事件日志已精简
                                }

                                // 捕获 task_id（用于停止工作流）— task_id 在事件顶层
                                if (!taskId && event?.task_id) {
                                    taskId = event.task_id;
                                }

                                // 更新进度信息
                                if (eventType === 'node_started') {
                                    const nodeTitle = event?.data?.title || '';
                                    if (nodeTitle && workflowRunId) {
                                        __ctx.workflowProgress.set(workflowRunId, `正在执行: ${nodeTitle}`);
                                    }
                                } else if (eventType === 'node_finished') {
                                    const nodeTitle = event?.data?.title || '';
                                    if (nodeTitle && workflowRunId) {
                                        __ctx.workflowProgress.set(workflowRunId, `已完成: ${nodeTitle}`);
                                    }
                                }

                                if (eventType === 'human_input_required') {
                                    // 检测到第三步人工介入（补全信息）
                                    const completionFormToken = event?.data?.form_token || event?.form_token;
                                    if (completionFormToken) {
                                        try {
                                            const formDefUrl = `${apiUrl}/form/human_input/${completionFormToken}`;
                                            const formDefRes = await fetch(formDefUrl, {
                                                method: 'GET',
                                                headers: { 'Authorization': `Bearer ${apiKey}` }
                                            });
                                            const formDefRaw = await formDefRes.text();

                                            if (formDefRes.ok) {
                                                const formDef = JSON.parse(formDefRaw);
                                                const formContent = formDef?.form_content;

                                                let completionList = [];
                                                if (formContent && typeof formContent === 'string') {
                                                    const jsonMatch = formContent.match(/^\s*(\[[\s\S]*\])/);
                                                    if (jsonMatch) {
                                                        try {
                                                            completionList = JSON.parse(jsonMatch[1]);
                                                        } catch (jsonErr) {
                                                            console.error(`[商品库录入] JSON 解析失败: ${jsonErr.message}`);
                                                        }
                                                    }
                                                }
                                                pausedAtCompletion = {
                                                    formToken: completionFormToken,
                                                    workflowRunId,
                                                    completionList: Array.isArray(completionList) ? completionList : []
                                                };
                                                console.log(`[商品库录入] 人工介入: 补全信息数据项=${pausedAtCompletion.completionList.length}`);
                                            } else {
                                                console.error(`[商品库录入] 表单定义请求失败: 状态码=${formDefRes.status}`);
                                            }
                                        } catch (formErr) {
                                            console.warn(`[商品库录入] 获取补全信息表单定义失败: ${formErr.message}`);
                                            pausedAtCompletion = { formToken: completionFormToken, workflowRunId, completionList: [] };
                                        }
                                    }
                                    break;
                                } else if (eventType === 'workflow_finished') {
                                    finalOutputs = event?.data?.outputs || {};
                                    // 检查 workflow_finished 中是否包含错误信息
                                    const wfError = event?.data?.error || event?.data?.status;
                                    if (wfError && wfError !== 'succeeded' && wfError !== 'finished') {
                                        const errMsg = event?.data?.error || `工作流异常结束，状态: ${wfError}`;
                                        // 用户主动停止，不视为错误
                                        if (__ctx.isUserStop(errMsg)) {
                                            console.log(`[商品库录入] 工作流已被用户停止`);
                                            workflowDone = true;
                                            break;
                                        }
                                        console.error(`[商品库录入] 工作流完成但包含错误: ${errMsg}`);
                                        throw new Error(`工作流执行失败: ${errMsg}`);
                                    }
                                    console.log(`[商品库录入] 工作流完成`);
                                    workflowDone = true;
                                    break;
                                } else if (eventType === 'workflow_failed' || eventType === 'error') {
                                    const errMsg = event?.data?.error || event?.message || '未知错误';
                                    // 用户主动停止，不视为错误
                                    if (__ctx.isUserStop(errMsg)) {
                                        console.log(`[商品库录入] 工作流已被用户停止`);
                                        workflowDone = true;
                                        break;
                                    }
                                    console.error(`[商品库录入] 工作流失败: ${errMsg}`);
                                    throw new Error(`工作流执行失败: ${errMsg}`);
                                }
                            } catch (parseErr) {
                                if (parseErr.message?.includes('工作流执行失败')) throw parseErr;
                                console.warn(`[商品库录入] SSE 事件解析失败: ${parseErr.message}`);
                            }
                        }
                        if (workflowDone || pausedAtCompletion) break;
                    }
                    try { sseReader.cancel(); } catch (_) {}
                }
            } catch (sseErr) {
                // SSE 连接终止是正常行为（工作流暂停时），只在真正异常时打印错误
                if (sseErr.message?.includes('terminated')) {
                    console.log(`[商品库录入] SSE 事件流已终止: ${sseErr.message}`);
                } else {
                    console.error(`[商品库录入] SSE 事件流异常: ${sseErr.message}`);
                }

                // SSE 断开后，持续重连等待（工作流可能还在执行）
                if (!pausedAtCompletion && !workflowDone && Object.keys(finalOutputs).length === 0) {
                    const maxReconnectAttempts = 10;  // 最多重连 10 次
                    const reconnectWaitMs = 5000;     // 每次间隔 5 秒
                    
                    for (let reconnectAttempt = 1; reconnectAttempt <= maxReconnectAttempts; reconnectAttempt++) {
                        await new Promise(resolve => setTimeout(resolve, reconnectWaitMs));
                        
                        try {
                            const reconnectRes = await fetch(eventsUrl, {
                                method: 'GET',
                                headers: {
                                    'Authorization': `Bearer ${apiKey}`,
                                    'Accept': 'text/event-stream'
                                }
                            });
                            if (!reconnectRes.ok) continue;
                            
                            const reconnectReader = reconnectRes.body.getReader();
                            const decoder = new TextDecoder();
                            let buffer = '';
                            const readTimeout = 60000;  // 每次读取等待 60 秒
                            const readStart = Date.now();
                            
                            while (Date.now() - readStart < readTimeout) {
                                const { done, value } = await reconnectReader.read();
                                if (done) break;
                                buffer += decoder.decode(value, { stream: true });
                                const lines = buffer.split('\n');
                                buffer = lines.pop();
                                
                                for (const line of lines) {
                                    if (!line.startsWith('data: ')) continue;
                                    const jsonStr = line.slice(6).trim();
                                    if (!jsonStr) continue;
                                    try {
                                        const event = JSON.parse(jsonStr);
                                        const eventType = event?.event;
                                        
                                        // 更新进度信息
                                        if (eventType === 'node_started') {
                                            const nodeTitle = event?.data?.title || '';
                                            if (nodeTitle && workflowRunId) {
                                                __ctx.workflowProgress.set(workflowRunId, `正在执行: ${nodeTitle}`);
                                            }
                                        } else if (eventType === 'node_finished') {
                                            const nodeTitle = event?.data?.title || '';
                                            if (nodeTitle && workflowRunId) {
                                                __ctx.workflowProgress.set(workflowRunId, `已完成: ${nodeTitle}`);
                                            }
                                        }
                                        
                                        if (eventType === 'human_input_required') {
                                            const completionFormToken = event?.data?.form_token || event?.form_token;
                                            if (completionFormToken) {
                                                const formDefRes = await fetch(`${apiUrl}/form/human_input/${completionFormToken}`, {
                                                    method: 'GET', headers: { 'Authorization': `Bearer ${apiKey}` }
                                                });
                                                if (formDefRes.ok) {
                                                    const formDef = await formDefRes.json();
                                                    const formContent = formDef?.form_content;
                                                    let completionList = [];
                                                    if (formContent && typeof formContent === 'string') {
                                                        const jsonMatch = formContent.match(/^\s*(\[[\s\S]*\])/);
                                                        if (jsonMatch) { try { completionList = JSON.parse(jsonMatch[1]); } catch (_) {} }
                                                    }
                                                    pausedAtCompletion = { formToken: completionFormToken, workflowRunId, completionList };
                                                }
                                            }
                                            break;
                                        } else if (eventType === 'workflow_finished') {
                                            finalOutputs = event?.data?.outputs || {};
                                            const wfError2 = event?.data?.error || event?.data?.status;
                                            if (wfError2 && wfError2 !== 'succeeded' && wfError2 !== 'finished') {
                                                const errMsg = event?.data?.error || `状态: ${wfError2}`;
                                                // 用户主动停止，不视为错误
                                                if (__ctx.isUserStop(errMsg)) {
                                                    workflowDone = true;
                                                    break;
                                                }
                                                throw new Error(`工作流执行失败: ${errMsg}`);
                                            }
                                            workflowDone = true;
                                            break;
                                        } else if (eventType === 'workflow_failed' || eventType === 'error') {
                                            const errMsg = event?.data?.error || event?.message || '未知错误';
                                            // 用户主动停止，不视为错误
                                            if (__ctx.isUserStop(errMsg)) {
                                                workflowDone = true;
                                                break;
                                            }
                                            throw new Error(`工作流执行失败: ${errMsg}`);
                                        }
                                    } catch (parseErr) {
                                        if (parseErr.message?.includes('工作流执行失败')) throw parseErr;
                                    }
                                }
                                if (workflowDone || pausedAtCompletion) break;
                            }
                            try { reconnectReader.cancel(); } catch (_) {}
                            if (workflowDone || pausedAtCompletion) break;
                        } catch (reconnectErr) {
                            console.error(`[商品库录入] 重连异常: ${reconnectErr.message}`);
                        }
                    }
                }
            }

            // 如果工作流在第三步人工介入暂停（补全信息）
            if (pausedAtCompletion) {
                __ctx.workflowProgress.delete(workflowRunId);  // 清理进度
                res.json({
                    success: true,
                    paused: true,
                    completionFormToken: pausedAtCompletion.formToken,
                    completionWorkflowRunId: pausedAtCompletion.workflowRunId,
                    completionTaskId: taskId,  // 用于停止工作流
                    completionList: pausedAtCompletion.completionList
                });
                return;
            }

            // 清理进度
            __ctx.workflowProgress.delete(workflowRunId);

            // 检查是否成功获取结果
            console.log(`[商品库录入] 确认录入结果检查: finalOutputs=${Object.keys(finalOutputs).length}, workflowDone=${workflowDone}`);
            if (Object.keys(finalOutputs).length === 0 && !workflowDone) {
                throw new Error('工作流执行失败，未获取到结果，请稍后重试');
            }

            // 提取结果
            let confirmResult = finalOutputs.text || finalOutputs.result || finalOutputs.markdown || JSON.stringify(finalOutputs, null, 2);

            // 保存历史记录
            const skuCount = skuData?.skus?.length || 0;
            const spuCount = skuData?.spu_groups?.length || 0;
            await pool.query(
                `INSERT INTO product_entry_history (file_names, parse_result, confirm_result, sku_count, spu_count, status, username)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [(fileNames || []).join(', '), parseResult || '', confirmResult, skuCount, spuCount, 'confirmed', userName]
            );

            // ── XO 专项B：录入流程成功收口 ──
            await trackDone((fileIds || [])[0], confirmResult, `SKU ${skuCount} / SPU ${spuCount}`);

            res.json({ success: true, data: confirmResult });
            return;
        }

        // 没有 formToken，回退到启动新工作流（兼容旧逻辑）
        console.log(`[商品库录入] 无 formToken，启动新工作流...`);

        const fileRef = {
            type: 'document',
            transfer_method: 'local_file',
            upload_file_id: fileIds?.[0]
        };

        const inputs = {
            product_file: fileRef,
            sku_data: JSON.stringify(skuData)
        };
        if (supplier && supplier.trim()) {
            inputs.supplier = supplier.trim();
        }

        const payload = {
            inputs,
            response_mode: 'blocking',
            user: userName
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
        const reader = difyRes.body;
        if (reader) {
            const streamReader = reader[Symbol.asyncIterator] ? reader : difyRes.body;
            for await (const chunk of streamReader) {
                chunks.push(Buffer.from(chunk));
            }
        }
        const resText = Buffer.concat(chunks).toString('utf-8');

        if (!difyRes.ok) {
            console.error(`[Dify 商品库录入工作流报错] 状态码: ${difyRes.status}, 响应: ${resText.substring(0, 500)}`);
            throw new Error(`Dify 工作流调用报错 (${difyRes.status}): ${resText.substring(0, 300)}`);
        }

        let confirmResult = '';
        try {
            const bodyData = JSON.parse(resText);
            const rawOutputs = bodyData?.data?.outputs || bodyData?.data || bodyData;
            if (rawOutputs && typeof rawOutputs === 'object') {
                confirmResult = rawOutputs.text || rawOutputs.result || rawOutputs.markdown || JSON.stringify(rawOutputs, null, 2);
            } else if (typeof rawOutputs === 'string') {
                confirmResult = rawOutputs;
            }
        } catch {
            confirmResult = resText.substring(0, 2000);
        }

        // 保存历史记录
        const skuCount = skuData?.skus?.length || 0;
        const spuCount = skuData?.spu_groups?.length || 0;
        await pool.query(
            `INSERT INTO product_entry_history (file_names, parse_result, confirm_result, sku_count, spu_count, status, username)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [(fileNames || []).join(', '), parseResult || '', confirmResult, skuCount, spuCount, 'confirmed', userName]
        );

        // ── XO 专项B：录入流程成功收口 ──
        await trackDone((fileIds || [])[0], confirmResult, `SKU ${skuCount} / SPU ${spuCount}`);

        res.json({ success: true, data: confirmResult });
    } catch (e) {
        console.error('[商品库录入确认失败]', e);
        if (trackOn() && fileIds?.[0] && tracked.get(fileIds?.[0])) await trackFail(fileIds?.[0], 'FLOW_ERROR', e?.message || '流程失败');
        res.status(500).json({ success: false, message: e.message });
    }
});

// 6. 商品库录入 - 获取补全信息列表（调用 Dify 工作流）
app.post('/api/product-entry/completion-info', authenticateToken, async (req, res) => {
    try {
        const { formToken, workflowRunId } = req.body;

        if (!formToken) {
            return res.status(400).json({ success: false, message: '缺少 formToken' });
        }

        const apiKey = process.env.DIFY_PRODUCT_ENTRY_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_ENTRY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_PRODUCT_ENTRY_API_KEY' });
        }

        // 获取表单定义，提取补全信息
        const formDefRes = await fetch(`${apiUrl}/form/human_input/${formToken}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        if (!formDefRes.ok) {
            const errText = await formDefRes.text();
            console.error(`[商品库录入] 获取补全信息表单失败: ${errText.substring(0, 300)}`);
            throw new Error(`获取补全信息表单失败 (${formDefRes.status})`);
        }

        const formDef = await formDefRes.json();
        const formContent = formDef?.form_content;
        let completionList = [];

        if (formContent && typeof formContent === 'string') {
            const jsonMatch = formContent.match(/^\s*(\[[\s\S]*\])/);
            if (jsonMatch) {
                try {
                    completionList = JSON.parse(jsonMatch[1]);
                } catch (e) {
                    console.warn(`[商品库录入] 补全信息 form_content JSON 解析失败: ${e.message}`);
                    completionList = [];
                }
            }
        }

        res.json({
            success: true,
            paused: true,
            formToken,
            workflowRunId,
            completionList: Array.isArray(completionList) ? completionList : []
        });
    } catch (e) {
        console.error('[商品库录入获取补全信息失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 7. 商品库录入 - 确认补全信息选择（恢复 Dify 人工介入工作流）
app.post('/api/product-entry/confirm-completion', authenticateToken, async (req, res) => {
    try {
        const { formToken, workflowRunId, completionList, fileNames } = req.body;

        if (!formToken) {
            return res.status(400).json({ success: false, message: '缺少 formToken' });
        }

        const apiKey = process.env.DIFY_PRODUCT_ENTRY_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_ENTRY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_PRODUCT_ENTRY_API_KEY' });
        }

        const userName = req.user?.username || 'web_os_user';

        // 先获取表单定义，确定正确的 action 和 input 变量名
        const formDefRes = await fetch(`${apiUrl}/form/human_input/${formToken}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        let submitAction = 'submit';
        let inputVarName = 'completion_info';

        if (formDefRes.ok) {
            const formDef = await formDefRes.json();

            const userActions = formDef?.user_actions;
            if (Array.isArray(userActions) && userActions.length > 0) {
                submitAction = userActions[0].id || userActions[0].action || userActions[0].name || 'submit';
            }

            const inputs = formDef?.inputs;
            if (Array.isArray(inputs) && inputs.length > 0) {
                inputVarName = inputs[0].output_variable_name || inputs[0].variable || inputs[0].name || 'completion_info';
            }
        } else {
            console.warn(`[商品库录入] 获取补全表单定义失败: ${formDefRes.status}`);
        }

        const submitPayload = {
            inputs: {
                [inputVarName]: JSON.stringify(completionList || [], null, 2)
            },
            action: submitAction,
            user: userName
        };

        const difyRes = await fetch(`${apiUrl}/form/human_input/${formToken}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(submitPayload)
        });

        const chunks = [];
        const reader = difyRes.body;
        if (reader) {
            const streamReader = reader[Symbol.asyncIterator] ? reader : difyRes.body;
            for await (const chunk of streamReader) {
                chunks.push(Buffer.from(chunk));
            }
        }
        const resText = Buffer.concat(chunks).toString('utf-8');

        if (!difyRes.ok) {
            console.error(`[Dify 商品库补全信息提交报错] 状态码: ${difyRes.status}, 响应: ${resText.substring(0, 500)}`);
            throw new Error(`Dify 补全信息提交报错 (${difyRes.status}): ${resText.substring(0, 300)}`);
        }

        // 通过 SSE 事件流等待工作流完成
        let finalOutputs = {};
        let workflowDone = false;  // 标记是否收到终止事件
        const eventsUrl = `${apiUrl}/workflow/${workflowRunId}/events?user=${encodeURIComponent(userName)}`;

        try {
            const eventsRes = await fetch(eventsUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Accept': 'text/event-stream'
                }
            });

            if (!eventsRes.ok) {
                const errText = await eventsRes.text();
                console.error(`[商品库录入] SSE 事件流错误: ${errText.substring(0, 300)}`);
            } else {
                const sseReader = eventsRes.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                const streamTimeout = 1200000;
                const streamStart = Date.now();

                while (Date.now() - streamStart < streamTimeout) {
                    const { done, value } = await sseReader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop();

                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue;
                        const jsonStr = line.slice(6).trim();
                        if (!jsonStr) continue;
                        try {
                            const event = JSON.parse(jsonStr);
                            const eventType = event?.event;
                            if (!['node_started','node_finished','iteration_started','iteration_next','iteration_completed'].includes(eventType)) {
                                // SSE 事件日志已精简
                            }

                            if (eventType === 'workflow_finished') {
                                finalOutputs = event?.data?.outputs || {};
                                // 检查 workflow_finished 中是否包含错误信息
                                const wfError = event?.data?.error || event?.data?.status;
                                if (wfError && wfError !== 'succeeded' && wfError !== 'finished') {
                                    const errMsg = event?.data?.error || `工作流异常结束，状态: ${wfError}`;
                                    // 用户主动停止，不视为错误
                                    if (__ctx.isUserStop(errMsg)) {
                                        console.log(`[商品库录入] 工作流已被用户停止`);
                                        workflowDone = true;
                                        break;
                                    }
                                    console.error(`[商品库录入] 工作流完成但包含错误: ${errMsg}`);
                                    throw new Error(`工作流执行失败: ${errMsg}`);
                                }
                                console.log(`[商品库录入] 工作流完成`);
                                workflowDone = true;
                                break;
                            } else if (eventType === 'workflow_failed' || eventType === 'error') {
                                const errMsg = event?.data?.error || event?.message || '未知错误';
                                // 用户主动停止，不视为错误
                                if (__ctx.isUserStop(errMsg)) {
                                    console.log(`[商品库录入] 工作流已被用户停止`);
                                    workflowDone = true;
                                    break;
                                }
                                console.error(`[商品库录入] 工作流失败: ${errMsg}`);
                                throw new Error(`工作流执行失败: ${errMsg}`);
                            }
                        } catch (parseErr) {
                            if (parseErr.message?.includes('工作流执行失败')) throw parseErr;
                        }
                    }
                    if (workflowDone) break;
                }
                try { sseReader.cancel(); } catch (_) {}
            }
        } catch (sseErr) {
            console.warn(`[商品库录入] SSE 事件流断开: ${sseErr.message}，切换到轮询模式`);
        }

        // SSE 未拿到结果且工作流未结束，回退到轮询
        if (Object.keys(finalOutputs).length === 0 && !workflowDone) {
            const pollEndpoint = `${apiUrl}/workflows/run/${workflowRunId}`;
            // 先等 3 秒让工作流有时间执行
            await new Promise(resolve => setTimeout(resolve, 3000));
            for (let attempt = 1; attempt <= 20; attempt++) {
                try {
                    const pollRes = await fetch(pollEndpoint, {
                        method: 'GET',
                        headers: { 'Authorization': `Bearer ${apiKey}` }
                    });
                    if (!pollRes.ok) {
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        continue;
                    }
                    const data = await pollRes.json();
                    const status = data?.status;
                    if (status === 'succeeded' || status === 'finished') {
                        finalOutputs = data?.outputs || {};
                        workflowDone = true;
                        break;
                    } else if (status === 'failed') {
                        throw new Error(`工作流执行失败: ${data?.error || '未知错误'}`);
                    } else if (status === 'stopped') {
                        console.log(`[商品库录入] 工作流已被停止`);
                        workflowDone = true;
                        break;
                    }
                    // 还在运行中，继续等待
                } catch (e) {
                    if (e.message?.includes('工作流执行失败')) throw e;
                    console.warn(`[商品库录入] 轮询异常: ${e.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }

        // 检查是否成功获取结果
        console.log(`[商品库录入] 工作流结果检查: finalOutputs=${Object.keys(finalOutputs).length}, workflowDone=${workflowDone}`);
        if (Object.keys(finalOutputs).length === 0 && !workflowDone) {
            throw new Error('工作流执行失败，未获取到结果，请稍后重试');
        }
        
        // 提取结果
        let confirmResult = '';
        // 清理进度缓存
        __ctx.workflowProgress.delete(workflowRunId);
        if (Object.keys(finalOutputs).length > 0) {
            confirmResult = finalOutputs.text || finalOutputs.result || finalOutputs.markdown || JSON.stringify(finalOutputs, null, 2);
        } else {
            confirmResult = JSON.stringify({ status: '补全信息已提交', completion_count: completionList?.length || 0 }, null, 2);
        }

        // 保存历史记录
        await pool.query(
            `INSERT INTO product_entry_history (file_names, parse_result, confirm_result, sku_count, spu_count, status, username)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [(fileNames || []).join(', ') || '', '', confirmResult, completionList?.length || 0, 0, 'confirmed', userName]
        );

        // ── XO 专项B：补全流程成功收口 ──
        await trackDone(trackedByRun.get(workflowRunId), confirmResult, `补全 ${completionList?.length || 0} 条`);
        trackedByRun.delete(workflowRunId);

        res.json({ success: true, data: confirmResult });
    } catch (e) {
        console.error('[商品库录入确认补全信息失败]', e);
        if (trackOn() && trackedByRun.get(workflowRunId) && tracked.get(trackedByRun.get(workflowRunId))) await trackFail(trackedByRun.get(workflowRunId), 'FLOW_ERROR', e?.message || '流程失败');
        if (trackOn() && trackedByRun.get(workflowRunId) && tracked.get(trackedByRun.get(workflowRunId))) trackedByRun.delete(workflowRunId);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 7.5 商品库录入 - 停止工作流任务
app.post('/api/product-entry/stop-workflow', authenticateToken, async (req, res) => {
    try {
        const { taskId, workflowRunId } = req.body;
        // 优先使用 task_id，回退 workflow_run_id
        const stopId = taskId || workflowRunId;
        if (!stopId) {
            return res.json({ success: true, message: '无任务ID，跳过' });
        }

        const apiKey = process.env.DIFY_PRODUCT_ENTRY_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_ENTRY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }
        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '未配置 DIFY API' });
        }

        const userName = req.user?.username || 'web_os_user';
        // Dify 停止工作流端点: POST /v1/workflows/tasks/{task_id}/stop
        const stopUrl = `${apiUrl}/workflows/tasks/${stopId}/stop`;
        console.log(`[商品库录入] 停止工作流任务: ${stopId} (type=${taskId ? 'task_id' : 'workflow_run_id'}), URL: ${stopUrl}`);

        const stopRes = await fetch(stopUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ user: userName })
        });

        const resText = await stopRes.text();

        if (stopRes.ok) {
            // ── XO 专项B：用户中止 → 跟踪任务失败收口 ──
            if (trackOn() && trackedByRun.get(workflowRunId)) {
                await trackFail(trackedByRun.get(workflowRunId), 'USER_CANCELLED', '用户手动停止工作流');
                trackedByRun.delete(workflowRunId);
            }
            res.json({ success: true });
        } else {
            console.warn(`[商品库录入] 停止工作流失败 (${stopRes.status}): ${resText.substring(0, 300)}`);
            res.json({ success: false, message: `停止失败 (${stopRes.status})`, detail: resText.substring(0, 300) });
        }
    } catch (e) {
        console.warn(`[商品库录入] 停止工作流异常: ${e.message}`);
        res.json({ success: false, message: '停止请求异常', error: e.message });
    }
});

// 8. 商品库录入 - 获取历史记录
app.get('/api/product-entry/history', authenticateToken, async (req, res) => {
    try {
        const username = req.user.username;
        const result = await pool.query(
            'SELECT id, file_names, parse_result, confirm_result, sku_count, spu_count, status, created_at, username FROM product_entry_history WHERE username = $1 ORDER BY created_at DESC LIMIT 20',
            [username]
        );
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('[商品库录入历史查询失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 9. 商品库录入 - 删除历史记录
app.delete('/api/product-entry/history/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const username = req.user.username;
        // 只能删除自己的记录
        const result = await pool.query('DELETE FROM product_entry_history WHERE id = $1 AND username = $2', [id, username]);
        if (result.rowCount === 0) {
            return res.status(403).json({ success: false, message: '无权删除该记录' });
        }
        res.json({ success: true, message: '删除成功' });
    } catch (e) {
        console.error('[商品库录入历史删除失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
})
}
