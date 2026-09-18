/**
 * 工作台首页临时数据
 *
 * ⚠️ 全部为「界面评审用」的占位数据，名称/状态/时间照设计稿还原。
 *    接后端后本文件整体删除，改为：
 *      GET /api/workbench/recent-tasks  → Task[]
 *      GET /api/workbench/todos         → TodoItem[]
 *      GET /api/users/me                → { displayName }
 *    见 03_API接口规范。
 */
import type { Task, TodoItem } from '../../types/domain';

export const MOCK_RECENT_TASKS: Task[] = [
  {
    id: 't-24091',
    title: '采购合同审核',
    status: 'succeeded',
    skillKey: 'contract-audit',
    skillName: '采购合同审核',
    timeLabel: '今天 16:20',
    scene: 'contract',
  },
  {
    id: 't-24088',
    title: '华南客户分析',
    status: 'running',
    skillKey: 'customer-analysis',
    skillName: '客户分析',
    timeLabel: '今天 14:37',
    scene: 'market',
  },
  {
    id: 't-24085',
    title: '市场活动方案生成',
    status: 'waiting_confirmation',
    skillKey: 'marketing-plan',
    skillName: '营销方案生成',
    timeLabel: '今天 10:12',
    scene: 'content',
  },
  {
    id: 't-24080',
    title: '产品主图生成',
    status: 'succeeded',
    skillKey: 'ai-image',
    skillName: 'AI 图片生成',
    timeLabel: '昨天 18:45',
    scene: 'supply',
  },
];

export const MOCK_TODOS: TodoItem[] = [
  {
    id: 'td-1',
    title: '合同审核结果待确认',
    taskId: 't-24091',
    timeLabel: '2 小时前',
  },
  {
    id: 'td-2',
    title: '客户分析报告已生成',
    taskId: 't-24088',
    timeLabel: '4 小时前',
  },
  {
    id: 'td-3',
    title: '知识库文档待审核',
    timeLabel: '今天 11:20',
  },
];
