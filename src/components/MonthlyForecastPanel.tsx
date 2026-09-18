import { useEffect, useState } from 'react';
import { Calendar, TrendingUp, Package, RefreshCw } from 'lucide-react';
import { fetchWithAuth } from '../utils/authFetch';
import { useBrandMask } from '../utils/demoMask';


interface ForecastResult {
    sku_id: number;
    product_name?: string;
    current_month_forecast: number;
    next_month_forecast: number;
    current_quarter_forecast?: number;
    next_quarter_forecast?: number;
}

interface MonthlyForecastData {
    forecast_month: string;
    generated_at: string;
    forecast_results: ForecastResult[];
    metadata: {
        total_skus: number;
        prediction_model: string;
        batch_count: number;
    };
}

export const MonthlyForecastPanel = () => {
    const { maskProduct } = useBrandMask();
    const [forecastData, setForecastData] = useState<MonthlyForecastData | null>(null);
    const [loading, setLoading] = useState(true);

    // 加载数据，返回 generated_at 供轮询比较
    const loadForecastData = async (quiet = false): Promise<string | null> => {
        try {
            if (!quiet) setLoading(true);
            const response = await fetchWithAuth('/monthly_forecast_baseline.json?t=' + Date.now());
            if (!response.ok) return null;
            const data: MonthlyForecastData = await response.json();

            // 数据脱敏处理
            if (data.forecast_results) {
                data.forecast_results = data.forecast_results.map(item => ({
                    ...item,
                    product_name: item.product_name
                }));
            }

            setForecastData(data);
            return data.generated_at;
        } catch (error) {
            console.error('[月初预测] 加载失败:', error);
            return null;
        } finally {
            if (!quiet) setLoading(false);
        }
    };

    useEffect(() => {
        let lastGeneratedAt: string | null = null;

        // 首次加载
        loadForecastData().then(ts => { lastGeneratedAt = ts; });

        // 每3分钟静默轮询，检测 generated_at 是否变化
        const POLL_INTERVAL = 3 * 60 * 1000;
        const timer = setInterval(async () => {
            try {
                const resp = await fetchWithAuth('/monthly_forecast_baseline.json?t=' + Date.now());
                if (!resp.ok) return;
                const data: MonthlyForecastData = await resp.json();
                if (data.generated_at !== lastGeneratedAt) {
                    console.log('[月初预测] 检测到新数据，自动刷新');
                    lastGeneratedAt = data.generated_at;
                    setForecastData(data);
                }
            } catch { /* 静默忽略 */ }
        }, POLL_INTERVAL);

        return () => clearInterval(timer);
    }, []);

    if (loading) {
        return (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <div className="flex items-center justify-center">
                    <RefreshCw className="w-5 h-5 text-blue-600 animate-spin mr-2" />
                    <span className="text-slate-500">加载月初预测数据...</span>
                </div>
            </div>
        );
    }

    if (!forecastData || forecastData.forecast_results.length === 0) {
        return (
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200 p-8">
                <div className="text-center">
                    <Calendar className="w-16 h-16 text-blue-400 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-slate-700 mb-2">暂无月初预测数据</h3>
                    <p className="text-sm text-slate-500 mb-4">
                        系统将在每月1号凌晨2点自动生成月度预测基线
                    </p>
                    <div className="inline-flex items-center gap-2 text-xs text-blue-600 bg-blue-100 px-3 py-1 rounded-full">
                        <Calendar className="w-3 h-3" />
                        下次生成时间: 每月1号 02:00
                    </div>
                </div>
            </div>
        );
    }

    const { forecast_month, generated_at, forecast_results, metadata } = forecastData;
    const generatedDate = new Date(generated_at);

    // 计算总预测值
    const totalCurrentMonth = forecast_results.reduce((sum: number, item: ForecastResult) => sum + (item.current_month_forecast || 0), 0);
    const totalNextMonth = forecast_results.reduce((sum: number, item: ForecastResult) => sum + (item.next_month_forecast || 0), 0);
    const growthRate = totalCurrentMonth > 0 ? ((totalNextMonth - totalCurrentMonth) / totalCurrentMonth * 100) : 0;

    // 全量 SKU (按预测值降序)
    const allSkus = [...forecast_results]
        .sort((a, b) => (b.current_month_forecast || 0) - (a.current_month_forecast || 0));

    return (
        <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl border border-purple-200 shadow-md overflow-hidden">
            {/* 标题栏 */}
            <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-4 text-white">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-white/20 p-2 rounded-lg">
                            <TrendingUp className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold">月度预测基线</h2>
                            <p className="text-sm text-purple-100">
                                预测月份: {forecast_month} · 生成于 {generatedDate.toLocaleString('zh-CN')}
                            </p>
                        </div>
                    </div>

                </div>
            </div>

            {/* 统计卡片 */}
            <div className="grid grid-cols-4 gap-4 p-6">
                <div className="bg-white rounded-lg p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
                        <Package className="w-4 h-4" />
                        预测SKU数
                    </div>
                    <div className="text-2xl font-bold text-slate-800">{metadata.total_skus}</div>
                    <div className="text-xs text-slate-400 mt-1">共{metadata.batch_count}批次生成</div>
                </div>

                <div className="bg-white rounded-lg p-4 shadow-sm">
                    <div className="text-slate-500 text-sm mb-2">本月预测总额</div>
                    <div className="text-2xl font-bold text-blue-600">¥{(totalCurrentMonth / 10000).toFixed(1)}万</div>
                    <div className="text-xs text-slate-400 mt-1">{forecast_month}</div>
                </div>

                <div className="bg-white rounded-lg p-4 shadow-sm">
                    <div className="text-slate-500 text-sm mb-2">下月预测总额</div>
                    <div className="text-2xl font-bold text-green-600">¥{(totalNextMonth / 10000).toFixed(1)}万</div>
                    <div className="text-xs text-slate-400 mt-1">环比{growthRate > 0 ? '+' : ''}{growthRate.toFixed(1)}%</div>
                </div>

                <div className="bg-white rounded-lg p-4 shadow-sm">
                    <div className="text-slate-500 text-sm mb-2">预测模型</div>
                    <div className="text-xs text-slate-400 mt-1">智能预测引擎</div>
                </div>
            </div>

            {/* 全量 SKU 列表 */}
            <div className="px-6 pb-6">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">📊 全量预测数据 ({forecast_results.length})</h3>
                <div className="bg-white rounded-lg overflow-hidden shadow-sm border border-slate-100">
                    <div className="max-h-[320px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
                        <table className="w-full text-sm relative">
                            <thead className="bg-slate-50 text-slate-600 sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="text-left py-3 px-4 font-medium bg-slate-50">排名</th>
                                    <th className="text-left py-3 px-4 font-medium bg-slate-50">SKU ID</th>
                                    <th className="text-left py-3 px-4 font-medium bg-slate-50">商品名</th>
                                    <th className="text-right py-3 px-4 font-medium bg-slate-50">本月预测</th>
                                    <th className="text-right py-3 px-4 font-medium bg-slate-50">下月预测</th>
                                    <th className="text-right py-3 px-4 font-medium bg-slate-50">环比</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {allSkus.map((sku, index) => {
                                    const current = sku.current_month_forecast || 0;
                                    const next = sku.next_month_forecast || 0;
                                    const growth = current > 0 ? ((next - current) / current * 100) : 0;

                                    return (
                                        <tr key={sku.sku_id} className="hover:bg-slate-50 transition-colors">
                                            <td className="py-2 px-4 text-slate-500">
                                                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${index < 3 ?
                                                    (index === 0 ? 'bg-yellow-100 text-yellow-700' :
                                                        index === 1 ? 'bg-slate-200 text-slate-700' :
                                                            'bg-orange-100 text-orange-700') : 'text-slate-500'
                                                    }`}>
                                                    {index + 1}
                                                </span>
                                            </td>
                                            <td className="py-2 px-4 font-medium text-slate-700">{sku.sku_id}</td>
                                            <td className="py-2 px-4 text-slate-600 text-xs max-w-[250px] truncate" title={sku.product_name}>
                                                {maskProduct(sku.product_name || '-')}
                                            </td>
                                            <td className="py-2 px-4 text-right font-semibold text-slate-800">
                                                ¥{current.toLocaleString()}
                                            </td>
                                            <td className="py-2 px-4 text-right font-semibold text-slate-800">
                                                ¥{next.toLocaleString()}
                                            </td>
                                            <td className="py-2 px-4 text-right">
                                                <span className={`font-medium ${growth > 0 ? 'text-green-600' : growth < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                                                    {growth > 0 ? '+' : ''}{growth.toFixed(1)}%
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};
