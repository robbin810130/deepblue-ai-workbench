-- 物料编码表 t_jy_material
-- 用途：订单识别模块手动搜索ERP物料，支持编号/名称/规格模糊匹配
CREATE TABLE IF NOT EXISTS t_jy_material (
    id          SERIAL PRIMARY KEY,
    itemno      VARCHAR(64)  NOT NULL,           -- 物料编码
    itemname    VARCHAR(128) NOT NULL,           -- 物料名称
    descript    VARCHAR(256),                    -- 规格描述
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jy_material_itemno    ON t_jy_material (itemno);
CREATE INDEX IF NOT EXISTS idx_jy_material_itemname  ON t_jy_material USING gin (to_tsvector('simple', itemname));
CREATE INDEX IF NOT EXISTS idx_jy_material_descript  ON t_jy_material USING gin (to_tsvector('simple', coalesce(descript, '')));
