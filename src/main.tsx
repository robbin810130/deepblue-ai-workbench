import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeFullReload', () => {
    console.warn('⚠️ 拦截到 Vite 的强制页面刷新请求！已为了保护智能体运行状态而将其默默阻止。');
    throw new Error('Blocked Vite full reload'); // 抛出错误以阻断 Vite 客户端后续调用 location.reload()，实现无弹窗静默拦截
  });
}

const root = createRoot(document.getElementById('root')!);

// 设计系统预览页：仅开发环境，URL 带 ?ui-preview 时进入。
// 生产构建时 import.meta.env.DEV 恒为 false，该分支连同动态 import 会被整体移除，
// 不会进入产物、不影响线上行为。
if (
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).has('ui-preview')
) {
  import('./components/UiPreview').then(({ UiPreview }) => {
    root.render(
      <StrictMode>
        <UiPreview />
      </StrictMode>,
    );
  });
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
