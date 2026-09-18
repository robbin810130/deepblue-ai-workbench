import dotenv from 'dotenv';
import fs from 'fs';
import { difyKnowledgeService } from './services/difyKnowledgeService.js';
dotenv.config();

async function testUpload() {
    try {
        fs.writeFileSync('test_upload.txt', 'This is a test document.');
        
        console.log(`Attempting to upload...`);
        const res = await difyKnowledgeService.createByFile('test_upload.txt', 'test_upload.txt', 'ADMIN', 'company_rules');
        console.log("Upload result:", JSON.stringify(res, null, 2));
    } catch (e) {
        console.error("Test Error:", e.message);
    } finally {
        if (fs.existsSync('test_upload.txt')) fs.unlinkSync('test_upload.txt');
        process.exit(0);
    }
}
testUpload();
