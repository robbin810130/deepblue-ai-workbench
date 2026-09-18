-- 复盘搭子-交易情况表
-- 日期唯一，重复数据覆盖旧记录
CREATE TABLE IF NOT EXISTS sys_review_transaction (
    id SERIAL PRIMARY KEY,
    stat_date DATE NOT NULL UNIQUE,
    online_goods NUMERIC(12,2) DEFAULT 0,
    virtual_card NUMERIC(12,2) DEFAULT 0,
    cash_coupon NUMERIC(12,2) DEFAULT 0,
    phone_recharge NUMERIC(12,2) DEFAULT 0,
    dining NUMERIC(12,2) DEFAULT 0,
    movie_ticket NUMERIC(12,2) DEFAULT 0,
    transaction_users INTEGER DEFAULT 0,
    transaction_count INTEGER DEFAULT 0,
    nayuki_gmv NUMERIC(12,2) DEFAULT 0,
    nayuki_avg_price NUMERIC(12,2) DEFAULT 0,
    profit_share NUMERIC(12,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_review_transaction_stat_date ON sys_review_transaction (stat_date);

-- 更新时间触发器
CREATE OR REPLACE FUNCTION update_review_transaction_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_review_transaction_updated ON sys_review_transaction;
CREATE TRIGGER trg_review_transaction_updated
    BEFORE UPDATE ON sys_review_transaction
    FOR EACH ROW EXECUTE FUNCTION update_review_transaction_timestamp();

-- 注释
COMMENT ON TABLE sys_review_transaction IS '复盘搭子-交易情况';
COMMENT ON COLUMN sys_review_transaction.stat_date IS '统计日期（唯一）';
COMMENT ON COLUMN sys_review_transaction.online_goods IS '线上货物（金额）';
COMMENT ON COLUMN sys_review_transaction.virtual_card IS '虚拟卡券（金额）';
COMMENT ON COLUMN sys_review_transaction.cash_coupon IS '立减金（金额）';
COMMENT ON COLUMN sys_review_transaction.phone_recharge IS '话费充值（金额）';
COMMENT ON COLUMN sys_review_transaction.dining IS '大牌点餐（金额）';
COMMENT ON COLUMN sys_review_transaction.movie_ticket IS '电影票购买（金额）';
COMMENT ON COLUMN sys_review_transaction.transaction_users IS '交易人数';
COMMENT ON COLUMN sys_review_transaction.transaction_count IS '交易笔数';
COMMENT ON COLUMN sys_review_transaction.nayuki_gmv IS '奈雪GMV';
COMMENT ON COLUMN sys_review_transaction.nayuki_avg_price IS '奈雪客单价';
COMMENT ON COLUMN sys_review_transaction.profit_share IS '分润';
