import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const pool = new Pool({
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    database: process.env.PG_DATABASE,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
});

async function checkContent() {
    try {
        const tables = ['ref_target_markets', 'ref_pain_point_tags', 'ref_certifications', 'ref_marketing_styles', 'ref_languages'];
        for (const t of tables) {
            const res = await pool.query(`SELECT * FROM ${t} LIMIT 5`);
            console.log(`Table ${t}:`, res.rows);
        }
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkContent();
