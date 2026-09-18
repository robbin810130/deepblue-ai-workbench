import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function checkDb() {
    const res = await pool.query(`SELECT id, file_name, visibility, parse_status, created_at FROM sys_knowledge_documents ORDER BY created_at DESC LIMIT 5`);
    console.log(res.rows);
    pool.end();
}
checkDb();
