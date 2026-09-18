import dotenv from 'dotenv';
import { difyKnowledgeService } from './services/difyKnowledgeService.js';
dotenv.config();

async function testDelete() {
    try {
        const docId = '24a16f64-a29e-494c-98a7-8db87a6ddffc';
        console.log(`Attempting to delete Dify document: ${docId}`);
        const res = await difyKnowledgeService.deleteDocument(docId, 'company_rules');
        console.log("Delete result:", res);
    } catch (e) {
        console.error("Test Error:", e.message);
    } finally {
        process.exit(0);
    }
}
testDelete();
