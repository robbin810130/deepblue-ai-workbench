import pkg from 'pg';
const {Pool} = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({connectionString: process.env.DATABASE_URL});
async function migrate() {
    try {
        await pool.query(`ALTER TABLE sys_knowledge_documents ADD COLUMN authorized_users TEXT DEFAULT '[]'`);
        console.log("Migration successful: added authorized_users column to sys_knowledge_documents");
    } catch (e) {
        if (e.code === '42701') {
            console.log("Column already exists, skipping.");
        } else {
            console.error("Migration failed:", e);
        }
    } finally {
        pool.end();
    }
}
migrate();
