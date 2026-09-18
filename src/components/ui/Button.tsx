import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'danger-outline'
  | 'text';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 视觉风格，默认 secondary（与存量界面主色调一致，避免突兀） */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 加载中：自动禁用并显示 spinner（并替换 icon 位置） */
  loading?: boolean;
  /** 按钮左侧图标 */
  icon?: ReactNode;
  /** 是否占满父容器宽度 */
  block?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300',
  secondary:
    'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 active:bg-slate-100',
  ghost:
    'bg-transparent text-slate-600 hover:bg-slate-100 active:bg-slate-200',
  danger:
    'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:bg-red-300',
  /** 描边危险：用于删除类次要操作（存量代码中高频出现） */
  'danger-outline':
    'bg-white text-red-600 border border-red-200 hover:bg-red-50 hover:border-red-300 active:bg-red-100',
  text:
    'bg-transparent text-brand-600 hover:text-brand-700 hover:bg-brand-50',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-caption gap-1.5',
  md: 'h-9 px-4 text-body gap-2',
  lg: 'h-11 px-6 text-lead gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    icon,
    block = false,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-control font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});
