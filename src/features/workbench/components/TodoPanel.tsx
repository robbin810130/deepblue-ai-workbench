/**
 * 我的待办（工作台首页模块 7 · TodoPanel）
 *
 * 依据：01_前端开发规范 §6 —— 只放可行动事项；与系统通知分开
 *      06_前端页面详细PRD §1.2 —— 3～5 条；禁止混入普通动态
 *
 * 数据：GET /api/v1/notifications?todos_only=true（通知表 is_todo 标记的未完成待办）
 *      勾选完成 → POST /api/v1/notifications/:id/complete-todo
 *      原先读的是 mock.ts 的「界面评审用」假数据，已接真实待办。
 */
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, ClipboardCheck, FileCheck2, Package, type LucideIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type ApiNotification } from '../../../api/client';
import { cn } from '../../../components/ui/cn';
import { fmtRelative } from '../../../utils/time';

/**
 * 待办图标与配色按通知类型取。
 * 不用场景色：通知表只带 type（task_need_confirm / task_assigned），没有场景信息，
 * 硬套场景色会张冠李戴。
 */
const TYPE_STYLE: Record<string, { icon: LucideIcon; icon_cls: string }> = {
  task_need_confirm: { icon: FileCheck2, icon_cls: 'bg-warning-soft text-warning' },
  task_assigned: { icon: Package, icon_cls: 'bg-primary-50 text-primary-600' },
};
const DEFAULT_STYLE = { icon: ClipboardCheck, icon_cls: 'bg-scene-knowledge-soft text-scene-knowledge' };

/** 展示条数：设计稿 3～5 条 */
const LIMIT = 5;

export function TodoPanel() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ApiNotification[] | null>(null);
  /** 正在提交完成的 id，用于禁用复选框防重复点 */
  const [pending, setPending] = useState<Set<number>>(new Set());

  useEffect(() => {
    let alive = true;
    api
      .listNotifications({ todos_only: true, limit: LIMIT })
      .then((rows) => {
        if (alive) setItems(rows);
      })
      .catch(() => {
        if (alive) setItems([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const complete = useCallback(
    async (item: ApiNotification) => {
      if (pending.has(item.id)) return;
      setPending((prev) => new Set(prev).add(item.id));
      // 乐观移除：完成待办是「从列表消失」，不是打勾留念
      setItems((prev) => (prev ? prev.filter((x) => x.id !== item.id) : prev));
      try {
        await api.completeTodo(item.id);
      } catch {
        // 失败则回滚，避免用户以为已处理
        setItems((prev) => (prev ? [item, ...prev].slice(0, LIMIT) : prev));
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }
    },
    [pending],
  );

  return (
    <section
      aria-label="我的待办"
      className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-panel"
    >
      <header className="flex items-center justify-between px-5 py-4">
        <h2 className="text-heading text-ink">我的待办</h2>
        <Link
          to="/tasks?filter=todo"
          className="inline-flex items-center gap-1 text-caption text-primary-500 transition-colors hover:text-primary-600"
        >
          查看全部
          <ArrowRight size={14} />
        </Link>
      </header>

      {items === null ? (
        <ul className="flex flex-col" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className={cn('flex items-center gap-3 px-5 py-[11px]', i > 0 && 'border-t border-line-soft')}>
              <span className="h-4 w-4 shrink-0 animate-pulse rounded-[4px] bg-surface-sunken" />
              <span className="h-3.5 min-w-0 flex-1 animate-pulse rounded bg-surface-sunken" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-body text-ink-soft">暂无待办</p>
          <p className="mt-1 text-caption text-ink-faint">需要你确认或处理的任务会出现在这里</p>
        </div>
      ) : (
        <ul className="flex flex-col">
          {items.map((item, i) => {
            const style = TYPE_STYLE[item.type] ?? DEFAULT_STYLE;
            const Icon = style.icon;
            const busy = pending.has(item.id);

            return (
              <li key={item.id}>
                <div
                  onClick={() => item.task_id && navigate(`/tasks/${item.task_id}`)}
                  className={cn(
                    'flex items-center gap-3 px-5 py-[7px] transition-colors hover:bg-surface-sunken',
                    i > 0 && 'border-t border-line-soft',
                    item.task_id ? 'cursor-pointer' : 'cursor-default',
                  )}
                >
                  <input
                    type="checkbox"
                    id={`todo-${item.id}`}
                    checked={false}
                    disabled={busy}
                    onChange={() => complete(item)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`完成待办「${item.title}」`}
                    className="h-4 w-4 shrink-0 cursor-pointer rounded-[4px] border-line accent-primary-500 disabled:cursor-wait"
                  />

                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px]',
                      style.icon_cls,
                    )}
                  >
                    <Icon size={13} strokeWidth={1.9} />
                  </span>

                  <label
                    htmlFor={`todo-${item.id}`}
                    className="min-w-0 flex-1 cursor-pointer truncate text-body text-ink"
                    title={item.title}
                  >
                    {item.title}
                  </label>

                  <span className="shrink-0 text-caption text-ink-soft">{fmtRelative(item.created_at)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
