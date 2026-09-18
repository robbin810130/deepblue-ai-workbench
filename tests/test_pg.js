import pool from './db.js';

async function seed() {
    try {
        console.log('Testing connection with DATABASE_URL...');
        const res = await pool.query("SELECT * FROM ref_news_keywords");
        console.log(`Found ${res.rows.length} rows.`);
        console.log(JSON.stringify(res.rows, null, 2));
        process.exit(0);
    } catch (e) {
        console.error('Connection failed:', e);
        process.exit(1);
    }
}
seed();
