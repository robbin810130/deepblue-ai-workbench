/**
 * 管理后台内部共用件
 *
 * 说明：本文件只服务于 /admin 下的页签，不进 components/ui（那是跨模块原子件，
 * 用的是存量色板；本页签沿用新设计系统的 token 命名空间）。
 */
import type { ReactNode } from 'react';
import { cn } from '../../components/ui/cn';

export function Banner({
  tone,
  children,
  onClose,
}: {
  tone: 'error' | 'success' | 'info';
  children: ReactNode;
  onClose?: () => void;
}) {
  const cls =
    tone === 'error'
      ? 'bg-danger-soft text-danger'
      : tone === 'success'
        ? 'bg-success-soft text-success'
        : 'bg-primary-50 text-primary-600';
  return (
    <div className={cn('mt-3 flex items-start justify-between gap-3 rounded-lg px-4 py-2.5 text-caption', cls)}>
      <span className="leading-relaxed">{children}</span>
      {onClose && (
        <button type="button" onClick={onClose} className="shrink-0 opacity-70 hover:opacity-100">
          关闭
        </button>
      )}
    </div>
  );
}

export function Panel({
  title,
  hint,
  actions,
  children,
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface">
      <div className="flex items-end justify-between gap-4 border-b border-line px-5 py-3">
        <div>
          <h2 className="text-body font-medium text-ink">{title}</h2>
          {hint && <p className="mt-0.5 text-caption text-ink-soft">{hint}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  disabled,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="text-caption font-medium text-ink">{label}</span>
      <input
        type={type}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 h-9 w-full rounded-lg border border-line bg-page px-3 text-lead text-ink placeholder:text-ink-faint focus:border-primary-300 focus:outline-none disabled:bg-surface-sunken disabled:text-ink-faint"
      />
    </label>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  loading,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}) {
  const off = disabled || loading;
  return (
    <button
      type="button"
      disabled={off}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3.5 text-lead font-medium transition-colors',
        off
          ? 'cursor-not-allowed bg-surface-sunken text-ink-faint'
          : 'bg-primary-600 text-white hover:bg-primary-700',
        className,
      )}
    >
      {loading ? '处理中…' : children}
    </button>
  );
}

export function SubButton({
  children,
  onClick,
  danger,
}: {
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-caption transition-colors',
        danger ? 'text-ink-faint hover:text-danger' : 'text-ink-soft hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function errText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as Error).message);
  return '请求失败';
}
