/**
 * 管理后台 —— /admin/*
 *
 * 依据：06_前端页面详细PRD §9（模块：业务场景 / 技能管理 / Workflow 绑定 /
 *      Agent 配置 / 权限 / 审计日志）
 *
 * 本系统实际落地为 6 个页签（与后端已有权限域一一对应）：
 *   权限        角色 × 技能授权（M6 技能级模型，含数据范围）
 *   用户        账号 CRUD / 启停 / 重置密码
 *   角色        角色 CRUD + 旧版 appId 权限码勾选
 *   业务看板    看板入口登记（datasource: sys_dashboards）
 *   审计日志    谁在何时做了什么
 *   系统配置    DB 连通 / 资讯关键词词库 / 出海营销参考数据
 *
 * 路由为 /admin/*，页签由 URL 决定，便于直接分享某页签链接。
 */
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '../../components/ui/cn';
import { PermissionTab } from './PermissionTab';
import { UsersTab } from './UsersTab';
import { RolesTab } from './RolesTab';
import { DashboardsTab } from './DashboardsTab';
import { AuditTab } from './AuditTab';
import { ConfigTab } from './ConfigTab';

const TABS = [
  { key: 'permissions', label: '技能权限' },
  { key: 'users', label: '用户管理' },
  { key: 'roles', label: '角色管理' },
  { key: 'dashboards', label: '业务看板' },
  { key: 'audit', label: '审计日志' },
  { key: 'config', label: '系统配置' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function AdminPage() {
  const location = useLocation();
  const nav = useNavigate();
  const sub = location.pathname.replace(/^\/admin\/?/, '').split('/')[0];
  const active: TabKey = (TABS.some((t) => t.key === sub) ? sub : 'permissions') as TabKey;

  return (
    <div className="mx-auto w-full max-w-[1120px] px-8 py-7">
      <header>
        <h1 className="text-title font-semibold text-ink">管理后台</h1>
        <p className="mt-1 text-caption text-ink-soft">
          技能授权、账号与角色、看板入口、审计追溯与系统配置；危险操作均需二次确认。
        </p>
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => nav(`/admin/${t.key}`)}
            aria-selected={active === t.key}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-body font-medium transition-colors',
              active === t.key
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-ink-soft hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active === 'permissions' && <PermissionTab />}
      {active === 'users' && <UsersTab />}
      {active === 'roles' && <RolesTab />}
      {active === 'dashboards' && <DashboardsTab />}
      {active === 'audit' && <AuditTab />}
      {active === 'config' && <ConfigTab />}
    </div>
  );
}
