import type { ReactNode } from 'react';
import { cn } from './cn';

export interface TabItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** 数量角标，为 0 时不显示 */
  badge?: number;
}

/**
 * line —— 下划线式，适合页面级主导航
 * pill —— 灰底容器 + 白底选中，适合工具条切换
 * soft —— 透明容器 + 浅色选中底，对应存量代码中最高频的选中态写法
 *        （如 bg-blue-50 text-blue-600 / bg-indigo-50 text-indigo-700）
 */
export type TabsVariant = 'line' | 'pill' | 'soft';

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
  variant?: TabsVariant;
  className?: string;
}

export function Tabs({
  items,
  value,
  onChange,
  variant = 'line',
  className,
}: TabsProps) {
  return (
    <div
      role="tablist"
      className={cn(
        'flex items-center gap-1',
        variant === 'line' && 'border-b border-slate-200',
        variant === 'pill' && 'rounded-control bg-slate-100 p-1',
        className,
      )}
    >
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => !item.disabled && onChange(item.key)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 text-body font-medium transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-50',
              variant === 'line' && 'border-b-2 px-3 py-2 -mb-px',
              variant === 'line' &&
                (active
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'),
              variant === 'pill' && 'rounded-control px-3 py-1.5',
              variant === 'pill' &&
                (active
                  ? 'bg-white text-brand-700 shadow-control'
                  : 'text-slate-500 hover:text-slate-700'),
              variant === 'soft' && 'rounded-control px-4 py-2',
              variant === 'soft' &&
                (active
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'),
            )}
          >
            {item.icon}
            {item.label}
            {typeof item.badge === 'number' && item.badge > 0 && (
              <span
                className={cn(
                  'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-2xs',
                  active
                    ? 'bg-brand-100 text-brand-700'
                    : 'bg-slate-200 text-slate-600',
                )}
              >
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
