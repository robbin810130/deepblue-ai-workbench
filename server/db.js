// db.js — PostgreSQL 连接池（供 server.js 全局复用）
import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';

dotenv.config();

// 强制指定 PostgreSQL 时区，修复 Windows 下默认识别 PRC 报错的问题
process.env.PGTZ = 'Asia/Shanghai';

// 优先使用 DATABASE_URL，提供强大的通用性和稳定性
let poolConfig = {};
if (process.env.DATABASE_URL) {
    // Some env instances append query params like ?sslmode=disable
    poolConfig = {
        connectionString: process.env.DATABASE_URL.replace(/["']/g, '')
    };
} else {
    poolConfig = {
        host: process.env.PG_HOST,
        port: process.env.PG_PORT,
        database: process.env.PG_DATABASE,
        user: process.env.PG_USER,
        password: process.env.PG_PASSWORD,
    };
}

const pool = new Pool({
    ...poolConfig,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: false,
});

pool.on('error', (err) => {
    console.error('[PG Pool] 意外连接错误：', err.message);
});

// 健康检查
pool.connect()
    .then(client => {
        console.log('[PG] 数据库连接成功 ✓');
        client.release();
    })
    .catch(err => {
        console.error('[PG] 数据库连接失败：', err.message);
    });

export default pool;
