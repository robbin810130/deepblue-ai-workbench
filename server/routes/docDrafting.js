/**
 * docDrafting 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import crypto from 'crypto';
import { logger } from '../infra/logger.js';
import { authenticateToken } from '../infra/auth.js';
import pool from '../db.js';

export function segDocDrafting1(app, __ctx) {
app.post('/api/doc-drafting/generate', authenticateToken, async (req, res) => {
    const { query, doc_type } = req.body;
    const apiKey = process.env.DIFY_DOC_DRAFTING_API_KEY;
    const apiUrl = process.env.DIFY_DOC_DRAFTING_API_URL;

    if (!query) return res.status(400).json({ error: '文档基本信息不能为空' });
    if (!doc_type) return res.status(400).json({ error: '文档类型不能为空' });
    if (!apiKey || apiKey === 'app-xxxx') {
        return res.json({ success: false, message: '系统未配文档起草 Dify API Key，请联系管理员在.env中配置。' });
    }

    try {
        logger.info(`[Doc Drafting] 请求生成类型: ${doc_type}`);
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: { doc_type: doc_type },
                query: query,
                response_mode: 'blocking',
                conversation_id: '',
                user: req.user?.username || 'system-user'
            })
        });

        const data = await response.json();

        if (!response.ok) {
            logger.error(`[Doc Drafting Error] Status: ${response.status}, Data: ${JSON.stringify(data)}`);
            throw new Error(data.message || 'Dify 生成文档请求失败');
        }

        res.json({
            success: true,
            result: data.answer || 'Dify 未返回有效内容。'
        });
    } catch (e) {
        logger.error('[Doc Drafting Exception] ' + e.message);
        res.status(500).json({ error: e.message });
    }
});

// --- 文档起草历史管理 [NEW] ---

// 1. 获取起草历史
app.get('/api/doc-drafting/history', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, doc_type as "type", original_query as "query", result_text as "content", created_at as "time" FROM sys_doc_drafting WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        const history = result.rows.map(row => ({
            ...row,
            time: new Date(row.time).toLocaleString()
        }));
        res.json({ success: true, history });
    } catch (e) {
        logger.error('[Doc History Get Error] ' + e.message);
        res.status(500).json({ error: e.message });
    }
});

// 2. 保存起草条目
app.post('/api/doc-drafting/history/save', authenticateToken, async (req, res) => {
    const { name, doc_type, query, content } = req.body;
    if (!name || !content) return res.status(400).json({ error: '保存参数不完整' });

    try {
        const id = crypto.randomUUID();
        await pool.query(
            'INSERT INTO sys_doc_drafting (id, user_id, name, doc_type, original_query, result_text) VALUES ($1, $2, $3, $4, $5, $6)',
            [id, req.user.id, name, doc_type, query, content]
        );
        const savedItem = { id, name, type: doc_type, query, content, time: new Date().toLocaleString() };
        res.json({ success: true, item: savedItem });
    } catch (e) {
        logger.error('[Doc History Save Error] ' + e.message);
        res.status(500).json({ error: e.message });
    }
});

// 3. 删除历史条目
app.delete('/api/doc-drafting/history/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM sys_doc_drafting WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (e) {
        logger.error('[Doc History Delete Error] ' + e.message);
        res.status(500).json({ error: e.message });
    }
})
}
