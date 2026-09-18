// ============================================================
// server/productLibraryRoutes.js — 选品库模块路由
// ============================================================
import express from 'express';

const router = express.Router();

// 选品库活跃任务记录（streaming 模式下用于存储 task_id，供 stop 接口使用）
const productLibraryActiveTasks = new Map(); // key: username, value: { task_id, abortController }

// 查询商品（streaming 模式调用 Dify 工作流）
router.post('/products', async (req, res) => {
    const userName = req.user?.username || 'web_os_user';
    try {
        const { category, brand, supply_mode, similarity, price_min, price_max, gross_margin_min, gross_margin_max, query } = req.body || {};

        const apiKey = process.env.DIFY_PRODUCT_LIBRARY_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_LIBRARY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_PRODUCT_LIBRARY_API_KEY 或 DIFY_PRODUCT_LIBRARY_API_URL' });
        }

        const inputs = {};
        if (query) inputs.query = query;
        if (similarity) inputs.rerank_level = similarity === 'high' ? '高' : '低';
        if (category) inputs.category_str = category;
        if (brand) inputs.brand_str = brand;
        if (supply_mode) inputs.supply_mode = supply_mode;
        if (price_min !== undefined && price_min !== null && price_min !== '') inputs.price_min = String(price_min);
        if (price_max !== undefined && price_max !== null && price_max !== '') inputs.price_max = String(price_max);
        if (gross_margin_min !== undefined && gross_margin_min !== null && gross_margin_min !== '') inputs.profit_min = String(gross_margin_min);
        if (gross_margin_max !== undefined && gross_margin_max !== null && gross_margin_max !== '') inputs.profit_max = String(gross_margin_max);

        const payload = {
            inputs,
            response_mode: 'streaming',
            user: userName
        };

        const difyController = new AbortController();
        // 先清除该用户之前的任务记录
        const prevTask = productLibraryActiveTasks.get(userName);
        if (prevTask?.abortController) prevTask.abortController.abort();

        const difyRes = await fetch(`${apiUrl}/workflows/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            signal: difyController.signal
        });

        if (!difyRes.ok) {
            const errText = await difyRes.text();
            return res.status(500).json({ success: false, message: `Dify 工作流调用失败 (${difyRes.status})` });
        }

        // 记录活跃任务
        productLibraryActiveTasks.set(userName, { task_id: null, abortController: difyController });

        // 设置 SSE 响应头，向前端流式转发
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const reader = difyRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let taskId = null;
        let outputText = null;
        let optimizedQuery = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const jsonStr = line.slice(6).trim();
                if (!jsonStr) continue;
                try {
                    const event = JSON.parse(jsonStr);
                    // 捕获 task_id 并立即发送给前端
                    if (event.event === 'workflow_started' && event.task_id && !taskId) {
                        taskId = event.task_id;
                        const task = productLibraryActiveTasks.get(userName);
                        if (task) task.task_id = taskId;
                        res.write(`data: ${JSON.stringify({ type: 'started', task_id: taskId })}\n\n`);
                    }
                    // 提取工作流输出
                    if (event.event === 'workflow_finished') {
                        // 工作流失败时捕获错误信息
                        if (event.data?.status === 'failed' || !event.data?.outputs) {
                            const errMsg = event.data?.error || '工作流执行失败，无输出结果';
                            console.error('[选品库] Dify 工作流失败:', errMsg);
                            res.write(`data: ${JSON.stringify({ type: 'error', message: errMsg })}\n\n`);
                        } else {
                            const rawOutputs = event.data.outputs;
                            console.log('[选品库] Dify workflow_finished outputs keys:', Object.keys(rawOutputs));
                            // Dify 新输出格式: { optimized_query, selected: [...], count }
                            // 优先检查 outputs 本身是否包含 selected
                            let parsed = null;
                            if (rawOutputs.selected && Array.isArray(rawOutputs.selected)) {
                                // outputs 直接就是 { optimized_query, selected, count }
                                parsed = rawOutputs;
                            } else {
                                // 尝试从常见输出变量名中取值
                                const rawVal = rawOutputs.text || rawOutputs.result || rawOutputs.data || rawOutputs.output || rawOutputs.products || rawOutputs.list;
                                if (typeof rawVal === 'string') {
                                    try { parsed = JSON.parse(rawVal); } catch { console.log('[选品库] 输出值非JSON字符串:', rawVal.slice(0, 200)); }
                                } else if (rawVal != null && typeof rawVal === 'object') {
                                    parsed = rawVal;
                                } else if (Array.isArray(rawVal)) {
                                    parsed = rawVal;
                                }
                            }
                            console.log('[选品库] parsed result:', parsed ? (Array.isArray(parsed) ? `Array(${parsed.length})` : `Object keys: ${Object.keys(parsed).join(',')}`) : 'null');
                            if (parsed) {
                                if (Array.isArray(parsed)) {
                                    outputText = parsed;
                                } else if (parsed.selected && Array.isArray(parsed.selected)) {
                                    outputText = parsed.selected;
                                    optimizedQuery = parsed.optimized_query || null;
                                } else {
                                    outputText = [parsed];
                                }
                            } else {
                                outputText = [];
                            }
                        }
                    }
                    // 转发其他事件给前端
                    if (event.event === 'workflow_started' || event.event === 'workflow_finished') {
                        res.write(`data: ${JSON.stringify({ type: event.event, ...event })}\n\n`);
                    }
                } catch {
                    // 忽略非 JSON 行
                }
            }
        }

        // 清理活跃任务记录
        productLibraryActiveTasks.delete(userName);

        // 发送最终结果（Dify 已返回英文字段，无需映射）
        const finalList = Array.isArray(outputText) ? outputText : [];
        const finalPayload = { type: 'finished', success: true, data: finalList };
        if (optimizedQuery) finalPayload.optimized_query = optimizedQuery;
        res.write(`data: ${JSON.stringify(finalPayload)}\n\n`);
        res.end();
    } catch (e) {
        productLibraryActiveTasks.delete(userName);
        // 如果 SSE 已建立，通过 SSE 发送错误；否则用 JSON
        if (res.headersSent && res.getHeader('Content-Type') === 'text/event-stream') {
            res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
            res.end();
        } else {
            res.status(500).json({ success: false, message: e.message });
        }
    }
});

// 中断 Dify 工作流
router.post('/stop', async (req, res) => {
    try {
        const userName = req.user?.username || 'web_os_user';
        const { task_id } = req.body || {};
        const apiKey = process.env.DIFY_PRODUCT_LIBRARY_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_LIBRARY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }
        if (!apiKey || !apiUrl) {
            return res.json({ success: true, message: 'Dify 未配置，无需停止' });
        }

        // 优先使用前端传入的 task_id，回退到内存记录
        const activeTask = productLibraryActiveTasks.get(userName);
        const stopId = task_id || activeTask?.task_id;

        // 中断后端到 Dify 的 HTTP 连接
        if (activeTask?.abortController) {
            activeTask.abortController.abort();
        }
        productLibraryActiveTasks.delete(userName);

        if (!stopId) {
            return res.json({ success: true, message: '已中断本地连接' });
        }

        const stopUrl = `${apiUrl}/workflows/tasks/${stopId}/stop`;
        const stopRes = await fetch(stopUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ user: userName })
        });
        const stopText = await stopRes.text();
        res.json({ success: true, task_id: stopId });
    } catch (e) {
        res.json({ success: true, message: e.message });
    }
});

export default router;
