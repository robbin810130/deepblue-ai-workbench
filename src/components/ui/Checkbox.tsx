import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** 复选框右侧的文字标签 */
  label?: ReactNode;
}

/**
 * 复选框。
 *
 * 注意：锁定态刻意不使用原生 `disabled`。浏览器在 disabled 下会丢弃
 * `accent-color`，把「已勾选但不可改」渲染成极浅的灰框，视觉上与未勾选
 * 几乎无法区分（在权限管理页实测踩到，会让管理员误判权限未配置）。
 * 因此改为 aria-disabled + 拦截交互，保留勾选态的可见性。
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox(
    { className, label, disabled = false, id, onChange, onClick, ...rest },
    ref,
  ) {
    const input = (
      <input
        ref={ref}
        id={id}
        type="checkbox"
        aria-disabled={disabled || undefined}
        onChange={disabled ? () => {} : onChange}
        onClick={disabled ? (e) => e.preventDefault() : onClick}
        className={cn(
          'h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 accent-brand-600',
          'focus:ring-2 focus:ring-brand-100 focus:ring-offset-0',
          disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
          className,
        )}
        {...rest}
      />
    );

    if (!label) return input;

    return (
      <label
        htmlFor={id}
        className={cn(
          'inline-flex items-center gap-2 text-body text-slate-700',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        {input}
        <span>{label}</span>
      </label>
    );
  },
);
