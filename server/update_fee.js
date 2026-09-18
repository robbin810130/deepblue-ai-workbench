import pool from './db.js';

async function run() {
    try {
        await pool.query("UPDATE sys_mock_material_specs SET standard_processing_fee = 13.00 WHERE material_no = 'Mat-YJV4x25'");
        console.log("Updated standard_processing_fee to 13.00 for Mat-YJV4x25 successfully.");
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

run();
