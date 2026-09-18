import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Calendar, FileText, RefreshCw, AlertCircle } from 'lucide-react';
import { API_BASE_URL, AI_ANALYSIS_ENDPOINT } from '../config';
import { DeviationAlertPanel } from './DeviationAlertPanel';
import { MonthlyForecastPanel } from './MonthlyForecastPanel';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { fetchWithAuth } from '../utils/authFetch';
import { useBrandMask } from '../utils/demoMask';


// 数据类型定义
interface MonthlyDataRow {
    sku_id: number;
    product_name: string;
    [key: string]: number | string;
}

interface QuarterlyDataRow {
    sku_id: number;
    product_name: string;
    [key: string]: number | string;
}

interface SalesData {
    monthly_matrix: MonthlyDataRow[];
    quarterly_matrix: QuarterlyDataRow[];
    meta_info: {
        query_time: string;
        sku_filter: string;
        value_unit: string;
        monthly_columns: string[];
        quarterly_columns: string[];
    };
}

interface PredictionResult {
    sku_id: number;
    current_month_forecast: number;
    next_month_forecast: number;
    current_quarter_forecast: number;
    next_quarter_forecast: number;
}

export const PredictionModule = () => {
    const { maskProduct } = useBrandMask();
    const [isLoading, setIsLoading] = useState(false);
    const [salesData, setSalesData] = useState<SalesData | null>(null);
    const [lastUpdateTime, setLastUpdateTime] = useState<string>('');
    const [updateStatus, setUpdateStatus] = useState<string>('');

    // Tab状态
    type TabType = 'baseline' | 'analysis';
    const [activeTab, setActiveTab] = useState<TabType>('baseline');

    // SKU选择状态
    type SelectionMode = 'top10' | 'top11-20' | 'top21-30' | 'custom';
    const [selectionMode, setSelectionMode] = useState<SelectionMode>('top10');
    const [selectedSkus, setSelectedSkus] = useState<Set<number>>(new Set());
    const [warningMessage, setWarningMessage] = useState<string>('');
    const MAX_CUSTOM_SKUS = 10;

    // AI分析状态
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisReport, setAnalysisReport] = useState<string>('');
    const [predictionResults, setPredictionResults] = useState<PredictionResult[]>([]);

    // keepTime=true 时不用 JSON 里的 query_time 覆盖当前显示时间
    const loadDataFromJSON = async (keepTime = false) => {
        try {
            const response = await fetchWithAuth('/sales_analysis_matrix.json?t=' + Date.now());
            if (!response.ok) throw new Error('数据文件加载失败');
            const data: SalesData = await response.json();

            // 数据脱敏处理
            if (data.monthly_matrix) {
                data.monthly_matrix = data.monthly_matrix.map(row => ({
                    ...row,
                    product_name: row.product_name
                }));
            }
            if (data.quarterly_matrix) {
                data.quarterly_matrix = data.quarterly_matrix.map(row => ({
                    ...row,
                    product_name: row.product_name
                }));
            }

            setSalesData(data);
            if (!keepTime) {
                setLastUpdateTime(data.meta_info.query_time);
            }
        } catch (error) {
            console.error('加载数据出错:', error);
        }
    };

    const handleUpdateData = async () => {
        setIsLoading(true);
        setUpdateStatus('正在执行Python脚本获取最新数据...');
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/api/update-data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || '数据更新失败');
            }
            const result = await response.json();
            // 直接用后端返回的 query_time，如果没有则用当前本地时间
            const newTime: string = result.queryTime ||
                new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');
            setLastUpdateTime(newTime);
            setUpdateStatus('数据更新成功，正在加载...');
            await new Promise(resolve => setTimeout(resolve, 500));
            // keepTime=true: 不用 JSON 里的时间覆盖我们刚设置的新时间
            await loadDataFromJSON(true);

            setUpdateStatus('数据加载完成！');
            setTimeout(() => setUpdateStatus(''), 3000);
        } catch (error: any) {
            setUpdateStatus(`错误: ${error.message} `);
            setTimeout(() => setUpdateStatus(''), 5000);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { loadDataFromJSON(); }, []);

    const displayMonthlyData = salesData?.monthly_matrix || [];
    const displayQuarterlyData = salesData?.quarterly_matrix || [];
    const monthlyColumns = salesData?.meta_info.monthly_columns || [];
    const quarterlyColumns = salesData?.meta_info.quarterly_columns || [];

    const formatNumber = (value: number | string): string => {
        if (typeof value === 'number') {
            return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        return String(value);
    };

    const handleToggleSku = (skuId: number) => {
        setSelectedSkus(prev => {
            const newSet = new Set(prev);
            if (newSet.has(skuId)) {
                newSet.delete(skuId);
                setWarningMessage('');
            } else {
                if (newSet.size >= MAX_CUSTOM_SKUS) {
                    setWarningMessage(`最多只能选择${MAX_CUSTOM_SKUS} 个SKU，请先取消勾选其他SKU`);
                    setTimeout(() => setWarningMessage(''), 3000);
                    return prev;
                }
                newSet.add(skuId);
                setWarningMessage('');
            }
            return newSet;
        });
    };

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedSkus(new Set(displayMonthlyData.map(row => row.sku_id)));
        } else {
            setSelectedSkus(new Set());
        }
    };

    const handleModeChange = (mode: SelectionMode) => {
        setSelectionMode(mode);
        if (mode !== 'custom') setSelectedSkus(new Set());
    };

    const getAnalysisSkus = (): number[] => {
        switch (selectionMode) {
            case 'top10': return displayMonthlyData.slice(0, 10).map(row => row.sku_id);
            case 'top11-20': return displayMonthlyData.slice(10, 20).map(row => row.sku_id);
            case 'top21-30': return displayMonthlyData.slice(20, 30).map(row => row.sku_id);
            case 'custom': return Array.from(selectedSkus);
            default: return [];
        }
    };

    const isAnalysisButtonEnabled = (): boolean => {
        if (selectionMode === 'custom') return selectedSkus.size > 0;
        return true;
    };

    const handleAIAnalysis = async () => {
        if (!salesData) { setUpdateStatus('错误: 没有可用的销售数据'); return; }
        setIsAnalyzing(true);
        setAnalysisReport('');
        setUpdateStatus('正在调用AI分析...');
        try {
            const selectedSkuIds = getAnalysisSkus();
            const response = await fetchWithAuth(AI_ANALYSIS_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ selectedSkuIds, salesData })
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: '未知错误' }));
                throw new Error(`HTTP错误: ${response.status} - ${JSON.stringify(errorData)} `);
            }
            const reader = response.body?.getReader();
            if (!reader) throw new Error('无法读取响应流');
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (line.trim() === '') continue;
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.event === 'message' || data.event === 'agent_message') {
                                setAnalysisReport(prev => prev + (data.answer || ''));
                            } else if (data.event === 'message_end') {
                                parseAnalysisReport();
                                setUpdateStatus('✅ AI分析完成');
                                window.dispatchEvent(new CustomEvent('app-task-done', { detail: { appId: 'prediction' } }));
                            }
                        } catch { /* ignore */ }
                    }
                }
            }
        } catch (error) {
            setUpdateStatus(`❌ 错误: ${error instanceof Error ? error.message : '未知错误'} `);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const parseAnalysisReport = () => {
        setAnalysisReport(currentReport => {
            try {
                let jsonData = null;
                let jsonMatch = currentReport.match(/```json\s * ([\s\S] *?)```/);
                if (jsonMatch && jsonMatch[1]) {
                    jsonData = jsonMatch[1].trim();
                } else {
                    jsonMatch = currentReport.match(/```\s * ([\[{][\s\S] *? [\]}]) \s * ```/);
                    if (jsonMatch && jsonMatch[1]) jsonData = jsonMatch[1].trim();
                    else {
                        jsonMatch = currentReport.match(/\[(\s*\{[\s\S]*?\}\s*,?\s*)+\]/);
                        if (jsonMatch && jsonMatch[0]) jsonData = jsonMatch[0].trim();
                    }
                }
                if (jsonData) {
                    try {
                        const parsedData = JSON.parse(jsonData);
                        let predictions = null;
                        if (Array.isArray(parsedData)) predictions = parsedData;
                        else if (parsedData.forecast_result && Array.isArray(parsedData.forecast_result)) predictions = parsedData.forecast_result;
                        else { const arrayField = Object.values(parsedData).find(val => Array.isArray(val)); if (arrayField) predictions = arrayField as PredictionResult[]; }
                        if (predictions && Array.isArray(predictions) && predictions.length > 0) setPredictionResults(predictions);
                    } catch { /* ignore */ }
                }
                const reportPatterns = [
                    /###\s*文字版总结报告([\s\S]*?)(?:###|\*\*\*报告结束\*\*\*|\[Done\]|$)/,
                    /####\s*\*\*2\.?\s*文字版总结报告\*\*([\s\S]*?)(?:\*\*\*报告结束\*\*\*|\[Done\]|$)/,
                    /##\s*2\.?\s*文字版总结报告([\s\S]*?)(?:\*\*\*报告结束\*\*\*|\[Done\]|$)/,
                    /\*\*2\.?\s*文字版总结报告\*\*([\s\S]*?)(?:\*\*\*报告结束\*\*\*|\[Done\]|$)/,
                    /2\.?\s*[、.]\s*文字版总结报告([\s\S]*?)(?:\*\*\*报告结束\*\*\*|\[Done\]|$)/
                ];
                for (const pattern of reportPatterns) {
                    const reportMatch = currentReport.match(pattern);
                    if (reportMatch && reportMatch[1]) return reportMatch[1].trim();
                }
                return currentReport;
            } catch { return currentReport; }
        });
    };

    return (
        <div className="space-y-6 animate-fade-in pb-10">
            {/* 页面标题 */}
            <div>
                <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                    <BarChart3 className="w-6 h-6 text-blue-600" />
                    营销预测分析
                </h2>
            </div>

            {/* ===== Tab 切换栏 ===== */}
            <div className="flex gap-2 p-1.5 bg-slate-100/80 backdrop-blur-sm rounded-2xl w-fit border border-slate-200/50 shadow-inner">
                <button
                    onClick={() => setActiveTab('baseline')}
                    className={`flex items-center gap-2.5 px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 ${activeTab === 'baseline'
                        ? 'bg-gradient-to-r from-blue-600 to-indigo-500 text-white shadow-lg shadow-blue-200/50 ring-1 ring-blue-400/50'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white border border-transparent'
                        }`}
                >
                    <Calendar className={`w-4 h-4 ${activeTab === 'baseline' ? 'opacity-100' : 'opacity-70'} transition-opacity`} />
                    <span className="tracking-wide">月度基线预测</span>
                    {activeTab === 'baseline' && <span className="ml-1 w-2 h-2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)] inline-block" />}
                </button>
                <button
                    onClick={() => setActiveTab('analysis')}
                    className={`flex items-center gap-2.5 px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 ${activeTab === 'analysis'
                        ? 'bg-gradient-to-r from-purple-600 to-fuchsia-500 text-white shadow-lg shadow-purple-200/50 ring-1 ring-purple-400/50'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-white border border-transparent'
                        }`}
                >
                    <TrendingUp className={`w-4 h-4 ${activeTab === 'analysis' ? 'opacity-100' : 'opacity-70'} transition-opacity`} />
                    <span className="tracking-wide">按需深度分析</span>
                    {activeTab === 'analysis' && <span className="ml-1 w-2 h-2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)] inline-block" />}
                </button>
            </div>

            {/* ===== Tab A: 月度基线预测 ===== */}
            {activeTab === 'baseline' && (<>
                <MonthlyForecastPanel />
                <DeviationAlertPanel />
            </>)}

            {/* ===== Tab B: 按需深度分析 ===== */}
            {activeTab === 'analysis' && (<>

                {/* 提示卡片 */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
                    <svg className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <p className="text-sm text-blue-700">选择分析范围，让 AI 对指定 SKU 进行深度预测分析，输出专业报告与洞察建议。如数据已过期请先点击"更新数据"，再选择范围并开始分析。</p>
                </div>

                {/* 更新数据操作条 */}
                <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 shadow-sm px-5 py-3">
                    <div className="flex items-center gap-3">
                        <RefreshCw className="w-4 h-4 text-slate-400" />
                        <span className="text-sm text-slate-600">
                            {lastUpdateTime ? `数据最近更新：${lastUpdateTime} ` : '暂未加载数据，请点击更新'}
                        </span>
                    </div>
                    <button
                        onClick={handleUpdateData}
                        disabled={isLoading}
                        className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-medium shadow-lg shadow-blue-200 transition-all flex items-center gap-2 text-sm"
                    >
                        <RefreshCw className={`w - 4 h - 4 ${isLoading ? 'animate-spin' : ''} `} />
                        {isLoading ? '更新中...' : '更新数据'}
                    </button>
                </div>

                {/* 更新状态提示 */}
                {updateStatus && (
                    <div className={`border rounded - lg p - 4 flex items - center gap - 3 ${updateStatus.startsWith('错误') ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'} `}>
                        {updateStatus.startsWith('错误') ? <AlertCircle className="w-5 h-5 text-red-600" /> : <RefreshCw className={`w - 5 h - 5 text - blue - 600 ${isLoading ? 'animate-spin' : ''} `} />}
                        <span className={`text - sm ${updateStatus.startsWith('错误') ? 'text-red-700' : 'text-blue-700'} `}>{updateStatus}</span>
                    </div>
                )}

                {/* 月度销售额数据表 */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-md overflow-hidden">
                    <div className="bg-gradient-to-r from-slate-50 to-white px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-blue-600" />
                        <h3 className="text-sm font-bold text-slate-800">SKU 月度销售额数据</h3>
                        <span className="text-xs text-slate-500">(共 {salesData?.monthly_matrix.length || 0} 个SKU，可滚动查看)</span>
                    </div>
                    <div className="max-h-[600px] overflow-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gradient-to-r from-blue-50 to-blue-100/50 text-slate-700 sticky top-0 z-10">
                                <tr>
                                    {selectionMode === 'custom' && (
                                        <th className="px-4 py-3 text-center font-semibold border-b border-slate-200 sticky left-0 bg-blue-50 z-20">
                                            <input type="checkbox" checked={selectedSkus.size === displayMonthlyData.length && displayMonthlyData.length > 0} onChange={(e) => handleSelectAll(e.target.checked)} className="cursor-pointer" />
                                        </th>
                                    )}
                                    <th className="px-4 py-3 text-left font-semibold border-b border-slate-200 sticky left-0 bg-blue-50 z-20">SKU ID</th>
                                    <th className="px-4 py-3 text-left font-semibold border-b border-slate-200 min-w-[200px]">产品名称</th>
                                    {monthlyColumns.map((col) => (
                                        <th key={col} className="px-4 py-3 text-right font-semibold border-b border-slate-200 whitespace-nowrap">{col}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {displayMonthlyData.length > 0 ? (
                                    displayMonthlyData.map((row, idx) => (
                                        <tr key={idx} className="hover:bg-blue-50/30 transition-colors">
                                            {selectionMode === 'custom' && (
                                                <td className="px-4 py-3 text-center sticky left-0 bg-white border-r border-slate-100">
                                                    <input type="checkbox" checked={selectedSkus.has(row.sku_id)} onChange={() => handleToggleSku(row.sku_id)} className="cursor-pointer" />
                                                </td>
                                            )}
                                            <td className="px-4 py-3 font-medium text-slate-800 sticky left-0 bg-white border-r border-slate-100">{row.sku_id}</td>
                                            <td className="px-4 py-3 text-slate-700 min-w-[200px]">{maskProduct(row.product_name)}</td>
                                            {monthlyColumns.map((col) => (
                                                <td key={col} className="px-4 py-3 text-right text-slate-700 whitespace-nowrap">¥{formatNumber(row[col] as number)}</td>
                                            ))}
                                        </tr>
                                    ))
                                ) : (
                                    <tr><td colSpan={monthlyColumns.length + 2} className="px-4 py-8 text-center text-slate-400">暂无数据，请点击"更新数据"按钮从数据库加载</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* 季度销售额数据表 */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-md overflow-hidden">
                    <div className="bg-gradient-to-r from-slate-50 to-white px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-blue-600" />
                        <h3 className="text-sm font-bold text-slate-800">SKU 季度销售额数据</h3>
                        <span className="text-xs text-slate-500">(共 {salesData?.quarterly_matrix.length || 0} 个SKU，可滚动查看)</span>
                    </div>
                    <div className="max-h-[600px] overflow-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gradient-to-r from-blue-50 to-blue-100/50 text-slate-700 sticky top-0 z-10">
                                <tr>
                                    {selectionMode === 'custom' && (
                                        <th className="px-4 py-3 text-center font-semibold border-b border-slate-200 sticky left-0 bg-blue-50 z-20">
                                            <input type="checkbox" checked={selectedSkus.size === displayQuarterlyData.length && displayQuarterlyData.length > 0} onChange={(e) => handleSelectAll(e.target.checked)} className="cursor-pointer" />
                                        </th>
                                    )}
                                    <th className="px-4 py-3 text-left font-semibold border-b border-slate-200 sticky left-0 bg-blue-50 z-20">SKU ID</th>
                                    <th className="px-4 py-3 text-left font-semibold border-b border-slate-200 min-w-[200px]">产品名称</th>
                                    {quarterlyColumns.map((col) => (
                                        <th key={col} className="px-4 py-3 text-right font-semibold border-b border-slate-200 whitespace-nowrap">{col}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {displayQuarterlyData.length > 0 ? (
                                    displayQuarterlyData.map((row, idx) => (
                                        <tr key={idx} className="hover:bg-blue-50/30 transition-colors">
                                            {selectionMode === 'custom' && (
                                                <td className="px-4 py-3 text-center sticky left-0 bg-white border-r border-slate-100">
                                                    <input type="checkbox" checked={selectedSkus.has(row.sku_id)} onChange={() => handleToggleSku(row.sku_id)} className="cursor-pointer" />
                                                </td>
                                            )}
                                            <td className="px-4 py-3 font-medium text-slate-800 sticky left-0 bg-white border-r border-slate-100">{row.sku_id}</td>
                                            <td className="px-4 py-3 text-slate-700 min-w-[200px]">{maskProduct(row.product_name)}</td>
                                            {quarterlyColumns.map((col) => (
                                                <td key={col} className="px-4 py-3 text-right text-slate-700 whitespace-nowrap">¥{formatNumber(row[col] as number)}</td>
                                            ))}
                                        </tr>
                                    ))
                                ) : (
                                    <tr><td colSpan={quarterlyColumns.length + 2} className="px-4 py-8 text-center text-slate-400">暂无数据，请点击"更新数据"按钮从数据库加载</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* 数据说明框 */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-md overflow-hidden">
                    <div className="bg-gradient-to-r from-slate-50 to-white px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                        <FileText className="w-5 h-5 text-blue-600" />
                        <h3 className="text-sm font-bold text-slate-800">数据说明</h3>
                    </div>
                    <div className="p-5 text-slate-700 text-sm leading-relaxed">
                        <div className="space-y-3">
                            <div><span className="font-semibold text-slate-800">数据来源：</span>数据库实时查询(通过Python脚本)</div>
                            <div><span className="font-semibold text-slate-800">更新方式：</span>自动定时更新(每小时) + 手动按钮触发</div>
                            <div><span className="font-semibold text-slate-800">SKU筛选规则：</span>{salesData?.meta_info.sku_filter || 'Top 80% Revenue Contributors'}</div>
                            <div><span className="font-semibold text-slate-800">数值单位：</span>{salesData?.meta_info.value_unit || '销售额 (CNY)'}</div>
                            <div><span className="font-semibold text-slate-800">月度数据范围：</span>过去13个月的销售数据</div>
                            <div><span className="font-semibold text-slate-800">季度数据范围：</span>过去5个季度的销售数据</div>
                            <div className="pt-2 border-t border-slate-200">
                                <p className="text-xs text-slate-500">💡 提示：勾选自定义模式后，可在月度表或季度表中勾选要分析的 SKU（最多10个），再点击"开始AI分析"。</p>
                                <p className="text-xs text-slate-500 mt-1">🕐 后端服务器已配置每小时定时自动更新数据。</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* SKU选择范围 */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-md p-5">
                    <h4 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
                        <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                        选择分析范围
                        {selectionMode === 'custom' && selectedSkus.size > 0 && (
                            <span className="ml-2 px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">已选 {selectedSkus.size} 个SKU</span>
                        )}
                    </h4>
                    <div className="flex flex-wrap gap-3">
                        {(['top10', 'top11-20', 'top21-30', 'custom'] as SelectionMode[]).map((mode) => (
                            <label key={mode} className="flex items-center gap-2 cursor-pointer group">
                                <input type="radio" name="sku-selection" value={mode} checked={selectionMode === mode} onChange={() => handleModeChange(mode)} className="w-4 h-4 text-purple-600 focus:ring-purple-500 cursor-pointer" />
                                <span className="text-sm text-slate-700 group-hover:text-purple-700 transition-colors">
                                    {mode === 'top10' ? '销售额前10名' : mode === 'top11-20' ? '销售额11-20名' : mode === 'top21-30' ? '销售额21-30名' : '自定义选择'}
                                </span>
                            </label>
                        ))}
                    </div>
                    {selectionMode === 'custom' && (
                        <div className="mt-3 p-3 bg-purple-50 rounded-lg border border-purple-100">
                            <p className="text-xs text-purple-700 flex items-start gap-2">
                                <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>
                                <span>请在上方月度表或季度表中勾选要分析的SKU（两个表格勾选联动，最多10个）</span>
                            </p>
                        </div>
                    )}
                    {warningMessage && (
                        <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-200 animate-fade-in">
                            <p className="text-xs text-red-700 flex items-center gap-2">
                                <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                                {warningMessage}
                            </p>
                        </div>
                    )}
                </div>

                {/* AI智能分析按钮 */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-md overflow-hidden">
                    <div className="bg-gradient-to-r from-purple-50 to-purple-100/50 px-5 py-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                </svg>
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-slate-800">AI智能预测分析</h3>
                                <p className="text-xs text-slate-500 mt-0.5">基于历史数据，智能预测未来销售趋势</p>
                            </div>
                        </div>
                        <button
                            onClick={handleAIAnalysis}
                            disabled={!isAnalysisButtonEnabled() || isAnalyzing}
                            className={`px-8 py-3 rounded-xl font-bold text-sm shadow-xl transition-all duration-300 flex items-center gap-2.5 group ${isAnalysisButtonEnabled() && !isAnalyzing ? 'bg-gradient-to-r from-purple-500 via-fuchsia-500 to-purple-600 hover:from-purple-600 hover:via-fuchsia-600 hover:to-purple-700 text-white shadow-purple-300/50 hover:shadow-purple-400/60 hover:-translate-y-0.5 cursor-pointer border border-purple-400/30 ring-2 ring-transparent hover:ring-purple-300/50' : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300 shadow-none'} `}
                        >
                            <svg className={`w-5 h-5 ${isAnalyzing ? 'animate-spin' : 'group-hover:animate-pulse group-hover:scale-110 transition-transform'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                {isAnalyzing ? (
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                ) : (
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                )}
                            </svg>
                            <span className="tracking-wide text-[15px]">{isAnalyzing ? '深度诊断中...' : '开始 AI 智能预测'}</span>
                        </button>
                    </div>
                </div>

                {/* AI预测结果表格 */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-md overflow-hidden">
                    <div className="bg-gradient-to-r from-slate-50 to-white px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                        <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                        <h3 className="text-sm font-bold text-slate-800">SKU级AI预测结果</h3>
                        <span className="text-xs text-slate-400">{predictionResults.length > 0 ? `(共${predictionResults.length}条)` : '(待分析)'}</span>
                    </div>
                    <div className="max-h-[500px] overflow-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gradient-to-r from-purple-50 to-purple-100/50 text-slate-700 sticky top-0 z-10">
                                <tr>
                                    <th className="px-4 py-3 text-left font-semibold border-b border-purple-200 sticky left-0 bg-purple-50 z-20">SKU ID</th>
                                    <th className="px-4 py-3 text-left font-semibold border-b border-purple-200 min-w-[200px]">产品名称</th>
                                    <th className="px-4 py-3 text-right font-semibold border-b border-purple-200 whitespace-nowrap">当月预测销售额</th>
                                    <th className="px-4 py-3 text-right font-semibold border-b border-purple-200 whitespace-nowrap">下月预测销售额</th>
                                    <th className="px-4 py-3 text-right font-semibold border-b border-purple-200 whitespace-nowrap">月度环比</th>
                                    <th className="px-4 py-3 text-right font-semibold border-b border-purple-200 whitespace-nowrap">当季预测销售额</th>
                                    <th className="px-4 py-3 text-right font-semibold border-b border-purple-200 whitespace-nowrap">下季预测销售额</th>
                                    <th className="px-4 py-3 text-right font-semibold border-b border-purple-200 whitespace-nowrap">季度环比</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {predictionResults.length > 0 ? (
                                    predictionResults.map((prediction: PredictionResult) => {
                                        const skuInfo = salesData?.monthly_matrix.find((row: MonthlyDataRow) => row.sku_id === prediction.sku_id);
                                        const productName = maskProduct(skuInfo?.product_name || '未知产品');

                                        // 防止字段为 undefined/null 导致崩溃
                                        const curMonth = prediction.current_month_forecast ?? 0;
                                        const nextMonth = prediction.next_month_forecast ?? 0;
                                        const curQtr = prediction.current_quarter_forecast ?? 0;
                                        const nextQtr = prediction.next_quarter_forecast ?? 0;

                                        const monthChange = curMonth !== 0 ? ((nextMonth - curMonth) / curMonth * 100).toFixed(2) : '0.00';
                                        const quarterChange = curQtr !== 0 ? ((nextQtr - curQtr) / curQtr * 100).toFixed(2) : '0.00';

                                        const fmt = (v: number) => v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                                        return (
                                            <tr key={prediction.sku_id} className="hover:bg-purple-50/30 transition-colors">
                                                <td className="px-4 py-3 font-medium text-slate-800 sticky left-0 bg-white border-r border-slate-100">{prediction.sku_id}</td>
                                                <td className="px-4 py-3 text-slate-700">{productName}</td>
                                                <td className="px-4 py-3 text-right text-slate-800">¥{fmt(curMonth)}</td>
                                                <td className="px-4 py-3 text-right text-slate-800">¥{fmt(nextMonth)}</td>
                                                <td className={`px - 4 py - 3 text - right font - medium ${parseFloat(monthChange) >= 0 ? 'text-green-600' : 'text-red-600'} `}>{parseFloat(monthChange) >= 0 ? '+' : ''}{monthChange}%</td>
                                                <td className="px-4 py-3 text-right text-slate-800">¥{fmt(curQtr)}</td>
                                                <td className="px-4 py-3 text-right text-slate-800">¥{fmt(nextQtr)}</td>
                                                <td className={`px - 4 py - 3 text - right font - medium ${parseFloat(quarterChange) >= 0 ? 'text-green-600' : 'text-red-600'} `}>{parseFloat(quarterChange) >= 0 ? '+' : ''}{quarterChange}%</td>
                                            </tr>
                                        );
                                    })
                                ) : (
                                    <tr>
                                        <td colSpan={9} className="px-4 py-12 text-center">
                                            <div className="flex flex-col items-center gap-3 text-slate-400">
                                                <svg className="w-12 h-12 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                                                <p className="text-sm">暂无预测数据</p>
                                                <p className="text-xs">点击上方"开始AI分析"按钮生成SKU级预测结果</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="p-5 bg-slate-50 border-t border-slate-200">
                        <div className="flex items-start gap-2 text-xs text-purple-700">
                            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>
                            <span>AI将对每个SKU分别进行月度和季度销售额预测，包含当前周期和下一周期的预测值及环比变化趋势</span>
                        </div>
                    </div>
                </div>

                {/* AI分析报告文本框 */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-md overflow-hidden">
                    <div className="bg-gradient-to-r from-slate-50 to-white px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                        <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <h3 className="text-sm font-bold text-slate-800">AI分析报告</h3>
                    </div>
                    <div className="p-5">
                        <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 min-h-[200px] max-h-[400px] overflow-y-auto w-full">
                            {analysisReport ? (
                                <div className="text-sm text-slate-700 leading-relaxed">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        rehypePlugins={[rehypeRaw]}
                                        components={{
                                            h1: ({ children }) => <h1 className="text-base font-bold text-slate-800 mb-2 mt-4">{children}</h1>,
                                            h2: ({ children }) => <h2 className="text-sm font-bold text-slate-800 mb-2 mt-3 border-b border-slate-200 pb-1">{children}</h2>,
                                            h3: ({ children }) => <h3 className="text-sm font-semibold text-slate-700 mb-1.5 mt-2">{children}</h3>,
                                            p: ({ children }) => <p className="mb-2 text-slate-700 leading-relaxed">{children}</p>,
                                            ul: ({ children }) => <ul className="mb-2 space-y-1 pl-4">{children}</ul>,
                                            ol: ({ children }) => <ol className="mb-2 space-y-1 pl-4 list-decimal">{children}</ol>,
                                            li: ({ children }) => <li className="text-slate-700 list-disc list-outside">{children}</li>,
                                            strong: ({ children }) => <strong className="font-semibold text-slate-800">{children}</strong>,
                                            table: ({ children }) => (
                                                <div className="overflow-x-auto my-3 rounded-lg border border-slate-200 shadow-sm">
                                                    <table className="w-full text-xs border-collapse">{children}</table>
                                                </div>
                                            ),
                                            thead: ({ children }) => <thead className="bg-slate-100">{children}</thead>,
                                            tbody: ({ children }) => <tbody className="divide-y divide-slate-100">{children}</tbody>,
                                            tr: ({ children }) => <tr className="hover:bg-indigo-50/30 transition-colors">{children}</tr>,
                                            th: ({ children }) => <th className="px-3 py-2 text-left font-semibold text-slate-700 border-b border-slate-200 whitespace-nowrap">{children}</th>,
                                            td: ({ children }) => <td className="px-3 py-2 text-slate-600 border-r border-slate-100 last:border-0">{children}</td>,
                                            blockquote: ({ children }) => <blockquote className="border-l-4 border-indigo-300 pl-3 my-2 text-slate-600 italic">{children}</blockquote>,
                                            hr: () => <hr className="my-3 border-slate-200" />,
                                            code: ({ children }) => <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono text-purple-700">{children}</code>,
                                        }}
                                    >
                                        {analysisReport}
                                    </ReactMarkdown>
                                </div>
                            ) : (
                                <div className="text-slate-400 text-sm italic flex items-center justify-center h-[180px] flex-col gap-3">
                                    <svg className="w-16 h-16 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                    <p>暂无分析报告</p>
                                    <p className="text-xs">点击"开始AI分析"生成详细的分析报告</p>
                                </div>
                            )}
                        </div>
                        <div className="mt-3 flex items-start gap-2 text-xs text-slate-500">
                            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>
                            <span>AI将综合分析历史销售数据、市场趋势和季节性因素，生成专业的预测分析报告，包含关键洞察和业务建议。</span>
                        </div>
                    </div>
                </div>

            </>)}

        </div>
    );
};
