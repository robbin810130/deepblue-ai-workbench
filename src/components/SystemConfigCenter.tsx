import React, { useState, useEffect, useMemo } from 'react';
import {
  Database, RefreshCw, Save, X, Settings2, ShieldCheck,
  AlertTriangle, Info, CheckCircle2, XCircle, RotateCcw,
  Sparkles, Newspaper, Globe, FlaskConical, LayoutPanelLeft, ArrowLeft, Search
} from 'lucide-react';
import { fetchWithAuth } from '../utils/authFetch';

interface SystemConfigCenterProps {
  username: string;
  onExit: () => void;
  onLogout: () => void;
}

// ─── 内部组件：标签输入框 (Tag Input) - 亮色版 ─────────────────────────────
const TagInput: React.FC<{
  value: string[];
  onChange: (val: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}> = ({ value = [], onChange, placeholder = "输入后按回车添加...", disabled = false }) => {
  const [inputValue, setInputValue] = useState('');

  const addTag = () => {
    const trimmed = inputValue.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
      setInputValue('');
    }
  };

  const removeTag = (tag: string) => {
    if (disabled) return;
    onChange(value.filter(t => t !== tag));
  };

  return (
    <div className={`p-3 bg-slate-50 border rounded-xl min-h-[56px] flex flex-wrap items-center gap-2 transition-all ${disabled ? 'border-slate-200 bg-slate-100 opacity-70 cursor-not-allowed' : 'border-slate-200 hover:border-indigo-300 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20'}`}>
      {value.map(tag => (
        <span key={tag} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-100 text-indigo-700 text-sm font-medium rounded-lg border border-indigo-200 shadow-sm">
          {tag}
          {!disabled && (
            <button onClick={() => removeTag(tag)} className="text-indigo-400 hover:text-indigo-600 focus:outline-none bg-indigo-200/50 hover:bg-indigo-200 p-0.5 rounded-md transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </span>
      ))}

      {!disabled && (
        <input
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onBlur={() => { if (inputValue.trim()) addTag(); }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag();
            } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
              removeTag(value[value.length - 1]);
            }
          }}
          className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-sm text-slate-700 placeholder-slate-400"
          placeholder={value.length === 0 ? placeholder : "继续添加..."}
        />
      )}
    </div>
  );
};


// ─── 内部组件：保存确认弹窗 (Diff展示) ─────────────────────────────────────────
const ConfirmSaveModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  before: string[];
  after: string[];
  isSaving: boolean;
}> = ({ isOpen, onClose, onConfirm, title, before, after, isSaving }) => {
  if (!isOpen) return null;

  const added = after.filter(item => !before.includes(item));
  const removed = before.filter(item => !after.includes(item));
  const unchanged = before.filter(item => after.includes(item));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden border border-slate-200 flex flex-col max-h-[85vh]">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3 bg-slate-50">
          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-800">确认将更改同步到生产数据库？</h3>
            <p className="text-xs text-slate-500 mt-0.5">即将覆盖 <span className="font-semibold text-slate-700">{title}</span> 的配置</p>
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1 bg-white custom-scrollbar text-sm">
           <div className="mb-3 text-slate-600 font-medium text-xs">变更预览 (Diff)</div>
           <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
              <div className="p-3 font-mono text-xs max-h-64 overflow-y-auto custom-scrollbar space-y-1">
                 {removed.map(item => (
                   <div key={`rm-${item}`} className="flex items-start gap-2 text-rose-600 bg-rose-50/50 px-2 py-1 rounded">
                     <span className="font-bold">-</span> <span className="line-through opacity-80">{item}</span>
                   </div>
                 ))}
                 {added.map(item => (
                   <div key={`add-${item}`} className="flex items-start gap-2 text-emerald-600 bg-emerald-50/50 px-2 py-1 rounded">
                     <span className="font-bold">+</span> <span className="font-medium">{item}</span>
                   </div>
                 ))}
                 {unchanged.map(item => (
                   <div key={`keep-${item}`} className="flex items-start gap-2 text-slate-400 px-2 py-1">
                     <span>&nbsp;</span> <span>{item}</span>
                   </div>
                 ))}
                 {before.length === 0 && after.length === 0 && (
                    <div className="text-slate-400 italic text-center py-4">无数据</div>
                 )}
              </div>
           </div>
           
           <div className="mt-4 p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-800 text-xs flex gap-2">
             <Info className="w-4 h-4 shrink-0 mt-0.5" />
             <p>此操作将直接覆盖生产数据库，并在审计日志中记录。确认无误后请继续。</p>
           </div>
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
          <button 
            disabled={isSaving}
            onClick={onClose} 
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 bg-slate-100 border border-slate-200 rounded-xl transition-colors"
          >
            取消
          </button>
          <button 
            disabled={isSaving || (added.length === 0 && removed.length === 0)}
            onClick={onConfirm} 
            className="flex items-center gap-2 px-5 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-sm transition-colors"
          >
            {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            确认并同步
          </button>
        </div>
      </div>
    </div>
  );
};


// ─── 主组件 ────────────────────────────────────────────────────────
export const SystemConfigCenter: React.FC<SystemConfigCenterProps> = ({ onExit }) => {
  const [activeTab, setActiveTab] = useState<'aiimage' | 'news' | 'marketing' | 'beautyrnd'>('aiimage');
  const [data, setData] = useState<any[]>([]);
  const [initialData, setInitialData] = useState<any[]>([]); // 用于比对脏数据和还原
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  
  // 真实数据库状态
  const [dbStatus, setDbStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [dbLatency, setDbLatency] = useState<number>(0);

  // 待保存的脏字段状态
  const [savingTarget, setSavingTarget] = useState<{ id: string|number, label: string, currentOptions: string[], type?: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // 侧边说明面板开关
  const [showGuide, setShowGuide] = useState(true);

  // 所属用户搜索
  const [searchCreator, setSearchCreator] = useState('');

  // 提示工具
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // 检测数据库状态
  const checkDbHealth = async () => {
    try {
      setDbStatus('checking');
      const res = await fetchWithAuth('/api/admin/config/health');
      const json = await res.json();
      if (json.success) {
        setDbStatus('connected');
        setDbLatency(json.latencyMs || 0);
      } else {
        setDbStatus('error');
      }
    } catch {
      setDbStatus('error');
    }
  };

  useEffect(() => {
    checkDbHealth();
    const interval = setInterval(checkDbHealth, 60000); // 每分钟检测一次
    return () => clearInterval(interval);
  }, []);

  // 加载模块数据
  const loadData = async (tab = activeTab) => {
    setLoading(true);
    try {
      let url = '';
      if (tab === 'aiimage') url = '/api/config/ai_scenes';
      else if (tab === 'news') url = '/api/admin/config/news_keywords';
      else if (tab === 'marketing') url = '/api/admin/config/marketing';
      else if (tab === 'beautyrnd') url = '/api/admin/config/beautyrnd';

      const res = await fetchWithAuth(url);
      const json = await res.json();
      
      if (json.success) {
        // 深拷贝作为初始数据快照
        const snapshot = JSON.parse(JSON.stringify(json.data));
        setData(json.data);
        setInitialData(snapshot);
      } else {
        showToast(json.message || '加载配置失败', 'error');
      }
    } catch (e: any) {
      console.error('[ConfigCenter] Load error:', e);
      showToast('通讯故障，无法获取配置数据', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(activeTab);
  }, [activeTab]);


  // 计算当前 Tab 是否有未保存的脏数据 (用于角标和离开提示)
  const isDirty = useMemo(() => {
    return JSON.stringify(data) !== JSON.stringify(initialData);
  }, [data, initialData]);

  // 切换 Tab 时的拦截
  const handleTabSwitch = (newTab: typeof activeTab) => {
    if (activeTab === newTab) return;
    if (isDirty) {
      if (!window.confirm('当前标签页有未保存的更改，强制离开将丢失这些更改。确定离开吗？')) {
        return;
      }
    }
    setActiveTab(newTab);
    setSearchCreator('');
  };

  // 还原某个字段的修改
  const handleRevert = (id: string | number, isAiSceneField = false, sceneId?: string | number) => {
    if (isAiSceneField && sceneId) {
       const initialScene = initialData.find(s => s.id === sceneId);
       const initialField = initialScene?.fields.find((f:any) => f.id === id);
       if (initialField) {
         updateLocalFieldOptions(id, initialField.options, sceneId);
       }
    } else {
       const initialItem = initialData.find(item => item.id === id);
       if (initialItem) {
          updateLocalFlatOptions(id, activeTab === 'news' ? initialItem.keyword : initialItem.name);
       }
    }
    showToast('已还原为初始状态');
  };


  // 本地更新 state (嵌套/扁平)
  const updateLocalFieldOptions = (fieldId: string | number, newOptions: string[], sceneId: string | number) => {
    const newData = [...data];
    const sIdx = newData.findIndex(s => s.id === sceneId);
    if (sIdx > -1) {
      const fIdx = newData[sIdx].fields.findIndex((f:any) => f.id === fieldId);
      if (fIdx > -1) {
        newData[sIdx].fields[fIdx].options = newOptions;
        setData(newData);
      }
    }
  };

  const updateLocalFlatOptions = (id: string | number, newOptions: string[]) => {
    const newData = [...data];
    const idx = newData.findIndex(item => item.id === id);
    if (idx > -1) {
      if (activeTab === 'news') newData[idx].keyword = newOptions;
      else newData[idx].name = newOptions;
      setData(newData);
    }
  };


  // 触发保存确认弹窗
  const initiateSave = (id: string | number, label: string, currentOptions: string[], isAiSceneField = false) => {
    setSavingTarget({
        id, label, currentOptions, type: isAiSceneField ? 'ai_fields' : activeTab
    });
  };

  // 实际执行写库操作
  const confirmSave = async () => {
    if (!savingTarget) return;
    setIsSaving(true);

    try {
      let url = '';
      let payloadKey = 'options';
      
      if (savingTarget.type === 'ai_fields') {
        url = `/api/admin/config/ai_fields/${savingTarget.id}`;
      } else if (savingTarget.type === 'news') {
        url = `/api/admin/config/news_keywords/${savingTarget.id}`;
        payloadKey = 'keyword';
      } else if (savingTarget.type === 'marketing') {
        url = `/api/admin/config/marketing/${savingTarget.id}`;
        payloadKey = 'name';
      } else if (savingTarget.type === 'beautyrnd') {
        url = `/api/admin/config/beautyrnd/${savingTarget.id}`;
        payloadKey = 'name';
      }

      const res = await fetchWithAuth(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [payloadKey]: savingTarget.currentOptions })
      });
      
      const json = await res.json();
      if (json.success) {
        showToast('配置已成功同步到生产环境');
        // 重新拉取以更新 initialData
        await loadData();
      } else {
        throw new Error(json.message);
      }
    } catch (e: any) {
      showToast(e.message || '保存失败', 'error');
    } finally {
      setIsSaving(false);
      setSavingTarget(null);
    }
  };

  // 切换 is_active 状态 (目前仅支持 news)
  const toggleStatus = async (id: number) => {
    try {
       const res = await fetchWithAuth(`/api/admin/config/news_keywords/${id}/toggle`, {
           method: 'PATCH'
       });
       const json = await res.json();
       if (json.success) {
           const newData = [...data];
           const idx = newData.findIndex(item => item.id === id);
           if (idx > -1) {
               newData[idx].is_active = json.is_active;
               setData(newData);
               // 同步更新初始数据，防止 isDirty 误判
               const newInitial = [...initialData];
               newInitial[idx].is_active = json.is_active;
               setInitialData(newInitial);
           }
           showToast(`分组已${json.is_active ? '启用' : '停用'}`);
       } else {
           throw new Error(json.message);
       }
    } catch (e:any) {
       showToast(e.message || '状态切换失败', 'error');
    }
  };


  const TABS = [
    { id: 'aiimage', label: 'AI生图配置', icon: Sparkles, desc: '电商生成场景选项' },
    { id: 'news', label: '每日推送词库', icon: Newspaper, desc: '自动推送抓取规则' },
    { id: 'marketing', label: '出海参数', icon: Globe, desc: '跨境营销底层参数' },
    { id: 'beautyrnd', label: '研发布局', icon: FlaskConical, desc: '配方分析维度设置' },
  ];

  return (
    <div className="flex flex-col h-full w-full bg-slate-100 font-sans text-slate-800 overflow-hidden relative">
      
      {/* 顶部 Header：白底、阴影、数据库状态 */}
      <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-4">
          <button onClick={onExit} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="h-6 w-px bg-slate-200" />
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600">
               <Settings2 className="w-4 h-4" />
             </div>
             <div>
               <h1 className="text-base font-black text-slate-800 tracking-tight">系统配置中心</h1>
               <p className="text-[10px] text-slate-500 font-medium">配置项变更将实时影响所有业务端点</p>
             </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
           {/* 数据库真实连通状态 */}
           <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold transition-colors ${
              dbStatus === 'connected' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
              dbStatus === 'error' ? 'bg-rose-50 text-rose-700 border-rose-200' :
              'bg-amber-50 text-amber-700 border-amber-200'
           }`}>
              {dbStatus === 'connected' && <><div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"/> 数据库已联通 ({dbLatency}ms)</>}
              {dbStatus === 'checking' && <><RefreshCw className="w-3 h-3 animate-spin"/> 正在检测连接...</>}
              {dbStatus === 'error' && <><XCircle className="w-3 h-3"/> 数据库断开连接</>}
           </div>
        </div>
      </header>

      {/* 顶部 Tab Bar */}
      <div className="bg-white border-b border-slate-200 px-6 pt-3 flex items-end gap-1 shrink-0">
         {TABS.map(tab => (
           <button
             key={tab.id}
             onClick={() => handleTabSwitch(tab.id as any)}
             className={`relative px-5 py-3 flex items-center gap-2 rounded-t-xl transition-all font-bold text-sm border-b-2 ${
               activeTab === tab.id 
                 ? 'bg-indigo-50 text-indigo-700 border-indigo-600' 
                 : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50 border-transparent'
             }`}
           >
             <tab.icon className={`w-4 h-4 ${activeTab === tab.id ? 'text-indigo-600' : 'opacity-70'}`} />
             {tab.label}
             {/* Tab 级别的脏数据角标：仅简单判定 isDirty 且当前激活时亮起 */}
             {activeTab === tab.id && isDirty && (
                <span className="absolute top-2 right-2 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
             )}
           </button>
         ))}
         
         <div className="flex-1" />
         
         <button 
            onClick={() => setShowGuide(!showGuide)}
            className={`mb-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5 ${
              showGuide ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
         >
            <LayoutPanelLeft className="w-3.5 h-3.5" />
            {showGuide ? '隐藏说明' : '显示说明'}
         </button>
      </div>

      {/* 主体区域 (配置列表 + 侧边说明) */}
      <div className="flex-1 overflow-hidden flex">
        
        {/* 左侧：配置列表内容区 */}
        <div className="flex-1 flex flex-col min-w-0 relative">
          
          {/* 独立固定的搜索表头（仅 news 模块可见） */}
          {activeTab === 'news' && (
             <div className="px-6 lg:px-8 pt-6 pb-2 shrink-0 bg-slate-100 z-10 animate-in slide-in-from-top-2 duration-300">
                <div className="max-w-5xl mx-auto relative">
                   <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                     <Search className="h-4 w-4 text-slate-400" />
                   </div>
                   <input
                     type="text"
                     className="block w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl leading-5 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm transition-all shadow-sm"
                     placeholder="搜索所属用户... (例如: admin)"
                     value={searchCreator}
                     onChange={(e) => setSearchCreator(e.target.value)}
                   />
                </div>
             </div>
          )}

          <div className={`flex-1 overflow-y-auto custom-scrollbar ${activeTab === 'news' ? 'px-6 lg:px-8 pb-6 lg:pb-8 pt-2' : 'p-6 lg:p-8'}`}>
          {loading ? (
             <div className="flex flex-col items-center justify-center h-full text-indigo-500 gap-3 opacity-60">
                <RefreshCw className="w-8 h-8 animate-spin" />
                <span className="text-sm font-bold tracking-widest uppercase">拉取配置中...</span>
             </div>
          ) : data.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4">
                <Database className="w-12 h-12 opacity-20" />
                <span className="text-sm font-bold">该模块暂无可配置项</span>
             </div>
          ) : (
             <div className="max-w-5xl mx-auto space-y-6 animate-in slide-in-from-bottom-2 duration-300">
               
               {activeTab === 'aiimage' ? (
                 // AI生图场景 - 嵌套结构展示
                 data.map((scene: any) => (
                   <div key={scene.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                     <div className="px-6 py-4 bg-slate-50/80 border-b border-slate-100 flex items-center gap-3">
                       <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600">
                         <Sparkles className="w-4 h-4" />
                       </div>
                       <div>
                         <h3 className="text-base font-black text-slate-800">{scene.label}</h3>
                         <p className="text-xs text-slate-500 mt-0.5">{scene.desc || `系统标识符: ${scene.id}`}</p>
                       </div>
                     </div>
                     
                     <div className="p-6 space-y-6">
                       {scene.fields?.map((field: any) => {
                          const initialOpts = initialData.find(s => s.id === scene.id)?.fields.find((f:any) => f.id === field.id)?.options || [];
                          const fieldDirty = JSON.stringify(field.options) !== JSON.stringify(initialOpts);

                          return (
                            <div key={field.id} className={`p-5 rounded-xl border transition-all ${fieldDirty ? 'border-amber-200 bg-amber-50/30 shadow-sm' : 'border-slate-100 bg-white hover:border-slate-200 hover:shadow-sm'}`}>
                              <div className="flex items-start justify-between mb-4">
                                <div>
                                   <div className="flex items-center gap-2">
                                     <h4 className="text-sm font-bold text-slate-800">{field.label}</h4>
                                     {fieldDirty && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200">未保存</span>}
                                   </div>
                                   <p className="text-xs text-slate-500 mt-1">标识: <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-600">{field.id}</code> · 当前 {field.options?.length || 0} 项</p>
                                </div>
                                <div className="flex items-center gap-2">
                                   {fieldDirty && (
                                     <button 
                                       onClick={() => handleRevert(field.id, true, scene.id)}
                                       className="px-3 py-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 transition-colors"
                                     >
                                       <RotateCcw className="w-3.5 h-3.5" /> 还原
                                     </button>
                                   )}
                                   <button 
                                     disabled={!fieldDirty || isSaving}
                                     onClick={() => initiateSave(field.id, field.label, field.options, true)}
                                     className={`px-4 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all shadow-sm
                                       ${fieldDirty ? 'bg-indigo-600 hover:bg-indigo-700 text-white border border-transparent' : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'}
                                     `}
                                   >
                                     <Save className="w-3.5 h-3.5" /> 保存更改
                                   </button>
                                </div>
                              </div>
                              <TagInput 
                                 value={field.options || []} 
                                 onChange={(newVal) => updateLocalFieldOptions(field.id, newVal, scene.id)} 
                               />
                            </div>
                          );
                       })}
                     </div>
                   </div>
                 ))
               ) : (
                 // 其他模块 - 扁平列表展示 (news, marketing, beautyrnd)
                 <>
                   {data
                     .filter((item) => {
                       if (activeTab !== 'news' || !searchCreator.trim()) return true;
                       const creator = item.creator || '系统内置';
                       return creator.toLowerCase().includes(searchCreator.trim().toLowerCase());
                     })
                     .map((item) => {
                    const opts = activeTab === 'news' ? item.keyword : item.name;
                    const initialOpts = activeTab === 'news' 
                       ? initialData.find(i => i.id === item.id)?.keyword 
                       : initialData.find(i => i.id === item.id)?.name;
                    const isItemDirty = JSON.stringify(opts) !== JSON.stringify(initialOpts);

                    return (
                      <div key={item.id} className={`bg-white border rounded-2xl overflow-hidden transition-all ${isItemDirty ? 'border-amber-300 shadow-md ring-1 ring-amber-100' : 'border-slate-200 shadow-sm hover:border-indigo-300 hover:shadow-md'}`}>
                        <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                                {item.label || item.name_cn || item.group_name || '未命名配置项'}
                                {item.creator && (
                                  <span className="text-xs font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                                    所属用户：{item.creator}
                                  </span>
                                )}
                              </h3>
                              {isItemDirty && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200">未保存更改</span>}
                            </div>
                            <p className="text-xs text-slate-500 flex items-center gap-2">
                               <code className="bg-slate-200 px-1 py-0.5 rounded text-slate-700 font-mono">ID: {item.id}</code>
                               {item.description && <span>· {item.description}</span>}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            {/* is_active 切换开关 (仅 news 模块有该字段) */}
                            {item.is_active !== undefined && (
                              <button
                                onClick={() => toggleStatus(item.id)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                                   item.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                                }`}
                              >
                                {item.is_active ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                                {item.is_active ? '已启用' : '已停用'}
                              </button>
                            )}

                            {isItemDirty && (
                              <button 
                                onClick={() => handleRevert(item.id)}
                                className="px-3 py-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 transition-colors"
                              >
                                <RotateCcw className="w-3.5 h-3.5" /> 还原
                              </button>
                            )}
                            <button 
                              disabled={!isItemDirty || isSaving}
                              onClick={() => initiateSave(item.id, item.label || `配置项 ${item.id}`, opts)}
                              className={`px-4 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all shadow-sm
                                 ${isItemDirty ? 'bg-indigo-600 hover:bg-indigo-700 text-white border border-transparent' : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'}
                              `}
                            >
                              <Save className="w-3.5 h-3.5" /> 保存配置
                            </button>
                          </div>
                        </div>
                        
                        <div className="p-6">
                           <div className="mb-3 flex items-center justify-between">
                              <label className="text-sm font-bold text-slate-700">标签集合 <span className="text-slate-400 font-normal text-xs ml-2">(共 {opts?.length || 0} 项)</span></label>
                           </div>
                           <TagInput 
                             value={opts || []} 
                             onChange={(newVal) => updateLocalFlatOptions(item.id, newVal)} 
                           />
                        </div>
                      </div>
                    );
                 })
               }
               </>
               )}
             </div>
          )}
        </div>
        </div>

        {/* 右侧：实施人员说明面板 (可折叠) */}
        {showGuide && (
          <div className="w-72 bg-white border-l border-slate-200 shrink-0 flex flex-col animate-in slide-in-from-right-4 duration-300">
             <div className="p-4 border-b border-slate-100 flex items-center gap-2 bg-slate-50">
                <Info className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-800">实施配置指南</h3>
             </div>
             <div className="p-5 flex-1 overflow-y-auto space-y-6 text-sm text-slate-600 custom-scrollbar">
                
                {activeTab === 'aiimage' && (
                  <>
                    <p>此页面维护 <strong>电商生图</strong> 模块中各个场景的下拉选项内容。</p>
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-xs space-y-2">
                       <p><strong className="text-slate-700">场景配置结构：</strong><br/>电商生图按场景分类（如：女装模型、美妆模型），每个场景下包含不同的字段维度（如：背景风格、模特姿势）。</p>
                       <p className="text-amber-600">⚠️ 修改后立即影响前端用户的下拉可选范围，请确认错别字。</p>
                    </div>
                  </>
                )}

                {activeTab === 'news' && (
                  <>
                    <p>此页面维护 <strong>每日推送</strong> 模块自动从全网抓取行业资讯的关键词库。</p>
                    <ul className="list-disc pl-4 space-y-1 text-xs">
                       <li>每个分组代表一类新闻的聚类主题。</li>
                       <li>可以随时<strong className="text-emerald-600">启用/停用</strong>某个分组，停用后系统将不再抓取该类新闻。</li>
                       <li>关键词越精准，抓取的新闻越相关。</li>
                    </ul>
                  </>
                )}

                {activeTab === 'marketing' && (
                  <>
                    <p>此页面维护 <strong>出海营销</strong> 模块的通用底层参数。</p>
                    <div className="space-y-3 mt-2 text-xs">
                       <div><span className="font-bold text-indigo-600">目标语种</span><br/>决定营销报告生成时可选择翻译的语言。</div>
                       <div><span className="font-bold text-indigo-600">目标平台</span><br/>包含主流的跨境电商分发平台选项。</div>
                       <div><span className="font-bold text-indigo-600">营销风格</span><br/>提供给大模型的 Prompt 风格约束词。</div>
                    </div>
                  </>
                )}

                {activeTab === 'beautyrnd' && (
                  <>
                    <p>此页面维护 <strong>美妆研发</strong> 模块的业务字典数据。</p>
                    <p className="text-xs">增加新的痛点特征或认证需求后，用户在提交研发配方分析时即可多选这些新标签。</p>
                  </>
                )}

                <div className="mt-8 pt-6 border-t border-slate-200">
                   <h4 className="text-xs font-bold text-slate-800 mb-2 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-emerald-500"/> 安全审计启用</h4>
                   <p className="text-[11px] leading-relaxed text-slate-500">
                     您在此页面的所有保存、状态切换操作均会实时写入系统的 <code>sys_audit_logs</code> 表。操作前后变更的内容可至「系统操作日志」模块追溯核查。
                   </p>
                </div>
             </div>
          </div>
        )}
      </div>

      {/* 弹窗层 */}
      <ConfirmSaveModal 
        isOpen={!!savingTarget}
        title={savingTarget?.label || ''}
        before={savingTarget ? (
           savingTarget.type === 'ai_fields' ? 
           initialData.find(s => s.fields?.some((f:any) => f.id === savingTarget.id))?.fields.find((f:any) => f.id === savingTarget.id)?.options || [] :
           initialData.find(i => i.id === savingTarget.id)?.[savingTarget.type === 'news' ? 'keyword' : 'name'] || []
        ) : []}
        after={savingTarget?.currentOptions || []}
        onClose={() => setSavingTarget(null)}
        onConfirm={confirmSave}
        isSaving={isSaving}
      />

      {/* Toast 提示 */}
      {toast && (
        <div className={`fixed top-8 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-xl shadow-xl flex items-center gap-3 border animate-in slide-in-from-top-4 font-medium text-sm
          ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}
        `}>
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <AlertTriangle className="w-4 h-4 text-rose-500" />}
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
};

export default SystemConfigCenter;
