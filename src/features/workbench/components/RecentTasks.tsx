/**
 * 最近任务（工作台首页模块 6 · RecentTaskList）
 *
 * 依据：06_前端页面详细PRD §1.2 —— 4～6 条；禁止展示技术日志
 *      01_前端开发规范 §6 —— 默认 4 条；状态、时间、点击进入详情
 */
import { ArrowRight, BookOpen, FileCheck2, ImageIcon, Package, PieChart, TrendingUp, type LucideIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { MOCK_RECENT_TASKS } from '../mock';
import { SCENE_TONE } from '../../../config/scenes';
import { StatusTag } from '../../../components/common/StatusTag';
import { cn } from '../../../components/ui/cn';
import type { SceneKey } from '../../../types/domain';

const SCENE_ICON: Record<SceneKey, LucideIcon> = {
  market: TrendingUp,
  contract: FileCheck2,
  supply: Package,
  content: ImageIcon,
  knowledge: BookOpen,
  analysis: PieChart,
};

export function RecentTasks() {
  const navigate = useNavigate();

  return (
    <section
      aria-label="最近任务"
      className="flex flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-panel"
    >
      <header className="flex items-center justify-between px-5 py-4">
        <h2 className="text-heading text-ink">最近任务</h2>
        <Link
          to="/tasks"
          className="inline-flex items-center gap-1 text-caption text-primary-500 transition-colors hover:text-primary-600"
        >
          查看全部
          <ArrowRight size={14} />
        </Link>
      </header>

      <ul className="flex flex-col">
        {MOCK_RECENT_TASKS.map((t, i) => {
          const Icon = SCENE_ICON[t.scene];
          const tone = SCENE_TONE[t.scene];
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => navigate(`/tasks/${t.id}`)}
                className={cn(
                  'flex w-full items-center gap-3 px-5 py-[7px] text-left transition-colors',
                  'hover:bg-surface-sunken focus-visible:outline-none focus-visible:bg-surface-sunken',
                  i > 0 && 'border-t border-line-soft',
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]',
                    tone.accent,
                    tone.ink,
                  )}
                >
                  <Icon size={15} strokeWidth={1.9} />
                </span>

                <span className="min-w-0 flex-1 truncate text-lead text-ink">
                  {t.title}
                </span>

                <StatusTag status={t.status} />

                <span className="w-[74px] shrink-0 text-right text-caption text-ink-soft">
                  {t.timeLabel}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
