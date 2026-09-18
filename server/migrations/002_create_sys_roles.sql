-- ============================================================
-- 动态角色系统迁移
-- 文件: 002_create_sys_roles.sql
-- ============================================================

-- 1. 创建 sys_roles 表
CREATE TABLE IF NOT EXISTS sys_roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,         -- 角色标识符（英文/中文均可）
    display_name VARCHAR(100) NOT NULL,        -- 界面显示名称
    is_builtin BOOLEAN NOT NULL DEFAULT FALSE, -- 内置角色不允许删除
    permissions JSONB NOT NULL DEFAULT '[]',   -- 允许访问的 appId 数组
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sys_roles_name ON sys_roles(name);

-- 2. 插入内置角色（admin 全部权限、user 标准权限）
INSERT INTO sys_roles (name, display_name, is_builtin, permissions) VALUES
(
    'admin',
    '管理员',
    TRUE,
    '["market","prediction","customer","supply","aiimage","rules","news","layoutcompare","contractaudit","seamarketing","beautyrnd","materialquote","usermanage","permissions"]'::jsonb
),
(
    'user',
    '普通用户',
    TRUE,
    '["market","prediction","customer","rules","news","contractaudit","seamarketing","beautyrnd","materialquote","aiimage"]'::jsonb
)
ON CONFLICT (name) DO NOTHING;

-- 3. 移除 sys_users.role 的硬编码 CHECK 约束
ALTER TABLE sys_users DROP CONSTRAINT IF EXISTS sys_users_role_check;

-- 4. 确保现有 user 记录中的 role 值有效（readonly 不再支持，改为 user）
UPDATE sys_users SET role = 'user' WHERE role = 'readonly';

COMMENT ON TABLE sys_roles IS '动态角色表：内置角色 + 管理员自定义角色';
COMMENT ON COLUMN sys_roles.permissions IS 'JSONB 数组，存储允许访问的 appId 字符串列表';
COMMENT ON COLUMN sys_roles.is_builtin IS '内置角色（admin/user）不允许删除，但可调整权限';
