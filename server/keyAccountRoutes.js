// ============================================================
// server/keyAccountRoutes.js — 大客户档案模块路由
// ============================================================
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import pool from './db.js';

// 参数校验工具
function validateId(id) {
    const num = Number(id);
    return Number.isInteger(num) && num > 0 ? num : null;
}

const router = express.Router();

// 文件上传配置（AI 辅助素材上传）
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'tmp/uploads/'),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `keyaccount_${Date.now()}${ext}`);
    }
});
const upload = multer({ storage });

// ============================================================
// ■ 大客户档案 CRUD
// ============================================================

// GET / — 分页查询大客户档案列表
router.get('/', async (req, res) => {
    try {
        const { keyword, page = 1, pageSize = 20 } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const sizeNum = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
        const offset = (pageNum - 1) * sizeNum;
        const limit = sizeNum;
        const currentUser = req.user?.username || '';

        let whereConditions = [];
        const params = [];

        if (keyword && keyword.trim()) {
            params.push(`%${keyword.trim()}%`);
            whereConditions.push(`customer_name ILIKE $${params.length}`);
        }

        // 可见性过滤：所有人可见 OR 当前用户在指定账号列表中
        params.push(currentUser);
        whereConditions.push(`(visibility_type = 'all' OR visibility_type IS NULL OR allowed_users IS NOT NULL AND strpos(',' || replace(allowed_users, ' ', '') || ',', ',' || $${params.length} || ',') > 0)`);

        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

        // 查询总数
        const countResult = await pool.query(
            `SELECT COUNT(*) FROM key_accounts ${whereClause}`,
            params
        );
        const total = parseInt(countResult.rows[0].count, 10);

        // 查询列表
        const dataParams = [...params, limit, offset];
        const dataResult = await pool.query(
            `SELECT id, customer_name, presales, basic_info, visibility_type, allowed_users, created_by, created_at, updated_by, updated_at
             FROM key_accounts ${whereClause}
             ORDER BY updated_at DESC NULLS LAST, created_at DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            dataParams
        );

        res.json({
            code: 0,
            data: {
                list: dataResult.rows,
                total,
                page: pageNum,
                pageSize: sizeNum
            }
        });
    } catch (error) {
        console.error('[大客户档案] 查询列表失败:', error);
        res.status(500).json({ code: 500, message: '查询失败', error: error.message });
    }
});

// GET /:id — 获取单条档案详情
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const idNum = validateId(id);
        if (!idNum) {
            return res.status(400).json({ code: 400, message: '无效的档案ID' });
        }
        const result = await pool.query(
            'SELECT * FROM key_accounts WHERE id = $1',
            [idNum]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ code: 404, message: '档案不存在' });
        }
        res.json({ code: 0, data: result.rows[0] });
    } catch (error) {
        console.error('[大客户档案] 查询详情失败:', error);
        res.status(500).json({ code: 500, message: '查询失败', error: error.message });
    }
});

// POST / — 新增大客户档案
router.post('/', async (req, res) => {
    try {
        const {
            customer_name, presales, basic_info, org_structure,
            business_needs, tech_integration, presales_pain_points,
            youshi_involvement, solution, visibility_type, allowed_users
        } = req.body;

        if (!customer_name || !customer_name.trim()) {
            return res.status(400).json({ code: 400, message: '客户名称不能为空' });
        }

        const createdBy = req.user?.username || 'unknown';
        const vType = visibility_type === 'specific' ? 'specific' : 'all';
        // 确保创建人始终在允许列表中
        let userList = allowed_users ? allowed_users.replace(/\n/g, ',').split(',').map(s => s.trim()).filter(Boolean) : [];
        if (vType === 'specific' && createdBy && createdBy !== 'unknown' && !userList.includes(createdBy)) {
            userList.unshift(createdBy);
        }
        const aUsers = userList.length > 0 ? userList.join(',') : null;

        const result = await pool.query(
            `INSERT INTO key_accounts
                (customer_name, presales, basic_info, org_structure, business_needs,
                 tech_integration, presales_pain_points, youshi_involvement, solution,
                 visibility_type, allowed_users, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             RETURNING *`,
            [
                customer_name.trim(), presales || null, basic_info || null,
                org_structure || null, business_needs || null,
                tech_integration || null, presales_pain_points || null,
                youshi_involvement || null, solution || null,
                vType, aUsers, createdBy
            ]
        );
        res.json({ code: 0, data: result.rows[0], message: '创建成功' });
    } catch (error) {
        console.error('[大客户档案] 新增失败:', error);
        res.status(500).json({ code: 500, message: '新增失败', error: error.message });
    }
});

// PUT /:id — 修改大客户档案（修改前自动创建快照）
router.put('/:id', async (req, res) => {
    let client;
    try {
        client = await pool.connect();
        const { id } = req.params;
        const idNum = validateId(id);
        if (!idNum) {
            return res.status(400).json({ code: 400, message: '无效的档案ID' });
        }
        const {
            customer_name, presales, basic_info, org_structure,
            business_needs, tech_integration, presales_pain_points,
            youshi_involvement, solution, visibility_type, allowed_users
        } = req.body;

        if (!customer_name || !customer_name.trim()) {
            return res.status(400).json({ code: 400, message: '客户名称不能为空' });
        }

        await client.query('BEGIN');

        // 查询原始数据（用于快照）
        const original = await client.query('SELECT * FROM key_accounts WHERE id = $1', [idNum]);
        if (original.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ code: 404, message: '档案不存在' });
        }

        const originalData = original.rows[0];
        const modifiedBy = req.user?.username || 'unknown';

        // 创建快照记录（修改前的完整原始数据）
        const snapshotData = {
            customer_name: originalData.customer_name,
            presales: originalData.presales,
            basic_info: originalData.basic_info,
            org_structure: originalData.org_structure,
            business_needs: originalData.business_needs,
            tech_integration: originalData.tech_integration,
            presales_pain_points: originalData.presales_pain_points,
            youshi_involvement: originalData.youshi_involvement,
            solution: originalData.solution,
            visibility_type: originalData.visibility_type,
            allowed_users: originalData.allowed_users,
            created_by: originalData.created_by,
            created_at: originalData.created_at,
            updated_by: originalData.updated_by,
            updated_at: originalData.updated_at
        };

        await client.query(
            `INSERT INTO key_account_snapshots (account_id, snapshot_data, modified_by)
             VALUES ($1, $2, $3)`,
            [id, JSON.stringify(snapshotData), modifiedBy]
        );

        const vType = visibility_type === 'specific' ? 'specific' : 'all';
        // 确保创建人和修改人始终在允许列表中
        let userList = allowed_users ? allowed_users.replace(/\n/g, ',').split(',').map(s => s.trim()).filter(Boolean) : [];
        if (vType === 'specific') {
            if (originalData.created_by && !userList.includes(originalData.created_by)) {
                userList.unshift(originalData.created_by);
            }
            if (modifiedBy && modifiedBy !== 'unknown' && !userList.includes(modifiedBy)) {
                userList.unshift(modifiedBy);
            }
        }
        const aUsers = userList.length > 0 ? userList.join(',') : null;

        // 更新档案
        const updateResult = await client.query(
            `UPDATE key_accounts SET
                customer_name = $1, presales = $2, basic_info = $3,
                org_structure = $4, business_needs = $5, tech_integration = $6,
                presales_pain_points = $7, youshi_involvement = $8,
                solution = $9, visibility_type = $10, allowed_users = $11,
                updated_by = $12, updated_at = NOW()
             WHERE id = $13
             RETURNING *`,
            [
                customer_name.trim(), presales || null, basic_info || null,
                org_structure || null, business_needs || null,
                tech_integration || null, presales_pain_points || null,
                youshi_involvement || null, solution || null,
                vType, aUsers, modifiedBy, idNum
            ]
        );

        await client.query('COMMIT');
        res.json({ code: 0, data: updateResult.rows[0], message: '更新成功' });
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('[大客户档案] 更新失败:', error);
        res.status(500).json({ code: 500, message: '更新失败', error: error.message });
    } finally {
        if (client) client.release();
    }
});

// ============================================================
// ■ 历史快照
// ============================================================

// GET /:id/snapshots — 获取某档案的所有快照记录列表
router.get('/:id/snapshots', async (req, res) => {
    try {
        const { id } = req.params;
        const idNum = validateId(id);
        if (!idNum) {
            return res.status(400).json({ code: 400, message: '无效的档案ID' });
        }
        const result = await pool.query(
            `SELECT s.id, s.account_id, s.modified_by, s.modified_at,
                    s.snapshot_data, s.snapshot_data->>'customer_name' AS customer_name
             FROM key_account_snapshots s
             WHERE s.account_id = $1
             ORDER BY s.modified_at DESC`,
            [idNum]
        );
        res.json({ code: 0, data: result.rows });
    } catch (error) {
        console.error('[大客户档案] 查询快照列表失败:', error);
        res.status(500).json({ code: 500, message: '查询失败', error: error.message });
    }
});

// GET /:id/snapshots/:snapshotId — 获取某条快照的详细内容
router.get('/:id/snapshots/:snapshotId', async (req, res) => {
    try {
        const { id, snapshotId } = req.params;
        const idNum = validateId(id);
        const snapIdNum = validateId(snapshotId);
        if (!idNum || !snapIdNum) {
            return res.status(400).json({ code: 400, message: '无效的档案ID或快照ID' });
        }
        const result = await pool.query(
            `SELECT * FROM key_account_snapshots
             WHERE id = $1 AND account_id = $2`,
            [snapIdNum, idNum]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ code: 404, message: '快照记录不存在' });
        }
        res.json({ code: 0, data: result.rows[0] });
    } catch (error) {
        console.error('[大客户档案] 查询快照详情失败:', error);
        res.status(500).json({ code: 500, message: '查询失败', error: error.message });
    }
});

// ============================================================
// ■ AI 辅助生成（Dify 工作流集成）
// ============================================================

// POST /ai-generate/upload — 上传 AI 参考素材文件
router.post('/ai-generate/upload', upload.single('file'), async (req, res) => {
    try {
        const DIFY_API_KEY = process.env.DIFY_KA_ACCOUNT_API_KEY;
        const DIFY_BASE_URL = (process.env.DIFY_KA_ACCOUNT_API_URL || 'http://YOUR_DIFY_SERVER/v1').replace(/\/$/, '');

        if (!DIFY_API_KEY) {
            return res.status(503).json({ error: 'DIFY_KA_ACCOUNT_API_KEY 未配置' });
        }
        if (!req.file) {
            return res.status(400).json({ error: '未收到文件' });
        }

        console.log(`[大客户档案AI] 上传文件: ${req.file.originalname} (${req.file.size} bytes)`);

        const fileContent = fs.readFileSync(req.file.path);
        const { Blob: NodeBlob } = await import('buffer');
        const formData = new FormData();
        const blob = new NodeBlob([fileContent], { type: req.file.mimetype });
        formData.append('file', blob, req.file.originalname);
        formData.append('user', req.user?.username || 'web-client-user');

        const difyRes = await fetch(`${DIFY_BASE_URL}/files/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${DIFY_API_KEY}` },
            body: formData
        });

        const data = await difyRes.json();
        if (!difyRes.ok) {
            console.error('[大客户档案AI] 文件上传失败:', data);
            // 清理临时文件
            try { fs.unlinkSync(req.file.path); } catch (_) {}
            return res.status(difyRes.status).json({ error: '文件上传失败', details: data });
        }

        // 清理临时文件
        try { fs.unlinkSync(req.file.path); } catch (_) {}

        res.json({
            code: 0,
            upload_file_id: data.id,
            name: data.name
        });
    } catch (error) {
        console.error('[大客户档案AI] 文件上传错误:', error);
        if (req.file) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
        res.status(500).json({ error: error.message });
    }
});

// POST /ai-generate/run — 调用 Dify 工作流生成档案字段内容（SSE 流式）
router.post('/ai-generate/run', async (req, res) => {
    try {
        const DIFY_API_KEY = process.env.DIFY_KA_ACCOUNT_API_KEY;
        const DIFY_BASE_URL = (process.env.DIFY_KA_ACCOUNT_API_URL || 'http://YOUR_DIFY_SERVER/v1').replace(/\/$/, '');

        if (!DIFY_API_KEY) {
            return res.status(503).json({ error: 'DIFY_KA_ACCOUNT_API_KEY 未配置' });
        }

        const { inputs, files } = req.body;
        console.log('[大客户档案AI] 调用工作流, inputs keys:', Object.keys(inputs || {}));

        // 构建请求体
        const requestBody = {
            inputs: inputs || {},
            response_mode: 'streaming',
            user: req.user?.username || 'web-client-user'
        };

        // 如果有文件参数，添加到 files 字段
        if (files && Array.isArray(files) && files.length > 0) {
            requestBody.files = files;
        }

        const difyRes = await fetch(`${DIFY_BASE_URL}/workflows/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${DIFY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!difyRes.ok) {
            const errText = await difyRes.text();
            console.error('[大客户档案AI] 工作流调用失败:', difyRes.status, errText);
            return res.status(difyRes.status).json({
                error: `工作流调用失败: ${difyRes.status}`,
                details: errText
            });
        }

        // SSE 流式转发
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const reader = difyRes.body.getReader();
        const decoder = new TextDecoder();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(decoder.decode(value, { stream: true }));
            }
        } catch (e) {
            console.error('[大客户档案AI] 流式读取错误:', e);
        } finally {
            res.end();
        }
    } catch (error) {
        console.error('[大客户档案AI] 工作流执行错误:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

export default router;
