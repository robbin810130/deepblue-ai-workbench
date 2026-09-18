import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

async function testUploadPublic() {
    try {
        const formData = new FormData();
        formData.append('visibility', 'PUBLIC');
        formData.append('file', new Blob([fs.readFileSync('server/test_upload.txt')]), 'test_public.txt');

        const res = await fetch('http://localhost:3001/api/knowledge/upload', {
            method: 'POST',
            headers: {
                'x-tenant-id': 'ADMIN',
                'x-dataset-id': 'company_rules'
            },
            body: formData
        });
        
        console.log("Upload Status:", res.status);
        console.log("Upload Body:", await res.text());
        
    } catch (e) {
        console.error("Test Error:", e.message);
    }
}
testUploadPublic();
