-- ============================================
-- 复盘搭子 - 广告专区数据表
-- 用于存储广告投放与专区流量的关联数据
-- ============================================

-- 广告专区数据表
CREATE TABLE IF NOT EXISTS sys_review_ad_zone (
    id              BIGSERIAL       PRIMARY KEY,
    ad_id           INTEGER         NOT NULL,
    business_type   VARCHAR(100),
    promotion_name  VARCHAR(200),
    ad_name         VARCHAR(200),
    stat_date       DATE            NOT NULL,
    impressions     INTEGER         DEFAULT 0,
    impression_users INTEGER        DEFAULT 0,
    clicks          INTEGER         DEFAULT 0,
    click_users     INTEGER         DEFAULT 0,
    zone_id         INTEGER,
    zone_name       VARCHAR(200),
    zone_content    VARCHAR(100),
    pv              INTEGER         DEFAULT 0,
    uv_openid       INTEGER         DEFAULT 0,
    uv_channel      INTEGER         DEFAULT 0,
    zone_clicks     INTEGER         DEFAULT 0,
    zone_click_users INTEGER        DEFAULT 0,
    avg_stay_seconds NUMERIC(10,2)  DEFAULT 0,
    material_name   VARCHAR(200),
    we_date         VARCHAR(20),
    we_visitors     INTEGER         DEFAULT 0,
    we_visits       INTEGER         DEFAULT 0,
    created_at      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       DEFAULT CURRENT_TIMESTAMP
);

-- 唯一约束：同一广告、同一日期、同一专区只能有一条记录
-- 注意：必须使用 UNIQUE INDEX（支持表达式）才能被 ON CONFLICT 子句匹配
DROP INDEX IF EXISTS uq_review_ad_zone;
CREATE UNIQUE INDEX uq_review_ad_zone
    ON sys_review_ad_zone (COALESCE(ad_id, 0), stat_date, COALESCE(zone_id, 0));

-- 按日期查询索引（常用范围查询）
CREATE INDEX IF NOT EXISTS idx_review_ad_zone_date 
    ON sys_review_ad_zone (stat_date);

-- 按广告ID查询索引
CREATE INDEX IF NOT EXISTS idx_review_ad_zone_ad_id 
    ON sys_review_ad_zone (ad_id);

-- 按专区ID查询索引
CREATE INDEX IF NOT EXISTS idx_review_ad_zone_zone_id 
    ON sys_review_ad_zone (zone_id);

-- 组合索引：广告+日期（用于广告维度的日期范围查询）
CREATE INDEX IF NOT EXISTS idx_review_ad_zone_ad_date 
    ON sys_review_ad_zone (ad_id, stat_date);

-- 组合索引：专区+日期（用于专区维度的日期范围查询）
CREATE INDEX IF NOT EXISTS idx_review_ad_zone_zone_date 
    ON sys_review_ad_zone (zone_id, stat_date);

-- 更新时间触发器
CREATE OR REPLACE FUNCTION update_review_ad_zone_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_review_ad_zone_updated_at ON sys_review_ad_zone;
CREATE TRIGGER trg_review_ad_zone_updated_at
    BEFORE UPDATE ON sys_review_ad_zone
    FOR EACH ROW
    EXECUTE FUNCTION update_review_ad_zone_updated_at();

-- 表注释
COMMENT ON TABLE sys_review_ad_zone IS '复盘搭子-广告专区数据表';
COMMENT ON COLUMN sys_review_ad_zone.id IS '主键 ID';
COMMENT ON COLUMN sys_review_ad_zone.ad_id IS '广告 ID';
COMMENT ON COLUMN sys_review_ad_zone.ad_name IS '广告名称';
COMMENT ON COLUMN sys_review_ad_zone.stat_date IS '统计日期';
COMMENT ON COLUMN sys_review_ad_zone.impressions IS '曝光量';
COMMENT ON COLUMN sys_review_ad_zone.impression_users IS '曝光人数';
COMMENT ON COLUMN sys_review_ad_zone.clicks IS '点击量';
COMMENT ON COLUMN sys_review_ad_zone.click_users IS '点击人数';
COMMENT ON COLUMN sys_review_ad_zone.zone_id IS '专区ID';
COMMENT ON COLUMN sys_review_ad_zone.zone_name IS '专区名称';
COMMENT ON COLUMN sys_review_ad_zone.zone_content IS '专区内容类型';
COMMENT ON COLUMN sys_review_ad_zone.pv IS '页面PV';
COMMENT ON COLUMN sys_review_ad_zone.uv_openid IS 'UV(OpenId)';
COMMENT ON COLUMN sys_review_ad_zone.uv_channel IS 'UV(渠道)';
COMMENT ON COLUMN sys_review_ad_zone.zone_clicks IS '专区内点击量';
COMMENT ON COLUMN sys_review_ad_zone.zone_click_users IS '专区内点击人数';
COMMENT ON COLUMN sys_review_ad_zone.avg_stay_seconds IS '次均停留时长(秒)';
COMMENT ON COLUMN sys_review_ad_zone.material_name IS '素材名称';
COMMENT ON COLUMN sys_review_ad_zone.we_date IS 'We分析日期';
COMMENT ON COLUMN sys_review_ad_zone.we_visitors IS '访问人数';
COMMENT ON COLUMN sys_review_ad_zone.we_visits IS '访问次数';

-- 兼容已部署环境：增量添加新列（幂等）
ALTER TABLE sys_review_ad_zone ADD COLUMN IF NOT EXISTS material_name VARCHAR(200);
ALTER TABLE sys_review_ad_zone ADD COLUMN IF NOT EXISTS we_date VARCHAR(20);
ALTER TABLE sys_review_ad_zone ADD COLUMN IF NOT EXISTS we_visitors INTEGER DEFAULT 0;
ALTER TABLE sys_review_ad_zone ADD COLUMN IF NOT EXISTS we_visits INTEGER DEFAULT 0;
ALTER TABLE sys_review_ad_zone ADD COLUMN IF NOT EXISTS business_type VARCHAR(100);
ALTER TABLE sys_review_ad_zone ADD COLUMN IF NOT EXISTS promotion_name VARCHAR(200);

COMMENT ON COLUMN sys_review_ad_zone.business_type IS '业务类型';
COMMENT ON COLUMN sys_review_ad_zone.promotion_name IS '推广名称';

-- 删除已废弃的旧字段
ALTER TABLE sys_review_ad_zone DROP COLUMN IF EXISTS ad_type;
