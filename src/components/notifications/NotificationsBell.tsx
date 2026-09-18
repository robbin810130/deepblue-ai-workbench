/**
 * 通知铃铛（Topbar 用）
 *
 * 依据：05_任务中心详细PRD §8 —— 任务完成/失败/待确认/被分配 四类通知；
 *      待确认通知同时是待办（is_todo），可在面板内直接「去处理」/「完成待办」。
 *
 * 数据：GET /api/v1/notifications/unread-count 轮询（60s），失败静默降级为 0
 *      （登录态缺失时 401 → ApiError，不弹错误打扰用户）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Check, ChevronRight } from 'lucide-react';
import { cn } from '../../components/ui/cn';
import { api, ApiError, type ApiNotification } from '../../api/client';

const TYPE_LABEL: Record<string, string> = {
  task_succeeded: '任务完成',
  task_failed: '任务失败',
  task_need_confirm: '待确认',
  task_assigned: '任务分配',
  task_created: '任务创建',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export function NotificationsBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ApiNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(() => {
    api
      .unreadCount()
      .then((r) => setUnread(r.unread))
      .catch(() => setUnread(0)); // 未登录/网络异常静默
  }, []);

  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, 60_000);
    return () => clearInterval(t);
  }, [refreshCount]);

  // 点击面板外关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      try {
        setItems(await api.listNotifications({}));
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }
  };

  const openTask = (n: ApiNotification) => {
    setOpen(false);
    if (n.task_id) window.location.assign(`/next/tasks/${n.task_id}`);
  };

  const markRead = async (n: ApiNotification) => {
    try {
      await api.markRead(n.id);
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      refreshCount();
    } catch {
      /* 静默 */
    }
  };

  const completeTodo = async (n: ApiNotification) => {
    try {
      await api.completeTodo(n.id);
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, todo_done: true } : x)));
      refreshCount();
    } catch {
      /* 静默 */
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `通知，${unread} 条未读` : '通知，无未读'}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-[10px] text-ink-soft transition-colors hover:bg-page hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-200"
      >
        <Bell size={19} strokeWidth={1.8} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-surface">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="通知面板"
          className="absolute right-0 top-11 z-50 w-[360px] overflow-hidden rounded-xl border border-line bg-surface shadow-lg shadow-black/5"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-lead font-semibold text-ink">通知</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await api.markAllRead();
                    setItems((prev) => prev.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
                    setUnread(0);
                  } catch {
                    /* 静默 */
                  }
                }}
                className="text-caption text-primary-600 hover:text-primary-700"
              >
                全部已读
              </button>
            )}
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {loading && <p className="px-4 py-6 text-center text-caption text-ink-faint">加载中…</p>}
            {!loading && items.length === 0 && (
              <p className="px-4 py-6 text-center text-caption text-ink-faint">暂无通知</p>
            )}
            {!loading &&
              items.map((n) => {
                const unreadItem = !n.read_at;
                return (
                  <div
                    key={n.id}
                    className={cn(
                      'group flex items-start gap-3 border-b border-line/60 px-4 py-3 last:border-b-0',
                      unreadItem && 'bg-primary-50/40',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[11px] font-medium leading-none',
                            n.type === 'task_failed'
                              ? 'bg-danger-soft text-danger'
                              : n.type === 'task_need_confirm'
                                ? 'bg-warning-soft text-warning'
                                : n.type === 'task_succeeded'
                                  ? 'bg-success-soft text-success'
                                  : 'bg-surface-sunken text-ink-soft',
                          )}
                        >
                          {TYPE_LABEL[n.type] || n.type}
                        </span>
                        <span className="text-[11px] text-ink-faint">{timeAgo(n.created_at)}</span>
                      </div>
                      <p className="mt-1 truncate text-lead text-ink">{n.title}</p>
                      {n.body && <p className="mt-0.5 line-clamp-2 text-caption text-ink-soft">{n.body}</p>}
                      <div className="mt-1.5 flex items-center gap-3">
                        {n.task_id && (
                          <button
                            type="button"
                            onClick={() => openTask(n)}
                            className="inline-flex items-center gap-0.5 text-caption font-medium text-primary-600 hover:text-primary-700"
                          >
                            去处理 <ChevronRight size={12} />
                          </button>
                        )}
                        {n.is_todo && !n.todo_done && (
                          <button
                            type="button"
                            onClick={() => completeTodo(n)}
                            className="inline-flex items-center gap-0.5 text-caption text-ink-soft hover:text-ink"
                          >
                            <Check size={12} /> 完成待办
                          </button>
                        )}
                        {unreadItem && (
                          <button
                            type="button"
                            onClick={() => markRead(n)}
                            className="text-caption text-ink-faint hover:text-ink-soft"
                          >
                            标为已读
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

/** 供页面捕获 401 后使用的辅助判断 */
export function isAuthError(e: unknown): e is ApiError {
  return e instanceof ApiError && e.status === 401;
}
