import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../server/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const databaseDir = path.join(__dirname, '../database');

const sqlFiles = [
    'create_missing_tables.sql',
    'create_ai_image_tables.sql',
    'create_knowledge_tables.sql',
    'create_mock_quote_tables.sql',
    // 'rebuild_knowledge_tables.sql', // 视情况而定，可能是可选的重建脚本
    'seed_data.sql'
];

async function initDB() {
    console.log('🔄 开始初始化数据库...');
    
    try {
        for (const file of sqlFiles) {
            const filePath = path.join(databaseDir, file);
            if (fs.existsSync(filePath)) {
                console.log(`\n⏳ 正在执行 ${file}...`);
                const sql = fs.readFileSync(filePath, 'utf8');
                await pool.query(sql);
                console.log(`✅ ${file} 执行完成`);
            } else {
                console.warn(`⚠️ 找不到文件: ${file}`);
            }
        }
        console.log('\n🎉 数据库初始化成功！');
    } catch (err) {
        console.error('\n❌ 数据库初始化失败：', err.message);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

initDB();
