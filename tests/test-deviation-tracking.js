// 临时测试脚本：手动执行偏差跟踪
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 模拟数据：创建一个有预测值的baseline
const mockBaseline = {
    "forecast_month": "2026-02",
    "generated_at": new Date().toISOString(),
    "forecast_results": [
        {
            "sku_id": 11165,
            "current_month_forecast": 500000,
            "next_month_forecast": 550000
        },
        {
            "sku_id": 37161,
            "current_month_forecast": 400000,
            "next_month_forecast": 420000
        },
        {
            "sku_id": 4542,
            "current_month_forecast": 300000,
            "next_month_forecast": 320000
        }
    ],
    "metadata": {
        "total_skus": 3,
        "prediction_model": "dify_chatflow_mock",
        "batch_count": 1
    }
};

// 保存mock数据
fs.writeFileSync(
    path.join(__dirname, 'public', 'monthly_forecast_baseline.json'),
    JSON.stringify(mockBaseline, null, 2)
);

console.log('✅ 已创建模拟预测数据');

// 执行偏差跟踪逻辑
const today = new Date();
const year = today.getFullYear();
const month = today.getMonth() + 1;
const dayOfMonth = today.getDate();
const daysInMonth = new Date(year, month, 0).getDate();
const currentMonth = `${year}-${String(month).padStart(2, '0')}`;
const currentMonthShort = `${year % 100}.${month}`;  //如 '26.2'

console.log(`\n当前日期: ${year}-${month}-${dayOfMonth}`);
console.log(`月份标识: ${currentMonthShort}`);
console.log(`月总天数: ${daysInMonth}`);
console.log(`当前进度: ${dayOfMonth}/${daysInMonth} = ${(dayOfMonth / daysInMonth * 100).toFixed(1)}%\n`);

// 读取销售数据
const salesData = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'public', 'sales_analysis_matrix.json'),
    'utf-8'
));

console.log(`销售数据中的月份列:`, salesData.meta_info.monthly_columns.slice(-3));
console.log(`当月列(${currentMonthShort})是否存在:`, salesData.meta_info.monthly_columns.includes(currentMonthShort));

// 计算偏差
const deviations = [];
const progressRatio = dayOfMonth / daysInMonth;

for (const forecast of mockBaseline.forecast_results) {
    const salesRow = salesData.monthly_matrix.find(row => row.sku_id === forecast.sku_id);
    if (!salesRow) {
        console.log(`\n⚠️ SKU ${forecast.sku_id}: 在销售数据中未找到`);
        continue;
    }

    const actualCumulative = salesRow[currentMonthShort] || 0;
    const expectedProgress = forecast.current_month_forecast * progressRatio;
    const achievementRate = expectedProgress > 0 ? (actualCumulative / expectedProgress) * 100 : 100;
    const deviationRate = achievementRate - 100;

    console.log(`\nSKU ${forecast.sku_id} (${salesRow.product_name}):`);
    console.log(`  月度预测: ¥${forecast.current_month_forecast.toLocaleString()}`);
    console.log(`  预期进度 (${(progressRatio * 100).toFixed(1)}%): ¥${expectedProgress.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`);
    console.log(`  实际累计: ¥${actualCumulative.toLocaleString()}`);
    console.log(`  达成率: ${achievementRate.toFixed(1)}%`);
    console.log(`  偏差率: ${deviationRate > 0 ? '+' : ''}${deviationRate.toFixed(1)}%`);

    // 偏差超过±20%才记录
    if (Math.abs(deviationRate) > 20) {
        console.log(`  ⚠️  偏差超过±20%，需要关注！`);
        deviations.push({
            sku_id: forecast.sku_id,
            product_name: salesRow.product_name || '',
            tracking_date: today.toISOString().split('T')[0],
            forecast_value: forecast.current_month_forecast,
            expected_progress: Math.round(expectedProgress),
            actual_cumulative: actualCumulative,
            achievement_rate: Math.round(achievementRate),
            deviation_rate: Math.round(deviationRate),
            suggestion: deviationRate < 0 ? 'decrease' : 'increase',
            adjustment_amount: Math.round(Math.abs(forecast.current_month_forecast * deviationRate / 100)),
            severity: Math.abs(deviationRate) > 30 ? 'high' : 'medium'
        });
    } else {
        console.log(`  ✅ 偏差在正常范围内`);
    }
}

// 保存跟踪结果
const tracking = {
    current_month: currentMonth,
    last_tracking_date: today.toISOString().split('T')[0],
    tracking_time: today.toISOString(),
    progress_ratio: Math.round(progressRatio * 100),
    deviations: deviations,
    unread_alerts: deviations.length,
    summary: {
        total_skus: mockBaseline.forecast_results.length,
        deviation_count: deviations.length,
        high_severity: deviations.filter(d => d.severity === 'high').length,
        medium_severity: deviations.filter(d => d.severity === 'medium').length
    }
};

fs.writeFileSync(
    path.join(__dirname, 'public', 'forecast_tracking.json'),
    JSON.stringify(tracking, null, 2)
);

console.log(`\n${'='.repeat(60)}`);
console.log(`偏差跟踪完成！`);
console.log(`  总SKU数: ${tracking.summary.total_skus}`);
console.log(`  偏差SKU数: ${tracking.summary.deviation_count}`);
console.log(`    严重偏差: ${tracking.summary.high_severity}个`);
console.log(`    中度偏差: ${tracking.summary.medium_severity}个`);
console.log(`${'='.repeat(60)}`);
console.log(`\n结果已保存到: public/forecast_tracking.json`);
