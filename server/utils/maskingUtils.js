/**
 * 后端敏感数据脱敏工具 (Backend Data Masking Utilities)
 */

/**
 * 姓名/客户名称脱敏
 * 规则：
 * - 2个字：张三 -> 张*
 * - 3个字：张小三 -> 张*三
 * - 4个字及以上：上海嘉定公司 -> 上**司
 */
export const maskName = (name) => {
    if (!name || typeof name !== 'string') return name;
    const len = name.length;
    if (len <= 1) return '*';
    if (len === 2) return name[0] + '*';
    if (len === 3) return name[0] + '*' + name[2];
    return name[0] + '*'.repeat(len - 2) + name[len - 1];
};

/**
 * 金额脱敏
 * 规则：保留前两位数字，其余部分掩码，保留小数点后内容
 * 如：12345.67 -> 12***.67
 */
export const maskAmount = (amount) => {
    if (amount === null || amount === undefined) return amount;
    const str = String(amount);
    const dotIndex = str.indexOf('.');
    const integerPart = dotIndex > -1 ? str.substring(0, dotIndex) : str;
    const decimalPart = dotIndex > -1 ? str.substring(dotIndex) : '';
    
    if (integerPart.length <= 2) return '*'.repeat(integerPart.length) + decimalPart;
    
    return integerPart.substring(0, 2) + '*'.repeat(integerPart.length - 2) + decimalPart;
};

/**
 * 联系方式（电话）脱敏
 * 规则：13812345678 -> 138****5678
 */
export const maskPhone = (phone) => {
    if (!phone || typeof phone !== 'string') return phone;
    // 简单正则处理手机号
    return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
};

/**
 * 品牌脱敏 (高级脱敏)
 * 规则：将文本中匹配到的品牌名称替换为 **
 * @param {string} text 原始文本
 * @param {string[]} brandList 品牌列表
 */
export const maskBrandBrands = (text, brandList) => {
    if (!text || !brandList || brandList.length === 0) return text;
    
    // 对品牌列表按长度降序排列，避免子集匹配（如“良品”匹配了“良品铺子”的前两个字）
    const sortedBrands = [...brandList].sort((a, b) => b.length - a.length);
    
    let masked = text;
    sortedBrands.forEach(brand => {
        if (!brand) return;
        // 转义正则特殊字符
        const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedBrand, 'g');
        masked = masked.replace(regex, '**');
    });
    
    return masked;
};

/**
 * 预测调用前品牌脱敏 —— 调用 DIFY_CHATFLOW_API_KEY（月度/季度销售预测）专用
 *
 * 将数据矩阵（monthly_matrix / quarterly_matrix）中每行的 product_name 字段
 * 按 brand_dictionary 表中的品牌，替换为唯一标识符"品牌[id]"（如"品牌10"）。
 *
 * 规则：
 * - 按品牌名长度降序匹配，防止短名称误匹配长名称的子集
 * - 原始数据对象不被修改（浅拷贝每行再处理）
 * - 未匹配到任何品牌的 product_name 保持原样
 *
 * @param {Object} data       原始数据对象 { monthly_matrix, quarterly_matrix, meta_info, ... }
 * @param {Array}  brandDict  品牌字典，格式 [{ id: number, brand_name: string }]
 * @returns {Object}          脱敏后的新数据对象（原对象不受影响）
 */
export const maskProductNamesByBrandDict = (data, brandDict) => {
    if (!brandDict || brandDict.length === 0) return data;

    // 按品牌名长度降序排列，避免短品牌误匹配长品牌的子集
    const sortedDict = [...brandDict].sort((a, b) => b.brand_name.length - a.brand_name.length);

    /**
     * 对单个 product_name 字符串执行品牌替换
     */
    const maskSingleName = (name) => {
        if (!name || typeof name !== 'string') return name;
        let result = name;
        for (const { id, brand_name } of sortedDict) {
            if (!brand_name) continue;
            const escaped = brand_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            result = result.replace(new RegExp(escaped, 'g'), `品牌${id}`);
        }
        return result;
    };

    /**
     * 对矩阵数组的每行进行浅拷贝并替换 product_name
     */
    const maskMatrix = (matrix) => {
        if (!Array.isArray(matrix)) return matrix;
        return matrix.map(row => ({
            ...row,
            product_name: maskSingleName(row.product_name)
        }));
    };

    return {
        ...data,
        monthly_matrix:   maskMatrix(data.monthly_matrix),
        quarterly_matrix: maskMatrix(data.quarterly_matrix)
    };
};
