/**
 * 领域类型 —— 深蓝 AI 企业智能工作台
 *
 * 定位：五层模型「业务场景 → 技能 → 任务 → Agent/Dify」的公共类型。
 * 依据：00_总指导文档 / 05_任务中心详细PRD / 10_Agent开发规范
 *
 * 约定：本文件只放【跨页面共享】的领域模型。
 *      页面私有的纯 UI 状态类型放在各自 feature 目录下。
 */

/* ============================================================
   一、业务场景（六大，文档 00 原文定义）
   ============================================================ */
export type SceneKey =
  | 'market' // 市场与客户
  | 'contract' // 合同与招投标
  | 'supply' // 商品与供应链
  | 'content' // 内容与营销
  | 'knowledge' // 企业知识
  | 'analysis'; // 经营分析

export interface Scene {
  key: SceneKey;
  /** 场景名称（设计稿层级：卡片标题） */
  name: string;
  /** 一句话说明（设计稿里每个场景卡下方那行） */
  summary: string;
  /** 该场景下的技能数量（PRD §2：场景卡可选显示） */
  skillCount: number;
}

/* ============================================================
   二、技能（Skill）—— 承接 appRegistry 的 34 个应用
   ============================================================ */
export interface Skill {
  key: string;
  name: string;
  /** 摘要，最多两行（PRD §4） */
  summary: string;
  scene: SceneKey;
  /** 是否为「有代码但未注册」的技能（见改造清单 XO-13） */
  live?: boolean;
  /** 是否需要文件输入 */
  acceptsFiles?: string[];
}

/* ============================================================
   三、任务（Task / Run）
   状态机八态，见 05_任务中心详细PRD
   ============================================================ */
export type TaskStatus =
  | 'queued' // 排队中
  | 'running' // 进行中
  | 'waiting_confirmation' // 待确认
  | 'succeeded' // 已完成
  | 'failed' // 失败
  | 'cancelled' // 已取消
  | 'expired' // 已过期
  | 'partial'; // 部分成功

export interface Task {
  id: string;
  /** 任务标题（通常取自技能名或用户输入摘要） */
  title: string;
  status: TaskStatus;
  /** 所属技能 */
  skillKey: string;
  skillName: string;
  /** 展示用时间文案，如「今天 16:20」（列表页不做复杂时间计算） */
  timeLabel: string;
  /** 场景归属，用于按场景筛选 */
  scene: SceneKey;
}

/* ============================================================
   四、待办（Todo）—— 只放可行动事项（文档 06 §1.2）
   ============================================================ */
export interface TodoItem {
  id: string;
  title: string;
  /** 关联的任务 id，点击可跳转任务详情 */
  taskId?: string;
  timeLabel: string;
  /** 是否已勾选完成（本地态，接后端后改为服务端字段） */
  done?: boolean;
}

/* ============================================================
   五、状态展示映射（颜色不能作为唯一标识，必须带文字）
   ============================================================ */
export interface StatusMeta {
  label: string;
  /** Tailwind 类：文字色 + 底色 */
  tone: string;
  /** 圆点色（列表左侧的状态点） */
  dot: string;
}

export const TASK_STATUS_META: Record<TaskStatus, StatusMeta> = {
  queued: {
    label: '排队中',
    tone: 'text-ink-soft bg-surface-sunken',
    dot: 'bg-ink-faint',
  },
  running: {
    label: '进行中',
    tone: 'text-primary-600 bg-primary-50',
    dot: 'bg-primary-500',
  },
  waiting_confirmation: {
    label: '待确认',
    tone: 'text-warning bg-warning-soft',
    dot: 'bg-warning',
  },
  succeeded: {
    label: '已完成',
    tone: 'text-success bg-success-soft',
    dot: 'bg-success',
  },
  failed: {
    label: '失败',
    tone: 'text-danger bg-danger-soft',
    dot: 'bg-danger',
  },
  cancelled: {
    label: '已取消',
    tone: 'text-ink-soft bg-surface-sunken',
    dot: 'bg-ink-faint',
  },
  expired: {
    label: '已过期',
    tone: 'text-ink-soft bg-surface-sunken',
    dot: 'bg-ink-faint',
  },
  partial: {
    label: '部分成功',
    tone: 'text-warning bg-warning-soft',
    dot: 'bg-warning',
  },
};
