/**
 * 业务看板面板 —— 技能页 dashboard_center（技能清单里声明 view_panel 的那个）
 *
 * 数据源（两套，此前后台只有第一套，导致「业务看板」空着）：
 *   1. business_dashboard 表 —— Dify「看板生成助手」发布出来的 AI 看板（真数据在这）
 *   2. sys_dashboards 表     —— 管理员登记的外部看板（URL + 角色授权）
 *
 * 说明：
 * - 技能页原本拿 dashboard_center 的 input_schema 渲染成一个空表单，点「开始执行」
 *   必然建出一个没有执行体的任务。该技能是**聚合视图**、不是执行型技能，故走本面板。
 * - 卡片可访问性以 `file_exists` 为准：交付还原只搬了库表、没搬 HTML 卷，
 *   这类卡片明确标注「产物缺失」，不给用户一个点开就是 404 的链接。
 *   `file_exists=null` 表示后端没挂载看板存储目录（判定未知）→ 不标注，正常预览。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink, LayoutDashboard, RefreshCw, Search, ShieldAlert, Trash2, Archive, ArchiveRestore } from 'lucide-react';
import { cn } from '../../components/ui/cn';
import {
  api,
  ApiError,
  resolveDashboardUrl,
  type ApiBusinessDashboard,
  type ApiDashboard,
} from '../../api/client';
import { parseCurrentRole } from '../../config/permissionConfig';

const DOMAIN_LABELS: Record<string, string> = {
  finance: '财务',
  warehouse: '仓储',
  sales: '销售',
  procurement: '采购',
  production: '生产',
  other: '其他',
};

const DOMAIN_TONE: Record<string, string> = {
  finance: 'bg-emerald-500/10 text-emerald-600',
  warehouse: 'bg-amber-500/10 text-amber-600',
  sales: 'bg-primary-50 text-primary-600',
  procurement: 'bg-violet-500/10 text-violet-600',
  production: 'bg-rose-500/10 text-rose-600',
  other: 'bg-surface-sunken text-ink-soft',
};

function rolesText(roles: ApiBusinessDashboard['allowed_roles']): string {
  const arr = Array.isArray(roles) ? roles : [];
  if (arr.includes('*')) return '全部角色可见';
  if (arr.length === 0) return '未设置可见角色';
  return `可视角色：${arr.join('、')}`;
}

function fmtTime(s: string): string {
  try {
    return new Date(s).toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return s;
  }
}

export function DashboardCenterPanel() {
  const isAdmin = parseCurrentRole() === 'admin';
  const [aiItems, setAiItems] = useState<ApiBusinessDashboard[] | null>(null);
  const [regItems, setRegItems] = useState<ApiDashboard[]>([]);
  const [viewMode, setViewMode] = useState<'published' | 'archived'>('published');
  const [keyword, setKeyword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ name: string; url: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [ai] = await Promise.all([
        api.businessDashboard.list({ status: viewMode, page_size: 100 }),
        isAdmin
          ? api.dashboards.adminList().catch(() => [])
          : api.dashboards.list().catch(() => []),
      ]);
      setAiItems(ai.items || []);
    } catch (e) {
      setAiItems([]);
      setError(e instanceof ApiError ? e.message : '看板加载失败');
    }
  }, [viewMode, isAdmin]);

  // 登记看板与发布状态无关，单独拉一次即可（非管理员只能看到被授权的）
  useEffect(() => {
    (isAdmin ? api.dashboards.adminList() : api.dashboards.list())
      .then(setRegItems)
      .catch(() => setRegItems([]));
  }, [isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const kw = keyword.trim().toLowerCase();
  const filteredAi = useMemo(
    () =>
      (aiItems || []).filter(
        (d) => !kw || d.title.toLowerCase().includes(kw) || (d.description || '').toLowerCase().includes(kw),
      ),
    [aiItems, kw],
  );
  const filteredReg = useMemo(
    () => regItems.filter((d) => !kw || d.name.toLowerCase().includes(kw) || (d.description || '').toLowerCase().includes(kw)),
    [regItems, kw],
  );

  const setStatus = async (d: ApiBusinessDashboard) => {
    const next = d.source === 'dify' && viewMode === 'published' ? 'archived' : 'published';
    if (!window.confirm(`确定${next === 'archived' ? '归档' : '恢复'}「${d.title}」吗？`)) return;
    setBusy(d.dashboard_id);
    try {
      await api.businessDashboard.setStatus([d.dashboard_id], next);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '操作失败');
    } finally {
      setBusy(null);
    }
  };

  const removeAi = async (d: ApiBusinessDashboard) => {
    if (!window.confirm(`确定彻底删除「${d.title}」吗？此操作不可恢复。`)) return;
    setBusy(d.dashboard_id);
    try {
      await api.businessDashboard.remove(d.dashboard_id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '删除失败');
    } finally {
      setBusy(null);
    }
  };

  const removeReg = async (d: ApiDashboard) => {
    if (!window.confirm(`确定删除登记看板「${d.name}」吗？`)) return;
    try {
      await api.dashboards.remove(d.id);
      setRegItems((prev) => prev.filter((x) => x.id !== d.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '删除失败');
    }
  };

  if (viewing) {
    return (
      <div className="mt-5 overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <button
            type="button"
            onClick={() => setViewing(null)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-caption text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <ArrowLeft size={14} /> 返回列表
          </button>
          <span className="h-4 w-px bg-line" />
          <LayoutDashboard size={15} className="text-primary-600" />
          <span className="truncate text-lead font-medium text-ink">{viewing.name}</span>
          <a
            href={viewing.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-caption text-ink-soft transition-colors hover:bg-surface-sunken hover:text-primary-600"
          >
            <ExternalLink size={14} /> 新窗口打开
          </a>
        </div>
        <iframe
          src={viewing.url}
          title={viewing.name}
          className="h-[calc(100vh-320px)] min-h-[420px] w-full border-0 bg-page"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    );
  }

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索看板标题或说明…"
            className="h-9 w-64 rounded-lg border border-line bg-page pl-9 pr-3 text-caption text-ink focus:border-primary-300 focus:outline-none"
          />
        </div>

        <div className="flex items-center rounded-lg bg-surface-sunken p-0.5">
          {(['published', 'archived'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setViewMode(m)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-lg px-3 text-caption transition-colors',
                viewMode === m ? 'bg-surface font-medium text-ink shadow-sm' : 'text-ink-soft hover:text-ink',
              )}
            >
              {m === 'published' ? '已发布' : '已归档'}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={load}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-caption text-ink-soft transition-colors hover:text-ink"
        >
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

      {error && <p className="mt-3 rounded-lg bg-danger-soft px-4 py-2.5 text-caption text-danger">{error}</p>}

      {/* AI 发布的看板 */}
      <section className="mt-4">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-body font-medium text-ink">AI 生成看板</h2>
            <p className="mt-1 text-caption text-ink-soft">
              由「看板生成助手」分析业务数据后发布，点击卡片就地预览。
            </p>
          </div>
          {aiItems && <span className="text-caption text-ink-faint">{filteredAi.length} 个</span>}
        </div>

        {aiItems === null && (
          <div className="mt-3 grid grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[118px] animate-pulse rounded-xl bg-surface-sunken" />
            ))}
          </div>
        )}

        {aiItems && filteredAi.length === 0 && (
          <div className="mt-3 rounded-xl border border-dashed border-line bg-surface px-5 py-10 text-center">
            <p className="text-lead text-ink-soft">
              {viewMode === 'published' ? '还没有已发布的看板' : '没有已归档的看板'}
            </p>
            <p className="mt-1 text-caption text-ink-faint">
              到「看板生成助手」上传经营数据并发布，看板会出现在这里。
            </p>
          </div>
        )}

        {aiItems && filteredAi.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-4">
            {filteredAi.map((d) => {
              const missing = d.file_exists === false;
              const url = resolveDashboardUrl(d);
              return (
                <div
                  key={d.dashboard_id}
                  onClick={() => !missing && setViewing({ name: d.title, url })}
                  className={cn(
                    'group relative flex flex-col rounded-xl border bg-surface px-4 py-3.5 transition-shadow',
                    missing ? 'cursor-not-allowed border-dashed border-line opacity-70' : 'cursor-pointer border-line hover:shadow-md',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'rounded-md px-2 py-0.5 text-[11px] font-medium',
                        DOMAIN_TONE[d.domain] || DOMAIN_TONE.other,
                      )}
                    >
                      {DOMAIN_LABELS[d.domain] || d.domain}
                    </span>
                    {missing && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-warning-soft px-1.5 py-0.5 text-[10px] text-warning">
                        <ShieldAlert size={11} /> 产物缺失
                      </span>
                    )}
                  </div>

                  <h3 className="mt-2 line-clamp-2 text-lead font-medium text-ink">{d.title}</h3>
                  <p className="mt-1 line-clamp-2 text-caption leading-relaxed text-ink-soft">
                    {d.description || '由 AI 深度分析业务数据生成。'}
                  </p>

                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-ink-faint">
                    <span className="truncate">{rolesText(d.allowed_roles)}</span>
                    <span className="shrink-0">{fmtTime(d.published_at)}</span>
                  </div>

                  <div className="mt-2 flex items-center justify-between">
                    <span
                      className={cn(
                        'text-[11px]',
                        missing ? 'text-warning' : 'text-primary-600 group-hover:underline',
                      )}
                    >
                      {missing ? '原始 HTML 未随交付包还原' : '预览看板 →'}
                    </span>
                    {isAdmin && (
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          title={viewMode === 'published' ? '归档' : '恢复'}
                          disabled={busy === d.dashboard_id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setStatus(d);
                          }}
                          className="rounded-md p-1 text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-40"
                        >
                          {viewMode === 'published' ? <Archive size={13} /> : <ArchiveRestore size={13} />}
                        </button>
                        <button
                          type="button"
                          title="彻底删除"
                          disabled={busy === d.dashboard_id}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeAi(d);
                          }}
                          className="rounded-md p-1 text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-40"
                        >
                          <Trash2 size={13} />
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 管理员登记的外部看板 */}
      {filteredReg.length > 0 && (
        <section className="mt-6">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-body font-medium text-ink">外部登记看板</h2>
              <p className="mt-1 text-caption text-ink-soft">管理员登记的外部系统看板（按角色授权可见）。</p>
            </div>
            <span className="text-caption text-ink-faint">{filteredReg.length} 个</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-4">
            {filteredReg.map((d) => (
              <a
                key={d.id}
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="group flex flex-col rounded-xl border border-line bg-surface px-4 py-3.5 transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-lead font-medium text-ink">{d.name}</span>
                  {d.category && (
                    <span className="shrink-0 rounded-md bg-surface-sunken px-1.5 py-0.5 text-[10px] text-ink-soft">
                      {d.category}
                    </span>
                  )}
                </div>
                {d.description && (
                  <p className="mt-1 line-clamp-2 text-caption leading-relaxed text-ink-soft">{d.description}</p>
                )}
                <div className="mt-2 flex items-center justify-between">
                  <span className="truncate text-[11px] text-primary-600 group-hover:underline">打开看板 →</span>
                  {isAdmin && (
                    <button
                      type="button"
                      title="删除"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        removeReg(d);
                      }}
                      className="rounded-md p-1 text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default DashboardCenterPanel;
