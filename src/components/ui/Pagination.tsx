import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from './cn';
import { Select } from './Select';

export interface PaginationProps {
  /** 当前页，从 1 开始 */
  page: number;
  pageSize: number;
  /** 总条数 */
  total: number;
  onChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

function buildPages(current: number, total: number): Array<number | 'gap'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: Array<number | 'gap'> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('gap');
  for (let i = start; i <= end; i += 1) pages.push(i);
  if (end < total - 1) pages.push('gap');
  pages.push(total);
  return pages;
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const pages = buildPages(current, totalPages);

  const go = (next: number) => {
    const target = Math.min(Math.max(1, next), totalPages);
    if (target !== current) onChange(target);
  };

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 px-1 py-3',
        className,
      )}
    >
      <div className="flex items-center gap-3 text-caption text-slate-500">
        <span>共 {total} 条</span>
        {onPageSizeChange && (
          <span className="flex items-center gap-1.5">
            每页
            <Select
              className="h-7 w-[72px] text-caption"
              value={String(pageSize)}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              options={pageSizeOptions.map((n) => ({
                value: String(n),
                label: `${n} 条`,
              }))}
            />
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="上一页"
          disabled={current <= 1}
          onClick={() => go(current - 1)}
          className="flex h-7 w-7 items-center justify-center rounded-control text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {pages.map((p, i) =>
          p === 'gap' ? (
            <span key={`gap-${i}`} className="px-1 text-caption text-slate-400">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => go(p)}
              className={cn(
                'h-7 min-w-7 rounded-control px-1.5 text-caption transition-colors',
                p === current
                  ? 'bg-brand-600 font-medium text-white'
                  : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              {p}
            </button>
          ),
        )}

        <button
          type="button"
          aria-label="下一页"
          disabled={current >= totalPages}
          onClick={() => go(current + 1)}
          className="flex h-7 w-7 items-center justify-center rounded-control text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
