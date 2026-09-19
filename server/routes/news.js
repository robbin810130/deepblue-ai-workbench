/**
 * news 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import fs from 'fs';
import { authenticateToken } from '../infra/auth.js';
import { logAudit } from '../infra/audit.js';
import pool from '../db.js';
import * as legacyBridge from '../modules/tasks/legacyBridge.js';

export function segNews1(app, __ctx) {
app.post('/api/news/generate', async (req, res) => {
    try {
        const caller = req.user?.username || 'web_user';
        const industry = req.body.industry || '';
        logAudit(req, { module: 'DAILY_NEWS', action: 'GENERATE', details: { industry } });
        const result = await __ctx.generateDailyNews(caller, industry);
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 查询最新新闻状态
app.get('/api/news/latest', (req, res) => {
    res.json({
        lastUpdate: __ctx.lastNewsUpdateStatus.lastUpdate,
        status: __ctx.lastNewsUpdateStatus.status,
        isRunning: __ctx.lastNewsUpdateStatus.isRunning
    });
});

// 获取历史新闻列表
app.get('/api/news/history', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, report_date, industry, TO_CHAR(created_at + interval '8 hours', 'YYYY-MM-DD HH24:MI:SS') as created_at FROM app_news_history ORDER BY id DESC LIMIT 50"
        );
        res.json({ success: true, data: result.rows });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 获取历史新闻详情
app.get('/api/news/history/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM app_news_history WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: '未找到该记录' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 删除单条历史记录
app.delete('/api/news/history/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM app_news_history WHERE id = $1', [id]);
        res.json({ success: true, message: '删除成功' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 清空历史记录
app.delete('/api/news/history', async (req, res) => {
    try {
        await pool.query('DELETE FROM app_news_history');
        res.json({ success: true, message: '所有历史记录已清空' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 添加自定义关键词 (聚合逻辑：同用户同分类存放在一行)
app.post('/api/news/keywords', authenticateToken, async (req, res) => {
    try {
        const { group_name, keyword } = req.body;
        const creator = req.user?.username || 'web_user';
        if (!group_name || !keyword) return res.status(400).json({ success: false, message: '缺失参数' });

        // 检查是否存在
        const check = await pool.query(
            'SELECT id, group_name, keyword, creator FROM ref_news_keywords WHERE group_name = $1 AND creator = $2 LIMIT 1',
            [group_name, creator]
        );

        if (check.rows.length > 0) {
            const row = check.rows[0];
            let list = Array.isArray(row.keyword) ? row.keyword : [row.keyword];
            if (!list.includes(keyword)) {
                list.push(keyword);
                await pool.query(
                    'UPDATE ref_news_keywords SET keyword = $1::jsonb WHERE id = $2',
                    [JSON.stringify(list), row.id]
                );
            }
            res.json({ success: true, data: { ...row, group_name: row.group_name || group_name, keyword: list, creator: row.creator } });
        } else {
            const result = await pool.query(
                'INSERT INTO ref_news_keywords (group_name, keyword, creator, sort_order) VALUES ($1, $2::jsonb, $3, 999) RETURNING *',
                [group_name, JSON.stringify([keyword]), creator]
            );
            res.json({ success: true, data: result.rows[0] });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 删除自定义关键词 (聚合逻辑：从数组中移除)
app.delete('/api/news/keywords/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { keyword } = req.query;
        const currentUser = req.user?.username || 'web_user';

        const check = await pool.query('SELECT creator, keyword FROM ref_news_keywords WHERE id = $1', [id]);
        if (check.rows.length === 0) return res.status(404).json({ success: false, message: '未找到该关键词' });

        const record = check.rows[0];
        if (!record.creator || record.creator !== currentUser) {
            return res.status(403).json({ success: false, message: '权限不足：无法删除他人添加的关键词' });
        }

        let list = Array.isArray(record.keyword) ? record.keyword : [record.keyword];
        if (keyword) {
            list = list.filter(k => k !== keyword);
            if (list.length > 0) {
                await pool.query('UPDATE ref_news_keywords SET keyword = $1::jsonb WHERE id = $2', [JSON.stringify(list), id]);
                return res.json({ success: true, message: '已移除词条' });
            }
        }
        await pool.query('DELETE FROM ref_news_keywords WHERE id = $1', [id]);
        res.json({ success: true, message: '已删除关键词记录' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

/* 
// 备注：以下旧版文件存储接口已弃用，统一迁移至下方 PostgreSQL 存储版本
// 获取每日推送偏好
app.get('/api/news/preferences', (req, res) => {
    res.json(getNewsPrefs());
});

// 保存每日推送偏好
app.post('/api/news/preferences', (req, res) => {
    try {
        const { defaultIndustry, countLimit, pushTime } = req.body;
        const newPrefs = {
            defaultIndustry: defaultIndustry || 'AI、人工智能、大模型',
            countLimit: countLimit || 12,
            pushTime: pushTime || '08:30'
        };
        fs.writeFileSync(NEWS_PREFS_PATH, JSON.stringify(newPrefs, null, 2), 'utf-8');
        console.log('[Prefs] 更新成功:', newPrefs);
        res.json({ success: true, data: newPrefs });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});
*/

// 新闻深度解析 API
app.post('/api/news/analyze', async (req, res) => {
    try {
        const caller = req.user?.username || 'web_user';
        const query = req.body.query || '';
        const newsContext = req.body.newsContext || [];
        logAudit(req, { module: 'DAILY_NEWS', action: 'ANALYZE', details: { query } });

        const apiKey = process.env.DIFY_NEWS_ANALYZE_API_KEY || process.env.DIFY_NEWS_API_KEY;
        const apiUrl = process.env.DIFY_NEWS_ANALYZE_API_URL || `${process.env.DIFY_NEWS_API_URL}/chat-messages`;

        // 将当天新闻拼接为字符串供模型参考
        const contextStr = newsContext.map((n, i) => `【${i + 1}】${n.title} (来源: ${n.source || '未知'})`).join('\n\n');

        // ── D4 试点迁移（TASK_CENTER_PILOT 含 daily_news 时启用）──────────
        if (legacyBridge.isPilotSkill('daily_news')) {
            try {
                const r = await legacyBridge.runThroughTaskCenter({
                    skillKey: 'daily_news',
                    title: `新闻解析：${String(query || '').slice(0, 24)}`,
                    user: req.user?.id ? req.user : { id: 0, username: 'news_anonymous', role: 'user' },
                    inputs: { query: query, news_context: contextStr },
                });
                if (!r.ok) {
                    console.error(`[新闻解析-任务中心] ${r.taskNo} 失败 ${r.errorCode}: ${r.message}`);
                    return res.status(500).json({ success: false, message: `任务执行失败（${r.taskNo}）：${r.message}` });
                }
                return res.json({ success: true, data: legacyBridge.stripThinkTags(legacyBridge.extractAnswer(r.outputs)) });
            } catch (e) {
                console.error('[新闻解析-任务中心] 异常:', e.message);
                return res.status(500).json({ success: false, message: e.message });
            }
        }

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: {
                    news_context: contextStr
                },
                query: query,
                response_mode: 'blocking',
                conversation_id: '',
                user: caller
            })
        });

        if (!response.ok) throw new Error(`Dify API 请求失败: ${await response.text()}`);

        const data = await response.json();

        // 提取返回的大文本 (兼容 Chatflow 的 answer 和旧版 Workflow 的 outputs)
        let resultText = '';
        if (data && data.answer) {
            resultText = data.answer;
        } else if (data && data.data && data.data.outputs) {
            const outputs = data.data.outputs;
            const firstOutputVal = Object.values(outputs)[0];
            if (typeof firstOutputVal === 'string') {
                resultText = firstOutputVal;
            } else if (typeof firstOutputVal === 'object') {
                resultText = JSON.stringify(firstOutputVal, null, 2);
            } else {
                resultText = String(firstOutputVal);
            }
        }
        res.json({ success: true, data: resultText || '(AI未返回有效的解析文本内容)' });
    } catch (e) {
        console.error('[新闻解析错误]', e);
        res.status(500).json({ success: false, message: e.message });
    }
})
}

export function segNews2(app, __ctx) {
app.get('/api/news/preferences', authenticateToken, (req, res) => {
    res.json(__ctx.getNewsPrefs());
});

/** POST /api/news/preferences  保存推送偏好 */
app.post('/api/news/preferences', authenticateToken, (req, res) => {
    try {
        const { defaultIndustry, countLimit, pushTime } = req.body;
        const newPrefs = {
            defaultIndustry: defaultIndustry || 'AI、人工智能、大模型',
            countLimit: countLimit || 12,
            pushTime: pushTime || '08:30'
        };
        fs.writeFileSync(__ctx.NEWS_PREFS_PATH, JSON.stringify(newPrefs, null, 2), 'utf-8');
        console.log('[Prefs] 更新成功(JSON):', newPrefs);
        res.json({ success: true, data: newPrefs });
    } catch (e) {
        console.error('[Prefs] 保存失败:', e);
        res.status(500).json({ success: false, message: e.message });
    }
})
}
