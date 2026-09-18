-- 电商生图场景及字段动态配置库

CREATE TABLE IF NOT EXISTS ref_ai_scenes (
    id          SERIAL PRIMARY KEY,
    scene_id    VARCHAR(50)  NOT NULL UNIQUE,  
    label       VARCHAR(50)  NOT NULL,         
    emoji       VARCHAR(10),                   
    description VARCHAR(200),                  
    sort_order  INT          NOT NULL DEFAULT 0,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS ref_ai_scene_fields (
    id          SERIAL PRIMARY KEY,
    scene_id    VARCHAR(50)  NOT NULL,         
    field_id    VARCHAR(50)  NOT NULL,         
    field_label VARCHAR(50)  NOT NULL,         
    options     TEXT,                          
    sort_order  INT          NOT NULL DEFAULT 0,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE
);

-- 清空旧数据防止重复插入报错重复键
TRUNCATE ref_ai_scenes, ref_ai_scene_fields RESTART IDENTITY CASCADE;

-- 插入场景数据
INSERT INTO ref_ai_scenes (scene_id, label, emoji, description, sort_order) VALUES
('text_to_image', '文字出图', '✍️', '输入文字生成化妆品主图、海报、场景图', 1),
('photo_edit', '照片改图', '🖼️', '上传产品图改风格、改场景、改效果', 2),
('suite_gen', '一键出套图', '📋', '一张图生成主图 + 副图 + 详情页整套', 3),
('smart_cutout', '智能抠图', '✂️', '自动抠产品、抠人物、去背景', 4),
('local_edit', '局部修改', '🔧', '只改图里一小块：换色、修瑕疵', 5),
('expand_canvas', '扩大画面', '🔲', '把小图往外延伸，补齐背景', 6),
('hd_upscale', '高清放大', '🔍', '模糊图变清晰，无损放大', 7),
('batch_gen', '批量出图', '🗒️', '一次做多张、多色号、多尺寸', 8),
('color_true', '色号保真', '💄', '口红眼影颜色不偏色', 9),
('try_on', '试色效果', '💋', '生成真实上脸、水光 / 哑光效果', 10),
('template', '套用模板', '🗂️', '直接用现成海报、主图模板', 11),
('style_unified', '风格统一', '🎨', '所有图保持同一种风格', 12),
('ingredient_visual', '成分可视化', '🧬', '画成分、吸收、肌肤对比', 13),
('clothing_model', '模特上身', '👔', '自动为衣服匹配合适模特，快速生成服装展示图', 14),
('angle_composition', '调角度视角', '📐', '改变拍摄角度和构图，多维展示产品细节', 15),
('smart_match', '智能匹配', '🔎', '上传产品图，AI 自动在图库中找出最相似的历史产品', 16);

-- 插入关联选项字段数据
INSERT INTO ref_ai_scene_fields (scene_id, field_id, field_label, options, sort_order) VALUES
-- text_to_image
('text_to_image', 'product', '产品类型', '口红 / 粉底液 / 眼影 / 护肤品', 1),
('text_to_image', 'format', '图片用途', '主图 / 场景图 / 海报 / 详情页', 2),
('text_to_image', 'style_tone', '画面风格', '清新 / 轻奢 / 水光感 / 哑光', 3),

-- photo_edit
('photo_edit', 'edit_type', '改图方式', '换背景 / 变清晰 / 变插画风 / 加质感', 1),
('photo_edit', 'color_effect', '色彩效果', '上脸试色 / 整体调色 / 强化光泽 / 还原原色', 2),

-- suite_gen
('suite_gen', 'suite_type', '套图类型', '主图套装 / 详情套图 / 主图+详情全套', 1),

-- smart_cutout
('smart_cutout', 'cutout_target', '抠图对象', '抠产品 / 抠人像 / 去全部背景', 1),
('smart_cutout', 'bg_result', '背景处理', '留阴影 / 纯白底 / 透明底', 2),

-- local_edit
('local_edit', 'local_action', '修改操作', '改色 / 换包装 / 去瑕疵 / 加文字 / 换局部背景', 1),

-- expand_canvas
('expand_canvas', 'expand_dir', '扩展方向', '向左扩 / 向右扩 / 四周扩展 / 变全景', 1),

-- hd_upscale
('hd_upscale', 'scale_level', '放大级别', '2倍清晰 / 4倍超清 / 印刷级 / 去模糊', 1),

-- batch_gen
('batch_gen', 'batch_count', '批量数量', '批量 5 张 / 批量 9 张', 1),
('batch_gen', 'batch_variety', '多样化', '多色号 / 多尺寸', 2),

-- color_true
('color_true', 'lip_color', '色号还原', '正红色 / 豆沙色 / 裸色 / 不偏色 / 高还原', 1),

-- try_on
('try_on', 'skin_finish', '妆感效果', '水光肌 / 哑光肌 / 清透 / 高遮瑕 / 自然肤', 1),

-- template
('template', 'template_style', '模板类型', '节日 / 促销 / 奢华', 1),

-- style_unified
('style_unified', 'unified_style', '统一风格', '清新风 / 科技风 / 轻奢风 / 国潮风', 1),

-- ingredient_visual
('ingredient_visual', 'skin_action', '功效展示', '补水 / 抗皱 / 提亮 / 分子渗透 / 肌肤对比', 1),

-- clothing_model
('clothing_model', 'model_type', '展示主体', '不使用模特（纯商品展示） / 国内纯净五官模特 / 国外立体五官模特 / 手部/局部特写展示', 1),
('clothing_model', 'scene', '所处场景', '专业无缝白棚 / 高级灰调背景 / 简约生活内景 / 阳光自然外景', 2),
('clothing_model', 'pose', '呈现姿态', '自然直立展示 / 局部试穿/试用特写 / 手持商品展示 / 随意走动抓拍', 3),

-- angle_composition
('angle_composition', 'target_angle', '拍摄视角', '水平正视图（展示全貌） / 经典俯视平铺（Flat Lay） / 45度立体侧视 / 微仰视凸显宏伟感', 1),
('angle_composition', 'composition', '画面构图', '商品居中满充 / 三分法留白构图 / 商品局部极致微距特写 / 前景虚化带来呼吸感', 2),

-- smart_match
('smart_match', 'category', '产品分类', '唇部 / 眼部 / 底妆 / 护肤 / 面部 / 香氛', 1),
('smart_match', 'color_name', '色号', '正红 / 豆沙 / 裸色 / 玫瑰 / 珊瑚 / 大地色 / 无色', 2),
('smart_match', 'finish', '质地', '哑光 / 水光 / 珠光 / 滋润 / 清爽 / 雾面', 3);
