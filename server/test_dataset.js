import dotenv from 'dotenv';
dotenv.config();

async function testDatasetInfo() {
    try {
        const datasetId = process.env.DIFY_KNOWLEDGE_DATASET_ID;
        const API_KEY = process.env.DIFY_KNOWLEDGE_API_KEY;
        const API_BASE_URL = process.env.DIFY_API_BASE_URL || 'http://39.108.221.22/v1';
        
        const url = `${API_BASE_URL}/datasets/${datasetId}`;
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${API_KEY}`
            }
        });
        
        const json = await res.json();
        console.log("Dataset Info:", JSON.stringify(json, null, 2));
    } catch (e) {
        console.error("Test Error:", e.message);
    }
}
testDatasetInfo();
