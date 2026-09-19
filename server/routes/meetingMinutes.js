/**
 * meetingMinutes 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import fs from 'fs';
import path from 'path';
import { logger } from '../infra/logger.js';
import { authenticateToken } from '../infra/auth.js';
import pool from '../db.js';

export function segMeetingMinutes1(app, __ctx) {
app.post('/api/meeting-minutes/export', authenticateToken, async (req, res) => {
    const { minutes, filename } = req.body;
    const apiKey = process.env.DIFY_MEETING_MINUTES_EXPORT_API_KEY;
    const apiUrl = process.env.DIFY_MEETING_MINUTES_EXPORT_API_URL;

    if (!minutes) return res.status(400).json({ error: '纪要内容不能为空' });
    if (!apiKey || apiKey === 'app-xxxx') {
        return res.json({ success: false, message: '系统未配置导出 API Key，请联系管理员。' });
    }

    try {
        logger.info(`[Dify Export] 正在请求导出，文件名: ${filename}`);

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: { filename: filename || '会议纪要.docx' },
                query: minutes,
                response_mode: 'blocking',
                user: req.user?.username || 'system-user'
            })
        });

        const data = await response.json();

        if (!response.ok) {
            logger.error(`[Dify Export Error] Status: ${response.status}, Data: ${JSON.stringify(data)}`);
            throw new Error(data.message || '导出请求失败');
        }

        // 解析返回结构
        let downloadUrl = '';
        if (data.files && data.files.length > 0) {
            // 优先从 files 数组获取
            downloadUrl = data.files[0].url;
        } else if (data.answer) {
            // 尝试从 answer 的 Markdown 链接中提取 [name](url)
            const match = data.answer.match(/\[.*?\]\((.*?)\)/);
            if (match) downloadUrl = match[1];
        }

        if (!downloadUrl) {
            logger.error(`[Dify Export Error] 未找到下载链接，响应数据: ${JSON.stringify(data)}`);
            throw new Error('未获取到有效的下载链接');
        }

        res.json({ success: true, downloadUrl, filename: filename || data.files?.[0]?.filename || '会议纪要.docx' });
    } catch (e) {
        logger.error('[Dify Export Exception] ' + e.message);
        res.status(500).json({ error: e.message });
    }
});

// --- 下载代理 [NEW] ---
// 解决跨域导致 download 属性失效，无法重命名文件的问题
app.get('/api/meeting-minutes/download-proxy', authenticateToken, async (req, res) => {
    const { url, filename } = req.query;
    if (!url) return res.status(400).end();

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('无法从 Dify 获取文件');

        // 设置强制下载头
        const encodedName = encodeURIComponent(filename || '会议纪要.docx').replace(/['()]/g, escape).replace(/\*/g, '%2A');
        res.setHeader('Content-Type', response.headers.get('Content-Type') || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);

        // 使用管道流式传输
        const reader = response.body.getReader();
        const sendChunk = async () => {
            const { done, value } = await reader.read();
            if (done) {
                res.end();
                return;
            }
            res.write(value);
            await sendChunk();
        };
        await sendChunk();
    } catch (e) {
        logger.error('[Download Proxy Error] ' + e.message);
        res.status(500).send('下载失败');
    }
});

// --- 会议纪要历史管理 [NEW] ---

// 1. 获取历史记录
app.get('/api/meeting-minutes/history', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, filename, original_text as "originalText", minutes_text as "minutes", TO_CHAR(created_at AT TIME ZONE \'UTC\' AT TIME ZONE \'PRC\', \'YYYY-MM-DD HH24:MI:SS\') as "time" FROM sys_meeting_minutes WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json({ success: true, history: result.rows });
    } catch (e) {
        logger.error('[History Get Error] ' + e.message);
        res.status(500).json({ error: e.message });
    }
});

// 2. 保存纪要记录
app.post('/api/meeting-minutes/history/save', authenticateToken, async (req, res) => {
    const { id, filename, originalText, minutes } = req.body;
    try {
        await pool.query(
            'INSERT INTO sys_meeting_minutes (id, user_id, filename, original_text, minutes_text) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET original_text = EXCLUDED.original_text, minutes_text = EXCLUDED.minutes_text',
            [id, req.user.id, filename, originalText, minutes]
        );
        res.json({ success: true });
    } catch (e) {
        logger.error('[History Save Error] ' + e.message);
        res.status(500).json({ error: e.message });
    }
});

// 3. 删除记录（同步删除对应录音文件）
app.delete('/api/meeting-minutes/history/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        // 先查出文件名
        const fileRow = await pool.query(
            'SELECT filename FROM sys_meeting_minutes WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        if (fileRow.rows.length > 0 && fileRow.rows[0].filename) {
            const filename = fileRow.rows[0].filename;
            const absPath = path.join(__ctx.__dirname, '../public', 'uploads', 'meeting-minutes', filename);
            fs.unlink(absPath, (unlinkErr) => {
                if (unlinkErr && unlinkErr.code !== 'ENOENT') {
                    logger.warn('[meeting-minutes] 删除录音文件失败: ' + absPath + ' - ' + unlinkErr.message);
                }
            });
        }
        await pool.query(
            'DELETE FROM sys_meeting_minutes WHERE id = $1 AND user_id = $2',
            [id, req.user.id]
        );
        res.json({ success: true });
    } catch (e) {
        logger.error('[History Delete Error] ' + e.message);
        res.status(500).json({ error: e.message });
    }
})
}
