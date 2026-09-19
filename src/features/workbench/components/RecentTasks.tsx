/**
 * 最近任务（工作台首页模块 6 · RecentTaskList）
 *
 * 依据：06_前端页面详细PRD §1.2 —— 4～6 条；禁止展示技术日志
 *      01_前端开发规范 §6 —— 默认 4 条；状态、时间、点击进入详情
 *
 * 数据：GET /api/v1/tasks?limit=4（按创建时间倒序，由后端排序）
 *      原先读的是 mock.ts 的「界面评审用」假数据，已接真实任务。
 */
import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, FileCheck2, ImageIcon, Package, PieChart, TrendingUp, type LucideIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type ApiTask } from '../../../api/client';
import { sceneArtKey } from '../../../api/sceneMap';
import { SCENE_TONE } from '../../../config/scenes';
import { StatusTag } from '../../../components/common/StatusTag';
import { cn } from '../../../components/ui/cn';
import { fmtRelative } from '../../../utils/time';
import type { SceneKey, TaskStatus } from '../../../types/domain';

const SCENE_ICON: Record<SceneKey, LucideIcon> = {
  market: TrendingUp,
  contract: FileCheck2,
  supply: Package,
  content: ImageIcon,
  knowledge: BookOpen,
  analysis: PieChart,
};

/** 展示条数：设计稿 4 条 */
const LIMIT = 4;

export function RecentTasks() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ApiTask[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .listTasks({ limit: LIMIT })
      .then((rows) => {
        if (alive) setItems(rows);
      })
      .catch(() => {
        // 401 由 client 统一处理（跳登录页），这里只负责不把页面卡在加载态
        if (alive) {
          setItems([]);
          setFailed(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

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

      {items === null ? (
        <ul className="flex flex-col" aria-busy="true">
          {Array.from({ length: LIMIT }).map((_, i) => (
            <li
              key={i}
              className={cn('flex items-center gap-3 px-5 py-[15px]', i > 0 && 'border-t border-line-soft')}
            >
              <span className="h-8 w-8 shrink-0 animate-pulse rounded-[9px] bg-surface-sunken" />
              <span className="h-3.5 min-w-0 flex-1 animate-pulse rounded bg-surface-sunken" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <EmptyHint failed={failed} />
      ) : (
        <ul className="flex flex-col">
          {items.map((t, i) => {
            const scene = sceneArtKey(t.scene);
            const Icon = SCENE_ICON[scene];
            const tone = SCENE_TONE[scene];
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

                  <span className="min-w-0 flex-1 truncate text-lead text-ink">{t.title}</span>

                  <StatusTag status={t.status as TaskStatus} />

                  <span className="w-[74px] shrink-0 text-right text-caption text-ink-soft">
                    {fmtRelative(t.created_at)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function EmptyHint({ failed }: { failed: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-5 py-8 text-center">
      <p className="text-body text-ink-soft">{failed ? '任务加载失败' : '还没有任务'}</p>
      <Link to="/scenes" className="text-caption text-primary-500 transition-colors hover:text-primary-600">
        去业务场景发起一个 →
      </Link>
    </div>
  );
}
