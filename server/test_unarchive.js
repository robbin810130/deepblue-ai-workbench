import dotenv from 'dotenv';
import { difyKnowledgeService } from './services/difyKnowledgeService.js';
dotenv.config();

async function testUnarchive() {
    try {
        const docId = '59cd7e1b-aae2-41b4-979a-6ef84b26dbab'; // One of the user's archived docs
        console.log(`Attempting to unarchive and delete Dify document: ${docId}`);
        
        const API_KEY = process.env.DIFY_KNOWLEDGE_API_KEY;
        const API_BASE_URL = process.env.DIFY_API_BASE_URL || 'http://39.108.221.22/v1';
        const datasetId = process.env.DIFY_KNOWLEDGE_DATASET_ID;
        
        // 1. Unarchive
        const unarchiveRes = await fetch(`${API_BASE_URL}/datasets/${datasetId}/documents/batch`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'un_archive',
                document_ids: [docId]
            })
        });
        
        console.log("Unarchive Status:", unarchiveRes.status);
        console.log("Unarchive Body:", await unarchiveRes.text());
        
        // 2. Delete
        const res = await difyKnowledgeService.deleteDocument(docId, 'company_rules');
        console.log("Delete result:", res);
        
    } catch (e) {
        console.error("Test Error:", e.message);
    }
}
testUnarchive();
