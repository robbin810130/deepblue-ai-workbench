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
