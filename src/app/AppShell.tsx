/**
 * AppShell —— 新版应用的全局布局外壳
 *
 * 结构（01_前端开发规范 §5）：
 *   AppShell
 *   ├─ Sidebar（232px 固定）
 *   ├─ Topbar（60px）
 *   └─ MainOutlet（自适应，max-width 1440px）
 *
 * 说明：本文件与旧版 App.tsx 完全独立，互不影响；
 *      旧入口「登录 → SystemInterface」保持原样，可随时回退。
 */
import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/layout/Sidebar';
import { Topbar } from '../components/layout/Topbar';

interface AppShellProps {
  username: string;
}

export function AppShell({ username }: AppShellProps) {
  return (
    <div className="dw-root flex h-screen w-full overflow-hidden bg-page">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar username={username} />

        <main className="dw-scroll flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-6 py-5">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
