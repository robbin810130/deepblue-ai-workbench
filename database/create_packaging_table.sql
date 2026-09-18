-- 物流耗材数据表（纸箱/快递袋/套头等包装材料）
CREATE TABLE IF NOT EXISTS sys_logistics_packaging (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL DEFAULT '',  -- 名称，如 邮政8号纸箱
    attribute   VARCHAR(50) NOT NULL DEFAULT '',   -- 属性，如 3层纸箱、5层纸箱、快递袋、套头
    category    VARCHAR(20) NOT NULL,              -- carton_3 / carton_5 / express_bag / sleeve
    spec        VARCHAR(200) NOT NULL DEFAULT '',  -- 完整规格描述
    dim_l       NUMERIC(8,2) NOT NULL DEFAULT 0,  -- 长(cm)
    dim_w       NUMERIC(8,2) NOT NULL DEFAULT 0,  -- 宽(cm)
    dim_h       NUMERIC(8,2) NOT NULL DEFAULT 0,  -- 高(cm)
    volume      NUMERIC(12,2) NOT NULL DEFAULT 0, -- 容积(cm³)
    price       NUMERIC(10,4) NOT NULL DEFAULT 0, -- 单价(元)
    weight      NUMERIC(10,3) NOT NULL DEFAULT 0, -- 重量(kg)
    sort_order  INT DEFAULT 0,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE sys_logistics_packaging IS '物流费计算模块-耗材价格表';
