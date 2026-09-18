/**
 * 快捷操作（工作台首页模块 4 · QuickAction）
 *
 * 依据：06_前端页面详细PRD §1.2
 *   - 必须恰好 4 个固定入口
 *   - 禁止超过 4～5 个（不允许后台任意增殖）
 */
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  LayoutGrid,
  MessageSquareText,
  PlayCircle,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../../components/ui/cn';

interface QuickAction {
  key: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** 图标色（Tailwind 字面量类名，便于扫描） */
  iconClass: string;
  /** 点击目标 */
  to: string;
}

const ACTIONS: QuickAction[] = [
  {
    key: 'upload',
    label: '上传文档',
    hint: '支持 PDF、Word、Excel',
    icon: Upload,
    iconClass: 'bg-primary-50 text-primary-500',
    to: '/knowledge',
  },
  {
    key: 'start',
    label: '发起任务',
    hint: '选择技能快速开始',
    icon: PlayCircle,
    iconClass: 'bg-scene-knowledge-soft text-scene-knowledge',
    to: '/scenes',
  },
  {
    key: 'qa',
    label: '知识问答',
    hint: '基于企业知识，获得专业回答',
    icon: MessageSquareText,
    iconClass: 'bg-success-soft text-success',
    to: '/knowledge?tab=qa',
  },
  {
    key: 'all-skills',
    label: '全部技能',
    hint: '探索更多 AI 能力',
    icon: LayoutGrid,
    iconClass: 'bg-scene-supply-soft text-scene-supply',
    to: '/scenes',
  },
];

export function QuickActions() {
  const navigate = useNavigate();

  return (
    <section aria-label="快捷操作" className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {ACTIONS.map((a) => {
        const Icon = a.icon;
        return (
          <button
            key={a.key}
            type="button"
            onClick={() => navigate(a.to)}
            className={cn(
              'group flex items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3 text-left transition-all',
              'hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-panel-hover',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-200',
            )}
          >
            <span
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]',
                a.iconClass,
              )}
            >
              <Icon size={19} strokeWidth={1.9} />
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-lead font-medium text-ink">
                {a.label}
              </span>
              <span className="mt-0.5 block truncate text-caption text-ink-soft">
                {a.hint}
              </span>
            </span>

            <ChevronRight
              size={16}
              className="shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-primary-400"
            />
          </button>
        );
      })}
    </section>
  );
}
