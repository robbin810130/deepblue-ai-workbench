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

async function migrate() {
    try {
        console.log('Adding module column...');
        await pool.query("ALTER TABLE ref_target_markets ADD COLUMN IF NOT EXISTS module VARCHAR(50)");
        
        console.log('Updating initial values...');
        // 欧盟、马来西亚、印尼、东南亚 为研发部
        await pool.query("UPDATE ref_target_markets SET module = 'beauty_rnd' WHERE name IN ('欧盟', '马来西亚', '印尼', '东南亚')");
        // 越南、泰国 为营销部
        await pool.query("UPDATE ref_target_markets SET module = 'sea_marketing' WHERE name IN ('越南', '泰国')");
        
        // 补跑一下：如果马来西亚、印尼在营销部也有，可能需要手动调整。
        // 但根据用户描述，当前的显示是一锅粥，所有有ID的市场都出来了。
        
        await pool.query("UPDATE ref_target_markets SET module = 'sea_marketing' WHERE module IS NULL");
        
        console.log('Migration complete.');
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
migrate();
