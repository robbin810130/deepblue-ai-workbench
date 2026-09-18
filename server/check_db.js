import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function checkDb() {
    const res = await pool.query(`SELECT id, dify_document_id, file_name, parse_status FROM sys_knowledge_documents WHERE id = '92766046-5f98-432a-ad71-c01b781a45fa'`);
    console.log(res.rows);
    pool.end();
}
checkDb();
