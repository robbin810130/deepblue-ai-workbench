/**
 * 新版工作台入口
 *
 * 路由前缀由 app/basePath.ts 动态决定：
 *   根路径（默认入口，2026-09-21 起）→ basename '/'
 *   /next（历史入口，旧书签兼容）   → basename '/next'
 *
 * 旧版桌面系统已退到 /legacy（见 src/App.tsx + main.tsx 分流），可随时回退。
 *
 * 访问：http://<host>:8090/       → 自动跳转 /workbench
 *       http://<host>:8090/next/  → 同上（旧链接）
 */
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './routes';
import { nextBasename } from './basePath';

/** 未登录时的预览兜底用户名（设计稿上的名字）。接入真实登录态后删除。 */
const PREVIEW_USERNAME = 'Robbin';

/** 复用旧入口的 token 解析方式，拿不到就退回预览名 */
function resolveUsername(): string {
  const token = localStorage.getItem('blue_os_token');
  if (!token) return PREVIEW_USERNAME;
  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as {
      username?: string;
    };
    return payload.username || PREVIEW_USERNAME;
  } catch {
    return PREVIEW_USERNAME;
  }
}

export function NextApp() {
  return (
    <BrowserRouter basename={nextBasename()}>
      <AppRoutes username={resolveUsername()} />
    </BrowserRouter>
  );
}
