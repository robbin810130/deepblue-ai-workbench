import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import {
    TrendingUp, RefreshCw, AlertCircle, Search,
    Clock, Send, Sparkles, ChevronRight, Info, Layers,
    Grid, DollarSign, ShoppingBag, Percent, ArrowUpDown, CheckCircle
} from 'lucide-react';
import { fetchWithAuth } from '../utils/authFetch';
import { API_BASE_URL } from '../config';
import { useBrandMask } from '../utils/demoMask';

// ======================== 类型定义 ========================

interface MetaInfo {
    query_time: string;
    sku_filter: string;
    volume_unit: string;
    revenue_unit: string;
    monthly_columns: string[];
    quarterly_columns: string[];
}

interface CategoryBreakdown {
    category: string;
    volume: number;
    revenue: number;
    vol_percentage: number;
    rev_percentage: number;
}

interface SkuRow {
    sku_id: string;
    product_name: string;
    product_group: string;
    gross_margin: number;
    avg_price: number;
    total_qty?: number;
    total_revenue?: number;
    [key: string]: string | number | undefined; // 动态月份/季度字段
}

interface MarketingAnalysisData {
    monthly_volume_matrix: SkuRow[];
    monthly_revenue_matrix: SkuRow[];
    quarterly_volume_matrix: SkuRow[];
    quarterly_revenue_matrix: SkuRow[];
    category_breakdown: CategoryBreakdown[];
    meta_info: MetaInfo;
}

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    id: string;
}

export default function MarketingAnalysisModule() {
    const { maskProduct } = useBrandMask();

    // 数据状态
    const [data, setData] = useState<MarketingAnalysisData | null>(null);
    const [loadingData, setLoadingData] = useState(true);
    const [errorData, setErrorData] = useState<string | null>(null);

    // 更新任务状态
    const [updateStatus, setUpdateStatus] = useState({
        isRunning: false,
        status: 'idle',
        message: '',
        lastUpdate: ''
    });

    // 交互状态
    const [timeDimension, setTimeDimension] = useState<'monthly' | 'quarterly'>('monthly');
    const [dataType, setDataType] = useState<'qty' | 'amount'>('qty');
    const [skuFilterType, setSkuFilterType] = useState<'top10' | 'top11-20' | 'top21-30' | 'custom'>('top10');
    const [selectedSkuIds, setSelectedSkuIds] = useState<string[]>([]);
    const [skuSearch, setSkuSearch] = useState('');

    // 品名列列宽手动调整状态与事件监听
    const [prodNameWidth, setProdNameWidth] = useState(192);
    const resizingRef = useRef<{ startX: number; startWidth: number } | null>(null);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!resizingRef.current) return;
        const deltaX = e.clientX - resizingRef.current.startX;
        const newWidth = Math.max(120, Math.min(500, resizingRef.current.startWidth + deltaX));
        setProdNameWidth(newWidth);
    }, []);

    const handleMouseUp = useCallback(() => {
        resizingRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    }, [handleMouseMove]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        resizingRef.current = {
            startX: e.clientX,
            startWidth: prodNameWidth,
        };
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [prodNameWidth, handleMouseMove, handleMouseUp]);

    useEffect(() => {
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [handleMouseMove, handleMouseUp]);

    // 排序状态
    const [sortKey, setSortKey] = useState<string>('total');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

    // 图表悬浮状态
    const [hoveredPoint, setHoveredPoint] = useState<{
        skuId: string;
        productName: string;
        col: string;
        val: number;
        price: number;
        margin: number;
        x: number;
        y: number;
    } | null>(null);

    // AI对话状态
    const [messages, setMessages] = useState<ChatMessage[]>([
        {
            role: 'assistant',
            content: `你好！我是您的 **AI 营销分析助手**。
我已连接到 SQL Server 数据库 \`HLFGDERPzs260117\`。您可以向我提问关于近一年来月度/季度销量趋势、各品类毛利变化，以及大单销售波动等方面的问题。
            
**您可以点击下方的快捷分析指令，快速开启诊断：**`,
            id: 'welcome'
        }
    ]);
    const [userInput, setUserInput] = useState('');
    const [sendingChat, setSendingChat] = useState(false);
    const [chatError, setChatError] = useState<string | null>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);

    // ======================== API 调用 ========================

    // 1. 加载本地分析数据
    const loadAnalysisData = async () => {
        setLoadingData(true);
        setErrorData(null);
        try {
            // 从 public 目录读取静态JSON
            const res = await fetch(`${API_BASE_URL}/marketing_analysis_data.json?t=${Date.now()}`);
            if (!res.ok) {
                throw new Error('未在 public 目录中找到营销分析数据。请先点击右上角的“更新数据”按钮从数据库进行初次提取。');
            }
            const jsonData = await res.json();
            setData(jsonData);

            // 默认勾选前 3 个 SKU 进行图表展示
            const matrix = timeDimension === 'monthly'
                ? (dataType === 'qty' ? jsonData.monthly_volume_matrix : jsonData.monthly_revenue_matrix)
                : (dataType === 'qty' ? jsonData.quarterly_volume_matrix : jsonData.quarterly_revenue_matrix);
            if (matrix && matrix.length > 0) {
                setSelectedSkuIds(matrix.slice(0, 3).map((item: any) => item.sku_id));
            }
        } catch (e: any) {
            console.error(e);
            setErrorData(e.message || '加载分析数据失败');
        } finally {
            setLoadingData(false);
        }
    };

    // 2. 获取更新状态
    const checkUpdateStatus = async () => {
        try {
            const res = await fetchWithAuth('/api/marketing-analysis/status');
            if (res.ok) {
                const statusInfo = await res.json();
                setUpdateStatus(statusInfo);
                if (statusInfo.isRunning) {
                    // 如果正在运行，每3秒轮询一次
                    setTimeout(checkUpdateStatus, 3000);
                }
            }
        } catch (e) {
            console.error('获取更新状态失败:', e);
        }
    };

    // 3. 触发数据库重新拉取数据
    const handleTriggerUpdate = async () => {
        if (updateStatus.isRunning) return;

        setUpdateStatus(prev => ({
            ...prev,
            isRunning: true,
            status: 'running',
            message: '开始调度数据库提取任务...'
        }));

        try {
            const res = await fetchWithAuth('/api/marketing-analysis/update-data', {
                method: 'POST'
            });
            const resData = await res.json();
            if (res.ok && resData.success) {
                setUpdateStatus({
                    isRunning: false,
                    status: 'success',
                    message: resData.message || '数据更新成功！',
                    lastUpdate: resData.timestamp || new Date().toISOString()
                });
                // 重新加载最新JSON数据
                loadAnalysisData();
            } else {
                throw new Error(resData.error || '执行更新失败');
            }
        } catch (e: any) {
            setUpdateStatus({
                isRunning: false,
                status: 'error',
                message: `更新失败: ${e.message}`,
                lastUpdate: ''
            });
        }
    };

    useEffect(() => {
        loadAnalysisData();
        checkUpdateStatus();
    }, []);

    // 监听数据维度变化，重新设置默认勾选SKU
    useEffect(() => {
        if (data) {
            const matrix = timeDimension === 'monthly'
                ? (dataType === 'qty' ? data.monthly_volume_matrix : data.monthly_revenue_matrix)
                : (dataType === 'qty' ? data.quarterly_volume_matrix : data.quarterly_revenue_matrix);
            if (matrix && matrix.length > 0) {
                // 如果当前没有勾选，或者勾选的 SKU 不存在于新的列表中，则重置默认勾选前3个
                const availableIds = matrix.map(item => item.sku_id);
                const stillValid = selectedSkuIds.filter(id => availableIds.includes(id));
                if (stillValid.length === 0) {
                    setSelectedSkuIds(matrix.slice(0, 3).map(item => item.sku_id));
                }
            }
        }
    }, [timeDimension, dataType, data]);

    // 自动滚动聊天到底部
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // ======================== 数据过滤与分析 ========================

    const timeColumns = useMemo(() => {
        if (!data?.meta_info) return [];
        return timeDimension === 'monthly'
            ? data.meta_info.monthly_columns
            : data.meta_info.quarterly_columns;
    }, [data, timeDimension]);

    const activeMatrix = useMemo(() => {
        if (!data) return [];
        if (timeDimension === 'monthly') {
            return dataType === 'qty' ? data.monthly_volume_matrix : data.monthly_revenue_matrix;
        } else {
            return dataType === 'qty' ? data.quarterly_volume_matrix : data.quarterly_revenue_matrix;
        }
    }, [data, timeDimension, dataType]);

    // 针对表格进行检索、筛选、排序
    const processedSkus = useMemo(() => {
        let items = [...activeMatrix];

        // 1. 搜索过滤
        if (skuSearch.trim()) {
            const q = skuSearch.trim().toLowerCase();
            items = items.filter(item =>
                item.sku_id.toLowerCase().includes(q) ||
                item.product_name.toLowerCase().includes(q)
            );
        }

        // 2. SKU 快速范围筛选
        if (skuFilterType === 'top10') {
            items = items.slice(0, 10);
        } else if (skuFilterType === 'top11-20') {
            items = items.slice(10, 20);
        } else if (skuFilterType === 'top21-30') {
            items = items.slice(20, 30);
        } // 'custom' 不截断，展示所有

        // 3. 排序处理
        items.sort((a, b) => {
            let valA: number = 0;
            let valB: number = 0;

            if (sortKey === 'total') {
                valA = (dataType === 'qty' ? a.total_qty : a.total_revenue) || 0;
                valB = (dataType === 'qty' ? b.total_qty : b.total_revenue) || 0;
            } else if (sortKey === 'gross_margin' || sortKey === 'avg_price') {
                valA = (a[sortKey] as number) || 0;
                valB = (b[sortKey] as number) || 0;
            } else {
                // 动态月份/季度列排序
                valA = (a[sortKey] as number) || 0;
                valB = (b[sortKey] as number) || 0;
            }

            if (sortDirection === 'asc') return valA - valB;
            return valB - valA;
        });

        return items;
    }, [activeMatrix, skuSearch, skuFilterType, sortKey, sortDirection, dataType]);

    // 图表绘制所需 SKU 数据（只绘制被勾选的 SKU，最多支持绘制 6 条，防止凌乱）
    const skusToPlot = useMemo(() => {
        return activeMatrix.filter(item => selectedSkuIds.includes(item.sku_id)).slice(0, 6);
    }, [activeMatrix, selectedSkuIds]);

    // KPI 汇总卡片计算
    const kpiSummary = useMemo(() => {
        if (!data || !data.monthly_volume_matrix || !data.monthly_revenue_matrix) {
            return { totalQty: 0, totalRevenue: 0, avgPrice: 0, avgMargin: 0 };
        }
        // 近一年总销量
        const totalQty = data.monthly_volume_matrix.reduce((sum, item) => sum + (item.total_qty || 0), 0);
        // 近一年总销售额
        const totalRevenue = data.monthly_revenue_matrix.reduce((sum, item) => sum + (item.total_revenue || 0), 0);
        // 综合平均单价
        const avgPrice = totalQty > 0 ? totalRevenue / totalQty : 0;
        // 综合加权平均毛利率
        let totalProfit = 0;
        data.monthly_revenue_matrix.forEach(revItem => {
            const volItem = data.monthly_volume_matrix.find(v => v.sku_id === revItem.sku_id);
            if (volItem) {
                const margin = revItem.gross_margin || 0;
                const rev = revItem.total_revenue || 0;
                totalProfit += rev * margin;
            }
        });
        const avgMargin = totalRevenue > 0 ? totalProfit / totalRevenue : 0;

        return { totalQty, totalRevenue, avgPrice, avgMargin };
    }, [data]);

    // ======================== SVG 折线图参数计算 ========================

    const chartConfig = useMemo(() => {
        const width = 800;
        const height = 280;
        const paddingLeft = 60;
        const paddingRight = 30;
        const paddingTop = 20;
        const paddingBottom = 40;

        if (skusToPlot.length === 0 || timeColumns.length === 0) {
            return {
                width,
                height,
                paddingLeft,
                paddingRight,
                paddingTop,
                paddingBottom,
                linesData: [],
                yTicks: [],
                xTicks: [],
                roundedMax: 100
            };
        }

        // 查找全剧最大值
        let maxVal = 0;
        skusToPlot.forEach(sku => {
            timeColumns.forEach(col => {
                const val = (sku[col] as number) || 0;
                if (val > maxVal) maxVal = val;
            });
        });
        if (maxVal === 0) maxVal = 100;
        // 向上取整到合适的值
        const order = Math.pow(10, Math.floor(Math.log10(maxVal)));
        const roundedMax = Math.ceil(maxVal / (order / 2)) * (order / 2);

        const xStep = (width - paddingLeft - paddingRight) / (timeColumns.length - 1 || 1);

        // 生成 Y 轴刻度 (5 等分)
        const yTicks = Array.from({ length: 5 }, (_, i) => (roundedMax * i) / 4);

        // 生成各条线的坐标点
        const linesData = skusToPlot.map((sku, lineIdx) => {
            const coords = timeColumns.map((col, colIdx) => {
                const val = (sku[col] as number) || 0;
                const x = paddingLeft + colIdx * xStep;
                const y = height - paddingBottom - (val / roundedMax) * (height - paddingTop - paddingBottom);
                return { x, y, val, col, skuId: sku.sku_id, productName: maskProduct(sku.product_name), price: sku.avg_price, margin: sku.gross_margin };
            });

            // 拼装 SVG Path 路径
            let pathString = '';
            coords.forEach((p, idx) => {
                if (idx === 0) pathString += `M ${p.x} ${p.y}`;
                else pathString += ` L ${p.x} ${p.y}`;
            });

            return {
                skuId: sku.sku_id,
                productName: maskProduct(sku.product_name),
                path: pathString,
                coords,
                color: getLineColor(lineIdx)
            };
        });

        // X 轴刻度
        const xTicks = timeColumns.map((col, colIdx) => ({
            x: paddingLeft + colIdx * xStep,
            label: col
        }));

        return {
            width,
            height,
            paddingLeft,
            paddingRight,
            paddingTop,
            paddingBottom,
            linesData,
            yTicks,
            xTicks,
            roundedMax
        };
    }, [skusToPlot, timeColumns]);

    // 莫兰迪/高对比度渐变线条配色
    function getLineColor(idx: number) {
        const colors = [
            '#6366f1', // Indigo
            '#ec4899', // Pink
            '#10b981', // Emerald
            '#f59e0b', // Amber
            '#3b82f6', // Blue
            '#8b5cf6'  // Purple
        ];
        return colors[idx % colors.length];
    }

    const handleChartMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        if (!chartConfig.linesData || chartConfig.linesData.length === 0) return;
        const svg = e.currentTarget;
        const rect = svg.getBoundingClientRect();
        const clientX = e.clientX - rect.left;
        const clientY = e.clientY - rect.top;

        // 寻找距离鼠标 X 坐标最近的时间点索引
        let closestXIdx = 0;
        let minDiff = Infinity;
        chartConfig.xTicks.forEach((tick, idx) => {
            const diff = Math.abs(tick.x - clientX);
            if (diff < minDiff) {
                minDiff = diff;
                closestXIdx = idx;
            }
        });

        // 在该时间点索引上，寻找距离鼠标 Y 坐标最近的折线
        let closestLineIdx = 0;
        let minHeightDiff = Infinity;
        chartConfig.linesData.forEach((line, idx) => {
            const coord = line.coords[closestXIdx];
            if (coord) {
                const diff = Math.abs(coord.y - clientY);
                if (diff < minHeightDiff) {
                    minHeightDiff = diff;
                    closestLineIdx = idx;
                }
            }
        });

        // 获得最贴近的数据点
        const targetLine = chartConfig.linesData[closestLineIdx];
        const targetPoint = targetLine.coords[closestXIdx];

        if (targetPoint && minDiff < 40 && minHeightDiff < 40) {
            setHoveredPoint({
                skuId: targetPoint.skuId,
                productName: targetPoint.productName,
                col: targetPoint.col,
                val: targetPoint.val,
                price: targetPoint.price,
                margin: targetPoint.margin,
                x: targetPoint.x,
                y: targetPoint.y
            });
        } else {
            setHoveredPoint(null);
        }
    };

    // ======================== SVG Donut 环形图参数计算 ========================

    const donutSegments = useMemo(() => {
        if (!data?.category_breakdown) return [];
        const breakdown = data.category_breakdown;
        let cumulativePercent = 0;
        const radius = 60;
        const circumference = 2 * Math.PI * radius; // 约 376.99

        return breakdown.map((cat, idx) => {
            const percentage = dataType === 'qty' ? cat.vol_percentage : cat.rev_percentage;
            const strokeDasharray = `${(percentage / 100) * circumference} ${circumference}`;
            const strokeDashoffset = `${-((cumulativePercent / 100) * circumference)}`;

            cumulativePercent += percentage;

            const strokeColor = idx === 0 ? '#6366f1' : (idx === 1 ? '#ec4899' : '#14b8a6');

            return {
                category: cat.category,
                percentage,
                strokeColor,
                strokeDasharray,
                strokeDashoffset,
                value: dataType === 'qty' ? cat.volume : cat.revenue
            };
        });
    }, [data, dataType]);

    // ======================== AI 对话与流式 API ========================

    const handleSendChat = async (directText?: string) => {
        const textToSend = directText || userInput;
        if (!textToSend.trim() || sendingChat) return;

        setUserInput('');
        setChatError(null);
        setSendingChat(true);

        const userMsgId = 'msg-' + Date.now();
        const assistantMsgId = 'msg-' + (Date.now() + 1);

        // 1. 追加用户消息
        setMessages(prev => [
            ...prev,
            { role: 'user', content: textToSend, id: userMsgId }
        ]);

        // 2. 预备一个空的助手消息，等待流式填入
        setMessages(prev => [
            ...prev,
            { role: 'assistant', content: '', id: assistantMsgId }
        ]);

        try {
            const response = await fetchWithAuth('/api/marketing-analysis/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: textToSend,
                    inputs: {
                        current_date: new Date().toISOString().split('T')[0],
                        data_summary: JSON.stringify(data?.category_breakdown || [])
                    },
                    response_mode: 'streaming'
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`请求分析助手失败: ${response.status} ${errText}`);
            }

            // D4 试点迁移：任务中心模式返回完整 JSON（弃流式）；旧直连模式仍为 SSE
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const j = await response.json();
                if (j.success === false) throw new Error(j.message || '任务执行失败');
                const fullText = String(j.data ?? '');
                setMessages(prev => prev.map(msg =>
                    msg.id === assistantMsgId ? { ...msg, content: fullText } : msg
                ));
                return;
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error('流式读取通道未准备就绪');

            const decoder = new TextDecoder();
            let accumulatedContent = '';
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // 最后一个可能不完整，放回buffer

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data:')) continue;

                    const jsonStr = trimmed.slice(5).trim();
                    if (jsonStr === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(jsonStr);
                        if (parsed.event === 'message' && parsed.answer) {
                            accumulatedContent += parsed.answer;
                            // 动态修改最新一条助手消息的内容
                            setMessages(prev => prev.map(msg =>
                                msg.id === assistantMsgId ? { ...msg, content: accumulatedContent } : msg
                            ));
                        } else if (parsed.event === 'error') {
                            setChatError(parsed.message || 'Dify 引擎返回错误');
                        }
                    } catch (e) {
                        // 忽略非JSON消息
                    }
                }
            }

        } catch (err: any) {
            console.error('Chat error:', err);
            setChatError(err.message || '网络连接失败，请稍后重试');
            // 填充错误提示到聊天框
            setMessages(prev => prev.map(msg =>
                msg.id === assistantMsgId
                    ? { ...msg, content: `❌ **请求失败**：${err.message || '网络连接异常'}` }
                    : msg
            ));
        } finally {
            setSendingChat(false);
        }
    };

    // ======================== 表格多选逻辑 ========================

    const handleToggleSku = (skuId: string) => {
        setSelectedSkuIds(prev =>
            prev.includes(skuId)
                ? prev.filter(id => id !== skuId)
                : [...prev, skuId]
        );
    };

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) {
            setSelectedSkuIds(processedSkus.map(item => item.sku_id));
        } else {
            setSelectedSkuIds([]);
        }
    };

    // 快捷指令
    const promptShortcuts = [
        { label: '📊 诊断销量异常波动', prompt: '根据当前 HLFGDERPzs260117 数据库中的近一年月度销售数据，分析并诊断哪些品类或 SKU 出现了较为异常的销量波动，可能原因是什么？' },
        { label: '💰 大单流失及毛利分析', prompt: '请帮我推演和分析：为什么奶酪和果冻品类的综合毛利率会出现起伏？对于毛利率较低的重点SKU，应如何调整售价或控制物料成本？' },
        { label: '🚀 SKU 尾部淘汰推演', prompt: '根据 Top 80% 的销量贡献规则，分析哪些 SKU 属于销量贡献极低的尾部产品？是否建议进行结构性淘汰或缩减品类？' }
    ];

    return (
        <div className="flex flex-col h-full w-full bg-slate-900/95 text-slate-100 rounded-xl overflow-hidden shadow-2xl border border-slate-700/60 backdrop-blur-xl">
            {/* 顶部控制与模块标题栏 */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between px-6 py-4 border-b border-slate-700/80 bg-slate-950/60 shrink-0 gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-gradient-to-br from-indigo-500 to-fuchsia-600 rounded-xl shadow-lg shadow-indigo-500/20">
                        <TrendingUp className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-bold text-white tracking-wide">营销分析系统</h2>
                        </div>
                        <p className="text-xs text-slate-400">提取主力销售品类(奶酪/果冻)的月度与季度销量矩阵，对接 AI 智能决策工作流</p>
                    </div>
                </div>

                {/* 刷新及同步提示 */}
                <div className="flex items-center gap-3 self-stretch md:self-auto justify-end">
                    {data?.meta_info?.query_time && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-400">
                            <Clock className="w-3.5 h-3.5 text-indigo-400" />
                            <span>上次同步: {data.meta_info.query_time}</span>
                        </div>
                    )}
                    <button
                        onClick={handleTriggerUpdate}
                        disabled={updateStatus.isRunning}
                        className={`flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 disabled:from-slate-800 disabled:to-slate-800 text-white text-xs font-semibold rounded-lg shadow-md transition-all ${updateStatus.isRunning ? 'cursor-not-allowed opacity-60' : 'hover:scale-[1.02]'
                            }`}
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${updateStatus.isRunning ? 'animate-spin' : ''}`} />
                        {updateStatus.isRunning ? '同步提取中...' : '更新分析数据'}
                    </button>
                </div>
            </div>

            {/* 执行提示浮窗 */}
            {updateStatus.message && (
                <div className={`px-6 py-2.5 text-xs border-b transition-all flex items-center gap-2 ${updateStatus.status === 'success' ? 'bg-emerald-950/40 border-emerald-800/40 text-emerald-300' :
                    updateStatus.status === 'running' ? 'bg-indigo-950/40 border-indigo-800/40 text-indigo-300' :
                        'bg-rose-950/40 border-rose-800/40 text-rose-300'
                    }`}>
                    {updateStatus.status === 'success' ? <CheckCircle className="w-4 h-4 shrink-0" /> : <Info className="w-4 h-4 shrink-0" />}
                    <span>{updateStatus.message}</span>
                </div>
            )}

            {/* 错误提示浮窗 */}
            {errorData && (
                <div className="px-6 py-2.5 text-xs border-b bg-rose-950/40 border-rose-800/40 text-rose-300 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{errorData}</span>
                </div>
            )}

            {/* 主工作区 */}
            <div className="flex flex-1 min-h-0 overflow-hidden">

                {/* 左侧 65% 数据与图表区 */}
                <div className="w-[65%] flex flex-col min-h-0 overflow-y-auto border-r border-slate-700/60 p-5 gap-5 custom-scrollbar">

                    {/* 1. 核心 KPI 汇总卡片组 */}
                    {loadingData ? (
                        <div className="grid grid-cols-4 gap-4 animate-pulse">
                            {[1, 2, 3, 4].map(i => (
                                <div key={i} className="h-20 bg-slate-800/60 rounded-xl border border-slate-700/40"></div>
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            {/* KPI 1 */}
                            <div className="relative overflow-hidden bg-slate-800/40 border border-slate-700/60 rounded-xl p-4 flex items-center gap-4 hover:border-indigo-500/40 transition-colors">
                                <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-lg">
                                    <ShoppingBag className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400">近一年总销量</p>
                                    <p className="text-lg font-bold text-white mt-1">
                                        {kpiSummary.totalQty.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                        <span className="text-xs text-slate-400 font-normal ml-1">箱</span>
                                    </p>
                                </div>
                                <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full translate-x-8 -translate-y-8 pointer-events-none"></div>
                            </div>

                            {/* KPI 2 */}
                            <div className="relative overflow-hidden bg-slate-800/40 border border-slate-700/60 rounded-xl p-4 flex items-center gap-4 hover:border-fuchsia-500/40 transition-colors">
                                <div className="p-3 bg-fuchsia-500/10 text-fuchsia-400 rounded-lg">
                                    <DollarSign className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400">近一年总销售额</p>
                                    <p className="text-lg font-bold text-white mt-1">
                                        ¥{(kpiSummary.totalRevenue / 10000).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                                        <span className="text-xs text-slate-400 font-normal ml-1">万</span>
                                    </p>
                                </div>
                                <div className="absolute top-0 right-0 w-24 h-24 bg-fuchsia-500/5 rounded-full translate-x-8 -translate-y-8 pointer-events-none"></div>
                            </div>

                            {/* KPI 3 */}
                            <div className="relative overflow-hidden bg-slate-800/40 border border-slate-700/60 rounded-xl p-4 flex items-center gap-4 hover:border-emerald-500/40 transition-colors">
                                <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-lg">
                                    <TrendingUp className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400">综合平均单价</p>
                                    <p className="text-lg font-bold text-white mt-1">
                                        ¥{kpiSummary.avgPrice.toFixed(2)}
                                        <span className="text-xs text-slate-400 font-normal ml-1">/箱</span>
                                    </p>
                                </div>
                                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full translate-x-8 -translate-y-8 pointer-events-none"></div>
                            </div>

                            {/* KPI 4 */}
                            <div className="relative overflow-hidden bg-slate-800/40 border border-slate-700/60 rounded-xl p-4 flex items-center gap-4 hover:border-amber-500/40 transition-colors">
                                <div className="p-3 bg-amber-500/10 text-amber-400 rounded-lg">
                                    <Percent className="w-5 h-5" />
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400">综合平均毛利率</p>
                                    <p className="text-lg font-bold text-white mt-1">
                                        {(kpiSummary.avgMargin * 100).toFixed(2)}
                                        <span className="text-xs text-slate-400 font-normal ml-1">%</span>
                                    </p>
                                </div>
                                <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full translate-x-8 -translate-y-8 pointer-events-none"></div>
                            </div>
                        </div>
                    )}

                    {/* 2. SVG 图表分析区 (趋势线图 + 占比环图) */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

                        {/* 2.1 销量/额对比趋势折线图 (2/3 宽度) */}
                        <div className="lg:col-span-2 bg-slate-800/40 border border-slate-700/60 rounded-xl p-4 flex flex-col gap-3 relative min-w-0">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Layers className="w-4 h-4 text-indigo-400" />
                                    <span className="text-sm font-bold text-white">销售趋势对比折线图</span>
                                </div>
                                <div className="text-[10px] text-slate-400 flex items-center gap-1.5 bg-slate-900/60 px-2.5 py-1 rounded-md border border-slate-800">
                                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                    已选 {skusToPlot.length} 个 SKU
                                </div>
                            </div>

                            {/* 折线图绘制区 */}
                            {loadingData ? (
                                <div className="h-64 bg-slate-900/40 rounded-xl border border-slate-800 flex items-center justify-center animate-pulse">
                                    <span className="text-xs text-slate-400">正在生成SVG折线...</span>
                                </div>
                            ) : skusToPlot.length === 0 ? (
                                <div className="h-64 bg-slate-900/40 rounded-xl border border-slate-800/60 flex flex-col items-center justify-center gap-2">
                                    <Info className="w-8 h-8 text-slate-600" />
                                    <span className="text-xs text-slate-500">请在下方矩阵表中勾选 SKU 以绘制趋势折线</span>
                                </div>
                            ) : (
                                <div className="relative bg-slate-950/60 rounded-xl border border-slate-800/80 p-2 overflow-hidden select-none">
                                    <svg
                                        viewBox={`0 0 ${chartConfig.width} ${chartConfig.height}`}
                                        className="w-full h-auto cursor-crosshair"
                                        onMouseMove={handleChartMouseMove}
                                        onMouseLeave={() => setHoveredPoint(null)}
                                    >
                                        {/* 网格水平参考线 */}
                                        {chartConfig.yTicks.map((tick, i) => {
                                            const y = chartConfig.height - chartConfig.paddingBottom - (i / 4) * (chartConfig.height - chartConfig.paddingTop - chartConfig.paddingBottom);
                                            return (
                                                <g key={i}>
                                                    <line
                                                        x1={chartConfig.paddingLeft}
                                                        y1={y}
                                                        x2={chartConfig.width - chartConfig.paddingRight}
                                                        y2={y}
                                                        stroke="#334155"
                                                        strokeWidth="1"
                                                        strokeDasharray="4 6"
                                                    />
                                                    <text
                                                        x={chartConfig.paddingLeft - 8}
                                                        y={y + 4}
                                                        fill="#94a3b8"
                                                        fontSize="10"
                                                        textAnchor="end"
                                                        fontFamily="monospace"
                                                    >
                                                        {dataType === 'qty' ? tick.toFixed(0) : `¥${(tick / 1000).toFixed(0)}k`}
                                                    </text>
                                                </g>
                                            );
                                        })}

                                        {/* 网格垂直时间线 */}
                                        {chartConfig.xTicks.map((tick, i) => (
                                            <g key={i}>
                                                <line
                                                    x1={tick.x}
                                                    y1={chartConfig.paddingTop}
                                                    x2={tick.x}
                                                    y2={chartConfig.height - chartConfig.paddingBottom}
                                                    stroke="#1e293b"
                                                    strokeWidth="1"
                                                />
                                                <text
                                                    x={tick.x}
                                                    y={chartConfig.height - chartConfig.paddingBottom + 16}
                                                    fill="#94a3b8"
                                                    fontSize="9"
                                                    textAnchor="middle"
                                                    fontFamily="monospace"
                                                >
                                                    {tick.label}
                                                </text>
                                            </g>
                                        ))}

                                        {/* 绘制 SKU 趋势折线 */}
                                        {chartConfig.linesData.map((line) => (
                                            <g key={line.skuId}>
                                                {/* 阴影外描边（发光感） */}
                                                <path
                                                    d={line.path}
                                                    fill="none"
                                                    stroke={line.color}
                                                    strokeWidth="4"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    opacity="0.15"
                                                />
                                                {/* 主线条 */}
                                                <path
                                                    d={line.path}
                                                    fill="none"
                                                    stroke={line.color}
                                                    strokeWidth="2.5"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    className="transition-all duration-300 hover:stroke-[3.5]"
                                                />
                                                {/* 数据节点圆点 */}
                                                {line.coords.map((c, cIdx) => (
                                                    <circle
                                                        key={cIdx}
                                                        cx={c.x}
                                                        cy={c.y}
                                                        r="3.5"
                                                        fill={line.color}
                                                        stroke="#020617"
                                                        strokeWidth="1.5"
                                                    />
                                                ))}
                                            </g>
                                        ))}

                                        {/* 悬浮聚焦辅助垂直虚线 */}
                                        {hoveredPoint && (
                                            <line
                                                x1={hoveredPoint.x}
                                                y1={chartConfig.paddingTop}
                                                x2={hoveredPoint.x}
                                                y2={chartConfig.height - chartConfig.paddingBottom}
                                                stroke="#818cf8"
                                                strokeWidth="1.5"
                                                strokeDasharray="3 3"
                                            />
                                        )}

                                        {/* 悬浮聚焦高亮圆圈 */}
                                        {hoveredPoint && (
                                            <circle
                                                cx={hoveredPoint.x}
                                                cy={hoveredPoint.y}
                                                r="7"
                                                fill="#818cf8"
                                                stroke="#ffffff"
                                                strokeWidth="2"
                                                opacity="0.9"
                                            />
                                        )}
                                    </svg>

                                    {/* 折线图 Legend 图例 */}
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-4 px-2">
                                        {chartConfig.linesData.map((line) => (
                                            <div key={line.skuId} className="flex items-center gap-1.5 text-xs text-slate-300">
                                                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: line.color }}></span>
                                                <span className="truncate max-w-[110px]" title={line.productName}>
                                                    {line.productName}
                                                </span>
                                            </div>
                                        ))}
                                    </div>

                                    {/* 悬浮 Tooltip 渲染 */}
                                    {hoveredPoint && (
                                        <div
                                            className="absolute bg-slate-950/95 border border-slate-700/80 rounded-lg p-3 text-xs shadow-2xl z-30 pointer-events-none text-slate-200"
                                            style={{
                                                left: `${Math.min(hoveredPoint.x - 30, chartConfig.width - 180)}px`,
                                                top: `${Math.max(hoveredPoint.y - 120, 10)}px`,
                                                width: '180px'
                                            }}
                                        >
                                            <p className="font-semibold text-white border-b border-slate-800 pb-1 mb-1.5 truncate">
                                                {hoveredPoint.productName}
                                            </p>
                                            <div className="space-y-1 font-mono text-[11px]">
                                                <div className="flex justify-between">
                                                    <span className="text-slate-400">时间节点:</span>
                                                    <span className="text-indigo-300 font-bold">{hoveredPoint.col}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-slate-400">{dataType === 'qty' ? '销量:' : '额:'}</span>
                                                    <span className="text-white font-bold">
                                                        {dataType === 'qty'
                                                            ? `${hoveredPoint.val.toLocaleString()} 箱`
                                                            : `¥${hoveredPoint.val.toLocaleString(undefined, { minimumFractionDigits: 1 })}`
                                                        }
                                                    </span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-slate-400">平均单价:</span>
                                                    <span className="text-emerald-400 font-semibold">¥{hoveredPoint.price.toFixed(2)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-slate-400">毛利率:</span>
                                                    <span className="text-amber-400">{(hoveredPoint.margin * 100).toFixed(1)}%</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* 2.2 类别占比饼状环形图 (1/3 宽度) */}
                        <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4 flex flex-col gap-3 min-w-0">
                            <div className="flex items-center gap-2">
                                <Grid className="w-4 h-4 text-fuchsia-400" />
                                <span className="text-sm font-bold text-white">品类销售占比</span>
                            </div>

                            {loadingData ? (
                                <div className="h-64 bg-slate-900/40 rounded-xl border border-slate-800 flex items-center justify-center animate-pulse">
                                    <span className="text-xs text-slate-400">正在生成环形占比...</span>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full gap-4">
                                    {/* SVG Donut */}
                                    <div className="relative w-36 h-36">
                                        <svg viewBox="0 0 160 160" className="w-full h-full transform -rotate-90">
                                            {/* 背景轨道底圈 */}
                                            <circle
                                                cx="80"
                                                cy="80"
                                                r="60"
                                                fill="transparent"
                                                stroke="#1e293b"
                                                strokeWidth="15"
                                            />
                                            {/* 拼接环段 */}
                                            {donutSegments.map((segment, idx) => (
                                                <circle
                                                    key={idx}
                                                    cx="80"
                                                    cy="80"
                                                    r="60"
                                                    fill="transparent"
                                                    stroke={segment.strokeColor}
                                                    strokeWidth="16"
                                                    strokeDasharray={segment.strokeDasharray}
                                                    strokeDashoffset={segment.strokeDashoffset}
                                                    strokeLinecap="round"
                                                    className="transition-all duration-500 hover:stroke-[18px] cursor-pointer"
                                                />
                                            ))}
                                        </svg>
                                        {/* 中心文字说明 */}
                                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                                            <p className="text-[10px] text-slate-400 font-semibold tracking-wide">
                                                {dataType === 'qty' ? '销量总计' : '销售额总计'}
                                            </p>
                                            <p className="text-sm font-extrabold text-white mt-0.5">
                                                {dataType === 'qty'
                                                    ? `${Math.round(kpiSummary.totalQty / 1000)}k 箱`
                                                    : `¥${(kpiSummary.totalRevenue / 10000).toFixed(0)}w`
                                                }
                                            </p>
                                        </div>
                                    </div>

                                    {/* Donut Legend */}
                                    <div className="w-full space-y-2 mt-1">
                                        {donutSegments.map((seg, idx) => (
                                            <div key={idx} className="flex items-center justify-between text-xs bg-slate-900/40 px-3 py-1.5 rounded-lg border border-slate-800">
                                                <div className="flex items-center gap-2">
                                                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: seg.strokeColor }}></span>
                                                    <span className="text-slate-300 font-medium">{seg.category}</span>
                                                </div>
                                                <div className="text-right font-mono text-slate-400 flex items-center gap-2">
                                                    <span>{seg.percentage.toFixed(1)}%</span>
                                                    <span className="text-slate-600">|</span>
                                                    <span className="text-slate-300 font-semibold">
                                                        {dataType === 'qty'
                                                            ? `${(seg.value / 1000).toFixed(0)}k箱`
                                                            : `¥${(seg.value / 10000).toFixed(1)}w`
                                                        }
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 3. 多维分析数据矩阵控制面板 */}
                    <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4 flex flex-col gap-4">

                        {/* 控制操作栏 */}
                        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-700/60 pb-3">
                            {/* 左侧：时间维度 + 数据类型 */}
                            <div className="flex items-center gap-3">
                                {/* 月/季切换 */}
                                <div className="flex bg-slate-900/80 p-0.5 rounded-lg border border-slate-700/60 text-xs">
                                    <button
                                        onClick={() => setTimeDimension('monthly')}
                                        className={`px-3.5 py-1.5 rounded-md font-semibold transition-all ${timeDimension === 'monthly' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                                            }`}
                                    >
                                        月度透视
                                    </button>
                                    <button
                                        onClick={() => setTimeDimension('quarterly')}
                                        className={`px-3.5 py-1.5 rounded-md font-semibold transition-all ${timeDimension === 'quarterly' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                                            }`}
                                    >
                                        季度透视
                                    </button>
                                </div>

                                {/* Qty/Amount切换 */}
                                <div className="flex bg-slate-900/80 p-0.5 rounded-lg border border-slate-700/60 text-xs">
                                    <button
                                        onClick={() => setDataType('qty')}
                                        className={`px-3.5 py-1.5 rounded-md font-semibold transition-all ${dataType === 'qty' ? 'bg-fuchsia-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                                            }`}
                                    >
                                        销量 (Qty)
                                    </button>
                                    <button
                                        onClick={() => setDataType('amount')}
                                        className={`px-3.5 py-1.5 rounded-md font-semibold transition-all ${dataType === 'amount' ? 'bg-fuchsia-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                                            }`}
                                    >
                                        销售额 (Amount)
                                    </button>
                                </div>
                            </div>

                            {/* 右侧：SKU筛选分档类型 */}
                            <div className="flex items-center gap-2 text-xs">
                                <span className="text-slate-400 font-medium">SKU 过滤:</span>
                                <select
                                    value={skuFilterType}
                                    onChange={e => setSkuFilterType(e.target.value as any)}
                                    className="bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                >
                                    <option value="top10">Top 10 单品</option>
                                    <option value="top11-20">销量 11-20 位</option>
                                    <option value="top21-30">销量 21-30 位</option>
                                    <option value="custom">自定义多选/全选</option>
                                </select>
                            </div>
                        </div>

                        {/* 筛选与搜索输入 */}
                        <div className="flex items-center gap-3">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                <input
                                    type="text"
                                    value={skuSearch}
                                    onChange={e => setSkuSearch(e.target.value)}
                                    placeholder="搜索产品编号 (SKU ID) 或 产品名称..."
                                    className="w-full bg-slate-950/60 border border-slate-700/60 rounded-lg pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                                />
                            </div>
                        </div>

                        {/* 4. 数据透视矩阵表格 */}
                        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl overflow-hidden shadow-inner relative max-w-full">

                            {/* 表头及行容器 */}
                            <div className="max-h-[360px] overflow-auto custom-scrollbar relative">
                                <table className="w-full text-xs text-left border-collapse min-w-[700px]">
                                    <thead className="bg-slate-900/90 text-slate-300 sticky top-0 z-20 shadow-md">
                                        <tr>
                                            {/* 多选Checkbox列（仅在自定义模式时展示，或者默认常驻） */}
                                            <th className="px-3 py-3 w-[40px] min-w-[40px] max-w-[40px] text-center border-b border-slate-700/50 sticky left-0 bg-[#252f4a] z-30">
                                                <input
                                                    type="checkbox"
                                                    onChange={handleSelectAll}
                                                    checked={processedSkus.length > 0 && selectedSkuIds.length === processedSkus.length}
                                                    className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 bg-slate-950"
                                                />
                                            </th>
                                            {/* 固定的 SKU 列 */}
                                            <th className="px-4 py-3 w-[112px] min-w-[112px] max-w-[112px] font-bold text-indigo-300 border-b border-slate-700/50 sticky left-[40px] bg-[#252f4a] z-30 truncate">
                                                <span className="flex items-center gap-1">
                                                    SKU 编号
                                                </span>
                                            </th>
                                            {/* 固定的品名列 */}
                                            <th
                                                className="px-4 py-3 font-bold text-indigo-300 border-b border-slate-700/50 sticky left-[152px] bg-[#252f4a] z-30 border-r border-slate-700/60 truncate shadow-[4px_0_8px_-3px_rgba(0,0,0,0.4)] relative group/resize select-none"
                                                style={{ width: `${prodNameWidth}px`, minWidth: `${prodNameWidth}px`, maxWidth: `${prodNameWidth}px` }}
                                            >
                                                <span className="flex items-center gap-1">
                                                    产品名称
                                                </span>
                                                {/* 拖拽调整列宽手柄 */}
                                                <div
                                                    onMouseDown={handleMouseDown}
                                                    className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-indigo-500/40 active:bg-indigo-500 transition-colors z-45"
                                                    title="拖拽可调整列宽"
                                                />
                                            </th>
                                            <th className="px-3 py-3 font-semibold border-b border-slate-800 text-slate-400">分类</th>
                                            <th className="px-3 py-3 font-semibold border-b border-slate-800 text-right text-emerald-400 cursor-pointer hover:text-emerald-300" onClick={() => { setSortKey('avg_price'); setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc'); }}>
                                                <div className="flex items-center justify-end gap-1">
                                                    均价 <ArrowUpDown className="w-3 h-3" />
                                                </div>
                                            </th>
                                            <th className="px-3 py-3 font-semibold border-b border-slate-800 text-right text-amber-400 cursor-pointer hover:text-amber-300" onClick={() => { setSortKey('gross_margin'); setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc'); }}>
                                                <div className="flex items-center justify-end gap-1">
                                                    毛利率 <ArrowUpDown className="w-3 h-3" />
                                                </div>
                                            </th>

                                            {/* 动态时间列 (月度 / 季度) */}
                                            {timeColumns.map(col => (
                                                <th
                                                    key={col}
                                                    onClick={() => { setSortKey(col); setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc'); }}
                                                    className="px-3 py-3 text-right font-mono border-b border-slate-800 cursor-pointer hover:text-indigo-400 text-slate-300 whitespace-nowrap min-w-[70px]"
                                                >
                                                    <div className="flex items-center justify-end gap-1">
                                                        {col} <ArrowUpDown className="w-2.5 h-2.5 opacity-60" />
                                                    </div>
                                                </th>
                                            ))}

                                            {/* 合计列 */}
                                            <th className="px-4 py-3 text-right font-bold border-b border-slate-700/50 bg-[#252f4a] sticky right-0 z-10 border-l border-slate-700/60 cursor-pointer text-indigo-300 shadow-[-4px_0_8px_-3px_rgba(0,0,0,0.4)]" onClick={() => { setSortKey('total'); setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc'); }}>
                                                <div className="flex items-center justify-end gap-1">
                                                    合计 <ArrowUpDown className="w-3 h-3" />
                                                </div>
                                            </th>
                                        </tr>
                                    </thead>

                                    <tbody className="divide-y divide-slate-850">
                                        {loadingData ? (
                                            [1, 2, 3, 4, 5].map(i => (
                                                <tr key={i} className="animate-pulse">
                                                    <td colSpan={8 + timeColumns.length} className="px-4 py-4 text-center h-10 bg-slate-900/10"></td>
                                                </tr>
                                            ))
                                        ) : processedSkus.length === 0 ? (
                                            <tr>
                                                <td colSpan={8 + timeColumns.length} className="px-4 py-12 text-center text-slate-500">
                                                    暂无符合搜索过滤条件的 SKU
                                                </td>
                                            </tr>
                                        ) : (
                                            processedSkus.map((sku) => {
                                                const isSelected = selectedSkuIds.includes(sku.sku_id);
                                                const totalValue = dataType === 'qty' ? sku.total_qty : sku.total_revenue;
                                                return (
                                                    <tr
                                                        key={sku.sku_id}
                                                        className={`group hover:bg-slate-800/30 transition-all ${isSelected ? 'bg-indigo-500/10' : ''
                                                            }`}
                                                    >
                                                        {/* Checkbox 列 */}
                                                        <td className={`px-3 py-2.5 w-[40px] min-w-[40px] max-w-[40px] text-center sticky left-0 z-10 border-b border-slate-800/50 transition-colors ${isSelected ? 'bg-[#2c336b] group-hover:bg-[#343d83]' : 'bg-[#252f4a] group-hover:bg-[#313d5e]'
                                                            }`}>
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={() => handleToggleSku(sku.sku_id)}
                                                                className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 bg-slate-950"
                                                            />
                                                        </td>
                                                        {/* Sticky SKU 编号 */}
                                                        <td className={`px-4 py-2.5 w-[112px] min-w-[112px] max-w-[112px] font-bold text-indigo-300 sticky left-[40px] z-10 border-b border-slate-800/50 truncate transition-colors ${isSelected ? 'bg-[#2c336b] group-hover:bg-[#343d83]' : 'bg-[#252f4a] group-hover:bg-[#313d5e]'
                                                            }`}>
                                                            {sku.sku_id}
                                                        </td>
                                                        {/* Sticky 产品名称 */}
                                                        <td
                                                            className={`px-4 py-2.5 font-bold text-indigo-300 sticky left-[152px] z-10 border-r border-slate-700/60 border-b border-slate-800/50 truncate transition-colors shadow-[4px_0_8px_-3px_rgba(0,0,0,0.4)] ${isSelected ? 'bg-[#2c336b] group-hover:bg-[#343d83]' : 'bg-[#252f4a] group-hover:bg-[#313d5e]'}`}
                                                            style={{ width: `${prodNameWidth}px`, minWidth: `${prodNameWidth}px`, maxWidth: `${prodNameWidth}px` }}
                                                            title={maskProduct(sku.product_name)}
                                                        >
                                                            {maskProduct(sku.product_name)}
                                                        </td>
                                                        {/* SKU 分类 */}
                                                        <td className="px-3 py-2.5 text-slate-400">
                                                            {sku.product_group}
                                                        </td>
                                                        {/* SKU 单价 */}
                                                        <td className="px-3 py-2.5 text-right font-mono text-emerald-400">
                                                            ¥{sku.avg_price.toFixed(2)}
                                                        </td>
                                                        {/* SKU 毛利率 */}
                                                        <td className="px-3 py-2.5 text-right font-mono text-amber-400">
                                                            {(sku.gross_margin * 100).toFixed(1)}%
                                                        </td>

                                                        {/* 动态月份数据 */}
                                                        {timeColumns.map(col => {
                                                            const val = (sku[col] as number) || 0;
                                                            return (
                                                                <td key={col} className="px-3 py-2.5 text-right font-mono text-slate-300">
                                                                    {dataType === 'qty'
                                                                        ? val.toLocaleString(undefined, { maximumFractionDigits: 0 })
                                                                        : `¥${Math.round(val).toLocaleString()}`
                                                                    }
                                                                </td>
                                                            );
                                                        })}

                                                        {/* Sticky 合计列 */}
                                                        <td className={`px-4 py-2.5 text-right font-bold text-indigo-300 sticky right-0 border-l border-slate-700/60 border-b border-slate-800/50 transition-colors shadow-[-4px_0_8px_-3px_rgba(0,0,0,0.4)] ${isSelected ? 'bg-[#2c336b] group-hover:bg-[#343d83]' : 'bg-[#252f4a] group-hover:bg-[#313d5e]'
                                                            }`}>
                                                            {dataType === 'qty'
                                                                ? (totalValue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })
                                                                : `¥${Math.round(totalValue || 0).toLocaleString()}`
                                                            }
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                    </div>
                </div>

                {/* 右侧 35% Dify AI 智能营销诊断小助手 */}
                <div className="w-[35%] flex flex-col h-full bg-slate-950/40 relative min-w-0">
                    {/* AI 头部栏 */}
                    <div className="px-5 py-4 border-b border-slate-700/80 bg-slate-950/80 flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-indigo-400" />
                            <div>
                                <h3 className="text-sm font-bold text-white tracking-wide">AI 智能营销诊断助手</h3>
                            </div>
                        </div>
                        <span className="inline-flex w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" title="智能助手在线"></span>
                    </div>

                    {/* 对话消息区 */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-slate-900/10">
                        {messages.map((msg, idx) => (
                            <div
                                key={msg.id || idx}
                                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'
                                    }`}
                            >
                                <div className="text-[10px] text-slate-500 mb-1 px-1">
                                    {msg.role === 'user' ? '营销业务员' : 'AI分析专家'}
                                </div>
                                <div
                                    className={`max-w-[90%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-md ${msg.role === 'user'
                                        ? 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-tr-none'
                                        : 'bg-slate-800/80 text-slate-100 rounded-tl-none border border-slate-700/50 backdrop-blur-md prose prose-invert prose-xs'
                                        }`}
                                >
                                    {msg.role === 'assistant' ? (
                                        <div className="markdown-body">
                                            <ReactMarkdown
                                                remarkPlugins={[remarkGfm]}
                                                rehypePlugins={[rehypeRaw]}
                                            >
                                                {msg.content || '▋'}
                                            </ReactMarkdown>
                                        </div>
                                    ) : (
                                        <p className="whitespace-pre-wrap">{msg.content}</p>
                                    )}
                                </div>
                            </div>
                        ))}
                        {sendingChat && messages[messages.length - 1]?.content === '' && (
                            <div className="flex flex-col items-start">
                                <div className="text-[10px] text-slate-500 mb-1 px-1">AI分析专家</div>
                                <div className="bg-slate-800/80 text-slate-400 rounded-2xl rounded-tl-none px-4 py-3 text-xs border border-slate-700/50 flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"></span>
                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.2s]"></span>
                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.4s]"></span>
                                    <span>AI正在研判销量与利润矩阵...</span>
                                </div>
                            </div>
                        )}
                        <div ref={chatEndRef} />
                    </div>

                    {/* 快捷推荐指令区 (仅在未发送聊天且输入为空时作为悬停展示) */}
                    {!sendingChat && messages.length <= 2 && (
                        <div className="px-4 py-2.5 bg-slate-950/60 border-t border-slate-850 flex flex-col gap-2 shrink-0">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                                快捷研判指令:
                            </p>
                            <div className="space-y-1.5">
                                {promptShortcuts.map((item, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => handleSendChat(item.prompt)}
                                        className="w-full text-left bg-slate-900/60 hover:bg-indigo-950/40 text-[11px] text-slate-300 hover:text-white px-3 py-2 rounded-lg border border-slate-800 hover:border-indigo-800/60 flex items-center justify-between group transition-all"
                                    >
                                        <span className="truncate pr-2 font-medium">{item.label}</span>
                                        <ChevronRight className="w-3 h-3 text-slate-500 group-hover:text-indigo-400 shrink-0" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 聊天输入框 */}
                    <div className="p-4 border-t border-slate-700/80 bg-slate-950/80 shrink-0">
                        <div className="relative flex items-center bg-slate-900 border border-slate-700/60 rounded-xl px-3 py-2 focus-within:border-indigo-500 shadow-inner">
                            <textarea
                                value={userInput}
                                onChange={e => setUserInput(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSendChat();
                                    }
                                }}
                                disabled={sendingChat}
                                placeholder={sendingChat ? "正在输入诊断报告..." : "向 AI 询问销量异动、毛利漏洞或产品结构策略..."}
                                className="flex-1 bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none resize-none h-12 max-h-24 custom-scrollbar self-center"
                            />
                            <button
                                onClick={() => handleSendChat()}
                                disabled={sendingChat || !userInput.trim()}
                                className="p-2 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 disabled:from-slate-800 disabled:to-slate-800 text-white rounded-lg transition-all shadow-md self-end shrink-0"
                            >
                                <Send className="w-4 h-4" />
                            </button>
                        </div>
                        {chatError && (
                            <div className="mt-2 text-[10px] text-rose-400 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3 shrink-0" />
                                <span>{chatError}</span>
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}
