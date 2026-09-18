/**
 * 占位页
 *
 * 用途：新架构下尚未实现的路由，给一个明确的「已规划、待实现」状态，
 *      避免用户点进空白页（06_前端页面详细PRD §11 空状态要求：
 *      说明为什么为空，并给出一个主要行动按钮）。
 */
import { Hammer } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function ComingSoon({
  title,
  hint = '该页面将在下一轮实现，当前版本先交付工作台首页。',
}: {
  title: string;
  hint?: string;
}) {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-[440px] flex-col items-center justify-center rounded-[14px] border border-dashed border-line bg-surface px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-primary-50 text-primary-400">
        <Hammer size={22} strokeWidth={1.9} />
      </div>
      <h2 className="mt-4 text-heading text-ink">{title}</h2>
      <p className="mt-1.5 max-w-[420px] text-lead text-ink-soft">{hint}</p>
      <button
        type="button"
        onClick={() => navigate('/workbench')}
        className="mt-5 h-9 rounded-control bg-primary-500 px-4 text-lead font-medium text-white transition-colors hover:bg-primary-600"
      >
        返回工作台
      </button>
    </div>
  );
}
