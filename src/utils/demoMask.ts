/**
 * demoMask.ts — 演示系统展示层脱敏工具
 *
 * 1. maskProductBrands(name, brands)       — 商品名称品牌替换为 **
 * 2. maskCustomerName(id, name)            — 客户名称替换为 客户X-NNN
 * 3. useBrandMask()                        — 自动加载品牌列表的 React hook
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchWithAuth } from './authFetch';

// ===================== 品牌脱敏 =====================

/**
 * 将商品名称中匹配品牌字典的部分替换为 **
 * brands 列表应该按字符串长度降序排列（长的优先），避免短品牌覆盖长品牌
 */
export function maskProductBrands(productName: string, brands: string[]): string {
    if (!productName || brands.length === 0) return productName;
    let result = productName;
    for (const brand of brands) {
        if (!brand) continue;
        // Case-insensitive 精确子串匹配
        const regex = new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        result = result.replace(regex, '**');
    }
    return result;
}

// ===================== 客户名称脱敏 =====================

/**
 * 城市首字母映射表（拼音首字母）
 * 若客户名称中包含城市/省份，取其第一个已知汉字的拼音首字母作前缀，否则取名称第一个字的拼音首字母
 */
const CITY_INITIAL_MAP: Record<string, string> = {
    北: 'B', 上: 'S', 广: 'G', 深: 'S', 成: 'C', 武: 'W', 杭: 'H', 南: 'N',
    西: 'X', 重: 'C', 天: 'T', 苏: 'S', 长: 'C', 郑: 'Z', 青: 'Q', 沈: 'S',
    哈: 'H', 济: 'J', 太: 'T', 昆: 'K', 贵: 'G', 石: 'S', 福: 'F', 合: 'H',
    宁: 'N', 厦: 'X', 大: 'D', 无: 'W', 佛: 'F', 东: 'D', 温: 'W',
    烟: 'Y', 珠: 'Z', 中: 'Z', 兰: 'L', 呼: 'H', 乌: 'W', 海: 'H', 湖: 'H',
    湘: 'X', 鄂: 'E', 赣: 'G', 豫: 'Y', 冀: 'J', 鲁: 'L', 晋: 'J', 皖: 'A',
    闽: 'M', 浙: 'Z', 粤: 'Y', 川: 'C', 渝: 'Y', 黔: 'Q', 滇: 'D',
    桂: 'G', 琼: 'Q', 藏: 'Z', 陕: 'S', 甘: 'G', 蒙: 'M',
    新: 'X', 辽: 'L', 吉: 'J', 黑: 'H', 京: 'J', 津: 'J', 沪: 'H', 穗: 'G',
};

// 稳定地把 客户ID 映射到 NNN 序号（001-999）
// 使用简单哈希，同一 ID 永远得到同一序号
function idToSeq(id: number): string {
    const h = ((id * 2654435761) >>> 0) % 900 + 1; // 1~900
    return String(h).padStart(3, '0');
}

/**
 * 将客户名称脱敏为 "客户X-NNN" 格式
 * X 取客户名称第一个汉字的城市首字母
 */
export function maskCustomerName(id: number, name: string): string {
    if (!name) return `客户?-${idToSeq(id)}`;
    const firstChar = name.charAt(0);
    const prefix = CITY_INITIAL_MAP[firstChar] || firstChar.toUpperCase() || 'C';
    return `客户${prefix}-${idToSeq(id)}`;
}

// ===================== React Hook =====================

export function useBrandMask() {
    const [brands, setBrands] = useState<string[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        fetchWithAuth('/api/brands')
            .then(r => r.json())
            .then(data => {
                if (data.success && Array.isArray(data.brands)) {
                    // 按长度降序，保证长品牌名优先匹配
                    setBrands(data.brands.sort((a: string, b: string) => b.length - a.length));
                }
            })
            .catch(() => { /* 加载失败静默处理，保持原始展示 */ })
            .finally(() => setLoaded(true));
    }, []);

    const maskProduct = useCallback(
        (name: string) => maskProductBrands(name, brands),
        [brands]
    );

    return { brands, loaded, maskProduct };
}
