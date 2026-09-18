/**
 * 任务状态标签
 *
 * 依据：01_前端开发规范 §12 —— 颜色不能作为唯一状态标识，状态同时显示文字。
 * 状态机八态见 05_任务中心详细PRD。
 */
import { cn } from '../ui/cn';
import { TASK_STATUS_META, type TaskStatus } from '../../types/domain';

export function StatusTag({
  status,
  className,
}: {
  status: TaskStatus;
  className?: string;
}) {
  const meta = TASK_STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-[3px] text-caption font-medium',
        meta.tone,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  );
}
