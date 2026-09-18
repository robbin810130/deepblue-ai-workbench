import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'blue-os-super-secret-key';
const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

async function testApi() {
    try {
        const res = await fetch('http://127.0.0.1:3001/api/knowledge/list', {
            headers: {
                'x-dataset-id': 'company_rules',
                'x-tenant-id': 'web_user',
                'Authorization': `Bearer ${token}`
            }
        });
        const data = await res.json();
        console.log("API Result:", JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("API Error:", e);
    }
}
testApi();
