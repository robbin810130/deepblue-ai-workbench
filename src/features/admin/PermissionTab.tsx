/**
 * 管理后台 · 技能权限页签
 *
 * 角色 × 技能授权（M6 技能级模型）：
 *   GET    /api/v1/permissions/roles           角色清单
 *   GET    /api/v1/permissions/skills?role=    该角色 × 全部可用技能的授权视图
 *   PUT    /api/v1/permissions/skills/:key     显式授权/拒绝（admin）
 *   DELETE /api/v1/permissions/skills/:key     清除显式授权，回落到旧版 appId 映射
 *
 * 三段判定（后端 evaluator）：显式授权 → 旧版 appId 映射回落 → not_evaluated。
 * 因此本页把「来源」单独展示，管理员能看出某条权限是显式给的还是继承来的。
 */
import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { cn } from '../../components/ui/cn';
import { api, ApiError, type SkillPermissionRow } from '../../api/client';
import { Banner, Panel, errText } from './ui';

const SCOPES = [
  { value: 'self', label: '仅本人' },
  { value: 'dept', label: '本部门' },
  { value: 'all', label: '全部' },
];

const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  granted: { label: '已授权', cls: 'bg-success-soft text-success', dot: 'bg-success' },
  denied: { label: '已拒绝', cls: 'bg-danger-soft text-danger', dot: 'bg-danger' },
  not_evaluated: { label: '未评估', cls: 'bg-surface-sunken text-ink-soft', dot: 'bg-ink-faint' },
};

const SOURCE_LABEL: Record<string, string> = {
  explicit: '显式授权',
  legacy: '旧版映射',
  fallback: '默认兜底',
  none: '无',
};

export function PermissionTab() {
  const [roles, setRoles] = useState<Array<{ name: string; display_name: string; is_builtin: boolean }>>([]);
  const [role, setRole] = useState('');
  const [rows, setRows] = useState<SkillPermissionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    api.admin
      .permissionRoles()
      .then((list) => {
        setRoles(list);
        if (list.length > 0) setRole((prev) => prev || list[0].name);
      })
      .catch((e) => setError(errText(e)));
  }, []);

  const load = useCallback(() => {
    if (!role) return;
    setLoading(true);
    api.admin
      .permissionSkills(role)
      .then(setRows)
      .catch((e) => {
        setRows([]);
        setError(e instanceof ApiError ? e.message : errText(e));
      })
      .finally(() => setLoading(false));
  }, [role]);

  useEffect(load, [load]);

  const change = async (row: SkillPermissionRow, mode: 'grant' | 'deny' | 'clear', scope = 'self') => {
    setBusyKey(row.skill_key);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'clear') {
        await api.admin.clearSkillGrant(row.skill_key, role);
        setNotice(`已清除「${row.name}」对角色 ${role} 的显式授权，将回落到旧版映射判定。`);
      } else {
        await api.admin.grantSkill(row.skill_key, role, mode === 'grant', scope);
        setNotice(`已${mode === 'grant' ? '授权' : '拒绝'}「${row.name}」→ ${role}。`);
      }
      load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusyKey(null);
    }
  };

  const visible = rows.filter(
    (r) => !q || r.name.includes(q) || r.skill_key.includes(q) || r.scene.includes(q),
  );

  return (
    <>
      <Panel
        title="角色 × 技能授权"
        hint="决定某角色能执行哪些技能，以及能触达的数据范围。未显式设置时按旧版权限映射判定。"
        actions={
          <>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              aria-label="选择角色"
              className="h-8 rounded-lg border border-line bg-page px-2 text-caption text-ink-soft focus:border-primary-300 focus:outline-none"
            >
              {roles.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.display_name}（{r.name}）
                </option>
              ))}
            </select>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="筛选技能…"
              aria-label="筛选技能"
              className="h-8 w-40 rounded-lg border border-line bg-page px-2 text-caption text-ink placeholder:text-ink-faint focus:border-primary-300 focus:outline-none"
            />
          </>
        }
      >
        {error && <Banner tone="error" onClose={() => setError(null)}>{error}</Banner>}
        {notice && <Banner tone="success" onClose={() => setNotice(null)}>{notice}</Banner>}

        {loading && <p className="py-8 text-center text-caption text-ink-faint">加载中…</p>}

        {!loading && visible.length === 0 && (
          <p className="py-8 text-center text-caption text-ink-faint">没有匹配的技能。</p>
        )}

        {!loading && visible.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line bg-page text-caption text-ink-faint">
                  <th className="px-4 py-2.5 font-medium">技能</th>
                  <th className="px-3 py-2.5 font-medium">判定</th>
                  <th className="px-3 py-2.5 font-medium">来源</th>
                  <th className="px-3 py-2.5 font-medium">数据范围</th>
                  <th className="px-4 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const meta = STATUS_META[r.status] || STATUS_META.not_evaluated;
                  const busy = busyKey === r.skill_key;
                  return (
                    <tr key={r.skill_key} className="border-b border-line/50 last:border-b-0">
                      <td className="px-4 py-2.5">
                        <p className="text-lead text-ink">{r.name}</p>
                        <p className="mt-0.5 text-[11px] text-ink-faint">
                          {r.skill_key} · {r.scene}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-caption font-medium',
                            meta.cls,
                          )}
                        >
                          <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-caption text-ink-soft">
                        {SOURCE_LABEL[r.source || ''] || r.source || '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        <select
                          value={r.data_scope || 'self'}
                          disabled={busy}
                          onChange={(e) => change(r, 'grant', e.target.value)}
                          aria-label={`${r.name} 数据范围`}
                          className="h-7 rounded-md border border-line bg-page px-1.5 text-caption text-ink-soft focus:border-primary-300 focus:outline-none disabled:opacity-50"
                        >
                          {SCOPES.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="inline-flex items-center gap-2.5">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => change(r, 'grant', r.data_scope || 'self')}
                            className="text-caption font-medium text-primary-600 hover:underline disabled:opacity-50"
                          >
                            授权
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => change(r, 'deny')}
                            className="text-caption font-medium text-danger hover:underline disabled:opacity-50"
                          >
                            拒绝
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => change(r, 'clear')}
                            className="text-caption text-ink-faint hover:text-ink disabled:opacity-50"
                          >
                            清除
                          </button>
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

      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-faint">
        <ShieldCheck size={12} /> 授权判定在服务端 evaluator 完成，前端仅发起变更；页面不会绕过任务记录直接调用模型。
      </p>
    </>
  );
}
