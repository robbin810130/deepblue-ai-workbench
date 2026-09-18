-- ============================================================
-- 企业资质库模块 (Enterprise Qualification Library) 建表脚本
-- ============================================================

-- 1. 字典表：统一承载公司主体、一级分类、二级分类
CREATE TABLE IF NOT EXISTS eq_dict (
    id          SERIAL PRIMARY KEY,
    dict_type   VARCHAR(20) NOT NULL,           -- entity / category_l1 / category_l2
    parent_id   INTEGER REFERENCES eq_dict(id), -- 二级分类指向所属一级分类，主体和一级分类为 NULL
    name        VARCHAR(255) NOT NULL,
    sort_order  INTEGER DEFAULT 0,
    is_enabled  BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eq_dict_type ON eq_dict(dict_type);
CREATE INDEX IF NOT EXISTS idx_eq_dict_parent ON eq_dict(parent_id);

-- 2. 资产表
CREATE TABLE IF NOT EXISTS eq_asset (
    id                  SERIAL PRIMARY KEY,
    asset_name          VARCHAR(255) NOT NULL,
    entity_id           INTEGER REFERENCES eq_dict(id),
    category_l1_id      INTEGER REFERENCES eq_dict(id),
    category_l2_id      INTEGER REFERENCES eq_dict(id),
    asset_no_masked     VARCHAR(100),            -- 证照/凭证编号
    owner               VARCHAR(100),           -- 负责人
    effective_date      DATE,
    expiry_date         DATE,
    status              VARCHAR(20) DEFAULT '有效', -- 有效 / 待更新 / 已废弃 / 仅供参考
    sensitivity         VARCHAR(20) DEFAULT '公开', -- 敏感度：公开 / 受限 / 高敏感
    visible_departments TEXT[] DEFAULT '{}',     -- 可见部门数组
    extra_fields        JSONB DEFAULT '{}',     -- 类型专属字段
    sync_to_dify        BOOLEAN DEFAULT FALSE,  -- 是否推送 Dify 知识库
    remark              TEXT,                    -- 备注
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eq_asset_entity ON eq_asset(entity_id);
CREATE INDEX IF NOT EXISTS idx_eq_asset_category_l1 ON eq_asset(category_l1_id);
CREATE INDEX IF NOT EXISTS idx_eq_asset_category_l2 ON eq_asset(category_l2_id);
CREATE INDEX IF NOT EXISTS idx_eq_asset_status ON eq_asset(status);
CREATE INDEX IF NOT EXISTS idx_eq_asset_expiry ON eq_asset(expiry_date);
CREATE INDEX IF NOT EXISTS idx_eq_asset_sync ON eq_asset(sync_to_dify);

-- 3. 附件表
CREATE TABLE IF NOT EXISTS eq_attachment (
    id              SERIAL PRIMARY KEY,
    asset_id        INTEGER NOT NULL REFERENCES eq_asset(id) ON DELETE CASCADE,
    file_path       VARCHAR(500) NOT NULL,
    folder_path     VARCHAR(500) DEFAULT '',
    original_name   VARCHAR(255) NOT NULL,
    file_size       BIGINT DEFAULT 0,
    is_primary      BOOLEAN DEFAULT FALSE,
    sort_order      INTEGER DEFAULT 0,
    checksum        VARCHAR(64),                -- SHA-256 校验值
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eq_attachment_asset ON eq_attachment(asset_id);

-- 4. 凭证表（不设任何明文字段）
CREATE TABLE IF NOT EXISTS eq_credential (
    id              SERIAL PRIMARY KEY,
    asset_id        INTEGER NOT NULL REFERENCES eq_asset(id) ON DELETE CASCADE,
    cred_type       VARCHAR(20) NOT NULL,       -- password / key / token / certificate
    ciphertext      TEXT NOT NULL,              -- AES-256-GCM 加密密文
    algorithm       VARCHAR(20) DEFAULT 'AES-256-GCM',
    recovery_method VARCHAR(255),
    rotation_days   INTEGER,
    last_rotation   DATE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eq_credential_asset ON eq_credential(asset_id);

-- 5. 同步日志表（仅记录 sync_to_dify = true 的资产推送结果）
CREATE TABLE IF NOT EXISTS eq_sync_log (
    id              SERIAL PRIMARY KEY,
    asset_id        INTEGER NOT NULL REFERENCES eq_asset(id) ON DELETE CASCADE,
    sync_action     VARCHAR(20) NOT NULL,       -- create / update / disable / delete
    sync_status     VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending / success / failed
    error_message   TEXT,
    synced_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eq_sync_log_asset ON eq_sync_log(asset_id);
CREATE INDEX IF NOT EXISTS idx_eq_sync_log_status ON eq_sync_log(sync_status);
