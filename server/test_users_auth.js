import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';
const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

async function testUsers() {
    try {
        const res = await fetch('http://127.0.0.1:8081/api/knowledge/users', {
            headers: {
                'Authorization': 'Bearer ' + token
            }
        });
        const text = await res.text();
        console.log("Status:", res.status);
        console.log("Body:", text);
    } catch (e) {
        console.error(e);
    }
}
testUsers();
