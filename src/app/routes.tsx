/**
 * 新版路由表
 *
 * 依据：01_前端开发规范与页面设计说明 §9 路由规范
 *   /workbench      工作台
 *   /scenes         业务场景总览
 *   /scenes/:key    场景详情
 *   /skills/:key    技能详情 / 发起任务
 *   /tasks          任务中心
 *   /tasks/:id      任务详情
 *   /knowledge      知识库
 *   /dashboard      数据看板
 *   /admin/*        管理后台
 *
 * 进度：本轮已实现 /workbench；其余为占位，逐轮替换。
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { ComingSoon } from '../components/common/ComingSoon';
import { WorkbenchPage } from '../features/workbench/WorkbenchPage';

export function AppRoutes({ username }: { username: string }) {
  return (
    <Routes>
      <Route element={<AppShell username={username} unreadCount={3} />}>
        <Route index element={<Navigate to="/workbench" replace />} />

        <Route
          path="/workbench"
          element={<WorkbenchPage username={username} />}
        />

        <Route path="/scenes" element={<ComingSoon title="业务场景" />} />
        <Route
          path="/scenes/:sceneKey"
          element={<ComingSoon title="场景详情" />}
        />

        <Route
          path="/skills/:skillKey"
          element={<ComingSoon title="技能详情" hint="技能详情是「立即使用」页：动态表单 + 文件上传 + 开始执行。" />}
        />

        <Route path="/tasks" element={<ComingSoon title="任务中心" />} />
        <Route path="/tasks/:taskId" element={<ComingSoon title="任务详情" />} />

        <Route
          path="/knowledge"
          element={<ComingSoon title="知识库" hint="知识空间 / 文档列表 / 知识问答 / 文档详情。" />}
        />

        <Route path="/dashboard" element={<ComingSoon title="数据看板" />} />

        <Route path="/admin/*" element={<ComingSoon title="管理后台" />} />
        <Route path="/settings" element={<ComingSoon title="系统设置" />} />

        <Route path="*" element={<Navigate to="/workbench" replace />} />
      </Route>
    </Routes>
  );
}
