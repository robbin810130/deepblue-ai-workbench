-- 打包方案统一表（历史数据，来源：物流费计算标准.xlsx）
-- plan_type: 'single' = 单SKU, 'multi' = 多品组合
CREATE TABLE IF NOT EXISTS sys_logistics_packaging_plan (
    id                  SERIAL PRIMARY KEY,
    plan_type           VARCHAR(10) NOT NULL DEFAULT 'single', -- single / multi
    seq                 INT,                              -- 序号（仅单SKU有）
    product_code        VARCHAR(500) NOT NULL DEFAULT '',  -- 单品货号（单SKU用）
    product_codes       VARCHAR(500) NOT NULL DEFAULT '', -- 货号组合（多品用，+连接）
    code_qty            VARCHAR(500) NOT NULL DEFAULT '',  -- 货号*数量（仅单SKU有）
    product_name        VARCHAR(500) NOT NULL DEFAULT '', -- 商品名称
    weight              NUMERIC(10,4) DEFAULT 0,          -- 重量(kg)
    volume              NUMERIC(12,8) DEFAULT 0,          -- 体积(m³，仅单SKU有)
    postal_weight_1_3   VARCHAR(100) DEFAULT '-',          -- 邮政体系计抛重量(1-3区)
    postal_weight_4_5   VARCHAR(100) DEFAULT '-',          -- 邮政体系计抛重量(4-5区)
    packaging_plan      TEXT,                             -- 新打包方案
    packaging_material  VARCHAR(200) NOT NULL DEFAULT '', -- 包材
    attribute           VARCHAR(50) NOT NULL DEFAULT '',  -- 属性（纸箱/快递袋/气泡袋等）
    material_code       VARCHAR(50) DEFAULT '',           -- 耗材编码
    sleeve              VARCHAR(100) DEFAULT '',          -- 套头
    wrap_film           VARCHAR(100) DEFAULT '',          -- 裹膜
    express_cost        NUMERIC(10,4) DEFAULT 0,          -- 邮政小包快递成本
    material_cost_box   NUMERIC(10,4) DEFAULT 0,          -- 耗材成本-纸箱/快递袋
    material_cost_sleeve NUMERIC(10,4) DEFAULT 0,         -- 耗材成本-套头
    material_cost_wrap  NUMERIC(10,4) DEFAULT 0,          -- 耗材成本-裹膜
    extra_packing_fee   NUMERIC(10,4) DEFAULT 0,          -- 额外打包费
    loading_fee         NUMERIC(10,4) DEFAULT 0,          -- 装卸费
    total_cost          NUMERIC(12,6) DEFAULT 0,          -- 整体费用
    remark              TEXT,                             -- 备注
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_packaging_plan_type ON sys_logistics_packaging_plan(plan_type);
CREATE INDEX IF NOT EXISTS idx_packaging_plan_code ON sys_logistics_packaging_plan(product_code);
CREATE INDEX IF NOT EXISTS idx_packaging_plan_codes ON sys_logistics_packaging_plan(product_codes);
CREATE INDEX IF NOT EXISTS idx_packaging_plan_name ON sys_logistics_packaging_plan(product_name);

COMMENT ON TABLE sys_logistics_packaging_plan IS '物流费计算模块-打包方案历史数据（单SKU+多品）';
