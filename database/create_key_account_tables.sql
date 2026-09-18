-- ============================================================
-- 大客户档案模块 建表脚本
-- ============================================================

-- 主表：大客户档案
CREATE TABLE IF NOT EXISTS key_accounts (
    id              SERIAL PRIMARY KEY,
    customer_name   VARCHAR(255) NOT NULL,
    presales        TEXT,
    basic_info      TEXT,
    org_structure   TEXT,
    business_needs  TEXT,
    tech_integration TEXT,
    presales_pain_points TEXT,
    youshi_involvement TEXT,
    solution        TEXT,
    visibility_type VARCHAR(20) DEFAULT 'all',
    allowed_users   TEXT,
    created_by      VARCHAR(100),
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_by      VARCHAR(100),
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- 快照表：修改历史记录
CREATE TABLE IF NOT EXISTS key_account_snapshots (
    id              SERIAL PRIMARY KEY,
    account_id      INTEGER REFERENCES key_accounts(id) ON DELETE CASCADE,
    snapshot_data   JSONB NOT NULL,
    modified_by     VARCHAR(100),
    modified_at     TIMESTAMP DEFAULT NOW()
);

-- 索引：按档案ID查询快照
CREATE INDEX IF NOT EXISTS idx_key_account_snapshots_account_id ON key_account_snapshots(account_id);
-- 索引：按客户名称模糊查询
CREATE INDEX IF NOT EXISTS idx_key_accounts_customer_name ON key_accounts(customer_name);

-- 兼容已有表：新增可见性字段（幂等执行）
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'key_accounts' AND column_name = 'visibility_type') THEN
        ALTER TABLE key_accounts ADD COLUMN visibility_type VARCHAR(20) DEFAULT 'all';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'key_accounts' AND column_name = 'allowed_users') THEN
        ALTER TABLE key_accounts ADD COLUMN allowed_users TEXT;
    END IF;
END $$;
