-- ============================================================
-- 投标助手模块 — 数据库表
-- ============================================================

-- 草稿表
CREATE TABLE IF NOT EXISTS bid_assistant_drafts (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_name TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL DEFAULT '',
    chapters JSONB NOT NULL DEFAULT '[]',
    source_data BYTEA,  -- 源 .docx 文件二进制数据
    status TEXT NOT NULL DEFAULT 'editing',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 草稿表索引：按用户查询（高频查询）
CREATE INDEX IF NOT EXISTS idx_bid_drafts_user_id ON bid_assistant_drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_bid_drafts_user_updated ON bid_assistant_drafts(user_id, updated_at DESC);

-- 兼容迁移：为已存在的表添加 source_data 字段，迁移旧文件数据，删除旧的 source_file 字段
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bid_assistant_drafts' AND column_name='source_data') THEN
        ALTER TABLE bid_assistant_drafts ADD COLUMN source_data BYTEA;
    END IF;
    -- 注意：source_file → source_data 的数据迁移需在应用层执行（Node.js 脚本读取文件并写入 BYTEA）
    -- 迁移完成后再执行以下 DROP COLUMN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bid_assistant_drafts' AND column_name='source_file') THEN
        ALTER TABLE bid_assistant_drafts DROP COLUMN source_file;
    END IF;
END $$;

-- 固定内容模板表
CREATE TABLE IF NOT EXISTS bid_assistant_templates (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    sections JSONB DEFAULT '[]',  -- 多段落模板: [{name, content}, ...]
    created_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 兼容迁移：为模板表添加 sections 字段，删除已废弃的 source_file 字段
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bid_assistant_templates' AND column_name='sections') THEN
        ALTER TABLE bid_assistant_templates ADD COLUMN sections JSONB DEFAULT '[]';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bid_assistant_templates' AND column_name='source_file') THEN
        ALTER TABLE bid_assistant_templates DROP COLUMN source_file;
    END IF;
END $$;
