/**
 * 顶部栏（Topbar）
 *
 * 依据：01_前端开发规范 §5 App Shell（GlobalSearch / Notifications / UserMenu）
 *      + 工作台主界面设计稿
 *
 * 规格：高度 60px；白底 + 底部分隔线。
 * 禁止：模型选择器、Token 展示（见 06 文档 §1.2 明确列为禁止内容）。
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '../../components/ui/cn';
import { NotificationsBell } from '../notifications/NotificationsBell';

interface TopbarProps {
  /** 当前登录用户展示名 */
  username: string;
}

export function Topbar({ username }: TopbarProps) {
  const [keyword, setKeyword] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // 键盘可达性（§12）：⌘K / Ctrl+K 聚焦全局搜索，Esc 清空并失焦
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        setKeyword('');
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const initial = username.trim().charAt(0).toUpperCase() || 'U';

  return (
    <header className="flex h-[60px] shrink-0 items-center justify-between gap-6 border-b border-line bg-surface px-6">
      {/* 全局搜索 */}
      <div className="relative w-full max-w-[420px]">
        <Search
          size={16}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
        />
        <input
          ref={searchRef}
          type="search"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          aria-label="全局搜索"
          placeholder="搜索技能、任务或文档..."
          className={cn(
            'h-9 w-full rounded-[10px] border border-transparent bg-page pl-10 pr-3',
            'text-lead text-ink transition-colors placeholder:text-ink-faint',
            'hover:bg-surface-sunken',
            'focus:border-primary-300 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary-100',
          )}
        />
      </div>

      {/* 通知 + 用户菜单 */}
      <div className="flex shrink-0 items-center gap-2">
        <NotificationsBell />

        <div className="mx-1 h-5 w-px bg-line" />

        <button
          type="button"
          aria-label="用户菜单"
          className="flex h-9 items-center gap-2 rounded-[10px] pl-1 pr-2 transition-colors hover:bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-200"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-primary-600 text-caption font-semibold text-white">
            {initial}
          </span>
          <span className="max-w-[120px] truncate text-lead font-medium text-ink">
            {username}
          </span>
          <ChevronDown size={15} className="text-ink-faint" />
        </button>
      </div>
    </header>
  );
}
