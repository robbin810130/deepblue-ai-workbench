/**
 * 六大业务场景定义
 *
 * 数据来源（不编造）：
 *  - 名称与顺序：00_总指导文档 § 六大场景原文
 *  - 技能数量：改造清单 V3 §D5 归属规划（按 appRegistry 实测 34 个应用归位统计）
 *
 * 说明：当前为前端常量，后续由 `/api/scenes` 返回（管理后台可排序、启停）。
 */
import type { Scene, SceneKey } from '../types/domain';

export const SCENES: Scene[] = [
  {
    key: 'market',
    name: '市场与客户',
    summary: '洞察市场机会，提升客户价值',
    skillCount: 6,
  },
  {
    key: 'contract',
    name: '合同与招投标',
    summary: '让合同管理更高效合规',
    skillCount: 5,
  },
  {
    key: 'supply',
    name: '商品与供应链',
    summary: '优化供应链，提升运营效率',
    skillCount: 8,
  },
  {
    key: 'content',
    name: '内容与营销',
    summary: '激发内容创意，提升营销效果',
    skillCount: 6,
  },
  {
    key: 'knowledge',
    name: '企业知识',
    summary: '沉淀企业智慧，赋能每一个人',
    skillCount: 6,
  },
  {
    key: 'analysis',
    name: '经营分析',
    summary: '用数据看清业务，辅助科学决策',
    skillCount: 3,
  },
];

export const SCENE_MAP: Record<SceneKey, Scene> = SCENES.reduce(
  (acc, s) => ({ ...acc, [s.key]: s }),
  {} as Record<SceneKey, Scene>,
);

/**
 * 场景配色类名映射。
 *
 * 注意：Tailwind 只能扫描到「字面量类名」，因此这里必须写完整类名，
 *      不能用 `bg-scene-${key}-soft` 这类拼接（拼接结果不会被编译出来）。
 */
export interface SceneTone {
  /** 卡片渐变背景 */
  surface: string;
  /** 插画区图标底色 */
  accent: string;
  /** 图标与强调色 */
  ink: string;
  /** 圆形箭头按钮 */
  arrow: string;
}

export const SCENE_TONE: Record<SceneKey, SceneTone> = {
  market: {
    surface: 'from-scene-market-soft to-scene-market-wash',
    accent: 'bg-scene-market/10',
    ink: 'text-scene-market',
    arrow: 'bg-scene-market',
  },
  contract: {
    surface: 'from-scene-contract-soft to-scene-contract-wash',
    accent: 'bg-scene-contract/10',
    ink: 'text-scene-contract',
    arrow: 'bg-scene-contract',
  },
  supply: {
    surface: 'from-scene-supply-soft to-scene-supply-wash',
    accent: 'bg-scene-supply/10',
    ink: 'text-scene-supply',
    arrow: 'bg-scene-supply',
  },
  content: {
    surface: 'from-scene-content-soft to-scene-content-wash',
    accent: 'bg-scene-content/10',
    ink: 'text-scene-content',
    arrow: 'bg-scene-content',
  },
  knowledge: {
    surface: 'from-scene-knowledge-soft to-scene-knowledge-wash',
    accent: 'bg-scene-knowledge/10',
    ink: 'text-scene-knowledge',
    arrow: 'bg-scene-knowledge',
  },
  analysis: {
    surface: 'from-scene-analysis-soft to-scene-analysis-wash',
    accent: 'bg-scene-analysis/10',
    ink: 'text-scene-analysis',
    arrow: 'bg-scene-analysis',
  },
};
