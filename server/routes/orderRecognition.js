/**
 * orderRecognition 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../infra/logger.js';
import { authenticateToken } from '../infra/auth.js';
import pool from '../db.js';
import { analyzeMaterialQuote } from '../services/pricingAnalysisService.js';

export function segOrderRecognition1(app, __ctx) {
app.get('/api/order-recognition/history', authenticateToken, async (req, res) => {
    try {
        const userId = await __ctx.getUserId(req);
        const result = await pool.query(
            `SELECT * FROM sys_order_recognitions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
            [userId]
        );
        const list = result.rows.map(row => ({
            id: row.id,
            timestamp: new Date(row.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
            fileName: row.file_name,
            fileUrl: row.file_url,
            fileType: row.file_type,
            customerName: row.customer_name,
            summary: row.summary,
            fullContent: row.full_content
        }));
        res.json({ success: true, data: list });
    } catch (err) {
        logger.error('[material-quote] Fetch history error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/** POST /api/order-recognition/history  保存报价记录到数据库 */
app.post('/api/order-recognition/history', authenticateToken, async (req, res) => {
    try {
        const userId = await __ctx.getUserId(req);
        const { id, fileName, fileUrl, fileType, customerName, summary, fullContent } = req.body;

        await pool.query(`
            INSERT INTO sys_order_recognitions (id, user_id, file_name, file_url, file_type, customer_name, summary, full_content)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE SET
            customer_name = EXCLUDED.customer_name,
            summary = EXCLUDED.summary,
            full_content = EXCLUDED.full_content
        `, [id || `mq-${Date.now()}`, userId, fileName, fileUrl, fileType, customerName, summary, fullContent]);

        res.json({ success: true });
    } catch (err) {
        logger.error('[material-quote] Save history error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/** POST /api/order-recognition/memory  将纠错记录保存到 Dify 知识库 */
app.post('/api/order-recognition/memory', authenticateToken, async (req, res) => {
    try {
        const apiKey = process.env.DIFY_MEMORY_API_KEY || process.env.DIFY_KNOWLEDGE_API_KEY;
        const datasetId = '17482fe4-8818-4570-9cf6-7d30d14de84f';
        const baseUrl = process.env.DIFY_API_BASE_URL || 'http://39.108.221.22/v1';
        
        if (!apiKey) return res.status(503).json({ error: '未配置知识库 API Key' });

        const { customerName, ocrName, materialNo, materialName, materialSpec } = req.body;
        
        const textContent = `客户：${customerName}
OCR识别：${ocrName}
纠错物料编码：${materialNo}
纠错物料名称：${materialName}
纠错规格：${materialSpec}`;

        const difyRes = await fetch(`${baseUrl}/datasets/${datasetId}/document/create_by_text`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: `[纠错] ${customerName} - ${ocrName}`,
                text: textContent,
                indexing_technique: 'economy',
                process_rule: {
                    mode: 'automatic'
                }
            })
        });

        if (!difyRes.ok) {
            const errData = await difyRes.text();
            throw new Error(`Dify API Error: ${errData}`);
        }

        res.json({ success: true, message: '已加入纠错记忆库' });
    } catch (err) {
        logger.error('[order-recognition] Save memory error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/** DELETE /api/order-recognition/history/:id  删除单条记录（同步删除对应上传文件） */
app.delete('/api/order-recognition/history/:id', authenticateToken, async (req, res) => {
    try {
        const userId = await __ctx.getUserId(req);
        // 先查出文件路径
        const fileRow = await pool.query(
            'SELECT file_url FROM sys_order_recognitions WHERE id = $1 AND user_id = $2',
            [req.params.id, userId]
        );
        if (fileRow.rows.length > 0 && fileRow.rows[0].file_url) {
            const fileUrl = fileRow.rows[0].file_url; // e.g. /uploads/material-quote/xxx.pdf
            // 将 URL 转为服务器本地绝对路径
            const relativePath = fileUrl.startsWith('/') ? fileUrl.slice(1) : fileUrl;
            const absPath = path.join(__ctx.__dirname, '..', 'public', relativePath.replace(/^\//, ''));
            // 尝试删除文件，不存在则忽略
            fs.unlink(absPath, (unlinkErr) => {
                if (unlinkErr && unlinkErr.code !== 'ENOENT') {
                    logger.warn('[material-quote] 删除文件失败: ' + absPath + ' - ' + unlinkErr.message);
                }
            });
        }
        await pool.query('DELETE FROM sys_order_recognitions WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/** DELETE /api/order-recognition/history  清空当前用户所有记录（同步删除所有上传文件） */
app.delete('/api/order-recognition/history', authenticateToken, async (req, res) => {
    try {
        const userId = await __ctx.getUserId(req);
        // 先查出所有文件路径
        const fileRows = await pool.query(
            'SELECT file_url FROM sys_order_recognitions WHERE user_id = $1 AND file_url IS NOT NULL',
            [userId]
        );
        // 批量删除物理文件
        fileRows.rows.forEach(row => {
            if (row.file_url) {
                const relativePath = row.file_url.startsWith('/') ? row.file_url.slice(1) : row.file_url;
                const absPath = path.join(__ctx.__dirname, '..', 'public', relativePath.replace(/^\//, ''));
                fs.unlink(absPath, (unlinkErr) => {
                    if (unlinkErr && unlinkErr.code !== 'ENOENT') {
                        logger.warn('[material-quote] 批量删除文件失败: ' + absPath + ' - ' + unlinkErr.message);
                    }
                });
            }
        });
        await pool.query('DELETE FROM sys_order_recognitions WHERE user_id = $1', [userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/** POST /api/order-recognition/analyze  物料报价与风控核算分析 */
app.post('/api/order-recognition/analyze', authenticateToken, async (req, res) => {
    try {
        const { customerName, baseCopperPrice, items } = req.body;
        if (!customerName || !items || !Array.isArray(items)) {
            return res.status(400).json({ success: false, error: '缺少必要参数 customerName 或 items' });
        }
        const enrichedItems = await analyzeMaterialQuote(pool, {
            customerName,
            baseCopperPrice: parseFloat(baseCopperPrice) || 73.4,
            items
        });
        res.json({ success: true, items: enrichedItems });
    } catch (err) {
        logger.error('[material-quote] Analyze error: ' + err.message);
        res.status(500).json({ success: false, error: err.message });
    }
})
}

export function segOrderRecognition2(app, __ctx) {
app.get('/api/order-recognition/copper-price', authenticateToken, async (req, res) => {
    try {
        if (fs.existsSync(__ctx.COPPER_PRICE_CACHE_PATH)) {
            const data = fs.readFileSync(__ctx.COPPER_PRICE_CACHE_PATH, 'utf-8');
            res.json({ success: true, data: JSON.parse(data) });
        } else {
            res.json({ success: true, data: { price: null, fetched_at: null } });
        }
    } catch (err) {
        logger.error('[order-recognition] copper-price get error: ' + err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/** POST /api/order-recognition/copper-price/update  执行脚本获取最新铜价并缓存 */
app.post('/api/order-recognition/copper-price/update', authenticateToken, async (req, res) => {
    try {
        const { spawn } = await import('child_process');
        const scriptPath = path.join(__ctx.__dirname, '../scripts/copper_price/sme_copper_price.py');
        const pyProcess = spawn('python', [scriptPath], {
            env: { ...process.env, PYTHONIOENCODING: 'utf8' }
        });
        
        let resultData = '';
        
        pyProcess.stdout.on('data', (data) => {
            resultData += data.toString();
        });
        
        pyProcess.on('close', (code) => {
            if (code === 0) {
                try {
                    const parsed = JSON.parse(resultData);
                    fs.writeFileSync(__ctx.COPPER_PRICE_CACHE_PATH, JSON.stringify(parsed, null, 2), 'utf-8');
                    res.json({ success: true, data: parsed });
                } catch (e) {
                    res.status(500).json({ success: false, error: '解析铜价数据失败' });
                }
            } else {
                res.status(500).json({ success: false, error: '执行获取铜价脚本失败' });
            }
        });
    } catch (err) {
        logger.error('[order-recognition] copper-price update error: ' + err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/** GET /api/order-recognition/search-material  模糊搜索ERP物料库 */
app.get('/api/order-recognition/search-material', authenticateToken, async (req, res) => {
    try {
        const q = (req.query.q || '').toString().trim();
        if (!q) return res.json({ success: true, items: [] });

        const keywords = q.split(/\s+/).filter(k => k);
        let whereClauses = [];
        let params = [];
        let paramIndex = 1;

        for (const kw of keywords) {
            whereClauses.push(`(itemno ILIKE $${paramIndex} OR itemname ILIKE $${paramIndex} OR descript ILIKE $${paramIndex})`);
            params.push(`%${kw}%`);
            paramIndex++;
        }

        const result = await pool.query(
            `SELECT itemno, itemname, descript
             FROM t_jy_material
             WHERE ${whereClauses.join(' AND ')}
             ORDER BY
               CASE WHEN itemno ILIKE $1 THEN 0
                    WHEN itemname ILIKE $1 THEN 1
                    ELSE 2 END,
               itemname, descript
             LIMIT 50`,
            params
        );
        res.json({ success: true, items: result.rows });
    } catch (err) {
        logger.error('[order-recognition] search-material error: ' + err.message);
        res.status(500).json({ success: false, error: err.message });
    }
})
}
