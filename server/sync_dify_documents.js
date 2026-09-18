import crypto from 'crypto';
import pool from './db.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const API_KEY = process.env.DIFY_KNOWLEDGE_API_KEY;
const API_BASE_URL = process.env.DIFY_API_BASE_URL || 'http://39.108.221.22/v1';
// 您需要同步的那个 Dataset ID
const DATASET_ID = process.env.DIFY_KNOWLEDGE_DATASET_ID; 

async function syncDocuments() {
    if (!API_KEY || !DATASET_ID) {
        console.error('❌ Missing DIFY_KNOWLEDGE_API_KEY or DIFY_KNOWLEDGE_DATASET_ID in .env');
        process.exit(1);
    }

    console.log(`⏳ 开始同步数据集 [${DATASET_ID}] 的历史文档...`);

    try {
        // 1. 从 Dify 获取所有文档 (假设单页最多 100 条)
        const url = `${API_BASE_URL}/datasets/${DATASET_ID}/documents?limit=100`;
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${API_KEY}`
            }
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Dify API 请求失败: ${res.status} ${errText}`);
        }

        const difyData = await res.json();
        const difyDocs = difyData.data || [];
        console.log(`✅ 成功从 Dify 拉取到 ${difyDocs.length} 份文档记录。`);

        // 2. 遍历同步到本地数据库
        let addedCount = 0;
        let existCount = 0;

        for (const doc of difyDocs) {
            const difyDocId = doc.id;
            const fileName = doc.name || '未命名历史文档';
            
            // 状态映射
            let parseStatus = 'COMPLETED';
            if (doc.indexing_status === 'indexing') parseStatus = 'INDEXING';
            if (doc.indexing_status === 'error') parseStatus = 'FAILED';

            // 检查数据库是否已存在该底层文档记录
            const checkQuery = `SELECT id FROM sys_knowledge_documents WHERE dify_document_id = $1`;
            const checkRes = await pool.query(checkQuery, [difyDocId]);

            if (checkRes.rows.length === 0) {
                // 不存在，插入新记录
                const newId = crypto.randomUUID();
                const insertQuery = `
                    INSERT INTO sys_knowledge_documents 
                    (id, dataset_id, dify_document_id, file_name, tenant_id, visibility, parse_status)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `;
                // 默认将历史文档归属为系统管理员 (ADMIN)，并且设为公开 (PUBLIC)
                // dataset_id 统一写入前端约定的标识符 'company_rules'
                await pool.query(insertQuery, [
                    newId, 
                    'company_rules', 
                    difyDocId, 
                    fileName, 
                    'ADMIN', 
                    'PUBLIC', 
                    parseStatus
                ]);
                console.log(`➕ 导入新增: ${fileName}`);
                addedCount++;
            } else {
                // 已存在跳过
                existCount++;
            }
        }

        console.log(`🎉 同步完成！共导入 ${addedCount} 份新文档，跳过 ${existCount} 份已存在的文档。`);

    } catch (error) {
        console.error('❌ 同步过程中发生错误:', error.message);
    } finally {
        pool.end();
    }
}

syncDocuments();
