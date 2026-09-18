import type { ReactNode } from 'react';
import { cn } from './cn';

export interface CardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** 标题栏右侧操作区 */
  extra?: ReactNode;
  children?: ReactNode;
  /** 是否启用默认内边距；表格类内容通常传 false 自行控制 */
  padded?: boolean;
  className?: string;
  bodyClassName?: string;
}

export function Card({
  title,
  subtitle,
  extra,
  children,
  padded = true,
  className,
  bodyClassName,
}: CardProps) {
  const hasHeader = Boolean(title || subtitle || extra);

  return (
    <section
      className={cn(
        'rounded-card border border-slate-200 bg-white shadow-card',
        className,
      )}
    >
      {hasHeader && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            {title && (
              <h3 className="truncate text-lead font-medium text-slate-800">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="mt-0.5 truncate text-caption text-slate-500">
                {subtitle}
              </p>
            )}
          </div>
          {extra && <div className="shrink-0">{extra}</div>}
        </header>
      )}
      <div className={cn(padded && 'p-4', bodyClassName)}>{children}</div>
    </section>
  );
}
