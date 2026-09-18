/**
 * 任务中心 —— 列表页
 *
 * 依据：05_任务中心详细PRD §4 任务列表
 *   - 筛选：状态 / 场景；搜索：标题模糊
 *   - 行字段：编号 / 标题 / 技能 / 状态 / 次数 / 创建人 / 时间
 *   - 点击行 → /tasks/:id 详情
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { cn } from '../../components/ui/cn';
import { api, type ApiTask, type ApiScene, ApiError } from '../../api/client';
import { TASK_STATUS_META, type TaskStatus } from '../../types/domain';

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部' },
  { value: 'draft', label: '草稿' },
  { value: 'running', label: '执行中' },
  { value: 'queued', label: '排队中' },
  { value: 'waiting_confirmation', label: '待确认' },
  { value: 'succeeded', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
  { value: 'archived', label: '已归档' },
];

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sameDay ? `今天 ${hm}` : `${d.getMonth() + 1}-${d.getDate()} ${hm}`;
}

export function TasksPage() {
  const nav = useNavigate();
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [scenes, setScenes] = useState<ApiScene[]>([]);
  const [status, setStatus] = useState('');
  const [scene, setScene] = useState('');
  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listScenes()
      .then(setScenes)
      .catch(() => setScenes([]));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .listTasks({ status: status || undefined, scene: scene || undefined, q: q || undefined, limit: 50 })
      .then(setTasks)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          setError('登录状态已失效，请刷新页面重新登录');
        } else {
          setError(e.message || '加载失败');
        }
        setTasks([]);
      })
      .finally(() => setLoading(false));
  }, [status, scene, q]);

  useEffect(load, [load]);

  const sceneName = useMemo(() => {
    const m = new Map(scenes.map((s) => [s.scene_key, s.name]));
    return (k: string) => m.get(k) || k;
  }, [scenes]);

  return (
    <div className="mx-auto w-full max-w-[1120px] px-8 py-7">
      {/* 页头 */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-title font-semibold text-ink">任务中心</h1>
          <p className="mt-1 text-caption text-ink-soft">跟踪每一次技能执行的提交、结果与人工确认。</p>
        </div>
        <Link
          to="/scenes"
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-primary-600 px-3.5 text-lead font-medium text-white transition-colors hover:bg-primary-700"
        >
          <Plus size={15} /> 新建任务
        </Link>
      </div>

      {/* 筛选区 */}
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setStatus(s.value)}
              className={cn(
                'h-8 rounded-lg px-3 text-caption font-medium transition-colors',
                status === s.value
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface text-ink-soft hover:bg-surface-sunken hover:text-ink',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={scene}
            onChange={(e) => setScene(e.target.value)}
            aria-label="按场景筛选"
            className="h-8 rounded-lg border border-line bg-surface px-2 text-caption text-ink-soft focus:border-primary-300 focus:outline-none"
          >
            <option value="">全部场景</option>
            {scenes
              .filter((s) => s.is_business)
              .map((s) => (
                <option key={s.scene_key} value={s.scene_key}>
                  {s.name}
                </option>
              ))}
          </select>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setQ(qInput.trim())}
              onBlur={() => setQ(qInput.trim())}
              placeholder="搜索任务标题…"
              aria-label="搜索任务"
              className="h-8 w-52 rounded-lg border border-line bg-surface pl-8 pr-2 text-caption text-ink placeholder:text-ink-faint focus:border-primary-300 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* 列表 */}
      <div className="mt-4 overflow-hidden rounded-xl border border-line bg-surface">
        {loading && <p className="px-5 py-10 text-center text-caption text-ink-faint">加载中…</p>}
        {!loading && error && <p className="px-5 py-10 text-center text-caption text-danger">{error}</p>}
        {!loading && !error && tasks.length === 0 && (
          <div className="px-5 py-12 text-center">
            <p className="text-lead text-ink-soft">还没有任务</p>
            <p className="mt-1 text-caption text-ink-faint">从业务场景里挑一个技能，发起第一次执行。</p>
            <Link
              to="/scenes"
              className="mt-4 inline-flex h-9 items-center rounded-[10px] bg-primary-600 px-4 text-lead font-medium text-white hover:bg-primary-700"
            >
              浏览业务场景
            </Link>
          </div>
        )}
        {!loading && !error && tasks.length > 0 && (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line text-caption text-ink-faint">
                <th className="px-5 py-2.5 font-medium">任务</th>
                <th className="px-3 py-2.5 font-medium">状态</th>
                <th className="px-3 py-2.5 font-medium">场景</th>
                <th className="px-3 py-2.5 font-medium">次数</th>
                <th className="px-3 py-2.5 font-medium">创建人</th>
                <th className="px-5 py-2.5 text-right font-medium">时间</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const meta = TASK_STATUS_META[t.status as TaskStatus];
                return (
                  <tr
                    key={t.id}
                    onClick={() => nav(`/tasks/${t.id}`)}
                    className="cursor-pointer border-b border-line/50 transition-colors last:border-b-0 hover:bg-page"
                  >
                    <td className="px-5 py-3">
                      <p className="max-w-[360px] truncate text-lead font-medium text-ink">{t.title}</p>
                      <p className="mt-0.5 text-[11px] text-ink-faint">
                        {t.task_no} · {t.skill_key}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-caption font-medium',
                          meta?.tone || 'bg-surface-sunken text-ink-soft',
                        )}
                      >
                        <span className={cn('h-1.5 w-1.5 rounded-full', meta?.dot || 'bg-ink-faint')} />
                        {meta?.label || t.status}
                      </span>
                      {t.error_code && (
                        <span className="ml-1.5 text-[11px] text-danger" title={t.error_message || ''}>
                          {t.error_code}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-caption text-ink-soft">{sceneName(t.scene)}</td>
                    <td className="px-3 py-3 text-caption text-ink-soft">{t.run_count}</td>
                    <td className="px-3 py-3 text-caption text-ink-soft">{t.created_by_name || `#${t.created_by}`}</td>
                    <td className="px-5 py-3 text-right text-caption text-ink-faint">{fmtTime(t.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
