/**
 * 入口路径常量与探测工具（新旧界面共用的唯一真相）
 *
 * 2026-09-21 起产品形态：
 *   /            → 新版工作台（默认入口）
 *   /legacy/*    → 旧版桌面系统（登录页 + 桌面隐喻 + 34 应用）
 *   /next/*      → 新版工作台的历史入口，保留可用（旧书签不失效），不再对外宣传
 *
 * 为什么保留 /next 而非一刀切：
 *   redirect 回跳、用户收藏、通知里的任务深链此前都写死了 /next，
 *   一次性抹掉会让「登录后被踢回旧系统」「点通知 404」这类问题重新出现。
 *   故 detectNextPrefix() 在 /next 下仍返回 '/next'，刷新不丢前缀。
 *
 * 旧版 App.tsx 是纯 state 驱动（无 react-router），所以 /legacy 无需 basename；
 * 新版 NextApp 用 react-router，basename 由 detectNextPrefix() 动态决定。
 */

/** 旧版桌面系统入口前缀 */
export const LEGACY_PREFIX = '/legacy';

/** 新版工作台历史入口前缀（兼容旧链接） */
export const NEXT_PREFIX = '/next';

/** 当前是否处于旧版桌面系统入口下 */
export function isLegacyPath(
  pathname: string = window.location.pathname,
): boolean {
  return pathname === LEGACY_PREFIX || pathname.startsWith(`${LEGACY_PREFIX}/`);
}

/**
 * 新版工作台当前挂载前缀（用于拼 URL，根路径时返回空串）。
 * 注意：拼 URL 用本函数（'' 时不会产生 `//tasks`），给 BrowserRouter 请用 nextBasename()。
 */
export function detectNextPrefix(
  pathname: string = window.location.pathname,
): string {
  return pathname === NEXT_PREFIX || pathname.startsWith(`${NEXT_PREFIX}/`)
    ? NEXT_PREFIX
    : '';
}

/** 新版工作台路由 basename（根路径下给 '/'，react-router 会原样处理） */
export function nextBasename(): string {
  return detectNextPrefix() || '/';
}
