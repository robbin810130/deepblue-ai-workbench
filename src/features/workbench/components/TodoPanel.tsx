/**
 * 我的待办（工作台首页模块 7 · TodoPanel）
 *
 * 依据：01_前端开发规范 §6 —— 只放可行动事项；与系统通知分开
 *      06_前端页面详细PRD §1.2 —— 3～5 条；禁止混入普通动态
 */
import { ArrowRight, BookOpen, FileCheck2, Package, TrendingUp, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MOCK_RECENT_TASKS, MOCK_TODOS } from '../mock';
import { SCENE_TONE } from '../../../config/scenes';
import { cn } from '../../../components/ui/cn';
import type { SceneKey } from '../../../types/domain';

const SCENE_ICON: Partial<Record<SceneKey, LucideIcon>> = {
  market: TrendingUp,
  contract: FileCheck2,
  supply: Package,
  knowledge: BookOpen,
};

export function TodoPanel() {
  const navigate = useNavigate();
  const [items, setItems] = useState(MOCK_TODOS);

  const toggle = (id: string) =>
    setItems((prev) =>
      prev.map((x) => (x.id === id ? { ...x, done: !x.done } : x)),
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

      <ul className="flex flex-col">
        {items.map((item, i) => {
          const source = MOCK_RECENT_TASKS.find((t) => t.id === item.taskId);
          const scene: SceneKey = source?.scene ?? 'knowledge';
          const Icon = SCENE_ICON[scene] ?? BookOpen;
          const tone = SCENE_TONE[scene];

          return (
            <li key={item.id}>
              <div
                onClick={() => item.taskId && navigate(`/tasks/${item.taskId}`)}
                className={cn(
                  'flex items-center gap-3 px-5 py-[7px] transition-colors hover:bg-surface-sunken',
                  i > 0 && 'border-t border-line-soft',
                )}
              >
                <input
                  type="checkbox"
                  id={`todo-${item.id}`}
                  checked={Boolean(item.done)}
                  onChange={() => toggle(item.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`标记「${item.title}」为已完成`}
                  className="h-4 w-4 shrink-0 cursor-pointer rounded-[4px] border-line accent-primary-500"
                />

                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px]',
                    tone.accent,
                    tone.ink,
                  )}
                >
                  <Icon size={13} strokeWidth={1.9} />
                </span>

                <label
                  htmlFor={`todo-${item.id}`}
                  className={cn(
                    'min-w-0 flex-1 cursor-pointer truncate text-body text-ink',
                    item.done && 'text-ink-faint line-through',
                  )}
                >
                  {item.title}
                </label>

                <span className="shrink-0 text-caption text-ink-soft">
                  {item.timeLabel}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
