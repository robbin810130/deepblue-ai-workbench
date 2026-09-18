// 全量SKU月度预测脚本 (增强版：带重试、实时保存、错误容错、品牌脱敏)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import pg from 'pg';
import { maskProductNamesByBrandDict } from '../server/utils/maskingUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIFY_API_KEY = process.env.DIFY_CHATFLOW_API_KEY;
const DIFY_API_URL = process.env.DIFY_CHATFLOW_API_URL;
const BATCH_SIZE = 8;      // 每批8个SKU (减小批次以提高稳定性)
const BATCH_DELAY = 3000;   // 批次间延迟3秒
const MAX_RETRIES = 3;      // 每批最多重试3次

const salesData = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'public', 'sales_analysis_matrix.json'), 'utf-8')
);

const today = new Date();
const forecastMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
const outputPath = path.join(__dirname, '..', 'public', 'monthly_forecast_baseline.json');

// ====== 【品牌字典】从 PostgreSQL 加载品牌脱敏映射表 ======
const { Pool } = pg;
const pgPool = new Pool({
    host:     process.env.PG_HOST,
    port:     parseInt(process.env.PG_PORT || '9800'),
    database: process.env.PG_DATABASE,
    user:     process.env.PG_USER,
    password: process.env.PG_PASSWORD
});

let brandDict = [];
try {
    const res = await pgPool.query('SELECT id, brand_name FROM brand_dictionary ORDER BY id');
    brandDict = res.rows;
    console.log(`🔐 已加载品牌字典，共 ${brandDict.length} 条品牌记录（将在调用前对 product_name 脱敏）\n`);
} catch (e) {
    console.warn(`⚠️  品牌字典加载失败，将以未脱敏数据继续: ${e.message}\n`);
} finally {
    pgPool.end().catch(() => {});
}
// =========================================================

console.log('🚀 开始生成月度预测基线 (增强稳定性版)...\n');
console.log(`Dify API: ${DIFY_API_URL}`);
console.log(`📦 总SKU数: ${salesData.monthly_matrix.length}`);
console.log(`📊 批次设置: ${BATCH_SIZE}个/批, 最大重试${MAX_RETRIES}次\n`);

// 分批
const batches = [];
for (let i = 0; i < salesData.monthly_matrix.length; i += BATCH_SIZE) {
    batches.push(salesData.monthly_matrix.slice(i, i + BATCH_SIZE));
}

console.log(`📋 共分为 ${batches.length} 批\n`);
console.log('='.repeat(70) + '\n');

// 全局状态
const allForecasts = [];
let successCount = 0;
let failCount = 0;

// 实时保存函数
const saveProgress = () => {
    const forecastBaseline = {
        forecast_month: forecastMonth,
        generated_at: new Date().toISOString(),
        forecast_results: allForecasts,
        metadata: {
            total_skus: allForecasts.length,
            target_skus: salesData.monthly_matrix.length,
            prediction_model: 'dify_chatflow',
            batch_count: batches.length,
            batch_size: BATCH_SIZE,
            success_rate: ((allForecasts.length / salesData.monthly_matrix.length) * 100).toFixed(1) + '%',
            status: allForecasts.length >= salesData.monthly_matrix.length ? 'completed' : 'in_progress'
        }
    };
    try {
        fs.writeFileSync(outputPath, JSON.stringify(forecastBaseline, null, 2));
        console.log(`  💾 [进度保存] 当前已收集 ${allForecasts.length} 个SKU数据`);
    } catch (e) {
        console.error(`  ❌ 保存失败: ${e.message}`);
    }
};

/**
 * 健壮的 JSON 提取器
 */
const extractJsonFromText = (text) => {
    try {
        // 先尝试定位包含 forecast_results 的 JSON 块
        const regexes = [
            /```json\s*([\s\S]*?)\s*```/i,        // Markdown 代码块
            /({[\s\S]*"forecast_results"[\s\S]*})/i, // 包含关键字段的字典
            /(\[[\s\S]*"sku_id"[\s\S]*\])/i,      // 包含关键字段的数组
            /({[\s\S]*})/i,                        // 任何字典
            /(\[[\s\S]*\])/i                       // 任何数组
        ];

        for (const reg of regexes) {
            const match = text.match(reg);
            if (match) {
                try {
                    const parsed = JSON.parse(match[1] || match[0]);
                    // 如果结果是对象，检查是否包含 forecast_results
                    if (parsed.forecast_results && Array.isArray(parsed.forecast_results)) {
                        return parsed.forecast_results;
                    }
                    // 如果结果本身就是数组，且第一项有 sku_id，则直接返回
                    if (Array.isArray(parsed) && parsed.length > 0 && (parsed[0].sku_id || parsed[0].id)) {
                        return parsed;
                    }
                } catch (e) {
                    // 继续尝试下一个正则
                }
            }
        }
    } catch (e) {}
    return null;
};

// 处理单个批次
const processBatch = async (batch, batchIndex, retryCount = 0) => {
    try {
        console.log(`📦 批次 ${batchIndex + 1}/${batches.length} (SKU ${batch[0].sku_id} ~ ${batch[batch.length - 1].sku_id})${retryCount > 0 ? ` [重试 ${retryCount}/${MAX_RETRIES}]` : ''}`);

        // 构建该批次的数据
        const batchData = {
            monthly_matrix: batch,
            quarterly_matrix: salesData.quarterly_matrix.filter(row =>
                batch.some(b => b.sku_id === row.sku_id)
            ),
            meta_info: salesData.meta_info
        };

        // ====== 【品牌脱敏】调用前将 product_name 中的品牌名替换为"品牌[id]" ======
        const maskedBatchData = maskProductNamesByBrandDict(batchData, brandDict);
        // =====================================================================

        const queryContent = JSON.stringify(maskedBatchData, null, 2);

        // 设置较长的超时
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000); // 2分钟超时

        const response = await fetch(DIFY_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${DIFY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: {
                    userinput: {
                        query: queryContent
                    },
                    customer_batch_json: queryContent // 兼容部分工作流可能要求的输入名
                },
                query: queryContent,
                response_mode: 'streaming',
                conversation_id: '',
                user: `sys_fc_b${batchIndex}_r${retryCount}`
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`API响应错误: ${response.status} ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(line => line.trim());

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.substring(6);
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.event === 'message' || parsed.event === 'agent_message') {
                            fullResponse += parsed.answer || '';
                        }
                    } catch (e) { }
                }
            }
        }

        // 提取结果
        const extractedResults = extractJsonFromText(fullResponse);
        
        if (extractedResults && Array.isArray(extractedResults)) {
            // 归一化字段并补全商品名
            const batchForecasts = extractedResults.map(forecast => {
                const sku_id = forecast.sku_id || forecast.id;
                const originalRow = batch.find(row => row.sku_id === Number(sku_id));
                return {
                    sku_id: Number(sku_id),
                    product_name: originalRow?.product_name || forecast.product_name || '',
                    current_month_forecast: forecast.current_month_forecast ?? 0,
                    next_month_forecast: forecast.next_month_forecast ?? 0,
                    current_quarter_forecast: forecast.current_quarter_forecast ?? 0,
                    next_quarter_forecast: forecast.next_quarter_forecast ?? 0
                };
            }).filter(f => f.sku_id);

            if (batchForecasts.length > 0) {
                console.log(`  ✅ 成功提取 ${batchForecasts.length} 个SKU预测`);
                allForecasts.push(...batchForecasts);
                successCount += batchForecasts.length;
                saveProgress(); 
                return true;
            }
        }

        console.warn(`  ⚠️ 提取失败 (响应长度: ${fullResponse.length})`);
        if (fullResponse.length < 500) {
            console.warn(`  [调试] API完整返回内容: ${fullResponse}`);
        } else {
            console.warn(`  [调试] API返回前200字符: ${fullResponse.substring(0, 200)}...`);
        }
        throw new Error('无法从响应中解析出有效的预测数据');

    } catch (error) {
        console.error(`  ❌ 批次处理出错: ${error.message}`);
        if (retryCount < MAX_RETRIES) {
            const waitTime = 5000 * (retryCount + 1);
            console.log(`  ⏳ ${waitTime / 1000}秒后重试...`);
            await new Promise(r => setTimeout(r, waitTime));
            return await processBatch(batch, batchIndex, retryCount + 1);
        } else {
            console.error(`  💀 达到最大重试次数，跳过此批次`);
            failCount += batch.length;
            return false;
        }
    }
};

// 主执行流程
const main = async () => {
    for (let i = 0; i < batches.length; i++) {
        await processBatch(batches[i], i);

        // 批次间延迟
        if (i < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }
    }

    console.log('\n' + '='.repeat(70));
    console.log('🏁 所有批次处理完成');
    console.log(`📊 最终统计: 成功 ${successCount} / 失败 ${failCount} / 总计 ${salesData.monthly_matrix.length}`);
    console.log(`💾 最终结果已保存: ${outputPath}`);
};

main().catch(console.error);
