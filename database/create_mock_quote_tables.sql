-- 物料智能报价系统优化：虚拟数据表定义与种子数据 Seeding 脚本

-- 1. 客户信用账期与风控评级表
CREATE TABLE IF NOT EXISTS sys_mock_customer_credit (
    id                  SERIAL PRIMARY KEY,
    customer_name       VARCHAR(100) NOT NULL UNIQUE,       -- 客户名称
    credit_limit        NUMERIC(12,2) NOT NULL DEFAULT 0.00,-- 信用额度 (元)
    outstanding_balance NUMERIC(12,2) NOT NULL DEFAULT 0.00,-- 拖欠/应收金额 (元)
    overdue_amount      NUMERIC(12,2) NOT NULL DEFAULT 0.00,-- 超期拖欠金额 (元)
    credit_status       VARCHAR(20) NOT NULL DEFAULT '良好',  -- 良好 / 预警 / 严重超期
    risk_level          VARCHAR(10) NOT NULL DEFAULT 'B'    -- 风险等级 (AA/AAA/A/D等)
);

-- 2. 客户特批合同与定价规则条款表
CREATE TABLE IF NOT EXISTS sys_mock_customer_contracts (
    id                  SERIAL PRIMARY KEY,
    customer_name       VARCHAR(100) NOT NULL,
    contract_no         VARCHAR(50) NOT NULL UNIQUE,        -- 合同编号
    copper_price_type   VARCHAR(20) NOT NULL,               -- 现货价 / 点铜 / 月均价
    base_processing_fee NUMERIC(10,2) NOT NULL,             -- 合同特批基础加工费/米 (元/m)
    markup_ratio        NUMERIC(4,2) NOT NULL DEFAULT 1.00, -- 合同额外加价系数 (如 1.00-1.20)
    valid_until         TIMESTAMP NOT NULL                  -- 合同截止有效期
);

-- 3. 物料工艺规格重量及标准定额加工费参数字典
CREATE TABLE IF NOT EXISTS sys_mock_material_specs (
    material_no         VARCHAR(50) PRIMARY KEY,            -- 匹配成品料号 (e.g. Mat-YJV4x25)
    model_name          VARCHAR(50) NOT NULL,               -- 规格名称 (e.g. YJV-4*25)
    copper_weight_km    NUMERIC(8,3) NOT NULL,              -- 每公里理论铜重 (吨/km，即 kg/m)
    insulation_weight_km NUMERIC(8,3) NOT NULL,             -- 每公里理论护套绝缘重 (吨/km)
    standard_unit_weight NUMERIC(8,3) NOT NULL,             -- 每米理论总重 (kg/m)
    standard_processing_fee NUMERIC(10,2) NOT NULL          -- ERP标准定额加工工时费/米 (元/m)
);

-- 4. 物料实物与备货成品库存表
CREATE TABLE IF NOT EXISTS sys_mock_material_stock (
    id                  SERIAL PRIMARY KEY,
    material_no         VARCHAR(50) NOT NULL REFERENCES sys_mock_material_specs(material_no) ON DELETE CASCADE,
    warehouse_name      VARCHAR(50) NOT NULL,               -- 存放成品仓库
    qty_on_hand         NUMERIC(10,2) NOT NULL DEFAULT 0,   -- 实物库存量 (米)
    qty_allocated        NUMERIC(10,2) NOT NULL DEFAULT 0,   -- 被占用/锁库数量 (米)
    UNIQUE(material_no, warehouse_name)
);

-- 5. 机台规格物理能力与生产负荷队列等待表
CREATE TABLE IF NOT EXISTS sys_mock_machine_queues (
    id                  SERIAL PRIMARY KEY,
    machine_id          VARCHAR(20) NOT NULL UNIQUE,        -- 设备ID (e.g. Ext-03)
    machine_name        VARCHAR(50) NOT NULL,               -- 设备名称 (e.g. 挤塑3号线)
    capable_specs       TEXT NOT NULL,                      -- 物理能力适用规格列表 (逗号隔开)
    current_load_percent INT NOT NULL DEFAULT 50,           -- 产能占用百分比
    queue_duration_hours NUMERIC(6,2) NOT NULL DEFAULT 0.00,-- 当前待产排队总耗时 (小时)
    last_produced_spec  VARCHAR(50),                        -- 上一个正在/刚加工完的规格
    standard_lead_time_km NUMERIC(4,1) NOT NULL DEFAULT 1.0 -- 每千米电缆标准加工耗时 (小时/km)
);

-- 6. 模拟 ERP 内部正式订单归口表 (一键同步目标)
CREATE TABLE IF NOT EXISTS sys_mock_erp_orders (
    id                  VARCHAR(50) PRIMARY KEY,            -- 订单号 (SO-YyyyMMddxxx)
    customer_name       VARCHAR(100) NOT NULL,
    material_no         VARCHAR(50) NOT NULL REFERENCES sys_mock_material_specs(material_no) ON DELETE CASCADE,
    qty                 NUMERIC(10,2) NOT NULL,             -- 数量 (米)
    unit_price          NUMERIC(10,2) NOT NULL,             -- 成交单价
    total_amount        NUMERIC(12,2) NOT NULL,             -- 合计金额
    delivery_date       DATE NOT NULL,                      -- 交期
    copper_price_type   VARCHAR(20) NOT NULL,               -- 报价铜价条款类型
    copper_base_price   NUMERIC(10,2) NOT NULL,             -- 基准铜价结算值
    machine_assigned    VARCHAR(50),                        -- 分配推荐的加工机台
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- 种子数据 Seeding
-- ============================================================

-- 1. 注入模拟客户信用及账期
INSERT INTO sys_mock_customer_credit (customer_name, credit_limit, outstanding_balance, overdue_amount, credit_status, risk_level) VALUES
('深圳市腾讯计算机系统有限公司', 2000000.00, 234000.00, 0.00, '良好', 'AA'),
('华为技术有限公司', 5000000.00, 1200000.00, 0.00, '良好', 'AAA'),
('比亚迪股份有限公司', 3000000.00, 1850000.00, 150000.00, '预警', 'A'),
('烂尾楼开发商(深圳)有限公司', 500000.00, 480000.00, 320000.00, '严重超期', 'D')
ON CONFLICT (customer_name) DO UPDATE SET
credit_limit = EXCLUDED.credit_limit,
outstanding_balance = EXCLUDED.outstanding_balance,
overdue_amount = EXCLUDED.overdue_amount,
credit_status = EXCLUDED.credit_status,
risk_level = EXCLUDED.risk_level;

-- 2. 注入定价合同条款
INSERT INTO sys_mock_customer_contracts (customer_name, contract_no, copper_price_type, base_processing_fee, markup_ratio, valid_until) VALUES
('深圳市腾讯计算机系统有限公司', 'CONT-2026-TX01', '现货价', 25.00, 1.00, '2027-12-31 23:59:59'),
('华为技术有限公司', 'CONT-2026-HW03', '月均价', 22.00, 0.95, '2027-06-30 23:59:59'),
('比亚迪股份有限公司', 'CONT-2026-BYD02', '点铜', 28.00, 1.05, '2026-12-31 23:59:59'),
('烂尾楼开发商(深圳)有限公司', 'CONT-2026-LW01', '现货价', 35.00, 1.20, '2026-06-30 23:59:59')
ON CONFLICT (contract_no) DO UPDATE SET
customer_name = EXCLUDED.customer_name,
copper_price_type = EXCLUDED.copper_price_type,
base_processing_fee = EXCLUDED.base_processing_fee,
markup_ratio = EXCLUDED.markup_ratio,
valid_until = EXCLUDED.valid_until;

-- 3. 注入成品物理工艺字典
INSERT INTO sys_mock_material_specs (material_no, model_name, copper_weight_km, insulation_weight_km, standard_unit_weight, standard_processing_fee) VALUES
('Mat-YJV4x25', 'YJV-4*25', 0.907, 0.903, 1.810, 13.00),
('Mat-YJV4x16', 'YJV-4*16', 0.580, 0.670, 1.250, 22.00),
('Mat-BV2.5', 'BV-2.5', 0.022, 0.013, 0.035, 1.80),
('Mat-VV4x50', 'VV-4*50', 1.820, 1.680, 3.500, 45.00)
ON CONFLICT (material_no) DO UPDATE SET
model_name = EXCLUDED.model_name,
copper_weight_km = EXCLUDED.copper_weight_km,
insulation_weight_km = EXCLUDED.insulation_weight_km,
standard_unit_weight = EXCLUDED.standard_unit_weight,
standard_processing_fee = EXCLUDED.standard_processing_fee;

-- 4. 注入备货实物库存
INSERT INTO sys_mock_material_stock (material_no, warehouse_name, qty_on_hand, qty_allocated) VALUES
('Mat-YJV4x25', '1号成品库', 1200.00, 400.00),
('Mat-YJV4x25', '2号周转库', 300.00, 0.00),
('Mat-YJV4x16', '1号成品库', 80.00, 80.00),
('Mat-BV2.5', '1号成品库', 50000.00, 15000.00),
('Mat-VV4x50', '1号成品库', 150.00, 50.00)
ON CONFLICT (material_no, warehouse_name) DO UPDATE SET
qty_on_hand = EXCLUDED.qty_on_hand,
qty_allocated = EXCLUDED.qty_allocated;

-- 5. 注入物理机台负荷状况
INSERT INTO sys_mock_machine_queues (machine_id, machine_name, capable_specs, current_load_percent, queue_duration_hours, last_produced_spec, standard_lead_time_km) VALUES
('Ext-03', '挤塑3号线', 'Mat-YJV4x25,Mat-YJV4x16', 85, 18.5, 'Mat-YJV4x25', 1.5),
('Ext-05', '挤塑5号线', 'Mat-YJV4x25,Mat-VV4x50', 60, 4.0, 'Mat-VV4x50', 2.0),
('Strand-01', '绞线1号线', 'Mat-BV2.5', 45, 2.0, 'Mat-BV2.5', 0.5)
ON CONFLICT (machine_id) DO UPDATE SET
machine_name = EXCLUDED.machine_name,
capable_specs = EXCLUDED.capable_specs,
current_load_percent = EXCLUDED.current_load_percent,
queue_duration_hours = EXCLUDED.queue_duration_hours,
last_produced_spec = EXCLUDED.last_produced_spec,
standard_lead_time_km = EXCLUDED.standard_lead_time_km;
