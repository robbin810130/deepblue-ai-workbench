/**
 * 管理后台 · 用户管理页签
 *
 *   GET    /api/admin/users              列表（search / role / page / pageSize）
 *   POST   /api/admin/users              新建
 *   PUT    /api/admin/users/:id          改姓名/邮箱/角色
 *   PUT    /api/admin/users/:id/status   启用/停用（不能停自己）
 *   POST   /api/admin/users/:id/reset-password
 *   DELETE /api/admin/users/:id          删除（不能删自己）
 */
import { useCallback, useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { cn } from '../../components/ui/cn';
import { api, type AdminRole, type AdminUser } from '../../api/client';
import { Banner, Panel, PrimaryButton, SubButton, errText, fmtDateTime } from './ui';

interface Draft {
  id?: number;
  username: string;
  password: string;
  display_name: string;
  email: string;
  role: string;
}

const EMPTY: Draft = { username: '', password: '', display_name: '', email: '', role: 'user' };

export function UsersTab() {
  const [list, setList] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetFor, setResetFor] = useState<AdminUser | null>(null);
  const [resetPwd, setResetPwd] = useState('');
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  const pageSize = 20;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.admin
      .users({ search, role: roleFilter, page, pageSize })
      .then((r) => {
        setList(r.list);
        setTotal(r.total);
      })
      .catch((e) => {
        setList([]);
        setError(errText(e));
      })
      .finally(() => setLoading(false));
  }, [search, roleFilter, page]);

  useEffect(load, [load]);

  useEffect(() => {
    api.admin
      .roles()
      .then(setRoles)
      .catch(() => setRoles([]));
  }, []);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (draft.id) {
        await api.admin.updateUser(draft.id, {
          display_name: draft.display_name,
          email: draft.email,
          role: draft.role,
        });
        setNotice(`已更新账号 ${draft.username}。`);
      } else {
        await api.admin.createUser({
          username: draft.username,
          password: draft.password,
          display_name: draft.display_name,
          email: draft.email,
          role: draft.role,
        });
        setNotice(`已创建账号 ${draft.username}。`);
      }
      setDraft(null);
      load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (u: AdminUser) => {
    setError(null);
    setNotice(null);
    try {
      await api.admin.setUserStatus(u.id, !u.is_active);
      setNotice(`账号 ${u.username} 已${u.is_active ? '停用' : '启用'}。`);
      load();
    } catch (e) {
      setError(errText(e));
    }
  };

  const doReset = async () => {
    if (!resetFor) return;
    setSaving(true);
    setError(null);
    try {
      await api.admin.resetPassword(resetFor.id, resetPwd);
      setNotice(`已重置 ${resetFor.username} 的密码。`);
      setResetFor(null);
      setResetPwd('');
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async (id: number) => {
    setError(null);
    try {
      await api.admin.removeUser(id);
      setPendingDelete(null);
      setNotice('账号已删除。');
      load();
    } catch (e) {
      setError(errText(e));
    }
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <Panel
        title="账号管理"
        hint={`共 ${total} 个账号；角色来自「角色管理」，增删改均写入审计日志。`}
        actions={
          <>
            <select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setPage(1);
              }}
              aria-label="按角色筛选"
              className="h-8 rounded-lg border border-line bg-page px-2 text-caption text-ink-soft focus:border-primary-300 focus:outline-none"
            >
              <option value="">全部角色</option>
              {roles.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.display_name}
                </option>
              ))}
            </select>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setSearch(searchInput.trim());
                  setPage(1);
                }
              }}
              placeholder="搜索用户名/姓名/邮箱…"
              aria-label="搜索账号"
              className="h-8 w-48 rounded-lg border border-line bg-page px-2 text-caption text-ink placeholder:text-ink-faint focus:border-primary-300 focus:outline-none"
            />
            <PrimaryButton onClick={() => setDraft({ ...EMPTY })}>
              <UserPlus size={14} /> 新建账号
            </PrimaryButton>
          </>
        }
      >
        {error && <Banner tone="error" onClose={() => setError(null)}>{error}</Banner>}
        {notice && <Banner tone="success" onClose={() => setNotice(null)}>{notice}</Banner>}

        {/* 新建 / 编辑表单 */}
        {draft && (
          <div className="mb-4 rounded-lg border border-primary-200 bg-primary-50/40 px-4 py-3">
            <p className="text-caption font-medium text-ink">
              {draft.id ? `编辑账号：${draft.username}` : '新建账号'}
            </p>
            <div className="mt-2.5 grid grid-cols-4 gap-3">
              <label className="block">
                <span className="text-[11px] text-ink-soft">用户名</span>
                <input
                  value={draft.username}
                  disabled={Boolean(draft.id)}
                  onChange={(e) => setDraft({ ...draft, username: e.target.value })}
                  className="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2 text-caption text-ink focus:border-primary-300 focus:outline-none disabled:bg-surface-sunken"
                />
              </label>
              {!draft.id && (
                <label className="block">
                  <span className="text-[11px] text-ink-soft">初始密码（≥6 位）</span>
                  <input
                    type="password"
                    value={draft.password}
                    onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                    className="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2 text-caption text-ink focus:border-primary-300 focus:outline-none"
                  />
                </label>
              )}
              <label className="block">
                <span className="text-[11px] text-ink-soft">显示姓名</span>
                <input
                  value={draft.display_name}
                  onChange={(e) => setDraft({ ...draft, display_name: e.target.value })}
                  className="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2 text-caption text-ink focus:border-primary-300 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-ink-soft">邮箱</span>
                <input
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  className="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2 text-caption text-ink focus:border-primary-300 focus:outline-none"
                />
              </label>
            </div>
            <div className="mt-3 flex items-center gap-2.5">
              <label className="flex items-center gap-2">
                <span className="text-[11px] text-ink-soft">角色</span>
                <select
                  value={draft.role}
                  onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                  className="h-8 rounded-md border border-line bg-surface px-2 text-caption text-ink focus:border-primary-300 focus:outline-none"
                >
                  {roles.map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <PrimaryButton onClick={save} loading={saving}>
                保存
              </PrimaryButton>
              <SubButton onClick={() => setDraft(null)}>取消</SubButton>
            </div>
          </div>
        )}

        {/* 重置密码 */}
        {resetFor && (
          <div className="mb-4 rounded-lg border border-warning bg-warning-soft/60 px-4 py-3">
            <p className="text-caption font-medium text-ink">
              重置「{resetFor.username}」的密码（至少 6 位）
            </p>
            <div className="mt-2 flex items-center gap-2.5">
              <input
                type="password"
                value={resetPwd}
                onChange={(e) => setResetPwd(e.target.value)}
                className="h-8 w-56 rounded-md border border-line bg-surface px-2 text-caption text-ink focus:border-primary-300 focus:outline-none"
              />
              <PrimaryButton onClick={doReset} loading={saving} disabled={resetPwd.length < 6}>
                确认重置
              </PrimaryButton>
              <SubButton
                onClick={() => {
                  setResetFor(null);
                  setResetPwd('');
                }}
              >
                取消
              </SubButton>
            </div>
          </div>
        )}

        {loading && <p className="py-8 text-center text-caption text-ink-faint">加载中…</p>}

        {!loading && list.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line bg-page text-caption text-ink-faint">
                  <th className="px-4 py-2.5 font-medium">账号</th>
                  <th className="px-3 py-2.5 font-medium">角色</th>
                  <th className="px-3 py-2.5 font-medium">邮箱</th>
                  <th className="px-3 py-2.5 font-medium">状态</th>
                  <th className="px-3 py-2.5 font-medium">最后登录</th>
                  <th className="px-4 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.id} className="border-b border-line/50 last:border-b-0 hover:bg-page">
                    <td className="px-4 py-2.5">
                      <p className="text-lead text-ink">{u.display_name || u.username}</p>
                      <p className="mt-0.5 text-[11px] text-ink-faint">{u.username}</p>
                    </td>
                    <td className="px-3 py-2.5 text-caption text-ink-soft">{u.role_label || u.role}</td>
                    <td className="px-3 py-2.5 text-caption text-ink-soft">{u.email || '—'}</td>
                    <td className="px-3 py-2.5">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-caption font-medium',
                          u.is_active ? 'bg-success-soft text-success' : 'bg-surface-sunken text-ink-soft',
                        )}
                      >
                        <span className={cn('h-1.5 w-1.5 rounded-full', u.is_active ? 'bg-success' : 'bg-ink-faint')} />
                        {u.is_active ? '正常' : '已停用'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-caption text-ink-faint">{fmtDateTime(u.last_login_at)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="inline-flex items-center gap-2.5">
                        <SubButton
                          onClick={() =>
                            setDraft({
                              id: u.id,
                              username: u.username,
                              password: '',
                              display_name: u.display_name || u.username,
                              email: u.email || '',
                              role: u.role,
                            })
                          }
                        >
                          编辑
                        </SubButton>
                        <SubButton onClick={() => toggleStatus(u)}>{u.is_active ? '停用' : '启用'}</SubButton>
                        <SubButton onClick={() => setResetFor(u)}>重置密码</SubButton>
                        {pendingDelete === u.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => doDelete(u.id)}
                              className="text-caption font-medium text-danger hover:underline"
                            >
                              确认删除
                            </button>
                            <SubButton onClick={() => setPendingDelete(null)}>取消</SubButton>
                          </>
                        ) : (
                          <SubButton danger onClick={() => setPendingDelete(u.id)}>
                            删除
                          </SubButton>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && list.length === 0 && (
          <p className="py-8 text-center text-caption text-ink-faint">没有匹配的账号。</p>
        )}

        {pages > 1 && (
          <div className="mt-3 flex items-center justify-between text-caption text-ink-soft">
            <span>
              第 {page} / {pages} 页
            </span>
            <span className="flex items-center gap-2">
              <SubButton onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</SubButton>
              <SubButton onClick={() => setPage((p) => Math.min(pages, p + 1))}>下一页</SubButton>
            </span>
          </div>
        )}
      </Panel>
    </>
  );
}
