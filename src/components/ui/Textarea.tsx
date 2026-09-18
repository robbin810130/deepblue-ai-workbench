import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** 校验失败态：红色描边 */
  invalid?: boolean;
  /** 是否允许纵向拉伸，默认固定高度（与存量界面语义一致） */
  resizable?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { className, invalid = false, resizable = false, rows = 3, ...rest },
    ref,
  ) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(
          'w-full rounded-control border bg-white px-3 py-2 text-body text-slate-800',
          'placeholder:text-slate-400 transition-colors',
          'focus:outline-none focus:ring-2',
          invalid
            ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
            : 'border-slate-200 hover:border-slate-300 focus:border-brand-500 focus:ring-brand-100',
          'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400',
          resizable ? 'resize-y' : 'resize-none',
          className,
        )}
        {...rest}
      />
    );
  },
);
