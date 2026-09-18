-- ============================================================
-- 招标检索结果表
-- 存储从 Dify 工作流获取的招标公告数据
-- ============================================================

CREATE TABLE IF NOT EXISTS sys_tender_results (
    id                  SERIAL PRIMARY KEY,
    batch_id            VARCHAR(64) NOT NULL,           -- 批次号（每次执行生成唯一ID）
    bid_id              VARCHAR(200) DEFAULT '',        -- 招标ID（Dify返回）
    bid_no              VARCHAR(200) DEFAULT '',        -- 招标编号
    bid_type            INTEGER DEFAULT 0,              -- 招标类型
    bid_process         INTEGER DEFAULT 0,              -- 招标流程
    bidder_name         VARCHAR(500) DEFAULT '',        -- 投标方名称
    project_name        VARCHAR(500) DEFAULT '',        -- 项目全称
    biz_type            VARCHAR(100) DEFAULT '',        -- 业务类型
    project_amount      VARCHAR(200) DEFAULT '',        -- 项目金额
    channel_type        VARCHAR(100) DEFAULT '',        -- 渠道类型
    region              VARCHAR(200) DEFAULT '',        -- 投标所在地区
    bidder_count        INTEGER DEFAULT 0,              -- 入围商家数量
    budget_amount       VARCHAR(200) DEFAULT '',        -- 预算金额（采购标的额）
    file_acquire_time   VARCHAR(100) DEFAULT '',        -- 文件获取时间
    file_acquire_method VARCHAR(200) DEFAULT '',        -- 文件获取方式
    bid_doc_fee         VARCHAR(100) DEFAULT '',        -- 招标文件费用
    deadline            VARCHAR(100) DEFAULT '',        -- 投标截止时间
    bid_method          VARCHAR(100) DEFAULT '',        -- 应标方式
    source_site         VARCHAR(200) DEFAULT '',        -- 来源网站
    link                VARCHAR(1000) DEFAULT '',       -- 跳转链接
    candidate_names     JSONB DEFAULT '[]'::jsonb,       -- 候选人名称
    winning_company     VARCHAR(500) DEFAULT '',         -- 中标公司
    winning_amount      VARCHAR(200) DEFAULT '',         -- 交付金额
    announcement_date   VARCHAR(100) DEFAULT '',         -- 公示时间
    is_starred          BOOLEAN DEFAULT FALSE,          -- 是否星标
    synced_at           TIMESTAMPTZ,                    -- 最后同步时间
    sync_status         VARCHAR(100) DEFAULT '',        -- 同步状态
    created_at          TIMESTAMPTZ DEFAULT NOW()       -- 入库时间
);

-- 索引：支持分页查询和按字段筛选
CREATE INDEX IF NOT EXISTS idx_tender_batch_id ON sys_tender_results(batch_id);
CREATE INDEX IF NOT EXISTS idx_tender_created_at ON sys_tender_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tender_bidder_name ON sys_tender_results(bidder_name);
CREATE INDEX IF NOT EXISTS idx_tender_project_name ON sys_tender_results(project_name);
CREATE INDEX IF NOT EXISTS idx_tender_region ON sys_tender_results(region);
CREATE INDEX IF NOT EXISTS idx_tender_biz_type ON sys_tender_results(biz_type);
