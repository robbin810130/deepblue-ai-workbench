-- 初始化新闻关键词
INSERT INTO ref_news_keywords (group_name, keyword, sort_order, is_active) VALUES 
('科技前沿', 'AI大模型', 1, true), ('科技前沿', '半导体', 2, true), ('科技前沿', '商业航天', 3, true), ('科技前沿', '仿生机器人', 4, true), ('科技前沿', '低空经济', 5, true), ('科技前沿', '量子计算', 6, true),
('金融资本', '宏观政策', 1, true), ('金融资本', '投融资', 2, true), ('金融资本', 'IPO动态', 3, true), ('金融资本', '股市纵览', 4, true), ('金融资本', '数字货币', 5, true), ('金融资本', '美联储', 6, true),
('行业聚焦', '美妆', 1, true), ('行业聚焦', '服饰', 2, true), ('行业聚焦', '食品', 3, true), ('行业聚焦', '电商出海', 4, true), ('行业聚焦', '跨境贸易', 5, true),
('地域资讯', '粤港澳大湾区', 1, true), ('地域资讯', '汕头', 2, true), ('地域资讯', '广州', 3, true), ('地域资讯', '深圳', 4, true), ('地域资讯', '香港', 5, true), ('地域资讯', '长三角', 6, true), ('地域资讯', '海外市场', 7, true),
('热点人物', '马斯克', 1, true), ('热点人物', '黄仁勋', 2, true), ('热点人物', '库克', 3, true), ('热点人物', '雷军', 4, true), ('热点人物', '奥特曼(Sam Altman)', 5, true);

-- 初始化产品类别
INSERT INTO ref_product_types (module, name, sort_order, is_active) VALUES
('beauty_rnd', '清透粉底液', 1, true), ('beauty_rnd', '持妆粉底液', 2, true), ('beauty_rnd', '高遮瑕粉底液', 3, true),
('market', '口红', 1, true), ('market', '粉饼', 2, true), ('market', '粉底液', 3, true), ('market', '眼影', 4, true), ('market', '面膜', 5, true), ('market', '精华', 6, true), ('market', '卸妆产品', 7, true);

-- 初始化目标市场
INSERT INTO ref_target_markets (module, name, sort_order, is_active) VALUES
('beauty_rnd', '欧盟', 1, true), ('beauty_rnd', '马来西亚', 2, true), ('beauty_rnd', '印尼', 3, true), ('beauty_rnd', '东南亚', 4, true);

-- 初始化用户痛点标签
INSERT INTO ref_pain_point_tags (name, sort_order, is_active) VALUES
('清爽', 1, true), ('控油', 2, true), ('哑光', 3, true), ('高遮瑕', 4, true), ('不闷痘', 5, true), ('抗汗防水', 6, true), ('日常持妆', 7, true), ('自然提亮', 8, true);

-- 初始化认证
INSERT INTO ref_certifications (name, region, sort_order, is_active) VALUES
('BPOM 清真', '印尼', 1, true), ('REACH 合规', '欧盟', 2, true), ('无认证', '全球', 3, true);

-- 初始化目标语种
INSERT INTO ref_languages (code, name, flag_emoji, sort_order, is_active) VALUES
('en', '英语', '🇬🇧', 1, true), ('id', '印尼语', '🇮🇩', 2, true), ('vi', '越南语', '🇻🇳', 3, true), ('th', '泰语', '🇹🇭', 4, true);

-- 初始化目标平台
INSERT INTO ref_platforms (name, description, label, sort_order, is_active) VALUES
('TikTok', '短视频/直播带货', '短视频/直播带货', 1, true), ('Shopee', '电商平台', '电商平台', 2, true), ('Lazada', '电商平台', '电商平台', 3, true);

-- 初始化营销风格
INSERT INTO ref_marketing_styles (name, sort_order, is_active) VALUES
('种草风格', 1, true), ('专业风格', 2, true), ('平价风格', 3, true);
