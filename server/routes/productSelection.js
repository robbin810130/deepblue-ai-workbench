/**
 * productSelection 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import fs from 'fs';
import { authenticateToken } from '../infra/auth.js';
import pool from '../db.js';
import * as legacyBridge from '../modules/tasks/legacyBridge.js'; // XO 专项C：外部执行型跟踪

export function segProductSelection1(app, __ctx) {
app.post('/api/product-selection/upload', authenticateToken, __ctx.upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: '未收到文件' });

        const apiKey = process.env.DIFY_PRODUCT_SELECTION_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_SELECTION_API_URL;
        if (!apiKey || !apiUrl) return res.status(503).json({ success: false, message: 'Dify 未配置' });

        const baseUrl = apiUrl.replace(/\/$/, '');
        const fileContent = fs.readFileSync(req.file.path);
        const { Blob: NodeBlob } = await import('buffer');
        const blob = new NodeBlob([fileContent], { type: req.file.mimetype });

        const formData = new FormData();
        formData.append('file', blob, req.file.originalname);
        formData.append('user', req.user?.username || 'web_os_user');

        const difyRes = await fetch(`${baseUrl}/files/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: formData
        });

        const resText = await difyRes.text();
        if (!difyRes.ok) {
            console.error(`[选品策略上传] Dify 失败: ${difyRes.status}, ${resText.substring(0, 300)}`);
            return res.status(difyRes.status).json({ success: false, message: `Dify 上传失败 (${difyRes.status})` });
        }

        const data = JSON.parse(resText);

        res.json({ success: true, upload_file_id: data.id, filename: req.file.originalname, mimetype: req.file.mimetype });
    } catch (e) {
        console.error('[选品策略上传] 错误:', e.message);
        res.status(500).json({ success: false, message: e.message });
    } finally {
        if (req.file?.path) {
            try { fs.unlinkSync(req.file.path); } catch (e) { }
        }
    }
});

// 选品策略 - 发送对话消息（SSE 流式返回）
app.post('/api/product-selection/chat', authenticateToken, async (req, res) => {
    let trackedTask = null; // XO 专项C：跟踪任务句柄（try 外声明，catch 也可用）
    try {
        const { conversation_id, message, files: uploadFiles } = req.body;
        const userId = req.user?.id;
        const caller = req.user?.username || 'web_os_user';

        if (!message && (!uploadFiles || uploadFiles.length === 0)) {
            return res.status(400).json({ success: false, message: '消息内容不能为空' });
        }

        const apiKey = process.env.DIFY_PRODUCT_SELECTION_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_SELECTION_API_URL;
        if (!apiKey || !apiUrl) {
            return res.status(503).json({ success: false, message: 'Dify 未配置' });
        }
        const baseUrl = apiUrl.replace(/\/$/, '');
        const chatUrl = `${baseUrl}/chat-messages`;

        // 获取或创建会话
        let convId = conversation_id;
        if (!convId) {
            const title = (message || '新对话').substring(0, 20);
            const convResult = await pool.query(
                `INSERT INTO sys_product_selection_conversations (user_id, title, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) RETURNING id`,
                [userId, title]
            );
            convId = convResult.rows[0].id;
        } else {
            await pool.query(`UPDATE sys_product_selection_conversations SET updated_at = NOW() WHERE id = $1 AND user_id = $2`, [convId, userId]);
        }

        // 保存用户消息
        await pool.query(
            `INSERT INTO sys_product_selection_messages (conversation_id, role, content, files, created_at) VALUES ($1, 'user', $2, $3, NOW())`,
            [convId, message || '', uploadFiles ? JSON.stringify(uploadFiles) : null]
        );

        // 构造 Dify 请求
        // files 为顶层参数，不能放在 inputs 里
        const difyFiles = uploadFiles && uploadFiles.length > 0
            ? uploadFiles.map(f => ({
                type: f.mimetype?.startsWith('image/') ? 'image' : 'document',
                transfer_method: 'local_file',
                upload_file_id: f.upload_file_id
            }))
            : undefined;

        // 查询 Dify conversation_id 用于多轮对话上下文
        let difyConvId = '';
        if (convId) {
            const existingConv = await pool.query(
                `SELECT dify_conversation_id FROM sys_product_selection_conversations WHERE id = $1`,
                [convId]
            );
            if (existingConv.rows[0]?.dify_conversation_id) {
                difyConvId = existingConv.rows[0].dify_conversation_id;
            }
        }

        const payload = {
            inputs: {},
            query: message || '请分析上传的文件',
            response_mode: 'streaming',
            conversation_id: difyConvId,
            user: caller,
            ...(difyFiles && difyFiles.length > 0 && { files: difyFiles })
        };

        console.log(`[选品策略] 开始调用 Dify (streaming), 会话ID: ${convId}`);

        // ── XO 专项C：每轮对话建跟踪任务（观测面；Dify 流式调用保持原样）──
        if (legacyBridge.isPilotSkill('product_selection')) {
            trackedTask = await legacyBridge.startTrackedSession({
                skillKey: 'product_selection',
                title: `选品策略·${(message || '文件分析').slice(0, 20)}`,
                user: req.user,
                inputs: { conversation_id: convId, message: (message || '').slice(0, 500), has_files: !!(uploadFiles && uploadFiles.length) },
            });
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 130000);

        let difyRes;
        try {
            difyRes = await fetch(chatUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }

        if (!difyRes.ok) {
            const errChunks = [];
            for await (const chunk of difyRes.body) { errChunks.push(Buffer.from(chunk)); }
            const errText = Buffer.concat(errChunks).toString('utf-8');
            console.error(`[选品策略 Dify 报错] ${difyRes.status}: ${errText.substring(0, 500)}`);
            if (trackedTask) await legacyBridge.failTrackedSession(trackedTask.taskId, { code: 'DIFY_HTTP_ERROR', message: `Dify 调用失败 (${difyRes.status})` });
            return res.status(difyRes.status).json({ success: false, message: `Dify 调用失败 (${difyRes.status})` });
        }

        // SSE 响应头
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const reader = difyRes.body.getReader();
        const decoder = new TextDecoder();
        let fullAnswer = '';
        let sseBuffer = '';
        let taskId = '';
        let assistantSaved = false;

        // 空闲超时保护
        let idleTimer;
        let isIdleTimeout = false;
        const resetIdleTimer = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => { isIdleTimeout = true; controller.abort(); }, 60000);
        };
        resetIdleTimer();

        try {
            while (true) {
                resetIdleTimer();
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                sseBuffer += chunk;
                const lines = sseBuffer.split('\n');
                sseBuffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data:')) continue;
                    const jsonStr = line.slice(5).trim();
                    if (!jsonStr) continue;

                    try {
                        const eventData = JSON.parse(jsonStr);
                        if (eventData.task_id) taskId = eventData.task_id;

                        if (eventData.event === 'message') {
                            fullAnswer += eventData.answer || '';
                            // 保存 Dify conversation_id 用于后续多轮对话
                            if (eventData.conversation_id && !difyConvId) {
                                difyConvId = eventData.conversation_id;
                                await pool.query(
                                    `UPDATE sys_product_selection_conversations SET dify_conversation_id = $1 WHERE id = $2`,
                                    [difyConvId, convId]
                                );
                            }
                            res.write(`data: ${JSON.stringify({ event: 'message', answer: eventData.answer, task_id: taskId })}\n\n`);
                        } else if (eventData.event === 'message_end') {
                            // 流式结束，保存 AI 回复到数据库
                            await pool.query(
                                `INSERT INTO sys_product_selection_messages (conversation_id, role, content, created_at) VALUES ($1, 'assistant', $2, NOW())`,
                                [convId, fullAnswer]
                            );
                            assistantSaved = true;
                            if (trackedTask) await legacyBridge.completeTrackedSession(trackedTask.taskId, { result: fullAnswer, summary: `${fullAnswer.length} 字回复` });
                            res.write(`data: ${JSON.stringify({ event: 'complete', answer: fullAnswer, conversation_id: convId })}\n\n`);
                        } else if (eventData.event === 'error') {
                            res.write(`data: ${JSON.stringify({ event: 'error', message: eventData.message || 'Dify 错误' })}\n\n`);
                        }
                    } catch (e) {
                        console.warn(`[选品策略 SSE] 解析失败: ${jsonStr.substring(0, 100)}`, e.message);
                    }
                }
            }
        } finally {
            clearTimeout(idleTimer);
            // ── XO 专项C：流中断（用户停止/超时）→ 跟踪任务失败收口（幂等）──
            if (trackedTask && !assistantSaved) {
                await legacyBridge.failTrackedSession(trackedTask.taskId, { code: 'SESSION_ABORTED', message: fullAnswer.length > 0 ? '流式中断（部分内容已保存）' : '流式中断（无内容）' });
            }
            // 流中断时（用户手动停止等），保存已收集的内容并标记 stopped
            if (!assistantSaved && fullAnswer.length > 0) {
                try {
                    await pool.query(
                        `INSERT INTO sys_product_selection_messages (conversation_id, role, content, stopped, created_at) VALUES ($1, 'assistant', $2, TRUE, NOW())`,
                        [convId, fullAnswer]
                    );
                    console.log(`[选品策略] 流中断，已保存中断内容 (${fullAnswer.length} 字符), 会话ID: ${convId}`);
                } catch (saveErr) {
                    console.warn('[选品策略] 保存中断内容失败:', saveErr.message);
                }
            } else if (!assistantSaved && fullAnswer.length === 0) {
                // 没有任何内容就中断，也插入一条空消息标记停止
                try {
                    await pool.query(
                        `INSERT INTO sys_product_selection_messages (conversation_id, role, content, stopped, created_at) VALUES ($1, 'assistant', '', TRUE, NOW())`,
                        [convId]
                    );
                } catch (saveErr) {
                    console.warn('[选品策略] 保存空停止消息失败:', saveErr.message);
                }
            }
        }

        console.log(`[选品策略] 流式响应结束, 会话ID: ${convId}, answer长度: ${fullAnswer.length}`);
        res.end();

    } catch (error) {
        const msg = error.name === 'AbortError' ? 'Dify 调用超时' : error.message || '选品策略服务内部错误';
        console.error(`[选品策略 Error] ${msg}`);
        if (trackedTask) await legacyBridge.failTrackedSession(trackedTask.taskId, { code: error.name === 'AbortError' ? 'PROVIDER_TIMEOUT' : 'FLOW_ERROR', message: msg });
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: msg });
        } else {
            res.write(`data: ${JSON.stringify({ event: 'error', message: msg })}\n\n`);
            res.end();
        }
    }
});

// 选品策略 - 停止流式生成
app.post('/api/product-selection/stop', authenticateToken, async (req, res) => {
    try {
        const { task_id, conversation_id } = req.body;
        const userId = req.user?.id;
        if (!task_id) return res.status(400).json({ success: false, message: '缺少 task_id' });

        const apiKey = process.env.DIFY_PRODUCT_SELECTION_API_KEY;
        let apiUrl = process.env.DIFY_PRODUCT_SELECTION_API_URL;
        if (!apiKey || !apiUrl) return res.status(503).json({ success: false, message: 'Dify 未配置' });

        const baseUrl = apiUrl.replace(/\/chat-messages\/?$/, '').replace(/\/$/, '');
        const stopUrl = `${baseUrl}/chat-messages/${task_id}/stop`;

        const stopRes = await fetch(stopUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ user: req.user?.username || 'web_os_user' })
        });
        const stopText = await stopRes.text();
        console.log(`[选品策略] Dify stop: ${stopRes.status}`);

        // 标记数据库中最新的 assistant 消息为已停止
        try {
            if (conversation_id) {
                await pool.query(
                    `UPDATE sys_product_selection_messages SET stopped = TRUE
                     WHERE id = (
                         SELECT id FROM sys_product_selection_messages
                         WHERE conversation_id = $1 AND role = 'assistant'
                         ORDER BY created_at DESC LIMIT 1
                     )`,
                    [conversation_id]
                );
            } else if (userId) {
                // 新会话场景：通过用户最近会话查找
                await pool.query(
                    `UPDATE sys_product_selection_messages SET stopped = TRUE
                     WHERE id = (
                         SELECT m.id FROM sys_product_selection_messages m
                         JOIN sys_product_selection_conversations c ON m.conversation_id = c.id
                         WHERE c.user_id = $1 AND m.role = 'assistant'
                         ORDER BY m.created_at DESC LIMIT 1
                     )`,
                    [userId]
                );
            }
        } catch (dbErr) {
            console.warn('[选品策略] 标记停止状态失败:', dbErr.message);
        }

        res.json({ success: stopRes.ok, message: stopText });
    } catch (e) {
        console.error('[选品策略] 停止失败:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 选品策略 - 获取会话列表
app.get('/api/product-selection/conversations', authenticateToken, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.json({ success: true, data: [] });
        const result = await pool.query(
            `SELECT id, title, created_at, updated_at FROM sys_product_selection_conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50`,
            [userId]
        );
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('[选品策略] 获取会话列表失败:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 选品策略 - 获取某会话的全部消息
app.get('/api/product-selection/conversations/:id/messages', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        // 先验证会话归属
        const conv = await pool.query(`SELECT id FROM sys_product_selection_conversations WHERE id = $1 AND user_id = $2`, [id, userId]);
        if (conv.rows.length === 0) return res.status(403).json({ success: false, message: '无权访问' });
        // 再查询消息
        const result = await pool.query(
            `SELECT id, role, content, files, stopped, created_at FROM sys_product_selection_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
            [id]
        );
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('[选品策略] 获取消息失败:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 选品策略 - 删除会话（级联删除消息）
app.delete('/api/product-selection/conversations/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        // 先验证会话归属
        const conv = await pool.query(
            `SELECT id FROM sys_product_selection_conversations WHERE id = $1 AND user_id = $2`,
            [id, userId]
        );
        if (conv.rows.length === 0) return res.status(403).json({ success: false, message: '无权删除' });
        // 使用事务级联删除
        await pool.query('BEGIN');
        try {
            await pool.query(`DELETE FROM sys_product_selection_messages WHERE conversation_id = $1`, [id]);
            await pool.query(`DELETE FROM sys_product_selection_conversations WHERE id = $1`, [id]);
            await pool.query('COMMIT');
        } catch (txErr) {
            await pool.query('ROLLBACK');
            throw txErr;
        }
        res.json({ success: true });
    } catch (e) {
        console.error('[选品策略] 删除会话失败:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 选品策略 - 更新会话标题
app.put('/api/product-selection/conversations/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { title } = req.body;
        const userId = req.user?.id;
        if (!title) return res.status(400).json({ success: false, message: '标题不能为空' });
        await pool.query(
            `UPDATE sys_product_selection_conversations SET title = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
            [title.substring(0, 200), id, userId]
        );
        res.json({ success: true });
    } catch (e) {
        console.error('[选品策略] 更新标题失败:', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
})
}
