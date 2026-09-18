/**
 * 侧栏一级导航
 *
 * 依据：01_前端开发规范与页面设计说明 §5 App Shell 结构
 *      + 已确认的工作台主界面设计稿
 *
 * 规则（§3 布局尺寸）：侧栏固定，仅一级导航，不放业务说明。
 */
import {
  BarChart3,
  BookOpen,
  Boxes,
  ClipboardCheck,
  LayoutGrid,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  key: string;
  label: string;
  /** 路由路径，对应 01 文档 §9 路由规范 */
  to: string;
  icon: LucideIcon;
  /** 右侧展开箭头（管理后台这类有二级的入口） */
  expandable?: boolean;
  /** 命中这些路径前缀时也算选中（用于 /scenes/:key 这类子路由） */
  matchPrefixes?: string[];
}

export const PRIMARY_NAV: NavItem[] = [
  {
    key: 'workbench',
    label: '工作台',
    to: '/workbench',
    icon: LayoutGrid,
  },
  {
    key: 'scenes',
    label: '业务场景',
    to: '/scenes',
    icon: Boxes,
    matchPrefixes: ['/scenes', '/skills'],
  },
  {
    key: 'tasks',
    label: '任务中心',
    to: '/tasks',
    icon: ClipboardCheck,
    matchPrefixes: ['/tasks'],
  },
  {
    key: 'knowledge',
    label: '知识库',
    to: '/knowledge',
    icon: BookOpen,
    matchPrefixes: ['/knowledge'],
  },
  {
    key: 'dashboard',
    label: '数据看板',
    to: '/dashboard',
    icon: BarChart3,
    matchPrefixes: ['/dashboard'],
  },
  {
    key: 'admin',
    label: '管理后台',
    to: '/admin',
    icon: SlidersHorizontal,
    expandable: true,
    matchPrefixes: ['/admin'],
  },
];

/** 侧栏底部独立项（与一级导航分隔） */
export const FOOTER_NAV: NavItem[] = [
  {
    key: 'settings',
    label: '系统设置',
    to: '/settings',
    icon: SlidersHorizontal,
    matchPrefixes: ['/settings'],
  },
];
