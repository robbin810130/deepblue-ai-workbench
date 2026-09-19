/**
 * 数据看板 —— /dashboard
 *
 * 依据：06_前端页面详细PRD §8
 *   「面向管理者，V1 仅保留 4～6 个有效指标：任务总量、完成率、活跃用户、
 *     场景使用分布、热门技能、失败率趋势。首页不重复这些指标。」
 *
 * 数据源：
 *   GET /api/v1/tasks/metrics   任务指标（后端聚合，前端不做二次统计）
 *   GET /api/dashboards         业务看板入口（存量看板中心，按角色授权过滤）
 *   GET /api/v1/scenes          场景 key → 中文名
 */
import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Clock, Inbox } from 'lucide-react';
import { cn } from '../../components/ui/cn';
import { api, ApiError, type ApiDashboard, type ApiScene, type TaskMetrics } from '../../api/client';

const STATUS_ORDER: Array<{ key: string; label: string; tone: string }> = [
  { key: 'succeeded', label: '已完成', tone: 'bg-success' },
  { key: 'failed', label: '失败', tone: 'bg-danger' },
  { key: 'waiting_confirmation', label: '待确认', tone: 'bg-warning' },
  { key: 'queued_running', label: '执行中', tone: 'bg-primary-500' },
  { key: 'draft', label: '草稿', tone: 'bg-ink-faint' },
  { key: 'cancelled', label: '已取消', tone: 'bg-line' },
];

function pct(v: number | null): string {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`;
}

function dur(v: number | null): string {
  if (v === null || v === undefined) return '—';
  if (v < 60) return `${v.toFixed(1)} 秒`;
  return `${(v / 60).toFixed(1)} 分钟`;
}

function MetricCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <div className="flex items-center gap-2 text-ink-soft">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
          {icon}
        </span>
        <span className="text-caption">{label}</span>
      </div>
      <p className="mt-2.5 text-display font-semibold tracking-[-0.5px] text-ink">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-ink-faint">{hint}</p>}
    </div>
  );
}

function BarList({
  rows,
  emptyHint,
}: {
  rows: Array<{ label: string; n: number }>;
  emptyHint: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (rows.length === 0) {
    return <p className="py-6 text-center text-caption text-ink-faint">{emptyHint}</p>;
  }
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-center justify-between gap-3 text-caption">
            <span className="truncate text-ink-soft">{r.label}</span>
            <span className="shrink-0 font-medium text-ink">{r.n}</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
            <div
              className="h-full rounded-full bg-primary-500"
              style={{ width: `${Math.round((r.n / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DashboardPage() {
  const [metrics, setMetrics] = useState<TaskMetrics | null>(null);
  const [scenes, setScenes] = useState<ApiScene[]>([]);
  const [dashboards, setDashboards] = useState<ApiDashboard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMetrics()
      .then(setMetrics)
      .catch((e) => setError(e instanceof ApiError ? e.message : '指标加载失败'));
    api
      .listScenes()
      .then(setScenes)
      .catch(() => setScenes([]));
    api.dashboards
      .list()
      .then(setDashboards)
      .catch(() => setDashboards([]));
  }, []);

  const sceneName = useMemo(() => {
    const m = new Map(scenes.map((s) => [s.scene_key, s.name]));
    return (k: string) => m.get(k) || k;
  }, [scenes]);

  const statusRows = useMemo(() => {
    const by = metrics?.by_status || {};
    return STATUS_ORDER.filter((s) => (by[s.key] || 0) > 0).map((s) => ({
      key: s.key,
      label: s.label,
      tone: s.tone,
      n: by[s.key] || 0,
    }));
  }, [metrics]);

  const sceneRows = useMemo(
    () =>
      Object.entries(metrics?.by_scene || {})
        .map(([k, n]) => ({ label: sceneName(k), n }))
        .sort((a, b) => b.n - a.n),
    [metrics, sceneName],
  );

  /* 近 14 天：后端只返回有数据的日子，前端补齐空日为 0，否则趋势会“跳” */
  const dayRows = useMemo(() => {
    const by = metrics?.by_day || {};
    const days: Array<{ day: string; n: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({ day: key, n: by[key] || 0 });
    }
    return days;
  }, [metrics]);

  const dayMax = Math.max(1, ...dayRows.map((d) => d.n));
  const total = metrics?.created ?? 0;
  const inFlight = (metrics?.by_status?.queued_running || 0) + (metrics?.by_status?.waiting_confirmation || 0);

  return (
    <div className="mx-auto w-full max-w-[1120px] px-8 py-7">
      <header>
        <h1 className="text-title font-semibold text-ink">数据看板</h1>
        <p className="mt-1 text-caption text-ink-soft">
          任务闭环的运行质量与场景分布；业务数据看板在页面下方按角色授权进入。
        </p>
      </header>

      {error && (
        <p className="mt-4 rounded-lg bg-danger-soft px-4 py-2.5 text-caption text-danger">{error}</p>
      )}

      {/* 指标卡 */}
      <div className="mt-5 grid grid-cols-3 gap-4">
        <MetricCard
          icon={<BarChart3 size={14} />}
          label="任务总量"
          value={String(total)}
          hint={inFlight > 0 ? `其中 ${inFlight} 条在途` : '暂无在途任务'}
        />
        <MetricCard
          icon={<CheckCircle2 size={14} />}
          label="完成率"
          value={pct(metrics?.success_rate ?? null)}
          hint="已完成 ÷ 已结束"
        />
        <MetricCard
          icon={<AlertTriangle size={14} />}
          label="失败率"
          value={pct(metrics?.failure_rate ?? null)}
          hint="失败 ÷ 已结束"
        />
        <MetricCard
          icon={<Clock size={14} />}
          label="平均耗时"
          value={dur(metrics?.avg_success_seconds ?? null)}
          hint="仅统计成功任务"
        />
        <MetricCard
          icon={<Activity size={14} />}
          label="人工确认率"
          value={pct(metrics?.confirmation_rate ?? null)}
          hint="进入过待确认的任务占比"
        />
        <MetricCard
          icon={<Inbox size={14} />}
          label="待确认"
          value={String(metrics?.by_status?.waiting_confirmation || 0)}
          hint="等待人工裁决"
        />
      </div>

      {/* 分布 + 趋势 */}
      <div className="mt-4 grid grid-cols-2 gap-4">
        <section className="rounded-xl border border-line bg-surface px-5 py-4">
          <h2 className="text-body font-medium text-ink">场景使用分布</h2>
          <div className="mt-3">
            <BarList rows={sceneRows} emptyHint="还没有任务数据。" />
          </div>
        </section>
        <section className="rounded-xl border border-line bg-surface px-5 py-4">
          <h2 className="text-body font-medium text-ink">任务状态分布</h2>
          <div className="mt-3">
            {statusRows.length === 0 ? (
              <p className="py-6 text-center text-caption text-ink-faint">还没有任务数据。</p>
            ) : (
              <ul className="space-y-2.5">
                {statusRows.map((s) => (
                  <li key={s.key} className="flex items-center gap-3">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', s.tone)} />
                    <span className="flex-1 text-caption text-ink-soft">{s.label}</span>
                    <span className="text-caption font-medium text-ink">{s.n}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <section className="mt-4 rounded-xl border border-line bg-surface px-5 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-body font-medium text-ink">近 14 天任务趋势</h2>
          <span className="text-caption text-ink-faint">峰值 {dayMax} 条/天</span>
        </div>
        <div className="mt-4 flex h-[120px] items-end gap-1.5">
          {dayRows.map((d) => (
            <div key={d.day} className="group flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[10px] text-ink-faint opacity-0 transition-opacity group-hover:opacity-100">
                {d.n}
              </span>
              <div
                className={cn(
                  'w-full rounded-t-[4px] transition-colors',
                  d.n > 0 ? 'bg-primary-400 group-hover:bg-primary-600' : 'bg-surface-sunken',
                )}
                style={{ height: `${Math.max(3, Math.round((d.n / dayMax) * 92))}%` }}
                title={`${d.day}：${d.n} 条`}
              />
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-ink-faint">
          <span>{dayRows[0]?.day.slice(5)}</span>
          <span>{dayRows[dayRows.length - 1]?.day.slice(5)}</span>
        </div>
      </section>

      {/* 业务看板入口 */}
      <section className="mt-4">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-body font-medium text-ink">业务数据看板</h2>
            <p className="mt-1 text-caption text-ink-soft">按当前角色授权可见的存量看板，点击在新标签页打开。</p>
          </div>
          {dashboards && (
            <span className="text-caption text-ink-faint">{dashboards.length} 个</span>
          )}
        </div>

        {dashboards === null && (
          <div className="mt-3 grid grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[84px] animate-pulse rounded-xl bg-surface-sunken" />
            ))}
          </div>
        )}

        {dashboards && dashboards.length === 0 && (
          <div className="mt-3 rounded-xl border border-dashed border-line bg-surface px-5 py-8 text-center">
            <p className="text-lead text-ink-soft">当前角色还没有可访问的业务看板</p>
            <p className="mt-1 text-caption text-ink-faint">
              看板由管理员在「管理后台 → 业务看板」中登记并授权角色。
            </p>
          </div>
        )}

        {dashboards && dashboards.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-4">
            {dashboards.map((d) => (
              <a
                key={d.id}
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="group rounded-xl border border-line bg-surface px-4 py-3.5 transition-shadow hover:shadow-md"
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
                <span className="mt-2 block truncate text-[11px] text-primary-600 group-hover:underline">
                  打开看板 →
                </span>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
