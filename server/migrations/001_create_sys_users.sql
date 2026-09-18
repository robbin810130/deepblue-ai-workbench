-- ============================================================
-- 用户管理系统数据库迁移
-- 文件: 001_create_sys_users.sql
-- ============================================================

-- 创建 sys_users 表
CREATE TABLE IF NOT EXISTS sys_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100),
    email VARCHAR(200),
    role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'readonly')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    avatar_url VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_sys_users_username ON sys_users(username);
CREATE INDEX IF NOT EXISTS idx_sys_users_role ON sys_users(role);
CREATE INDEX IF NOT EXISTS idx_sys_users_is_active ON sys_users(is_active);

-- 迁移现有用户（users.json 中已有的 admin 和 user）
-- 密码哈希均为 bcrypt 生成，直接复用
INSERT INTO sys_users (username, password_hash, display_name, role)
VALUES
    ('admin',  '$2b$10$Gq6FNFouaS2XTaqjIi0MyOsFizuyw2rUWLu1AwqzBmxKX3DFoVhDW', '系统管理员', 'admin'),
    ('user',   '$2b$10$ICwMBfWtQARekOphSxTrXO.IxgS07.b9JoWhcgD.33skaJTOpx4Cq', '普通用户', 'user')
ON CONFLICT (username) DO NOTHING;

COMMENT ON TABLE sys_users IS '系统用户管理表';
COMMENT ON COLUMN sys_users.role IS '角色: admin=超级管理员, user=普通用户, readonly=只读';
COMMENT ON COLUMN sys_users.is_active IS '账号状态: true=启用, false=禁用';
