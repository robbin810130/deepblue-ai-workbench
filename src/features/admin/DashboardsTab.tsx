/**
 * 管理后台 · 业务看板页签
 *
 *   GET    /api/dashboards/admin       全量列表（含角色授权）
 *   POST   /api/dashboards/admin       新建
 *   PUT    /api/dashboards/admin/:id   修改
 *   DELETE /api/dashboards/admin/:id   删除
 *
 * 这是「数据看板」页里业务看板入口的来源：allowed_roles 含 '*' 或当前用户角色
 * 才会在 /dashboard 展示，所以这里的授权直接决定普通用户能看到什么。
 */
import { useEffect, useState } from 'react';
import { cn } from '../../components/ui/cn';
import { api, type AdminRole, type ApiDashboard } from '../../api/client';
import { Banner, Panel, PrimaryButton, SubButton, TextField, errText } from './ui';

interface Draft {
  id?: number;
  name: string;
  url: string;
  description: string;
  category: string;
  allowed_roles: string[];
  sort_order: number;
}

const EMPTY: Draft = {
  name: '',
  url: '',
  description: '',
  category: '通用',
  allowed_roles: ['*'],
  sort_order: 0,
};

function roleList(v: ApiDashboard['allowed_roles']): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function DashboardsTab() {
  const [list, setList] = useState<ApiDashboard[] | null>(null);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  const load = () => {
    api.dashboards
      .adminList()
      .then(setList)
      .catch((e) => {
        setList([]);
        setError(errText(e));
      });
  };

  useEffect(() => {
    load();
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
      const payload = {
        name: draft.name.trim(),
        url: draft.url.trim(),
        description: draft.description.trim(),
        category: draft.category.trim() || '通用',
        allowed_roles: draft.allowed_roles,
        sort_order: draft.sort_order,
      };
      if (draft.id) {
        await api.dashboards.update(draft.id, payload);
        setNotice(`已更新看板「${payload.name}」。`);
      } else {
        await api.dashboards.create(payload);
        setNotice(`已新建看板「${payload.name}」。`);
      }
      setDraft(null);
      load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async (id: number) => {
    setError(null);
    try {
      await api.dashboards.remove(id);
      setPendingDelete(null);
      setNotice('看板已删除。');
      load();
    } catch (e) {
      setError(errText(e));
    }
  };

  const toggleRole = (roleName: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      allowed_roles: draft.allowed_roles.includes(roleName)
        ? draft.allowed_roles.filter((r) => r !== roleName)
        : [...draft.allowed_roles, roleName],
    });
  };

  const canSave = Boolean(draft && draft.name.trim() && draft.url.trim());

  return (
    <Panel
      title="业务看板入口"
      hint="登记后可被授权角色在「数据看板」页看到；授权含「全部角色」即对所有人可见。"
      actions={
        <PrimaryButton onClick={() => setDraft({ ...EMPTY, allowed_roles: ['*'] })}>新建看板</PrimaryButton>
      }
    >
      {error && <Banner tone="error" onClose={() => setError(null)}>{error}</Banner>}
      {notice && <Banner tone="success" onClose={() => setNotice(null)}>{notice}</Banner>}

      {draft && (
        <div className="mb-4 rounded-lg border border-primary-200 bg-primary-50/40 px-4 py-3">
          <div className="grid grid-cols-3 gap-3">
            <TextField label="看板名称" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
            <TextField
              label="URL（外链或内网地址）"
              value={draft.url}
              onChange={(v) => setDraft({ ...draft, url: v })}
              className="col-span-2"
            />
            <TextField
              label="分类"
              value={draft.category}
              onChange={(v) => setDraft({ ...draft, category: v })}
            />
            <TextField
              label="说明"
              value={draft.description}
              onChange={(v) => setDraft({ ...draft, description: v })}
            />
            <label className="block">
              <span className="text-caption font-medium text-ink">排序（越小越前）</span>
              <input
                type="number"
                value={draft.sort_order}
                onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) || 0 })}
                className="mt-1.5 h-9 w-full rounded-lg border border-line bg-page px-3 text-lead text-ink focus:border-primary-300 focus:outline-none"
              />
            </label>
          </div>

          <p className="mt-3 text-[11px] text-ink-soft">可见角色</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setDraft({ ...draft, allowed_roles: ['*'] })}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                draft.allowed_roles.includes('*')
                  ? 'border-primary-300 bg-primary-100 text-primary-700'
                  : 'border-line bg-surface text-ink-soft hover:border-primary-200',
              )}
            >
              全部角色
            </button>
            {roles.map((r) => {
              const on = draft.allowed_roles.includes(r.name);
              return (
                <button
                  key={r.name}
                  type="button"
                  onClick={() => toggleRole(r.name)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                    on
                      ? 'border-primary-300 bg-primary-100 text-primary-700'
                      : 'border-line bg-surface text-ink-soft hover:border-primary-200',
                  )}
                >
                  {r.display_name}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-2.5">
            <PrimaryButton onClick={save} loading={saving} disabled={!canSave}>
              保存
            </PrimaryButton>
            <SubButton onClick={() => setDraft(null)}>取消</SubButton>
            {!canSave && <span className="text-[11px] text-ink-faint">名称与 URL 必填</span>}
          </div>
        </div>
      )}

      {list === null && <p className="py-8 text-center text-caption text-ink-faint">加载中…</p>}

      {list && list.length === 0 && (
        <p className="py-8 text-center text-caption text-ink-faint">
          还没有登记看板。新增后，被授权角色即可在「数据看板」页看到入口。
        </p>
      )}

      {list && list.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line bg-page text-caption text-ink-faint">
                <th className="px-4 py-2.5 font-medium">看板</th>
                <th className="px-3 py-2.5 font-medium">分类</th>
                <th className="px-3 py-2.5 font-medium">可见角色</th>
                <th className="px-3 py-2.5 font-medium">排序</th>
                <th className="px-4 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => {
                const rs = roleList(d.allowed_roles);
                return (
                  <tr key={d.id} className="border-b border-line/50 last:border-b-0 hover:bg-page">
                    <td className="px-4 py-2.5">
                      <p className="text-lead text-ink">{d.name}</p>
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 block max-w-[360px] truncate text-[11px] text-primary-600 hover:underline"
                      >
                        {d.url}
                      </a>
                    </td>
                    <td className="px-3 py-2.5 text-caption text-ink-soft">{d.category || '—'}</td>
                    <td className="px-3 py-2.5 text-caption text-ink-soft">
                      {rs.includes('*') ? '全部角色' : rs.length ? rs.join('、') : '未授权'}
                    </td>
                    <td className="px-3 py-2.5 text-caption text-ink-soft">{d.sort_order ?? 0}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="inline-flex items-center gap-2.5">
                        <SubButton
                          onClick={() =>
                            setDraft({
                              id: d.id,
                              name: d.name,
                              url: d.url,
                              description: d.description || '',
                              category: d.category || '通用',
                              allowed_roles: rs.length ? rs : ['*'],
                              sort_order: d.sort_order ?? 0,
                            })
                          }
                        >
                          编辑
                        </SubButton>
                        {pendingDelete === d.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => doDelete(d.id)}
                              className="text-caption font-medium text-danger hover:underline"
                            >
                              确认删除
                            </button>
                            <SubButton onClick={() => setPendingDelete(null)}>取消</SubButton>
                          </>
                        ) : (
                          <SubButton danger onClick={() => setPendingDelete(d.id)}>
                            删除
                          </SubButton>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
