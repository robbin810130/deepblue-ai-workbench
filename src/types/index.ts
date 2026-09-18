import type { AppId } from '../config/appRegistry';

// 应用 id 联合类型统一由注册表派生（阶段 2 接线），不再手写第二份清单。
export type ModuleType = AppId;
export type AppState = 'login' | 'system' | 'sysadmin';

export interface SimulationResult {
  thought: string;
  result: string;
}
