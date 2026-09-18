import pkg from 'pg';
const {Pool} = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({connectionString: process.env.DATABASE_URL});
async function run() {
    const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'sys_users'");
    console.log("sys_users schema:", res.rows);
    const res2 = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'sys_knowledge_documents'");
    console.log("sys_knowledge_documents schema:", res2.rows);
    pool.end();
}
run();
