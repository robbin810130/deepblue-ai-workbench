import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import pool from './db.js';
import { difyKnowledgeService } from './services/difyKnowledgeService.js';
import fs from 'fs';

const router = express.Router();

const upload = multer({ dest: 'uploads/knowledge_temp/' });

const getTenantId = (req) => req.headers['x-tenant-id'] || 'TENANT_DEFAULT';
const getDatasetId = (req) => {
    const id = req.headers['x-dataset-id'];
    if (!id) throw new Error('Missing x-dataset-id in headers');
    return id;
};

// 获取系统用户列表 (用于下拉/弹框选择)
router.get('/users', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT u.username, u.display_name, u.role, r.display_name AS role_display_name 
            FROM sys_users u 
            LEFT JOIN sys_roles r ON u.role = r.name 
            ORDER BY u.role ASC, u.username ASC
        `);
        res.json({ code: 0, data: rows });
    } catch (error) {
        res.status(500).json({ code: 500, message: 'Server error', error: error.message });
    }
});

// 数据集清单 —— 前端「知识空间」按场景标识展示（不暴露 Dify UUID）
// 与 services/difyKnowledgeService.js 的 getDatasetId 映射保持一一对应。
const DATASET_CATALOG = [
    {
        dataset_key: 'company_rules',
        name: '公司制度与规范',
        description: '规章制度、流程文件；供公司制度助手与合同审核条款比对引用'
    },
    {
        dataset_key: 'tender_knowledge',
        name: '招投标知识库',
        description: '招投标政策、标书范本与历史项目资料'
    }
];

router.get('/datasets', async (req, res) => {
    let rows = [];
    try {
        const result = await pool.query(
            `SELECT dataset_id, COUNT(*)::int AS document_count
             FROM sys_knowledge_documents GROUP BY dataset_id`
        );
        rows = result.rows;
    } catch (error) {
        // 表不可读时不炸接口，退化为「0 文档」清单，前端仍可上传
        console.warn('[KnowledgeAdmin] datasets count degraded:', error.message);
    }
    const counts = new Map(rows.map((r) => [r.dataset_id, r.document_count]));
    const list = DATASET_CATALOG.map((d) => ({
        ...d,
        document_count: counts.get(d.dataset_key) || 0
    }));
    // 库中存在但清单未登记的数据集也暴露，避免「有数据却看不见」
    for (const r of rows) {
        if (!DATASET_CATALOG.some((d) => d.dataset_key === r.dataset_id)) {
            list.push({
                dataset_key: r.dataset_id,
                name: r.dataset_id,
                description: '未登记数据集（来自存量数据）',
                document_count: r.document_count
            });
        }
    }
    res.json({ code: 0, data: list });
});

// 知识问答 —— 检索召回原文片段 + （可用时）生成式回答
//
// 设计：**检索**只用 dataset API key（任何环境都能跑）；**生成**复用平台唯一 AI 出口
// providers.runSkill，绑定不可用时优雅降级为「仅返回检索片段」，绝不整页失败。
router.post('/qa', async (req, res) => {
    const { question, dataset_key, top_k } = req.body || {};
    const q = String(question || '').trim();
    if (!q) return res.status(400).json({ code: 400, message: 'question 不能为空' });
    const datasetKey = dataset_key || 'company_rules';

    let references = [];
    let retrieveFailed = null;
    try {
        references = await difyKnowledgeService.retrieve(q, datasetKey, Number(top_k) || 4);
    } catch (error) {
        retrieveFailed = error.message;
    }

    let answer = null;
    let note;
    try {
        const { runSkill } = await import('./modules/providers/index.js');
        const result = await runSkill('rules_assistant', {
            inputs: {
                message: q,
                references: references.map((r) => r.segment).join('\n\n---\n\n')
            },
            user: { id: req.user?.id, name: req.user?.username }
        });
        const text = result?.data?.answer || result?.data?.message || result?.summary || null;
        if (typeof text === 'string' && text.trim()) answer = text;
    } catch (error) {
        note = `检索问答模型不可用（${error.code || 'PROVIDER_ERROR'}）：以下为知识库原文片段。`;
    }

    if (!answer && !note) {
        note = references.length
            ? '未生成综合回答，以下为知识库原文片段。'
            : '未检索到相关内容。';
    }
    if (retrieveFailed) {
        note = `知识库检索未成功：${retrieveFailed}`;
    }

    res.json({
        code: 0,
        data: {
            answer,
            answer_available: Boolean(answer),
            references,
            note
        }
    });
});

// 1. 获取文档列表 (安全隔离)
router.get('/list', async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const datasetId = getDatasetId(req);
        const query = `
            SELECT id, dify_document_id, file_name, tenant_id, visibility, parse_status, authorized_users, created_at, updated_at 
            FROM sys_knowledge_documents 
            WHERE dataset_id = $1 AND (
                visibility = 'PUBLIC' 
                OR tenant_id = $2 
                OR $2 = 'ADMIN' 
                OR position(',' || $2 || ',' in ',' || COALESCE(authorized_users, '[]') || ',') > 0
            )
            ORDER BY created_at DESC
        `;
        const { rows } = await pool.query(query, [datasetId, tenantId]);
        console.log(`[KnowledgeAdmin] /list called with datasetId=${datasetId}, tenantId=${tenantId}. Returning ${rows.length} rows.`);
        res.json({ code: 0, data: rows });
    } catch (error) {
        console.error('[KnowledgeAdmin] Get list error:', error);
        res.status(500).json({ code: 500, message: 'Server error', error: error.message });
    }
});

// 2. 上传文件创建文档
router.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ code: 400, message: 'No file uploaded' });
    }
    
    try {
        const tenantId = getTenantId(req);
        const datasetId = getDatasetId(req);
        const visibility = req.body.visibility || 'PRIVATE';
        const authorizedUsers = req.body.authorized_users || '[]';
        const id = crypto.randomUUID();
        const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

        await pool.query(
            `INSERT INTO sys_knowledge_documents (id, dataset_id, dify_document_id, file_name, tenant_id, visibility, parse_status, authorized_users)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [id, datasetId, 'PENDING_DIFY', originalName, tenantId, visibility, 'PENDING', authorizedUsers]
        );

        const difyRes = await difyKnowledgeService.createByFile(req.file.path, originalName, tenantId, datasetId, req.file.mimetype);
        const difyDocId = difyRes.document?.id;

        if (difyDocId) {
            await pool.query(
                `UPDATE sys_knowledge_documents SET dify_document_id = $1, parse_status = 'INDEXING', updated_at = NOW() WHERE id = $2`,
                [difyDocId, id]
            );
            res.json({ code: 0, message: 'Upload started', data: { id, dify_document_id: difyDocId } });
        } else {
            throw new Error('Dify response missing document ID');
        }
    } catch (error) {
        console.error('[KnowledgeAdmin] Upload error:', error);
        try {
            await pool.query(`DELETE FROM sys_knowledge_documents WHERE id = $1`, [id]);
        } catch(e) {
            console.error('Failed to cleanup ghost record', e);
        }
        res.status(500).json({ code: 500, message: '上传到底层大模型知识库失败，已撤销本地记录。', error: error.message });
    } finally {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
    }
});

// 3. 更新文档版本
router.post('/update/:id', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ code: 400, message: 'No file uploaded' });
    }
    const { id } = req.params;
    
    try {
        const tenantId = getTenantId(req);
        const datasetId = getDatasetId(req);

        const { rows } = await pool.query(`SELECT dify_document_id, tenant_id, visibility, dataset_id FROM sys_knowledge_documents WHERE id = $1`, [id]);
        if (rows.length === 0) return res.status(404).json({ code: 404, message: 'Document not found' });
        
        const doc = rows[0];
        if (doc.dataset_id !== datasetId) throw new Error('Dataset mismatch');
        if (doc.visibility === 'PUBLIC' && tenantId !== 'ADMIN') throw new Error('Permission denied to update PUBLIC documents');
        if (doc.visibility === 'PRIVATE' && doc.tenant_id !== tenantId) throw new Error('Permission denied to update others PRIVATE documents');

        const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        await difyKnowledgeService.updateByFile(doc.dify_document_id, req.file.path, originalName, datasetId, req.file.mimetype);
        await pool.query(`UPDATE sys_knowledge_documents SET parse_status = 'INDEXING', file_name = $1, updated_at = NOW() WHERE id = $2`, [originalName, id]);
        
        res.json({ code: 0, message: 'Update started' });
    } catch (error) {
        console.error('[KnowledgeAdmin] Update error:', error);
        res.status(500).json({ code: 500, message: error.message });
    } finally {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }
});

// 4. 删除文档
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const tenantId = getTenantId(req);
        const datasetId = getDatasetId(req);

        const { rows } = await pool.query(`SELECT dify_document_id, tenant_id, visibility, dataset_id FROM sys_knowledge_documents WHERE id = $1`, [id]);
        if (rows.length === 0) return res.status(404).json({ code: 404, message: 'Document not found' });
        
        const doc = rows[0];
        if (doc.dataset_id !== datasetId) return res.status(403).json({ code: 403, message: 'Dataset mismatch' });
        if (doc.visibility === 'PUBLIC' && tenantId !== 'ADMIN') return res.status(403).json({ code: 403, message: 'Permission denied to delete PUBLIC documents' });
        if (doc.visibility === 'PRIVATE' && doc.tenant_id !== tenantId) return res.status(403).json({ code: 403, message: 'Permission denied to delete others PRIVATE documents' });

        if (doc.dify_document_id && !doc.dify_document_id.startsWith('PENDING')) {
            try {
                await difyKnowledgeService.deleteDocument(doc.dify_document_id, datasetId);
            } catch (difyErr) {
                console.error(`[KnowledgeAdmin] Warning: Dify delete failed for ${doc.dify_document_id}`, difyErr);
                if (!difyErr.message.includes('404')) {
                    if (difyErr.message.includes('archived_document_immutable')) {
                        return res.status(403).json({ code: 403, message: '删除失败：该文档在底层大模型知识库中处于“已归档(不可编辑)”状态，请先在Dify知识库后台取消归档。' });
                    }
                    throw difyErr;
                }
            }
        }

        await pool.query(`DELETE FROM sys_knowledge_documents WHERE id = $1`, [id]);
        res.json({ code: 0, message: 'Deleted successfully' });
    } catch (error) {
        console.error('[KnowledgeAdmin] Delete error:', error);
        res.status(500).json({ code: 500, message: error.message });
    }
});

// 5. 轮询状态
router.get('/status/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const tenantId = getTenantId(req);
        const datasetId = getDatasetId(req);

        const { rows } = await pool.query(`SELECT id, dify_document_id, file_name, tenant_id, visibility, parse_status, authorized_users, dataset_id, created_at, updated_at FROM sys_knowledge_documents WHERE id = $1 AND (visibility = 'PUBLIC' OR tenant_id = $2 OR $2 = 'ADMIN' OR position(',' || $2 || ',' in ',' || COALESCE(authorized_users, '[]') || ',') > 0)`, [id, tenantId]);
        if (rows.length === 0) return res.status(404).json({ code: 404, message: 'Not found' });
        
        const doc = rows[0];
        if (doc.dataset_id !== datasetId) return res.status(403).json({ code: 403, message: 'Dataset mismatch' });
        if (doc.parse_status === 'COMPLETED' || doc.parse_status === 'FAILED') return res.json({ code: 0, data: doc });

        if (doc.dify_document_id && !doc.dify_document_id.startsWith('PENDING')) {
            const difyStatus = await difyKnowledgeService.getIndexingStatus(doc.dify_document_id, datasetId);
            const statusStr = difyStatus.indexing_status || difyStatus.data?.[0]?.indexing_status;
            let newStatus = doc.parse_status;
            if (statusStr === 'completed') newStatus = 'COMPLETED';
            if (statusStr === 'error') newStatus = 'FAILED';
            if (statusStr === 'indexing') newStatus = 'INDEXING';

            if (newStatus !== doc.parse_status) {
                await pool.query(`UPDATE sys_knowledge_documents SET parse_status = $1, updated_at = NOW() WHERE id = $2`, [newStatus, id]);
                doc.parse_status = newStatus;
            }
        }

        res.json({ code: 0, data: doc });
    } catch (error) {
        console.error('[KnowledgeAdmin] Status error:', error);
        res.status(500).json({ code: 500, message: error.message });
    }
});

export default router;
