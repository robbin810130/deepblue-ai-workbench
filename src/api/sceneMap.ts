/**
 * 场景 key 双向映射
 *
 * 后端权威 key 是 snake_case（见 server/modules/catalog/scenes.js），
 * 前端常量 SCENES（src/config/scenes.ts）用的是短键，插画也按短键分支。
 * 两者之间必须显式转换——路由里混用会直接打到 404「场景不存在：market」。
 */
import type { SceneKey } from '../types/domain';

/** 后端 snake_case → 前端短键 */
const API_TO_ART: Record<string, SceneKey> = {
  market_customer: 'market',
  contract_tender: 'contract',
  product_supply: 'supply',
  content_marketing: 'content',
  enterprise_knowledge: 'knowledge',
  business_analysis: 'analysis',
};

/** 前端短键 → 后端 snake_case */
const ART_TO_API: Record<SceneKey, string> = {
  market: 'market_customer',
  contract: 'contract_tender',
  supply: 'product_supply',
  content: 'content_marketing',
  knowledge: 'enterprise_knowledge',
  analysis: 'business_analysis',
};

/** 后端 key → 插画/短键（用于 SceneArt 选图） */
export function sceneArtKey(sceneKey: string): SceneKey {
  return API_TO_ART[sceneKey] ?? 'analysis';
}

/**
 * 归一化为后端权威 key。
 *
 * 路由参数 `/scenes/:sceneKey` 可能是短键（/scenes/market）也可能是权威键
 * （/scenes/market_customer）——一律收敛成后者，避免把短键丢给
 * `GET /api/v1/scenes/:key` 拿回 404。
 */
export function sceneApiKey(key: string): string {
  return ART_TO_API[key as SceneKey] ?? key;
}
