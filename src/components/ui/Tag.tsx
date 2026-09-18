import type { ReactNode } from 'react';
import { cn } from './cn';

export type TagTone =
  | 'neutral'
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

export type TagSize = 'sm' | 'md';

export interface TagProps {
  children: ReactNode;
  tone?: TagTone;
  size?: TagSize;
  /** 左侧圆点，用于状态类标识 */
  dot?: boolean;
  className?: string;
}

const TONE_CLASS: Record<TagTone, string> = {
  neutral: 'bg-slate-100 text-slate-600 border-slate-200',
  brand: 'bg-brand-50 text-brand-700 border-brand-100',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  warning: 'bg-amber-50 text-amber-700 border-amber-100',
  danger: 'bg-red-50 text-red-700 border-red-100',
  info: 'bg-blue-50 text-blue-700 border-blue-100',
};

const DOT_CLASS: Record<TagTone, string> = {
  neutral: 'bg-slate-400',
  brand: 'bg-brand-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-blue-500',
};

const SIZE_CLASS: Record<TagSize, string> = {
  sm: 'h-5 px-2 text-2xs gap-1',
  md: 'h-6 px-2.5 text-caption gap-1.5',
};

export function Tag({
  children,
  tone = 'neutral',
  size = 'md',
  dot = false,
  className,
}: TagProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border font-medium',
        TONE_CLASS[tone],
        SIZE_CLASS[size],
        className,
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', DOT_CLASS[tone])} />}
      {children}
    </span>
  );
}
