import type { ReactNode } from 'react';
import { cn } from './cn';
import { EmptyState } from './EmptyState';
import { SkeletonTable } from './Skeleton';

export interface Column<T> {
  key: string;
  title: ReactNode;
  /** 列宽，如 '120px' / '20%' */
  width?: string | number;
  align?: 'left' | 'center' | 'right';
  className?: string;
  /** 自定义单元格渲染；不传则读取 row[key] */
  render?: (row: T, index: number) => ReactNode;
}

export interface DataTableProps<T> {
  columns: Array<Column<T>>;
  data: T[];
  rowKey: (row: T, index: number) => string | number;
  loading?: boolean;
  /** 空态插槽，默认使用 EmptyState */
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  /** 表头吸顶 */
  stickyHeader?: boolean;
  footer?: ReactNode;
  className?: string;
}

const ALIGN_CLASS = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const;

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  rowKey,
  loading = false,
  empty,
  onRowClick,
  stickyHeader = false,
  footer,
  className,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className={cn('p-4', className)}>
        <SkeletonTable rows={5} columns={Math.min(columns.length, 6)} />
      </div>
    );
  }

  if (data.length === 0) {
    return <div className={className}>{empty ?? <EmptyState />}</div>;
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-body">
        <thead
          className={cn(
            'bg-slate-50 text-caption text-slate-500',
            stickyHeader && 'sticky top-0 z-10',
          )}
        >
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{ width: col.width }}
                className={cn(
                  'border-b border-slate-200 px-3 py-2.5 font-medium',
                  ALIGN_CLASS[col.align ?? 'left'],
                )}
              >
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            <tr
              key={rowKey(row, index)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-b border-slate-100 transition-colors last:border-b-0',
                onRowClick && 'cursor-pointer hover:bg-slate-50',
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'px-3 py-2.5 text-slate-700',
                    ALIGN_CLASS[col.align ?? 'left'],
                    col.className,
                  )}
                >
                  {col.render
                    ? col.render(row, index)
                    : (row[col.key] as ReactNode)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {footer}
    </div>
  );
}
