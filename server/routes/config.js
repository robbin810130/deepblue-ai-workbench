/**
 * config 域路由（XO-01 server.js 拆解 · codemod 迁出）
 * 依赖经 __ctx 注入（getter 惰性取值）；segment 保持原注册位置，express 顺序零变化。
 */
import { logger } from '../infra/logger.js';
import { authenticateToken } from '../infra/auth.js';
import pool from '../db.js';

export function segConfig1(app, __ctx) {
app.get('/api/config/ai_scenes', authenticateToken, async (req, res) => {
    try {
        const scenesRes = await pool.query(
            `SELECT scene_id AS id, label, emoji, description AS desc 
             FROM ref_ai_scenes WHERE is_active = true ORDER BY sort_order, id`
        );
        const fieldsRes = await pool.query(
            `SELECT scene_id, field_id AS id, field_label AS label, options 
             FROM ref_ai_scene_fields WHERE is_active = true ORDER BY sort_order, id`
        );

        const scenes = scenesRes.rows.map(scene => {
            const fields = fieldsRes.rows
                .filter(f => f.scene_id === scene.id)
                .map(f => {
                    const splitOptions = Array.isArray(f.options)
                        ? f.options
                        : (f.options || '')
                            .split(/[\/、,，]+/)
                            .map(k => k.trim())
                            .filter(k => k !== '');
                    return {
                        id: f.id,
                        label: f.label,
                        options: splitOptions
                    };
                });
            return {
                id: scene.id,
                label: scene.label,
                emoji: scene.emoji,
                desc: scene.desc,
                fields: fields
            };
        });

        return res.json({ success: true, data: scenes });
    } catch (err) {
        logger.error('[PG] 读取AI场景配置失败', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/config/:type', authenticateToken, async (req, res) => {
    const { type } = req.params;
    const { module: moduleFilter } = req.query;

    const TABLE_MAP = {
        product_types: { table: 'ref_product_types', hasModule: true, hasIsActive: true },
        markets: { table: 'ref_target_markets', hasModule: true, hasIsActive: true },
        certifications: { table: 'ref_certifications', hasModule: false, hasIsActive: true },
        pain_points: { table: 'ref_pain_point_tags', hasModule: false, hasIsActive: false },
        languages: { table: 'ref_languages', hasModule: false, hasIsActive: true },
        platforms: { table: 'ref_platforms', hasModule: false, hasIsActive: true },
        marketing_styles: { table: 'ref_marketing_styles', hasModule: false, hasIsActive: false },
        news_keywords: { table: 'ref_news_keywords', hasModule: false, hasIsActive: true },
        global_config: { table: 'app_global_config', hasModule: false, hasIsActive: false },
    };

    const meta = TABLE_MAP[type];
    if (!meta) {
        return res.status(400).json({ success: false, message: `不支持的配置类型: ${type}` });
    }

    try {
        let query, params = [];

        if (meta.table === 'app_global_config') {
            query = `SELECT config_key, config_value, description FROM app_global_config ORDER BY config_key`;
        } else if (meta.table === 'ref_news_keywords') {
            query = `SELECT id, group_name, keyword, sort_order, creator FROM ref_news_keywords ORDER BY group_name, sort_order, id`;
        } else if (meta.hasModule && moduleFilter) {
            query = `SELECT * FROM ${meta.table} WHERE module = $1 ORDER BY sort_order, id`;
            params = [moduleFilter];
        } else {
            query = `SELECT * FROM ${meta.table} ORDER BY sort_order, id`;
        }

        const result = await pool.query(query, params);
        return res.json({ success: true, data: result.rows });
    } catch (err) {
        logger.error(`[PG] /api/config/${type} 查询失败`, err);
        return res.status(500).json({ success: false, message: '数据库查询失败', error: err.message });
    }
});

/** PUT /api/config/global_config/:key  单条更新全局配置 */
app.put('/api/config/global_config/:key', authenticateToken, async (req, res) => {
    const { key } = req.params;
    const { value, description } = req.body;
    try {
        await pool.query(
            `INSERT INTO app_global_config (config_key, config_value, description, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (config_key) DO UPDATE
               SET config_value = EXCLUDED.config_value,
                   description  = COALESCE(EXCLUDED.description, app_global_config.description),
                   updated_at   = NOW()`,
            [key, value, description || null]
        );
        return res.json({ success: true });
    } catch (err) {
        logger.error('[PG] 全局配置更新失败', err);
        return res.status(500).json({ success: false, message: err.message });
    }
})
}
