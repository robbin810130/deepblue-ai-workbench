import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from './cn';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  /** 底部操作区，通常放 Button */
  footer?: ReactNode;
  size?: ModalSize;
  /** 点击遮罩是否关闭，默认 true */
  closeOnOverlay?: boolean;
  /** 是否显示右上角关闭按钮，默认 true */
  showClose?: boolean;
  className?: string;
}

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

/**
 * 通用弹窗。
 * 与存量弹窗视觉等价（fixed inset-0 + 居中卡片），但统一了遮罩、圆角、阴影与关闭行为。
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  closeOnOverlay = true,
  showClose = true,
  className,
}: ModalProps) {
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={closeOnOverlay ? onClose : undefined}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'flex max-h-[calc(100vh-4rem)] w-full flex-col overflow-hidden',
          'rounded-panel bg-white shadow-overlay',
          SIZE_CLASS[size],
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || showClose) && (
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
            <h2 className="min-w-0 truncate text-lead font-medium text-slate-800">
              {title}
            </h2>
            {showClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭"
                className="shrink-0 rounded-control p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </header>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-body text-slate-700">
          {children}
        </div>

        {footer && (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
