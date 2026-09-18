import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
    try {
        const sqlPath = path.join(__dirname, '../database/rebuild_knowledge_tables.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        await pool.query(sql);
        console.log('Successfully rebuilt knowledge_documents table with dataset_id.');
    } catch (e) {
        console.error('Error executing SQL:', e);
    } finally {
        pool.end();
    }
}

run();
