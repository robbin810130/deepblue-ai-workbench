import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    Loader2, AlertTriangle,
    Target, Search, ExternalLink, RefreshCw,
    ChevronLeft, ChevronRight, Play, Star, X, RefreshCcw, Upload
} from 'lucide-react';
import { fetchWithAuth } from '../utils/authFetch';
import { TENDER_SEARCH_RUN_ENDPOINT, TENDER_SEARCH_LIST_ENDPOINT, TENDER_SEARCH_SYNC_DETAIL_ENDPOINT, TENDER_SEARCH_UPLOAD_KNOWLEDGE_ENDPOINT } from '../config';

// ─── 类型定义 ──────────────────────────────────────────────────
interface TenderItem {
    id: number;
    batch_id: string;
    bid_id: string;
    bid_no: string;
    bid_type: number;
    bid_process: number;
    bidder_name: string;
    project_name: string;
    biz_type: string;
    project_amount: string;
    channel_type: string;
    region: string;
    bidder_count: number;
    budget_amount: string;
    file_acquire_time: string;
    file_acquire_method: string;
    bid_doc_fee: string;
    deadline: string;
    bid_method: string;
    source_site: string;
    link: string;
    candidate_names: string[];
    winning_company: string;
    winning_amount: string;
    announcement_date: string;
    is_starred: boolean;
    synced_at: string;
    sync_status: string;
    created_at: string;
}

interface PageData {
    success: boolean;
    message?: string;
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
    items: TenderItem[];
    biz_types?: string[];
}

// ─── 业务类型固定选项 ──────────────────────────────────────────
const BIZ_TYPES = [
    'AI应用', '企业级智能体部署', '其他', '员工福利', '平台搭建', '技术开发',
    '投流业务', '权益票券', '积分商城', '营销活动', '营销礼品(礼品采购)', '立减金'
];

// ─── 星标模式表头配置（7 列） ────────────────────────────────────
const STARRED_COLUMNS: { key: keyof TenderItem; label: string; width?: string; align?: string }[] = [
    { key: 'bid_id', label: '招标ID', width: 'min-w-[100px]' },
    { key: 'bid_no', label: '招标编号', width: 'min-w-[120px] max-w-[220px]' },
    { key: 'project_name', label: '项目全称', width: 'min-w-[200px] max-w-[320px]' },
    { key: 'candidate_names', label: '候选人名称', width: 'min-w-[160px] max-w-[260px]' },
    { key: 'winning_company', label: '中标公司', width: 'min-w-[120px] max-w-[220px]' },
    { key: 'winning_amount', label: '交付金额', width: 'min-w-[100px]', align: 'right' },
    { key: 'announcement_date', label: '公示时间', width: 'min-w-[110px]' },
    { key: 'synced_at', label: '最后同步时间', width: 'min-w-[130px]' },
    { key: 'sync_status', label: '同步状态', width: 'min-w-[90px]' },
    { key: 'link', label: '跳转链接', width: 'min-w-[70px]' },
];

// ─── 表头配置（15 列） ──────────────────────────────────────────
const TABLE_COLUMNS: { key: keyof TenderItem; label: string; width?: string; align?: string }[] = [
    { key: 'bid_id', label: '招标ID', width: 'min-w-[100px]' },
    { key: 'bid_no', label: '招标编号', width: 'min-w-[120px] max-w-[220px]' },
    { key: 'bidder_name', label: '投标方名称', width: 'min-w-[160px] max-w-[280px]' },
    { key: 'project_name', label: '项目全称', width: 'min-w-[200px] max-w-[320px]' },
    { key: 'biz_type', label: '业务类型', width: 'min-w-[80px]' },
    { key: 'project_amount', label: '项目金额', width: 'min-w-[100px]', align: 'right' },
    { key: 'channel_type', label: '渠道类型', width: 'min-w-[80px]' },
    { key: 'region', label: '投标所在地区', width: 'min-w-[120px]' },
    { key: 'bidder_count', label: '入围商家数量', width: 'min-w-[90px]', align: 'right' },
    { key: 'budget_amount', label: '预算金额', width: 'min-w-[110px]', align: 'right' },
    { key: 'file_acquire_time', label: '文件获取时间', width: 'min-w-[100px]' },
    { key: 'file_acquire_method', label: '文件获取方式', width: 'min-w-[100px]' },
    { key: 'bid_doc_fee', label: '招标文件费用', width: 'min-w-[90px]', align: 'right' },
    { key: 'deadline', label: '投标截止时间', width: 'min-w-[110px]' },
    { key: 'bid_method', label: '应标方式', width: 'min-w-[80px]' },
    { key: 'link', label: '跳转链接', width: 'min-w-[70px]' },
];

// ─── 主组件 ──────────────────────────────────────────────────
export const TenderSearchModule: React.FC = () => {
    const [bidderName, setBidderName] = useState('');
    const [projectName, setProjectName] = useState('');
    const [region, setRegion] = useState('');
    const [bizType, setBizType] = useState('');
    const [isRunning, setIsRunning] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string>('');
    const [runMsg, setRunMsg] = useState<string>('');
    const [starredOnly, setStarredOnly] = useState(false);
    const [showRunModal, setShowRunModal] = useState(false);
    const [runTimeRange, setRunTimeRange] = useState(3);
    const [runTopN, setRunTopN] = useState(100);
    const [runBeginDate, setRunBeginDate] = useState('');
    const [runEndDate, setRunEndDate] = useState('');
    const [isSyncing, setIsSyncing] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 分页
    const [page, setPage] = useState(1);
    const [pageSize] = useState(20);
    const [totalPages, setTotalPages] = useState(0);
    const [total, setTotal] = useState(0);
    const [items, setItems] = useState<TenderItem[]>([]);

    // 加载数据
    const loadData = useCallback(async (p: number, bidder?: string, project?: string, starred?: boolean, regionVal?: string, bizTypeVal?: string) => {
        setIsLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({
                page: String(p),
                page_size: String(pageSize),
            });
            if (bidder?.trim()) params.set('bidder_name', bidder.trim());
            if (project?.trim()) params.set('project_name', project.trim());
            if (regionVal?.trim()) params.set('region', regionVal.trim());
            if (bizTypeVal?.trim()) params.set('biz_type', bizTypeVal.trim());
            if (starred) params.set('starred_only', 'true');

            const res = await fetchWithAuth(`${TENDER_SEARCH_LIST_ENDPOINT}?${params}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: PageData = await res.json();
            if (!data.success) throw new Error(data.message || '查询失败');

            setItems(data.items || []);
            setTotal(data.total || 0);
            setTotalPages(data.total_pages || 0);
            setPage(data.page || p);
        } catch (e: any) {
            setError(e.message || '加载数据失败');
        } finally {
            setIsLoading(false);
        }
    }, [pageSize]);
    // 初始加载
    useEffect(() => {
        loadData(1);
    }, [loadData]);

    // 筛选查询
    const handleFilter = () => {
        setPage(1);
        loadData(1, bidderName, projectName, starredOnly, region, bizType);
    };

    // 切换星标筛选
    const handleStarredFilter = () => {
        const newVal = !starredOnly;
        setStarredOnly(newVal);
        setPage(1);
        loadData(1, bidderName, projectName, newVal, region, bizType);
    };

    // 切换单条记录星标
    const handleToggleStar = async (item: TenderItem) => {
        const newStatus = !item.is_starred;
        // 乐观更新
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_starred: newStatus } : i));
        try {
            const res = await fetchWithAuth(`${TENDER_SEARCH_LIST_ENDPOINT.replace('/list', '')}/star/${item.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ starred: newStatus })
            });
            if (!res.ok) throw new Error('操作失败');
        } catch {
            // 回滚
            setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_starred: !newStatus } : i));
        }
    };

    // 手动触发 Dify 检索
    const handleRun = async () => {
        if (isRunning) return;
        // 校验：开始/结束日期必须同时存在
        if (!!runBeginDate !== !!runEndDate) {
            setError('开始日期和结束日期必须同时填写');
            return;
        }
        // 校验：开始日期不能大于结束日期
        if (runBeginDate && runEndDate && runBeginDate > runEndDate) {
            setError('开始日期不能大于结束日期');
            return;
        }
        setIsRunning(true);
        setRunMsg('');
        setError('');
        try {
            const res = await fetchWithAuth(TENDER_SEARCH_RUN_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ time_range: runTimeRange, top_n: runTopN, begin_date: runBeginDate || undefined, end_date: runEndDate || undefined })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message || '检索失败');
            const skipped = data.skipped_count || 0;
            setRunMsg(`检索完成，新增 ${data.items_count || 0} 条数据${skipped > 0 ? `，跳过重复 ${skipped} 条` : ''}`);
            setShowRunModal(false);
            // 刷新列表
            loadData(1, bidderName, projectName, starredOnly, region, bizType);
        } catch (e: any) {
            setError(e.message || '检索过程中发生未知错误');
        } finally {
            setIsRunning(false);
        }
    };

    // 同步星标记录详情
    const handleSyncDetail = async () => {
        if (isSyncing) return;
        setIsSyncing(true);
        setRunMsg('');
        setError('');
        try {
            const res = await fetchWithAuth(TENDER_SEARCH_SYNC_DETAIL_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message || '同步失败');
            const d = data.detail_sync || {};
            const r = data.result_sync || {};
            // 详情同步部分
            let detailMsg = `详情同步：更新 ${d.updated_count || 0} 条`;
            if (d.skipped_status_count > 0) detailMsg += `，已跳过 ${d.skipped_status_count} 条`;
            if (d.no_change_count > 0) detailMsg += `，无变化 ${d.no_change_count} 条`;
            if (d.failed_count > 0) detailMsg += `，失败 ${d.failed_count} 条`;
            // 中标结果同步部分
            let resultMsg = `中标结果同步：更新 ${r.updated_count || 0} 条`;
            if (r.skipped_status_count > 0) resultMsg += `，已跳过 ${r.skipped_status_count} 条`;
            if (r.no_data_count > 0) resultMsg += `，无数据 ${r.no_data_count} 条`;
            if (r.no_change_count > 0) resultMsg += `，无变化 ${r.no_change_count} 条`;
            if (r.failed_count > 0) resultMsg += `，失败 ${r.failed_count} 条`;
            setRunMsg(`同步完成，${detailMsg}；${resultMsg}`);
            // 刷新列表
            loadData(page, bidderName, projectName, starredOnly, region, bizType);
        } catch (e: any) {
            setError(e.message || '同步过程中发生未知错误');
        } finally {
            setIsSyncing(false);
        }
    };

    // 上传文件到知识库
    const handleUploadToKnowledge = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsUploading(true);
        setRunMsg('');
        setError('');
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetchWithAuth(TENDER_SEARCH_UPLOAD_KNOWLEDGE_ENDPOINT, {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.message || '上传失败');
            setRunMsg(`已上传「${file.name}」到知识库`);
        } catch (e: any) {
            setError(e.message || '上传知识库失败');
        } finally {
            setIsUploading(false);
            // 重置 input 以便重复选择同一文件
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // 翻页
    const handlePageChange = (newPage: number) => {
        if (newPage < 1 || newPage > totalPages) return;
        loadData(newPage, bidderName, projectName, starredOnly, region, bizType);
    };

    return (
        <div className="h-full flex flex-col bg-slate-50">
            {/* ─── 顶部标题 ─── */}
            <div className="px-5 py-3 border-b border-slate-200 bg-white flex-shrink-0">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                            <Target className="w-4 h-4 text-white" />
                        </div>
                        <div>
                            <h2 className="text-sm font-bold text-slate-800">招标</h2>
                            <p className="text-[11px] text-slate-400">定时自动检索 · 数据列表展示</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleSyncDetail}
                            disabled={isSyncing || isRunning}
                            className="h-8 px-3 rounded-lg text-white text-xs font-medium flex items-center gap-1.5 transition-all bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="同步星标记录的招标详情"
                        >
                            {isSyncing ? (
                                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 同步中...</>
                            ) : (
                                <><RefreshCcw className="w-3.5 h-3.5" /> 手动同步星标数据</>
                            )}
                        </button>
                        <button
                            onClick={() => setShowRunModal(true)}
                            disabled={isRunning}
                            className="h-8 px-3.5 rounded-lg text-white text-xs font-medium flex items-center gap-1.5 transition-all bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {isRunning ? (
                                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 检索中...</>
                            ) : (
                                <><Play className="w-3.5 h-3.5" /> 手动执行日常招标</>
                            )}
                        </button>
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleUploadToKnowledge}
                            className="hidden"
                            accept=".txt,.pdf,.doc,.docx,.xlsx,.xls,.csv,.md"
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isUploading}
                            className="h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all border border-emerald-200 text-emerald-600 hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="上传文件到知识库"
                        >
                            {isUploading ? (
                                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 上传中...</>
                            ) : (
                                <><Upload className="w-3.5 h-3.5" /> 上传到知识库</>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* ─── 筛选条件区 ─── */}
            <div className="flex-shrink-0 bg-white border-b border-slate-200 px-5 py-3">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-500 whitespace-nowrap">投标方名称</span>
                        <input
                            type="text"
                            value={bidderName}
                            onChange={e => setBidderName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleFilter(); }}
                            disabled={isLoading}
                            placeholder="输入投标方名称"
                            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-md focus:ring-1 focus:ring-blue-400 focus:border-blue-400 outline-none disabled:bg-slate-50 w-[180px]"
                        />
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-500 whitespace-nowrap">项目全称</span>
                        <input
                            type="text"
                            value={projectName}
                            onChange={e => setProjectName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleFilter(); }}
                            disabled={isLoading}
                            placeholder="输入项目全称"
                            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-md focus:ring-1 focus:ring-blue-400 focus:border-blue-400 outline-none disabled:bg-slate-50 w-[220px]"
                        />
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-500 whitespace-nowrap">投标所在地区</span>
                        <input
                            type="text"
                            value={region}
                            onChange={e => setRegion(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleFilter(); }}
                            disabled={isLoading}
                            placeholder="输入地区"
                            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-md focus:ring-1 focus:ring-blue-400 focus:border-blue-400 outline-none disabled:bg-slate-50 w-[140px]"
                        />
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-500 whitespace-nowrap">业务类型</span>
                        <select
                            value={bizType}
                            onChange={e => setBizType(e.target.value)}
                            disabled={isLoading}
                            className="px-2 py-1.5 text-xs border border-slate-200 rounded-md focus:ring-1 focus:ring-blue-400 focus:border-blue-400 outline-none disabled:bg-slate-50 w-[130px] bg-white"
                        >
                            <option value="">全部</option>
                            {BIZ_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                    <button
                        onClick={handleFilter}
                        disabled={isLoading}
                        className="h-8 px-3 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40"
                    >
                        <Search className="w-3.5 h-3.5" /> 筛选
                    </button>
                    <button
                        onClick={handleStarredFilter}
                        disabled={isLoading}
                        className={`h-8 px-3 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all border disabled:opacity-40 ${
                            starredOnly
                                ? 'border-amber-300 bg-amber-50 text-amber-600'
                                : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                        }`}
                    >
                        <Star className={`w-3.5 h-3.5 ${starredOnly ? 'fill-amber-400' : ''}`} /> 星标
                    </button>
                    <button
                        onClick={() => { setBidderName(''); setProjectName(''); setRegion(''); setBizType(''); setStarredOnly(false); setPage(1); loadData(1); }}
                        disabled={isLoading}
                        className="h-8 px-3 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                    >
                        <RefreshCw className="w-3 h-3" /> 重置
                    </button>
                </div>
            </div>

            {/* ─── 结果区 ─── */}
            <div className="flex-1 overflow-auto px-5 py-4">
                {/* 提示信息 */}
                {error && (
                    <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                        <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                        <p className="text-xs font-medium text-red-700">{error}</p>
                    </div>
                )}
                {runMsg && !error && (
                    <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded-full bg-green-400 flex items-center justify-center">
                                <span className="text-white text-[10px]">✓</span>
                            </div>
                            <p className="text-xs font-medium text-green-700 whitespace-pre-line">{runMsg}</p>
                        </div>
                        <button onClick={() => setRunMsg('')} className="p-0.5 rounded hover:bg-green-200 transition-colors text-green-400 hover:text-green-600">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}

                {/* 加载中 */}
                {isLoading && (
                    <div className="flex flex-col items-center justify-center py-20">
                        <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-3" />
                        <p className="text-sm text-slate-500">加载中...</p>
                    </div>
                )}

                {/* 空状态 */}
                {!isLoading && items.length === 0 && !error && (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                        <Search className="w-12 h-12 mb-3 text-slate-300" />
                        <p className="text-sm">暂无招标数据</p>
                        <p className="text-xs mt-1">点击右上角「手动执行日常招标」按钮触发数据获取</p>
                    </div>
                )}

                {/* 数据表格 */}
                {!isLoading && items.length > 0 && (
                    <>
                        <div className="flex items-center justify-between mb-3 relative z-20">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-slate-700">检索结果</span>
                                <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded-full font-medium">
                                    共 {total} 条
                                </span>
                            </div>
                            {totalPages > 1 && (
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <button onClick={() => handlePageChange(1)} disabled={page <= 1} className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">首页</button>
                                    <button onClick={() => handlePageChange(page - 1)} disabled={page <= 1} className="p-1 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"><ChevronLeft className="w-3.5 h-3.5" /></button>
                                    <span className="px-2 text-xs text-slate-600 font-medium">{page} / {totalPages}</span>
                                    <button onClick={() => handlePageChange(page + 1)} disabled={page >= totalPages} className="p-1 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"><ChevronRight className="w-3.5 h-3.5" /></button>
                                    <button onClick={() => handlePageChange(totalPages)} disabled={page >= totalPages} className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">末页</button>
                                </div>
                            )}
                        </div>

                        <div className="overflow-x-auto bg-white rounded-lg border border-slate-200 shadow-sm">
                            <table className="w-full text-xs">
                                <thead className="bg-slate-50 sticky top-0 z-10">
                                    <tr>
                                        <th className="py-2.5 px-3 text-left font-semibold text-slate-500 border-b border-slate-200 w-[36px]">★</th>
                                        {(starredOnly ? STARRED_COLUMNS : TABLE_COLUMNS).map(col => (
                                            <th
                                                key={col.key}
                                                className={`py-2.5 px-3 font-semibold text-slate-500 border-b border-slate-200 whitespace-nowrap ${col.width || ''} ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                                            >
                                                {col.label}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((item, idx) => (
                                        <tr key={item.id || idx} className={`border-t border-slate-100 transition-colors ${
                                            item.is_starred
                                                ? 'bg-amber-50/60 hover:bg-amber-50'
                                                : 'hover:bg-blue-50/40'
                                        }`}>
                                            <td className="py-2 px-3">
                                                <button
                                                    onClick={() => handleToggleStar(item)}
                                                    className="p-0.5 rounded hover:bg-amber-100 transition-colors"
                                                    title={item.is_starred ? '取消星标' : '添加星标'}
                                                >
                                                    <Star className={`w-3.5 h-3.5 ${
                                                        item.is_starred
                                                            ? 'fill-amber-400 text-amber-400'
                                                            : 'text-slate-300 hover:text-amber-300'
                                                    }`} />
                                                </button>
                                            </td>
                                            {(starredOnly ? STARRED_COLUMNS : TABLE_COLUMNS).map(col => {
                                                const val = item[col.key];
                                                if (col.key === 'link') {
                                                    return (
                                                        <td key={col.key} className="py-2 px-3">
                                                            {val && /^https?:\/\//i.test(String(val)) ? (
                                                                <a href={String(val)} target="_blank" rel="noopener noreferrer"
                                                                   className="text-blue-500 hover:text-blue-600 inline-flex items-center gap-0.5">
                                                                    查看 <ExternalLink className="w-3 h-3" />
                                                                </a>
                                                            ) : (
                                                                <span className="text-slate-400">-</span>
                                                            )}
                                                        </td>
                                                    );
                                                }
                                                if (col.key === 'project_name' || col.key === 'bidder_name' || col.key === 'bid_no' || col.key === 'bid_id' || col.key === 'winning_company') {
                                                    return (
                                                        <td key={col.key} className="py-2 px-3 text-slate-700 max-w-[280px]" title={String(val || '')}>
                                                            <span className="whitespace-normal break-words leading-relaxed">{val || '-'}</span>
                                                        </td>
                                                    );
                                                }
                                                if (col.key === 'biz_type' || col.key === 'channel_type') {
                                                    return (
                                                        <td key={col.key} className="py-2 px-3">
                                                            {val ? (
                                                                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-600">{val}</span>
                                                            ) : (
                                                                <span className="text-slate-400">-</span>
                                                            )}
                                                        </td>
                                                    );
                                                }
                                                if (col.key === 'candidate_names') {
                                                    const names = Array.isArray(val) ? val : [];
                                                    return (
                                                        <td key={col.key} className="py-2 px-3 text-slate-700 max-w-[260px]">
                                                            <span className="whitespace-normal break-words leading-relaxed">{names.length > 0 ? names.join('、') : '-'}</span>
                                                        </td>
                                                    );
                                                }
                                                if (col.key === 'synced_at') {
                                                    let timeText = '-';
                                                    if (val) {
                                                        const dt = new Date(String(val));
                                                        if (!isNaN(dt.getTime())) {
                                                            timeText = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
                                                        } else {
                                                            timeText = String(val);
                                                        }
                                                    }
                                                    return (
                                                        <td key={col.key} className="py-2 px-3 text-slate-600">
                                                            <span className="whitespace-nowrap">{timeText}</span>
                                                        </td>
                                                    );
                                                }
                                                const isAmount = col.align === 'right';
                                                return (
                                                    <td key={col.key} className={`py-2 px-3 ${isAmount ? 'text-right font-mono text-emerald-600 font-semibold' : 'text-slate-600'}`}>
                                                        {val !== undefined && val !== null && val !== '' ? String(val) : <span className="text-slate-400">-</span>}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* 分页控件 */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between mt-3 px-1">
                                <div className="text-xs text-slate-400">
                                    显示第 {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)} 条，共 {total} 条
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <button
                                        onClick={() => handlePageChange(1)}
                                        disabled={page <= 1}
                                        className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed"
                                    >
                                        首页
                                    </button>
                                    <button
                                        onClick={() => handlePageChange(page - 1)}
                                        disabled={page <= 1}
                                        className="p-1 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed"
                                    >
                                        <ChevronLeft className="w-3.5 h-3.5" />
                                    </button>
                                    <span className="px-2 text-xs text-slate-600 font-medium">
                                        {page} / {totalPages}
                                    </span>
                                    <button
                                        onClick={() => handlePageChange(page + 1)}
                                        disabled={page >= totalPages}
                                        className="p-1 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed"
                                    >
                                        <ChevronRight className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        onClick={() => handlePageChange(totalPages)}
                                        disabled={page >= totalPages}
                                        className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed"
                                    >
                                        末页
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ─── 手动检索参数弹窗 ─── */}
            {showRunModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
                    <div className="bg-white rounded-xl shadow-2xl w-[360px] p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-bold text-slate-800">手动执行日常招标参数</h3>
                            <button onClick={() => setShowRunModal(false)} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1.5">检索时间范围（天）</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={365}
                                    value={runTimeRange}
                                    onChange={e => setRunTimeRange(Math.max(1, parseInt(e.target.value) || 1))}
                                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none"
                                />
                                <p className="text-[11px] text-slate-400 mt-1">检索最近多少天内的招标信息，默认 3 天</p>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1.5">返回标讯条数</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={1000}
                                    value={runTopN}
                                    onChange={e => setRunTopN(Math.max(1, parseInt(e.target.value) || 1))}
                                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none"
                                />
                                <p className="text-[11px] text-slate-400 mt-1">每次检索返回的最大条数，默认 100 条</p>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1.5">开始日期</label>
                                <input
                                    type="date"
                                    value={runBeginDate}
                                    onChange={e => setRunBeginDate(e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1.5">结束日期</label>
                                <input
                                    type="date"
                                    value={runEndDate}
                                    onChange={e => setRunEndDate(e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none"
                                />
                                <p className="text-[11px] text-slate-400 mt-1">开始/结束日期需同时填写，开始日期不能晚于结束日期</p>
                            </div>
                        </div>
                        {error && (
                            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-2.5 mt-4">
                                <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                                <p className="text-xs font-medium text-red-700">{error}</p>
                            </div>
                        )}
                        <div className="flex items-center justify-end gap-2 mt-6">
                            <button
                                onClick={() => setShowRunModal(false)}
                                className="px-4 py-2 text-xs font-medium border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleRun}
                                disabled={isRunning}
                                className="px-4 py-2 text-xs font-medium rounded-lg text-white bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                            >
                                {isRunning ? (
                                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 检索中...</>
                                ) : (
                                    <><Play className="w-3.5 h-3.5" /> 开始检索</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TenderSearchModule;
