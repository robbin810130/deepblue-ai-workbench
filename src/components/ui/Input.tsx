import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** 校验失败态：红色描边 */
  invalid?: boolean;
  /** 左侧图标 */
  prefixIcon?: ReactNode;
  /** 右侧插槽（清空按钮、单位等） */
  suffix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid = false, prefixIcon, suffix, disabled, ...rest },
  ref,
) {
  const input = (
    <input
      ref={ref}
      disabled={disabled}
      className={cn(
        'h-9 w-full rounded-control border bg-white px-3 text-body text-slate-800',
        'placeholder:text-slate-400 transition-colors',
        'focus:outline-none focus:ring-2',
        invalid
          ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
          : 'border-slate-200 hover:border-slate-300 focus:border-brand-500 focus:ring-brand-100',
        'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400',
        prefixIcon ? 'pl-9' : null,
        suffix ? 'pr-9' : null,
        className,
      )}
      {...rest}
    />
  );

  if (!prefixIcon && !suffix) return input;

  return (
    <div className="relative w-full">
      {prefixIcon && (
        <span className="pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 text-slate-400">
          {prefixIcon}
        </span>
      )}
      {input}
      {suffix && (
        <span className="absolute right-3 top-1/2 flex -translate-y-1/2 text-slate-400">
          {suffix}
        </span>
      )}
    </div>
  );
});
