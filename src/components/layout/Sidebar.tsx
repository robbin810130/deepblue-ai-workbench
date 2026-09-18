/**
 * 侧栏（Sidebar）
 *
 * 依据：01_前端开发规范与页面设计说明 §3 布局尺寸、§5 App Shell
 *      + 工作台主界面设计稿
 *
 * 规格：
 *   宽度   232px（文档建议 220～240px）
 *   底色   #102A43 ～ #163A5F 纵向渐变
 *   内容   仅一级导航 + 底部品牌卡 + 系统设置（不放业务说明）
 */
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Sparkles, Zap } from 'lucide-react';
import { FOOTER_NAV, PRIMARY_NAV, type NavItem } from '../../config/navItems';
import { cn } from '../../components/ui/cn';

function isItemActive(item: NavItem, pathname: string): boolean {
  const prefixes = item.matchPrefixes ?? [item.to];
  return prefixes.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex h-10 items-center gap-3 rounded-[10px] px-3 text-lead transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
        active
          ? 'bg-white/[0.14] font-medium text-white'
          : 'text-sidebar-fg-soft hover:bg-white/[0.07] hover:text-white',
      )}
    >
      <Icon
        size={18}
        strokeWidth={active ? 2.1 : 1.8}
        className="shrink-0"
      />
      <span className="truncate">{item.label}</span>
      {item.expandable && (
        <ChevronRight
          size={15}
          className="ml-auto shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5"
        />
      )}
    </Link>
  );
}

export function Sidebar() {
  const { pathname } = useLocation();

  return (
    <aside className="dw-scroll flex h-full w-[232px] shrink-0 flex-col overflow-y-auto bg-gradient-to-b from-sidebar-from to-sidebar-to">
      {/* 品牌区 */}
      <div className="flex h-[60px] shrink-0 items-center gap-2.5 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-gradient-to-br from-primary-400 to-primary-600 shadow-[0_2px_8px_rgba(47,107,255,0.45)]">
          <Sparkles size={17} className="text-white" strokeWidth={2.2} />
        </div>
        <span className="text-[15px] font-semibold tracking-[-0.2px] text-white">
          NanGuang AI
        </span>
      </div>

      {/* 一级导航 */}
      <nav className="mt-3 flex flex-col gap-1 px-3" aria-label="主导航">
        {PRIMARY_NAV.map((item) => (
          <SidebarLink
            key={item.key}
            item={item}
            active={isItemActive(item, pathname)}
          />
        ))}
      </nav>

      {/* 底部：品牌卡 + 系统设置 */}
      <div className="mt-auto flex flex-col gap-3 px-3 pb-4 pt-6">
        <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3.5">
          <div className="flex items-start gap-2.5">
            <Zap
              size={16}
              className="mt-[3px] shrink-0 text-primary-300"
              strokeWidth={2.2}
            />
            <div className="leading-5">
              <div className="text-[13px] text-white/95">让 AI 成为</div>
              <div className="text-caption text-sidebar-fg-soft">
                你最可靠的工作搭档
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          {FOOTER_NAV.map((item) => (
            <SidebarLink
              key={item.key}
              item={item}
              active={isItemActive(item, pathname)}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}
