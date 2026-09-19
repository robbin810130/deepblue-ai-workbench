/**
 * 管理后台 · 角色管理页签
 *
 *   GET    /api/admin/roles        角色列表（含 permissions）
 *   POST   /api/admin/roles        新建（name / display_name / permissions）
 *   PUT    /api/admin/roles/:id    改显示名或权限
 *   DELETE /api/admin/roles/:id    删除
 *   GET    /api/v1/permissions/codes  权限码清单（= 各技能 legacy.app_id）
 *
 * 注意：这里的 permissions 是**旧版 appId 数组**语汇（模块级可见性），
 *      技能级的细粒度授权在「技能权限」页签（M6 模型），两者并存、互不冲突。
 */
import { useEffect, useState } from 'react';
import { cn } from '../../components/ui/cn';
import { api, type AdminRole } from '../../api/client';
import { Banner, Panel, PrimaryButton, SubButton, errText } from './ui';

interface Draft {
  id?: number;
  name: string;
  display_name: string;
  permissions: string[];
}

export function RolesTab() {
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [codes, setCodes] = useState<Array<{ code: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    api.admin
      .roles()
      .then(setRoles)
      .catch((e) => {
        setRoles([]);
        setError(errText(e));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.admin
      .permissionCodes()
      .then(setCodes)
      .catch(() => setCodes([]));
  }, []);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (draft.id) {
        await api.admin.updateRole(draft.id, {
          display_name: draft.display_name,
          permissions: draft.permissions,
        });
        setNotice(`已更新角色 ${draft.name}。`);
      } else {
        await api.admin.createRole({
          name: draft.name,
          display_name: draft.display_name,
          permissions: draft.permissions,
        });
        setNotice(`已创建角色 ${draft.name}。`);
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
      await api.admin.removeRole(id);
      setPendingDelete(null);
      setNotice('角色已删除。');
      load();
    } catch (e) {
      setError(errText(e));
    }
  };

  const togglePerm = (code: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      permissions: draft.permissions.includes(code)
        ? draft.permissions.filter((c) => c !== code)
        : [...draft.permissions, code],
    });
  };

  return (
    <Panel
      title="角色与权限"
      hint="权限码对应「模块级可见性」（旧版 appId 语汇）；技能级细粒度授权请用「技能权限」页签。"
      actions={
        <PrimaryButton onClick={() => setDraft({ name: '', display_name: '', permissions: [] })}>
          新建角色
        </PrimaryButton>
      }
    >
      {error && <Banner tone="error" onClose={() => setError(null)}>{error}</Banner>}
      {notice && <Banner tone="success" onClose={() => setNotice(null)}>{notice}</Banner>}

      {draft && (
        <div className="mb-4 rounded-lg border border-primary-200 bg-primary-50/40 px-4 py-3">
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-[11px] text-ink-soft">角色标识（英文/数字/下划线）</span>
              <input
                value={draft.name}
                disabled={Boolean(draft.id) || draft.name === 'admin'}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2 text-caption text-ink focus:border-primary-300 focus:outline-none disabled:bg-surface-sunken"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-ink-soft">显示名</span>
              <input
                value={draft.display_name}
                onChange={(e) => setDraft({ ...draft, display_name: e.target.value })}
                className="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2 text-caption text-ink focus:border-primary-300 focus:outline-none"
              />
            </label>
            <div className="flex items-end gap-2.5">
              <PrimaryButton onClick={save} loading={saving}>
                保存
              </PrimaryButton>
              <SubButton onClick={() => setDraft(null)}>取消</SubButton>
            </div>
          </div>

          <p className="mt-3 text-[11px] text-ink-soft">
            已选 {draft.permissions.length} 项权限码
          </p>
          <div className="mt-1.5 flex max-h-[168px] flex-wrap gap-1.5 overflow-y-auto">
            {codes.map((c) => {
              const on = draft.permissions.includes(c.code);
              return (
                <button
                  key={c.code}
                  type="button"
                  title={c.name}
                  onClick={() => togglePerm(c.code)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                    on
                      ? 'border-primary-300 bg-primary-100 text-primary-700'
                      : 'border-line bg-surface text-ink-soft hover:border-primary-200',
                  )}
                >
                  {c.code}
                </button>
              );
            })}
            {codes.length === 0 && <span className="text-[11px] text-ink-faint">权限码清单加载失败。</span>}
          </div>
        </div>
      )}

      {loading && <p className="py-8 text-center text-caption text-ink-faint">加载中…</p>}

      {!loading && roles.length > 0 && (
        <div className="space-y-2.5">
          {roles.map((r) => (
            <div key={r.id} className="rounded-lg border border-line px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-lead font-medium text-ink">{r.display_name}</span>
                  <span className="rounded-md bg-surface-sunken px-1.5 py-0.5 text-[10px] text-ink-soft">
                    {r.name}
                  </span>
                  {r.is_builtin && (
                    <span className="rounded-md bg-primary-50 px-1.5 py-0.5 text-[10px] text-primary-600">
                      内置
                    </span>
                  )}
                  <span className="text-[11px] text-ink-faint">{r.permissions?.length || 0} 项权限</span>
                </div>
                <span className="flex shrink-0 items-center gap-2.5">
                  <SubButton
                    onClick={() =>
                      setDraft({
                        id: r.id,
                        name: r.name,
                        display_name: r.display_name,
                        permissions: [...(r.permissions || [])],
                      })
                    }
                  >
                    编辑
                  </SubButton>
                  {pendingDelete === r.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => doDelete(r.id)}
                        className="text-caption font-medium text-danger hover:underline"
                      >
                        确认删除
                      </button>
                      <SubButton onClick={() => setPendingDelete(null)}>取消</SubButton>
                    </>
                  ) : (
                    !r.is_builtin && (
                      <SubButton danger onClick={() => setPendingDelete(r.id)}>
                        删除
                      </SubButton>
                    )
                  )}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(r.permissions || []).map((p) => (
                  <span key={p} className="rounded-full bg-page px-2 py-0.5 text-[10px] text-ink-soft">
                    {p}
                  </span>
                ))}
                {(r.permissions || []).length === 0 && (
                  <span className="text-[11px] text-ink-faint">未授予任何模块权限</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
