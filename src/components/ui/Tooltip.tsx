import type { ReactNode } from 'react';
import { cn } from './cn';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: TooltipSide;
  className?: string;
}

const SIDE_CLASS: Record<TooltipSide, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
};

/** 轻量提示，纯 CSS 实现，无 portal / 无定位计算。适合短文本说明。 */
export function Tooltip({
  content,
  children,
  side = 'top',
  className,
}: TooltipProps) {
  if (content === null || content === undefined || content === '') {
    return <>{children}</>;
  }

  return (
    <span className={cn('group relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-50 whitespace-nowrap rounded-control',
          'bg-slate-800 px-2 py-1 text-2xs text-white opacity-0 transition-opacity',
          'group-hover:opacity-100',
          SIDE_CLASS[side],
        )}
      >
        {content}
      </span>
    </span>
  );
}
