import express from 'express';
import pool from './db.js';

const router = express.Router();

// ─── 鉴权中间件：仅管理员可操作 ───────────────────────────────────────────────
const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin') {
        return res.status(403).json({ success: false, message: '权限不足：仅限管理员进入配置中心' });
    }
    next();
};

// ─── 审计日志工具函数 ──────────────────────────────────────────────────────────
const writeAuditLog = async (req, action, targetData, details) => {
    try {
        await pool.query(
            `INSERT INTO sys_audit_logs
             (user_id, username, module, action, target_data, details, status, ip_address, user_agent)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
                req.user?.id    || null,
                req.user?.username || 'unknown',
                'SYSTEM_CONFIG',
                action,
                targetData,
                JSON.stringify(details),
                'SUCCESS',
                req.ip || req.socket?.remoteAddress || 'unknown',
                req.headers['user-agent'] || ''
            ]
        );
    } catch (e) {
        // 审计日志写入失败不影响主流程，仅记录到控制台
        console.error('[AuditLog] Write failed:', e.message);
    }
};

// ─── 聚合类配置表映射 ─────────────────────────────────────────────────────────
const AGG_TABLE_MAP = {
    'mkt_lang':   'ref_languages',
    'mkt_plat':   'ref_platforms',
    'mkt_style':  'ref_marketing_styles',
    'mkt_market': 'ref_target_markets',
    'brnd_market':'ref_target_markets',
    'brnd_feat':  'ref_pain_point_tags',
    'brnd_cert':  'ref_certifications'
};

// 简单字段表映射
const TABLE_MAP = {
    'ai_fields':     { table: 'ref_ai_scene_fields', column: 'options' },
    'news_keywords': { table: 'ref_news_keywords',   column: 'keyword' }
};

// ─── GET /config/health — 真实数据库连通检测 ─────────────────────────────────
router.get('/config/health', requireAdmin, async (req, res) => {
    const start = Date.now();
    try {
        await pool.query('SELECT 1');
        res.json({ success: true, latencyMs: Date.now() - start });
    } catch (err) {
        res.status(503).json({ success: false, message: '数据库连接异常' });
    }
});

// ─── PATCH /config/news_keywords/:id/toggle — is_active 启用/停用 ────────────
router.patch('/config/news_keywords/:id/toggle', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            'UPDATE ref_news_keywords SET is_active = NOT is_active WHERE id = $1 RETURNING id, is_active',
            [id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: '关键词分组不存在' });
        }
        const newStatus = result.rows[0].is_active;
        await writeAuditLog(req, 'UPDATE_CONFIG', `news_keywords/${id}`, {
            action: newStatus ? 'activate_group' : 'deactivate_group',
            is_active: newStatus
        });
        res.json({ success: true, is_active: newStatus });
    } catch (err) {
        console.error('Toggle is_active error:', err);
        res.status(500).json({ success: false, message: '切换状态失败' });
    }
});

// ─── PUT /config/:type/:id — 通用配置更新（含审计日志） ──────────────────────
router.put('/config/:type/:id', requireAdmin, async (req, res) => {
    const { type, id } = req.params;

    // ── marketing / beautyrnd 聚合类更新 ──
    if (type === 'marketing' || type === 'beautyrnd') {
        const tableName = AGG_TABLE_MAP[id];
        if (!tableName) return res.status(400).json({ success: false, message: '无效的配置ID' });

        const { name: newItems } = req.body;
        if (!Array.isArray(newItems)) return res.status(400).json({ success: false, message: '数据格式错误' });

        const moduleName = type === 'marketing' ? 'sea_marketing' : 'beauty_rnd';

        try {
            await pool.query('BEGIN');

            // 查询旧值用于审计日志 diff
            let oldItems = [];
            if (tableName === 'ref_target_markets') {
                const oldResult = await pool.query(
                    `SELECT name FROM ${tableName} WHERE module = $1 ORDER BY id ASC`,
                    [moduleName]
                );
                oldItems = oldResult.rows.map(r => (Array.isArray(r.name) ? r.name[0] : r.name) || '').filter(Boolean);
            } else {
                const oldResult = await pool.query(`SELECT name FROM ${tableName} ORDER BY id ASC`);
                oldItems = oldResult.rows.map(r => (Array.isArray(r.name) ? r.name[0] : r.name) || '').filter(Boolean);
            }

            // 全量替换
            if (tableName === 'ref_target_markets') {
                await pool.query(`DELETE FROM ${tableName} WHERE module = $1`, [moduleName]);
                for (const item of newItems) {
                    await pool.query(`INSERT INTO ${tableName} (name, module) VALUES ($1, $2)`, [item, moduleName]);
                }
            } else {
                await pool.query(`DELETE FROM ${tableName}`);
                for (const item of newItems) {
                    await pool.query(`INSERT INTO ${tableName} (name) VALUES ($1::jsonb)`, [JSON.stringify([item])]);
                }
            }

            await pool.query('COMMIT');

            await writeAuditLog(req, 'UPDATE_CONFIG', `${type}/${id}`, {
                before: oldItems,
                after: newItems
            });

            return res.json({ success: true, message: '配置已同步' });
        } catch (err) {
            await pool.query('ROLLBACK');
            console.error('Sync error:', err);
            return res.status(500).json({ success: false, message: '同步数据库失败' });
        }
    }

    // ── ai_fields / news_keywords 简单字段更新 ──
    const config = TABLE_MAP[type];
    if (!config) return res.status(400).json({ success: false, message: '未定义的配置类型' });

    const payloadKey = type === 'ai_fields' ? 'options' : 'keyword';
    const newVal = req.body[payloadKey];
    if (!Array.isArray(newVal)) return res.status(400).json({ success: false, message: '数据必须是 JSON 数组' });

    try {
        // 先查旧值，用于审计日志 before/after diff
        const oldResult = await pool.query(
            `SELECT ${config.column} FROM ${config.table} WHERE id = $1`,
            [id]
        );
        const oldVal = oldResult.rows[0]?.[config.column] || [];

        await pool.query(
            `UPDATE ${config.table} SET ${config.column} = $1::jsonb WHERE id = $2`,
            [JSON.stringify(newVal), id]
        );

        await writeAuditLog(req, 'UPDATE_CONFIG', `${type}/${id}`, {
            before: oldVal,
            after: newVal
        });

        res.json({ success: true, message: '配置已更新' });
    } catch (err) {
        console.error(`更新 ${type} 失败:`, err);
        res.status(500).json({ success: false, message: '数据库更新失败' });
    }
});

// ─── GET /config/marketing ────────────────────────────────────────────────────
router.get('/config/marketing', requireAdmin, async (req, res) => {
    try {
        const [lang, plat, style, market] = await Promise.all([
            pool.query('SELECT name FROM ref_languages ORDER BY id ASC'),
            pool.query('SELECT name FROM ref_platforms ORDER BY id ASC'),
            pool.query('SELECT name FROM ref_marketing_styles ORDER BY id ASC'),
            pool.query("SELECT name FROM ref_target_markets WHERE module = 'sea_marketing' ORDER BY id ASC")
        ]);
        res.json({
            success: true,
            data: [
                {
                    id: 'mkt_lang', label: '目标语种',
                    name: lang.rows.map(r => (Array.isArray(r.name) ? r.name[0] : r.name) || '').filter(Boolean),
                    description: '控制出海营销报告支持的输出语言列表'
                },
                {
                    id: 'mkt_plat', label: '目标平台',
                    name: plat.rows.map(r => (Array.isArray(r.name) ? r.name[0] : r.name) || '').filter(Boolean),
                    description: '控制可选择的跨境电商平台范围（如亚马逊、Lazada）'
                },
                {
                    id: 'mkt_style', label: '营销风格',
                    name: style.rows.map(r => (Array.isArray(r.name) ? r.name[0] : r.name) || '').filter(Boolean),
                    description: '控制 AI 生成营销文案时的可选风格类型'
                },
                {
                    id: 'mkt_market', label: '目标市场',
                    name: market.rows.map(r => (Array.isArray(r.name) ? r.name[0] : r.name) || '').filter(Boolean),
                    description: '控制营销模块中可选择的目标市场国家/地区'
                }
            ]
        });
    } catch (err) {
        console.error('Marketing config load error:', err);
        res.status(500).json({ success: false, message: '加载出海参数失败' });
    }
});

// ─── GET /config/beautyrnd ────────────────────────────────────────────────────
router.get('/config/beautyrnd', requireAdmin, async (req, res) => {
    try {
        const [market, feat, cert] = await Promise.all([
            pool.query("SELECT name FROM ref_target_markets WHERE module = 'beauty_rnd' ORDER BY id ASC"),
            pool.query('SELECT name FROM ref_pain_point_tags ORDER BY id ASC'),
            pool.query('SELECT name FROM ref_certifications ORDER BY id ASC')
        ]);
        res.json({
            success: true,
            data: [
                {
                    id: 'brnd_market', label: '目标市场',
                    name: market.rows.map(r => (Array.isArray(r.name) ? r.name[0] : r.name) || '').filter(Boolean),
                    description: '控制研发报告中目标市场的选项范围'
                },
                {
                    id: 'brnd_feat', label: '核心特点',
                    name: feat.rows.map(r => (Array.isArray(r.name) ? r.name[0] : r.name) || '').filter(Boolean),
                    description: '控制产品卖点标签库的可选内容'
                },
                {
                    id: 'brnd_cert', label: '强制认证需求',
                    name: cert.rows.map(r => (Array.isArray(r.name) ? r.name[0] : r.name) || '').filter(Boolean),
                    description: '控制认证需求的可选项（如 FDA、CE、SGS）'
                }
            ]
        });
    } catch (err) {
        console.error('BeautyRND config load error:', err);
        res.status(500).json({ success: false, message: '加载研发参数失败' });
    }
});

// ─── GET /config/news_keywords ────────────────────────────────────────────────
router.get('/config/news_keywords', requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM ref_news_keywords ORDER BY sort_order ASC, id ASC'
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: '加载词库失败' });
    }
});

export default router;
