import { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import {
    Users, RefreshCw, AlertCircle, Search, Filter,
    TrendingDown, ShieldAlert, ShieldCheck, Star,
    ChevronUp, ChevronDown, AlertTriangle, Clock
} from 'lucide-react';
import { API_BASE_URL } from '../config';
import { fetchWithAuth } from '../utils/authFetch';
import { maskCustomerName, useBrandMask } from '../utils/demoMask';

// ======================== 类型定义 ========================

interface AnalysisOverview {
    分析基准时间: string;
    参与分析客户总数: number;
    客户分层分布: Record<string, number>;
    需求稳定性分布: Record<string, number>;
    流失风险分布: Record<string, number>;
    核心分析维度: string[];
    说明: string;
}

interface AnalysisData {
    analysis_overview: AnalysisOverview;
    customer_analysis_header: string[];
    customer_analysis_data: (string | number | null)[][];
}

interface CustomerRow {
    客户ID: number;
    客户名称: string;
    客户所属区域: string | null;
    R_最近提货天数: number | null;
    F_提货频次: number | null;
    M_总提货金额: number | null;
    R_评分: number | null;
    F_评分: number | null;
    M_评分: number | null;
    RFM总分: number | null;
    客户分层: string | null;
    订单变异系数CV: number | null;
    需求稳定性: string | null;
    流失风险等级: string | null;
}

// ======================== 工具函数 ========================

function mapRowToCustomer(header: string[], row: (string | number | null)[]): CustomerRow {
    const obj: Record<string, string | number | null> = {};
    header.forEach((key, i) => { obj[key] = row[i] ?? null; });
    return obj as unknown as CustomerRow;
}

function formatMoney(val: number | null): string {
    if (val == null) return '—';
    return `¥${val.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ======================== 子组件：概览卡片 ========================

const TIER_CONFIG: Record<string, { color: string; bg: string; border: string; icon: React.ReactNode }> = {
    核心客户: {
        color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200',
        icon: <Star className="w-5 h-5 text-amber-500" />
    },
    重要客户: {
        color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200',
        icon: <ShieldCheck className="w-5 h-5 text-blue-500" />
    },
    普通客户: {
        color: 'text-slate-700', bg: 'bg-slate-50', border: 'border-slate-200',
        icon: <Users className="w-5 h-5 text-slate-400" />
    },
    低价值客户: {
        color: 'text-slate-500', bg: 'bg-slate-50', border: 'border-slate-200',
        icon: <ShieldAlert className="w-5 h-5 text-slate-400" />
    },
};

const RISK_CONFIG: Record<string, { badge: string; dot: string; label: string }> = {
    高危流失: { badge: 'bg-red-100 text-red-700 border border-red-200', dot: 'bg-red-500', label: '高危流失' },
    预警流失: { badge: 'bg-orange-100 text-orange-700 border border-orange-200', dot: 'bg-orange-400', label: '预警流失' },
    低风险: { badge: 'bg-green-100 text-green-700 border border-green-200', dot: 'bg-green-400', label: '低风险' },
};

const STABILITY_CONFIG: Record<string, string> = {
    非常稳定: 'text-emerald-600 bg-emerald-50 border border-emerald-200',
    稳定: 'text-blue-600 bg-blue-50 border border-blue-200',
    一般: 'text-amber-600 bg-amber-50 border border-amber-200',
    不稳定: 'text-red-600 bg-red-50 border border-red-200',
};

interface OverviewCardsProps {
    overview: AnalysisOverview;
}
const OverviewCards: React.FC<OverviewCardsProps> = ({ overview }) => {
    const tierOrder = ['核心客户', '重要客户', '普通客户', '低价值客户'];
    const riskOrder = ['高危流失', '预警流失', '低风险'];

    return (
        <div className="space-y-4">
            {/* 顶部摘要行 */}
            <div className="flex items-center justify-between bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl p-4 text-white shadow-lg shadow-blue-200">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                        <Users className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <p className="text-xs opacity-80">参与分析客户总数</p>
                        <p className="text-2xl font-bold">{overview.参与分析客户总数.toLocaleString()}</p>
                    </div>
                </div>
                <div className="text-right text-xs opacity-70">
                    <p>分析基准时间</p>
                    <p className="font-medium text-sm">{overview.分析基准时间}</p>
                </div>
            </div>

            {/* 客户分层卡片 */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {tierOrder.map((tier) => {
                    const cfg = TIER_CONFIG[tier] || TIER_CONFIG['普通客户'];
                    const count = overview.客户分层分布[tier] || 0;
                    const total = overview.参与分析客户总数;
                    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
                    return (
                        <div key={tier} className={`rounded-xl border ${cfg.border} ${cfg.bg} p-4 flex flex-col gap-2`}>
                            <div className="flex items-center justify-between">
                                {cfg.icon}
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color} border ${cfg.border}`}>{pct}%</span>
                            </div>
                            <p className={`text-2xl font-bold ${cfg.color}`}>{count}</p>
                            <p className="text-xs text-slate-500">{tier}</p>
                            {/* 进度条 */}
                            <div className="h-1 bg-white/60 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all duration-700 ${tier === '核心客户' ? 'bg-amber-400' : tier === '重要客户' ? 'bg-blue-400' : 'bg-slate-300'}`}
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* 流失风险分布 */}
            <div className="grid grid-cols-3 gap-3">
                {riskOrder.map((risk) => {
                    const cfg = RISK_CONFIG[risk] || RISK_CONFIG['低风险'];
                    const count = overview.流失风险分布[risk] || 0;
                    return (
                        <div key={risk} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3 shadow-sm">
                            <div className={`w-3 h-3 rounded-full ${cfg.dot} shrink-0`} />
                            <div>
                                <p className="text-lg font-bold text-slate-800">{count}</p>
                                <p className="text-xs text-slate-500">{risk}</p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// ======================== 子组件：Tab 1 客户分层清单 ========================

type SortKey = keyof CustomerRow | '';
type SortDir = 'asc' | 'desc';

interface TierListTabProps {
    customers: CustomerRow[];
    isLoading: boolean;
    lastUpdateTime: string;
    onUpdate: () => void;
    updateMessage: string;
}

const TierListTab: React.FC<TierListTabProps> = ({ customers, isLoading, lastUpdateTime, onUpdate, updateMessage }) => {
    const [search, setSearch] = useState('');
    const [tierFilter, setTierFilter] = useState('全部');
    const [riskFilter, setRiskFilter] = useState('全部');
    const [sortKey, setSortKey] = useState<SortKey>('RFM总分');
    const [sortDir, setSortDir] = useState<SortDir>('desc');
    const [currentPage, setCurrentPage] = useState(1);
    const PAGE_SIZE = 50;

    const tiers = ['全部', '核心客户', '重要客户', '普通客户', '低价值客户'];
    const risks = ['全部', '高危流失', '预警流失', '低风险'];

    const filtered = useMemo(() => {
        let data = customers;
        if (search.trim()) {
            const q = search.trim().toLowerCase();
            data = data.filter(c =>
                String(c.客户ID).includes(q) ||
                (c.客户名称 || '').toLowerCase().includes(q) ||
                (c.客户所属区域 || '').toLowerCase().includes(q)
            );
        }
        if (tierFilter !== '全部') data = data.filter(c => c.客户分层 === tierFilter);
        if (riskFilter !== '全部') data = data.filter(c => c.流失风险等级 === riskFilter);
        if (sortKey) {
            data = [...data].sort((a, b) => {
                const av = a[sortKey as keyof CustomerRow];
                const bv = b[sortKey as keyof CustomerRow];
                if (av == null && bv == null) return 0;
                if (av == null) return 1;
                if (bv == null) return -1;
                if (sortDir === 'asc') return av < bv ? -1 : av > bv ? 1 : 0;
                return av > bv ? -1 : av < bv ? 1 : 0;
            });
        }
        return data;
    }, [customers, search, tierFilter, riskFilter, sortKey, sortDir]);

    useEffect(() => {
        setCurrentPage(1);
    }, [search, tierFilter, riskFilter, sortKey, sortDir]);

    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return filtered.slice(start, start + PAGE_SIZE);
    }, [filtered, currentPage]);

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;

    const handleSort = (key: SortKey) => {
        if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setSortDir('desc'); }
    };

    const SortIcon = ({ k }: { k: SortKey }) => {
        if (sortKey !== k) return <ChevronUp className="w-3 h-3 opacity-20" />;
        return sortDir === 'asc'
            ? <ChevronUp className="w-3 h-3 text-blue-500" />
            : <ChevronDown className="w-3 h-3 text-blue-500" />;
    };

    return (
        <div className="space-y-4">
            {/* 操作栏 */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
                {/* 搜索框 */}
                <div className="relative flex-1 min-w-[180px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="搜索客户ID、名称或区域..."
                        className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 bg-slate-50"
                    />
                </div>
                {/* 分层筛选 */}
                <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-slate-400" />
                    <select
                        value={tierFilter}
                        onChange={e => setTierFilter(e.target.value)}
                        className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    >
                        {tiers.map(t => <option key={t}>{t}</option>)}
                    </select>
                    <select
                        value={riskFilter}
                        onChange={e => setRiskFilter(e.target.value)}
                        className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    >
                        {risks.map(r => <option key={r}>{r}</option>)}
                    </select>
                </div>
                {/* 更新按钮 */}
                <div className="flex items-center gap-3 border-l border-slate-200 pl-3 ml-auto">
                    {lastUpdateTime && (
                        <span className="text-xs text-slate-400 flex items-center gap-1 hidden sm:flex">
                            <Clock className="w-3 h-3" />
                            {lastUpdateTime}
                        </span>
                    )}
                    <button
                        onClick={onUpdate}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg shadow-sm shadow-blue-200 transition-all"
                    >
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                        {isLoading ? '更新中...' : '更新数据'}
                    </button>
                </div>
            </div>

            {/* 状态消息 */}
            {updateMessage && (
                <div className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm border ${updateMessage.startsWith('❌') || updateMessage.startsWith('错误')
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : 'bg-blue-50 border-blue-200 text-blue-700'
                    }`}>
                    {updateMessage.startsWith('❌') || updateMessage.startsWith('错误')
                        ? <AlertCircle className="w-4 h-4 shrink-0" />
                        : <RefreshCw className={`w-4 h-4 shrink-0 ${isLoading ? 'animate-spin' : ''}`} />}
                    {updateMessage}
                </div>
            )}

            {/* 数据表格 */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-md overflow-hidden">
                <div className="bg-gradient-to-r from-slate-50 to-white px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-500" />
                    <span className="text-sm font-bold text-slate-800">客户分层清单</span>
                    <span className="text-xs text-slate-400">（共 {filtered.length} 位客户{customers.length !== filtered.length ? `，已筛选自全量 ${customers.length} 位` : ''}）</span>
                </div>
                <div className="max-h-[600px] overflow-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gradient-to-r from-blue-50 to-blue-100/50 text-slate-700 sticky top-0 z-10">
                            <tr>
                                {[
                                    { label: '客户ID', key: '客户ID' },
                                    { label: '客户名称', key: '客户名称' },
                                    { label: '区域', key: '客户所属区域' },
                                    { label: 'R 最近提货(天)', key: 'R_最近提货天数' },
                                    { label: 'F 频次', key: 'F_提货频次' },
                                    { label: 'M 总金额', key: 'M_总提货金额' },
                                    { label: 'RFM总分', key: 'RFM总分' },
                                    { label: '分层', key: '客户分层' },
                                    { label: '需求稳定性', key: '需求稳定性' },
                                    { label: '流失风险', key: '流失风险等级' },
                                ].map(col => (
                                    <th
                                        key={col.key}
                                        onClick={() => handleSort(col.key as SortKey)}
                                        className="px-4 py-3 text-left font-semibold border-b border-slate-200 whitespace-nowrap cursor-pointer hover:bg-blue-100/50 select-none"
                                    >
                                        <span className="flex items-center gap-1">
                                            {col.label}
                                            <SortIcon k={col.key as SortKey} />
                                        </span>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {paginatedData.length > 0 ? paginatedData.map((c, idx) => {
                                const tierCfg = TIER_CONFIG[c.客户分层 || ''] || null;
                                const riskCfg = RISK_CONFIG[c.流失风险等级 || ''] || null;
                                const stabCls = STABILITY_CONFIG[c.需求稳定性 || ''] || 'text-slate-400';
                                return (
                                    <tr key={idx} className="hover:bg-blue-50/30 transition-colors">
                                        <td className="px-4 py-3 font-mono text-slate-600 text-xs">{c.客户ID}</td>
                                        <td className="px-4 py-3 font-medium text-slate-800 max-w-[200px] truncate" title={c.客户名称}>
                                            {maskCustomerName(c.客户ID, c.客户名称) || '—'}
                                        </td>
                                        <td className="px-4 py-3 text-slate-500 text-xs">{c.客户所属区域 || '—'}</td>
                                        <td className="px-4 py-3 text-right text-slate-600">{c.R_最近提货天数 != null ? c.R_最近提货天数 : '—'}</td>
                                        <td className="px-4 py-3 text-right text-slate-600">{c.F_提货频次 ?? '—'}</td>
                                        <td className="px-4 py-3 text-right text-slate-700 whitespace-nowrap">{formatMoney(c.M_总提货金额)}</td>
                                        <td className="px-4 py-3 text-center">
                                            {c.RFM总分 != null
                                                ? <span className="font-bold text-blue-700">{c.RFM总分}</span>
                                                : <span className="text-slate-300">—</span>}
                                        </td>
                                        <td className="px-4 py-3">
                                            {tierCfg && c.客户分层
                                                ? <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${tierCfg.bg} ${tierCfg.color} ${tierCfg.border}`}>
                                                    {c.客户分层}
                                                </span>
                                                : <span className="text-slate-300 text-xs">—</span>}
                                        </td>
                                        <td className="px-4 py-3">
                                            {c.需求稳定性
                                                ? <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${stabCls}`}>{c.需求稳定性}</span>
                                                : <span className="text-slate-300 text-xs">—</span>}
                                        </td>
                                        <td className="px-4 py-3">
                                            {riskCfg && c.流失风险等级
                                                ? <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${riskCfg.badge}`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${riskCfg.dot}`} />
                                                    {c.流失风险等级}
                                                </span>
                                                : <span className="text-slate-300 text-xs">—</span>}
                                        </td>
                                    </tr>
                                );
                            }) : (
                                <tr>
                                    <td colSpan={10} className="px-4 py-16 text-center">
                                        <div className="flex flex-col items-center gap-3 text-slate-400">
                                            <Users className="w-12 h-12 text-slate-200" />
                                            <p className="text-sm">
                                                {customers.length === 0
                                                    ? '暂无数据，请点击"更新数据"从数据库获取客户分析结果'
                                                    : '没有符合筛选条件的客户'}
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {/* 分页控制台 */}
                {filtered.length > 0 && (
                    <div className="bg-slate-50 border-t border-slate-200 px-5 py-3 flex items-center justify-between text-sm text-slate-600">
                        <div>
                            共 <span className="font-semibold text-slate-800">{filtered.length}</span> 位客户，当前第 <span className="font-semibold text-slate-800">{currentPage}</span> / {totalPages} 页
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                disabled={currentPage === 1}
                                onClick={() => setCurrentPage(p => p - 1)}
                                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-colors"
                            >
                                上一页
                            </button>
                            <button
                                disabled={currentPage === totalPages}
                                onClick={() => setCurrentPage(p => p + 1)}
                                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-colors"
                            >
                                下一页
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// ======================== 子组件：Tab 2 定制化订货建议（两层结构） ========================

type SuggestionMode = 'group' | 'single';

interface GroupStats {
    tier: string;
    count: number;
    avgRFM: number;
    totalAmount: number;
    highRiskCount: number;
    stableCount: number;
}

interface OrderSuggestionTabProps {
    customers: CustomerRow[];
}

const GROUP_TIER_CONFIG: Record<string, {
    gradient: string; icon: React.ReactNode; desc: string; strategy: string;
}> = {
    核心客户: {
        gradient: 'from-amber-400 to-orange-500',
        icon: <Star className="w-6 h-6 text-white" />,
        desc: '高频高价值，优先维护',
        strategy: '重点备货、优先配额、专属活动'
    },
    重要客户: {
        gradient: 'from-blue-500 to-indigo-600',
        icon: <ShieldCheck className="w-6 h-6 text-white" />,
        desc: '潜力较大，积极培育',
        strategy: '提频促单、阶梯激励、定期回访'
    },
    普通客户: {
        gradient: 'from-slate-400 to-slate-500',
        icon: <Users className="w-6 h-6 text-white" />,
        desc: '稳定维持，适度推广',
        strategy: '标准备货、促销参与、防止流失'
    },
    低价值客户: {
        gradient: 'from-slate-300 to-slate-400',
        icon: <ShieldAlert className="w-6 h-6 text-white" />,
        desc: '低活跃，评估是否激活',
        strategy: '低频小批量、激活活动、流失预警'
    },
};

const OrderSuggestionTab: React.FC<OrderSuggestionTabProps> = ({ customers }) => {
    const { maskProduct } = useBrandMask();
    const [mode, setMode] = useState<SuggestionMode>('group');
    const [selectedTier, setSelectedTier] = useState<string | null>(null);
    const [customerSearch, setCustomerSearch] = useState('');
    const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
    const [showDropdown, setShowDropdown] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [aiResult, setAiResult] = useState('');

    // 计算各分层统计
    const groupStats: GroupStats[] = useMemo(() => {
        const tiers = ['核心客户', '重要客户', '普通客户', '低价值客户'];
        return tiers.map(tier => {
            const group = customers.filter(c => c.客户分层 === tier);
            const totalAmount = group.reduce((s, c) => s + (c.M_总提货金额 || 0), 0);
            const rfmScores = group.filter(c => c.RFM总分 != null).map(c => c.RFM总分!);
            const avgRFM = rfmScores.length > 0 ? rfmScores.reduce((a, b) => a + b, 0) / rfmScores.length : 0;
            const highRiskCount = group.filter(c => c.流失风险等级 === '高危流失' || c.流失风险等级 === '预警流失').length;
            const stableCount = group.filter(c => c.需求稳定性 === '稳定' || c.需求稳定性 === '非常稳定').length;
            return { tier, count: group.length, avgRFM: parseFloat(avgRFM.toFixed(1)), totalAmount, highRiskCount, stableCount };
        });
    }, [customers]);

    // 客户搜索过滤
    const filteredCustomers = useMemo(() => {
        if (!customerSearch.trim()) return customers.slice(0, 50);
        const q = customerSearch.trim().toLowerCase();
        return customers.filter(c =>
            String(c.客户ID).includes(q) ||
            (c.客户名称 || '').toLowerCase().includes(q)
        ).slice(0, 30);
    }, [customers, customerSearch]);

    const handleAIAnalyze = async () => {
        if (!canAnalyze) return;
        setIsAnalyzing(true);
        setAiResult('');

        try {
            // 构造 payload
            let body: Record<string, unknown>;
            if (mode === 'group' && selectedTier) {
                const stat = groupStats.find(s => s.tier === selectedTier)!;
                const group = customers.filter(c => c.客户分层 === selectedTier);
                // 稳定性分布
                const stabDist: Record<string, number> = {};
                group.forEach(c => { const k = c.需求稳定性 || '未知'; stabDist[k] = (stabDist[k] || 0) + 1; });
                // 风险分布
                const riskDist: Record<string, number> = {};
                group.forEach(c => { const k = c.流失风险等级 || '未知'; riskDist[k] = (riskDist[k] || 0) + 1; });
                // 抽取前 5 个客户样本
                const sample = group.slice(0, 5).map(c => ({
                    名称: c.客户名称 || `客户${c.客户ID}`,
                    RFM总分: c.RFM总分,
                    最近提货天数: c.R_最近提货天数,
                    稳定性: c.需求稳定性,
                    风险: c.流失风险等级
                }));
                body = {
                    analysis_type: 'group_strategy',
                    tier: selectedTier,
                    summary: {
                        total_customers: stat.count,
                        avg_rfm_score: stat.avgRFM,
                        total_amount: stat.totalAmount,
                        high_risk_count: stat.highRiskCount,
                        stable_count: stat.stableCount,
                        stable_ratio: stat.count > 0 ? parseFloat((stat.stableCount / stat.count).toFixed(2)) : 0,
                        high_risk_ratio: stat.count > 0 ? parseFloat((stat.highRiskCount / stat.count).toFixed(2)) : 0
                    },
                    tier_distribution: stabDist,
                    risk_distribution: riskDist,
                    top_customers_sample: sample
                };
            } else if (mode === 'single' && selectedCustomer) {
                const c = selectedCustomer;
                body = {
                    analysis_type: 'single_customer',
                    customer: {
                        id: c.客户ID,
                        name: c.客户名称,
                        region: c.客户所属区域,
                        rfm: {
                            R: c.R_最近提货天数,
                            F: c.F_提货频次,
                            M: c.M_总提货金额,
                            R_score: c.R_评分,
                            F_score: c.F_评分,
                            M_score: c.M_评分,
                            total: c.RFM总分
                        },
                        tier: c.客户分层,
                        cv: c.订单变异系数CV,
                        stability: c.需求稳定性,
                        risk: c.流失风险等级
                    }
                };
            } else {
                return;
            }

            const resp = await fetchWithAuth('/api/order-suggestion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            // 未配置 Key
            if (resp.status === 503) {
                const errData = await resp.json();
                setAiResult(`⚠️ ${errData.error}`);
                return;
            }

            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
                setAiResult(`❌ 请求失败：${errData.error || errData.details || `HTTP ${resp.status}`}`);
                return;
            }

            // SSE 流式读取
            const reader = resp.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                // 按行处理 SSE
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data:')) continue;
                    const dataStr = trimmed.slice(5).trim();
                    if (dataStr === '[DONE]') continue;
                    try {
                        const json = JSON.parse(dataStr);
                        // 分析引擎流式输出: event=message 时有 answer 字段
                        if (json.event === 'message' && json.answer) {
                            setAiResult(prev => prev + json.answer);
                        } else if (json.event === 'message_end') {
                            // 结束
                        } else if (json.event === 'error') {
                            setAiResult(prev => prev + `\n❌ 工作流错误: ${json.message}`);
                        }
                    } catch {
                        // 忽略非 JSON 行
                    }
                }
            }

            // 通知菜单栏：后台任务完成
            window.dispatchEvent(new CustomEvent('app-task-done', { detail: { appId: 'customer' } }));
        } catch (err: any) {
            setAiResult(`❌ 网络错误：${err.message}`);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const canAnalyze = (mode === 'group' && selectedTier !== null) || (mode === 'single' && selectedCustomer !== null);

    return (
        <div className="space-y-5">
            {/* 模式切换 */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                        <Filter className="w-4 h-4 text-purple-600" />
                    </div>
                    <h3 className="font-semibold text-slate-800">选择分析方式</h3>
                    <span className="text-xs text-slate-400">按业务需求选择分组策略或单客户深度分析</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <button
                        onClick={() => { setMode('group'); setAiResult(''); }}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${mode === 'group'
                            ? 'border-purple-500 bg-purple-50'
                            : 'border-slate-200 hover:border-purple-200 hover:bg-purple-50/50'
                            }`}
                    >
                        <div className="flex items-center gap-2 mb-1">
                            <Users className={`w-5 h-5 ${mode === 'group' ? 'text-purple-600' : 'text-slate-400'}`} />
                            <span className={`font-semibold text-sm ${mode === 'group' ? 'text-purple-700' : 'text-slate-700'}`}>分组策略分析</span>
                            {mode === 'group' && <span className="ml-auto w-2 h-2 rounded-full bg-purple-500" />}
                        </div>
                        <p className="text-xs text-slate-500">按客户分层批量生成组级订货策略，适合制定团队运营方向</p>
                    </button>
                    <button
                        onClick={() => { setMode('single'); setAiResult(''); }}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${mode === 'single'
                            ? 'border-indigo-500 bg-indigo-50'
                            : 'border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/50'
                            }`}
                    >
                        <div className="flex items-center gap-2 mb-1">
                            <Star className={`w-5 h-5 ${mode === 'single' ? 'text-indigo-600' : 'text-slate-400'}`} />
                            <span className={`font-semibold text-sm ${mode === 'single' ? 'text-indigo-700' : 'text-slate-700'}`}>单客户深度分析</span>
                            {mode === 'single' && <span className="ml-auto w-2 h-2 rounded-full bg-indigo-500" />}
                        </div>
                        <p className="text-xs text-slate-500">针对单个客户生成个性化订货建议，适合重要客户拜访前准备</p>
                    </button>
                </div>
            </div>

            {/* ====== 模式 A：分组策略 ====== */}
            {mode === 'group' && (
                <div className="space-y-4">
                    <p className="text-xs text-slate-500 px-1">点击分层卡片选择分析目标，再点击「生成订货策略」</p>
                    <div className="grid grid-cols-2 gap-4">
                        {groupStats.map(stat => {
                            const cfg = GROUP_TIER_CONFIG[stat.tier];
                            const isSelected = selectedTier === stat.tier;
                            return (
                                <button
                                    key={stat.tier}
                                    onClick={() => { setSelectedTier(isSelected ? null : stat.tier); setAiResult(''); }}
                                    className={`rounded-xl border-2 p-4 text-left transition-all hover:shadow-md ${isSelected ? 'border-purple-500 shadow-md shadow-purple-100' : 'border-transparent hover:border-purple-200'
                                        }`}
                                >
                                    {/* 卡片头 */}
                                    <div className={`bg-gradient-to-r ${cfg.gradient} rounded-lg p-3 flex items-center justify-between mb-3`}>
                                        <div className="flex items-center gap-2">
                                            <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                                                {cfg.icon}
                                            </div>
                                            <div>
                                                <p className="text-white font-bold text-sm">{stat.tier}</p>
                                                <p className="text-white/70 text-xs">{cfg.desc}</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-white text-2xl font-bold">{stat.count}</p>
                                            <p className="text-white/70 text-xs">位客户</p>
                                        </div>
                                    </div>
                                    {/* 指标行 */}
                                    <div className="grid grid-cols-3 gap-2 text-xs">
                                        <div className="bg-slate-50 rounded-lg p-2 text-center">
                                            <p className="text-slate-400">平均RFM</p>
                                            <p className="font-bold text-slate-700">{stat.avgRFM || '—'}</p>
                                        </div>
                                        <div className="bg-red-50 rounded-lg p-2 text-center">
                                            <p className="text-red-400">异动风险</p>
                                            <p className="font-bold text-red-600">{stat.highRiskCount}</p>
                                        </div>
                                        <div className="bg-green-50 rounded-lg p-2 text-center">
                                            <p className="text-green-400">稳定客户</p>
                                            <p className="font-bold text-green-600">{stat.stableCount}</p>
                                        </div>
                                    </div>
                                    {/* 推荐策略标签 */}
                                    <div className="mt-2 flex flex-wrap gap-1">
                                        {cfg.strategy.split('、').map(s => (
                                            <span key={s} className="px-2 py-0.5 bg-slate-100 text-slate-500 text-xs rounded-full">{s}</span>
                                        ))}
                                    </div>
                                    {/* 选中标记 */}
                                    {isSelected && (
                                        <div className="mt-2 flex items-center gap-1 text-purple-600 text-xs font-medium">
                                            <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                                            已选中，点击下方按钮生成策略
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ====== 模式 B：单客户深度分析 ====== */}
            {mode === 'single' && (
                <div className="space-y-4">
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                        <label className="block text-sm font-semibold text-slate-700 mb-2">搜索并选择客户</label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                value={customerSearch}
                                onChange={e => { setCustomerSearch(e.target.value); setShowDropdown(true); setSelectedCustomer(null); setAiResult(''); }}
                                onFocus={() => setShowDropdown(true)}
                                placeholder="输入客户ID或名称搜索..."
                                className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-slate-50"
                            />
                            {/* 下拉列表 */}
                            {showDropdown && filteredCustomers.length > 0 && !selectedCustomer && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-slate-200 shadow-xl z-20 max-h-60 overflow-auto">
                                    {filteredCustomers.map((c, i) => {
                                        const tierCfg = TIER_CONFIG[c.客户分层 || ''];
                                        const riskCfg = RISK_CONFIG[c.流失风险等级 || ''];
                                        return (
                                            <button
                                                key={i}
                                                onClick={() => { setSelectedCustomer(c); setCustomerSearch(''); setShowDropdown(false); setAiResult(''); }}
                                                className="w-full px-4 py-3 text-left hover:bg-indigo-50 transition-colors flex items-center gap-3 border-b border-slate-100 last:border-0"
                                            >
                                                <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center text-xs font-bold text-indigo-600 shrink-0">
                                                    {maskCustomerName(c.客户ID, c.客户名称).charAt(2)}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium text-slate-800 truncate">{maskCustomerName(c.客户ID, c.客户名称)}</p>
                                                    <p className="text-xs text-slate-400">ID: {c.客户ID}</p>
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    {c.客户分层 && tierCfg && (
                                                        <span className={`text-xs px-1.5 py-0.5 rounded-full border ${tierCfg.bg} ${tierCfg.color} ${tierCfg.border}`}>{c.客户分层}</span>
                                                    )}
                                                    {c.流失风险等级 && riskCfg && c.流失风险等级 !== '低风险' && (
                                                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${riskCfg.badge}`}>{c.流失风险等级}</span>
                                                    )}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        {customers.length === 0 && (
                            <p className="text-xs text-slate-400 mt-2">请先在「客户分层清单」Tab 中更新数据</p>
                        )}
                    </div>

                    {/* 已选客户详情卡片 */}
                    {selectedCustomer && (() => {
                        const c = selectedCustomer;
                        const tierCfg = TIER_CONFIG[c.客户分层 || ''];
                        const riskCfg = RISK_CONFIG[c.流失风险等级 || ''];
                        const stabCls = STABILITY_CONFIG[c.需求稳定性 || ''] || 'text-slate-400 bg-slate-50 border-slate-200';
                        return (
                            <div className="bg-white rounded-xl border border-indigo-200 shadow-sm overflow-hidden">
                                {/* 客户头部 */}
                                <div className="bg-gradient-to-r from-indigo-500 to-purple-600 p-4 flex items-center gap-3">
                                    <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center text-white text-xl font-bold">
                                        {maskCustomerName(c.客户ID, c.客户名称).charAt(2)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-white font-bold truncate">{maskCustomerName(c.客户ID, c.客户名称)}</p>
                                        <p className="text-indigo-200 text-xs">ID: {c.客户ID} {c.客户所属区域 ? `· ${c.客户所属区域}` : ''}</p>
                                    </div>
                                    <button
                                        onClick={() => { setSelectedCustomer(null); setAiResult(''); }}
                                        className="text-white/60 hover:text-white text-xs px-2 py-1 border border-white/30 rounded-lg"
                                    >
                                        重选
                                    </button>
                                </div>
                                {/* 指标网格 */}
                                <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                                        <p className="text-2xl font-bold text-blue-700">{c.RFM总分 ?? '—'}</p>
                                        <p className="text-xs text-slate-500 mt-0.5">RFM 总分</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                                        <p className="text-2xl font-bold text-slate-700">{c.F_提货频次 ?? '—'}</p>
                                        <p className="text-xs text-slate-500 mt-0.5">提货频次</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                                        <p className="text-sm font-bold text-slate-700 mt-1">{c.R_最近提货天数 != null ? `${c.R_最近提货天数}天` : '—'}</p>
                                        <p className="text-xs text-slate-500 mt-0.5">最近提货</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                                        <p className="text-sm font-bold text-slate-700 mt-1">{c.M_总提货金额 != null ? `¥${(c.M_总提货金额 / 10000).toFixed(1)}万` : '—'}</p>
                                        <p className="text-xs text-slate-500 mt-0.5">总提货额</p>
                                    </div>
                                </div>
                                {/* 标签行 */}
                                <div className="px-4 pb-4 flex flex-wrap gap-2">
                                    {c.客户分层 && tierCfg && (
                                        <span className={`px-3 py-1 rounded-full text-xs font-medium border ${tierCfg.bg} ${tierCfg.color} ${tierCfg.border}`}>{c.客户分层}</span>
                                    )}
                                    {c.需求稳定性 && (
                                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${stabCls}`}>{c.需求稳定性}</span>
                                    )}
                                    {c.流失风险等级 && riskCfg && (
                                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${riskCfg.badge}`}>{c.流失风险等级}</span>
                                    )}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            )}

            {/* 生成按钮 + 结果区 */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-md overflow-hidden">
                <div className="bg-gradient-to-r from-purple-50 to-indigo-50 px-5 py-4 flex items-center justify-between border-b border-slate-100">
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${mode === 'group' ? 'bg-gradient-to-br from-purple-500 to-purple-600' : 'bg-gradient-to-br from-indigo-500 to-indigo-600'
                            }`}>
                            {mode === 'group'
                                ? <Users className="w-5 h-5 text-white" />
                                : <Star className="w-5 h-5 text-white" />}
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-slate-800">
                                {mode === 'group' ? `分组策略生成${selectedTier ? `·${selectedTier}` : ''}` : `单客户深度分析${selectedCustomer ? `·${maskCustomerName(selectedCustomer.客户ID, selectedCustomer.客户名称)}` : ''}`}
                            </h3>
                            <p className="text-xs text-slate-500">
                                {mode === 'group' ? '基于分组 RFM 均值、稳定性分布生成组级订货策略' : '基于客户完整画像生成个性化订货与回访建议'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleAIAnalyze}
                        disabled={!canAnalyze || isAnalyzing}
                        className={`px-5 py-2.5 rounded-lg font-medium text-sm shadow-lg transition-all flex items-center gap-2 ${canAnalyze && !isAnalyzing
                            ? mode === 'group'
                                ? 'bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white shadow-purple-200'
                                : 'bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white shadow-indigo-200'
                            : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                            }`}
                    >
                        <RefreshCw className={`w-4 h-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
                        {isAnalyzing ? '生成中...' : '生成订货建议'}
                    </button>
                </div>
                {/* AI 输出区 */}
                <div className="p-5">
                    <div className={`bg-slate-50 rounded-xl border border-slate-200 overflow-y-auto ${aiResult ? 'min-h-[180px] max-h-[520px]' : 'min-h-[180px] flex items-center justify-center'
                        }`}>
                        {aiResult ? (
                            <div className="w-full p-5 text-sm text-slate-700 leading-relaxed">
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
                                    {maskProduct(selectedCustomer ? aiResult.replace(new RegExp(selectedCustomer.客户名称, 'g'), maskCustomerName(selectedCustomer.客户ID, selectedCustomer.客户名称)) : aiResult)}
                                </ReactMarkdown>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-3 text-slate-400 py-8">
                                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${mode === 'group' ? 'bg-purple-50' : 'bg-indigo-50'
                                    }`}>
                                    {mode === 'group'
                                        ? <Users className="w-8 h-8 text-purple-200" />
                                        : <Star className="w-8 h-8 text-indigo-200" />}
                                </div>
                                <p className="text-sm">
                                    {!canAnalyze
                                        ? mode === 'group' ? '请先在上方选择一个客户分层' : '请先搜索并选择分析的客户'
                                        : 'AI 建议将显示在这里'}
                                </p>
                                <p className="text-xs text-slate-300">
                                    {canAnalyze ? '点击右上角「生成订货建议」按钮开始分析' : ''}
                                </p>
                            </div>
                        )}
                    </div>
                    {/* 说明 */}
                    <div className="mt-3 flex items-start gap-2 text-xs text-slate-400">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-400" />
                        <span>工作流接入中，基于 RFM、CV 稳定性、区域特征等维度综合分析。</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ======================== 子组件：Tab 3 异动预警提醒 ========================

interface AlertTabProps {
    customers: CustomerRow[];
}

const AlertTab: React.FC<AlertTabProps> = ({ customers }) => {
    const highRisk = customers.filter(c => c.流失风险等级 === '高危流失');
    const warnRisk = customers.filter(c => c.流失风险等级 === '预警流失');
    const alertCustomers = [...highRisk, ...warnRisk];

    const [search, setSearch] = useState('');
    const [riskFilter, setRiskFilter] = useState('全部异动');
    const [currentPage, setCurrentPage] = useState(1);
    const PAGE_SIZE = 30; // 预警卡片单体高度较大，降低单页配额

    const filtered = useMemo(() => {
        let data = alertCustomers;
        if (riskFilter === '高危流失') data = highRisk;
        else if (riskFilter === '预警流失') data = warnRisk;
        if (search.trim()) {
            const q = search.trim().toLowerCase();
            data = data.filter(c =>
                String(c.客户ID).includes(q) ||
                (c.客户名称 || '').toLowerCase().includes(q)
            );
        }
        return data;
    }, [alertCustomers, search, riskFilter]);

    useEffect(() => {
        setCurrentPage(1);
    }, [search, riskFilter]);

    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return filtered.slice(start, start + PAGE_SIZE);
    }, [filtered, currentPage]);

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;

    return (
        <div className="space-y-4">
            {/* 顶部统计横幅 */}
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-gradient-to-br from-red-500 to-rose-600 rounded-xl p-4 text-white shadow-lg shadow-red-200">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs opacity-80 mb-1">高危流失客户</p>
                            <p className="text-3xl font-bold">{highRisk.length}</p>
                            <p className="text-xs opacity-70 mt-1">最近超过 180 天未提货</p>
                        </div>
                        <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                            <TrendingDown className="w-7 h-7 text-white" />
                        </div>
                    </div>
                </div>
                <div className="bg-gradient-to-br from-orange-400 to-amber-500 rounded-xl p-4 text-white shadow-lg shadow-orange-200">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs opacity-80 mb-1">预警流失客户</p>
                            <p className="text-3xl font-bold">{warnRisk.length}</p>
                            <p className="text-xs opacity-70 mt-1">最近 90-180 天未提货</p>
                        </div>
                        <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                            <AlertTriangle className="w-7 h-7 text-white" />
                        </div>
                    </div>
                </div>
            </div>

            {/* 筛选操作栏 */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[180px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="搜索客户..."
                        className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-300 bg-slate-50"
                    />
                </div>
                <div className="flex gap-2">
                    {['全部异动', '高危流失', '预警流失'].map(r => (
                        <button
                            key={r}
                            onClick={() => setRiskFilter(r)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${riskFilter === r
                                ? r === '高危流失' ? 'bg-red-100 text-red-700 ring-1 ring-red-300'
                                    : r === '预警流失' ? 'bg-orange-100 text-orange-700 ring-1 ring-orange-300'
                                        : 'bg-slate-200 text-slate-700 ring-1 ring-slate-300'
                                : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                                }`}
                        >
                            {r}
                        </button>
                    ))}
                </div>
            </div>

            {/* 预警客户卡片列表 */}
            {filtered.length > 0 ? (
                <div className="space-y-3">
                    {paginatedData.map((c, idx) => {
                        const isHigh = c.流失风险等级 === '高危流失';
                        const tierCfg = TIER_CONFIG[c.客户分层 || ''];
                        return (
                            <div
                                key={idx}
                                className={`bg-white rounded-xl border shadow-sm p-4 flex items-start gap-4 transition-all hover:shadow-md ${isHigh ? 'border-red-200 hover:border-red-300' : 'border-orange-200 hover:border-orange-300'
                                    }`}
                            >
                                {/* 风险图标 */}
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isHigh ? 'bg-red-100' : 'bg-orange-100'}`}>
                                    {isHigh
                                        ? <TrendingDown className="w-5 h-5 text-red-500" />
                                        : <AlertTriangle className="w-5 h-5 text-orange-400" />}
                                </div>

                                {/* 客户信息 */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2 flex-wrap">
                                        <div>
                                            <p className="font-semibold text-slate-800 truncate">{maskCustomerName(c.客户ID, c.客户名称)}</p>
                                            <p className="text-xs text-slate-400 mt-0.5">ID: {c.客户ID} {c.客户所属区域 ? `· ${c.客户所属区域}` : ''}</p>
                                        </div>
                                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold shrink-0 ${isHigh
                                            ? 'bg-red-100 text-red-700 border border-red-200'
                                            : 'bg-orange-100 text-orange-700 border border-orange-200'
                                            }`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${isHigh ? 'bg-red-500' : 'bg-orange-400'}`} />
                                            {c.流失风险等级}
                                        </span>
                                    </div>

                                    {/* 指标行 */}
                                    <div className="mt-3 flex flex-wrap gap-3 text-xs">
                                        <div className="flex items-center gap-1.5 bg-slate-50 rounded-lg px-2.5 py-1.5">
                                            <span className="text-slate-500">最近提货</span>
                                            <span className="font-semibold text-slate-700">
                                                {c.R_最近提货天数 != null ? `${c.R_最近提货天数} 天前` : '—'}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5 bg-slate-50 rounded-lg px-2.5 py-1.5">
                                            <span className="text-slate-500">提货频次</span>
                                            <span className="font-semibold text-slate-700">{c.F_提货频次 ?? '—'}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5 bg-slate-50 rounded-lg px-2.5 py-1.5">
                                            <span className="text-slate-500">总提货额</span>
                                            <span className="font-semibold text-slate-700">{formatMoney(c.M_总提货金额)}</span>
                                        </div>
                                        {c.客户分层 && tierCfg && (
                                            <div className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border ${tierCfg.bg} ${tierCfg.color} ${tierCfg.border}`}>
                                                {c.客户分层}
                                            </div>
                                        )}
                                        {c.RFM总分 != null && (
                                            <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1.5">
                                                <span className="text-blue-500">RFM</span>
                                                <span className="font-bold text-blue-700">{c.RFM总分}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {/* 分页控制台 */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between text-sm text-slate-500 pt-2 px-1">
                            <div>
                                共 <span className="font-medium text-slate-700">{filtered.length}</span> 位关注客户，当前第 <span className="font-medium text-slate-700">{currentPage}</span> / {totalPages} 页
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    disabled={currentPage === 1}
                                    onClick={() => setCurrentPage(p => p - 1)}
                                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition-colors text-slate-600"
                                >
                                    上一页
                                </button>
                                <button
                                    disabled={currentPage === totalPages}
                                    onClick={() => setCurrentPage(p => p + 1)}
                                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition-colors text-slate-600"
                                >
                                    下一页
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="bg-white rounded-xl border border-slate-200 p-16 flex flex-col items-center gap-3 text-slate-400">
                    <ShieldCheck className="w-14 h-14 text-green-200" />
                    <p className="text-sm font-medium text-green-500">暂无异动预警客户</p>
                    <p className="text-xs">{customers.length === 0 ? '请先更新数据' : '所有客户均处于低风险状态'}</p>
                </div>
            )}
        </div>
    );
};

// ======================== 主组件 ========================

type TabType = 'tier' | 'suggestion' | 'alert';

export const CustomerAnalysisModule: React.FC = () => {
    const [activeTab, setActiveTab] = useState<TabType>('tier');
    const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
    const [customers, setCustomers] = useState<CustomerRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialLoading, setIsInitialLoading] = useState(true);
    const [lastUpdateTime, setLastUpdateTime] = useState('');
    const [updateMessage, setUpdateMessage] = useState('');

    // 初始化：从 JSON 加载数据或从 API 加载数据
    const loadDataFromAPI = async () => {
        try {
            const resp = await fetchWithAuth(`${API_BASE_URL}/api/customer-analysis`);
            if (!resp.ok) throw new Error('数据接口请求失败');
            const result = await resp.json();
            if (result.exists && result.data) {
                const data: AnalysisData = result.data;
                setAnalysisData(data);
                // 将二维数组映射为对象数组
                const rows = data.customer_analysis_data.map(row =>
                    mapRowToCustomer(data.customer_analysis_header, row)
                );
                setCustomers(rows);
                setLastUpdateTime(data.analysis_overview.分析基准时间);
            }
        } catch (err) {
            console.error('[CustomerAnalysis] 加载数据失败:', err);
        } finally {
            setIsInitialLoading(false);
        }
    };

    useEffect(() => { loadDataFromAPI(); }, []);

    // 点击"更新数据"：触发 Python 脚本
    const handleUpdate = async () => {
        setIsLoading(true);
        setUpdateMessage('正在执行 Python 脚本获取最新客户数据...');
        try {
            const resp = await fetchWithAuth(`${API_BASE_URL}/api/update-customer-analysis`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({ error: '未知错误' }));
                throw new Error(errData.error || `HTTP ${resp.status}`);
            }
            setUpdateMessage('✅ 数据更新成功，正在加载...');
            await new Promise(r => setTimeout(r, 400));
            await loadDataFromAPI();
            setUpdateMessage('✅ 数据已刷新！');
            setTimeout(() => setUpdateMessage(''), 3500);
        } catch (err: any) {
            setUpdateMessage(`❌ 更新失败：${err.message}`);
            setTimeout(() => setUpdateMessage(''), 6000);
        } finally {
            setIsLoading(false);
        }
    };

    const tabs: { id: TabType; label: string; icon: React.ReactNode; badge?: number }[] = [
        {
            id: 'tier', label: '客户分层清单', icon: <Users className="w-4 h-4" />,
            badge: customers.length > 0 ? customers.length : undefined
        },
        { id: 'suggestion', label: '定制化订货建议', icon: <RefreshCw className="w-4 h-4" /> },
        {
            id: 'alert', label: '异动预警提醒', icon: <AlertTriangle className="w-4 h-4" />,
            badge: customers.filter(c => c.流失风险等级 === '高危流失' || c.流失风险等级 === '预警流失').length || undefined
        },
    ];

    return (
        <div className="space-y-6 animate-fade-in pb-10">
            {/* 页面标题 */}
            <div>
                <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                    <Users className="w-6 h-6 text-blue-600" />
                    客户分析
                </h2>
                <p className="text-sm text-slate-400 mt-1">基于 RFM 模型 · 需求稳定性 · 流失风险预警</p>
            </div>

            {/* 初始加载骨架屏 */}
            {isInitialLoading ? (
                <div className="space-y-4 animate-pulse">
                    <div className="h-20 bg-slate-100 rounded-xl" />
                    <div className="grid grid-cols-4 gap-3">
                        {[1, 2, 3, 4].map(i => <div key={i} className="h-28 bg-slate-100 rounded-xl" />)}
                    </div>
                    <div className="h-64 bg-slate-100 rounded-xl" />
                </div>
            ) : (
                <>
                    {/* 概览卡片（有数据时展示） */}
                    {analysisData && <OverviewCards overview={analysisData.analysis_overview} />}

                    {/* Tab 切换栏 */}
                    <div className="flex gap-2 p-1.5 bg-slate-100/80 backdrop-blur-sm rounded-2xl w-fit border border-slate-200/50 shadow-inner">
                        {tabs.map(tab => {
                            const isActive = activeTab === tab.id;
                            let activeClass = '';
                            let badgeClass = '';
                            if (isActive) {
                                if (tab.id === 'alert') {
                                    activeClass = 'bg-gradient-to-r from-red-500 to-rose-500 text-white shadow-lg shadow-red-200/50 ring-1 ring-red-400/50';
                                    badgeClass = 'bg-white/20 text-white shadow-[0_0_8px_rgba(255,255,255,0.3)]';
                                } else {
                                    activeClass = 'bg-gradient-to-r from-blue-600 to-indigo-500 text-white shadow-lg shadow-blue-200/50 ring-1 ring-blue-400/50';
                                    badgeClass = 'bg-white/20 text-white shadow-[0_0_8px_rgba(255,255,255,0.3)]';
                                }
                            } else {
                                activeClass = 'text-slate-600 hover:text-slate-900 hover:bg-white border border-transparent';
                                badgeClass = 'bg-slate-200/70 text-slate-500 group-hover:bg-slate-200 relative top-[1px]';
                            }

                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`group flex items-center gap-2.5 px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 ${activeClass}`}
                                >
                                    <div className={`${isActive ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'} transition-opacity`}>
                                        {tab.icon}
                                    </div>
                                    <span className="tracking-wide">
                                        {tab.label}
                                    </span>
                                    {tab.badge != null && (
                                        <span className={`ml-1 px-2 py-0.5 text-[11px] rounded-full font-extrabold transition-colors ${badgeClass}`}>
                                            {tab.badge}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Tab 内容区 */}
                    {activeTab === 'tier' && (
                        <TierListTab
                            customers={customers}
                            isLoading={isLoading}
                            lastUpdateTime={lastUpdateTime}
                            onUpdate={handleUpdate}
                            updateMessage={updateMessage}
                        />
                    )}
                    {activeTab === 'suggestion' && <OrderSuggestionTab customers={customers} />}
                    {activeTab === 'alert' && <AlertTab customers={customers} />}
                </>
            )}
        </div>
    );
};
