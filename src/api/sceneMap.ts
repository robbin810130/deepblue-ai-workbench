/**
 * 后端场景 key（snake_case）→ 插画/旧 mock 场景 key 映射
 * 后端权威枚举见 server/modules/catalog/scenes.js
 */
import type { SceneKey } from '../types/domain';

export function sceneArtKey(sceneKey: string): SceneKey {
  switch (sceneKey) {
    case 'market_customer':
      return 'market';
    case 'contract_tender':
      return 'contract';
    case 'product_supply':
      return 'supply';
    case 'content_marketing':
      return 'content';
    case 'enterprise_knowledge':
      return 'knowledge';
    case 'business_analysis':
      return 'analysis';
    default:
      return 'analysis';
  }
}
