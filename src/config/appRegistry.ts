// ============================================================
// appRegistry.ts — 应用注册表（单一数据源 / Single Source of Truth）
//
// 背景：重构前，一个应用的信息被硬编码在 7 个地方，新增一个模块要改 7 处：
//   1. src/config/permissionConfig.ts        AppId 联合类型
//   2. src/config/permissionConfig.ts        APP_META（label + 权限分类）
//   3. src/types/index.ts                    ModuleType 联合类型
//   4. SystemInterface.tsx                   allApps（桌面 label/icon/color/分组）
//   5. SystemInterface.tsx:736               816 字符的布局判定链（31 个 id）
//   6. SystemInterface.tsx:749-784           35 条条件渲染分支 + 顶部 36 个 React.lazy
//   7. SystemInterface.tsx:100-142           DEFAULT_POSITIONS 桌面坐标
//   8. SystemInterface.tsx:94-98/187-190     默认常用集合（写了两遍）
//   9. PermissionModule.tsx:16-37            APP_ICONS 图标映射（只覆盖 20/36）
//
// 本文件把这 9 处收敛成 1 处。新增一个模块 = 在这里加 1 个对象。
//
// ✅ 阶段 2 已接线：SystemInterface.tsx / permissionConfig.ts 均改为消费本文件，
//    上述 9 处硬编码已逐条删除。新增模块现在只需在本文件加 1 个对象。
// ============================================================

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Search, BarChart3, Users, User, Truck, Sparkles, Grid3X3, Newspaper, Columns,
  FileText, Globe, FlaskConical, Package, ShieldCheck, ClipboardList, FileBadge,
  BookOpen, Pen, Film, Scan, TrendingUp, Receipt, Database, Target, FileSearch,
  Building2, LayoutDashboard,
  // 以下 2 个仅用于记录 PermissionModule.APP_ICONS 的冲突取值，待裁决后定稿
  MessageSquare, Lock,
} from 'lucide-react';

// ─── 类型 ────────────────────────────────────────────────────────

/** 窗口内容布局方式。full = 全宽满铺；padded = 居中留白（max-w-7xl） */
export type AppLayout = 'full' | 'padded';

/** 桌面内置分组名（与桌面自动分文件夹的 label 一一对应） */
export type DesktopGroup = '核心业务' | '产业赋能' | '专业工具' | '系统配置';

export interface AppRegistryEntry {
  /** 唯一标识。当前在 permissionConfig.ts 中定义，阶段 2 接线后改由本文件定义 */
  id: string;
  /** 桌面图标与窗口标签显示名 */
  label: string;
  /** 桌面图标组件 */
  icon: LucideIcon;
  /** 桌面图标底色（Tailwind 渐变类名） */
  color: string;
  /** 权限配置 UI 的分类（原 APP_META.category，与桌面分组是两套体系） */
  permissionCategory: string;
  /** 权限配置 UI 的显示名。仅当与 label 不一致时填写（冲突待裁决） */
  permissionLabel?: string;
  /** 权限配置 UI 的图标。仅当与 icon 不一致时填写（冲突待裁决） */
  permissionIcon?: LucideIcon;
  /** 桌面自动分文件夹依据。null = 不参与内置分组（如已下架应用） */
  desktopGroup: DesktopGroup | null;
  /** 窗口内容布局 */
  layout: AppLayout;
  /** 是否出现在桌面（等价于原 allApps 的有效条目） */
  onDesktop: boolean;
  /** 桌面排序位次（原 allApps 数组下标）。onDesktop 为 false 时无意义 */
  desktopIndex?: number;
  /** 无视权限对所有人可见 */
  alwaysVisible?: boolean;
  /** 是否属于「桌面 2 默认演示」集合 */
  favoriteByDefault?: boolean;
  /** 默认桌面坐标（网格行列，非像素）。缺省时落 (0,0) 兜底 */
  defaultGrid?: { col: number; row: number };
  /** 业务组件（懒加载）。null = 无组件，不可渲染 */
  component: React.ComponentType<any> | null;
  /** 传给组件的固定 props（如 PlaceholderModule） */
  componentProps?: Record<string, unknown>;
  /** 是否需要注入当前登录用户名 */
  injectUsername?: boolean;
  /** 已知问题 / 待裁决事项 */
  note?: string;
}

// ─── 网格度量（原 SystemInterface.tsx:70） ───────────────────────
export const APP_GRID = {
  COL_W: 120,
  ROW_H: 115,
  START_X: 32,
  START_Y: 28,
} as const;

/** 把注册表里的网格行列换算成桌面绝对像素坐标 */
export function gridToPosition(grid: { col: number; row: number }) {
  return {
    x: APP_GRID.START_X + APP_GRID.COL_W * grid.col,
    y: APP_GRID.START_Y + APP_GRID.ROW_H * grid.row,
  };
}

// ─── 懒加载工具 ──────────────────────────────────────────────────
// 原代码存在 4 种不一致的写法，这里统一成 2 个工具函数（语义严格等价）：
//   'export const X'（24 个）           → lazyNamed(loader, 'X')
//   'export const X || default'（10 个）→ lazyNamed(loader, 'X')
//   'export default'（5 个）            → lazyDefault(loader)
// 注：lazyNamed 的 ?? m.default 兜底只在具名导出缺失时生效，
//     而那种情况在原代码中必然抛出 undefined 组件异常，故不构成行为变更。
type AnyComponent = React.ComponentType<any>;

function lazyNamed(loader: () => Promise<unknown>, exportName: string): AnyComponent {
  return React.lazy(() =>
    loader().then((mod) => {
      const m = mod as Record<string, unknown>;
      return { default: (m[exportName] ?? m.default) as AnyComponent };
    }),
  );
}

function lazyDefault(loader: () => Promise<{ default: AnyComponent }>): AnyComponent {
  return React.lazy(loader);
}

// ─── 注册表主体 ──────────────────────────────────────────────────
// 数组顺序 = 原 APP_META 的书写顺序。
// 原因：permissionConfig.ts:54 的 ALL_APP_IDS = Object.keys(APP_META)，
//       权限配置 UI 的展示顺序由它决定，必须保持逐字一致。
// 桌面顺序由各条目的 desktopIndex 决定，与数组顺序无关。
function defineApps<const T extends readonly AppRegistryEntry[]>(apps: T): T {
  return apps;
}

const APP_LIST = defineApps([
  // ── 分析 ────────────────────────────────────────────────────
  {
    id: 'market',
    label: '市场洞察',
    icon: Search,
    color: 'bg-gradient-to-br from-blue-500 to-blue-600',
    permissionCategory: '分析',
    desktopGroup: '核心业务',
    layout: 'padded',
    onDesktop: true,
    desktopIndex: 0,
    defaultGrid: { col: 2, row: 0 },
    favoriteByDefault: true,
    component: lazyNamed(() => import('../components/MarketInsightModule'), 'MarketInsightModule'),
  },
  {
    id: 'prediction',
    label: '营销预测',
    icon: BarChart3,
    color: 'bg-gradient-to-br from-purple-500 to-purple-600',
    permissionCategory: '分析',
    desktopGroup: '核心业务',
    layout: 'padded',
    onDesktop: true,
    desktopIndex: 1,
    defaultGrid: { col: 2, row: 1 },
    favoriteByDefault: true,
    component: lazyNamed(() => import('../components/PredictionModule'), 'PredictionModule'),
  },
  {
    id: 'customer',
    label: '客户分析',
    icon: Users,
    color: 'bg-gradient-to-br from-green-500 to-green-600',
    permissionCategory: '分析',
    desktopGroup: '核心业务',
    layout: 'padded',
    onDesktop: true,
    desktopIndex: 2,
    defaultGrid: { col: 2, row: 2 },
    favoriteByDefault: true,
    component: lazyNamed(() => import('../components/CustomerAnalysisModule'), 'CustomerAnalysisModule'),
  },

  // supply 已于阶段 2 接线时整体移除（桌面条目被注释、渲染分支为不可达死代码）。

  // ── 创作 ────────────────────────────────────────────────────
  {
    id: 'aiimage',
    label: '电商生图',
    icon: Sparkles,
    color: 'bg-gradient-to-br from-pink-500 to-rose-600',
    permissionCategory: '创作',
    desktopGroup: '产业赋能',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 8,
    defaultGrid: { col: 4, row: 0 },
    favoriteByDefault: true,
    component: lazyNamed(() => import('../components/AIImageModule'), 'AIImageModule'),
  },

  // ── 知识 ────────────────────────────────────────────────────
  {
    id: 'rules',
    label: '知识库',
    icon: BookOpen,
    color: 'bg-gradient-to-br from-indigo-500 to-indigo-600',
    permissionCategory: '知识',
    desktopGroup: '专业工具',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 11,
    defaultGrid: { col: 6, row: 4 },
    favoriteByDefault: true,
    permissionIcon: MessageSquare,
    component: lazyNamed(() => import('../components/KnowledgeBaseModule'), 'KnowledgeBaseModule'),
    injectUsername: true,
    note: '图标冲突：桌面用 BookOpen，PermissionModule.APP_ICONS 用 MessageSquare。需裁决统一。',
  },

  // ── 资讯 ────────────────────────────────────────────────────
  {
    id: 'news',
    label: '每日推送',
    icon: Newspaper,
    color: 'bg-gradient-to-br from-red-500 to-orange-600',
    permissionCategory: '资讯',
    desktopGroup: '产业赋能',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 7,
    defaultGrid: { col: 4, row: 3 },
    favoriteByDefault: true,
    component: lazyNamed(() => import('../components/DailyNewsModule'), 'DailyNewsModule'),
  },

  // ── 创作 / 运营 ─────────────────────────────────────────────
  {
    id: 'layoutcompare',
    label: '版式对比',
    icon: Columns,
    color: 'bg-gradient-to-br from-emerald-500 to-teal-600',
    permissionCategory: '创作',
    desktopGroup: '专业工具',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 12,
    defaultGrid: { col: 6, row: 0 },
    favoriteByDefault: true,
    component: lazyNamed(() => import('../components/LayoutCompareModule'), 'LayoutCompareModule'),
  },
  {
    id: 'contractaudit',
    label: '合同审核',
    icon: FileText,
    color: 'bg-gradient-to-br from-amber-400 to-orange-500',
    permissionCategory: '运营',
    desktopGroup: '专业工具',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 13,
    defaultGrid: { col: 6, row: 1 },
    favoriteByDefault: true,
    component: lazyNamed(() => import('../components/ContractAuditModule'), 'ContractAuditModule'),
  },
  {
    id: 'seamarketing',
    label: '出海营销',
    icon: Globe,
    color: 'bg-gradient-to-br from-teal-500 to-emerald-600',
    permissionCategory: '创作',
    desktopGroup: '产业赋能',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 9,
    defaultGrid: { col: 4, row: 1 },
    favoriteByDefault: true,
    component: lazyNamed(() => import('../components/SEAMarketingModule'), 'SEAMarketingModule'),
  },
  {
    id: 'beautyrnd',
    label: '美妆研发',
    icon: FlaskConical,
    color: 'bg-gradient-to-br from-pink-400 to-rose-500',
    permissionCategory: '运营',
    desktopGroup: '产业赋能',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 10,
    defaultGrid: { col: 4, row: 2 },
    favoriteByDefault: true,
    permissionLabel: '美妆配方',
    component: lazyNamed(() => import('../components/BeautyRnDModule'), 'BeautyRnDModule'),
    note: '名称冲突：桌面叫「美妆研发」，权限配置 UI 叫「美妆配方」。需裁决统一。',
  },
  {
    id: 'orderrecognition',
    label: '订单识别',
    icon: Package,
    color: 'bg-gradient-to-br from-emerald-500 to-teal-600',
    permissionCategory: '运营',
    desktopGroup: '专业工具',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 14,
    defaultGrid: { col: 6, row: 2 },
    favoriteByDefault: true,
    component: lazyNamed(() => import('../components/OrderRecognitionModule'), 'OrderRecognitionModule'),
  },

  // ── 系统 ────────────────────────────────────────────────────
  {
    id: 'usermanage',
    label: '用户管理',
    icon: ShieldCheck,
    color: 'bg-gradient-to-br from-indigo-500 to-purple-600',
    permissionCategory: '系统',
    desktopGroup: '系统配置',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 30,
    defaultGrid: { col: 0, row: 0 },
    component: lazyNamed(() => import('../components/UserManageModule'), 'UserManageModule'),
  },
  {
    id: 'permissions',
    label: '权限管理',
    icon: Grid3X3,
    color: 'bg-gradient-to-br from-violet-500 to-purple-700',
    permissionCategory: '系统',
    desktopGroup: '系统配置',
    layout: 'padded',
    onDesktop: true,
    desktopIndex: 31,
    defaultGrid: { col: 0, row: 1 },
    permissionIcon: Lock,
    component: lazyNamed(() => import('../components/PermissionModule'), 'PermissionModule'),
    note: '图标冲突：桌面用 Grid3X3，PermissionModule.APP_ICONS 用 Lock。需裁决统一。',
  },
  {
    id: 'profile',
    label: '个人中心',
    icon: User,
    color: 'bg-gradient-to-br from-indigo-400 to-blue-500',
    permissionCategory: '系统',
    desktopGroup: '系统配置',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 32,
    defaultGrid: { col: 0, row: 2 },
    alwaysVisible: true,
    component: lazyNamed(() => import('../components/ProfileModule'), 'ProfileModule'),
    note: 'unique 特例：SystemInterface.tsx:1291 硬编码「profile 永远可见」。此策略应收敛到本字段。',
  },
  {
    id: 'auditlog',
    label: '操作日志',
    icon: ClipboardList,
    color: 'bg-gradient-to-br from-slate-600 to-slate-800',
    permissionCategory: '系统',
    desktopGroup: '系统配置',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 33,
    defaultGrid: { col: 0, row: 3 },
    component: lazyDefault(() => import('../components/AuditLogModule')),
  },

  // ── 专业工具 ────────────────────────────────────────────────
  {
    id: 'doccopywriting',
    label: '文档文案',
    icon: Pen,
    color: 'bg-gradient-to-br from-blue-400 to-indigo-500',
    permissionCategory: '专业工具',
    desktopGroup: '专业工具',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 16,
    defaultGrid: { col: 6, row: 5 },
    component: lazyDefault(() => import('../components/DocCopywritingModule')),
  },
  {
    id: 'riskdetection',
    label: '风险检测',
    icon: ShieldCheck,
    color: 'bg-gradient-to-br from-red-500 to-rose-600',
    permissionCategory: '专业工具',
    desktopGroup: '专业工具',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 17,
    defaultGrid: { col: 6, row: 6 },
    favoriteByDefault: true,
    component: lazyDefault(() => import('../components/RiskDetectionModule')),
    note: '该模块同时具名导出与默认导出同一个组件，原代码走默认导出，此处保持一致。',
  },
  {
    id: 'qualification',
    label: '资质管理',
    icon: FileBadge,
    color: 'bg-gradient-to-br from-indigo-500 to-indigo-700',
    permissionCategory: '专业工具',
    desktopGroup: '专业工具',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 15,
    defaultGrid: { col: 6, row: 3 },
    favoriteByDefault: true,
    component: lazyDefault(() => import('../components/QualificationModule')),
  },
  {
    id: 'videogen',
    label: '视频生成',
    icon: Film,
    color: 'bg-gradient-to-br from-indigo-500 to-purple-600',
    permissionCategory: '专业工具',
    desktopGroup: '专业工具',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 18,
    defaultGrid: { col: 6, row: 7 },
    component: lazyNamed(() => import('../components/VideoGenerationModule'), 'VideoGenerationModule'),
  },
  {
    id: 'hazarddetection',
    label: '隐患检测',
    icon: Scan,
    color: 'bg-gradient-to-br from-red-500 to-orange-600',
    permissionCategory: '专业工具',
    desktopGroup: '专业工具',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 19,
    defaultGrid: { col: 6, row: 8 },
    favoriteByDefault: true,
    component: lazyNamed(() => import('../components/HazardDetectionModule'), 'HazardDetectionModule'),
  },
  {
    id: 'marketing_analysis',
    label: '营销分析',
    icon: TrendingUp,
    color: 'bg-gradient-to-br from-indigo-500 to-fuchsia-600',
    permissionCategory: '分析',
    desktopGroup: '核心业务',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 3,
    defaultGrid: { col: 2, row: 4 },
    favoriteByDefault: true,
    component: lazyDefault(() => import('../components/MarketingAnalysisModule')),
  },
  {
    id: 'invoiceverify',
    label: '发票校验',
    icon: Receipt,
    color: 'bg-gradient-to-br from-blue-500 to-indigo-600',
    permissionCategory: '专业工具',
    desktopGroup: '专业工具',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 20,
    defaultGrid: { col: 6, row: 9 },
    component: lazyNamed(() => import('../components/InvoiceVerifyModule'), 'InvoiceVerifyModule'),
  },
  {
    id: 'productentry',
    label: '商品库录入',
    icon: Database,
    color: 'bg-gradient-to-br from-emerald-500 to-teal-600',
    permissionCategory: '专业工具',
    desktopGroup: '专业工具',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 21,
    defaultGrid: { col: 6, row: 10 },
    component: lazyNamed(() => import('../components/ProductEntryModule'), 'ProductEntryModule'),
  },
  {
    id: 'tendersearch',
    label: '招标',
    icon: Search,
    color: 'bg-gradient-to-br from-cyan-500 to-blue-600',
    permissionCategory: '专业工具',
    desktopGroup: '专业工具',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 22,
    defaultGrid: { col: 6, row: 11 },
    component: lazyNamed(() => import('../components/TenderSearchModule'), 'TenderSearchModule'),
  },
  {
    id: 'productselectionstrategy',
    label: '选品策略',
    icon: Target,
    color: 'bg-gradient-to-br from-violet-500 to-purple-600',
    permissionCategory: '专业工具',
    desktopGroup: '专业工具',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 23,
    defaultGrid: { col: 6, row: 12 },
    component: lazyNamed(() => import('../components/ProductSelectionStrategyModule'), 'ProductSelectionStrategyModule'),
  },
  {
    id: 'productLibrary',
    label: '选品库',
    icon: Package,
    color: 'bg-gradient-to-br from-amber-500 to-orange-600',
    permissionCategory: '专业工具',
    desktopGroup: '专业工具',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 24,
    defaultGrid: { col: 6, row: 13 },
    component: lazyNamed(() => import('../components/ProductLibraryModule'), 'ProductLibraryModule'),
  },
  {
    id: 'quoteverify',
    label: '核查报价',
    icon: FileSearch,
    color: 'bg-gradient-to-br from-sky-500 to-blue-600',
    permissionCategory: '专业工具',
    desktopGroup: '专业工具',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 25,
    defaultGrid: { col: 6, row: 14 },
    component: lazyNamed(() => import('../components/QuoteVerifyModule'), 'QuoteVerifyModule'),
  },
  {
    id: 'keyaccount',
    label: '大客户档案',
    icon: Building2,
    color: 'bg-gradient-to-br from-teal-500 to-cyan-600',
    permissionCategory: '专业工具',
    desktopGroup: '专业工具',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 26,
    defaultGrid: { col: 6, row: 15 },
    component: lazyNamed(() => import('../components/KeyAccountModule'), 'KeyAccountModule'),
  },
  {
    id: 'bidassistant',
    label: '投标',
    icon: FileText,
    color: 'bg-gradient-to-br from-indigo-500 to-blue-600',
    permissionCategory: '专业工具',
    desktopGroup: '专业工具',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 27,
    defaultGrid: { col: 6, row: 16 },
    component: lazyNamed(() => import('../components/BidAssistantModule'), 'BidAssistantModule'),
  },
  {
    id: 'review_partner',
    label: '复盘搭子',
    icon: BarChart3,
    color: 'bg-gradient-to-br from-rose-500 to-pink-600',
    permissionCategory: '分析',
    desktopGroup: '核心业务',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 4,
    defaultGrid: { col: 2, row: 5 },
    component: lazyNamed(() => import('../components/ReviewPartnerModule'), 'ReviewPartnerModule'),
  },
  {
    id: 'business_dashboard',
    label: '看板生成助手',
    icon: BarChart3,
    color: 'bg-gradient-to-br from-cyan-500 to-blue-600',
    permissionCategory: '分析',
    desktopGroup: '核心业务',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 5,
    defaultGrid: { col: 2, row: 6 },
    favoriteByDefault: true,
    component: lazyNamed(() => import('../components/BusinessDashboardModule'), 'BusinessDashboardModule'),
  },
  {
    id: 'dashboard_center',
    label: '业务看板',
    icon: LayoutDashboard,
    color: 'bg-gradient-to-br from-teal-500 to-cyan-600',
    permissionCategory: '分析',
    desktopGroup: '核心业务',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 6,
    defaultGrid: { col: 2, row: 7 },
    favoriteByDefault: true,
    component: lazyNamed(() => import('../components/DashboardCenterModule'), 'DashboardCenterModule'),
  },
  {
    id: 'logistics_fee',
    label: '物流费计算',
    icon: Truck,
    color: 'bg-gradient-to-br from-cyan-500 to-blue-600',
    permissionCategory: '专业工具',
    desktopGroup: '专业工具',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 28,
    defaultGrid: { col: 6, row: 17 },
    component: lazyNamed(() => import('../components/LogisticsFeeModule'), 'LogisticsFeeModule'),
  },
  {
    id: 'enterprisequalification',
    label: '企业资质库',
    icon: ShieldCheck,
    color: 'bg-gradient-to-br from-emerald-500 to-teal-600',
    permissionCategory: '专业工具',
    desktopGroup: '专业工具',
    layout: 'full',
    onDesktop: true,
    desktopIndex: 29,
    component: lazyNamed(() => import('../components/EnterpriseQualificationModule'), 'EnterpriseQualificationModule'),
    note: '缺陷：原 DEFAULT_POSITIONS 中缺失该项，会落到 (32,32) 兜底坐标，与「用户管理」图标重叠。接线时需补 defaultGrid。',
  },
  // 注：'dshworkbench' 已于阶段 2 接线时整体移除。
  //     原状态：AppId / APP_META / ModuleType 三处都有，权限 UI 可勾选，
  //             但 lazy import 与渲染分支均被注释、allApps 中不存在、
  //             DEFAULT_POSITIONS 与 APP_ICONS 均缺失、组件文件不存在 → 幽灵应用。
  // 注：'supply' 已于阶段 2 接线时整体移除（桌面条目被注释，渲染分支为不可达死代码）。
]);

/** 应用注册表（规范化只读视图） */
export const APP_REGISTRY: readonly AppRegistryEntry[] = APP_LIST;

// ─── 类型派生 ────────────────────────────────────────────────────
/** 应用 id 联合类型。由注册表数据派生，新增模块时类型自动跟随。 */
export type AppId = (typeof APP_LIST)[number]['id'];

// ─── 派生选择器 ──────────────────────────────────────────────────

/** 全部应用 id。顺序 = 原 APP_META 顺序（供权限配置 UI 使用） */
export const ALL_APP_IDS: AppId[] = APP_REGISTRY.map((e) => e.id as AppId);

/** 桌面应用。顺序 = 原 allApps 数组顺序（供桌面渲染与文件夹分组使用） */
export const DESKTOP_APPS: readonly AppRegistryEntry[] = APP_REGISTRY
  .filter((e) => e.onDesktop)
  .slice()
  .sort((a, b) => (a.desktopIndex ?? 0) - (b.desktopIndex ?? 0));

const APP_INDEX: Record<string, AppRegistryEntry> = Object.fromEntries(
  APP_REGISTRY.map((e) => [e.id, e]),
);

/** 按 id 取注册项 */
export function getApp(id: string): AppRegistryEntry | undefined {
  return APP_INDEX[id];
}

/** 取窗口内容布局。未知 id 回落 padded（等价于重构前 816 字符判定链的 else 分支） */
export function getAppLayout(id: string): AppLayout {
  return APP_INDEX[id]?.layout ?? 'padded';
}

/** 取默认桌面坐标（绝对像素）。无 defaultGrid 时返回 undefined，由调用方兜底 */
export function getAppDefaultPosition(id: string): { x: number; y: number } | undefined {
  const grid = APP_INDEX[id]?.defaultGrid;
  return grid ? gridToPosition(grid) : undefined;
}

/** 桌面 2 默认演示集合 */
export const DEFAULT_FAVORITE_APP_IDS: string[] = APP_REGISTRY
  .filter((e) => e.favoriteByDefault)
  .map((e) => e.id);

/** 权限配置 UI 展示名 */
export function getPermissionLabel(id: string): string | undefined {
  const e = APP_INDEX[id];
  return e ? (e.permissionLabel ?? e.label) : undefined;
}

/** 权限配置 UI 分类 */
export function getPermissionCategory(id: string): string | undefined {
  return APP_INDEX[id]?.permissionCategory;
}

/**
 * 权限配置 UI 图标。无独立 permissionIcon 时回落桌面 icon。
 * 取代 PermissionModule 内原 APP_ICONS 硬编码（仅覆盖 20/36，其余条目无图标）。
 */
export function getPermissionIcon(id: string): LucideIcon | undefined {
  const e = APP_INDEX[id];
  return e ? (e.permissionIcon ?? e.icon) : undefined;
}

// ─── 桌面分组结构 ────────────────────────────────────────────────

/** 桌面内置栏目（原 SystemInterface.tsx:1377-1382，与 desktopGroup 字符串匹配） */
export const DESKTOP_GROUPS = [
  { id: 'folder_admin', label: '系统配置', group: '系统配置', col: 0 },
  { id: 'folder_core', label: '核心业务', group: '核心业务', col: 2 },
  { id: 'folder_emp', label: '产业赋能', group: '产业赋能', col: 4 },
  { id: 'folder_tools', label: '专业工具', group: '专业工具', col: 6 },
] as const;

/** 内置栏目 id 列表（原 BUILTIN_FOLDER_IDS） */
export const BUILTIN_FOLDER_IDS: readonly string[] = DESKTOP_GROUPS.map((g) => g.id);

/** 桌面 2 的默认常用分组（原 FAVORITE_FOLDER_DEFS） */
export const FAVORITE_GROUPS = [
  {
    id: 'folder_favorite_insight',
    label: '洞察决策',
    col: 1,
    appIds: ['news', 'marketing_analysis', 'rules', 'customer', 'market', 'prediction', 'business_dashboard', 'dashboard_center'],
  },
  {
    id: 'folder_favorite_content',
    label: '内容运营',
    col: 5,
    appIds: ['layoutcompare', 'orderrecognition', 'aiimage', 'seamarketing', 'beautyrnd', 'qualification', 'hazarddetection', 'contractaudit', 'riskdetection'],
  },
] as const;

// ─── 自检：注册表完整性（接线后由 CI 或 dev 预览页调用） ─────────
export interface RegistryHealth {
  total: number;
  onDesktop: number;
  withoutComponent: string[];
  conflicted: string[];
  missingDefaultPosition: string[];
}

export function inspectRegistry(): RegistryHealth {
  return {
    total: APP_REGISTRY.length,
    onDesktop: DESKTOP_APPS.length,
    withoutComponent: APP_REGISTRY.filter((e) => !e.component).map((e) => e.id),
    conflicted: APP_REGISTRY.filter((e) => e.note).map((e) => e.id),
    missingDefaultPosition: DESKTOP_APPS.filter((e) => !e.defaultGrid).map((e) => e.id),
  };
}
