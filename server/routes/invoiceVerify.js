/**
 * invoiceVerify 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import fs from 'fs';
import { authenticateToken } from '../infra/auth.js';
import { logAudit } from '../infra/audit.js';
import pool from '../db.js';
import * as legacyBridge from '../modules/tasks/legacyBridge.js';

export function segInvoiceVerify1(app, __ctx) {
app.post('/api/invoice-verify/upload', authenticateToken, __ctx.upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: '未找到文件数据' });
        }
        logAudit(req, { module: 'INVOICE_VERIFY', action: 'UPLOAD_FILE', target_data: __ctx.fixUploadedFileName(req.file.originalname) });

        const apiKey = process.env.DIFY_INVOICE_VERIFY_API_KEY;
        let apiUrl = process.env.DIFY_INVOICE_VERIFY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_INVOICE_VERIFY_API_KEY' });
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
            console.error(`[Dify 发票上传失败] 状态码: ${difyRes.status}, 响应: ${resText}`);
            throw new Error(`Dify 文件上传失败 (${difyRes.status}): ${resText.substring(0, 200)}`);
        }

        try {
            const data = JSON.parse(resText);
            res.json({ success: true, file_id: data.id });
        } catch (parseError) {
            throw new Error(`无法解析 Dify 响应为 JSON。收到的原始文本(部分): ${resText.substring(0, 200)}`);
        }
    } catch (e) {
        console.error('[发票校验上传失败]', e);
        res.status(500).json({ success: false, message: e.message });
    } finally {
        // 统一清理临时文件
        if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch (_) { /* 忽略 */ } }
    }
})
}

export function segInvoiceVerify2(app, __ctx) {
app.post('/api/invoice-verify/run', authenticateToken, async (req, res) => {
    try {
        const { pdfIds, xlsxIds, pdfNames, xlsxNames } = req.body;
        logAudit(req, { module: 'INVOICE_VERIFY', action: 'RUN_VERIFY', details: { pdfIds, xlsxIds, pdfNames, xlsxNames } });

        if (!pdfIds || pdfIds.length === 0 || !xlsxIds || xlsxIds.length === 0) {
            return res.status(400).json({ success: false, message: '必须提供 PDF 和 XLSX 文件ID' });
        }

        // ── D4 试点迁移（TASK_CENTER_PILOT 含 invoice_verify 时启用）──────────
        // 建任务 → 执行 → 通知闭环；成功后用归一化输出构造与 Dify 阻塞响应同形的
        // bodyData，复用既有解析/落库/响应逻辑 —— 行为零变化。未启用时走下方旧直连路径。
        if (legacyBridge.isPilotSkill('invoice_verify')) {
            const r = await legacyBridge.runThroughTaskCenter({
                skillKey: 'invoice_verify',
                title: `发票校验：${(pdfNames || []).join('、') || '发票PDF'} × ${(xlsxNames || []).join('、') || '对账单'}`,
                user: req.user,
                inputs: {
                    invoice_files: pdfIds.map((id) => ({ type: 'document', transfer_method: 'local_file', upload_file_id: id })),
                    statement_files: xlsxIds.map((id) => ({ type: 'document', transfer_method: 'local_file', upload_file_id: id })),
                },
            });
            if (!r.ok) {
                console.error(`[发票校验-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                return res.status(500).json({ success: false, message: `任务执行失败（${r.taskNo}）：${r.message}` });
            }
            return await __ctx.respondInvoiceBody(req, res, { data: { outputs: r.outputs ?? {} } }, { pdfNames, xlsxNames });
        }

        const apiKey = process.env.DIFY_INVOICE_VERIFY_API_KEY;
        let apiUrl = process.env.DIFY_INVOICE_VERIFY_API_URL;
        if (apiUrl && !apiUrl.endsWith('/v1')) {
            apiUrl = `${apiUrl.replace(/\/$/, '')}/v1`;
        }

        if (!apiKey || !apiUrl) {
            return res.status(500).json({ success: false, message: '服务端未配置 DIFY_INVOICE_VERIFY_API_KEY' });
        }

        // 构造文件列表（用于 files 数组 备用）
        const fileList = [];
        pdfIds.forEach(id => {
            fileList.push({ type: 'document', transfer_method: 'local_file', upload_file_id: id });
        });
        xlsxIds.forEach(id => {
            fileList.push({ type: 'document', transfer_method: 'local_file', upload_file_id: id });
        });

        // 构造 Dify inputs：将两类文件分别映射到 invoice_files 和 statement_files
        const invoiceFileRefs = pdfIds.map(id => ({
            type: 'document',
            transfer_method: 'local_file',
            upload_file_id: id
        }));
        const statementFileRefs = xlsxIds.map(id => ({
            type: 'document',
            transfer_method: 'local_file',
            upload_file_id: id
        }));

        const payload = {
            inputs: {
                invoice_files: invoiceFileRefs,
                statement_files: statementFileRefs
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

        // 使用流式读取，避免大响应截断
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
            console.error(`[Dify 发票校验工作流报错] 状态码: ${difyRes.status}, 响应: ${resText.substring(0, 500)}`);
            throw new Error(`Dify 工作流调用报错 (${difyRes.status}): ${resText.substring(0, 300)}`);
        }

        console.log(`[发票校验] Dify 响应长度: ${resText.length} 字符`);

        try {
            const bodyData = JSON.parse(resText);
            return await __ctx.respondInvoiceBody(req, res, bodyData, { pdfNames, xlsxNames });
        } catch (parseErr) {
            console.error('[发票校验 JSON解析失败]', parseErr.message);
            console.error('[发票校验] resText 前 500 字符:', resText.substring(0, 500));
            console.error('[发票校验] resText 后 200 字符:', resText.substring(resText.length - 200));
            throw new Error(`无法解析 Dify 响应为 JSON: ${parseErr.message}`);
        }

    } catch (e) {
        console.error('[发票校验请求失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 3. 发票校验 - 获取历史记录
app.get('/api/invoice-verify/history', authenticateToken, async (req, res) => {
    try {
        const username = req.user?.username;
        const result = await pool.query(
            'SELECT id, pdf_name, xlsx_name, result_text, supplier_name, status, created_at, username FROM invoice_verify_history WHERE username = $1 ORDER BY created_at DESC LIMIT 20',
            [username]
        );
        res.json({ success: true, data: result.rows });
    } catch (e) {
        console.error('[发票校验历史查询失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 4. 发票校验 - 删除历史记录
app.delete('/api/invoice-verify/history/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const username = req.user?.username;
        // 只能删除自己的记录
        const result = await pool.query('DELETE FROM invoice_verify_history WHERE id = $1 AND username = $2', [id, username]);
        if (result.rowCount === 0) {
            return res.status(403).json({ success: false, message: '无权删除该记录' });
        }
        res.json({ success: true, message: '删除成功' });
    } catch (e) {
        console.error('[发票校验历史删除失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// 5. 发票校验 - 更新历史记录状态
app.put('/api/invoice-verify/history/:id/status', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const username = req.user?.username;
        // 验证状态值
        const validStatuses = ['待确认', '已确认', '已退票'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: '无效的状态值' });
        }
        // 查询当前状态，只有“待确认”才允许修改
        const current = await pool.query(
            'SELECT status FROM invoice_verify_history WHERE id = $1 AND username = $2',
            [id, username]
        );
        if (current.rowCount === 0) {
            return res.status(403).json({ success: false, message: '无权更新该记录' });
        }
        if (current.rows[0].status !== '待确认') {
            return res.status(403).json({ success: false, message: '只有待确认状态才允许修改' });
        }
        // 更新状态
        await pool.query(
            'UPDATE invoice_verify_history SET status = $1 WHERE id = $2 AND username = $3',
            [status, id, username]
        );
        res.json({ success: true, message: '状态更新成功' });
    } catch (e) {
        console.error('[发票校验状态更新失败]', e);
        res.status(500).json({ success: false, message: e.message });
    }
})
}
