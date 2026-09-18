import { useEffect, useState } from 'react';
import { TrendingDown, TrendingUp, AlertCircle } from 'lucide-react';
import { fetchWithAuth } from '../utils/authFetch';
import { useBrandMask } from '../utils/demoMask';


interface DeviationAlert {
    sku_id: number;
    product_name: string;
    tracking_date: string;
    forecast_value: number;
    expected_progress: number;
    actual_cumulative: number;
    achievement_rate: number;
    deviation_rate: number;
    suggestion: 'decrease' | 'increase';
    adjustment_amount: number;
    severity: 'high' | 'medium';
}

interface TrackingData {
    current_month: string;
    last_tracking_date: string | null;
    progress_ratio: number;
    deviations: DeviationAlert[];
    summary: {
        total_skus: number;
        deviation_count: number;
        high_severity: number;
        medium_severity: number;
    };
}

export const DeviationAlertPanel = () => {
    const { maskProduct } = useBrandMask();
    const [tracking, setTracking] = useState<TrackingData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchTrackingData();
    }, []);

    const fetchTrackingData = async () => {
        try {
            setLoading(true);
            const response = await fetchWithAuth('/api/deviation-alerts');
            const data: TrackingData = await response.json();

            // 数据脱敏处理
            if (data.deviations) {
                data.deviations = data.deviations.map(alert => ({
                    ...alert,
                    product_name: alert.product_name
                }));
            }

            setTracking(data);
        } catch (error) {
            console.error('[偏差告警] 加载失败:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
                    <p className="text-slate-500">加载中...</p>
                </div>
            </div>
        );
    }

    if (!tracking || !tracking.last_tracking_date) {
        return (
            <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl p-12 text-center">
                <div className="text-6xl mb-4">📊</div>
                <h3 className="text-lg font-semibold text-slate-700 mb-2">暂无偏差跟踪数据</h3>
                <p className="text-sm text-slate-500">
                    系统将在每月5/10/15/20/25号自动执行偏差跟踪
                </p>
            </div>
        );
    }

    const { deviations, summary } = tracking;

    return (
        <div className="space-y-6">
            {/* 统计概览 */}
            <div className="grid grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-lg">
                    <div className="text-sm text-purple-600 font-medium mb-1">总SKU数</div>
                    <div className="text-2xl font-bold text-purple-700">{summary.total_skus}</div>
                </div>
                <div className="bg-gradient-to-br from-amber-50 to-amber-100 p-4 rounded-lg">
                    <div className="text-sm text-amber-600 font-medium mb-1">偏差SKU</div>
                    <div className="text-2xl font-bold text-amber-700">{summary.deviation_count}</div>
                </div>
                <div className="bg-gradient-to-br from-red-50 to-red-100 p-4 rounded-lg">
                    <div className="text-sm text-red-600 font-medium mb-1">严重偏差</div>
                    <div className="text-2xl font-bold text-red-700">{summary.high_severity}</div>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-lg">
                    <div className="text-sm text-green-600 font-medium mb-1">月度进度</div>
                    <div className="text-2xl font-bold text-green-700">{tracking.progress_ratio}%</div>
                </div>
            </div>

            {/* 偏差列表 */}
            {deviations.length === 0 ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-8 text-center">
                    <div className="text-4xl mb-3">✅</div>
                    <h3 className="text-lg font-semibold text-green-800 mb-2">一切正常！</h3>
                    <p className="text-sm text-green-600">
                        所有SKU的销售进度均在合理范围内（偏差≤±20%）
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-slate-800">
                            偏差详情 ({deviations.length}个SKU需关注)
                        </h3>
                        <span className="text-xs text-slate-500">
                            最后更新: {tracking.last_tracking_date}
                        </span>
                    </div>

                    <div className="space-y-3 max-h-[700px] overflow-y-auto pr-2">
                        {deviations.map((alert) => (
                            <div
                                key={alert.sku_id}
                                className={`border-l-4 ${alert.severity === 'high' ? 'border-red-500 bg-red-50' : 'border-amber-500 bg-amber-50'
                                    } rounded-lg p-4 shadow-sm`}
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="font-semibold text-slate-800">SKU {alert.sku_id}</span>
                                            {alert.severity === 'high' && (
                                                <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded">严重</span>
                                            )}
                                        </div>
                                        <p className="text-sm text-slate-600">{maskProduct(alert.product_name)}</p>
                                    </div>
                                    <div className="text-right">
                                        <div className={`flex items-center gap-1 ${alert.deviation_rate < 0 ? 'text-red-600' : 'text-green-600'
                                            }`}>
                                            {alert.deviation_rate < 0 ? (
                                                <TrendingDown className="w-5 h-5" />
                                            ) : (
                                                <TrendingUp className="w-5 h-5" />
                                            )}
                                            <span className="font-bold text-lg">{alert.deviation_rate > 0 ? '+' : ''}{alert.deviation_rate}%</span>
                                        </div>
                                        <span className="text-xs text-slate-500">偏差率</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-3 text-sm mb-3">
                                    <div>
                                        <span className="text-slate-500">月度预测</span>
                                        <p className="font-semibold text-slate-800">
                                            ¥{alert.forecast_value.toLocaleString()}
                                        </p>
                                    </div>
                                    <div>
                                        <span className="text-slate-500">预期进度</span>
                                        <p className="font-semibold text-slate-800">
                                            ¥{alert.expected_progress.toLocaleString()}
                                        </p>
                                    </div>
                                    <div>
                                        <span className="text-slate-500">实际累计</span>
                                        <p className="font-semibold text-slate-800">
                                            ¥{alert.actual_cumulative.toLocaleString()}
                                        </p>
                                    </div>
                                </div>

                                <div className="bg-white rounded p-3 flex items-start gap-2">
                                    <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                                    <div className="flex-1">
                                        <p className="text-sm font-medium text-slate-700 mb-1">建议调整</p>
                                        <p className="text-sm text-slate-600">
                                            {alert.suggestion === 'decrease' ? '下调' : '上调'}本月预测
                                            <span className="font-semibold text-blue-600 mx-1">
                                                ¥{alert.adjustment_amount.toLocaleString()}
                                            </span>
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors">
                                            接受建议
                                        </button>
                                        <button className="px-3 py-1 border border-slate-300 text-slate-600 text-xs rounded hover:bg-slate-50 transition-colors">
                                            忽略
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
