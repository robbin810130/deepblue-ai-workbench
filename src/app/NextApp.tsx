/**
 * 新版应用入口（隔离预览用）
 *
 * 为什么单独一份入口：
 *   旧系统入口是「登录 → SystemInterface（桌面隐喻 + 34 应用）」，本轮改造
 *   不动它，保证线上可随时回退。新版界面挂在 /next 前缀下并行开发，
 *   待全部页面交付、验收通过后，再把 main.tsx 的默认分支切到本入口。
 *
 * 访问：http://<host>:8090/next  → 自动跳转 /next/workbench
 */
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './routes';

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
    <BrowserRouter basename="/next">
      <AppRoutes username={resolveUsername()} />
    </BrowserRouter>
  );
}
