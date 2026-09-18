-- ============================================
-- 复盘搭子 - 小程序访问情况表
-- 用于存储小程序每日访问统计数据
-- ============================================

-- 小程序访问情况表
CREATE TABLE IF NOT EXISTS sys_review_mini_program (
    id              BIGSERIAL       PRIMARY KEY,
    stat_date       DATE            NOT NULL UNIQUE,
    scan_users      INTEGER         DEFAULT 0,
    scan_views      INTEGER         DEFAULT 0,
    partner_visits  INTEGER         DEFAULT 0,
    yz_users        INTEGER         DEFAULT 0,
    yz_views        INTEGER         DEFAULT 0,
    dau             INTEGER         DEFAULT 0,
    display_rate    NUMERIC(5,2)    DEFAULT 0,
    transaction_users INTEGER       DEFAULT 0,
    remark          VARCHAR(500),
    created_at      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP
);

-- 按日期查询索引
CREATE INDEX IF NOT EXISTS idx_review_mini_program_date
    ON sys_review_mini_program (stat_date);

-- 更新时间触发器
CREATE OR REPLACE FUNCTION update_review_mini_program_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_review_mini_program_updated_at ON sys_review_mini_program;
CREATE TRIGGER trg_review_mini_program_updated_at
    BEFORE UPDATE ON sys_review_mini_program
    FOR EACH ROW
    EXECUTE FUNCTION update_review_mini_program_updated_at();

-- 表注释
COMMENT ON TABLE sys_review_mini_program IS '复盘搭子-小程序访问情况表';
COMMENT ON COLUMN sys_review_mini_program.id IS '主键ID';
COMMENT ON COLUMN sys_review_mini_program.stat_date IS '统计日期';
COMMENT ON COLUMN sys_review_mini_program.scan_users IS '刷码页用户数';
COMMENT ON COLUMN sys_review_mini_program.scan_views IS '刷码页曝光次数';
COMMENT ON COLUMN sys_review_mini_program.partner_visits IS '出行搭子访问数';
COMMENT ON COLUMN sys_review_mini_program.remark IS '备注';

-- 兼容已部署环境，幂等加列
ALTER TABLE sys_review_mini_program ADD COLUMN IF NOT EXISTS yz_users INTEGER DEFAULT 0;
ALTER TABLE sys_review_mini_program ADD COLUMN IF NOT EXISTS yz_views INTEGER DEFAULT 0;
ALTER TABLE sys_review_mini_program ADD COLUMN IF NOT EXISTS dau INTEGER DEFAULT 0;
ALTER TABLE sys_review_mini_program ADD COLUMN IF NOT EXISTS display_rate NUMERIC(5,2) DEFAULT 0;
ALTER TABLE sys_review_mini_program ADD COLUMN IF NOT EXISTS transaction_users INTEGER DEFAULT 0;

COMMENT ON COLUMN sys_review_mini_program.yz_users IS '羊城通用户数';
COMMENT ON COLUMN sys_review_mini_program.yz_views IS '羊城通曝光次数';
COMMENT ON COLUMN sys_review_mini_program.dau IS 'DAU';
COMMENT ON COLUMN sys_review_mini_program.display_rate IS '展示率(DIFY返回)';
COMMENT ON COLUMN sys_review_mini_program.transaction_users IS '交易人数';
