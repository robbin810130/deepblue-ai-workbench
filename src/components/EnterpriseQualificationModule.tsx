// ============================================================
// EnterpriseQualificationModule.tsx — 企业资质库模块
// ============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import {
    Search, Plus, RefreshCw, ChevronLeft, ChevronRight,
    FileText, Eye, Upload, Trash2,
    X, FolderTree, AlertTriangle, CheckCircle, XCircle,
    Pencil, Check, Building2, FolderOpen, FolderUp,
    Info, Shield, ChevronDown, Lock, User, Zap
} from 'lucide-react';
import { EQ_API_BASE } from '../config';
import { fetchWithAuth } from '../utils/authFetch';
import { sysConfirm } from '../utils/dialog';
import { useRole } from '../context/RoleContext';

// ─── 工具函数 ─────────────────────────────────────────────────
const fmtDate = (v: string | null | undefined): string => {
    if (!v) return '-';
    const d = new Date(v);
    if (isNaN(d.getTime())) return v;
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, '0');
    const D = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${Y}-${M}-${D} ${h}:${m}:${s}`;
};

// ─── 类型定义 ─────────────────────────────────────────────────
interface DictItem { id: number; dict_type: string; parent_id: number | null; name: string; sort_order: number; is_enabled: boolean; }
interface AssetItem {
    id: number; asset_name: string; entity_id: number; category_l1_id: number; category_l2_id: number;
    asset_no_masked: string; owner: string; effective_date: string; expiry_date: string;
    status: string; sensitivity: string; visible_departments: string[]; extra_fields: Record<string, any>;
    remark?: string;
    entity_name?: string; category_l1_name?: string; category_l2_name?: string;
    attachments?: any[]; credentials?: any[]; created_at: string; updated_at: string;
}
const TABS = [
    { id: 'assets', label: '资产列表' },
    { id: 'calendar', label: '到期日历' },
    { id: 'config', label: '基础配置' },
] as const;
type TabId = typeof TABS[number]['id'];

const STATUS_OPTIONS = ['有效', '待更新', '已废弃', '仅供参考'];
const SENSITIVITY_LEVELS = ['公开', '受限', '高敏感'];
// 各一级分类的专属字段配置
type FieldType = 'text' | 'date' | 'password' | 'textarea';
interface FieldDef { label: string; type?: FieldType; placeholder?: string; encrypted?: boolean }
const EXTRA_FIELD_CONFIG: Record<string, FieldDef[]> = {
    '软件著作权证书': [
        { label: '登记号', placeholder: '如：2024SR0001' },
        { label: '软件名称' },
        { label: '版本号', placeholder: '如：V1.0' },
        { label: '首次发表日期', type: 'date' },
        { label: '开发完成日期', type: 'date' },
    ],
    '发明专利': [
        { label: '专利号', placeholder: '如：ZL202410001234.5' },
        { label: '发明名称' },
        { label: '发明人' },
        { label: '申请日', type: 'date' },
        { label: '授权公告日', type: 'date' },
    ],
    '商标': [
        { label: '商标注册号' },
        { label: '商标名称' },
        { label: '核定使用商品/服务', type: 'textarea' },
        { label: '注册日期', type: 'date' },
        { label: '有效期至', type: 'date' },
    ],
    '行业的资质认证': [
        { label: '证书编号' },
        { label: '认证机构' },
        { label: '认证范围', type: 'textarea' },
        { label: '认证标准' },
    ],
    '营业执照': [
        { label: '统一社会信用代码', placeholder: '18位信用代码' },
        { label: '法定代表人' },
        { label: '注册资本', placeholder: '如：1000万元' },
        { label: '经营范围', type: 'textarea' },
        { label: '成立日期', type: 'date' },
    ],
    '公司的账号': [
        { label: '平台名称', placeholder: '如：淘宝/京东/抖音' },
        { label: '登录账号' },
        { label: '绑定邮箱/手机' },
        { label: '登录密码', type: 'password', encrypted: true },
        { label: '登录网址', placeholder: 'https://' },
    ],
};

// ─── 附件树形结构工具 ──────────────────────────────────────────
interface AttTreeNode {
    name: string;
    type: 'folder' | 'file';
    att?: any;
    children: AttTreeNode[];
}

function buildAttachmentTree(attachments: any[]): AttTreeNode[] {
    const roots: AttTreeNode[] = [];
    for (const att of attachments) {
        const folderPath = att.folder_path || '';
        const parts = folderPath ? folderPath.split('/').filter(Boolean) : [];
        let level = roots;
        for (const part of parts) {
            let existing = level.find(n => n.type === 'folder' && n.name === part);
            if (!existing) {
                existing = { name: part, type: 'folder', children: [] };
                level.push(existing);
            }
            level = existing.children;
        }
        level.push({ name: att.original_name || '未命名', type: 'file', att, children: [] });
    }
    return roots;
}

function AttTree({ nodes, depth, onDelete, onPreview }: {
    nodes: AttTreeNode[]; depth: number;
    onDelete?: (att: any) => void; onPreview?: (att: any) => void;
}) {
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set(nodes.filter(n => n.type === 'folder').map((_, i) => `d${depth}_${i}`)));
    const toggle = (key: string) => setExpanded(prev => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
    });
    const getExtBadge = (ext: string) => {
        const map: Record<string, string> = {
            PDF: 'bg-rose-100 text-rose-600', JPG: 'bg-emerald-100 text-emerald-600',
            JPEG: 'bg-emerald-100 text-emerald-600', PNG: 'bg-emerald-100 text-emerald-600',
            BMP: 'bg-emerald-100 text-emerald-600', GIF: 'bg-emerald-100 text-emerald-600',
            DOC: 'bg-blue-100 text-blue-600', DOCX: 'bg-blue-100 text-blue-600',
            XLS: 'bg-teal-100 text-teal-600', XLSX: 'bg-teal-100 text-teal-600',
            PPT: 'bg-orange-100 text-orange-600', PPTX: 'bg-orange-100 text-orange-600',
            ZIP: 'bg-violet-100 text-violet-600', RAR: 'bg-violet-100 text-violet-600',
        };
        return map[ext] || 'bg-slate-100 text-slate-500';
    };

    return (
        <div>
            {nodes.map((node, idx) => {
                const key = `d${depth}_${idx}`;
                if (node.type === 'folder') {
                    const isOpen = expanded.has(key);
                    const cnt = node.children.length;
                    return (
                        <div key={key} className="mb-0.5">
                            <div
                                className="flex items-center gap-2 py-[7px] px-3 cursor-pointer select-none group transition-all rounded-lg"
                                style={{ marginLeft: `${depth * 18}px`, background: isOpen ? 'linear-gradient(90deg, #fef3c7 0%, #fffbeb 100%)' : '#fefce8' }}
                                onClick={() => toggle(key)}
                            >
                                <ChevronDown size={14} className={`text-amber-500 transition-transform duration-200 shrink-0 ${isOpen ? '' : '-rotate-90'}`} />
                                <span className="text-[13px] text-amber-900 font-semibold tracking-wide truncate">{node.name}</span>
                                <span className="text-[10px] text-amber-600/70 bg-amber-200/50 rounded-full px-2 py-px shrink-0 font-medium">{cnt} 项</span>
                            </div>
                            <div className={`overflow-hidden transition-all duration-200 ${isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}>
                                <div className="pl-1.5 border-l-[2px] border-amber-200/60 ml-[10px] my-0.5 space-y-0.5">
                                    <AttTree nodes={node.children} depth={depth + 1} onDelete={onDelete} onPreview={onPreview} />
                                </div>
                            </div>
                        </div>
                    );
                }
                // 文件节点
                const att = node.att;
                const ext = (att.original_name || '').split('.').pop()?.toUpperCase() || '';
                const previewable = onPreview && canPreviewFile(att.original_name);
                return (
                    <div
                        key={att?.id || idx}
                        className={`flex items-center gap-2.5 rounded-lg border group transition-all ${
                            previewable
                                ? 'bg-white border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:border-blue-300 hover:shadow-[0_2px_8px_rgba(59,130,246,0.1)] cursor-pointer'
                                : 'bg-white border-slate-200/60'
                        } px-3 py-2`}
                        style={{ marginLeft: `${depth * 18}px` }}
                        onClick={() => previewable && onPreview!(att)}
                    >
                        <div className={`w-8 h-8 rounded-md flex items-center justify-center text-[9px] font-bold uppercase shrink-0 tracking-tight ${getExtBadge(ext)}`}>
                            {ext || <FileText size={13} />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-[13px] text-slate-700 truncate leading-snug">{node.name}</div>
                        </div>
                        <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">{att?.file_size ? `${(att.file_size / 1024).toFixed(0)} KB` : ''}</span>
                        {onDelete && (
                            <button type="button" onClick={e => { e.stopPropagation(); onDelete(att); }}
                                className="text-slate-300 hover:text-red-500 shrink-0 opacity-0 group-hover:opacity-100 transition p-1 rounded-md hover:bg-red-50" title="删除">
                                <Trash2 size={13} />
                            </button>
                        )}
                        {previewable && <Eye size={14} className="text-slate-300 group-hover:text-blue-500 shrink-0 transition" />}
                    </div>
                );
            })}
        </div>
    );
}

// ─── 可预览文件类型 ────────────────────────────────────────────
const PREVIEWABLE_EXTS = ['PDF', 'JPG', 'JPEG', 'PNG', 'BMP', 'GIF'];
const canPreviewFile = (name: string) => {
    const ext = (name || '').split('.').pop()?.toUpperCase() || '';
    return PREVIEWABLE_EXTS.includes(ext);
};

// ─── 主组件 ─────────────────────────────────────────────────
export function EnterpriseQualificationModule() {
    const { currentRole } = useRole();
    const isAdmin = currentRole === 'admin';
    const [activeTab, setActiveTab] = useState<TabId>('assets');
    const [dictEntities, setDictEntities] = useState<DictItem[]>([]);
    const [dictL1, setDictL1] = useState<DictItem[]>([]);
    const [dictL2, setDictL2] = useState<DictItem[]>([]);
    const [dictLoading, setDictLoading] = useState(true);

    // 加载字典
    const loadDicts = useCallback(async () => {
        setDictLoading(true);
        try {
            const [eRes, l1Res, l2Res] = await Promise.all([
                fetchWithAuth(`${EQ_API_BASE}/dict?dict_type=entity`),
                fetchWithAuth(`${EQ_API_BASE}/dict?dict_type=category_l1`),
                fetchWithAuth(`${EQ_API_BASE}/dict?dict_type=category_l2`),
            ]);
            const [eData, l1Data, l2Data] = await Promise.all([eRes.json(), l1Res.json(), l2Res.json()]);
            if (eData.code === 0) setDictEntities(eData.data);
            if (l1Data.code === 0) setDictL1(l1Data.data);
            if (l2Data.code === 0) setDictL2(l2Data.data);
        } catch (err) { console.error('加载字典失败', err); }
        setDictLoading(false);
    }, []);

    useEffect(() => { loadDicts(); }, [loadDicts]);

    return (
        <div className="h-full flex flex-col bg-slate-50 text-slate-800 overflow-hidden">
            {/* 页面标题 */}
            <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-200 bg-white shrink-0">
                <h2 className="text-lg font-bold text-slate-800 whitespace-nowrap">企业资质库</h2>
            </div>
            {/* Tab 页签 */}
            <div className="flex border-b border-slate-200 px-6 bg-white shrink-0">
                {TABS.filter(tab => tab.id !== 'config' || isAdmin).map(tab => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                        className={`px-4 py-2 text-sm font-medium transition border-b-2 ${
                            activeTab === tab.id
                                ? 'border-blue-500 text-blue-600'
                                : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}>
                        {tab.label}
                    </button>
                ))}
            </div>
            {/* 内容区 */}
            <div className="flex-1 overflow-auto">
                {dictLoading ? (
                    <div className="flex h-full">
                        <div className="w-[220px] shrink-0 border-r border-slate-200/80 bg-white p-4 space-y-5">
                            <div className="animate-pulse bg-slate-200/60 rounded h-4 w-16" />
                            <div className="space-y-3">
                                <div className="animate-pulse bg-slate-200/60 rounded h-3 w-20" />
                                {[1,2,3,4].map(i => <div key={i} className="animate-pulse bg-slate-200/60 rounded-lg h-7 w-full" />)}
                            </div>
                            <div className="space-y-3 pt-2">
                                <div className="animate-pulse bg-slate-200/60 rounded h-3 w-16" />
                                {[1,2,3].map(i => <div key={i} className="animate-pulse bg-slate-200/60 rounded-lg h-7 w-full" />)}
                            </div>
                        </div>
                        <div className="flex-1 flex flex-col bg-slate-50/30 p-5">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="animate-pulse bg-slate-200/60 rounded-lg h-9 flex-1" />
                                <div className="animate-pulse bg-slate-200/60 rounded-lg h-9 w-20" />
                            </div>
                            <div className="grid grid-cols-3 gap-3.5 flex-1">
                                {[1,2,3,4,5,6].map(i => (
                                    <div key={i} className="bg-white rounded-xl border border-slate-200/60 p-4 space-y-3">
                                        <div className="flex justify-between">
                                            <div className="animate-pulse bg-slate-200/60 rounded h-4 w-28" />
                                            <div className="animate-pulse bg-slate-200/60 rounded h-4 w-10" />
                                        </div>
                                        <div className="animate-pulse bg-slate-200/60 rounded h-3 w-full" />
                                        <div className="animate-pulse bg-slate-200/60 rounded h-3 w-3/4" />
                                        <div className="flex gap-1.5 pt-1">
                                            <div className="animate-pulse bg-slate-200/60 rounded h-4 w-14" />
                                            <div className="animate-pulse bg-slate-200/60 rounded h-4 w-14" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        {activeTab === 'assets' && <AssetListPage entities={dictEntities} l1List={dictL1} l2List={dictL2} />}
                        {activeTab === 'calendar' && <CalendarTab />}
                        {activeTab === 'config' && <ConfigTab entities={dictEntities} l1List={dictL1} l2List={dictL2} onRefresh={loadDicts} />}
                    </>
                )}
            </div>
        </div>
    );
}
// ============================================================
// ■ 资产列表页（卡片网格布局）
// ============================================================
const STATUS_COLORS: Record<string, string> = {
    '有效': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    '待更新': 'bg-amber-50 text-amber-700 border-amber-200',
    '已废弃': 'bg-slate-100 text-slate-500 border-slate-200',
    '仅供参考': 'bg-blue-50 text-blue-700 border-blue-200',
};

function AssetListPage({ entities, l1List, l2List }: { entities: DictItem[]; l1List: DictItem[]; l2List: DictItem[] }) {
    const [assets, setAssets] = useState<AssetItem[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [initialReady, setInitialReady] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [editAsset, setEditAsset] = useState<AssetItem | null>(null);
    const [detailAsset, setDetailAsset] = useState<AssetItem | null>(null);

    // 筛选状态
    const [filterEntity, setFilterEntity] = useState<string[]>([]);
    const [filterL1, setFilterL1] = useState<string[]>([]);
    const [filterStatus, setFilterStatus] = useState<string[]>([]);
    const [filterOwner, setFilterOwner] = useState<string[]>([]);
    const [keyword, setKeyword] = useState('');
    const [keywordInput, setKeywordInput] = useState('');
    const [filterCounts, setFilterCounts] = useState<{ entity: Record<number, number>; categoryL1: Record<number, number>; status: Record<string, number>; expiry: { expired: number; d30: number; d60: number; d90: number }; owner: Record<string, number> }>({ entity: {}, categoryL1: {}, status: {}, expiry: { expired: 0, d30: 0, d60: 0, d90: 0 }, owner: {} });
    const [l1Expanded, setL1Expanded] = useState(false);
    const [ownerExpanded, setOwnerExpanded] = useState(false);
    const [expiryFilter, setExpiryFilter] = useState<'none' | 'alert'>('none');

    // 获取所有负责人选项
    const ownerOptions = [...new Set(assets.map(a => a.owner).filter(Boolean))];

    const loadFilterCounts = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            if (keyword) params.set('keyword', keyword);
            const res = await fetchWithAuth(`${EQ_API_BASE}/asset/filter-counts?${params}`);
            const json = await res.json();
            if (json.code === 0) setFilterCounts(json.data);
        } catch { /* ignore */ }
    }, [keyword]);

    const loadAssets = useCallback(async () => {
        setLoading(true);
        const params = new URLSearchParams({ page: String(page), pageSize: '20' });
        if (filterEntity.length) params.set('entity_id', filterEntity.join(','));
        if (filterL1.length) params.set('category_l1_id', filterL1.join(','));
        if (filterStatus.length) params.set('status', filterStatus.join(','));
        if (filterOwner.length) params.set('owner', filterOwner.join(','));
        if (keyword) params.set('keyword', keyword);
        if (expiryFilter === 'alert') params.set('expiry_within', 'expired,90');
        try {
            const res = await fetchWithAuth(`${EQ_API_BASE}/asset?${params}`);
            const json = await res.json();
            if (json.code === 0) { setAssets(json.data.list); setTotal(json.data.total); }
        } catch (err) { console.error(err); }
        setLoading(false);
    }, [page, filterEntity, filterL1, filterStatus, filterOwner, keyword, expiryFilter]);

    const initialDoneRef = useRef(false);
    useEffect(() => {
        Promise.all([loadAssets(), loadFilterCounts()]).then(() => {
            if (!initialDoneRef.current) {
                initialDoneRef.current = true;
                setInitialReady(true);
            }
        });
    }, [loadAssets, loadFilterCounts]);

    const doSearch = () => { setKeyword(keywordInput.trim()); setPage(1); };

    const toggleFilter = (list: string[], setList: (v: string[]) => void, value: string) => {
        setList(list.includes(value) ? list.filter(v => v !== value) : [...list, value]);
        setPage(1);
    };

    const handleDelete = (id: number, name: string) => {
        sysConfirm(`确认删除资产「${name}」？删除后不可恢复。`, async () => {
            try {
                const res = await fetchWithAuth(`${EQ_API_BASE}/asset/${id}`, { method: 'DELETE' });
                const json = await res.json();
                if (json.code === 0) loadAssets();
                else alert(json.message || '删除失败');
            } catch (err) { console.error(err); }
        });
    };

    const activeFilterCount = filterEntity.length + filterL1.length + (filterStatus.length === STATUS_OPTIONS.length ? 0 : filterStatus.length) + filterOwner.length;

    if (!initialReady) {
        const pulse = 'animate-pulse bg-slate-200/60 rounded';
        return (
            <div className="flex h-full">
                {/* 左侧骨架 */}
                <div className="w-[220px] shrink-0 border-r border-slate-200/80 bg-white p-4 space-y-5">
                    <div className={`${pulse} h-4 w-16`} />
                    <div className="space-y-3">
                        <div className={`${pulse} h-3 w-20`} />
                        {[1,2,3,4].map(i => <div key={i} className={`${pulse} h-7 w-full rounded-lg`} />)}
                    </div>
                    <div className="space-y-3 pt-2">
                        <div className={`${pulse} h-3 w-16`} />
                        {[1,2,3].map(i => <div key={i} className={`${pulse} h-7 w-full rounded-lg`} />)}
                    </div>
                    <div className="space-y-3 pt-2">
                        <div className={`${pulse} h-3 w-12`} />
                        {[1,2,3].map(i => <div key={i} className={`${pulse} h-7 w-full rounded-lg`} />)}
                    </div>
                </div>
                {/* 右侧骨架 */}
                <div className="flex-1 flex flex-col bg-slate-50/30 p-5">
                    <div className="flex items-center gap-3 mb-4">
                        <div className={`${pulse} h-9 flex-1 rounded-lg`} />
                        <div className={`${pulse} h-9 w-20 rounded-lg`} />
                    </div>
                    <div className="flex gap-2 mb-4">
                        {[1,2,3].map(i => <div key={i} className={`${pulse} h-6 w-24 rounded-full`} />)}
                    </div>
                    <div className="grid grid-cols-3 gap-3.5 flex-1">
                        {[1,2,3,4,5,6].map(i => (
                            <div key={i} className="bg-white rounded-xl border border-slate-200/60 p-4 space-y-3">
                                <div className="flex justify-between">
                                    <div className={`${pulse} h-4 w-28`} />
                                    <div className={`${pulse} h-4 w-10`} />
                                </div>
                                <div className={`${pulse} h-3 w-full`} />
                                <div className={`${pulse} h-3 w-3/4`} />
                                <div className="flex gap-1.5 pt-1">
                                    <div className={`${pulse} h-4 w-14 rounded`} />
                                    <div className={`${pulse} h-4 w-14 rounded`} />
                                </div>
                                <div className={`${pulse} h-4 w-20 rounded`} />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full">
            {/* ─ 左侧筛选栏 ── */}
            <div className="w-[220px] shrink-0 border-r border-slate-200/80 bg-white overflow-y-auto hide-scrollbar">
                <div className="p-4 space-y-5">
                    {/* 筛选标题 */}
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                        <span className="text-[13px] font-semibold text-slate-700">筛选条件</span>
                        {(filterEntity.length + filterL1.length + filterStatus.length + filterOwner.length) > 0 && (
                            <button onClick={() => { setFilterEntity([]); setFilterL1([]); setFilterStatus([]); setFilterOwner([]); setPage(1); }}
                                className="text-[11px] text-slate-400 hover:text-blue-600 transition px-1.5 py-0.5 rounded hover:bg-blue-50">重置</button>
                        )}
                    </div>

                    {/* 公司主体 */}
                    <div>
                        <div className="flex items-center gap-1.5 mb-2">
                            <Building2 size={13} className="text-slate-400" />
                            <span className="text-[11px] font-semibold text-slate-500 tracking-wide">公司主体</span>
                        </div>
                        <div className="space-y-0.5">
                            {entities.map(e => {
                                const selected = filterEntity.includes(String(e.id));
                                const count = filterCounts.entity[e.id] || 0;
                                return (
                                    <button key={e.id} onClick={() => toggleFilter(filterEntity, setFilterEntity, String(e.id))}
                                        className={`w-full text-left px-2.5 py-[7px] rounded-lg text-[13px] transition-all flex items-center justify-between gap-2 ${
                                            selected
                                                ? 'bg-blue-50/80 text-blue-700 font-medium'
                                                : 'text-slate-600 hover:bg-slate-50'
                                        }`}>
                                        <span className="truncate">{e.name}</span>
                                        <span className={`text-[10px] tabular-nums shrink-0 min-w-[20px] text-center rounded-full px-1.5 py-px ${
                                            selected ? 'bg-blue-100 text-blue-600 font-semibold' : 'bg-slate-100 text-slate-400'
                                        }`}>{count}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* 一级分类 —— 可折叠 */}
                    <div>
                        <div className="flex items-center gap-1.5 mb-2">
                            <FolderOpen size={13} className="text-slate-400" />
                            <span className="text-[11px] font-semibold text-slate-500 tracking-wide">资质分类</span>
                        </div>
                        <div className="space-y-0.5">
                            {l1List.filter(l1 => (filterCounts.categoryL1[l1.id] || 0) > 0).map((l1, idx) => {
                                if (!l1Expanded && idx >= 4) return null;
                                const selected = filterL1.includes(String(l1.id));
                                const count = filterCounts.categoryL1[l1.id] || 0;
                                return (
                                    <button key={l1.id} onClick={() => toggleFilter(filterL1, setFilterL1, String(l1.id))}
                                        className={`w-full text-left px-2.5 py-[7px] rounded-lg text-[13px] transition-all flex items-center justify-between gap-2 ${
                                            selected
                                                ? 'bg-blue-50/80 text-blue-700 font-medium'
                                                : 'text-slate-600 hover:bg-slate-50'
                                        }`}>
                                        <span className="truncate">{l1.name}</span>
                                        <span className={`text-[10px] tabular-nums shrink-0 min-w-[20px] text-center rounded-full px-1.5 py-px ${
                                            selected ? 'bg-blue-100 text-blue-600 font-semibold' : 'bg-slate-100 text-slate-400'
                                        }`}>{count}</span>
                                    </button>
                                );
                            })}
                        </div>
                        {l1List.filter(l1 => (filterCounts.categoryL1[l1.id] || 0) > 0).length > 4 && (
                            <button onClick={() => setL1Expanded(v => !v)}
                                className="mt-1.5 w-full text-center text-[11px] text-slate-400 hover:text-blue-600 transition py-1 rounded-md hover:bg-slate-50">
                                {l1Expanded ? '收起' : `展开全部 (${l1List.filter(l1 => (filterCounts.categoryL1[l1.id] || 0) > 0).length})`}
                            </button>
                        )}
                    </div>

                    {/* 状态 */}
                    <div>
                        <div className="flex items-center gap-1.5 mb-2">
                            <CheckCircle size={13} className="text-slate-400" />
                            <span className="text-[11px] font-semibold text-slate-500 tracking-wide">状态</span>
                        </div>
                        <div className="space-y-0.5">
                            {STATUS_OPTIONS.map(s => {
                                const selected = filterStatus.includes(s);
                                const count = filterCounts.status[s] || 0;
                                return (
                                    <button key={s} onClick={() => toggleFilter(filterStatus, setFilterStatus, s)}
                                        className={`w-full text-left px-2.5 py-[7px] rounded-lg text-[13px] transition-all flex items-center gap-2 ${
                                            selected
                                                ? 'bg-blue-50/80 text-blue-700 font-medium'
                                                : 'text-slate-600 hover:bg-slate-50'
                                        }`}>
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                            s === '有效' ? 'bg-emerald-500' : s === '待更新' ? 'bg-amber-500' : s === '已废弃' ? 'bg-slate-400' : 'bg-blue-500'
                                        }`} />
                                        <span className="flex-1 truncate">{s}</span>
                                        <span className={`text-[10px] tabular-nums shrink-0 min-w-[20px] text-center rounded-full px-1.5 py-px ${
                                            selected ? 'bg-blue-100 text-blue-600 font-semibold' : 'bg-slate-100 text-slate-400'
                                        }`}>{count}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* 负责人 */}
                    {ownerOptions.filter(o => (filterCounts.owner[o] || 0) > 0).length > 0 && (
                        <div>
                            <div className="flex items-center gap-1.5 mb-2">
                                <User size={13} className="text-slate-400" />
                                <span className="text-[11px] font-semibold text-slate-500 tracking-wide">负责人</span>
                            </div>
                            <div className="space-y-0.5">
                                {ownerOptions.filter(o => (filterCounts.owner[o] || 0) > 0).map((o, idx) => {
                                    if (!ownerExpanded && idx >= 4) return null;
                                    const selected = filterOwner.includes(o);
                                    const count = filterCounts.owner[o] || 0;
                                    return (
                                        <button key={o} onClick={() => toggleFilter(filterOwner, setFilterOwner, o)}
                                            className={`w-full text-left px-2.5 py-[7px] rounded-lg text-[13px] transition-all flex items-center justify-between gap-2 ${
                                                selected
                                                    ? 'bg-blue-50/80 text-blue-700 font-medium'
                                                    : 'text-slate-600 hover:bg-slate-50'
                                            }`}>
                                            <span className="truncate">{o}</span>
                                            <span className={`text-[10px] tabular-nums shrink-0 min-w-[20px] text-center rounded-full px-1.5 py-px ${
                                                selected ? 'bg-blue-100 text-blue-600 font-semibold' : 'bg-slate-100 text-slate-400'
                                            }`}>{count}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            {ownerOptions.filter(o => (filterCounts.owner[o] || 0) > 0).length > 4 && (
                                <button onClick={() => setOwnerExpanded(v => !v)}
                                    className="mt-1.5 w-full text-center text-[11px] text-slate-400 hover:text-blue-600 transition py-1 rounded-md hover:bg-slate-50">
                                    {ownerExpanded ? '收起' : `展开全部 (${ownerOptions.filter(o => (filterCounts.owner[o] || 0) > 0).length})`}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* ── 右侧主内容区 ── */}
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/30">
                {/* 搜索栏 + 工具栏 */}
                <div className="px-5 pt-4 pb-3 bg-white border-b border-slate-100">
                    <div className="flex items-center gap-3">
                        <div className="relative flex-1">
                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input value={keywordInput} onChange={e => setKeywordInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && doSearch()}
                                placeholder="搜索资产名称、负责人..."
                                className="w-full bg-slate-50/80 border border-slate-200/80 rounded-lg pl-9 pr-3 py-2 text-[13px] text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400/60 focus:bg-white focus:border-blue-300 transition" />
                        </div>
                        <button onClick={() => setShowCreate(true)}
                            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[13px] px-4 py-2 rounded-lg transition shadow-sm shadow-blue-200/50 shrink-0">
                            <Plus size={14} />新建
                        </button>
                    </div>
                    {/* 热门标签 */}
                    <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                        <span className="text-[11px] text-slate-400 mr-0.5">快捷：</span>
                        {(filterCounts.expiry.expired + filterCounts.expiry.d30 + filterCounts.expiry.d60 + filterCounts.expiry.d90 > 0) && (
                            <button onClick={() => { setExpiryFilter(v => v === 'alert' ? 'none' : 'alert'); setPage(1); }}
                                className={`text-[11px] px-2 py-0.5 rounded-full transition flex items-center gap-0.5 ${
                                    expiryFilter === 'alert'
                                        ? 'bg-red-50 text-red-600 font-medium'
                                        : 'bg-red-50/60 text-red-500 hover:bg-red-100/60'
                                }`}>
                                <AlertTriangle size={10} />到期提醒
                                <span className="ml-0.5 opacity-70 tabular-nums">{filterCounts.expiry.expired + filterCounts.expiry.d30 + filterCounts.expiry.d60 + filterCounts.expiry.d90}</span>
                            </button>
                        )}
                        {l1List.slice(0, 8).map(l1 => (
                            <button key={l1.id} onClick={() => { setFilterL1(prev => prev.includes(String(l1.id)) ? prev.filter(v => v !== String(l1.id)) : [String(l1.id)]); setPage(1); }}
                                className={`text-[11px] px-2 py-0.5 rounded-full transition ${
                                    filterL1.includes(String(l1.id))
                                        ? 'bg-blue-50 text-blue-600 font-medium'
                                        : 'bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-600'
                                }`}>
                                {l1.name}
                                <span className="ml-1 opacity-60">{filterCounts.categoryL1[l1.id] || 0}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* 统计栏 */}
                <div className="flex items-center justify-between px-5 py-2 bg-white/60 border-b border-slate-100/80">
                    <div className="text-[12px] text-slate-500">
                        共 <span className="font-semibold text-slate-700 tabular-nums">{total}</span> 项
                        {activeFilterCount > 0 && <span className="text-slate-400 ml-1">· 已筛选 {activeFilterCount} 项</span>}
                    </div>
                </div>

                {/* 到期提醒 */}
                {(filterCounts.expiry.expired > 0 || filterCounts.expiry.d30 + filterCounts.expiry.d60 + filterCounts.expiry.d90 > 0) && (
                    <div className={`mx-5 mt-3 mb-1 flex items-center gap-3 px-3.5 py-2 rounded-lg border text-[12px] transition-all ${
                        expiryFilter === 'alert'
                            ? 'bg-red-50/70 border-red-200 text-red-700'
                            : 'bg-amber-50/50 border-amber-200/70 text-amber-800'
                    }`}>
                        <AlertTriangle size={14} className="shrink-0" />
                        <div className="flex items-center gap-2 flex-wrap">
                            {filterCounts.expiry.expired > 0 && (
                                <span>已过期 <b className="tabular-nums">{filterCounts.expiry.expired}</b> 项</span>
                            )}
                            {filterCounts.expiry.expired > 0 && (filterCounts.expiry.d30 + filterCounts.expiry.d60 + filterCounts.expiry.d90 > 0) && (
                                <span className="text-amber-400">|</span>
                            )}
                            {(filterCounts.expiry.d30 + filterCounts.expiry.d60 + filterCounts.expiry.d90 > 0) && (
                                <span>3个月内到期 <b className="tabular-nums">{filterCounts.expiry.d30 + filterCounts.expiry.d60 + filterCounts.expiry.d90}</b> 项</span>
                            )}
                        </div>
                        <button
                            onClick={() => { setExpiryFilter(v => v === 'alert' ? 'none' : 'alert'); setPage(1); }}
                            className={`ml-auto shrink-0 text-[11px] px-2 py-0.5 rounded transition ${
                                expiryFilter === 'alert'
                                    ? 'bg-red-100 text-red-600 hover:bg-red-200'
                                    : 'bg-amber-100/70 text-amber-700 hover:bg-amber-200/70'
                            }`}>
                            {expiryFilter === 'alert' ? '取消筛选' : '查看详情'}
                        </button>
                    </div>
                )}

                {/* 卡片列表 */}
                <div className="flex-1 overflow-y-auto p-5">
                    {loading ? (
                        <div className="flex items-center justify-center h-64 text-slate-400 text-sm">加载中...</div>
                    ) : assets.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                            <FolderOpen size={32} className="mb-2 text-slate-300" />
                            <span className="text-sm">暂无数据</span>
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 gap-3.5">
                            {assets.map(a => {
                                const extColor = STATUS_COLORS[a.status] || 'bg-slate-100 text-slate-500 border-slate-200';
                                const expiryDays = a.expiry_date ? Math.ceil((new Date(a.expiry_date).getTime() - Date.now()) / 86400000) : null;
                                const expiryBadge = expiryDays === null
                                    ? { text: '-', cls: 'bg-slate-50 text-slate-400 border-slate-200' }
                                    : expiryDays < 0 ? { text: `已过期 ${Math.abs(expiryDays)} 天`, cls: 'bg-red-50 text-red-500 border-red-200' }
                                    : expiryDays === 0 ? { text: '今天到期', cls: 'bg-red-50 text-red-500 border-red-200' }
                                    : expiryDays <= 30 ? { text: `${expiryDays} 天后到期`, cls: 'bg-red-50/70 text-red-500 border-red-200' }
                                    : expiryDays <= 60 ? { text: `${expiryDays} 天后到期`, cls: 'bg-amber-50 text-amber-600 border-amber-200' }
                                    : expiryDays <= 90 ? { text: `${expiryDays} 天后到期`, cls: 'bg-amber-50/70 text-amber-500 border-amber-200' }
                                    : { text: `${expiryDays} 天后到期`, cls: 'bg-slate-50 text-slate-500 border-slate-200' };
                                const isUrgent = expiryDays !== null && expiryDays <= 30;
                                const isWarning = expiryDays !== null && expiryDays > 30 && expiryDays <= 90;
                                return (
                                    <div key={a.id} className={`bg-white rounded-xl border p-4 transition-all cursor-pointer group ${
                                        isUrgent ? 'border-red-200/70 hover:border-red-300' : isWarning ? 'border-amber-200/70 hover:border-amber-300' : 'border-slate-200/70 hover:border-blue-300/70'
                                    } hover:shadow-[0_2px_12px_rgba(59,130,246,0.08)]`}
                                        onClick={() => setDetailAsset(a)}>
                                        <div className="flex items-start justify-between mb-2 gap-2">
                                            <h3 className="text-[14px] font-semibold text-slate-800 group-hover:text-blue-600 transition line-clamp-1 leading-snug">{a.asset_name}</h3>
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${extColor}`}>{a.status}</span>
                                        </div>
                                        <p className="text-[12px] text-slate-400 line-clamp-2 mb-3 min-h-[2.5rem] leading-relaxed">{a.remark || '暂无描述'}</p>
                                        <div className="flex items-center gap-1.5 flex-wrap mb-3">
                                            {a.category_l1_name && (
                                                <span className="text-[10px] px-1.5 py-0.5 bg-slate-50 text-slate-500 rounded border border-slate-100">{a.category_l1_name}</span>
                                            )}
                                            {a.category_l2_name && (
                                                <span className="text-[10px] px-1.5 py-0.5 bg-blue-50/60 text-blue-500 rounded border border-blue-100/60">{a.category_l2_name}</span>
                                            )}
                                            {a.entity_name && (
                                                <span className="text-[10px] px-1.5 py-0.5 bg-amber-50/60 text-amber-600 rounded border border-amber-100/60">{a.entity_name}</span>
                                            )}
                                        </div>
                                        <div className="mb-2.5">
                                            <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border ${expiryBadge.cls}`}>
                                                {expiryDays !== null && <AlertTriangle size={9} className="mr-0.5" />}{expiryBadge.text}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                                            <div className="flex items-center gap-1.5">
                                                <span className="w-4 h-4 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-[9px] font-medium shrink-0">
                                                    {a.owner ? a.owner[0] : '?'}
                                                </span>
                                                <span className="truncate max-w-[60px]">{a.owner || '未指定'}</span>
                                                <span className="text-slate-300">·</span>
                                                <span className="tabular-nums">{fmtDate(a.updated_at).slice(0, 10)}</span>
                                            </div>
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                                                <button onClick={e => { e.stopPropagation(); setEditAsset(a); }}
                                                    className="p-1 rounded hover:bg-blue-50 text-slate-400 hover:text-blue-600" title="编辑">
                                                    <Pencil size={12} />
                                                </button>
                                                <button onClick={e => { e.stopPropagation(); handleDelete(a.id, a.asset_name); }}
                                                    className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500" title="删除">
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* 分页 */}
                {total > 20 && (
                    <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-100 bg-white">
                        <span className="text-[11px] text-slate-400">共 {total} 条</span>
                        <div className="flex items-center gap-1.5">
                            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                                className="px-2 py-1 bg-white border border-slate-200 rounded-md disabled:opacity-30 hover:bg-slate-50 transition text-[12px]">
                                <ChevronLeft size={13} />
                            </button>
                            <span className="text-[11px] text-slate-500 px-1.5 tabular-nums">{page} / {Math.ceil(total / 20)}</span>
                            <button disabled={page >= Math.ceil(total / 20)} onClick={() => setPage(p => p + 1)}
                                className="px-2 py-1 bg-white border border-slate-200 rounded-md disabled:opacity-30 hover:bg-slate-50 transition text-[12px]">
                                <ChevronRight size={13} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* 弹窗 */}
            {showCreate && <CreateAssetModal entities={entities} l1List={l1List} l2List={l2List} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadAssets(); }} />}
            {editAsset && <CreateAssetModal entities={entities} l1List={l1List} l2List={l2List} editAsset={editAsset} onClose={() => setEditAsset(null)} onCreated={() => { setEditAsset(null); setDetailAsset(null); loadAssets(); }} />}
            {detailAsset && <AssetDetailDrawer asset={detailAsset} onClose={() => setDetailAsset(null)} onEdit={(fullAsset) => { setEditAsset(fullAsset); setDetailAsset(null); }} />}
        </div>
    );
}


// ■ 新增资产弹窗
// ============================================================
const DEPT_OPTIONS = ['行政', '法务', '风控', '财务', '人事', '运营'];

function CreateAssetModal({ entities, l1List, l2List, editAsset, onClose, onCreated }: {
    entities: DictItem[]; l1List: DictItem[]; l2List: DictItem[]; editAsset?: AssetItem | null; onClose: () => void; onCreated: () => void;
}) {
    const isEdit = !!editAsset;
    const [form, setForm] = useState(() => {
        if (editAsset) {
            return {
                asset_name: editAsset.asset_name || '', entity_id: editAsset.entity_id ? String(editAsset.entity_id) : '',
                category_l1_id: editAsset.category_l1_id ? String(editAsset.category_l1_id) : '',
                category_l2_id: editAsset.category_l2_id ? String(editAsset.category_l2_id) : '',
                asset_no_masked: editAsset.asset_no_masked || '', owner: editAsset.owner || '',
                effective_date: (editAsset.effective_date || '').slice(0, 10), expiry_date: (editAsset.expiry_date || '').slice(0, 10),
                status: editAsset.status || '有效', sensitivity: editAsset.sensitivity || '公开',
                visible_departments: editAsset.visible_departments || [],
                extra_fields: editAsset.extra_fields || {}, remark: editAsset.remark || '',
            };
        }
        return {
            asset_name: '', entity_id: '', category_l1_id: '', category_l2_id: '',
            asset_no_masked: '', owner: '', effective_date: '', expiry_date: '',
            status: '有效', sensitivity: '公开', visible_departments: [] as string[],
            extra_fields: {} as Record<string, any>, remark: '',
        };
    });
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [existingAttachments, setExistingAttachments] = useState<any[]>(() => editAsset?.attachments || []);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const [submitting, setSubmitting] = useState(false);
    const [aiRecognize, setAiRecognize] = useState(false);
    const [aiNote, setAiNote] = useState('');
    const [aiLoading, setAiLoading] = useState(false);

    const removeExistingAttachment = async (att: any) => {
        if (!confirm(`确定删除附件「${att.original_name}」？`)) return;
        try {
            const res = await fetchWithAuth(`${EQ_API_BASE}/attachment/${att.id}`, { method: 'DELETE' });
            const json = await res.json();
            if (json.code === 0) {
                setExistingAttachments(prev => prev.filter(a => a.id !== att.id));
            } else alert(json.message || '删除失败');
        } catch (err) { console.error(err); alert('删除失败'); }
    };

    const removeAllAttachments = async () => {
        if (!confirm(`确定删除全部 ${existingAttachments.length} 个附件？此操作不可恢复。`)) return;
        try {
            const results = await Promise.all(
                existingAttachments.map(att =>
                    fetchWithAuth(`${EQ_API_BASE}/attachment/${att.id}`, { method: 'DELETE' }).then(r => r.json())
                )
            );
            const allOk = results.every(r => r.code === 0);
            if (allOk) {
                setExistingAttachments([]);
            } else alert('部分附件删除失败，请重试');
        } catch (err) { console.error(err); alert('删除失败'); }
    };

    const handleAiRecognize = async () => {
        if (pendingFiles.length === 0 && existingAttachments.length === 0) {
            alert('请先上传需要识别的文件');
            return;
        }
        setAiLoading(true);
        try {
            const formData = new FormData();
            pendingFiles.forEach(f => formData.append('files', f));
            formData.append('existing_attachment_ids', JSON.stringify(existingAttachments.map(a => a.id)));
            formData.append('note', aiNote);
            const res = await fetchWithAuth(`${EQ_API_BASE}/ai-recognize`, { method: 'POST', body: formData });
            const json = await res.json();
            if (json.code !== 0 || !json.data?.parsed) {
                alert(json.message || 'AI 识别失败，未返回有效数据');
                return;
            }
            const docs = json.data.parsed.documents || json.data.parsed;
            const doc = Array.isArray(docs) ? docs[0] : docs;
            if (!doc) {
                alert('AI 未能从文件中提取到有效信息');
                return;
            }
            const fmtDate = (v: string) => {
                if (!v) return '';
                const d = new Date(v);
                if (isNaN(d.getTime())) return v;
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            };
            setForm(prev => {
                const next = { ...prev };
                if (doc.certificate_name) next.asset_name = doc.certificate_name;
                if (doc.company_name) {
                    const match = entities.find(e => e.name.includes(doc.company_name) || doc.company_name.includes(e.name));
                    if (match) next.entity_id = String(match.id);
                }
                if (doc.doc_type) {
                    const match = l1List.find(l => l.name === doc.doc_type || doc.doc_type.includes(l.name) || l.name.includes(doc.doc_type));
                    if (match) {
                        next.category_l1_id = String(match.id);
                        next.category_l2_id = '';
                        next.extra_fields = {};
                    }
                }
                if (doc.certificate_no) next.asset_no_masked = doc.certificate_no;
                if (doc.valid_from) next.effective_date = fmtDate(doc.valid_from);
                if (doc.valid_to) next.expiry_date = fmtDate(doc.valid_to);
                const ef = { ...next.extra_fields };
                const matchedL1Name = l1List.find(l => l.name === doc.doc_type || doc.doc_type?.includes(l.name) || l.name.includes(doc.doc_type))?.name || '';
                if (matchedL1Name === '发明专利' && doc.valid_from) ef['授权公告日'] = fmtDate(doc.valid_from);
                const issuerLabel = matchedL1Name === '营业执照' ? '法定代表人' : matchedL1Name === '行业的资质认证' ? '认证机构' : '发证机构';
                if (doc.issuer) ef[issuerLabel] = doc.issuer;
                if (doc.qualification_scope) {
                    const scopeLabel = EXTRA_FIELD_CONFIG[matchedL1Name]?.find(f => f.label.includes('范围') || f.label.includes('商品'))?.label || '认证范围';
                    ef[scopeLabel] = doc.qualification_scope;
                }
                if (doc.legal_representative) ef['法定代表人'] = doc.legal_representative;
                if (doc.registered_capital) ef['注册资本'] = doc.registered_capital;
                const EXTRA_KEY_MAP: Record<string, Record<string, string>> = {
                    '发明专利': { patent_name: '发明名称', patent_no: '专利号', inventor: '发明人', application_date: '申请日' },
                    '软件著作权证书': { registration_number: '登记号', software_name: '软件名称', version: '版本号', first_publication_date: '首次发表日期', completion_date: '开发完成日期' },
                    '商标': { trademark_no: '商标注册号', trademark_name: '商标名称', approved_goods_services: '核定使用商品/服务', registration_date: '注册日期', valid_until: '有效期至' },
                    '行业的资质认证': { certificate_no: '证书编号', certification_body: '认证机构', certification_scope: '认证范围', certification_standard: '认证标准' },
                    '营业执照': { credit_code: '统一社会信用代码', legal_representative: '法定代表人', registered_capital: '注册资本', business_scope: '经营范围', establishment_date: '成立日期' },
                };
                if (doc.extra) {
                    const keyMap = EXTRA_KEY_MAP[matchedL1Name] || {};
                    for (const [k, v] of Object.entries(doc.extra)) {
                        if (v != null && v !== '') {
                            const label = keyMap[k] || k;
                            ef[label] = String(v);
                        }
                    }
                }
                next.extra_fields = ef;
                return next;
            });
        } catch (err) {
            console.error(err);
            alert('AI 识别请求失败');
        } finally {
            setAiLoading(false);
        }
    };

    const toggleDept = (dept: string) => {
        setForm(f => ({
            ...f,
            visible_departments: f.visible_departments.includes(dept)
                ? f.visible_departments.filter(d => d !== dept)
                : [...f.visible_departments, dept],
        }));
    };

    const handleSubmit = async () => {
        if (!form.asset_name.trim()) return alert('资产名称不能为空');
        if (!form.entity_id) return alert('请选择公司主体');
        if (!form.category_l1_id) return alert('请选择一级分类');
        if (!form.owner.trim()) return alert('请填写负责人');
        setSubmitting(true);
        try {
            const body: any = { ...form };
            if (form.entity_id) body.entity_id = Number(form.entity_id);
            if (form.category_l1_id) body.category_l1_id = Number(form.category_l1_id);
            if (form.category_l2_id) body.category_l2_id = Number(form.category_l2_id);
            else body.category_l2_id = null;

            const url = isEdit ? `${EQ_API_BASE}/asset/${editAsset!.id}` : `${EQ_API_BASE}/asset`;
            const method = isEdit ? 'PUT' : 'POST';
            const res = await fetchWithAuth(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const json = await res.json();
            if (json.code === 0) {
                if (pendingFiles.length > 0) {
                    const formData = new FormData();
                    formData.append('asset_id', String(json.data.id));
                    pendingFiles.forEach(f => {
                        const raw = (f as any).webkitRelativePath as string | undefined;
                        // 去掉根文件夹名 + 文件名，只保留内部目录路径
                        let folderPath = '';
                        if (raw) {
                            const withoutRoot = raw.substring(raw.indexOf('/') + 1); // 1.txt 或 文件1/2.txt
                            const lastSlash = withoutRoot.lastIndexOf('/');
                            folderPath = lastSlash > 0 ? withoutRoot.substring(0, lastSlash) : ''; // '' 或 '文件1'
                        }
                        formData.append('files', f);
                        if (folderPath) formData.append('paths', folderPath);
                    });
                    await fetchWithAuth(`${EQ_API_BASE}/attachment/upload`, { method: 'POST', body: formData });
                }
                onCreated();
            } else alert(json.message || (isEdit ? '更新失败' : '创建失败'));
        } catch (err) { console.error(err); alert(isEdit ? '更新失败' : '创建失败'); }
        setSubmitting(false);
    };

    const inputCls = 'w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400 hover:border-slate-300 transition';
    const labelCls = 'text-sm text-slate-600 mb-1.5 font-medium';
    const sectionCls = 'text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 mt-5 first:mt-0';

    return (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-2 sm:p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[820px] max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                {/* 头部 */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/60 shrink-0">
                    <h3 className="text-base font-bold text-slate-800">{isEdit ? '编辑资产' : '新增资产'}</h3>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition"><X size={16} className="text-slate-400" /></button>
                </div>
                {/* 内容 */}
                <div className="px-6 py-5 overflow-auto flex-1">
                    {/* ── 基本信息 ── */}
                    <div className={sectionCls}>基本信息</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                        <div className="col-span-2">
                            <div className={labelCls}>资产名称 <span className="text-red-400">*</span></div>
                            <input className={inputCls} placeholder="如：高新技术企业证书" value={form.asset_name} onChange={e => setForm(f => ({ ...f, asset_name: e.target.value }))} />
                        </div>
                        <div>
                            <div className={labelCls}>公司主体 <span className="text-red-400">*</span></div>
                            <select className={inputCls} value={form.entity_id} onChange={e => setForm(f => ({ ...f, entity_id: e.target.value }))}>
                                <option value="">请选择</option>{entities.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <div className={labelCls}>证照 / 凭证编号</div>
                            <input className={inputCls} placeholder="输入完整编号，仅保留后 4 位" value={form.asset_no_masked} onChange={e => setForm(f => ({ ...f, asset_no_masked: e.target.value }))} />
                        </div>
                    </div>

                    {/* ── 职能部门（多选标签） ── */}
                    <div className={sectionCls}>职能部门（可多选）</div>
                    <div className="flex flex-wrap gap-2">
                        {DEPT_OPTIONS.map(dept => {
                            const selected = form.visible_departments.includes(dept);
                            return (
                                <button key={dept} type="button" onClick={() => toggleDept(dept)}
                                    className={`px-3 py-1 rounded-lg text-sm border transition-colors ${
                                        selected
                                            ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium'
                                            : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
                                    }`}>
                                    {selected && <Check size={13} className="inline mr-1 -mt-0.5" />}
                                    {dept}
                                </button>
                            );
                        })}
                    </div>

                    {/* ── 资产归属 ── */}
                    <div className={sectionCls}>资产归属</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                        <div>
                            <div className={labelCls}>一级分类 <span className="text-red-400">*</span></div>
                            <select className={inputCls} value={form.category_l1_id} onChange={e => setForm(f => ({ ...f, category_l1_id: e.target.value, category_l2_id: '', extra_fields: {} }))}>
                                <option value="">请选择</option>{l1List.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <div className={labelCls}>二级分类</div>
                            <select className={inputCls} value={form.category_l2_id} onChange={e => setForm(f => ({ ...f, category_l2_id: e.target.value }))}
                                disabled={!form.category_l1_id}>
                                <option value="">请选择</option>
                                {l2List.filter(d => d.parent_id === Number(form.category_l1_id)).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <div className={labelCls}>状态 <span className="text-red-400">*</span></div>
                            <select className={inputCls} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div>
                            <div className={labelCls}>敏感度 <span className="text-red-400">*</span></div>
                            <select className={inputCls} value={form.sensitivity} onChange={e => setForm(f => ({ ...f, sensitivity: e.target.value }))}>
                                {SENSITIVITY_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* ── 有效期与责任 ── */}
                    <div className={sectionCls}>有效期与责任</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                        <div>
                            <div className={labelCls}>负责人 <span className="text-red-400">*</span></div>
                            <input className={inputCls} placeholder="负责人姓名" value={form.owner} onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} />
                        </div>
                        <div>
                            <div className={labelCls}>备注</div>
                            <input className={inputCls} placeholder="备注信息" value={form.remark} onChange={e => setForm(f => ({ ...f, remark: e.target.value }))} />
                        </div>
                        <div>
                            <div className={labelCls}>生效日期</div>
                            <input type="date" className={inputCls} value={form.effective_date} onChange={e => setForm(f => ({ ...f, effective_date: e.target.value }))} />
                        </div>
                        <div>
                            <div className={labelCls}>到期日期</div>
                            <input type="date" className={inputCls} value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} />
                        </div>
                    </div>

                    {/* 类型专属字段 */}
                    {(() => {
                        const l1Name = l1List.find(d => d.id === Number(form.category_l1_id))?.name || '';
                        const fields = EXTRA_FIELD_CONFIG[l1Name];
                        if (!fields) return null;
                        return (
                            <div className="mt-4">
                                <div className={sectionCls}>
                                    <span className="flex items-center gap-1.5">
                                        <span className="w-1 h-3.5 bg-blue-400 rounded-full" />
                                        专属信息
                                        <span className="text-slate-400 font-normal normal-case tracking-normal text-[11px]">— {l1Name}</span>
                                    </span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                                    {fields.map(f => {
                                        const isFullWidth = f.type === 'textarea';
                                        const inputBase = `${inputCls} ${isFullWidth ? '' : ''}`;
                                        return (
                                            <div key={f.label} className={isFullWidth ? 'col-span-2' : ''}>
                                                <div className={labelCls}>
                                                    {f.label}
                                                    {f.encrypted && <span className="text-amber-500 font-normal ml-1" title="加密存储"><Lock size={10} className="inline" /></span>}
                                                </div>
                                                {f.type === 'textarea' ? (
                                                    <textarea
                                                        className={`${inputBase} min-h-[72px] resize-y`}
                                                        placeholder={f.placeholder || `输入${f.label}`}
                                                        value={form.extra_fields[f.label] || ''}
                                                        onChange={e => setForm(f2 => ({ ...f2, extra_fields: { ...f2.extra_fields, [f.label]: e.target.value } }))}
                                                    />
                                                ) : (
                                                    <input
                                                        className={inputBase}
                                                        type={f.type === 'password' ? 'password' : f.type === 'date' ? 'date' : 'text'}
                                                        placeholder={f.placeholder || `输入${f.label}`}
                                                        value={form.extra_fields[f.label] || ''}
                                                        onChange={e => setForm(f2 => ({ ...f2, extra_fields: { ...f2.extra_fields, [f.label]: e.target.value } }))}
                                                    />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })()}

                    {/* ── 附件 ── */}
                    <div className="flex items-center justify-between mb-3 mt-5">
                        <div className={sectionCls.replace('mb-3', '')}>附件（支持多文件 + 多文件夹，保留文件夹名）</div>
                        <button type="button" onClick={() => setAiRecognize(v => !v)}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                                aiRecognize ? 'bg-blue-50 text-blue-600 border border-blue-200' : 'bg-slate-50 text-slate-400 border border-slate-200 hover:text-slate-600 hover:border-slate-300'
                            }`}>
                            <Zap size={12} className={aiRecognize ? 'text-blue-500' : ''} />
                            AI识别
                            <span className={`ml-1 w-6 h-3.5 rounded-full relative transition-colors ${aiRecognize ? 'bg-blue-500' : 'bg-slate-300'}`}>
                                <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-all ${aiRecognize ? 'left-3' : 'left-0.5'}`} />
                            </span>
                        </button>
                    </div>
                    {aiRecognize && (
                        <div className="mb-3 bg-blue-50/60 border border-blue-100 rounded-xl p-3">
                            <div className="text-[11px] text-slate-500 mb-2">补充说明（可选）</div>
                            <textarea className={`${inputCls} min-h-[56px] resize-y mb-2`} placeholder="如：这是一份高新技术企业证书"
                                value={aiNote} onChange={e => setAiNote(e.target.value)} />
                            <button type="button" onClick={handleAiRecognize} disabled={aiLoading}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded-lg transition shadow-sm">
                                {aiLoading ? (
                                    <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />AI 识别中...</>
                                ) : (
                                    <><Zap size={14} />开始识别并自动填充</>
                                )}
                            </button>
                        </div>
                    )}
                    {/* 已有附件（树形） */}
                    {existingAttachments.length > 0 && (
                        <div className="mb-3">
                            <div className="text-[11px] text-slate-400 mb-1.5 flex items-center justify-between">
                                <span className="flex items-center gap-1">
                                    <CheckCircle size={11} className="text-blue-400" />
                                    已有附件 ({existingAttachments.length})
                                </span>
                                <button type="button" onClick={removeAllAttachments}
                                    className="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-600 hover:bg-red-50 px-1.5 py-0.5 rounded transition">
                                    <Trash2 size={11} />一键删除
                                </button>
                            </div>
                            <div className="space-y-1.5">
                                {buildAttachmentTree(existingAttachments).some(n => n.type === 'folder')
                                    ? <AttTree nodes={buildAttachmentTree(existingAttachments)} depth={0} onDelete={removeExistingAttachment} />
                                    : existingAttachments.map((att: any) => {
                                        const ext = (att.original_name || '').split('.').pop()?.toUpperCase() || '';
                                        const extColor = ['PDF'].includes(ext) ? 'bg-red-50 text-red-500' : ['JPG','JPEG','PNG','BMP','GIF'].includes(ext) ? 'bg-green-50 text-green-500' : 'bg-slate-100 text-slate-400';
                                        return (
                                            <div key={att.id} className="flex items-center gap-2.5 bg-blue-50/40 rounded-lg px-3 py-2 border border-blue-100 group">
                                                <div className={`w-7 h-7 rounded-md flex items-center justify-center text-[9px] font-bold shrink-0 ${extColor}`}>
                                                    {ext || <FileText size={13} />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-xs text-slate-700 font-medium truncate">{att.original_name}</div>
                                                    <div className="text-[10px] text-slate-400">{(att.file_size / 1024).toFixed(1)} KB</div>
                                                </div>
                                                <button type="button" onClick={() => removeExistingAttachment(att)}
                                                    className="text-slate-300 hover:text-red-500 shrink-0 opacity-0 group-hover:opacity-100 transition p-1 rounded hover:bg-red-50" title="删除此附件">
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        );
                                    })
                                }
                            </div>
                        </div>
                    )}
                    <div className="flex flex-col sm:flex-row gap-3">
                        <button type="button" onClick={() => fileInputRef.current?.click()}
                            className="flex-1 flex items-center gap-2.5 px-4 py-3 bg-slate-50 border border-dashed border-slate-300 rounded-xl hover:bg-slate-100 hover:border-slate-400 transition">
                            <div className="w-8 h-8 bg-white rounded-lg border border-slate-200 flex items-center justify-center">
                                <Upload size={15} className="text-blue-500" />
                            </div>
                            <div className="text-left">
                                <div className="text-sm text-slate-600 font-medium">添加文件</div>
                                <div className="text-xs text-slate-400">PDF / Office / 图片 · 单文件 ≤10MB</div>
                            </div>
                        </button>
                        <button type="button" onClick={() => folderInputRef.current?.click()}
                            className="flex-1 flex items-center gap-2.5 px-4 py-3 bg-slate-50 border border-dashed border-slate-300 rounded-xl hover:bg-slate-100 hover:border-slate-400 transition">
                            <div className="w-8 h-8 bg-white rounded-lg border border-slate-200 flex items-center justify-center">
                                <FolderUp size={15} className="text-amber-500" />
                            </div>
                            <div className="text-left">
                                <div className="text-sm text-slate-600 font-medium">上传文件夹</div>
                                <div className="text-xs text-slate-400">保留文件夹名与内部目录结构</div>
                            </div>
                        </button>
                        <input ref={fileInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.bmp,.gif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar" className="hidden"
                            onChange={e => { if (e.target.files) { setPendingFiles(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = ''; } }} />
                        <input ref={el => { (folderInputRef as any).current = el; if (el) (el as any).webkitdirectory = true; }} type="file" className="hidden"
                            onChange={e => { const files = e.target.files; if (files && files.length > 0) { setPendingFiles(prev => [...prev, ...Array.from(files)]); } e.target.value = ''; }} />
                    </div>
                    {pendingFiles.length > 0 && (
                        <div className="mt-2 bg-slate-50 rounded-lg border border-slate-200 max-h-40 overflow-y-auto">
                            <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 sticky top-0 bg-slate-50">
                                <span className="text-xs text-slate-500">新增附件 {pendingFiles.length} 个</span>
                                <button type="button" onClick={() => setPendingFiles([])} className="text-xs text-red-400 hover:text-red-600">清空</button>
                            </div>
                            <div className="px-3 py-1 space-y-0.5">
                                {pendingFiles.map((f, i) => {
                                    const raw = (f as any).webkitRelativePath || '';
                                    const relPath = raw ? raw.substring(raw.indexOf('/') + 1) : f.name;
                                    return (
                                        <div key={i} className="flex items-center gap-1.5 text-xs group">
                                            <FileText size={11} className="text-slate-400 shrink-0" />
                                            <span className="flex-1 truncate text-slate-600" title={relPath}>{relPath}</span>
                                            <span className="text-slate-400 shrink-0">{(f.size / 1024).toFixed(0)}KB</span>
                                            <button type="button" onClick={() => setPendingFiles(prev => prev.filter((_, idx) => idx !== i))}
                                                className="text-slate-300 hover:text-red-500 shrink-0 opacity-0 group-hover:opacity-100 transition">
                                                <X size={12} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
                {/* 底部按钮 */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50/40 shrink-0">
                    <button onClick={onClose} className="px-5 py-2 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition">取消</button>
                    <button onClick={handleSubmit} disabled={submitting}
                        className="px-6 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium rounded-lg transition shadow-sm">
                        {submitting ? '提交中...' : (isEdit ? '确认更新' : '确认创建')}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ============================================================
// ■ 资产详情抽屉
// ============================================================
function AssetDetailDrawer({ asset, onClose, onEdit }: { asset: AssetItem; onClose: () => void; onEdit: (fullAsset: AssetItem) => void }) {
    const [detail, setDetail] = useState<AssetItem | null>(null);

    const loadDetail = useCallback(async () => {
        try {
            const res = await fetchWithAuth(`${EQ_API_BASE}/asset/${asset.id}`);
            const json = await res.json();
            if (json.code === 0) setDetail(json.data);
        } catch (err) { console.error(err); }
    }, [asset.id]);

    useEffect(() => { loadDetail(); }, [loadDetail]);

    const d = detail || asset;
    const sectionHeader = (icon: React.ReactNode, title: string) => (
        <div className="flex items-center gap-1.5 mb-3 mt-5 first:mt-0">
            <span className="text-blue-500">{icon}</span>
            <span className="text-xs font-semibold text-slate-500 tracking-wide">{title}</span>
            <div className="flex-1 h-px bg-slate-100" />
        </div>
    );
    const fieldCard = (label: string, children: React.ReactNode, span?: boolean) => (
        <div className={`bg-slate-50/80 rounded-lg px-3 py-2.5 border border-slate-100 ${span ? 'col-span-2' : ''}`}>
            <div className="text-[11px] text-slate-400 mb-1">{label}</div>
            <div className="text-sm text-slate-700 leading-relaxed">{children}</div>
        </div>
    );

    // 计算到期提醒
    const expiryInfo = (() => {
        if (!d.expiry_date) return null;
        const now = new Date();
        const expiry = new Date(d.expiry_date);
        const diffMs = expiry.getTime() - now.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        return { days: diffDays, date: d.expiry_date };
    })();

    const expiryBannerCls = expiryInfo
        ? expiryInfo.days <= 0 ? 'bg-red-50 border-red-200 text-red-700'
        : expiryInfo.days <= 30 ? 'bg-red-50 border-red-200 text-red-700'
        : expiryInfo.days <= 90 ? 'bg-amber-50 border-amber-200 text-amber-700'
        : 'bg-emerald-50 border-emerald-200 text-emerald-700'
        : '';

    const previewFile = async (att: any) => {
        try {
            const res = await fetchWithAuth(`${EQ_API_BASE}/attachment/${att.id}/download`);
            if (!res.ok) throw new Error('下载失败');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            // 延迟释放 blob URL，确保浏览器有时间加载
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (err) {
            console.error('预览文件失败:', err);
            alert('预览失败，请重试');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/30 z-50 flex justify-end" onClick={onClose}>
            <div className="w-[480px] bg-white border-l border-slate-200 shadow-xl h-full flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                    <h3 className="text-base font-semibold text-slate-800">资产详情</h3>
                    <div className="flex items-center gap-2">
                        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 transition"><X size={16} className="text-slate-400" /></button>
                    </div>
                </div>
                <div className="flex-1 overflow-auto px-6 py-5">
                {/* 到期提醒 */}
                {expiryInfo && (
                    <div className={`mb-5 px-4 py-3.5 rounded-xl border ${expiryBannerCls}`}>
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-lg font-bold">
                                    {expiryInfo.days <= 0 ? '已过期' : `距离到期 ${expiryInfo.days} 天`}
                                </div>
                                <div className="text-xs mt-1 opacity-75">
                                    将于 {fmtDate(expiryInfo.date)} 到期
                                </div>
                            </div>
                            <AlertTriangle size={28} className="opacity-50" />
                        </div>
                    </div>
                )}

                {/* ── 基本信息 ── */}
                {sectionHeader(<Info size={14} />, '基本信息')}
                {/* 资产名称（突出显示） */}
                <div className="mb-3">
                    <div className="text-base font-bold text-slate-800 leading-snug">{d.asset_name}</div>
                    {d.asset_no_masked && <div className="text-xs text-slate-400 mt-0.5">编号：{d.asset_no_masked}</div>}
                </div>
                {/* 字段卡片 */}
                <div className="grid grid-cols-2 gap-2">
                    {fieldCard('公司主体', d.entity_name || '-')}
                    {fieldCard('一级分类', d.category_l1_name || '-')}
                    {fieldCard('二级分类', d.category_l2_name || '-')}
                    {fieldCard('负责人', d.owner || '-')}
                    {fieldCard('状态', <StatusBadge status={d.status} />)}
                    {fieldCard('敏感度', <SensitivityBadge level={d.sensitivity} />)}
                    {fieldCard('生效日期', fmtDate(d.effective_date))}
                    {fieldCard('职能部门', (
                        <div className="flex flex-wrap gap-1">
                            {(d.visible_departments || []).length > 0
                                ? d.visible_departments.map(dept => (
                                    <span key={dept} className="inline-block bg-blue-50 text-blue-600 text-[11px] px-1.5 py-0.5 rounded">{dept}</span>
                                  ))
                                : <span className="text-slate-400">-</span>
                            }
                        </div>
                    ), true)}
                    {d.remark && fieldCard('备注', d.remark, true)}
                </div>

                {/* ── 专属信息 ── */}
                {d.extra_fields && Object.keys(d.extra_fields).length > 0 && (
                    <>
                        {sectionHeader(<Shield size={14} />, '专属信息')}
                        <div className="grid grid-cols-2 gap-2">
                            {Object.entries(d.extra_fields).map(([k, v]) => {
                                const val = String(v);
                                const isLong = val.length > 30;
                                const isPassword = EXTRA_FIELD_CONFIG[d.category_l1_name || '']?.find(f => f.label === k)?.type === 'password';
                                return (
                                    <div key={k} className={`bg-slate-50/80 rounded-lg px-3 py-2.5 border border-slate-200/60 ${isLong ? 'col-span-2' : ''}`}>
                                        <div className="text-[11px] text-slate-400 mb-1">{k}</div>
                                        <div className="text-sm text-slate-700 break-all" title={val}>
                                            {isPassword ? '••••••••' : val || '-'}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}

                {/* ── 附件 ── */}
                {d.attachments && d.attachments.length > 0 && (
                    <>
                        {sectionHeader(<FolderTree size={14} />, `附件 (${d.attachments.length})`)}
                        {d.attachments.some((a: any) => a.folder_path)
                            ? <AttTree nodes={buildAttachmentTree(d.attachments)} depth={0} onPreview={previewFile} />
                            : <div className="space-y-2">
                                {d.attachments.map((att: any) => {
                                    const ext = (att.original_name || '').split('.').pop()?.toUpperCase() || '';
                                    const extColor = ['PDF'].includes(ext) ? 'bg-red-50 text-red-500' : ['JPG','JPEG','PNG','BMP','GIF'].includes(ext) ? 'bg-green-50 text-green-500' : 'bg-slate-100 text-slate-400';
                                    const previewable = canPreviewFile(att.original_name);
                                    return (
                                        <div key={att.id} className={`flex items-center gap-3 bg-white rounded-xl px-3.5 py-2.5 border border-slate-200 shadow-sm transition-all group ${
                                            previewable ? 'cursor-pointer hover:border-blue-300 hover:shadow-md' : ''
                                        }`} onClick={() => previewable && previewFile(att)}>
                                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0 ${extColor}`}>
                                                {ext || <FileText size={16} />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm text-slate-700 font-medium truncate">{att.original_name}</div>
                                                <div className="text-[11px] text-slate-400">{(att.file_size / 1024).toFixed(1)} KB</div>
                                            </div>
                                            {previewable && <Eye size={14} className="text-slate-300 group-hover:text-blue-500 shrink-0 transition" />}
                                        </div>
                                    );
                                })}
                              </div>
                        }
                    </>
                )}

                </div>
                {/* 底部操作栏 */}
                <div className="px-6 py-4 border-t border-slate-100">
                    <button onClick={() => onEdit(d)} className="w-full flex items-center justify-center gap-1.5 px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition border border-blue-200 font-medium">
                        <Pencil size={14} />编辑此资产
                    </button>
                </div>
            </div>
        </div>
    );
}

// ============================================================
// ■ Tab 3: 到期日历
// ============================================================
function CalendarTab() {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [calendarData, setCalendarData] = useState<any[]>([]);
    const [selectedDay, setSelectedDay] = useState<string | null>(null);

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;

    const loadCalendar = useCallback(async () => {
        try {
            const res = await fetchWithAuth(`${EQ_API_BASE}/asset/calendar?year=${year}&month=${month}`);
            const json = await res.json();
            if (json.code === 0) setCalendarData(json.data);
        } catch (err) { console.error(err); }
    }, [year, month]);
    useEffect(() => { loadCalendar(); }, [loadCalendar]);

    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
    const today = new Date().toISOString().slice(0, 10);
    const isCurrentMonth = today.startsWith(`${year}-${String(month).padStart(2, '0')}`);

    const getUrgency = (dateStr: string): 'critical' | 'warning' | 'safe' | 'normal' => {
        const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (diff < 0) return 'normal';
        if (diff <= 30) return 'critical';
        if (diff <= 60) return 'warning';
        if (diff <= 90) return 'safe';
        return 'normal';
    };

    const urgencyStyles: Record<string, { bg: string; text: string; dot: string; badge: string }> = {
        critical: { bg: 'bg-red-50', text: 'text-red-600', dot: 'bg-red-500', badge: 'bg-red-500 text-white' },
        warning: { bg: 'bg-amber-50', text: 'text-amber-600', dot: 'bg-amber-500', badge: 'bg-amber-500 text-white' },
        safe: { bg: 'bg-emerald-50', text: 'text-emerald-600', dot: 'bg-emerald-500', badge: 'bg-emerald-500 text-white' },
        normal: { bg: '', text: 'text-slate-600', dot: 'bg-slate-300', badge: 'bg-slate-200 text-slate-600' },
    };

    // 归一化日期为 YYYY-MM-DD，确保匹配不受时区影响
    const normalizeDate = (dateStr: string) => dateStr?.slice(0, 10) || '';
    const itemsForDay = (dateStr: string) => calendarData.filter(d => normalizeDate(d.expiry_date) === dateStr);
    const selectedItems = selectedDay ? itemsForDay(selectedDay) : [];

    // 统计各紧急程度数量
    const stats = { critical: 0, warning: 0, safe: 0 };
    const dayMap: Record<string, number> = {};
    calendarData.forEach(d => {
        const key = normalizeDate(d.expiry_date);
        dayMap[key] = (dayMap[key] || 0) + 1;
        const u = getUrgency(key);
        if (u in stats) stats[u as keyof typeof stats]++;
    });

    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDayOfWeek; i++) cells.push(null);
    for (let i = 1; i <= daysInMonth; i++) cells.push(i);

    const goToday = () => { setCurrentDate(new Date()); setSelectedDay(null); };

    return (
        <div className="flex gap-4 h-full p-5">
            {/* 左侧：日历 */}
            <div className="flex-1 bg-white rounded-xl border border-slate-200/70 shadow-sm flex flex-col overflow-hidden">
                {/* 月份导航 */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                    <button onClick={() => setCurrentDate(new Date(year, month - 2, 1))}
                        className="p-1.5 rounded-lg hover:bg-slate-100 transition text-slate-400 hover:text-slate-600">
                        <ChevronLeft size={16} />
                    </button>
                    <div className="flex items-center gap-3">
                        <span className="text-[15px] font-semibold text-slate-800">{year}年{month}月</span>
                        {!isCurrentMonth && (
                            <button onClick={goToday} className="text-[11px] text-blue-600 hover:text-blue-700 px-2 py-0.5 rounded border border-blue-200 bg-blue-50 transition">
                                今天
                            </button>
                        )}
                    </div>
                    <button onClick={() => setCurrentDate(new Date(year, month, 1))}
                        className="p-1.5 rounded-lg hover:bg-slate-100 transition text-slate-400 hover:text-slate-600">
                        <ChevronRight size={16} />
                    </button>
                </div>
                {/* 星期头 */}
                <div className="grid grid-cols-7 text-center bg-slate-50/50">
                    {['日', '一', '二', '三', '四', '五', '六'].map((d, i) => (
                        <div key={d} className={`py-2 text-[11px] font-medium ${i === 0 || i === 6 ? 'text-slate-400' : 'text-slate-500'}`}>{d}</div>
                    ))}
                </div>
                {/* 日期格子 */}
                <div className="grid grid-cols-7 flex-1 auto-rows-fr">
                    {cells.map((day, i) => {
                        if (day === null) return <div key={i} className="border-t border-r border-slate-100 last:border-r-0 bg-slate-50/20" />;
                        const col = i % 7;
                        const isWeekend = col === 0 || col === 6;
                        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const dayInfo = dayMap[dateStr];
                        const count = dayInfo || 0;
                        const urgency = count > 0 ? getUrgency(dateStr) : 'normal';
                        const style = urgencyStyles[urgency];
                        const isToday = dateStr === today;
                        const isSelected = dateStr === selectedDay;
                        return (
                            <div key={i} onClick={() => setSelectedDay(isSelected ? null : dateStr)}
                                className={`border-t border-r border-slate-100 p-1.5 cursor-pointer transition-all flex flex-col items-center justify-start relative
                                    ${isWeekend && !count ? 'bg-slate-50/30' : 'bg-white'}
                                    ${isSelected ? 'bg-blue-50/70 ring-1 ring-inset ring-blue-300' : 'hover:bg-slate-50/60'}
                                    ${count > 0 ? style.bg : ''}`}>
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[13px]
                                    ${isToday ? 'bg-blue-600 text-white font-bold shadow-sm shadow-blue-200' : count > 0 ? `font-semibold ${style.text}` : 'text-slate-600'}`}>
                                    {day}
                                </div>
                                {count > 0 && (
                                    <span className={`inline-flex items-center justify-center min-w-[20px] h-[17px] rounded-full text-[10px] font-bold leading-none px-1 mt-0.5 ${style.badge}`}>
                                        {count} 到期
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
                {/* 图例 */}
                <div className="flex items-center gap-5 px-5 py-2.5 border-t border-slate-100">
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-500"><span className="w-2 h-2 rounded-full bg-red-500" />30天内紧急</span>
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-500"><span className="w-2 h-2 rounded-full bg-amber-500" />60天内警告</span>
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-500"><span className="w-2 h-2 rounded-full bg-emerald-500" />90天内关注</span>
                </div>
            </div>

            {/* 右侧：详情面板 */}
            <div className="w-[300px] flex flex-col gap-3 shrink-0">
                {/* 统计卡片 */}
                <div className="grid grid-cols-3 gap-2">
                    <div className="bg-white rounded-xl border border-slate-200/70 shadow-sm p-3 text-center overflow-hidden relative">
                        <div className="absolute top-0 left-0 right-0 h-[3px] bg-red-500" />
                        <div className="text-xl font-bold text-red-500 mt-1">{stats.critical}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">30天内</div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200/70 shadow-sm p-3 text-center overflow-hidden relative">
                        <div className="absolute top-0 left-0 right-0 h-[3px] bg-amber-500" />
                        <div className="text-xl font-bold text-amber-500 mt-1">{stats.warning}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">60天内</div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200/70 shadow-sm p-3 text-center overflow-hidden relative">
                        <div className="absolute top-0 left-0 right-0 h-[3px] bg-emerald-500" />
                        <div className="text-xl font-bold text-emerald-500 mt-1">{stats.safe}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">90天内</div>
                    </div>
                </div>
                {/* 到期清单 */}
                <div className="bg-white rounded-xl border border-slate-200/70 shadow-sm flex-1 flex flex-col min-h-0 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 shrink-0">
                        <div className="flex items-center justify-between">
                            <span className="text-[13px] font-semibold text-slate-700">
                                {selectedDay ? `${selectedDay} 到期` : '本月到期清单'}
                            </span>
                            {selectedDay && (
                                <button onClick={() => setSelectedDay(null)} className="text-[11px] text-blue-600 hover:text-blue-700 px-2 py-0.5 rounded border border-blue-200 bg-blue-50 transition">全部</button>
                            )}
                        </div>
                        {selectedDay && (
                            <div className="mt-0.5 text-[11px] text-slate-400">
                                共 {selectedItems.length} 项资产到期
                            </div>
                        )}
                    </div>
                    <div className="flex-1 overflow-auto hide-scrollbar">
                        {selectedDay ? (
                            selectedItems.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                                    <CheckCircle size={28} className="mb-2 text-emerald-400" />
                                    <span className="text-[13px]">当天无到期资产</span>
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100/80">
                                    {selectedItems.map((item: any) => {
                                        const u = getUrgency(normalizeDate(item.expiry_date));
                                        const s = urgencyStyles[u];
                                        return (
                                            <div key={item.id} className="px-4 py-2.5 hover:bg-slate-50/60 transition-colors">
                                                <div className="flex items-start gap-2.5">
                                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${s.dot}`} />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[13px] font-medium text-slate-700 truncate">{item.asset_name}</span>
                                                            <StatusBadge status={item.status} />
                                                        </div>
                                                        <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-400">
                                                            <span className="flex items-center gap-1"><Building2 size={10} />{item.entity_name || '-'}</span>
                                                            {item.owner && <span>负责人：{item.owner}</span>}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )
                        ) : (
                            calendarData.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                                    <CheckCircle size={28} className="mb-2 text-emerald-400" />
                                    <span className="text-[13px]">本月无到期资产</span>
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100/80">
                                    {[...calendarData].sort((a, b) => normalizeDate(a.expiry_date).localeCompare(normalizeDate(b.expiry_date))).map((item: any) => {
                                        const u = getUrgency(normalizeDate(item.expiry_date));
                                        const s = urgencyStyles[u];
                                        const daysLeft = Math.ceil((new Date(normalizeDate(item.expiry_date)).getTime() - Date.now()) / 86400000);
                                        const dayLabel = daysLeft < 0 ? `已过期 ${Math.abs(daysLeft)} 天` : daysLeft === 0 ? '今天到期' : `剩余 ${daysLeft} 天`;
                                        const dayColor = daysLeft < 0 ? 'text-red-500' : daysLeft <= 30 ? 'text-red-500' : daysLeft <= 60 ? 'text-amber-500' : 'text-emerald-500';
                                        return (
                                            <div key={item.id} className="px-4 py-2.5 hover:bg-slate-50/60 transition-colors">
                                                <div className="flex items-start gap-2.5">
                                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${s.dot}`} />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[13px] font-medium text-slate-700 truncate">{item.asset_name}</span>
                                                            <StatusBadge status={item.status} />
                                                        </div>
                                                        <div className="mt-1 flex items-center gap-2 text-[11px]">
                                                            <span className="text-slate-400 tabular-nums">{normalizeDate(item.expiry_date)}</span>
                                                            <span className={`font-medium ${dayColor}`}>{dayLabel}</span>
                                                        </div>
                                                        <div className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-400">
                                                            <span className="flex items-center gap-1"><Building2 size={10} />{item.entity_name || '-'}</span>
                                                            {item.owner && <span>负责人：{item.owner}</span>}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ============================================================
// ■ Tab 4: 基础配置（树形结构）
// ============================================================
function ConfigTab({ entities, l1List, l2List, onRefresh }: { entities: DictItem[]; l1List: DictItem[]; l2List: DictItem[]; onRefresh: () => void }) {
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['entity']));
    const [addingType, setAddingType] = useState<'entity' | 'l1' | 'l2' | null>(null);
    const [addingParentId, setAddingParentId] = useState<number | null>(null);
    const [newName, setNewName] = useState('');
    const [adding, setAdding] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editingName, setEditingName] = useState('');
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

    const showToast = (type: 'success' | 'error', msg: string) => {
        setToast({ type, msg });
        setTimeout(() => setToast(null), 2000);
    };

    // 默认全部展开
    useEffect(() => {
        setExpandedNodes(prev => {
            const next = new Set(prev);
            next.add('entity');
            next.add('l1');
            return next;
        });
    }, []);

    const toggleExpand = (key: string) => {
        setExpandedNodes(prev => {
            const next = new Set(prev);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
        });
    };

    const startAdd = (type: 'entity' | 'l1' | 'l2', parentId?: number) => {
        setAddingType(type);
        setAddingParentId(parentId ?? null);
        setNewName('');
        setEditingId(null);
        if (type === 'entity') setExpandedNodes(prev => new Set(prev).add('entity'));
        if (type === 'l1') setExpandedNodes(prev => new Set(prev).add('l1'));
        if (type === 'l2' && parentId != null) setExpandedNodes(prev => new Set(prev).add(`l1_${parentId}`));
    };

    const cancelAdd = () => {
        setAddingType(null);
        setAddingParentId(null);
        setNewName('');
    };

    const handleAdd = async () => {
        if (!newName.trim()) { showToast('error', '名称不能为空'); return; }
        const dictType = addingType === 'entity' ? 'entity' : addingType === 'l2' ? 'category_l2' : 'category_l1';
        const parentId = addingType === 'l2' ? addingParentId : null;
        setAdding(true);
        try {
            const res = await fetchWithAuth(`${EQ_API_BASE}/dict`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dict_type: dictType, parent_id: parentId, name: newName.trim() }),
            });
            const json = await res.json();
            if (json.code === 0) { cancelAdd(); onRefresh(); showToast('success', '添加成功'); }
            else showToast('error', json.message || '添加失败');
        } catch { showToast('error', '网络异常'); }
        setAdding(false);
    };

    const handleDelete = (id: number, name: string) => {
        sysConfirm(`确认删除「${name}」？删除后不可恢复。`, async () => {
            try {
                const res = await fetchWithAuth(`${EQ_API_BASE}/dict/${id}`, { method: 'DELETE' });
                const json = await res.json();
                if (json.code === 0) { onRefresh(); showToast('success', '已删除'); }
                else showToast('error', json.message || '删除失败');
            } catch { showToast('error', '网络异常'); }
        });
    };

    const handleEditStart = (item: DictItem) => {
        setEditingId(item.id);
        setEditingName(item.name);
        setAddingType(null);
    };

    const handleEditSave = async (item: DictItem) => {
        if (!editingName.trim()) { showToast('error', '名称不能为空'); return; }
        if (editingName.trim() === item.name) { setEditingId(null); return; }
        setSaving(true);
        try {
            const res = await fetchWithAuth(`${EQ_API_BASE}/dict/${item.id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: editingName.trim(), dict_type: item.dict_type, parent_id: item.parent_id }),
            });
            const json = await res.json();
            if (json.code === 0) { setEditingId(null); onRefresh(); showToast('success', '已保存'); }
            else showToast('error', json.message || '保存失败');
        } catch { showToast('error', '网络异常'); }
        setSaving(false);
    };

    const handleToggleEnabled = async (item: DictItem) => {
        try {
            const res = await fetchWithAuth(`${EQ_API_BASE}/dict/${item.id}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: item.name, dict_type: item.dict_type, parent_id: item.parent_id, is_enabled: !item.is_enabled }),
            });
            const json = await res.json();
            if (json.code === 0) { onRefresh(); showToast('success', item.is_enabled ? '已停用' : '已启用'); }
            else showToast('error', json.message || '操作失败');
        } catch { showToast('error', '网络异常'); }
    };

    const inputCls = 'flex-1 bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400';
    // 操作按钮区固定宽度，防止 hover 时布局抖动
    const actionSlot = 'flex items-center gap-0.5 shrink-0 w-[68px] justify-end';

    // 新增输入行
    const AddRow = ({ depth }: { depth: number }) => (
        <div className="flex items-center gap-2 py-2 bg-blue-50/40" style={{ paddingLeft: `${depth * 24 + 24}px` }}>
            <input className={inputCls} autoFocus placeholder="输入名称后按 Enter"
                value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') cancelAdd(); }} />
            <button onClick={handleAdd} disabled={adding}
                className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-xs px-3 py-2 rounded-lg transition shrink-0">
                {adding ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}确定
            </button>
            <button onClick={cancelAdd}
                className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 transition shrink-0" title="取消">
                <X size={14} />
            </button>
        </div>
    );

    // 叶子节点（entity / l2）
    const LeafRow = ({ item, depth }: { item: DictItem; depth: number }) => (
        <div className="flex items-center gap-2 py-2 hover:bg-slate-50/60 transition-colors group"
            style={{ paddingLeft: `${depth * 24 + 24}px`, paddingRight: '20px' }}>
            {editingId === item.id ? (
                <>
                    <input className={inputCls} value={editingName} autoFocus
                        onChange={e => setEditingName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleEditSave(item); if (e.key === 'Escape') setEditingId(null); }} />
                    <button onClick={() => handleEditSave(item)} disabled={saving}
                        className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition shrink-0" title="保存">
                        {saving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                    </button>
                    <button onClick={() => setEditingId(null)}
                        className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 transition shrink-0" title="取消">
                        <X size={14} />
                    </button>
                </>
            ) : (
                <>
                    <span className={`text-sm flex-1 min-w-0 truncate ${item.is_enabled ? 'text-slate-700' : 'text-slate-400 line-through'}`}>{item.name}</span>
                    <button onClick={() => handleToggleEnabled(item)}
                        className={`w-8 h-[18px] rounded-full transition-colors shrink-0 relative ${item.is_enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
                        title={item.is_enabled ? '点击停用' : '点击启用'}>
                        <span className={`absolute top-[2px] w-3.5 h-3.5 rounded-full bg-white shadow transition-all ${item.is_enabled ? 'left-[17px]' : 'left-[2px]'}`} />
                    </button>
                    <div className={actionSlot}>
                        <button onClick={() => handleEditStart(item)}
                            className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-300 group-hover:text-slate-500 hover:text-blue-600 transition-colors" title="编辑">
                            <Pencil size={13} />
                        </button>
                        <button onClick={() => handleDelete(item.id, item.name)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-slate-300 group-hover:text-slate-500 hover:text-red-500 transition-colors" title="删除">
                            <Trash2 size={13} />
                        </button>
                    </div>
                </>
            )}
        </div>
    );

    // 一级分类节点（可折叠，含二级子节点）
    const L1Node = ({ l1Item }: { l1Item: DictItem }) => {
        const nodeKey = `l1_${l1Item.id}`;
        const expanded = expandedNodes.has(nodeKey);
        const children = l2List.filter(d => d.parent_id === l1Item.id);
        return (
            <div>
                <div className="flex items-center gap-2 py-2 hover:bg-slate-50/60 transition-colors group"
                    style={{ paddingLeft: '24px', paddingRight: '20px' }}>
                    <button onClick={() => toggleExpand(nodeKey)}
                        className="text-slate-400 transition-transform shrink-0 hover:text-slate-600">
                        <ChevronRight size={14} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
                    </button>
                    <FolderOpen size={14} className="text-blue-400 shrink-0" />
                    <span className={`text-[13px] font-medium flex-1 min-w-0 truncate ${l1Item.is_enabled ? 'text-slate-700' : 'text-slate-400 line-through'}`}>{l1Item.name}</span>
                    {children.length > 0 && (
                        <span className="text-[10px] text-slate-400 bg-slate-100 rounded-full px-1.5 py-px tabular-nums shrink-0">{children.length}</span>
                    )}
                    <button onClick={() => startAdd('l2', l1Item.id)}
                        className="p-1 rounded-md text-slate-300 hover:bg-blue-50 hover:text-blue-600 transition-colors shrink-0" title="新增二级分类">
                        <Plus size={14} />
                    </button>
                    <button onClick={() => handleToggleEnabled(l1Item)}
                        className={`w-8 h-[18px] rounded-full transition-colors shrink-0 relative ${l1Item.is_enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
                        title={l1Item.is_enabled ? '点击停用' : '点击启用'}>
                        <span className={`absolute top-[2px] w-3.5 h-3.5 rounded-full bg-white shadow transition-all ${l1Item.is_enabled ? 'left-[17px]' : 'left-[2px]'}`} />
                    </button>
                    <div className={actionSlot}>
                        <button onClick={() => handleEditStart(l1Item)}
                            className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-300 group-hover:text-slate-500 hover:text-blue-600 transition-colors" title="编辑">
                            <Pencil size={13} />
                        </button>
                        <button onClick={() => handleDelete(l1Item.id, l1Item.name)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-slate-300 group-hover:text-slate-500 hover:text-red-500 transition-colors" title="删除">
                            <Trash2 size={13} />
                        </button>
                    </div>
                </div>
                {expanded && (
                    <>
                        {children.map(l2 => <LeafRow key={l2.id} item={l2} depth={2} />)}
                        {addingType === 'l2' && addingParentId === l1Item.id && <AddRow depth={2} />}
                        {children.length === 0 && addingType !== 'l2' && (
                            <div className="text-slate-400 text-xs text-center py-3" style={{ paddingLeft: '56px' }}>暂无二级分类</div>
                        )}
                    </>
                )}
            </div>
        );
    };

    // 公司主体 section header
    const entityExpanded = expandedNodes.has('entity');

    return (
        <div className="relative p-5">
            {/* Toast */}
            {toast && (
                <div className={`absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-4 py-2 rounded-lg shadow-md text-[13px] transition-all ${
                    toast.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
                }`}>
                    {toast.type === 'success' ? <CheckCircle size={14} /> : <XCircle size={14} />}
                    {toast.msg}
                </div>
            )}

            <div className="bg-white rounded-xl border border-slate-200/70 shadow-sm overflow-hidden">
                {/* 顶部工具栏 */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/40">
                    <span className="text-[13px] font-semibold text-slate-700">字典配置</span>
                    <span className="text-[11px] text-slate-400 tabular-nums">共 {entities.length + l1List.length + l2List.length} 项</span>
                </div>

                <div className="divide-y divide-slate-100/60">
                    {/* ── 公司主体（折叠区） ── */}
                    <div>
                        <div className="flex items-center gap-2 px-5 py-2.5 bg-slate-50/30 hover:bg-slate-50/60 transition-colors">
                            <button onClick={() => toggleExpand('entity')} className="text-slate-400 shrink-0 hover:text-slate-600 transition">
                                <ChevronRight size={14} className={`transition-transform ${entityExpanded ? 'rotate-90' : ''}`} />
                            </button>
                            <Building2 size={14} className="text-amber-500 shrink-0" />
                            <span className="text-[13px] font-medium text-slate-700 flex-1">公司主体</span>
                            <span className="text-[10px] text-slate-400 bg-slate-100 rounded-full px-1.5 py-px tabular-nums">{entities.length}</span>
                            <button onClick={() => startAdd('entity')}
                                className="p-1 rounded-md text-slate-300 hover:bg-blue-50 hover:text-blue-600 transition-colors shrink-0" title="新增公司主体">
                                <Plus size={13} />
                            </button>
                        </div>
                        {entityExpanded && (
                            <>
                                {entities.map(item => <LeafRow key={item.id} item={item} depth={1} />)}
                                {addingType === 'entity' && <AddRow depth={1} />}
                            </>
                        )}
                    </div>

                    {/* ── 一级分类 + 二级分类 ── */}
                    <div>
                        <div className="flex items-center gap-2 px-5 py-2.5 bg-slate-50/30 hover:bg-slate-50/60 transition-colors">
                            <button onClick={() => toggleExpand('l1')} className="text-slate-400 shrink-0 hover:text-slate-600 transition">
                                <ChevronRight size={14} className={`transition-transform ${expandedNodes.has('l1') ? 'rotate-90' : ''}`} />
                            </button>
                            <FolderOpen size={14} className="text-blue-400 shrink-0" />
                            <span className="text-[13px] font-medium text-slate-700 flex-1">一级分类</span>
                            <span className="text-[10px] text-slate-400 bg-slate-100 rounded-full px-1.5 py-px tabular-nums">{l1List.length}</span>
                            <button onClick={() => startAdd('l1')}
                                className="p-1 rounded-md text-slate-300 hover:bg-blue-50 hover:text-blue-600 transition-colors shrink-0" title="新增一级分类">
                                <Plus size={13} />
                            </button>
                        </div>
                        {expandedNodes.has('l1') && (
                            <>
                                {l1List.map(l1 => <L1Node key={l1.id} l1Item={l1} />)}
                                {addingType === 'l1' && <AddRow depth={1} />}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ============================================================
// ■ 通用小组件
// ============================================================
function StatusBadge({ status }: { status: string }) {
    const colors: Record<string, string> = {
        '有效': 'bg-emerald-50 text-emerald-600 border border-emerald-200',
        '待更新': 'bg-amber-50 text-amber-600 border border-amber-200',
        '已废弃': 'bg-slate-50 text-slate-500 border border-slate-200',
        '仅供参考': 'bg-blue-50 text-blue-600 border border-blue-200',
    };
    return <span className={`px-1.5 py-0.5 rounded text-[10px] ${colors[status] || 'bg-slate-50 text-slate-500 border border-slate-200'}`}>{status}</span>;
}

function SensitivityBadge({ level }: { level: string }) {
    const colors: Record<string, string> = {
        '公开': 'bg-emerald-50 text-emerald-600 border border-emerald-200',
        '受限': 'bg-amber-50 text-amber-600 border border-amber-200',
        '高敏感': 'bg-red-50 text-red-600 border border-red-200',
    };
    return <span className={`px-1.5 py-0.5 rounded text-[10px] ${colors[level] || 'bg-slate-50 text-slate-500 border border-slate-200'}`}>{level}</span>;
}
