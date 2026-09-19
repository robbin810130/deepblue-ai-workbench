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
 * 进度：/workbench、/scenes、/scenes/:key、/skills/:key、/tasks、/tasks/:id、
 *      /knowledge、/dashboard、/admin、/settings 均已实现。
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { WorkbenchPage } from '../features/workbench/WorkbenchPage';
import { ScenesPage } from '../features/scenes/ScenesPage';
import { SceneDetailPage } from '../features/scenes/SceneDetailPage';
import { SkillUsePage } from '../features/skills/SkillUsePage';
import { TasksPage } from '../features/tasks/TasksPage';
import { TaskDetailPage } from '../features/tasks/TaskDetailPage';
import { KnowledgePage } from '../features/knowledge/KnowledgePage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { AdminPage } from '../features/admin/AdminPage';
import { SettingsPage } from '../features/settings/SettingsPage';

export function AppRoutes({ username }: { username: string }) {
  return (
    <Routes>
      <Route element={<AppShell username={username} />}>
        <Route index element={<Navigate to="/workbench" replace />} />

        <Route
          path="/workbench"
          element={<WorkbenchPage username={username} />}
        />

        <Route path="/scenes" element={<ScenesPage />} />
        <Route path="/scenes/:sceneKey" element={<SceneDetailPage />} />

        <Route path="/skills/:skillKey" element={<SkillUsePage />} />

        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/tasks/:taskId" element={<TaskDetailPage />} />

        <Route path="/knowledge" element={<KnowledgePage />} />

        <Route path="/dashboard" element={<DashboardPage />} />

        <Route path="/admin/*" element={<AdminPage />} />
        <Route path="/settings" element={<SettingsPage />} />

        <Route path="*" element={<Navigate to="/workbench" replace />} />
      </Route>
    </Routes>
  );
}
