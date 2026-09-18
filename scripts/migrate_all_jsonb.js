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

async function migrateAll() {
    const tableConfigs = [
        { table: 'ref_platforms', column: 'name' },
        { table: 'ref_product_types', column: 'name' },
        { table: 'ref_languages', column: 'name' },
        { table: 'ref_certifications', column: 'name' },
        { table: 'ref_pain_point_tags', column: 'name' }
    ];

    try {
        for (const config of tableConfigs) {
            console.log(`Migrating ${config.table}.${config.column} to JSONB...`);
            
            // Check if column exists
            const colCheck = await pool.query(`
                SELECT data_type FROM information_schema.columns 
                WHERE table_name = $1 AND column_name = $2
            `, [config.table, config.column]);
            
            if (colCheck.rowCount === 0) {
                console.log(`Column ${config.column} not found in ${config.table}, skipping.`);
                continue;
            }
            
            if (colCheck.rows[0].data_type === 'jsonb') {
                console.log(`Column ${config.column} is already JSONB.`);
                continue;
            }

            // Create temp column
            await pool.query(`ALTER TABLE ${config.table} ADD COLUMN IF NOT EXISTS ${config.column}_new JSONB DEFAULT '[]'::jsonb`);
            
            // Migrate data
            const rows = await pool.query(`SELECT id, ${config.column}::text as val FROM ${config.table}`);
            for (const row of rows.rows) {
                if (!row.val) continue;
                const arr = row.val.split(/[\/、,，]+/).map(s => s.trim()).filter(Boolean);
                await pool.query(`UPDATE ${config.table} SET ${config.column}_new = $1 WHERE id = $2`, [JSON.stringify(arr), row.id]);
            }
            
            // Replace column
            await pool.query(`ALTER TABLE ${config.table} DROP COLUMN ${config.column}`);
            await pool.query(`ALTER TABLE ${config.table} RENAME COLUMN ${config.column}_new TO ${config.column}`);
            
            console.log(`✓ ${config.table} migration successful.`);
        }
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await pool.end();
    }
}

migrateAll();
