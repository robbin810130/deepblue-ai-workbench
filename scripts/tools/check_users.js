import pool from './db.js';
async function main() {
    try {
        const res = await pool.query('SELECT username, role FROM sys_users');
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
main();
