-- 补全遗漏的基础资料表与配置表

-- 1. 营销风格
CREATE TABLE IF NOT EXISTS ref_marketing_styles (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50)  NOT NULL,          -- 种草风格、专业风格、平价风格
    sort_order  INT          NOT NULL DEFAULT 0
);

INSERT INTO ref_marketing_styles (name, sort_order) VALUES
('通用风格', 1),
('种草风格', 2),
('专业解析', 3),
('平价测评', 4);

-- 2. 新闻关键词词库
CREATE TABLE IF NOT EXISTS ref_news_keywords (
    id          SERIAL PRIMARY KEY,
    group_name  VARCHAR(50)  NOT NULL,          -- 科技前沿、金融资本、行业聚焦...
    keyword     VARCHAR(100) NOT NULL,
    sort_order  INT          NOT NULL DEFAULT 0,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO ref_news_keywords (group_name, keyword, sort_order, is_active) VALUES
('科技前沿', 'AI大模型', 1, true),
('科技前沿', '半导体', 2, true),
('科技前沿', '商业航天', 3, true),
('科技前沿', '仿生机器人', 4, true),
('科技前沿', '低空经济', 5, true),
('科技前沿', '量子计算', 6, true),

('金融资本', '宏观政策', 1, true),
('金融资本', '投融资', 2, true),
('金融资本', 'IPO动态', 3, true),
('金融资本', '股市纵览', 4, true),
('金融资本', '数字货币', 5, true),
('金融资本', '美联储', 6, true),

('行业聚焦', '美妆', 1, true),
('行业聚焦', '服饰', 2, true),
('行业聚焦', '食品', 3, true),
('行业聚焦', '电商出海', 4, true),
('行业聚焦', '跨境贸易', 5, true),

('地域资讯', '粤港澳大湾区', 1, true),
('地域资讯', '汕头', 2, true),
('地域资讯', '广州', 3, true),
('地域资讯', '深圳', 4, true),
('地域资讯', '香港', 5, true),
('地域资讯', '长三角', 6, true),
('地域资讯', '海外市场', 7, true),

('热点人物', '马斯克', 1, true),
('热点人物', '黄仁勋', 2, true),
('热点人物', '库克', 3, true),
('热点人物', '雷军', 4, true),
('热点人物', '奥特曼(Sam Altman)', 5, true);

-- 3. 每日推送偏好（per-user）
-- 注意：系统 Cron 定时任务将选取本表中最新更新(updated_at DESC)的一条记录作为全局推送的时间与关键词基准
CREATE TABLE IF NOT EXISTS app_news_preferences (
    id               SERIAL PRIMARY KEY,
    user_id          VARCHAR(100) NOT NULL UNIQUE,   -- 登录用户名
    default_industry TEXT,                           -- 默认关键词字符串
    count_limit      INT          NOT NULL DEFAULT 12,
    push_time        VARCHAR(5)   NOT NULL DEFAULT '08:30',
    updated_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);
