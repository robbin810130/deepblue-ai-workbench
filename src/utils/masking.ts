/**
 * 数据脱敏工具类 (Data Masking Utilities)
 * 用于演示环境下隐藏敏感的品牌、规格及客户名称信息
 */

/**
 * 产品名称脱敏
 * 规则：移除品牌「淘吉」、规格(如 360g, 4.8kg, 1L)及前缀「优品专供-」
 */
export function maskProductName(name: string | undefined | null): string {
    if (!name) return '—';

    let masked = name;

    // 1. 连锁品牌黑名单 (中英文混合) - V4 扩充
    const brandBlacklist = [
        '淘吉', '茶颜悦色', '良品铺子', '良品小食仙', '信誉楼', '蒙牛',
        '伊利', '雀巢', '星巴克', 'babycare', 'KKV', '麦德龙', '沃尔玛', '屈臣氏',
        '清果密语', '味动力', '夏洛克', '乐事', '上好佳'
    ];
    const brandRegex = new RegExp(brandBlacklist.join('|'), 'gi');
    masked = masked.replace(brandRegex, '');

    // 2. 特殊前缀/后缀穿透 (针对中划线连接的店名或口味)
    if (masked.includes('-')) {
        const parts = masked.split('-');
        // 如果中划线后是口味或极短规格 (2-3字)，移除后缀 (如: 果肉果冻-葡萄)
        if (parts[parts.length - 1].length <= 3) {
            masked = parts.slice(0, -1).join('-');
        }
        // 如果中划线前是店名前缀 (通常在首位)，移除前缀 (如: babycare-、麦德龙-)
        else if (parts[0].length <= 6) {
            masked = parts.slice(1).join('-');
        }
    }

    // 3. 英文/拼音品牌头剥离 (针对开头出现的连续英文字符)
    masked = masked.replace(/^[a-zA-Z\s\d]+(?=[\u4e00-\u9fa5])/, '');

    // 4. 规格、包装与修饰词深度清理
    // 4.1 基础重量/体积
    masked = masked.replace(/\d+(\.\d+)?\s*(g|kg|ml|l|KG|G|ML|L)/gi, '');

    // 4.2 包装描述
    masked = masked.replace(/\d+\s*(袋|支|瓶|枚|卡|罐|盒|包|联包|粒|件|个)(\s*装)?/gi, '');
    masked = masked.replace(/散装|组合装|盒装|瓶装|听装|罐装|袋装/g, '');

    // 4.3 营销/营养/形状修饰词 (如: 高钙、棒棒、兔子等)
    masked = masked.replace(/高钙|益生菌|棒棒|兔子|造型|趣味|萌|迷你/g, '');

    // 5. 符号与无意义词清理
    masked = masked.replace(/^[号\-\s\+\.]+/, ''); // 移除头部的杂质
    masked = masked.replace(/\(([^)]*)\)|（([^）]*)）/g, ''); // 移除括号内容
    masked = masked.replace(/大满足|椰果|旗舰店|官方店|专卖店|专供|定制|直供/g, '');

    // 6. 再次清理残留的中划线后缀 (针对多重清理后可能暴露的后缀)
    masked = masked.replace(/-[^-]{1,3}$/, '');

    masked = masked.trim();

    // 如果脱敏后变成了空字符串或剩余字符太短，返回通用名
    if (!masked || masked.length < 2) return 'xxx常规商品';

    return `xxx${masked}`;
}

/**
 * 客户名称脱敏
 * 规则：将客户真实名称替换为「客户 + 字母」(依据 ID 确定性映射)
 */
export function maskCustomerName(name: string | undefined | null, id: number | undefined | null): string {
    // 优先使用 ID 进行确定性映射，如果没有 ID 则根据名称生成一个哈希 ID
    const targetId = id || (name ? name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) : 0);

    if (!targetId && !name) return '匿名客户';

    // 使用 ID 生成字母 A-Z (基于 ASCII 65-90)
    const charCode = 65 + (Number(targetId) % 26);
    const letter = String.fromCharCode(charCode);

    // 如果 ID 很大，可以加个后缀区分，或者简单的 ID 尾号
    // 我们在这里加上 targetId 的后两位作为区分，防止 26 个字母不够用
    const suffix = targetId > 26 ? `-${Number(targetId) % 100}` : '';

    return `客户 ${letter}${suffix}`;
}
