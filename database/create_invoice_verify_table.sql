-- 发票校验历史记录表
CREATE TABLE IF NOT EXISTS invoice_verify_history (
    id SERIAL PRIMARY KEY,
    pdf_name TEXT NOT NULL,
    xlsx_name TEXT NOT NULL,
    result_text TEXT,
    supplier_name VARCHAR(200),
    status VARCHAR(20) DEFAULT '待确认',
    username VARCHAR(100) DEFAULT 'unknown',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 兼容已有表：补充新字段
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoice_verify_history' AND column_name = 'supplier_name') THEN
        ALTER TABLE invoice_verify_history ADD COLUMN supplier_name VARCHAR(200);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoice_verify_history' AND column_name = 'status') THEN
        ALTER TABLE invoice_verify_history ADD COLUMN status VARCHAR(20) DEFAULT '待确认';
    END IF;
END $$;

-- 索引：按时间倒序查询
CREATE INDEX IF NOT EXISTS idx_invoice_verify_history_created_at ON invoice_verify_history(created_at DESC);
