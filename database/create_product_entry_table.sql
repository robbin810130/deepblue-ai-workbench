-- 商品库录入历史记录表
CREATE TABLE IF NOT EXISTS product_entry_history (
    id              SERIAL PRIMARY KEY,
    file_names      TEXT NOT NULL,
    parse_result    TEXT,
    confirm_result  TEXT,
    sku_count       INTEGER DEFAULT 0,
    spu_count       INTEGER DEFAULT 0,
    status          VARCHAR(20) DEFAULT 'parsed',
    username        VARCHAR(100) DEFAULT 'unknown',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_entry_history_created_at
    ON product_entry_history(created_at DESC);
