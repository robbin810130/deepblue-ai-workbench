import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Search, Plus, Edit, Clock, ArrowLeft, Save, X, FileText, Eye,
    ChevronLeft, ChevronRight, Sparkles, Loader2, Users
} from 'lucide-react';
import { fetchWithAuth } from '../utils/authFetch';
import { KEY_ACCOUNT_API, KEY_ACCOUNT_AI_RUN_ENDPOINT } from '../config';
import { sysAlert } from '../utils/dialog';

// ==========================================
// 类型定义
// ==========================================
interface KeyAccount {
    id: number;
    customer_name: string;
    presales: string | null;
    basic_info: string | null;
    org_structure: string | null;
    business_needs: string | null;
    tech_integration: string | null;
    presales_pain_points: string | null;
    youshi_involvement: string | null;
    solution: string | null;
    visibility_type: string | null;
    allowed_users: string | null;
    created_by: string;
    created_at: string;
    updated_by: string;
    updated_at: string;
}

interface Snapshot {
    id: number;
    account_id: number;
    snapshot_data: Record<string, any>;
    modified_by: string;
    modified_at: string;
    customer_name?: string;
}

interface FormData {
    customer_name: string;
    presales: string;
    basic_info: string;
    org_structure: string;
    business_needs: string;
    tech_integration: string;
    presales_pain_points: string;
    youshi_involvement: string;
    solution: string;
    visibility_type: string;
    allowed_users: string;
}

type ViewMode = 'list' | 'history';

const EMPTY_FORM: FormData = {
    customer_name: '', presales: '', basic_info: '', org_structure: '',
    business_needs: '', tech_integration: '', presales_pain_points: '',
    youshi_involvement: '', solution: '', visibility_type: 'all', allowed_users: ''
};

const FIELD_LABELS: Record<keyof FormData, string> = {
    customer_name: '客户名称',
    presales: '售前',
    basic_info: '基本情况',
    org_structure: '组织架构',
    business_needs: '需求业务',
    tech_integration: '技术对接',
    presales_pain_points: '售前痛点',
    youshi_involvement: '优识介入',
    solution: '解决方案',
    visibility_type: '可见范围',
    allowed_users: '允许用户'
};

// ==========================================
// 主组件
// ==========================================
export const KeyAccountModule: React.FC = () => {
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [loading, setLoading] = useState(false);

    // 列表状态
    const [accounts, setAccounts] = useState<KeyAccount[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [keyword, setKeyword] = useState('');
    const [searchInput, setSearchInput] = useState('');

    // 编辑状态
    const [editingId, setEditingId] = useState<number | null>(null);
    const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);

    // AI 辅助状态
    const [aiPanelOpen, setAiPanelOpen] = useState(false);
    const [aiPrompt, setAiPrompt] = useState('');
    const [aiRunning, setAiRunning] = useState(false);
    const aiAbortRef = useRef<AbortController | null>(null);

    // 历史快照状态
    const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
    const [expandedSnapshot, setExpandedSnapshot] = useState<number | null>(null);

    // 查看详情弹窗
    const [viewAccount, setViewAccount] = useState<KeyAccount | null>(null);

    // ==========================================
    // 数据加载
    // ==========================================
    const fetchList = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
            if (keyword.trim()) params.append('keyword', keyword.trim());
            const res = await fetchWithAuth(`${KEY_ACCOUNT_API}?${params}`);
            const data = await res.json();
            if (data.code === 0) {
                setAccounts(data.data.list);
                setTotal(data.data.total);
            }
        } catch (err) {
            console.error('加载大客户列表失败:', err);
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, keyword]);

    useEffect(() => { fetchList(); }, [fetchList]);

    const handleSearch = () => {
        setPage(1);
        setKeyword(searchInput);
    };

    // ==========================================
    // 新增 / 编辑
    // ==========================================
    const openCreate = () => {
        setEditingId(null);
        setFormData(EMPTY_FORM);
        setAiPrompt('');
        setAiPanelOpen(false);
        setDrawerOpen(true);
    };

    const openEdit = async (id: number) => {
        try {
            const res = await fetchWithAuth(`${KEY_ACCOUNT_API}/${id}`);
            const data = await res.json();
            if (data.code === 0) {
                const row = data.data;
                setEditingId(id);
                setFormData({
                    customer_name: row.customer_name || '',
                    presales: row.presales || '',
                    basic_info: row.basic_info || '',
                    org_structure: row.org_structure || '',
                    business_needs: row.business_needs || '',
                    tech_integration: row.tech_integration || '',
                    presales_pain_points: row.presales_pain_points || '',
                    youshi_involvement: row.youshi_involvement || '',
                    solution: row.solution || '',
                    visibility_type: row.visibility_type || 'all',
                    allowed_users: row.allowed_users || ''
                });
                setAiPrompt('');
                setAiPanelOpen(false);
                setDrawerOpen(true);
            } else {
                sysAlert('加载档案失败：' + (data.message || '未知错误'));
            }
        } catch (err) {
            console.error(err);
            sysAlert('网络错误，请稍后重试');
        }
    };

    const handleSave = async () => {
        if (!formData.customer_name.trim()) {
            sysAlert('客户名称不能为空');
            return;
        }
        setSaving(true);
        try {
            const isCreate = !editingId;

            // 新增时检查客户名称是否重复
            if (isCreate) {
                try {
                    const checkRes = await fetchWithAuth(`${KEY_ACCOUNT_API}?keyword=${encodeURIComponent(formData.customer_name.trim())}&pageSize=100`);
                    const checkData = await checkRes.json();
                    if (checkData.code === 0 && checkData.data.list.some((item: KeyAccount) => item.customer_name === formData.customer_name.trim())) {
                        sysAlert(`客户名称「${formData.customer_name.trim()}」已存在，请勿重复创建`);
                        setSaving(false);
                        return;
                    }
                } catch (_) { /* 检查失败不阻断保存 */ }
            }

            const url = isCreate ? KEY_ACCOUNT_API : `${KEY_ACCOUNT_API}/${editingId}`;
            const method = isCreate ? 'POST' : 'PUT';
            const res = await fetchWithAuth(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            const data = await res.json();
            if (data.code === 0) {
                sysAlert(isCreate ? '创建成功！' : '更新成功！');
                fetchList();
                setDrawerOpen(false);
            } else {
                sysAlert((isCreate ? '创建' : '更新') + '失败：' + (data.message || ''));
            }
        } catch (err) {
            console.error(err);
            sysAlert('网络错误，请稍后重试');
        } finally {
            setSaving(false);
        }
    };

    // ==========================================
    // AI 辅助生成
    // ==========================================
    const handleAiGenerate = async () => {
        if (!aiPrompt.trim()) {
            sysAlert('请输入提示文本');
            return;
        }
        setAiRunning(true);
        const abortController = new AbortController();
        aiAbortRef.current = abortController;

        try {
            const inputs: Record<string, any> = {};
            if (aiPrompt.trim()) inputs.prompt = aiPrompt.trim();

            const res = await fetchWithAuth(KEY_ACCOUNT_AI_RUN_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inputs }),
                signal: abortController.signal
            });

            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                throw new Error(errBody.error || `请求失败 (${res.status})`);
            }

            const reader = res.body?.getReader();
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
                    if (!line.startsWith('data:')) continue;
                    const payload = line.slice(5).trim();
                    if (!payload || payload === '[DONE]') continue;
                    try {
                        const evt = JSON.parse(payload);
                        if (evt.event === 'workflow_finished' && evt.data?.outputs) {
                            let outputs = evt.data.outputs;
                            // 如果 outputs 包含 text 字段且是 JSON 字符串，尝试解析
                            if (outputs.text && typeof outputs.text === 'string') {
                                try {
                                    const parsed = JSON.parse(outputs.text);
                                    if (typeof parsed === 'object' && parsed !== null) {
                                        outputs = { ...outputs, ...parsed };
                                    }
                                } catch (_) {
                                    // text 不是 JSON，保持原样
                                }
                            }
                            // 将 Dify 返回的字段映射到表单
                            const mapping: Record<string, keyof FormData> = {
                                presales: 'presales',
                                basic_info: 'basic_info',
                                org_structure: 'org_structure',
                                business_needs: 'business_needs',
                                tech_integration: 'tech_integration',
                                presales_pain_points: 'presales_pain_points',
                                youshi_involvement: 'youshi_involvement',
                                solution: 'solution',
                                customer_name: 'customer_name'
                            };
                            let filled = false;
                            const updates: Partial<FormData> = {};
                            for (const [key, field] of Object.entries(mapping)) {
                                if (outputs[key] && String(outputs[key]).trim()) {
                                    updates[field] = String(outputs[key]);
                                    filled = true;
                                }
                            }
                            if (Object.keys(updates).length > 0) {
                                setFormData(prev => ({ ...prev, ...updates }));
                            }
                            if (filled) {
                                setAiPrompt('');
                            }
                        } else if (evt.event === 'error') {
                            const errMsg = evt.data?.err_msg || '未知错误';
                            sysAlert(`AI 生成失败：${errMsg}`);
                            setAiRunning(false);
                            aiAbortRef.current = null;
                        }
                    } catch (_) {}
                }
            }
        } catch (err: any) {
            if (err.name !== 'AbortError') {
                console.error('AI生成错误:', err);
                sysAlert(`AI 生成失败：${err.message || '网络错误'}`);
            }
        } finally {
            setAiRunning(false);
            aiAbortRef.current = null;
        }
    };

    const handleStopAi = () => {
        aiAbortRef.current?.abort();
        setAiRunning(false);
    };

    // ==========================================
    // 历史记录
    // ==========================================
    const openHistory = async (accountId: number) => {
        setExpandedSnapshot(null);
        try {
            const res = await fetchWithAuth(`${KEY_ACCOUNT_API}/${accountId}/snapshots`);
            const data = await res.json();
            if (data.code === 0) {
                setSnapshots(data.data);
                setViewMode('history');
            } else {
                sysAlert('加载历史记录失败');
            }
        } catch (err) {
            console.error(err);
            sysAlert('网络错误');
        }
    };

    const formatTime = (ts: string) => {
        if (!ts) return '-';
        return ts.replace('T', ' ').slice(0, 19);
    };

    const openView = async (acc: KeyAccount) => {
        try {
            const res = await fetchWithAuth(`${KEY_ACCOUNT_API}/${acc.id}`);
            const data = await res.json();
            if (data.code === 0) {
                setViewAccount(data.data);
            } else {
                sysAlert('加载档案详情失败');
            }
        } catch (err) {
            console.error(err);
            sysAlert('网络错误，请稍后重试');
        }
    };

    // ==========================================
    // 渲染：历史记录视图
    // ==========================================
    if (viewMode === 'history') {
        return (
            <div className="h-full flex flex-col bg-slate-50">
                {/* ─── 顶部栏 ─── */}
                <div className="px-5 py-3 border-b border-slate-200 bg-white flex-shrink-0">
                    <div className="flex items-center justify-between">
                        <button onClick={() => setViewMode('list')} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 transition-colors">
                            <ArrowLeft className="w-3.5 h-3.5" /> 返回列表
                        </button>
                        <div />
                    </div>
                </div>

                {/* ─── 快照列表 ─── */}
                <div className="flex-1 overflow-y-auto p-5">
                    {snapshots.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                            <Clock className="w-12 h-12 mb-3 text-slate-300" />
                            <p className="text-sm">暂无修改历史记录</p>
                            <p className="text-xs mt-1">每次编辑档案时会自动保存修改前的快照</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-semibold text-slate-700">历史快照</span>
                                <span className="px-2 py-0.5 bg-amber-50 text-amber-600 text-xs rounded-full font-medium">共 {snapshots.length} 条</span>
                            </div>
                            {snapshots.map(snap => {
                                const isExpanded = expandedSnapshot === snap.id;
                                return (
                                    <div key={snap.id} className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                                        <button
                                            onClick={() => setExpandedSnapshot(isExpanded ? null : snap.id)}
                                            className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                                                    <Clock className="w-4 h-4 text-amber-500" />
                                                </div>
                                                <div className="text-left">
                                                    <div className="text-xs font-semibold text-slate-700">{snap.customer_name || '档案快照'}</div>
                                                    <div className="text-[11px] text-slate-400">
                                                        修改人：{snap.modified_by || '-'} · {formatTime(snap.modified_at)}
                                                    </div>
                                                </div>
                                            </div>
                                            <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                        </button>
                                        {isExpanded && (
                                            <div className="px-4 pb-4 border-t border-slate-100 pt-3 space-y-2 bg-slate-50/50">
                                                {(Object.keys(FIELD_LABELS) as Array<keyof FormData>).filter(f => f !== 'customer_name' && f !== 'visibility_type' && f !== 'allowed_users').map(field => {
                                                    const val = snap.snapshot_data?.[field];
                                                    if (!val) return null;
                                                    return (
                                                        <div key={field} className="flex gap-2">
                                                            <span className="text-[11px] font-semibold text-slate-500 w-16 flex-shrink-0 text-right pt-px">{FIELD_LABELS[field]}</span>
                                                            <span className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed break-words flex-1 min-w-0">{val}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ==========================================
    // 渲染：列表视图 + 抽屉面板
    // ==========================================
    const totalPages = Math.ceil(total / pageSize);
    const updateField = (field: keyof FormData, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    return (
        <div className="h-full flex flex-col bg-slate-50 relative">
            {/* ─── 顶部标题 ─── */}
                <div className="px-5 py-3 border-b border-slate-200 bg-white flex-shrink-0">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
                                <Users className="w-4 h-4 text-white" />
                            </div>
                            <div>
                                <h2 className="text-sm font-bold text-slate-800">大客户档案</h2>
                                <p className="text-[11px] text-slate-400">集中管理客户信息 · AI 辅助生成档案内容</p>
                            </div>
                        </div>
                        <button onClick={openCreate} className="h-8 px-3.5 rounded-lg text-white text-xs font-medium flex items-center gap-1.5 transition-all bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700">
                            <Plus className="w-3.5 h-3.5" /> 新增档案
                        </button>
                    </div>
                </div>

                {/* ─── 筛选条件区 ─── */}
                <div className="flex-shrink-0 bg-white border-b border-slate-200 px-5 py-3">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                            <span className="text-xs text-slate-500 whitespace-nowrap">客户名称</span>
                            <input
                                type="text"
                                placeholder="输入客户名称搜索"
                                value={searchInput}
                                onChange={e => setSearchInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
                                className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-md focus:ring-1 focus:ring-blue-400 focus:border-blue-400 outline-none w-[220px]"
                            />
                        </div>
                        <button onClick={handleSearch} className="h-8 px-3 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all bg-blue-500 text-white hover:bg-blue-600">
                            <Search className="w-3.5 h-3.5" /> 搜索
                        </button>
                        <button onClick={() => { setSearchInput(''); setPage(1); setKeyword(''); }} className="h-8 px-3 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all border border-slate-200 text-slate-500 hover:bg-slate-50">
                            重置
                        </button>
                    </div>
                </div>

                {/* ─── 结果区 ─── */}
                <div className="flex-1 overflow-auto px-5 py-4">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-20">
                            <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-3" />
                            <p className="text-sm text-slate-500">加载中...</p>
                        </div>
                    ) : accounts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                            <FileText className="w-12 h-12 mb-3 text-slate-300" />
                            <p className="text-sm">暂无大客户档案数据</p>
                            <p className="text-xs mt-1">点击右上角「新增档案」按钮创建第一条记录</p>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-slate-700">档案列表</span>
                                    <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded-full font-medium">共 {total} 条</span>
                                </div>
                                {totalPages > 1 && (
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                        <button onClick={() => setPage(1)} disabled={page <= 1} className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed">首页</button>
                                        <button onClick={() => setPage(p => p - 1)} disabled={page <= 1} className="p-1 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed"><ChevronLeft className="w-3.5 h-3.5" /></button>
                                        <span className="px-2 text-xs text-slate-600 font-medium">{page} / {totalPages}</span>
                                        <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages} className="p-1 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed"><ChevronRight className="w-3.5 h-3.5" /></button>
                                        <button onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed">末页</button>
                                    </div>
                                )}
                            </div>

                            <div className="overflow-x-auto bg-white rounded-lg border border-slate-200 shadow-sm">
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50 sticky top-0 z-10">
                                        <tr>
                                            <th className="py-2.5 px-4 text-left font-semibold text-slate-500 border-b border-slate-200 min-w-[120px]">客户名称</th>
                                            <th className="py-2.5 px-4 text-left font-semibold text-slate-500 border-b border-slate-200 min-w-[160px] max-w-[290px]">售前</th>
                                            <th className="py-2.5 px-4 text-left font-semibold text-slate-500 border-b border-slate-200 min-w-[160px] max-w-[290px]">基本情况</th>
                                            <th className="py-2.5 px-4 text-left font-semibold text-slate-500 border-b border-slate-200 min-w-[100px]">数据可见性</th>
                                            <th className="py-2.5 px-4 text-left font-semibold text-slate-500 border-b border-slate-200">创建人</th>
                                            <th className="py-2.5 px-4 text-left font-semibold text-slate-500 border-b border-slate-200">创建时间</th>
                                            <th className="py-2.5 px-4 text-left font-semibold text-slate-500 border-b border-slate-200">最后修改人</th>
                                            <th className="py-2.5 px-4 text-left font-semibold text-slate-500 border-b border-slate-200">最后修改时间</th>
                                            <th className="py-2.5 px-4 text-right font-semibold text-slate-500 border-b border-slate-200">操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {accounts.map(acc => (
                                            <tr key={acc.id} className="border-t border-slate-100 hover:bg-blue-50/40 transition-colors align-top">
                                                <td className="py-2.5 px-4 text-slate-700 font-medium">{acc.customer_name}</td>
                                                <td className="py-2.5 px-4 text-slate-600 whitespace-pre-wrap break-all leading-relaxed w-[290px]">{acc.presales || '-'}</td>
                                                <td className="py-2.5 px-4 text-slate-600 whitespace-pre-wrap break-all leading-relaxed w-[290px]">{acc.basic_info || '-'}</td>
                                                <td className="py-2.5 px-4">
                                                    {acc.visibility_type === 'specific' ? (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200" title={acc.allowed_users || ''}>指定账号</span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">所有人</span>
                                                    )}
                                                </td>
                                                <td className="py-2.5 px-4 text-slate-600">{acc.created_by || '-'}</td>
                                                <td className="py-2.5 px-4 text-slate-600">{formatTime(acc.created_at)}</td>
                                                <td className="py-2.5 px-4 text-slate-600">{acc.updated_by || '-'}</td>
                                                <td className="py-2.5 px-4 text-slate-600">{formatTime(acc.updated_at)}</td>
                                                <td className="py-2.5 px-4 text-right">
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        <button onClick={() => openView(acc)} title="查看详情" className="p-1.5 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors inline-flex items-center justify-center">
                                                            <Eye className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button onClick={() => openEdit(acc.id)} title="编辑" className="p-1.5 rounded-md border border-blue-200 text-blue-500 hover:bg-blue-50 hover:text-blue-700 transition-colors inline-flex items-center justify-center">
                                                            <Edit className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button onClick={() => openHistory(acc.id)} title="历史" className="p-1.5 rounded-md border border-amber-200 text-amber-500 hover:bg-amber-50 hover:text-amber-700 transition-colors inline-flex items-center justify-center">
                                                            <Clock className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* 分页 */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-between mt-3 px-1">
                                    <div className="text-xs text-slate-400">
                                        显示第 {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)} 条，共 {total} 条
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} className="px-2 py-1 text-xs border border-slate-200 rounded bg-white">
                                            <option value={10}>10条/页</option>
                                            <option value={20}>20条/页</option>
                                            <option value={50}>50条/页</option>
                                        </select>
                                        <button onClick={() => setPage(1)} disabled={page <= 1} className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed">首页</button>
                                        <button onClick={() => setPage(p => p - 1)} disabled={page <= 1} className="p-1 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed"><ChevronLeft className="w-3.5 h-3.5" /></button>
                                        <span className="px-2 text-xs text-slate-600 font-medium">{page} / {totalPages}</span>
                                        <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages} className="p-1 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed"><ChevronRight className="w-3.5 h-3.5" /></button>
                                        <button onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed">末页</button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* ─── 抽屉遮罩层 ─── */}
                {drawerOpen && (
                    <div className="fixed inset-0 z-50 flex justify-end">
                        {/* 半透明背景 */}
                        <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => !saving && setDrawerOpen(false)} />

                        {/* 抽屉面板 */}
                        <div className="relative w-[75%] bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                            {/* 抽屉顶部 */}
                            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
                                <h3 className="text-sm font-bold text-slate-800">{editingId ? '编辑档案' : '新增档案'}</h3>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setAiPanelOpen(!aiPanelOpen)}
                                        className={`h-7 px-2.5 rounded-md text-[11px] font-medium flex items-center gap-1 transition-all border ${aiPanelOpen ? 'border-purple-200 bg-purple-50 text-purple-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                                    >
                                        <Sparkles className="w-3 h-3" /> AI 辅助
                                    </button>
                                    <button onClick={() => !saving && setDrawerOpen(false)} className="h-7 px-3 rounded-md text-[11px] font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">取消</button>
                                    <button onClick={handleSave} disabled={saving} className="h-7 px-3 rounded-md text-white text-[11px] font-medium flex items-center gap-1 transition-all bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
                                        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} 保存
                                    </button>
                                </div>
                            </div>

                            {/* 抽屉内容区 */}
                            <div className="flex-1 flex flex-col overflow-hidden">
                                {/* 表单区 */}
                                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                                    {/* 客户名称 */}
                                    <div className="w-1/2">
                                        <label className="block text-xs font-medium text-slate-500 mb-1.5">客户名称 <span className="text-red-400">*</span></label>
                                        <input
                                            type="text"
                                            value={formData.customer_name}
                                            onChange={e => updateField('customer_name', e.target.value)}
                                            disabled={aiRunning}
                                            placeholder="请输入客户名称"
                                            className="w-full px-3 py-2 text-sm font-medium border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                                        />
                                    </div>

                                    {/* 全部字段 — 双列紧凑网格 */}
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                                        {(Object.keys(FIELD_LABELS) as Array<keyof FormData>).filter(f => f !== 'customer_name' && f !== 'visibility_type' && f !== 'allowed_users').map(field => (
                                            <div key={field} className="flex flex-col">
                                                <label className="block text-xs font-medium text-slate-500 mb-1">{FIELD_LABELS[field]}</label>
                                                <textarea
                                                    value={formData[field]}
                                                    onChange={e => updateField(field, e.target.value)}
                                                    disabled={aiRunning}
                                                    placeholder={`请输入${FIELD_LABELS[field]}`}
                                                    rows={3}
                                                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none resize-none min-h-[60px] bg-white leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
                                                />
                                            </div>
                                        ))}
                                    </div>

                                    {/* 数据可见性配置 */}
                                    <div className="border-t border-slate-100 pt-3">
                                        <div className="flex items-end gap-3">
                                            <div className="w-1/2">
                                                <label className="block text-xs font-medium text-slate-500 mb-1.5">数据可见性</label>
                                                <select
                                                    value={formData.visibility_type}
                                                    onChange={e => updateField('visibility_type', e.target.value)}
                                                    disabled={aiRunning}
                                                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    <option value="all">所有人可见</option>
                                                    <option value="specific">指定账号可见</option>
                                                </select>
                                            </div>
                                        </div>
                                        {formData.visibility_type === 'specific' && (
                                            <div className="mt-3">
                                                <label className="block text-xs font-medium text-slate-500 mb-1.5">允许查看的账号 <span className="text-slate-400 font-normal">（多个账号用逗号或换行分隔）</span></label>
                                                <textarea
                                                    value={formData.allowed_users}
                                                    onChange={e => updateField('allowed_users', e.target.value)}
                                                    disabled={aiRunning}
                                                    placeholder="例如：zhangsan, lisi, wangwu"
                                                    rows={2}
                                                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none resize-none bg-white leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
                                                />
                                                <p className="mt-1 text-[11px] text-slate-400">* 创建人和修改人会自动加入允许列表，确保您始终可以查看自己创建/编辑的档案</p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* AI 辅助面板（底部折叠区） */}
                                {aiPanelOpen && (
                                    <div className="border-t border-slate-200 bg-slate-50/80 flex-shrink-0">
                                        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="w-5 h-5 rounded bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
                                                    <Sparkles className="w-3 h-3 text-white" />
                                                </div>
                                                <span className="text-xs font-bold text-slate-700">AI 辅助生成</span>
                                            </div>
                                            <button onClick={() => setAiPanelOpen(false)} className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors">
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                        <div className="p-4 space-y-3 max-h-64 overflow-y-auto">
                                            {/* 输入框容器：textarea + 内置按钮 */}
                                            <div className="relative border border-slate-200 rounded-lg bg-white focus-within:ring-2 focus-within:ring-purple-400 focus-within:border-purple-400">
                                                <textarea
                                                    value={aiPrompt}
                                                    onChange={e => setAiPrompt(e.target.value)}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter' && !e.shiftKey && aiPrompt.trim() && !aiRunning) {
                                                            e.preventDefault();
                                                            handleAiGenerate();
                                                        }
                                                    }}
                                                    disabled={aiRunning}
                                                    placeholder={`描述客户背景，AI 将自动生成各字段内容...\n\n示例：杭州某某科技有限公司，智能制造行业，500-1000人规模，年营收3.2亿元，位于杭州市余杭区未来科技城。主要做精密零部件加工，需要ERP系统管理生产计划和库存。`}
                                                    rows={4}
                                                    className="w-full px-3 py-2.5 pb-12 text-sm rounded-lg outline-none resize-none bg-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                                                />
                                                {/* 内置按钮区 */}
                                                <div className="absolute bottom-2 right-2 flex items-center gap-2">
                                                    <button
                                                        onClick={aiRunning ? handleStopAi : handleAiGenerate}
                                                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] text-white font-medium transition-all ${aiRunning ? 'bg-gradient-to-r from-red-500 to-rose-600' : 'bg-gradient-to-r from-purple-500 to-violet-600'}`}
                                                    >
                                                        {aiRunning ? <><X className="w-3 h-3" /> 停止生成</> : <><Sparkles className="w-3 h-3" /> 生成</>}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* ─── 查看详情弹窗 ─── */}
                {viewAccount && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center">
                        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setViewAccount(null)} />
                        <div className="relative bg-white rounded-xl shadow-2xl w-[600px] max-h-[80vh] flex flex-col">
                            {/* 弹窗顶部 */}
                            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
                                <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
                                        <Users className="w-3.5 h-3.5 text-white" />
                                    </div>
                                    <h3 className="text-sm font-bold text-slate-800">{viewAccount.customer_name}</h3>
                                </div>
                                <button onClick={() => setViewAccount(null)} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            {/* 弹窗内容 */}
                            <div className="flex-1 overflow-y-auto p-5 space-y-4">
                                {/* 可见性信息 */}
                                <div className="flex gap-3">
                                    <span className="text-xs font-semibold text-slate-500 w-20 flex-shrink-0 text-right pt-0.5">可见性</span>
                                    <span className="text-sm text-slate-700">
                                        {viewAccount.visibility_type === 'specific' ? `指定账号可见${viewAccount.allowed_users ? `（${viewAccount.allowed_users}）` : ''}` : '所有人可见'}
                                    </span>
                                </div>
                                {(Object.keys(FIELD_LABELS) as Array<keyof FormData>).filter(f => f !== 'customer_name' && f !== 'visibility_type' && f !== 'allowed_users').map(field => {
                                    const val = viewAccount[field];
                                    if (!val) return null;
                                    return (
                                        <div key={field} className="flex gap-3">
                                            <span className="text-xs font-semibold text-slate-500 w-20 flex-shrink-0 text-right pt-0.5">{FIELD_LABELS[field]}</span>
                                            <span className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed break-words flex-1 min-w-0">{val}</span>
                                        </div>
                                    );
                                })}
                                {!Object.keys(FIELD_LABELS).filter(f => f !== 'customer_name' && viewAccount[f as keyof FormData]).length && (
                                    <div className="text-center py-8 text-slate-400 text-sm">暂无详细信息</div>
                                )}
                            </div>
                            {/* 弹窗底部 */}
                            <div className="px-5 py-3 border-t border-slate-200 flex justify-end flex-shrink-0">
                                <button onClick={() => setViewAccount(null)} className="h-8 px-4 rounded-lg text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                                    关闭
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );

};

export default KeyAccountModule;
