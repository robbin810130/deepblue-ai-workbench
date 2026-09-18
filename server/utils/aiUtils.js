/**
 * AI 工作流调用工具 (AI Workflow Utility)
 */
import dotenv from 'dotenv';
dotenv.config();

/**
 * 调用品牌提取工作流（DIFY_BRAND_EXTRACT_API_KEY）
 *
 * 使用 blocking 模式同步等待工作流执行完成，确保 brand_dictionary 表在调用返回前已更新。
 * 调用完成后方可安全地重新查询 brand_dictionary 表进行脱敏。
 *
 * @param {string[]} productNames 商品名列表
 * @returns {Promise<{ success: boolean, added?: number, message?: string }>}
 */
export async function extractBrandsFromProducts(productNames) {
    const apiKey = process.env.DIFY_BRAND_EXTRACT_API_KEY;
    const apiUrl = process.env.DIFY_BRAND_EXTRACT_API_URL;

    if (!apiKey || !apiUrl) {
        console.warn('[品牌提取] Workflow 配置未就绪，跳过提取步骤');
        return { success: false, message: 'API配置缺失' };
    }

    if (!productNames || productNames.length === 0) {
        return { success: true, message: '无商品名，跳过' };
    }

    try {
        console.log(`[品牌提取] 正在发送 ${productNames.length} 个商品名进行品牌提取（blocking 模式等待完成）...`);

        const response = await fetch(`${apiUrl}/workflows/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: {
                    goods_name_list: productNames.join('\n')
                },
                response_mode: 'blocking',   // 同步等待工作流完成，确保 brand_dictionary 已更新
                user: 'system_brand_extractor'
            })
        });

        if (!response.ok) {
            const errorMsg = await response.text();
            throw new Error(`品牌提取工作流接口响应异常: ${response.status} - ${errorMsg.substring(0, 200)}`);
        }

        const result = await response.json();

        // 尝试从工作流 outputs 中读取新增品牌数量（如有）
        const outputs = result?.data?.outputs || result?.outputs || {};
        const addedCount = outputs.added_count ?? outputs.new_brands_count ?? null;

        if (addedCount !== null) {
            console.log(`[品牌提取] ✅ 工作流完成，新增品牌 ${addedCount} 条`);
        } else {
            console.log('[品牌提取] ✅ 工作流完成（brand_dictionary 已更新）');
        }

        return { success: true, added: addedCount };
    } catch (err) {
        console.error('[品牌提取] ❌ 工作流调用失败:', err.message);
        return { success: false, message: err.message };
    }
}
