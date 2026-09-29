import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { NextApp } from './app/NextApp'
import { isLegacyPath } from './app/basePath'

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeFullReload', () => {
    console.warn('⚠️ 拦截到 Vite 的强制页面刷新请求！已为了保护智能体运行状态而将其默默阻止。');
    throw new Error('Blocked Vite full reload'); // 抛出错误以阻断 Vite 客户端后续调用 location.reload()，实现无弹窗静默拦截
  });
}

const root = createRoot(document.getElementById('root')!);

// ── 入口分流（2026-09-21 切换默认入口） ──────────────────────────
// /         新版工作台（V3 重构，默认入口）
// /legacy   旧版桌面系统（保留入口，可随时回退）
// /next     新版工作台的历史前缀，保持可用，旧书签不失效
//
// 新版是首屏，静态引入；旧版是纯 state 驱动（无 react-router），按需动态加载，
// 让主包只承载新界面。判据统一收敛到 app/basePath.ts，避免多处各写一份前缀。
const isLegacyApp = isLegacyPath();

// 设计系统预览页：仅开发环境，URL 带 ?ui-preview 时进入。
// 生产构建时 import.meta.env.DEV 恒为 false，该分支连同动态 import 会被整体移除，
// 不会进入产物、不影响线上行为。
const isUiPreview =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).has('ui-preview');

if (isUiPreview) {
  import('./components/UiPreview').then(({ UiPreview }) => {
    root.render(
      <StrictMode>
        <UiPreview />
      </StrictMode>,
    );
  });
} else if (isLegacyApp) {
  // 动态加载期间给个极简占位，避免白屏（旧界面分包体积不小，慢网络下可感知）
  root.render(
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        font: '14px/1.5 system-ui, -apple-system, sans-serif',
        color: '#94a3b8',
      }}
    >
      正在加载旧版工作台…
    </div>,
  );
  import('./App').then(({ default: LegacyApp }) => {
    root.render(
      <StrictMode>
        <LegacyApp />
      </StrictMode>,
    );
  });
} else {
  root.render(
    <StrictMode>
      <NextApp />
    </StrictMode>,
  );
}
