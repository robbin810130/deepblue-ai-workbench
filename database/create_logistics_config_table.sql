-- 物流费计算配置表（key-value 结构，支持用户自定义价格）
CREATE TABLE IF NOT EXISTS sys_logistics_config (
    id          SERIAL PRIMARY KEY,
    config_key  VARCHAR(100) NOT NULL UNIQUE,
    config_val  NUMERIC(14,6) NOT NULL DEFAULT 0,
    remark      VARCHAR(200) DEFAULT '',
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE sys_logistics_config IS '物流费计算模块价格配置表';
