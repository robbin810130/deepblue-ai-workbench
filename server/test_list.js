import dotenv from 'dotenv';
import pool from './db.js';
dotenv.config();

async function testList() {
    try {
        const datasetId = process.env.DIFY_KNOWLEDGE_DATASET_ID;
        const API_KEY = process.env.DIFY_KNOWLEDGE_API_KEY;
        const API_BASE_URL = process.env.DIFY_API_BASE_URL || 'http://39.108.221.22/v1';
        
        const url = `${API_BASE_URL}/datasets/${datasetId}/documents?limit=10`;
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${API_KEY}`
            }
        });
        
        const json = await res.json();
        console.log("Documents in Dify:");
        json.data.forEach(d => {
            console.log(`- ${d.id}: ${d.name}`);
        });
    } catch (e) {
        console.error("Test Error:", e.message);
    } finally {
        pool.end();
    }
}
testList();
