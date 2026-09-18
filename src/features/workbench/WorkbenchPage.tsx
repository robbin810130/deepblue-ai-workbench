/**
 * 工作台首页（/workbench）
 *
 * 依据：06_前端页面详细PRD §1 工作台 —— 7 个模块，顺序固定
 *   1 顶部栏（在 AppShell 里）
 *   2 欢迎区
 *   3 任务输入
 *   4 快捷操作（4 个固定）
 *   5 业务场景（6 个）
 *   6 最近任务（4～6 条）
 *   7 我的待办（3～5 条）
 *
 * 验收（§11）：首屏清晰、无拥挤小字、6 场景/4 快捷固定
 */
import { GreetingHero } from './components/GreetingHero';
import { TaskCommandBox } from './components/TaskCommandBox';
import { QuickActions } from './components/QuickActions';
import { SceneSection } from './components/SceneSection';
import { RecentTasks } from './components/RecentTasks';
import { TodoPanel } from './components/TodoPanel';

export function WorkbenchPage({ username }: { username: string }) {
  return (
    <div className="flex flex-col gap-[18px]">
      <GreetingHero username={username} />
      <TaskCommandBox />
      <QuickActions />
      <SceneSection />

      {/* <1200px 时两栏下沉为单栏（见 tokens.css 的 .dw-bottom-grid） */}
      <div className="dw-bottom-grid grid grid-cols-[1.65fr_1fr] gap-4">
        <RecentTasks />
        <TodoPanel />
      </div>
    </div>
  );
}
