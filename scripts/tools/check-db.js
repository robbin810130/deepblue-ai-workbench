const { Pool } = require('pg');
const pool = new Pool({ user: 'dify_admin', host: '39.108.221.22', database: 'dify_memory', password: 'Asdf.159753', port: 9800 });
pool.query('SELECT tablename FROM pg_tables WHERE schemaname = $1', ['public']).then(r => console.log(r.rows.map(x => x.tablename))).finally(() => pool.end());
