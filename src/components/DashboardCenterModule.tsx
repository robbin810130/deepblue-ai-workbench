import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard, RefreshCw, Settings2, Trash2, Search, PackageOpen, LayoutGrid, ArrowLeft, ExternalLink,
  ShieldCheck, UsersRound, Check, X, Save
} from 'lucide-react';
import { fetchWithAuth } from '../utils/authFetch';
import { useRole } from '../context/RoleContext';
import { BUSINESS_DASHBOARD_ENDPOINT } from '../config';

interface PublishedDashboard {
  dashboard_id: string;
  title: string;
  domain: string;
  description: string;
  view_url: string;
  source: string;
  allowed_roles: string[];
  published_at: string;
}

interface ViewingTarget {
  name: string;
  url: string;
  sandbox: boolean;
}

interface SystemRole {
  name: string;
  display_name: string;
}

const DOMAIN_LABELS: Record<string, string> = {
  finance: '财务',
  warehouse: '仓储',
  sales: '销售',
  procurement: '采购',
  production: '生产',
  other: '其他',
};

const LEGACY_ROLE_LABELS: Record<string, string> = {
  pur: '采购',
  procurement: '采购',
  sale: '销售',
  sales: '销售',
  fin: '财务',
  finance: '财务',
  warehouse: '仓储',
  production: '生产',
  admin: '管理员',
  user: '普通用户',
  readonly: '只读用户',
};

const formatVisibility = (allowedRoles: string[] | undefined, roleLabels: Map<string, string>) => {
  const roles = Array.isArray(allowedRoles)
    ? allowedRoles.map(role => String(role).trim()).filter(Boolean)
    : [];

  if (roles.includes('*')) return '可视范围：全部角色';
  if (roles.length === 0) return '可视范围：未设置';
  return `可视角色：${roles.map(role => roleLabels.get(role) || LEGACY_ROLE_LABELS[role] || role).join('、')}`;
};

const DashboardCenterModule: React.FC = () => {
  const { currentRole } = useRole();
  const isAdmin = currentRole === 'admin';

  const [published, setPublished] = useState<PublishedDashboard[]>([]);
  const [loadingPub, setLoadingPub] = useState(true);
  const [viewing, setViewing] = useState<ViewingTarget | null>(null);
  
  const [showAdmin, setShowAdmin] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [viewMode, setViewMode] = useState<'published' | 'archived'>('published');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [systemRoles, setSystemRoles] = useState<SystemRole[]>([]);
  const [editingDashboard, setEditingDashboard] = useState<PublishedDashboard | null>(null);
  const [draftRoles, setDraftRoles] = useState<string[]>([]);
  const [savingRoles, setSavingRoles] = useState(false);

  const roleLabels = new Map(systemRoles.map(role => [role.name, role.display_name || role.name]));

  const loadPublished = useCallback(async () => {
    setLoadingPub(true);
    setSelectedIds(new Set());
    try {
      const url = new URL(BUSINESS_DASHBOARD_ENDPOINT, window.location.origin);
      url.searchParams.append('page', '1');
      url.searchParams.append('page_size', '100');
      url.searchParams.append('status', viewMode);
      if (searchKeyword.trim()) {
        url.searchParams.append('keyword', searchKeyword.trim());
      }
      const res = await fetchWithAuth(url.toString());
      const data = await res.json();
      if (data.success) setPublished(data.data?.items || []);
    } catch { 
    } finally { 
      setLoadingPub(false); 
    }
  }, [viewMode, searchKeyword]);

  useEffect(() => {
    loadPublished();
  }, [loadPublished]);

  useEffect(() => {
    const loadSystemRoles = async () => {
      try {
        const res = await fetchWithAuth('/api/admin/roles-public');
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) setSystemRoles(data.data);
      } catch {
        setSystemRoles([]);
      }
    };
    loadSystemRoles();
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      loadPublished();
    }, 500);
    return () => clearTimeout(timer);
  }, [searchKeyword, loadPublished]);

  const handleDeletePublished = async (e: React.MouseEvent, dashboardId: string) => {
    e.stopPropagation();
    if (!window.confirm('确定彻底删除该看板吗？此操作不可恢复。')) return;
    try {
      const res = await fetchWithAuth(`${BUSINESS_DASHBOARD_ENDPOINT}/${dashboardId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        loadPublished();
      } else {
        alert(data.message || '删除失败');
      }
    } catch (err: any) {
      alert(err.message || '删除出错');
    }
  };

  const handleBatchStatus = async (status: 'archived' | 'published') => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`确定将选中的 ${selectedIds.size} 个看板${status === 'archived' ? '归档' : '恢复'}吗？`)) return;
    try {
      const res = await fetchWithAuth(`${BUSINESS_DASHBOARD_ENDPOINT}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dashboard_ids: Array.from(selectedIds), status })
      });
      const data = await res.json();
      if (data.success) {
        loadPublished();
      } else {
        alert(data.message || '操作失败');
      }
    } catch (err: any) {
      alert(err.message || '操作出错');
    }
  };

  const toggleSelect = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const openRoleEditor = (e: React.MouseEvent, dashboard: PublishedDashboard) => {
    e.stopPropagation();
    setEditingDashboard(dashboard);
    setDraftRoles(Array.isArray(dashboard.allowed_roles) && dashboard.allowed_roles.length > 0 ? dashboard.allowed_roles : ['*']);
  };

  const toggleRole = (roleName: string) => {
    setDraftRoles(current => {
      if (roleName === '*') return ['*'];
      const withoutAll = current.filter(role => role !== '*');
      return withoutAll.includes(roleName)
        ? withoutAll.filter(role => role !== roleName)
        : [...withoutAll, roleName];
    });
  };

  const saveRoles = async () => {
    if (!editingDashboard || draftRoles.length === 0) return;
    setSavingRoles(true);
    try {
      const res = await fetchWithAuth(`${BUSINESS_DASHBOARD_ENDPOINT}/${editingDashboard.dashboard_id}/roles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed_roles: draftRoles }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || '保存失败');
      setEditingDashboard(null);
      await loadPublished();
    } catch (error: any) {
      alert(error.message || '可视角色保存失败');
    } finally {
      setSavingRoles(false);
    }
  };

  if (viewing) {
    return (
      <div className="h-full flex flex-col bg-slate-100">
        <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-slate-200 shadow-sm">
          <button
            onClick={() => setViewing(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
          >
            <ArrowLeft size={16} /> 返回列表
          </button>
          <div className="h-5 w-px bg-slate-200" />
          <LayoutDashboard size={16} className="text-blue-500" />
          <span className="font-medium text-slate-800 truncate">{viewing.name}</span>
          <a
            href={viewing.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
          >
            <ExternalLink size={15} /> 新窗口打开
          </a>
        </div>
        <div className="flex-1 overflow-hidden relative bg-slate-100/50">
          <iframe
            src={viewing.url}
            className="absolute inset-0 w-full h-full border-0"
            sandbox={viewing.sandbox ? "allow-scripts allow-same-origin allow-forms allow-popups" : undefined}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      {editingDashboard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" onClick={() => !savingRoles && setEditingDashboard(null)}>
          <section className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-slate-100 bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-5 text-white">
              <div>
                <div className="flex items-center gap-2 text-base font-bold"><ShieldCheck size={19} /> 配置看板可视权限</div>
                <p className="mt-1 text-sm text-blue-100 truncate max-w-[400px]">{editingDashboard.title}</p>
              </div>
              <button onClick={() => setEditingDashboard(null)} disabled={savingRoles} className="rounded-lg p-1.5 text-blue-100 hover:bg-white/15 hover:text-white disabled:opacity-50" title="关闭"><X size={18} /></button>
            </div>
            <div className="space-y-5 px-6 py-5">
              <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                选择“全部角色”后，所有已登录角色均可查看；否则仅所选角色可查看。可多选。
              </div>
              <div>
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><UsersRound size={16} className="text-blue-600" /> 可分配角色</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => toggleRole('*')}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${draftRoles.includes('*') ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300'}`}
                  >
                    <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${draftRoles.includes('*') ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'}`}>{draftRoles.includes('*') && <Check size={14} />}</span>
                    <span><span className="block font-semibold">全部角色</span><span className="block text-xs text-slate-400">所有已登录用户可查看</span></span>
                  </button>
                  {systemRoles.map(role => {
                    const checked = draftRoles.includes('*') || draftRoles.includes(role.name);
                    return (
                      <button
                        key={role.name}
                        type="button"
                        onClick={() => toggleRole(role.name)}
                        className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${checked ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300'}`}
                      >
                        <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${checked ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'}`}>{checked && <Check size={14} />}</span>
                        <span className="min-w-0"><span className="block truncate font-semibold">{role.display_name || role.name}</span><span className="block truncate text-xs text-slate-400">角色标识：{role.name}</span></span>
                      </button>
                    );
                  })}
                </div>
                {systemRoles.length === 0 && <p className="mt-3 text-sm text-amber-600">未能读取系统角色，请刷新后重试。</p>}
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-6 py-4">
              <span className="text-sm text-slate-500">已选择 {draftRoles.includes('*') ? '全部角色' : `${draftRoles.length} 个角色`}</span>
              <div className="flex gap-3">
                <button onClick={() => setEditingDashboard(null)} disabled={savingRoles} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50">取消</button>
                <button onClick={saveRoles} disabled={savingRoles || draftRoles.length === 0} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"><Save size={15} />{savingRoles ? '保存中...' : '保存权限'}</button>
              </div>
            </div>
          </section>
        </div>
      )}
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
          <div>
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <LayoutDashboard className="text-blue-500" size={22} /> AI 业务看板
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              集中展示由 AI 生成的数据分析看板
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
             <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text" 
                  value={searchKeyword}
                  onChange={e => setSearchKeyword(e.target.value)}
                  placeholder="搜索看板标题或描述..." 
                  className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 w-64 transition-all"
                />
             </div>
             
             <div className="flex items-center bg-slate-100 p-1 rounded-lg">
               <button 
                 onClick={() => setViewMode('published')}
                 className={`px-3 py-1.5 text-sm rounded-md transition-all flex items-center gap-1.5 ${viewMode === 'published' ? 'bg-white text-blue-600 shadow-sm font-medium' : 'text-slate-600 hover:text-slate-900'}`}
               >
                 <LayoutGrid size={15} /> 已发布
               </button>
               <button 
                 onClick={() => setViewMode('archived')}
                 className={`px-3 py-1.5 text-sm rounded-md transition-all flex items-center gap-1.5 ${viewMode === 'archived' ? 'bg-white text-blue-600 shadow-sm font-medium' : 'text-slate-600 hover:text-slate-900'}`}
               >
                 <PackageOpen size={15} /> 已归档
               </button>
             </div>
            
             {isAdmin && (
              <button
                onClick={() => { setShowAdmin(v => !v); setSelectedIds(new Set()); }}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors ${
                  showAdmin
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
                }`}
              >
                <Settings2 size={15} /> {showAdmin ? '退出管理' : '管理看板'}
              </button>
            )}
            <button
              onClick={loadPublished}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:border-blue-300 hover:text-blue-600 transition-colors"
            >
              <RefreshCw size={15} className={loadingPub ? 'animate-spin' : ''} /> 刷新
            </button>
          </div>
        </div>

        {showAdmin && selectedIds.size > 0 && (
          <div className="flex items-center justify-between bg-blue-50 border border-blue-100 p-3 rounded-xl animate-in slide-in-from-top-2">
             <div className="text-sm text-blue-700 font-medium">已选择 {selectedIds.size} 项</div>
             <button 
               onClick={() => handleBatchStatus(viewMode === 'published' ? 'archived' : 'published')}
               className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
             >
               {viewMode === 'published' ? '批量归档' : '批量恢复'}
             </button>
          </div>
        )}

        {showAdmin && (
          <div className="flex flex-col gap-3 rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm"><UsersRound size={19} /></span>
              <div><h2 className="font-semibold text-slate-800">看板角色权限管理</h2><p className="mt-0.5 text-sm text-slate-500">点击卡片右上角“配置权限”，可为单个看板分配多个可视角色。</p></div>
            </div>
            <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 shadow-sm">已加载 {systemRoles.length} 个系统角色</span>
          </div>
        )}

        {loadingPub ? (
           <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-slate-400" size={24} /></div>
        ) : published.length === 0 ? (
           <div className="text-center p-10 text-slate-500 bg-white rounded-2xl border border-slate-100 shadow-sm">暂无看板</div>
        ) : (
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
             {published.map(pub => {
               const isSelected = selectedIds.has(pub.dashboard_id);
               return (
                 <div
                   key={pub.dashboard_id}
                   onClick={(e) => {
                     if (showAdmin) {
                       toggleSelect(e, pub.dashboard_id);
                     } else {
                       setViewing({ name: pub.title, url: pub.view_url, sandbox: true });
                     }
                   }}
                   className={`group rounded-2xl border ${isSelected ? 'bg-blue-50 border-blue-400 ring-1 ring-blue-400' : 'bg-white border-slate-200'} shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden flex flex-col relative`}
                 >
                   {showAdmin && (
                      <div className="absolute top-4 right-4 z-10 flex gap-2">
                        <button
                          onClick={(e) => openRoleEditor(e, pub)}
                          className="flex items-center gap-1.5 rounded-lg border border-blue-100 bg-white/95 px-2.5 py-1.5 text-xs font-medium text-blue-600 shadow-sm transition-colors hover:bg-blue-50"
                          title="配置可视角色"
                        >
                          <ShieldCheck size={14} /> 配置权限
                        </button>
                        <button
                          onClick={(e) => handleDeletePublished(e, pub.dashboard_id)}
                          className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors bg-white/90 backdrop-blur-sm shadow-sm border border-slate-100"
                          title="彻底删除"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                   )}
                   <div className="p-5 pt-5 flex-1 flex flex-col justify-start">
                     <div className="flex items-center gap-2 mb-3.5 mt-1">
                       <span className="px-3.5 py-1.5 text-[13px] font-bold tracking-widest rounded-lg uppercase bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-sm shadow-emerald-200">
                         {DOMAIN_LABELS[pub.domain] || pub.domain}
                       </span>
                     </div>
                     <h3 className="font-bold text-slate-800 text-[19px] mb-2.5 line-clamp-2 leading-snug">{pub.title}</h3>
                     <p className="text-[13px] text-slate-500 line-clamp-2 leading-relaxed">{pub.description || '由 AI 深度分析业务数据并生成的经营概览看板。'}</p>
                   </div>
                   <div className={`px-5 py-3 ${isSelected ? 'bg-blue-100/50 border-blue-200' : 'bg-slate-50/50 border-slate-100'} border-t flex items-center justify-between mt-auto`}>
                      <div className="text-[11px] text-slate-400 truncate pr-3" title={formatVisibility(pub.allowed_roles, roleLabels)}>
                        {formatVisibility(pub.allowed_roles, roleLabels)}
                      </div>
                      <div className="flex items-center gap-1 text-[11px] font-medium text-slate-400">
                         {new Date(pub.published_at).toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </div>
                   </div>
                 </div>
               );
             })}
           </div>
        )}
      </div>
    </div>
  );
};

export default DashboardCenterModule;

