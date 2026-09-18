import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from './cn';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  tone?: ToastTone;
  /** 毫秒，默认 3000 */
  duration?: number;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  duration: number;
}

const EVENT_NAME = 'ui-toast';
let seq = 0;

/**
 * 触发一条轻提示。事件式 API：任何位置（含存量代码）都可直接调用，
 * 只需在应用根部挂载一次 <ToastHost />。
 */
export function toast(message: string, options: ToastOptions = {}) {
  window.dispatchEvent(
    new CustomEvent(EVENT_NAME, {
      detail: {
        message,
        tone: options.tone ?? 'info',
        duration: options.duration ?? 3000,
      } satisfies Omit<ToastItem, 'id'>,
    }),
  );
}

const TONE_STYLE: Record<ToastTone, string> = {
  info: 'bg-white text-slate-700 border-slate-200',
  success: 'bg-white text-emerald-700 border-emerald-200',
  warning: 'bg-white text-amber-700 border-amber-200',
  error: 'bg-white text-red-700 border-red-200',
};

const TONE_ICON: Record<ToastTone, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<Omit<ToastItem, 'id'>>).detail;
      if (!detail?.message) return;
      const id = (seq += 1);
      setItems((prev) => [...prev, { ...detail, id }]);
      if (detail.duration > 0) {
        window.setTimeout(() => {
          setItems((prev) => prev.filter((it) => it.id !== id));
        }, detail.duration);
      }
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  const dismiss = (id: number) =>
    setItems((prev) => prev.filter((it) => it.id !== id));

  if (items.length === 0) return null;

  return createPortal(
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[320px] flex-col gap-2">
      {items.map((item) => {
        const Icon = TONE_ICON[item.tone];
        return (
          <div
            key={item.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 rounded-card border bg-white px-3.5 py-3 shadow-overlay',
              TONE_STYLE[item.tone],
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1 break-words text-body">{item.message}</p>
            <button
              type="button"
              aria-label="关闭"
              onClick={() => dismiss(item.id)}
              className="shrink-0 rounded-control p-0.5 text-slate-300 transition-colors hover:text-slate-500"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
