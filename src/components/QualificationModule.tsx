import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
    Search, Plus, RefreshCw, Download, FileBadge, Calendar, Image as ImageIcon,
    User, Edit, Trash2, X, UploadCloud, CheckCircle2, AlertCircle, FileText, Globe, FileInput,
    ChevronDown, ChevronRight, Users, Building2, ShieldCheck, PackageCheck
} from 'lucide-react';
import { sysAlert, sysConfirm } from '../utils/dialog';
import { fetchWithAuth } from '../utils/authFetch';

// ==========================================
// Mock 数据类型与数据
// ==========================================
interface Employee {
    id: string;
    name: string;
    empNo: string;
}

interface Category {
    id: number;
    parent_type: 'CUSTOMER' | 'SUPPLIER' | 'COMPANY';
    name: string;
}

interface Qualification {
    id: string;
    empId: string | null;
    parentType: string;
    categoryId: number | null;
    name: string;
    certNo: string;
    issuer: string;
    region: string;
    category: string;
    effectiveDate: string;
    expiryDate: string;
    reminderDays: number;
    status: 'normal' | 'expiring' | 'expired';
    thumbnailUrl: string;
}

// ==========================================
// 主组件
// ==========================================
const QualificationModule: React.FC = () => {
    // --- State ---
    const [qualifications, setQualifications] = useState<Qualification[]>([]);

    // 树形导航状态
    const [selectedNav, setSelectedNav] = useState<{ parentType: string; nodeId: string | null }>({ parentType: 'PRODUCT', nodeId: null });
    const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({ PRODUCT: false, EMP: false, CUSTOMER: false, SUPPLIER: false, COMPANY: false });

    const [selectedQualId, setSelectedQualId] = useState<string | null>(null);
    const [empSearchQuery, setEmpSearchQuery] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    // 批量设置提醒弹窗状态
    const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
    // 内部新建分类弹窗状态
    const [createCatModal, setCreateCatModal] = useState<{ parentType: 'CUSTOMER' | 'SUPPLIER' | 'COMPANY' } | null>(null);

    const [realEmployees, setRealEmployees] = useState<Employee[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);

    // 全局检索
    const [globalSearch, setGlobalSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    const fetchQuals = async () => {
        try {
            const res = await fetchWithAuth('/api/qualifications');
            const data = await res.json();
            if (data.success && Array.isArray(data.data)) {
                // 防御性日期清理，防止后端因未重启而旧返回带T的数据
                const safeDate = (val: string) => (val && val.includes('T')) ? val.split('T')[0] : val;

                const formattedList = data.data.map((q: any) => ({
                    ...q,
                    effectiveDate: safeDate(q.effectiveDate),
                    expiryDate: safeDate(q.expiryDate)
                }));
                setQualifications(formattedList);
            }
        } catch (e) { }
    };

    useEffect(() => {
        fetchQuals();
    }, []);

    // --- Data Fetching ---
    useEffect(() => {
        fetchWithAuth('/api/admin/users/minimal')
            .then(res => res.json())
            .then(data => {
                if (data.success && Array.isArray(data.data)) {
                    const users = data.data.map((u: any) => ({
                        id: u.id.toString(),
                        name: u.display_name || u.username,
                        empNo: u.username
                    }));
                    setRealEmployees(users);
                }
            })
            .catch(err => console.error("Failed to fetch real users:", err));
    }, []);

    useEffect(() => {
        fetchWithAuth('/api/qualifications/categories')
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    setCategories(data.data || []);
                }
            })
            .catch(err => console.error("Failed to fetch categories:", err));
    }, []);

    // --- Computed Data ---
    const filteredEmployees = useMemo(() => {
        return realEmployees.filter(emp =>
            emp.name.toLowerCase().includes(empSearchQuery.toLowerCase()) ||
            emp.empNo.toLowerCase().includes(empSearchQuery.toLowerCase())
        );
    }, [empSearchQuery, realEmployees]);

    const activeQualifications = useMemo(() => {
        if (!selectedNav.nodeId) return [];
        return qualifications.filter(q => {
            if (q.parentType !== selectedNav.parentType) return false;
            if (q.parentType === 'EMP' || q.parentType === 'PRODUCT') {
                return String(q.empId) === String(selectedNav.nodeId);
            } else {
                return String(q.categoryId) === String(selectedNav.nodeId);
            }
        });
    }, [selectedNav, qualifications]);

    const selectedQualification = useMemo(() => {
        return qualifications.find(q => q.id === selectedQualId) || null;
    }, [selectedQualId, qualifications]);

    const currentEmployee = useMemo(() => {
        if (selectedNav.parentType === 'EMP' || selectedNav.parentType === 'PRODUCT') {
            return realEmployees.find(e => e.id === selectedNav.nodeId) || null;
        }
        return null;
    }, [selectedNav, realEmployees]);

    const qualStats = useMemo(() => {
        return {
            total: activeQualifications.length,
            normal: activeQualifications.filter(q => q.status === 'normal').length,
            expiring: activeQualifications.filter(q => q.status === 'expiring').length,
            expired: activeQualifications.filter(q => q.status === 'expired').length,
        };
    }, [activeQualifications]);

    // --- Handlers ---
    const handleSelectNav = (parentType: string, nodeId: string) => {
        if (selectedNav.parentType !== parentType || selectedNav.nodeId !== nodeId) {
            setSelectedNav({ parentType, nodeId });
            setSelectedQualId(null); // Reset detail view
        }
    };

    const handleToggleParent = (parentType: string) => {
        // 切换或收起大类时，退出当前分类明细，防止误传
        setSelectedNav({ parentType: '', nodeId: null });
        setSelectedQualId(null);
        setExpandedParents(prev => ({ ...prev, [parentType]: !prev[parentType] }));
    };

    const handleCreateCategory = (parentType: 'CUSTOMER' | 'SUPPLIER' | 'COMPANY', e: React.MouseEvent) => {
        e.stopPropagation();
        setCreateCatModal({ parentType });
    };

    const handleSaveCategory = async (parentType: string, name: string) => {
        try {
            const res = await fetchWithAuth('/api/qualifications/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parentType, name: name.trim() })
            });
            const data = await res.json();
            if (data.success) {
                sysAlert('分类创建成功');
                fetchWithAuth('/api/qualifications/categories')
                    .then(r => r.json())
                    .then(d => { if (d.success) setCategories(d.data || []); });
            } else {
                sysAlert('分类创建失败: ' + data.message);
            }
        } catch (err) {
            sysAlert('网络错误');
        }
        setCreateCatModal(null);
    };

    // 全局检索过滤
    const globalFilteredQuals = useMemo(() => {
        if (!globalSearch.trim() && !statusFilter) return null; // null = no filter active
        return qualifications.filter(q => {
            const matchSearch = !globalSearch.trim() ||
                q.name.toLowerCase().includes(globalSearch.toLowerCase()) ||
                q.certNo.toLowerCase().includes(globalSearch.toLowerCase());
            const matchStatus = !statusFilter || q.status === statusFilter;
            return matchSearch && matchStatus;
        });
    }, [globalSearch, statusFilter, qualifications]);

    const StatusBadge = ({ status }: { status: string }) => {
        if (status === 'normal') return <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-bold border border-emerald-200">正常有效</span>;
        if (status === 'expiring') return <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-bold border border-amber-200">即将过期</span>;
        return <span className="px-2 py-0.5 bg-rose-100 text-rose-700 rounded text-xs font-bold border border-rose-200">已过期</span>;
    };

    return (
        <div className="flex flex-col w-full h-full bg-slate-50 relative font-sans">
            {/* ========================================== */}
            {/* 顶部全局操作栏 */}
            {/* ========================================== */}
            <div className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 shadow-sm z-10">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-indigo-600 font-black text-lg mr-4 drop-shadow-sm">
                        <FileBadge className="w-6 h-6" /> 资质管理中心
                    </div>

                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            value={globalSearch}
                            onChange={e => setGlobalSearch(e.target.value)}
                            onKeyDown={e => e.key === 'Escape' && setGlobalSearch('')}
                            placeholder="全局检索资质名称或编号..."
                            className="bg-slate-100 text-sm rounded-lg pl-9 pr-4 py-2 w-72 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all border border-transparent focus:bg-white focus:border-indigo-300"
                        />
                        {globalSearch && (
                            <button onClick={() => setGlobalSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                        className="bg-slate-100 text-sm rounded-lg px-4 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 cursor-pointer border border-transparent hover:border-slate-300 transition-all"
                    >
                        <option value="">所有资质状态</option>
                        <option value="normal">正常有效</option>
                        <option value="expiring">即将过期</option>
                        <option value="expired">已过期</option>
                    </select>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => {
                            const btn = document.activeElement as HTMLElement;
                            if (btn) btn.blur();
                            setSelectedQualId(null);
                            fetchQuals();
                            sysAlert('已同步最新资质数据...');
                        }}
                        className="p-2 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 rounded-lg transition-colors border border-transparent" title="刷新数据">
                        <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => sysAlert('正在生成资质数据报表，请稍后在下载中心查看。')}
                        className="p-2 text-slate-500 hover:bg-slate-100 hover:text-indigo-600 rounded-lg transition-colors border border-transparent" title="导出报表">
                        <Download className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setIsBatchModalOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm bg-slate-100 text-slate-700 hover:bg-slate-200 transition-all border border-slate-200" title="批量设置系统提前提醒">
                        <AlertCircle className="w-4 h-4 text-amber-500" />
                        批量设置提醒
                    </button>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        disabled={!selectedNav.nodeId}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all shadow-sm
                            ${selectedNav.nodeId
                                ? 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0'
                                : 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300/50'}`}
                    >
                        <Plus className="w-4 h-4" />
                        上传文件
                    </button>
                </div>
            </div>

            {/* ========================================== */}
            {/* 三栏式主体布局 */}
            {/* ========================================== */}
            <div className="flex-1 flex min-h-0 overflow-hidden">

                {/* 1. 左侧区域：折叠树形列表 (20%) */}
                <div className="w-[20%] flex flex-col bg-white border-r border-slate-200 z-0">
                    <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">

                        {/* 动态渲染非员工父类 */}
                        {[
                            { type: 'CUSTOMER', label: '客户资质', icon: <Users className="w-4 h-4" /> },
                            { type: 'SUPPLIER', label: '供应商资质', icon: <Building2 className="w-4 h-4" /> },
                            { type: 'COMPANY', label: '公司资质', icon: <ShieldCheck className="w-4 h-4" /> }
                        ].map((parent) => {
                            const cats = categories.filter(c => c.parent_type === parent.type);
                            const isExpanded = expandedParents[parent.type];
                            return (
                                <div key={parent.type} className="mb-2">
                                    <div
                                        className="w-full flex items-center justify-between p-2 rounded-xl border border-transparent hover:bg-slate-50 cursor-pointer text-slate-800 font-black tracking-tight group transition-all"
                                        onClick={() => handleToggleParent(parent.type)}
                                    >
                                        <div className="flex items-center gap-2.5">
                                            <div className={`w-1.5 h-4 rounded-full transition-colors ${isExpanded ? 'bg-indigo-500' : 'bg-slate-300'}`} />
                                            <div className="flex items-center gap-1.5 relative">
                                                <span className={`${isExpanded ? 'text-indigo-600' : 'text-slate-500'}`}>{parent.icon}</span>
                                                <span>{parent.label}</span>
                                                {!isExpanded && qualifications.some(q => q.parentType === parent.type && (q.status === 'expiring' || q.status === 'expired')) && (
                                                    <span className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-rose-500 shadow-sm animate-pulse" />
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center text-slate-400 group-hover:text-indigo-500 transition-colors">
                                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                        </div>
                                    </div>

                                    {isExpanded && (
                                        <div className="pl-6 pr-2 pt-1 pb-2 space-y-1 border-l-2 border-slate-100 ml-4 mt-1">
                                            {cats.length === 0 ? (
                                                <div className="text-xs text-slate-400 font-bold p-2 opacity-60">暂无自定义分类</div>
                                            ) : (
                                                cats.map(cat => {
                                                    const isSelected = selectedNav.parentType === parent.type && selectedNav.nodeId === String(cat.id);
                                                    const hasAlert = qualifications.some(q => q.parentType === parent.type && String(q.categoryId) === String(cat.id) && (q.status === 'expiring' || q.status === 'expired'));
                                                    return (
                                                        <button
                                                            key={cat.id}
                                                            onClick={() => handleSelectNav(parent.type, String(cat.id))}
                                                            className={`w-full flex items-center gap-2 p-2.5 text-left rounded-lg transition-all duration-200 group
                                                            ${isSelected ? 'bg-indigo-50 text-indigo-700 font-bold' : 'bg-transparent text-slate-600 hover:bg-slate-50 font-medium'}`}
                                                        >
                                                            <Globe className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-indigo-500' : 'text-slate-400 group-hover:text-indigo-400'}`} />
                                                            <span className="text-[13px] truncate flex-1">{cat.name}</span>
                                                            {hasAlert && <span className="w-2 h-2 rounded-full bg-rose-500 shadow-sm" title="有临近或已过期的资质" />}
                                                        </button>
                                                    );
                                                })
                                            )}

                                            {/* 新建分类按钮移至此处 */}
                                            <button
                                                onClick={(e) => handleCreateCategory(parent.type as any, e)}
                                                className="w-full flex items-center gap-2 p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50/50 rounded-lg transition-all text-xs font-bold border border-dashed border-transparent hover:border-indigo-200 mt-1"
                                            >
                                                <Plus className="w-3.5 h-3.5" />
                                                <span>新建分类</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {/* 员工相关大类 (按照人员分组) */}
                        {[
                            { type: 'EMP', label: '员工资质', icon: <User className="w-4 h-4" /> },
                            { type: 'PRODUCT', label: '产品资质', icon: <PackageCheck className="w-4 h-4" /> }
                        ].map((staffParent) => (
                            <div key={staffParent.type} className="mb-2">
                                <div
                                    className="w-full flex items-center justify-between p-2 rounded-xl border border-transparent hover:bg-slate-50 cursor-pointer text-slate-800 font-black tracking-tight group transition-all"
                                    onClick={() => handleToggleParent(staffParent.type)}
                                >
                                    <div className="flex items-center gap-2.5">
                                        <div className={`w-1.5 h-4 rounded-full transition-colors ${expandedParents[staffParent.type] ? 'bg-indigo-500' : 'bg-slate-300'}`} />
                                        <div className="flex items-center gap-1.5 relative">
                                            <span className={`${expandedParents[staffParent.type] ? 'text-indigo-600' : 'text-slate-500'}`}>{staffParent.icon}</span>
                                            <span>{staffParent.label}</span>
                                            {!expandedParents[staffParent.type] && qualifications.some(q => q.parentType === staffParent.type && (q.status === 'expiring' || q.status === 'expired')) && (
                                                <span className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-rose-500 shadow-sm animate-pulse" />
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-slate-400 group-hover:text-indigo-500 transition-colors">
                                        {expandedParents[staffParent.type] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                    </div>
                                </div>

                                {expandedParents[staffParent.type] && (
                                    <div className="pl-6 pr-2 pt-2 border-l-2 border-slate-100 ml-4 mt-1">
                                        <div className="relative mb-3">
                                            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                            <input
                                                type="text"
                                                value={empSearchQuery}
                                                onChange={(e) => setEmpSearchQuery(e.target.value)}
                                                placeholder="搜索人员..."
                                                className="w-full bg-slate-50 border border-slate-200 text-xs rounded-lg pl-8 pr-3 py-1.5 flex-1 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all font-medium"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            {filteredEmployees.length === 0 ? (
                                                <div className="flex flex-col items-center justify-center p-4 text-slate-400 opacity-60">
                                                    <User className="w-6 h-6 mb-1.5" />
                                                    <span className="text-[10px] font-bold">无匹配</span>
                                                </div>
                                            ) : (
                                                filteredEmployees.map(emp => {
                                                    const isSelected = selectedNav.parentType === staffParent.type && selectedNav.nodeId === emp.id;
                                                    const hasAlert = qualifications.some(q => q.parentType === staffParent.type && String(q.empId) === String(emp.id) && (q.status === 'expiring' || q.status === 'expired'));
                                                    return (
                                                        <button
                                                            key={emp.id}
                                                            onClick={() => handleSelectNav(staffParent.type, emp.id)}
                                                            className={`w-full flex items-center gap-3 p-2 text-left rounded-lg transition-all duration-200 group
                                                            ${isSelected ? 'bg-indigo-50' : 'bg-transparent hover:bg-slate-50'}`}
                                                        >
                                                            <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 relative
                                                            ${isSelected ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 group-hover:bg-indigo-100 group-hover:text-indigo-600 border border-slate-200'}`}>
                                                                {emp.name.charAt(0)}
                                                                {hasAlert && <span className="absolute -top-[2px] -right-[2px] w-2.5 h-2.5 rounded-full bg-rose-500 border-2 border-white" />}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <p className={`text-[13px] font-bold truncate ${isSelected ? 'text-indigo-800' : 'text-slate-700'}`}>{emp.name}</p>
                                                                <p className="text-[10px] text-slate-400 truncate font-mono">{emp.empNo}</p>
                                                            </div>
                                                        </button>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* 2. 中间区域：资质卡片 (30%) */}
                <div className="w-[30%] flex flex-col bg-slate-50/50 border-r border-slate-200 relative">
                    {globalFilteredQuals !== null ? (
                        // 全局检索模式
                        <>
                            <div className="p-4 border-b border-slate-200 bg-white shrink-0 flex items-center justify-between">
                                <div className="flex flex-col">
                                    <span className="text-xs text-slate-500 font-bold uppercase tracking-widest mb-1">全局检索结果</span>
                                    <span className="text-xl font-black text-slate-800">{globalFilteredQuals.length} <span className="text-xs font-bold text-slate-400 ml-0.5">份檔案</span></span>
                                </div>
                                <button onClick={() => { setGlobalSearch(''); setStatusFilter(''); }} className="text-xs text-indigo-500 hover:text-indigo-700 font-bold border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-50 transition">清除筛选</button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                                {globalFilteredQuals.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center p-12 text-slate-400 text-center opacity-60">
                                        <Search className="w-10 h-10 mb-3" />
                                        <span className="text-sm font-bold text-slate-600 mb-1">未找到匹配的资质</span>
                                    </div>
                                ) : (
                                    globalFilteredQuals.map(q => (
                                        <button
                                            key={q.id}
                                            onClick={() => setSelectedQualId(q.id)}
                                            className={`w-full text-left bg-white rounded-2xl p-4 border transition-all duration-300 shadow-sm flex gap-4 group
                                                ${selectedQualId === q.id ? 'border-indigo-400 shadow-md ring-4 ring-indigo-500/10' : 'border-slate-200 hover:border-indigo-300 hover:shadow-md'}`}
                                        >
                                            <div className="w-20 h-20 rounded-xl bg-slate-100 shrink-0 border border-slate-200 overflow-hidden relative flex flex-col items-center justify-center">
                                                {q.thumbnailUrl?.toLowerCase().endsWith('.pdf') ? (
                                                    <><FileText className="w-7 h-7 text-rose-500/80 mb-1" /><span className="text-[9px] font-black text-white bg-rose-500/90 px-1.5 rounded-sm absolute bottom-2">PDF</span></>
                                                ) : (
                                                    <img src={q.thumbnailUrl || 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=300&q=80'} alt="prev" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0 flex flex-col pt-0.5">
                                                <div className="flex justify-between items-start mb-1">
                                                    <h4 className="text-sm font-black text-slate-800 truncate pr-2">{q.name}</h4>
                                                    <StatusBadge status={q.status} />
                                                </div>
                                                <div className="text-[11px] text-slate-500 font-medium space-y-1">
                                                    <p className="truncate"><span className="text-slate-400">适用:</span> {q.region} · {q.category}</p>
                                                    <p className="truncate"><span className="text-slate-400">有效期至:</span> {q.expiryDate}</p>
                                                </div>
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>
                        </>
                    ) : !selectedNav.nodeId ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 opacity-40 bg-white z-20">
                            <FileBadge className="w-16 h-16 mb-4" />
                            <p className="text-base font-black">请先选中左侧类目</p>
                        </div>
                    ) : (
                        <>
                            <div className="p-4 border-b border-slate-200 bg-white shrink-0 flex items-center justify-between">
                                <div className="flex flex-col">
                                    <span className="text-xs text-slate-500 font-bold uppercase tracking-widest mb-1">资质概览</span>
                                    <span className="text-xl font-black text-slate-800">{qualStats.total} <span className="text-xs font-bold text-slate-400 ml-0.5">份档案</span></span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="flex flex-col items-center bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100">
                                        <span className="text-[10px] text-emerald-600 font-bold">正常</span>
                                        <span className="text-sm font-black text-emerald-700">{qualStats.normal}</span>
                                    </div>
                                    <div className="flex flex-col items-center bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-100">
                                        <span className="text-[10px] text-amber-600 font-bold">临期</span>
                                        <span className="text-sm font-black text-amber-700">{qualStats.expiring}</span>
                                    </div>
                                    <div className="flex flex-col items-center bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-100">
                                        <span className="text-[10px] text-rose-600 font-bold">过期</span>
                                        <span className="text-sm font-black text-rose-700">{qualStats.expired}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                                {activeQualifications.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center p-12 text-slate-400 text-center opacity-60">
                                        <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 flex items-center justify-center mb-4 shadow-sm"><FileText className="w-8 h-8" /></div>
                                        <span className="text-sm font-bold text-slate-600 mb-1">当前类目暂无资质数据</span>
                                        <span className="text-xs text-slate-400">点击右上角"上传文件"录入</span>
                                    </div>
                                ) : (
                                    activeQualifications.map(q => (
                                        <button
                                            key={q.id}
                                            onClick={() => setSelectedQualId(q.id)}
                                            className={`w-full text-left bg-white rounded-2xl p-4 border transition-all duration-300 shadow-sm flex gap-4 group
                                                ${selectedQualId === q.id ? 'border-indigo-400 shadow-md ring-4 ring-indigo-500/10' : 'border-slate-200 hover:border-indigo-300 hover:shadow-md'}`}
                                        >
                                            <div className="w-20 h-20 rounded-xl bg-slate-100 shrink-0 border border-slate-200 overflow-hidden relative flex flex-col items-center justify-center">
                                                {q.thumbnailUrl?.toLowerCase().endsWith('.pdf') ? (
                                                    <>
                                                        <FileText className="w-7 h-7 text-rose-500/80 group-hover:scale-110 transition-transform duration-500 mb-1" />
                                                        <span className="text-[9px] font-black tracking-widest text-white bg-rose-500/90 px-1.5 rounded-sm absolute bottom-2">PDF</span>
                                                    </>
                                                ) : (
                                                    <img src={q.thumbnailUrl || 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=300&q=80'} alt="prev" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0 flex flex-col pt-0.5">
                                                <div className="flex justify-between items-start mb-1">
                                                    <h4 className="text-sm font-black text-slate-800 truncate pr-2">{q.name}</h4>
                                                    <StatusBadge status={q.status} />
                                                </div>
                                                <div className="text-[11px] text-slate-500 font-medium space-y-1 mb-2">
                                                    <p className="truncate"><span className="text-slate-400">适用:</span> {q.region} · {q.category}</p>
                                                    <p className="truncate"><span className="text-slate-400">有效期至:</span> {q.expiryDate}</p>
                                                </div>
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* 3. 右侧区域：详情与预览 (50%) */}
                <div className="w-[50%] flex flex-col bg-white border-l border-slate-100 z-0 relative">
                    {!selectedQualId ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 opacity-30 bg-slate-50/50 z-20 shadow-inner">
                            <ImageIcon className="w-20 h-20 mb-6" />
                            <p className="text-lg font-black tracking-widest uppercase">请在左侧选择查看对应资质</p>
                        </div>
                    ) : (
                        <>
                            {/* 左侧：详细信息区域为主 */}
                            <div className="flex-1 flex flex-col bg-white overflow-hidden">
                                <div className="p-8 border-b border-slate-100 shrink-0 relative pb-10">
                                    <div className="flex items-start gap-4 pr-32">
                                        <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 mt-1">
                                            <FileBadge className="w-7 h-7 text-indigo-600" />
                                        </div>
                                        <div className="flex flex-col">
                                            <h3 className="text-2xl font-black text-slate-800 tracking-tight leading-tight">{selectedQualification?.name}</h3>
                                            <p className="text-sm text-slate-400 font-mono mt-1.5 flex items-center gap-2">
                                                <span>NO. {selectedQualification?.certNo}</span>
                                                <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                                                <StatusBadge status={selectedQualification?.status || 'normal'} />
                                            </p>
                                        </div>
                                    </div>

                                    {/* 右上角缩略图 */}
                                    <div className="absolute right-8 top-8 w-28 h-28 rounded-xl border border-slate-200 overflow-hidden shadow-sm group cursor-pointer bg-slate-50 flex items-center justify-center" onClick={() => {
                                        if (selectedQualification?.thumbnailUrl) {
                                            window.open(selectedQualification.thumbnailUrl, '_blank');
                                        } else {
                                            sysAlert('暂无原件文件...');
                                        }
                                    }}>
                                        {selectedQualification?.thumbnailUrl?.toLowerCase().endsWith('.pdf') ? (
                                            <>
                                                <FileText className="w-10 h-10 text-rose-500/80 group-hover:scale-110 transition-transform duration-500 mb-1.5" />
                                                <span className="text-[10px] font-black tracking-wider text-rose-600 bg-rose-100 px-2 py-0.5 rounded border border-rose-200/50 group-hover:scale-110 transition-transform duration-500">PDF Document</span>
                                            </>
                                        ) : (
                                            <img src={selectedQualification?.thumbnailUrl || 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=300&q=80'} alt="Thumbnail preview" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                                        )}
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <Search className="w-6 h-6 text-white drop-shadow-md" />
                                        </div>
                                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[10px] text-white text-center py-0.5 font-bold tracking-widest uppercase opacity-0 group-hover:opacity-100 transition-opacity">查看原件</div>
                                    </div>
                                </div>

                                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-slate-50/30">
                                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                                        <div className="w-1 h-3 bg-indigo-500 rounded-full" />
                                        产品资质详情信息
                                    </h4>

                                    <div className="grid grid-cols-2 gap-y-8 gap-x-12">
                                        {selectedQualification?.parentType === 'PRODUCT' && (
                                            <>
                                                <div className="flex flex-col gap-1.5">
                                                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">认证地区 / 市场</span>
                                                    <span className="text-base font-black text-slate-800 flex items-center gap-2">
                                                        <Globe className="w-4 h-4 text-slate-400" /> {selectedQualification?.region}
                                                    </span>
                                                </div>
                                                <div className="flex flex-col gap-1.5">
                                                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">产品使用品类</span>
                                                    <span className="text-base font-black text-slate-800 flex items-center gap-2">
                                                        <FileText className="w-4 h-4 text-slate-400" /> {selectedQualification?.category}
                                                    </span>
                                                </div>
                                            </>
                                        )}
                                        <div className="flex flex-col gap-1.5">
                                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">发证机构</span>
                                            <span className="text-base font-black text-slate-800">{selectedQualification?.issuer}</span>
                                        </div>
                                        {currentEmployee && (
                                            <div className="flex flex-col gap-1.5">
                                                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">所属员工</span>
                                                <span className="text-base font-black text-indigo-600 flex items-center gap-2">
                                                    <User className="w-4 h-4 text-indigo-500" /> {currentEmployee?.name}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="my-8 border-t border-slate-200 border-dashed" />

                                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                                        <div className="w-1 h-3 bg-amber-500 rounded-full" />
                                        有效期管理
                                    </h4>

                                    <div className="grid grid-cols-3 gap-y-6 gap-x-8">
                                        <div className="flex flex-col gap-1.5">
                                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">生效起始日期</span>
                                            <span className="text-sm font-black text-slate-800 flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-3 py-1.5 w-fit">
                                                <Calendar className="w-3.5 h-3.5 text-slate-400" /> {selectedQualification?.effectiveDate}
                                            </span>
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">失效截止日期</span>
                                            <span className="text-sm font-black text-slate-800 flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-3 py-1.5 w-fit">
                                                <Calendar className="w-3.5 h-3.5 text-rose-400" /> {selectedQualification?.expiryDate}
                                            </span>
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">系统提前提醒</span>
                                            <span className="text-sm font-black text-amber-600 flex items-center gap-1.5 bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5 w-fit">
                                                <AlertCircle className="w-3.5 h-3.5" /> 提前 {selectedQualification?.reminderDays} 天
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* 底部操作栏 */}
                                <div className="p-4 bg-white border-t border-slate-200 flex justify-end gap-3 shrink-0 shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.05)] relative z-10">
                                    <button
                                        onClick={() => {
                                            sysConfirm('确定要删除这份产品资质档案吗？删除后不可恢复。', async () => {
                                                await fetchWithAuth(`/api/qualifications/${selectedQualId}`, { method: 'DELETE' });
                                                setSelectedQualId(null);
                                                fetchQuals();
                                                sysAlert('已成功删除档案。');
                                            });
                                        }}
                                        className="px-4 py-2 bg-white border border-rose-200 text-rose-600 rounded-lg text-sm font-bold hover:bg-rose-50 transition-colors flex items-center gap-2">
                                        <Trash2 className="w-4 h-4" /> 删除档案
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (selectedQualification?.thumbnailUrl) window.open(selectedQualification.thumbnailUrl);
                                            else sysAlert('当前记录无关联附件可以下载');
                                        }}
                                        className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-100 transition-colors flex items-center gap-2">
                                        <Download className="w-4 h-4" /> 查看/下载附件
                                    </button>
                                    <button
                                        onClick={() => setIsEditModalOpen(true)}
                                        className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 shadow-sm transition-colors flex items-center gap-2">
                                        <Edit className="w-4 h-4" /> 修改资料
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* ========================================== */}
            {/* 批量上传与识别入库弹窗 */}
            {/* ========================================== */}
            {isModalOpen && (
                <QualificationUploadModal
                    onClose={() => setIsModalOpen(false)}
                    selectedNav={selectedNav}
                    onSuccess={() => fetchQuals()}
                />
            )}

            {/* 编辑信息弹窗 */}
            {isEditModalOpen && selectedQualification && (
                <QualificationEditModal
                    onClose={() => setIsEditModalOpen(false)}
                    qualification={selectedQualification}
                    empName={currentEmployee?.name || ''}
                    onSuccess={() => { setIsEditModalOpen(false); fetchQuals(); }}
                />
            )}
            {/* 内部新建分类弹窗 */}
            {createCatModal && (
                <CreateCategoryModal
                    parentType={createCatModal.parentType}
                    onClose={() => setCreateCatModal(null)}
                    onSave={handleSaveCategory}
                />
            )}
            {/* 批量设置提醒弹窗 */}
            {isBatchModalOpen && (
                <BatchReminderModal
                    onClose={() => setIsBatchModalOpen(false)}
                    categories={categories}
                    onSuccess={() => { setIsBatchModalOpen(false); fetchQuals(); }}
                />
            )}
        </div>
    );
};

// ==========================================
// 提取为一个独立的 Modal 组件，方便管理状态和独立重置
// ==========================================
const QualificationUploadModal = ({ onClose, selectedNav, onSuccess }: { onClose: () => void, selectedNav: { parentType: string, nodeId: string | null }, onSuccess: (quals: any[]) => void }) => {
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [isExtracting, setIsExtracting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setPendingFiles(prev => [...prev, ...Array.from(e.target.files!)]);
        }
    };

    const removeFile = (idx: number) => {
        setPendingFiles(prev => prev.filter((_, i) => i !== idx));
    };

    const handleRunExtract = async () => {
        if (pendingFiles.length === 0) return sysAlert('请先选择需要识别的文件');
        if (!selectedNav.nodeId) return sysAlert('请先在左侧选择要挂载的分类或员工');

        setIsExtracting(true);
        try {
            const fileIds: string[] = [];
            const localUrls: string[] = [];

            // 步骤一：串行（或并行）上传文件获取 file_id
            for (let i = 0; i < pendingFiles.length; i++) {
                const formData = new FormData();
                formData.append('file', pendingFiles[i]);
                const res = await fetchWithAuth('/api/qualification/upload', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();
                if (data.id) {
                    fileIds.push(data.id);
                    localUrls.push(data.localUrl || '');
                } else {
                    throw new Error(data.error || '单个文件上传报错');
                }
            }
            if (fileIds.length === 0) throw new Error('文件均上传失败，未能获得凭证');

            const parentType = selectedNav.parentType;
            const kind = parentType === 'PRODUCT' ? 'product' : 'qualification';
            console.log('[QualificationUploadModal] Using parentType:', parentType, '=> kind:', kind);

            // 步骤二：调用 Chatflow 等待大规模抽取
            const runRes = await fetchWithAuth('/api/qualification/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    upload_file_ids: fileIds,
                    inputs: { kind: kind }
                })
            });
            const runData = await runRes.json();
            if (runData.error) throw new Error(runData.error);

            // Dify 默认阻塞式结果在 answer 字段里
            const answerText = runData.data?.outputs?.text || runData.answer || runData.data?.answer || runData.text || '';
            if (!answerText) throw new Error('大模型未能返回有效解析内容，请检查工作流模型设置');

            // 步骤三：解析内容格式
            const extractedItems: any[] = [];
            const jsonMatches = answerText.match(/\{[\s\S]*?\}/g);
            if (jsonMatches) {
                for (const match of jsonMatches) {
                    try { extractedItems.push(JSON.parse(match)); } catch (e) { }
                }
            }

            if (extractedItems.length === 0) throw new Error('未从模型回复中提取到有效的 JSON 格式');

            const formatDate = (dateStr: string) => {
                if (!dateStr) return null;
                const match = dateStr.match(/(\d{4})[-/年]?\s*(\d{1,2})[-/月]?\s*(\d{1,2})/);
                if (match) {
                    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
                }
                return dateStr;
            };

            // 步骤四：拼装数据并批量提交给数据库
            const newQuals = extractedItems.map((item, idx) => ({
                id: `q-auto-${Date.now()}-${idx}`,
                empId: (selectedNav.parentType === 'EMP' || selectedNav.parentType === 'PRODUCT') ? selectedNav.nodeId : null,
                parentType: selectedNav.parentType,
                categoryId: (selectedNav.parentType !== 'EMP' && selectedNav.parentType !== 'PRODUCT') ? (selectedNav.nodeId ? Number(selectedNav.nodeId) : null) : null,
                name: item['资质名称'] || '未命名',
                certNo: item['资质编号'] || '未知编号',
                issuer: item['发证机构'] || '未知机构',
                category: item['使用品类'] || '全部',
                effectiveDate: formatDate(item['生效日期']) || new Date().toISOString().split('T')[0],
                expiryDate: formatDate(item['有效期至']) || '2099-12-31',
                reminderDays: 30,
                status: 'normal',
                thumbnailUrl: localUrls[idx] || 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=300&q=80'
            }));

            const saveRes = await fetchWithAuth('/api/qualifications/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ qualifications: newQuals })
            });

            let responseData: any = {};
            try { responseData = await saveRes.json(); } catch (e) { }
            if (!saveRes.ok || !responseData.success) throw new Error(responseData.message || '入库失败');

            sysAlert(responseData.message || `识别成功！入库完成。`);
            onSuccess(newQuals);
            onClose();
        } catch (err: any) {
            sysAlert('提取失败: ' + err.message);
        } finally {
            setIsExtracting(false);
        }
    };

    return (
        <div className="fixed z-[9999] inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 sm:p-12 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl w-full max-w-4xl max-h-full flex flex-col overflow-hidden shadow-2xl relative animate-in zoom-in-95 duration-300">
                {isExtracting && (
                    <div className="absolute inset-0 z-50 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center">
                        <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                        <p className="mt-4 font-bold text-slate-700">正在通过工作流进行智能识别中，请稍候...</p>
                    </div>
                )}
                <input type="file" multiple className="hidden" ref={fileInputRef} onChange={handleFileSelect} accept="image/*,application/pdf" />

                {/* 弹窗头部 */}
                <div className="h-16 border-b border-slate-100 flex items-center justify-between px-8 bg-slate-50 shrink-0">
                    <h2 className="text-xl font-black text-slate-800 flex items-center gap-2"><FileInput className="w-5 h-5 text-indigo-600" /> 批量上传资质档案</h2>
                    <button onClick={onClose} disabled={isExtracting} className="w-8 h-8 rounded-full hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* 弹窗内容：批量上传区与文件列表区 */}
                <div className="flex-1 flex flex-col min-h-0 bg-slate-50">
                    {/* 上传 Drop Zone */}
                    <div className="p-8 pb-4 shrink-0">
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className="border-2 border-dashed border-indigo-200 bg-white rounded-3xl flex flex-col items-center justify-center py-10 text-center hover:border-indigo-400 hover:bg-indigo-50/50 transition-all cursor-pointer group shadow-sm">
                            <div className="w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mb-4 group-hover:-translate-y-1 transition-transform border border-indigo-100">
                                <UploadCloud className="w-8 h-8 text-indigo-500" />
                            </div>
                            <h3 className="text-lg font-black text-slate-800 mb-1">拖拽多个资质文件到此处，或点击上传</h3>
                            <p className="text-sm text-slate-500 font-medium max-w-sm">支持批量上传 PDF, JPG, PNG 格式证件扫描件，上传后系统将自动利用工作流进行信息结构化提取入库。</p>
                        </div>
                    </div>

                    {/* 已选文件列表区 */}
                    <div className="flex-1 overflow-y-auto px-8 pb-8 custom-scrollbar">
                        <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center justify-between">
                            <span>待处理资质列表 ({pendingFiles.length} 个文件)</span>
                        </h4>

                        <div className="space-y-3">
                            {pendingFiles.length === 0 ? (
                                <div className="text-center py-10 text-slate-400 text-sm">
                                    暂未选择任何文件，请点击上方区域添加。
                                </div>
                            ) : (
                                pendingFiles.map((f, idx) => (
                                    <div key={idx} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4 hover:border-slate-300 transition-colors shadow-sm">
                                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border ${f.type.includes('pdf') ? 'bg-red-50 border-red-100' : 'bg-blue-50 border-blue-100'}`}>
                                            {f.type.includes('pdf') ? <FileText className="w-5 h-5 text-red-500" /> : <ImageIcon className="w-5 h-5 text-blue-500" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h5 className="text-sm font-bold text-slate-800 truncate">{f.name}</h5>
                                            <p className="text-xs text-slate-400 mt-0.5">{(f.size / 1024 / 1024).toFixed(2)} MB · 等待识别</p>
                                        </div>
                                        <button onClick={() => removeFile(idx)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* 弹窗底部操作 */}
                <div className="h-20 border-t border-slate-100 flex items-center justify-end px-8 gap-4 bg-white shrink-0 relative z-10 shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.05)]">
                    <button onClick={onClose} disabled={isExtracting} className="px-6 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50">
                        取消上传
                    </button>
                    <button
                        onClick={handleRunExtract}
                        disabled={isExtracting || pendingFiles.length === 0}
                        className="px-8 py-2.5 rounded-xl font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-500/20 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                        <CheckCircle2 className="w-5 h-5" /> 识别入库
                    </button>
                </div>
            </div>
        </div>
    );
};

// ==========================================
// 修改资质资料表单组件
// ==========================================
const QualificationEditModal = ({ onClose, qualification, empName, onSuccess }: { onClose: () => void, qualification: Qualification, empName: string, onSuccess: () => void }) => {
    const [formData, setFormData] = useState({
        name: qualification.name,
        certNo: qualification.certNo,
        issuer: qualification.issuer,
        region: qualification.region,
        category: qualification.category,
        effectiveDate: qualification.effectiveDate,
        expiryDate: qualification.expiryDate,
        reminderDays: qualification.reminderDays
    });
    const [isSaving, setIsSaving] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: name === 'reminderDays' ? Number(value) : value }));
    };

    const handleSave = async () => {
        if (!formData.name) return sysAlert("资质名称必须填写！");
        if (!formData.effectiveDate) return sysAlert("请输入有效的生效起始日期！");
        if (!formData.expiryDate) return sysAlert("请输入有效的失效截止日期！");

        const effDate = new Date(formData.effectiveDate).getTime();
        const expDate = new Date(formData.expiryDate).getTime();
        if (isNaN(effDate) || isNaN(expDate)) return sysAlert("请输入格式完全的有效日期！");
        if (expDate <= effDate) return sysAlert("保存失败：失效止期必须晚于生效起期！");

        setIsSaving(true);
        try {
            // 【关键修复】保留原始绑定关系字段，防止 PUT 接口以默认值覆盖 parentType / empId / categoryId
            const payload = {
                ...formData,
                empId: qualification.empId,
                parentType: qualification.parentType,
                categoryId: qualification.categoryId,
            };
            const res = await fetchWithAuth(`/api/qualifications/${qualification.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                sysAlert('资料修改成功！');
                onSuccess();
            } else {
                sysAlert('保存失败！');
            }
        } catch (e: any) {
            sysAlert('保存出错: ' + e.message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed z-[9999] inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl w-full max-w-2xl max-h-full flex flex-col overflow-hidden shadow-2xl relative animate-in zoom-in-95 duration-300">
                <div className="h-16 border-b border-slate-100 flex items-center justify-between px-8 bg-slate-50 shrink-0">
                    <h2 className="text-xl font-black text-slate-800 flex items-center gap-2"><Edit className="w-5 h-5 text-indigo-600" /> 修改资质资料</h2>
                    <button onClick={onClose} disabled={isSaving} className="w-8 h-8 rounded-full hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                        <div className="col-span-2">
                            <label className="block text-sm font-bold text-slate-700 mb-2">资质名称</label>
                            <input name="name" value={formData.name} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold" />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">资质编号</label>
                            <input name="certNo" value={formData.certNo} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm" />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">权威发证机构</label>
                            <input name="issuer" value={formData.issuer} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm" />
                        </div>
                        {qualification.parentType === 'PRODUCT' && (
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">认证地区 / 市场</label>
                                <input name="region" value={formData.region} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold" />
                            </div>
                        )}
                        {qualification.parentType === 'PRODUCT' && (
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">使用品类</label>
                                <select name="category" value={formData.category} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold">
                                    {Array.from(new Set([formData.category, "面部美妆", "祛斑美白类", "非特殊化妆品", "个人护理", "洗护产品", "全部"])).filter(Boolean).map(c => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">生效起期</label>
                            <input type="date" name="effectiveDate" value={formData.effectiveDate ? formData.effectiveDate.split('T')[0] : ''} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm" />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">失效止期</label>
                            <input type="date" name="expiryDate" value={formData.expiryDate ? formData.expiryDate.split('T')[0] : ''} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm" />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">到期前提醒天数</label>
                            <select name="reminderDays" value={formData.reminderDays} onChange={handleChange} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-indigo-700">
                                <option value={7}>提醒: 提前 7 天</option>
                                <option value={15}>提醒: 提前 15 天</option>
                                <option value={30}>提醒: 提前 30 天</option>
                                <option value={60}>提醒: 提前 60 天</option>
                                <option value={90}>提醒: 提前 90 天</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">归属员工</label>
                            <input value={empName} readOnly className="w-full bg-slate-100 border border-slate-200 rounded-lg px-4 py-3 focus:outline-none text-sm font-bold text-slate-400 cursor-not-allowed" />
                        </div>
                    </div>
                </div>

                <div className="h-20 border-t border-slate-100 flex items-center justify-end px-8 gap-4 bg-white shrink-0 shadow-inner">
                    <button onClick={onClose} disabled={isSaving} className="px-6 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50">
                        取消
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-8 py-2.5 rounded-xl font-black text-white bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-500/20 transition-all flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5" /> 确认保存
                    </button>
                </div>
            </div>
        </div>
    );
};

// ==========================================
// 批量设置提醒天数弹窗 (BatchReminderModal)
// ==========================================
const BatchReminderModal = ({ onClose, categories, onSuccess }: { onClose: () => void, categories: any[], onSuccess: () => void }) => {
    const [parentType, setParentType] = useState('EMP');
    const [categoryId, setCategoryId] = useState('');
    const [reminderDays, setReminderDays] = useState<number>(30);
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async () => {
        if (!reminderDays || reminderDays <= 0) return sysAlert('请输入合法的天数');

        setIsSaving(true);
        try {
            const body = {
                reminderDays,
                parentType,
                categoryId: categoryId ? Number(categoryId) : null
            };
            const res = await fetchWithAuth('/api/qualifications/batch-reminder', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (data.success) {
                sysAlert('批量更新提醒天数成功');
                onSuccess();
            } else {
                sysAlert('更新失败: ' + data.message);
            }
        } catch (e: any) {
            sysAlert('网络错误');
        } finally {
            setIsSaving(false);
        }
    };

    const targetedCategories = categories.filter(c => c.parent_type === parentType);

    return (
        <div className="fixed z-[9999] inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl relative">
                <div className="h-14 border-b border-slate-100 flex items-center justify-between px-6 bg-slate-50">
                    <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-amber-500" /> 系统提前提醒批量设置
                    </h2>
                    <button onClick={onClose} disabled={isSaving} className="text-slate-400 hover:text-slate-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-bold text-slate-700">请选择适用的所属大类</label>
                        <select
                            value={parentType}
                            onChange={(e) => { setParentType(e.target.value); setCategoryId(''); }}
                            className="bg-slate-50 border border-slate-200 text-sm rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 w-full"
                        >
                            <option value="PRODUCT">产品资质</option>
                            <option value="EMP">员工资质</option>
                            <option value="CUSTOMER">客户资质</option>
                            <option value="SUPPLIER">供应商资质</option>
                            <option value="COMPANY">公司资质</option>
                        </select>
                    </div>

                    {parentType !== 'EMP' && targetedCategories.length > 0 && (
                        <div className="flex flex-col gap-1.5 animate-in slide-in-from-top-2">
                            <label className="text-sm font-bold text-slate-700">二级自定义分类 (可选)</label>
                            <select
                                value={categoryId}
                                onChange={(e) => setCategoryId(e.target.value)}
                                className="bg-slate-50 border border-slate-200 text-sm rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 w-full"
                            >
                                <option value="">应用于该大类下所有的分类和数据</option>
                                {targetedCategories.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-bold text-slate-700">提前多少天提醒</label>
                        <input
                            type="number"
                            min="1"
                            value={reminderDays}
                            onChange={(e) => setReminderDays(Number(e.target.value))}
                            className="bg-slate-50 border border-slate-200 text-sm rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 w-full"
                        />
                    </div>
                </div>

                <div className="p-6 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
                    <button onClick={onClose} disabled={isSaving} className="px-5 py-2 font-bold text-slate-500 hover:bg-slate-200 rounded-xl transition-colors">
                        取消
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl flex items-center gap-2 shadow-sm transition-all"
                    >
                        {isSaving && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                        确认批量应用
                    </button>
                </div>
            </div>
        </div>
    );
};

// ==========================================
// 内部新建分类弹窗
// ==========================================
const CreateCategoryModal = ({ parentType, onClose, onSave }: {
    parentType: 'CUSTOMER' | 'SUPPLIER' | 'COMPANY';
    onClose: () => void;
    onSave: (parentType: string, name: string) => void;
}) => {
    const [name, setName] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const labelMap: Record<string, string> = { CUSTOMER: '客户', SUPPLIER: '供应商', COMPANY: '公司' };

    const handleSave = async () => {
        if (!name.trim()) return;
        setIsSaving(true);
        await onSave(parentType, name.trim());
        setIsSaving(false);
    };

    return (
        <div className="fixed z-[9999] inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
                <div className="h-14 border-b border-slate-100 flex items-center justify-between px-5 bg-slate-50">
                    <h2 className="text-base font-black text-slate-800">新增{labelMap[parentType]}资质分类</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-5">
                    <label className="block text-sm font-bold text-slate-700 mb-2">分类名称</label>
                    <input
                        autoFocus
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !isSaving && name.trim() && handleSave()}
                        placeholder={`例如：营业执照、资质认证...`}
                        className="w-full bg-slate-50 border border-slate-200 text-sm rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 focus:outline-none transition"
                    />
                </div>
                <div className="px-5 pb-5 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition">取消</button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving || !name.trim()}
                        className="px-5 py-2 text-sm font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition"
                    >
                        {isSaving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                        确认创建
                    </button>
                </div>
            </div>
        </div>
    );
};

export default QualificationModule;

