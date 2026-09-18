import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from './cn';

export type DrawerWidth = 'sm' | 'md' | 'lg';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: DrawerWidth;
  className?: string;
}

const WIDTH_CLASS: Record<DrawerWidth, string> = {
  sm: 'w-[360px]',
  md: 'w-[480px]',
  lg: 'w-[640px]',
};

/** 右侧抽屉，适合承载筛选、详情等次要任务，避免打断主流程。 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'md',
  className,
}: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
      role="presentation"
    >
      <aside
        role="dialog"
        aria-modal="true"
        className={cn(
          'flex h-full max-w-full flex-col bg-white shadow-overlay',
          WIDTH_CLASS[width],
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 className="min-w-0 truncate text-lead font-medium text-slate-800">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 rounded-control p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-body text-slate-700">
          {children}
        </div>

        {footer && (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
            {footer}
          </footer>
        )}
      </aside>
    </div>,
    document.body,
  );
}
