// ============================================================
// server/enterpriseQualificationRoutes.js — 企业资质库模块路由
// ============================================================
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import pool from './db.js';
import { encrypt, decrypt, computeChecksum } from './utils/encryptionUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function validateId(id) {
    const num = Number(id);
    return Number.isInteger(num) && num > 0 ? num : null;
}

// 修复 multer/busboy 默认 latin1 解码导致的中文文件名乱码
const fixFileName = (name) => {
    if (!name || typeof name !== 'string') return name;
    if (/[\u00C0-\u00FF]/.test(name)) {
        const restored = Buffer.from(name, 'latin1').toString('utf8');
        if (!restored.includes('\uFFFD')) return restored;
    }
    return name;
};

const router = express.Router();

// ==================== 文件上传配置 ====================
const eqStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '../uploads/enterprise-qualification');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `eq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    }
});
const eqUpload = multer({
    storage: eqStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.bmp', '.gif',
                         '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
                         '.txt', '.zip', '.rar'];
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, allowed.includes(ext));
    }
});

// 凭证解密专用限流：每人每分钟 5 次
const decryptLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    keyGenerator: (req) => {
        if (req.user?.id) return `user:${req.user.id}`;
        // 通过 headers 获取 IP，避免触发 express-rate-limit 的 IPv6 验证
        const forwarded = req.headers['x-forwarded-for'];
        const clientIp = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim()) || req.socket?.remoteAddress || '';
        return `ip:${clientIp}`;
    },
    message: { code: 429, message: '解密操作过于频繁，请稍后再试' }
});

// ============================================================
// ■ 字典接口
// ============================================================

// GET /dict — 查询字典列表
router.get('/dict', async (req, res) => {
    try {
        const { dict_type, parent_id } = req.query;
        let sql = 'SELECT * FROM eq_dict WHERE 1=1';
        const params = [];
        if (dict_type) { params.push(dict_type); sql += ` AND dict_type = $${params.length}`; }
        if (parent_id) { params.push(validateId(parent_id)); sql += ` AND parent_id = $${params.length}`; }
        sql += ' ORDER BY sort_order ASC, id ASC';
        const result = await pool.query(sql, params);
        res.json({ code: 0, data: result.rows });
    } catch (error) {
        console.error('[企业资质库] 查询字典失败:', error);
        res.status(500).json({ code: 500, message: '查询失败', error: error.message });
    }
});

// POST /dict — 新增字典项
router.post('/dict', async (req, res) => {
    try {
        const { dict_type, parent_id, name, sort_order = 0, is_enabled = true } = req.body;
        if (!dict_type || !name?.trim()) {
            return res.status(400).json({ code: 400, message: '字典类型和名称不能为空' });
        }
        const pid = parent_id ? validateId(parent_id) : null;
        const result = await pool.query(
            `INSERT INTO eq_dict (dict_type, parent_id, name, sort_order, is_enabled)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [dict_type, pid, name.trim(), sort_order, is_enabled]
        );
        // 写审计日志
        logAuditSafe(req, { module: 'enterprise_qualification', action: 'dict_create', target_data: result.rows[0] });
        res.json({ code: 0, data: result.rows[0], message: '创建成功' });
    } catch (error) {
        console.error('[企业资质库] 新增字典失败:', error);
        res.status(500).json({ code: 500, message: '新增失败', error: error.message });
    }
});

// DELETE /dict/:id — 删除字典项
router.delete('/dict/:id', async (req, res) => {
    let client;
    try {
        const idNum = validateId(req.params.id);
        if (!idNum) return res.status(400).json({ code: 400, message: '无效的字典ID' });

        client = await pool.connect();
        await client.query('BEGIN');

        // 查询字典项信息
        const dictResult = await client.query('SELECT * FROM eq_dict WHERE id = $1', [idNum]);
        if (dictResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ code: 404, message: '字典项不存在' });
        }
        const dictItem = dictResult.rows[0];

        // 检查是否有关联资产
        let assetCheckCol = null;
        if (dictItem.dict_type === 'entity') assetCheckCol = 'entity_id';
        else if (dictItem.dict_type === 'category_l1') assetCheckCol = 'category_l1_id';
        else if (dictItem.dict_type === 'category_l2') assetCheckCol = 'category_l2_id';

        if (assetCheckCol) {
            const assetCount = await client.query(
                `SELECT COUNT(*) FROM eq_asset WHERE ${assetCheckCol} = $1`, [idNum]
            );
            if (parseInt(assetCount.rows[0].count) > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ code: 400, message: `该字典项下有关联资产，无法删除` });
            }
        }

        // 如果是一级分类，检查是否有子二级分类
        if (dictItem.dict_type === 'category_l1') {
            const childCount = await client.query(
                'SELECT COUNT(*) FROM eq_dict WHERE dict_type = $1 AND parent_id = $2',
                ['category_l2', idNum]
            );
            if (parseInt(childCount.rows[0].count) > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ code: 400, message: '该一级分类下有子分类，请先删除子分类' });
            }
        }

        await client.query('DELETE FROM eq_dict WHERE id = $1', [idNum]);
        await client.query('COMMIT');

        logAuditSafe(req, { module: 'enterprise_qualification', action: 'dict_delete', target_data: dictItem });
        res.json({ code: 0, message: '删除成功' });
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('[企业资质库] 删除字典失败:', error);
        res.status(500).json({ code: 500, message: '删除失败', error: error.message });
    } finally {
        if (client) client.release();
    }
});

// ============================================================
// ■ 资产接口
// ============================================================

// GET /asset — 分页查询资产列表
router.get('/asset', async (req, res) => {
    try {
        const { keyword, entity_id, category_l1_id, category_l2_id, status, owner, expiry_within,
                page = 1, pageSize = 20, user_department, user_entity, user_sensitivity } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const sizeNum = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
        const offset = (pageNum - 1) * sizeNum;

        const conditions = [];
        const params = [];

        if (keyword?.trim()) {
            params.push(`%${keyword.trim()}%`);
            conditions.push(`(a.asset_name ILIKE $${params.length} OR a.owner ILIKE $${params.length})`);
        }
        if (entity_id) {
            const ids = String(entity_id).split(',').map(id => validateId(id.trim())).filter(Boolean);
            if (ids.length === 1) { params.push(ids[0]); conditions.push(`a.entity_id = $${params.length}`); }
            else if (ids.length > 1) { params.push(ids); conditions.push(`a.entity_id = ANY($${params.length}::int[])`); }
        }
        if (category_l1_id) {
            const ids = String(category_l1_id).split(',').map(id => validateId(id.trim())).filter(Boolean);
            if (ids.length === 1) { params.push(ids[0]); conditions.push(`a.category_l1_id = $${params.length}`); }
            else if (ids.length > 1) { params.push(ids); conditions.push(`a.category_l1_id = ANY($${params.length}::int[])`); }
        }
        if (category_l2_id) { params.push(validateId(category_l2_id)); conditions.push(`a.category_l2_id = $${params.length}`); }
        if (status) {
            const vals = String(status).split(',').map(s => s.trim()).filter(Boolean);
            if (vals.length === 1) { params.push(vals[0]); conditions.push(`a.status = $${params.length}`); }
            else if (vals.length > 1) { params.push(vals); conditions.push(`a.status = ANY($${params.length}::text[])`); }
        }
        if (owner) {
            const vals = String(owner).split(',').map(s => s.trim()).filter(Boolean);
            if (vals.length === 1) { params.push(vals[0]); conditions.push(`a.owner = $${params.length}`); }
            else if (vals.length > 1) { params.push(vals); conditions.push(`a.owner = ANY($${params.length}::text[])`); }
        }
        if (expiry_within) {
            const parts = String(expiry_within).split(',').map(s => s.trim()).filter(Boolean);
            const hasExpired = parts.includes('expired');
            const dayParts = parts.filter(p => p !== 'expired').map(p => parseInt(p, 10)).filter(n => n > 0);
            const maxDays = dayParts.length > 0 ? Math.max(...dayParts) : null;
            if (hasExpired && maxDays) {
                params.push(maxDays);
                conditions.push(`a.expiry_date IS NOT NULL AND a.expiry_date <= CURRENT_DATE + ($${params.length})::integer`);
            } else if (hasExpired) {
                conditions.push(`a.expiry_date IS NOT NULL AND a.expiry_date < CURRENT_DATE`);
            } else if (maxDays) {
                params.push(maxDays);
                conditions.push(`a.expiry_date IS NOT NULL AND a.expiry_date >= CURRENT_DATE AND a.expiry_date <= CURRENT_DATE + ($${params.length})::integer`);
            }
        }

        // 权限过滤
        if (user_department) {
            params.push(user_department);
            conditions.push(`$${params.length} = ANY(a.visible_departments)`);
        }
        if (user_entity) {
            params.push(user_entity);
            conditions.push(`a.entity_id::TEXT = $${params.length}`);
        }
        if (user_sensitivity) {
            params.push(user_sensitivity);
            conditions.push(`a.sensitivity = $${params.length}`);
        }

        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        const countResult = await pool.query(`SELECT COUNT(*) FROM eq_asset a ${whereClause}`, params);
        const total = parseInt(countResult.rows[0].count, 10);

        const dataParams = [...params, sizeNum, offset];
        const dataResult = await pool.query(
            `SELECT a.*, 
                    d1.name AS entity_name, d2.name AS category_l1_name, d3.name AS category_l2_name
             FROM eq_asset a
             LEFT JOIN eq_dict d1 ON a.entity_id = d1.id
             LEFT JOIN eq_dict d2 ON a.category_l1_id = d2.id
             LEFT JOIN eq_dict d3 ON a.category_l2_id = d3.id
             ${whereClause}
             ORDER BY a.updated_at DESC NULLS LAST, a.id DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            dataParams
        );
        res.json({ code: 0, data: { list: dataResult.rows, total, page: pageNum, pageSize: sizeNum } });
    } catch (error) {
        console.error('[企业资质库] 查询资产列表失败:', error);
        res.status(500).json({ code: 500, message: '查询失败', error: error.message });
    }
});

// GET /asset/filter-counts — 筛选器计数（按 entity / category_l1 / status 分组）
router.get('/asset/filter-counts', async (req, res) => {
    try {
        const { keyword } = req.query;
        const conditions = [];
        const params = [];
        if (keyword?.trim()) {
            params.push(`%${keyword.trim()}%`);
            conditions.push(`(a.asset_name ILIKE $${params.length} OR a.owner ILIKE $${params.length})`);
        }
        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        const [entityR, l1R, statusR, expiryR, ownerR] = await Promise.all([
            pool.query(
                `SELECT a.entity_id AS id, COUNT(*)::int AS count FROM eq_asset a ${whereClause} GROUP BY a.entity_id`,
                params
            ),
            pool.query(
                `SELECT a.category_l1_id AS id, COUNT(*)::int AS count FROM eq_asset a ${whereClause} GROUP BY a.category_l1_id`,
                params
            ),
            pool.query(
                `SELECT a.status, COUNT(*)::int AS count FROM eq_asset a ${whereClause} GROUP BY a.status`,
                params
            ),
            pool.query(
                `SELECT
                    COUNT(*) FILTER (WHERE a.expiry_date IS NOT NULL AND a.expiry_date < CURRENT_DATE)::int AS expired,
                    COUNT(*) FILTER (WHERE a.expiry_date IS NOT NULL AND a.expiry_date >= CURRENT_DATE AND a.expiry_date <= CURRENT_DATE + 30)::int AS d30,
                    COUNT(*) FILTER (WHERE a.expiry_date IS NOT NULL AND a.expiry_date > CURRENT_DATE + 30 AND a.expiry_date <= CURRENT_DATE + 60)::int AS d60,
                    COUNT(*) FILTER (WHERE a.expiry_date IS NOT NULL AND a.expiry_date > CURRENT_DATE + 60 AND a.expiry_date <= CURRENT_DATE + 90)::int AS d90
                 FROM eq_asset a ${whereClause}`,
                params
            ),
            pool.query(
                `SELECT a.owner, COUNT(*)::int AS count FROM eq_asset a ${whereClause} WHERE a.owner IS NOT NULL AND a.owner != '' GROUP BY a.owner`,
                params
            ),
        ]);

        const er = expiryR.rows[0];
        res.json({
            code: 0,
            data: {
                entity: Object.fromEntries(entityR.rows.map(r => [Number(r.id), r.count])),
                categoryL1: Object.fromEntries(l1R.rows.map(r => [Number(r.id), r.count])),
                status: Object.fromEntries(statusR.rows.map(r => [r.status, r.count])),
                expiry: { expired: er.expired, d30: er.d30, d60: er.d60, d90: er.d90 },
                owner: Object.fromEntries(ownerR.rows.map(r => [r.owner, r.count])),
            },
        });
    } catch (error) {
        console.error('[企业资质库] 查询筛选计数失败:', error);
        res.status(500).json({ code: 500, message: '查询失败', error: error.message });
    }
});

// GET /asset/dashboard — 总览看板统计
router.get('/asset/dashboard', async (req, res) => {
    try {
        // 4 个指标卡
        const [totalR, pendingR, expiring30R, highSensR] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM eq_asset'),
            pool.query("SELECT COUNT(*) FROM eq_asset WHERE status = '待更新'"),
            pool.query("SELECT COUNT(*) FROM eq_asset WHERE expiry_date IS NOT NULL AND expiry_date <= NOW() + INTERVAL '30 days' AND expiry_date >= NOW()"),
            pool.query("SELECT COUNT(*) FROM eq_asset WHERE sensitivity = '高敏感'")
        ]);

        // 状态分布
        const statusDist = await pool.query(
            "SELECT status, COUNT(*) as count FROM eq_asset GROUP BY status ORDER BY count DESC"
        );

        // 主体分布
        const entityDist = await pool.query(
            `SELECT d.name, COUNT(a.id) as count FROM eq_asset a
             JOIN eq_dict d ON a.entity_id = d.id GROUP BY d.name ORDER BY count DESC`
        );

        // 未来 6 个月到期趋势（补全无到期月份为 0）
        const trend = await pool.query(
            `SELECT TO_CHAR(date_trunc('month', expiry_date), 'YYYY-MM') as month, COUNT(*) as count
             FROM eq_asset WHERE expiry_date IS NOT NULL
             AND expiry_date BETWEEN NOW() AND NOW() + INTERVAL '6 months'
             GROUP BY month ORDER BY month`
        );
        // 生成完整 6 个月列表，缺失月份补 0
        const trendMap = new Map(trend.rows.map(r => [r.month, Number(r.count)]));
        const fullTrend = [];
        const now = new Date();
        for (let i = 0; i < 6; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            fullTrend.push({ month: key, count: trendMap.get(key) || 0 });
        }

        // 60 天临期清单
        const expiring60 = await pool.query(
            `SELECT a.*, d1.name AS entity_name, d2.name AS category_l1_name
             FROM eq_asset a
             LEFT JOIN eq_dict d1 ON a.entity_id = d1.id
             LEFT JOIN eq_dict d2 ON a.category_l1_id = d2.id
             WHERE a.expiry_date IS NOT NULL AND a.expiry_date <= NOW() + INTERVAL '60 days' AND a.expiry_date >= NOW()
             ORDER BY a.expiry_date ASC`
        );

        res.json({
            code: 0,
            data: {
                total: parseInt(totalR.rows[0].count),
                pending: parseInt(pendingR.rows[0].count),
                expiring30: parseInt(expiring30R.rows[0].count),
                highSensCred: parseInt(highSensR.rows[0].count),
                statusDistribution: statusDist.rows,
                entityDistribution: entityDist.rows,
                expiryTrend: fullTrend,
                expiringList: expiring60.rows
            }
        });
    } catch (error) {
        console.error('[企业资质库] 看板统计失败:', error);
        res.status(500).json({ code: 500, message: '统计失败', error: error.message });
    }
});

// GET /asset/expiring — 到期清单查询
router.get('/asset/expiring', async (req, res) => {
    try {
        const { days = 60 } = req.query;
        const result = await pool.query(
            `SELECT a.*, d1.name AS entity_name, d2.name AS category_l1_name, d3.name AS category_l2_name
             FROM eq_asset a
             LEFT JOIN eq_dict d1 ON a.entity_id = d1.id
             LEFT JOIN eq_dict d2 ON a.category_l1_id = d2.id
             LEFT JOIN eq_dict d3 ON a.category_l2_id = d3.id
             WHERE a.expiry_date IS NOT NULL AND a.expiry_date <= NOW() + INTERVAL '${parseInt(days, 10) || 60} days'
             AND a.expiry_date >= NOW()
             ORDER BY a.expiry_date ASC`
        );
        res.json({ code: 0, data: result.rows });
    } catch (error) {
        console.error('[企业资质库] 到期清单查询失败:', error);
        res.status(500).json({ code: 500, message: '查询失败', error: error.message });
    }
});

// GET /asset/calendar — 到期日历数据
router.get('/asset/calendar', async (req, res) => {
    try {
        const { year, month } = req.query;
        const y = parseInt(year, 10) || new Date().getFullYear();
        const m = parseInt(month, 10) || new Date().getMonth() + 1;
        const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
        const endDate = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

        const result = await pool.query(
            `SELECT a.id, a.asset_name, TO_CHAR(a.expiry_date, 'YYYY-MM-DD') AS expiry_date,
                    a.status, a.sensitivity, a.owner,
                    d1.name AS entity_name
             FROM eq_asset a
             LEFT JOIN eq_dict d1 ON a.entity_id = d1.id
             WHERE a.expiry_date >= $1 AND a.expiry_date < $2
             ORDER BY a.expiry_date ASC`,
            [startDate, endDate]
        );
        res.json({ code: 0, data: result.rows });
    } catch (error) {
        console.error('[企业资质库] 日历查询失败:', error);
        res.status(500).json({ code: 500, message: '查询失败', error: error.message });
    }
});

// GET /asset/:id — 获取单条资产详情
router.get('/asset/:id', async (req, res) => {
    try {
        const idNum = validateId(req.params.id);
        if (!idNum) return res.status(400).json({ code: 400, message: '无效的资产ID' });

        const assetResult = await pool.query(
            `SELECT a.*, d1.name AS entity_name, d2.name AS category_l1_name, d3.name AS category_l2_name
             FROM eq_asset a
             LEFT JOIN eq_dict d1 ON a.entity_id = d1.id
             LEFT JOIN eq_dict d2 ON a.category_l1_id = d2.id
             LEFT JOIN eq_dict d3 ON a.category_l2_id = d3.id
             WHERE a.id = $1`,
            [idNum]
        );
        if (assetResult.rowCount === 0) return res.status(404).json({ code: 404, message: '资产不存在' });

        // 查附件
        const attachments = await pool.query(
            'SELECT * FROM eq_attachment WHERE asset_id = $1 ORDER BY sort_order, id', [idNum]
        );
        // 查凭证（不返回密文）
        const credentials = await pool.query(
            `SELECT id, asset_id, cred_type, algorithm, recovery_method, rotation_days, last_rotation, created_at
             FROM eq_credential WHERE asset_id = $1 ORDER BY id`, [idNum]
        );

        res.json({
            code: 0,
            data: { ...assetResult.rows[0], attachments: attachments.rows, credentials: credentials.rows }
        });
    } catch (error) {
        console.error('[企业资质库] 查询资产详情失败:', error);
        res.status(500).json({ code: 500, message: '查询失败', error: error.message });
    }
});

// POST /asset — 新增资产
router.post('/asset', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const {
            asset_name, entity_id, category_l1_id, category_l2_id, asset_no_masked,
            owner, effective_date, expiry_date, status, sensitivity,
            visible_departments, extra_fields, remark
        } = req.body;

        if (!asset_name?.trim()) {
            await client.query('ROLLBACK');
            return res.status(400).json({ code: 400, message: '资产名称不能为空' });
        }

        await client.query('BEGIN');

        const assetResult = await client.query(
            `INSERT INTO eq_asset (asset_name, entity_id, category_l1_id, category_l2_id,
                asset_no_masked, owner, effective_date, expiry_date, status, sensitivity,
                visible_departments, extra_fields, remark)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING *`,
            [
                asset_name.trim(), entity_id || null, category_l1_id || null, category_l2_id || null,
                asset_no_masked || null, owner || null, effective_date || null, expiry_date || null,
                status || '有效', sensitivity || '公开',
                visible_departments || [], JSON.stringify(extra_fields || {}),
                remark || null
            ]
        );
        const asset = assetResult.rows[0];

        await client.query('COMMIT');
        logAuditSafe(req, { module: 'enterprise_qualification', action: 'asset_create', target_data: asset });
        res.json({ code: 0, data: asset, message: '创建成功' });
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('[企业资质库] 新增资产失败:', error);
        res.status(500).json({ code: 500, message: '新增失败', error: error.message });
    } finally {
        if (client) client.release();
    }
});

// PUT /asset/:id — 更新资产
router.put('/asset/:id', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const idNum = validateId(req.params.id);
        if (!idNum) return res.status(400).json({ code: 400, message: '无效的资产ID' });

        const {
            asset_name, entity_id, category_l1_id, category_l2_id, asset_no_masked,
            owner, effective_date, expiry_date, status, sensitivity,
            visible_departments, extra_fields, remark
        } = req.body;

        if (!asset_name?.trim()) {
            await client.query('ROLLBACK');
            return res.status(400).json({ code: 400, message: '资产名称不能为空' });
        }

        await client.query('BEGIN');

        const updateResult = await client.query(
            `UPDATE eq_asset SET asset_name=$1, entity_id=$2, category_l1_id=$3, category_l2_id=$4,
                asset_no_masked=$5, owner=$6, effective_date=$7, expiry_date=$8, status=$9,
                sensitivity=$10, visible_departments=$11, extra_fields=$12, remark=$13,
                updated_at=NOW()
             WHERE id=$14 RETURNING *`,
            [
                asset_name.trim(), entity_id || null, category_l1_id || null, category_l2_id || null,
                asset_no_masked || null, owner || null, effective_date || null, expiry_date || null,
                status || '有效', sensitivity || '公开',
                visible_departments || [], JSON.stringify(extra_fields || {}),
                remark || null, idNum
            ]
        );

        await client.query('COMMIT');
        logAuditSafe(req, { module: 'enterprise_qualification', action: 'asset_update', target_data: updateResult.rows[0] });
        res.json({ code: 0, data: updateResult.rows[0], message: '更新成功' });
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('[企业资质库] 更新资产失败:', error);
        res.status(500).json({ code: 500, message: '更新失败', error: error.message });
    } finally {
        if (client) client.release();
    }
});

// DELETE /asset/:id — 删除资产
router.delete('/asset/:id', async (req, res) => {
    try {
        const idNum = validateId(req.params.id);
        if (!idNum) return res.status(400).json({ code: 400, message: '无效的资产ID' });

        const result = await pool.query('DELETE FROM eq_asset WHERE id = $1 RETURNING *', [idNum]);
        if (result.rowCount === 0) return res.status(404).json({ code: 404, message: '资产不存在' });

        logAuditSafe(req, { module: 'enterprise_qualification', action: 'asset_delete', target_data: result.rows[0] });
        res.json({ code: 0, message: '删除成功' });
    } catch (error) {
        console.error('[企业资质库] 删除资产失败:', error);
        res.status(500).json({ code: 500, message: '删除失败', error: error.message });
    }
});

// ============================================================
// ■ 附件接口
// ============================================================

// POST /attachment/upload — 附件上传（支持多文件）
router.post('/attachment/upload', eqUpload.array('files', 50), async (req, res) => {
    try {
        const assetId = validateId(req.body.asset_id);
        if (!assetId) return res.status(400).json({ code: 400, message: '无效的资产ID' });

        const files = req.files || [];
        if (files.length === 0) return res.status(400).json({ code: 400, message: '未收到文件' });

        const results = [];
        // 前端通过 formData.append('paths', relPath) 发送多个路径值
        const pathsArr = Array.isArray(req.body.paths) ? req.body.paths : (req.body.paths ? [req.body.paths] : []);
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const fileBuffer = fs.readFileSync(file.path);
            const checksum = computeChecksum(fileBuffer);
            const folderPath = pathsArr[i] || '';

            const insertResult = await pool.query(
                `INSERT INTO eq_attachment (asset_id, file_path, folder_path, original_name, file_size, checksum)
                 VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
                [assetId, file.path, folderPath, fixFileName(file.originalname), file.size, checksum]
            );
            results.push(insertResult.rows[0]);
        }
        res.json({ code: 0, data: results, message: `上传成功 ${results.length} 个文件` });
    } catch (error) {
        console.error('[企业资质库] 附件上传失败:', error);
        res.status(500).json({ code: 500, message: '上传失败', error: error.message });
    }
});

// DELETE /attachment/:id — 删除附件
router.delete('/attachment/:id', async (req, res) => {
    try {
        const idNum = validateId(req.params.id);
        if (!idNum) return res.status(400).json({ code: 400, message: '无效的附件ID' });

        const result = await pool.query('SELECT * FROM eq_attachment WHERE id = $1', [idNum]);
        if (result.rowCount === 0) return res.status(404).json({ code: 404, message: '附件不存在' });

        // 删除磁盘文件
        const filePath = result.rows[0].file_path;
        if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (_) {}
        }

        await pool.query('DELETE FROM eq_attachment WHERE id = $1', [idNum]);
        res.json({ code: 0, message: '删除成功' });
    } catch (error) {
        console.error('[企业资质库] 删除附件失败:', error);
        res.status(500).json({ code: 500, message: '删除失败', error: error.message });
    }
});

// GET /attachment/:id/download — 鉴权文件下载（防止未授权访问）
router.get('/attachment/:id/download', async (req, res) => {
    try {
        const idNum = validateId(req.params.id);
        if (!idNum) return res.status(400).json({ code: 400, message: '无效的附件ID' });

        const result = await pool.query('SELECT * FROM eq_attachment WHERE id = $1', [idNum]);
        if (result.rowCount === 0) return res.status(404).json({ code: 404, message: '附件不存在' });

        const att = result.rows[0];
        const filePath = att.file_path;

        // 兼容旧数据：如果路径以 public/ 开头，转为绝对路径
        const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);

        if (!fs.existsSync(absPath)) {
            return res.status(404).json({ code: 404, message: '文件不存在于服务器' });
        }

        // 根据扩展名设置 Content-Type
        const ext = path.extname(absPath).toLowerCase();
        const mimeMap = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
        const contentType = mimeMap[ext] || 'application/octet-stream';

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(att.original_name)}"`);
        res.sendFile(absPath);
    } catch (error) {
        console.error('[企业资质库] 下载附件失败:', error);
        res.status(500).json({ code: 500, message: '下载失败', error: error.message });
    }
});

// ============================================================
// ■ 凭证接口
// ============================================================

// POST /credential/decrypt — 凭证解密（限流 + 审计）
router.post('/credential/decrypt', decryptLimiter, async (req, res) => {
    try {
        const { credential_id } = req.body;
        const credId = validateId(credential_id);
        if (!credId) return res.status(400).json({ code: 400, message: '无效的凭证ID' });

        const result = await pool.query('SELECT * FROM eq_credential WHERE id = $1', [credId]);
        if (result.rowCount === 0) return res.status(404).json({ code: 404, message: '凭证不存在' });

        const plaintext = decrypt(result.rows[0].ciphertext);

        // 写审计日志
        logAuditSafe(req, {
            module: 'enterprise_qualification',
            action: 'credential_decrypt',
            target_data: { credential_id: credId, asset_id: result.rows[0].asset_id }
        });

        res.json({ code: 0, data: { plain_value: plaintext } });
    } catch (error) {
        console.error('[企业资质库] 凭证解密失败:', error);
        res.status(500).json({ code: 500, message: '解密失败', error: error.message });
    }
});

// ============================================================
// ■ Dify 同步接口
// ============================================================

// POST /sync/trigger — 手动触发同步
router.post('/sync/trigger', async (req, res) => {
    try {
        const { asset_ids } = req.body; // 数组或单 ID
        const ids = Array.isArray(asset_ids) ? asset_ids.map(validateId).filter(Boolean) : [validateId(asset_ids)];
        if (ids.length === 0) return res.status(400).json({ code: 400, message: '无效的资产ID' });

        const DIFY_API_KEY = process.env.DIFY_EQ_KNOWLEDGE_API_KEY;
        const DIFY_BASE_URL = (process.env.DIFY_EQ_KNOWLEDGE_API_URL || '').replace(/\/$/, '');

        const results = [];
        for (const assetId of ids) {
            try {
                // 查询资产
                const assetResult = await pool.query(
                    `SELECT a.*, d1.name AS entity_name, d2.name AS category_l1_name
                     FROM eq_asset a
                     LEFT JOIN eq_dict d1 ON a.entity_id = d1.id
                     LEFT JOIN eq_dict d2 ON a.category_l1_id = d2.id
                     WHERE a.id = $1 AND a.sync_to_dify = TRUE`,
                    [assetId]
                );
                if (assetResult.rowCount === 0) {
                    results.push({ asset_id: assetId, status: 'skipped', reason: '未标记推送或不存在' });
                    continue;
                }
                const asset = assetResult.rows[0];

                // 记录同步日志
                const logResult = await pool.query(
                    `INSERT INTO eq_sync_log (asset_id, sync_action, sync_status) VALUES ($1,'update','pending') RETURNING id`,
                    [assetId]
                );
                const logId = logResult.rows[0].id;

                // 如果有 Dify 配置，调用 Dify API
                if (DIFY_API_KEY && DIFY_BASE_URL) {
                    const content = JSON.stringify({
                        asset_name: asset.asset_name,
                        entity: asset.entity_name,
                        category: asset.category_l1_name,
                        status: asset.status,
                        expiry_date: asset.expiry_date,
                        extra_fields: asset.extra_fields
                    });
                    const difyRes = await fetch(`${DIFY_BASE_URL}/workflows/run`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${DIFY_API_KEY}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            inputs: { content },
                            response_mode: 'blocking',
                            user: req.user?.username || 'system'
                        })
                    });
                    if (difyRes.ok) {
                        await pool.query("UPDATE eq_sync_log SET sync_status='success', synced_at=NOW() WHERE id=$1", [logId]);
                        results.push({ asset_id: assetId, status: 'success' });
                    } else {
                        const errText = await difyRes.text();
                        await pool.query("UPDATE eq_sync_log SET sync_status='failed', error_message=$2, synced_at=NOW() WHERE id=$1", [logId, errText]);
                        results.push({ asset_id: assetId, status: 'failed', error: errText });
                    }
                } else {
                    // 无 Dify 配置，仅标记为成功
                    await pool.query("UPDATE eq_sync_log SET sync_status='success', synced_at=NOW() WHERE id=$1", [logId]);
                    results.push({ asset_id: assetId, status: 'success', note: 'Dify 未配置，仅记录日志' });
                }
            } catch (innerErr) {
                results.push({ asset_id: assetId, status: 'failed', error: innerErr.message });
            }
        }
        res.json({ code: 0, data: results });
    } catch (error) {
        console.error('[企业资质库] 同步触发失败:', error);
        res.status(500).json({ code: 500, message: '同步失败', error: error.message });
    }
});

// GET /sync/log/:assetId — 查询同步历史
router.get('/sync/log/:assetId', async (req, res) => {
    try {
        const assetId = validateId(req.params.assetId);
        if (!assetId) return res.status(400).json({ code: 400, message: '无效的资产ID' });

        const result = await pool.query(
            'SELECT * FROM eq_sync_log WHERE asset_id = $1 ORDER BY synced_at DESC LIMIT 50',
            [assetId]
        );
        res.json({ code: 0, data: result.rows });
    } catch (error) {
        console.error('[企业资质库] 查询同步历史失败:', error);
        res.status(500).json({ code: 500, message: '查询失败', error: error.message });
    }
});

// ============================================================
// ■ AI 智能识别（Dify Workflow）
// ============================================================
router.post('/ai-recognize', eqUpload.array('files', 50), async (req, res) => {
    try {
        const apiKey = process.env.DIFY_EQ_AI_RECOGNIZE_API_KEY;
        const apiBaseUrl = (process.env.DIFY_EQ_AI_RECOGNIZE_API_URL || '').replace(/\/$/, '');
        const note = req.body.note || '';
        const existingIdsRaw = req.body.existing_attachment_ids || '[]';
        let existingIds = [];
        try { existingIds = JSON.parse(existingIdsRaw); } catch { existingIds = []; }

        if (!apiKey || apiKey.includes('PLACEHOLDER') || !apiBaseUrl) {
            return res.status(503).json({ code: 503, message: 'AI 识别服务未配置，请在 .env 中设置 DIFY_EQ_AI_RECOGNIZE_API_KEY 和 DIFY_EQ_AI_RECOGNIZE_API_URL' });
        }

        const newFiles = req.files || [];
        const imageIds = [];
        const documentIds = [];

        const uploadToDify = async (fileBuffer, mimeType, fileName) => {
            const form = new FormData();
            const isImage = mimeType.startsWith('image/');
            const blob = new Blob([fileBuffer], { type: mimeType });
            form.set('file', blob, fileName);
            form.set('user', req.user?.username || 'system');
            form.set('type', isImage ? 'image' : 'document');
            const upRes = await fetch(`${apiBaseUrl}/files/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}` },
                body: form,
            });
            if (!upRes.ok) throw new Error(`Dify 上传失败 ${upRes.status}`);
            const upData = await upRes.json();
            return upData.id;
        };

        for (const file of newFiles) {
            const buffer = fs.readFileSync(file.path);
            const id = await uploadToDify(buffer, file.mimetype, fixFileName(file.originalname));
            if (file.mimetype?.startsWith('image/')) imageIds.push(id);
            else documentIds.push(id);
        }

        for (const attId of existingIds) {
            const numId = validateId(attId);
            if (!numId) continue;
            const attRes = await pool.query('SELECT * FROM eq_attachment WHERE id = $1', [numId]);
            if (attRes.rowCount === 0) continue;
            const att = attRes.rows[0];
            const absPath = path.isAbsolute(att.file_path) ? att.file_path : path.resolve(att.file_path);
            if (!fs.existsSync(absPath)) continue;
            const buffer = fs.readFileSync(absPath);
            const ext = path.extname(absPath).toLowerCase();
            const mimeMap = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.bmp': 'image/bmp', '.gif': 'image/gif' };
            const mime = mimeMap[ext] || 'application/octet-stream';
            const id = await uploadToDify(buffer, mime, att.original_name || 'file');
            if (mime.startsWith('image/')) imageIds.push(id);
            else documentIds.push(id);
        }

        if (imageIds.length === 0 && documentIds.length === 0) {
            return res.status(400).json({ code: 400, message: '没有可识别的文件，请先上传附件' });
        }

        const inputs = {};
        if (imageIds.length > 0) {
            inputs.image_files = imageIds.map(id => ({ type: 'image', transfer_method: 'local_file', upload_file_id: id }));
        }
        if (documentIds.length > 0) {
            inputs.document_files = documentIds.map(id => ({ type: 'document', transfer_method: 'local_file', upload_file_id: id }));
        }
        if (note) inputs.note = note;

        const wfRes = await fetch(`${apiBaseUrl}/workflows/run`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                inputs,
                response_mode: 'blocking',
                user: req.user?.username || 'system',
            }),
        });

        if (!wfRes.ok) {
            const errText = await wfRes.text();
            return res.status(500).json({ code: 500, message: `AI 识别失败 (${wfRes.status}): ${errText}` });
        }

        const wfData = await wfRes.json();
        const outputs = wfData?.data?.outputs || {};
        let parsed = null;
        let raw = '';
        const textVal = outputs.text ?? outputs.result ?? outputs.output;
        if (typeof textVal === 'string') {
            raw = textVal;
            const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
            const text = jsonMatch ? jsonMatch[1].trim() : raw.trim();
            try { parsed = JSON.parse(text); } catch { /* 非标准 JSON */ }
        } else if (textVal && typeof textVal === 'object') {
            parsed = textVal;
            raw = JSON.stringify(textVal);
        } else {
            parsed = outputs;
            raw = JSON.stringify(outputs);
        }

        res.json({ code: 0, data: { raw, parsed } });
    } catch (err) {
        console.error('[企业资质库] AI识别失败:', err);
        res.status(500).json({ code: 500, message: 'AI 识别失败: ' + err.message });
    }
});

// ============================================================
// ■ 审计日志辅助函数
// ============================================================
function logAuditSafe(req, { module, action, target_data }) {
    // 异步写入，不阻塞主流程
    setImmediate(async () => {
        try {
            const user = req?.user || {};
            const ip = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req?.socket?.remoteAddress || '';
            const ua = req?.headers?.['user-agent'] || '';
            await pool.query(
                `INSERT INTO sys_audit_logs (user_id, username, module, action, target_data, details, status, ip_address, user_agent)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [
                    user.id || user.userId || null,
                    user.username || 'ANONYMOUS',
                    module, action,
                    target_data ? (typeof target_data === 'string' ? target_data : JSON.stringify(target_data)) : '',
                    '', 'SUCCESS', ip, ua
                ]
            );
        } catch (err) {
            console.error('[企业资质库] 审计日志写入失败:', err.message);
        }
    });
}

// ============================================================
// 自动迁移：sensitivity 从 integer 改为 varchar，新增 remark 列
// ============================================================
(async function runEqMigration() {
    try {
        // 检查 sensitivity 列是否还是 integer
        const colCheck = await pool.query(
            `SELECT data_type FROM information_schema.columns WHERE table_name = 'eq_asset' AND column_name = 'sensitivity'`
        );
        if (colCheck.rows.length > 0 && colCheck.rows[0].data_type === 'integer') {
            console.log('[企业资质库] 迁移: sensitivity INTEGER → VARCHAR...');
            await pool.query(`ALTER TABLE eq_asset ALTER COLUMN sensitivity TYPE VARCHAR(20) USING CASE sensitivity WHEN 1 THEN '公开' WHEN 2 THEN '受限' WHEN 3 THEN '高敏感' ELSE '公开' END`);
            await pool.query(`ALTER TABLE eq_asset ALTER COLUMN sensitivity SET DEFAULT '公开'`);
            console.log('[企业资质库] 迁移: sensitivity 完成');
        }
        // 新增 remark 列
        const remarkCheck = await pool.query(
            `SELECT 1 FROM information_schema.columns WHERE table_name = 'eq_asset' AND column_name = 'remark'`
        );
        if (remarkCheck.rows.length === 0) {
            await pool.query(`ALTER TABLE eq_asset ADD COLUMN remark TEXT`);
            console.log('[企业资质库] 迁移: 新增 remark 列');
        }
        // 扩大 asset_no_masked 列
        await pool.query(`ALTER TABLE eq_asset ALTER COLUMN asset_no_masked TYPE VARCHAR(100)`);
    } catch (e) {
        // 表不存在时忽略
    }
})();

export default router;
