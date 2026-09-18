import pkg from 'pg';
const {Pool} = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({connectionString: process.env.DATABASE_URL});
async function run() {
    const res = await pool.query("SELECT username, display_name FROM sys_users");
    console.log(res.rows);
    pool.end();
}
run();
