import pool from './db.js';

async function run() {
    try {
        const res = await pool.query("SELECT * FROM sys_mock_material_specs");
        console.log(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

run();
