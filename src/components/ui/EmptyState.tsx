import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from './cn';

export interface EmptyStateProps {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** 引导操作，通常放一个 Button */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  title = '暂无数据',
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-4 py-12 text-center',
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <p className="text-lead font-medium text-slate-600">{title}</p>
      {description && (
        <p className="max-w-sm text-caption leading-relaxed text-slate-400">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
