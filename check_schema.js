import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    connectionString: "postgresql://dify_admin:Asdf.159753@39.108.221.22:9800/dify_memory"
});

async function checkSchema() {
    try {
        const res = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'ref_news_keywords'
        `);
        res.rows.forEach(row => {
            console.log(`${row.column_name}: ${row.data_type}`);
        });
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

checkSchema();
