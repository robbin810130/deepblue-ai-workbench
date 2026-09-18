-- ============================================
-- 复盘搭子 - 点餐聚合页情况表
-- 用于存储每日 9 大品牌点餐聚合页访问数据
-- 唯一约束: stat_date 同一天只保留一条
-- ============================================

-- 点餐聚合页情况表
CREATE TABLE IF NOT EXISTS sys_review_order_page (
    id          BIGSERIAL   PRIMARY KEY,
    stat_date   DATE        NOT NULL UNIQUE,
    nayuki      INTEGER     DEFAULT 0,
    heytea      INTEGER     DEFAULT 0,
    starbucks   INTEGER     DEFAULT 0,
    jasmine     INTEGER     DEFAULT 0,
    tasiting    INTEGER     DEFAULT 0,
    cudi        INTEGER     DEFAULT 0,
    mcdonalds   INTEGER     DEFAULT 0,
    luckin      INTEGER     DEFAULT 0,
    kfc         INTEGER     DEFAULT 0,
    created_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);

-- 按日期查询索引
CREATE INDEX IF NOT EXISTS idx_review_order_page_date
    ON sys_review_order_page (stat_date);

-- 更新时间触发器
CREATE OR REPLACE FUNCTION update_review_order_page_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_review_order_page_updated_at ON sys_review_order_page;
CREATE TRIGGER trg_review_order_page_updated_at
    BEFORE UPDATE ON sys_review_order_page
    FOR EACH ROW
    EXECUTE FUNCTION update_review_order_page_updated_at();

-- 表注释
COMMENT ON TABLE sys_review_order_page IS '复盘搭子-点餐聚合页情况表';
COMMENT ON COLUMN sys_review_order_page.stat_date IS '统计日期（唯一）';
COMMENT ON COLUMN sys_review_order_page.nayuki IS '奈雪';
COMMENT ON COLUMN sys_review_order_page.heytea IS '喜茶';
COMMENT ON COLUMN sys_review_order_page.starbucks IS '星爸爸';
COMMENT ON COLUMN sys_review_order_page.jasmine IS '茉莉奶白';
COMMENT ON COLUMN sys_review_order_page.tasiting IS '塔斯汀';
COMMENT ON COLUMN sys_review_order_page.cudi IS '库迪';
COMMENT ON COLUMN sys_review_order_page.mcdonalds IS '麦当当';
COMMENT ON COLUMN sys_review_order_page.luckin IS '瑞幸咖啡';
COMMENT ON COLUMN sys_review_order_page.kfc IS '肯德基';
