import dotenv from 'dotenv';
dotenv.config();

async function testStatus() {
    try {
        const datasetId = process.env.DIFY_KNOWLEDGE_DATASET_ID;
        const API_KEY = process.env.DIFY_KNOWLEDGE_API_KEY;
        const API_BASE_URL = process.env.DIFY_API_BASE_URL || 'http://39.108.221.22/v1';
        
        const docId = 'b8f46be9-1b20-421c-ae0e-ab3c0add445b'; // dify_document_id
        
        console.log("Testing indexing-status with docId");
        const res1 = await fetch(`${API_BASE_URL}/datasets/${datasetId}/documents/${docId}/indexing-status`, {
            headers: { 'Authorization': `Bearer ${API_KEY}` }
        });
        console.log("Status1:", res1.status, await res1.text());
        
        console.log("Testing document info with docId");
        const res2 = await fetch(`${API_BASE_URL}/datasets/${datasetId}/documents/${docId}`, {
            headers: { 'Authorization': `Bearer ${API_KEY}` }
        });
        console.log("Status2:", res2.status, await res2.text());
    } catch (e) {
        console.error("Test Error:", e.message);
    }
}
testStatus();
