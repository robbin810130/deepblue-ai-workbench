import React, { useState, useEffect, useRef } from 'react';
import { Newspaper, RefreshCw, Clock, MessageSquare, Settings, Check, ChevronDown, Sparkles, Tag, Globe, Wallet, Cpu, User, ExternalLink, History, Trash2, Send, Plus, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { API_NEWS_BASE } from '../config';
import { fetchWithAuth } from '../utils/authFetch';
import { useNewsKeywords } from '../hooks/useConfig';

interface NewsItem {
    title: string;
    source: string;
    time: string;
    url?: string;
}

interface NewsCategory {
    name: string;
    news_list: NewsItem[];
}

interface NewsData {
    report_date?: string;
    date?: string;
    categories: {
        [key: string]: NewsCategory;
    };
}

interface HistoryItem {
    id: number;
    report_date: string;
    industry: string;
    created_at: string;
    content?: NewsData;
}

// 图标与颜色样式映射字典，完全根据数据库内的 group_name 匹配渲染
const KEYWORD_UI_CONFIG: Record<string, { icon: any, color: string, bg: string }> = {
    '科技前沿': { icon: Cpu, color: 'text-purple-500', bg: 'bg-purple-50' },
    '金融资本': { icon: Wallet, color: 'text-emerald-500', bg: 'bg-emerald-50' },
    '行业聚焦': { icon: Sparkles, color: 'text-blue-500', bg: 'bg-blue-50' },
    '地域资讯': { icon: Globe, color: 'text-orange-500', bg: 'bg-orange-50' },
    '热点人物': { icon: User, color: 'text-rose-500', bg: 'bg-rose-50' }
};
const DEFAULT_UI_CONFIG = { icon: Tag, color: 'text-slate-500', bg: 'bg-slate-50' };

// 辅助函数：在逗号/顿号分隔的字符串中切换关键词
const toggleKeyword = (currentString: string, keyword: string) => {
    if (!keyword) return currentString;
    const items = currentString.split(/[、,，]+/).map(item => item.trim()).filter(item => item !== '');
    const target = keyword.trim();
    const index = items.indexOf(target);

    if (index > -1) {
        items.splice(index, 1);
    } else {
        items.push(target);
    }

    return items.join('、');
};

// 辅助函数：格式化日期时间
const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '-';
    // 既然后端已经通过 SQL 转换好了北京时间，前端只需要简单美化字符串即可
    return dateStr.replace('T', ' ').slice(0, 19).replace(/\//g, '-');
};

const isKeywordSelected = (currentString: string, keyword: string) => {
    if (!keyword) return false;
    const items = currentString.split(/[、,，]+/).map(i => i.trim());
    return items.includes(keyword.trim());
};

export const DailyNewsModule: React.FC = () => {
    const [isReady, setIsReady] = useState(false);
    useEffect(() => {
        requestAnimationFrame(() => {
            setTimeout(() => setIsReady(true), 50);
        });
    }, []);

    const [data, setData] = useState<NewsData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdate, setLastUpdate] = useState<string | null>(null);
    const [industry, setIndustry] = useState('AI、人工智能、大模型');

    // --- 历史记录状态 ---
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [viewingHistoryId, setViewingHistoryId] = useState<number | null>(null);
    const [historyLoading, setHistoryLoading] = useState(false);

    // --- 动态词库加载与管理 ---
    const { data: apiKeywordsData } = useNewsKeywords();
    const [allKeywords, setAllKeywords] = useState<any[]>([]);
    const [addingToGroup, setAddingToGroup] = useState<string | null>(null);
    const [newKeywordInput, setNewKeywordInput] = useState('');
    const currentUser = localStorage.getItem('blue_os_username') || 'web_user';

    const [isUpdating, setIsUpdating] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState<{ id: number, keyword: string } | null>(null);

    // 当原始数据加载完成时同步到本地状态
    useEffect(() => {
        // 只有当服务器数据源 apiKeywordsData 变化，且当前没有进行手动操作时才同步
        if (apiKeywordsData && !isUpdating) {
            setAllKeywords(apiKeywordsData);
        }
    }, [apiKeywordsData]); // 移除 isUpdating 依赖，防止锁释放时误触发旧数据回滚

    // 计算分组结构
    const groupedKeywords = allKeywords.reduce<Record<string, { id: number, keyword: string, creator?: string }[]>>((acc, row) => {
        const group = (row.group_name || '').trim();
        if (!group || !row.keyword) return acc;

        if (!acc[group]) acc[group] = [];

        // 兼容处理数组格式和字符串格式
        let splitWords: string[] = [];
        if (Array.isArray(row.keyword)) {
            splitWords = row.keyword;
        } else {
            const keywordStr = String(row.keyword || '');
            splitWords = keywordStr.split(/[\/、,，\s]+/).map(k => k.trim()).filter(k => k !== '');
        }

        for (const word of splitWords) {
            // 在当前分组内去重，避免系统词和自定义词重复显示
            if (!acc[group].some(item => item.keyword === word)) {
                acc[group].push({ id: row.id, keyword: word, creator: row.creator });
            }
        }
        return acc;
    }, {});

    // 定义分类的显示优先级
    const GROUP_PRIORITY = ['科技前沿', '金融资本', '行业聚焦', '地域资讯', '热点人物'];

    const API_KEYWORD_GROUPS = Object.entries(groupedKeywords)
        .sort(([a], [b]) => {
            const idxA = GROUP_PRIORITY.indexOf(a);
            const idxB = GROUP_PRIORITY.indexOf(b);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        })
        .map(([groupName, keywords]) => {
            const uiConfig = KEYWORD_UI_CONFIG[groupName] || DEFAULT_UI_CONFIG;
            return {
                label: groupName,
                icon: uiConfig.icon,
                color: uiConfig.color,
                bg: uiConfig.bg,
                keywords: keywords
            };
        });

    // 辅助函数：添加关键词
    const handleAddKeyword = async (groupName: string) => {
        if (!newKeywordInput.trim()) return;
        setIsUpdating(true);
        try {
            const res = await fetchWithAuth(`${API_NEWS_BASE}/keywords`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ group_name: groupName, keyword: newKeywordInput.trim() })
            });
            const result = await res.json();
            if (result.success) {
                console.log('[Keywords] Add success, row data:', result.data);
                setAllKeywords(prev => {
                    const next = [...prev];
                    const idx = next.findIndex(k => String(k.id) === String(result.data.id));
                    if (idx > -1) {
                        next[idx] = result.data;
                    } else {
                        next.push(result.data);
                    }
                    console.log('[Keywords] New total rows:', next.length);
                    return next;
                });
                setNewKeywordInput('');
                setAddingToGroup(null);
            } else {
                alert('添加失败: ' + (result.message || '服务器错误'));
            }
        } catch (e: any) {
            console.error('添加关键词失败', e);
        } finally {
            setTimeout(() => setIsUpdating(false), 500);
        }
    };

    // 辅助函数：删除关键词
    const handleDeleteKeyword = async (keywordId: number, word: string) => {
        setIsUpdating(true); // 开启更新锁
        try {
            const res = await fetchWithAuth(`${API_NEWS_BASE}/keywords/${keywordId}?keyword=${encodeURIComponent(word)}`, {
                method: 'DELETE'
            });
            const result = await res.json();
            if (result.success) {
                console.log('[Keywords] Delete success, keyword:', word);
                // 本地同步更新状态
                setAllKeywords(prev => {
                    const next = prev.map(row => {
                        if (String(row.id) === String(keywordId)) {
                            const list = Array.isArray(row.keyword) ? row.keyword : [row.keyword];
                            const newList = list.filter((k: string) => k !== word);
                            return { ...row, keyword: newList };
                        }
                        return row;
                    }).filter(row => {
                        const list = Array.isArray(row.keyword) ? row.keyword : (row.keyword ? [row.keyword] : []);
                        return list.length > 0;
                    });
                    return [...next];
                });
            }
        } catch (e: any) {
            console.error('删除关键词失败', e);
        } finally {
            setConfirmDelete(null); // 关闭确认弹窗
            setTimeout(() => setIsUpdating(false), 500);
        }
    };

    // 解析组件状态
    const [analyzeQuery, setAnalyzeQuery] = useState('详细说说第三条新闻会带来什么影响');
    const [analyzeLoading, setAnalyzeLoading] = useState(false);
    const [analyzeResult, setAnalyzeResult] = useState('');

    // === 设置面板状态 ===
    const settingsRef = useRef<HTMLDivElement>(null);
    const [showSettings, setShowSettings] = useState(false);
    const [newsCountLimit, setNewsCountLimit] = useState(12);
    const [defaultIndustry, setDefaultIndustry] = useState('AI、人工智能、大模型');
    const [pushTime, setPushTime] = useState('08:30');

    // === 下拉选择状态 ===
    const selectorRef = useRef<HTMLDivElement>(null);
    const [showSelector, setShowSelector] = useState(false);
    const settingsSelectorRef = useRef<HTMLDivElement>(null);
    const [showSettingsSelector, setShowSettingsSelector] = useState(false);

    // 点击外部收回逻辑
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (showSettings && settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
                setShowSettings(false);
                setShowSettingsSelector(false);
            }
            if (showSelector && selectorRef.current && !selectorRef.current.contains(event.target as Node)) {
                setShowSelector(false);
            }
            if (showSettingsSelector && settingsSelectorRef.current && !settingsSelectorRef.current.contains(event.target as Node)) {
                setShowSettingsSelector(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showSettings, showSelector, showSettingsSelector]);

    // 初始化数据
    useEffect(() => {
        const initialize = async () => {
            try {
                const res = await fetchWithAuth('/api/news/preferences');
                if (res.ok) {
                    const prefs = await res.json();
                    if (prefs.defaultIndustry) {
                        setDefaultIndustry(prefs.defaultIndustry);
                        setIndustry(prefs.defaultIndustry);
                    }
                    if (prefs.countLimit) setNewsCountLimit(prefs.countLimit);
                    if (prefs.pushTime) setPushTime(prefs.pushTime);
                }
            } catch (e) { console.error('获取新闻偏好失败', e); }

            fetchNews();
            getStatus();
            fetchHistory();
        };

        initialize();
    }, []);

    const fetchHistory = async () => {
        setHistoryLoading(true);
        try {
            const res = await fetchWithAuth(`${API_NEWS_BASE}/history`);
            if (res.ok) {
                const result = await res.json();
                setHistory(result.data || []);
            }
        } catch (e) { console.error('获取历史记录失败', e); }
        finally { setHistoryLoading(false); }
    };

    const loadHistoryItem = async (id: number) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`${API_NEWS_BASE}/history/${id}`);
            if (res.ok) {
                const result = await res.json();
                const historyData = result.data.content;
                if (historyData.report_date && !historyData.date) historyData.date = historyData.report_date;
                setData(historyData);
                setViewingHistoryId(id);
                // 滚动至顶
                const scrollContainer = document.querySelector('.news-main-content');
                if (scrollContainer) scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
            }
        } catch (e: any) { setError('获取历史详情失败: ' + e.message); }
        finally { setLoading(false); }
    };

    const deleteHistoryItem = async (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        if (!window.confirm('确定要删除这条历史记录吗？')) return;
        try {
            const res = await fetchWithAuth(`${API_NEWS_BASE}/history/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setHistory(prev => prev.filter(h => h.id !== id));
                if (viewingHistoryId === id) {
                    setViewingHistoryId(null);
                    fetchNews();
                }
            }
        } catch (e) { console.error('删除失败', e); }
    };

    const clearHistory = async () => {
        if (!window.confirm('确定要清空所有历史记录吗？')) return;
        try {
            const res = await fetchWithAuth(`${API_NEWS_BASE}/history`, { method: 'DELETE' });
            if (res.ok) {
                setHistory([]);
                setViewingHistoryId(null);
                fetchNews();
            }
        } catch (e) { console.error('清空失败', e); }
    };

    const backToToday = () => {
        setViewingHistoryId(null);
        fetchNews();
    };

    const savePreferences = async (newDefault: string, newLimit: number, newTime: string) => {
        const prefs = {
            defaultIndustry: newDefault,
            countLimit: newLimit,
            pushTime: newTime
        };
        try {
            await fetchWithAuth('/api/news/preferences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(prefs)
            });
            setDefaultIndustry(newDefault);
            setNewsCountLimit(newLimit);
            setPushTime(newTime);
        } catch (e) { console.error('保存新闻偏好失败', e); }
    };

    const fetchNews = async () => {
        try {
            const res = await fetch('/daily_news.json');
            if (!res.ok) {
                if (res.status === 404) {
                    setError('今日新闻尚未生成。您可点击右上角手动更新。');
                    return;
                }
                throw new Error('获取新闻数据失败');
            }
            const json = await res.json();
            if (json.report_date && !json.date) json.date = json.report_date;
            setData(json);
            setError(null);
        } catch (e: any) { setError(e.message); }
    };

    const getStatus = async () => {
        try {
            const res = await fetchWithAuth(`${API_NEWS_BASE}/latest`);
            if (res.ok) {
                const statusData = await res.json();
                setLastUpdate(statusData.lastUpdate);
            }
        } catch (e) { console.error('获取状态失败', e); }
    };

    const handleManualUpdate = async () => {
        if (loading) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetchWithAuth(`${API_NEWS_BASE}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ industry })
            });
            const result = await res.json();
            if (result.success) {
                const newData = result.data;
                if (newData.report_date && !newData.date) newData.date = newData.report_date;
                setData(newData);
                getStatus();
                fetchHistory();
            } else { throw new Error(result.message || '更新失败'); }
        } catch (e: any) { setError(e.message); }
        finally { setLoading(false); }
    };

    const handleAnalyze = async () => {
        if (!analyzeQuery.trim() || !data) return;
        setAnalyzeLoading(true);
        setAnalyzeResult('');
        try {
            const res = await fetchWithAuth(`${API_NEWS_BASE}/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: analyzeQuery,
                    newsContext: Object.values(data.categories).flatMap(cat => cat.news_list)
                })
            });
            const result = await res.json();
            if (result.success) { setAnalyzeResult(result.data); }
            else { throw new Error(result.message || '解析失败'); }
        } catch (e: any) { setAnalyzeResult(`[请求遇到错误] ${e.message}`); }
        finally { setAnalyzeLoading(false); }
    };

    if (!isReady) return null;

    // 计算全局新闻序号
    let globalNewsIndex = 0;

    return (
        <div className="flex flex-col h-full bg-slate-50/50 rounded-xl overflow-hidden font-sans border border-slate-200 shadow-inner">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between px-6 py-4 bg-white/80 backdrop-blur border-b border-slate-200 shrink-0 gap-4 relative z-40">
                <div className="flex items-center gap-4">
                    <div className="p-2.5 bg-gradient-to-tr from-red-500 to-orange-500 rounded-xl shadow-sm text-white shrink-0">
                        <Newspaper className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-3">
                            每日推送
                            {(data?.date || data?.report_date) && (
                                <span className="text-sm font-normal px-3 py-1 bg-slate-100 text-slate-500 border border-slate-200 rounded-full">
                                    {data.date || data.report_date}
                                    {viewingHistoryId && ' (历史点播)'}
                                </span>
                            )}
                            {lastUpdate && !viewingHistoryId && (
                                <span className="text-sm font-normal text-slate-400 bg-transparent hidden md:inline-block border-none mt-1">
                                    更新于: {new Date(lastUpdate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            )}
                        </h2>
                        <p className="text-sm text-slate-500 mt-1">为您获取72小时内全球最新鲜的行业与市场动态</p>
                    </div>
                </div>
                <div className="flex items-center gap-3 w-full sm:w-auto">
                    <div className="relative flex-1 sm:w-80 group" ref={selectorRef}>
                        <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-blue-500/50 transition-all shadow-sm overflow-hidden">
                            <button
                                onClick={() => setShowSelector(!showSelector)}
                                className={`pl-4 pr-2 py-2 flex items-center gap-2 border-r border-slate-200 transition-colors ${showSelector ? 'bg-blue-50 text-blue-600' : 'hover:bg-slate-100 text-slate-500'}`}
                            >
                                <Tag className="w-4 h-4" />
                                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${showSelector ? 'rotate-180' : ''}`} />
                            </button>
                            <input
                                type="text"
                                value={industry}
                                onChange={(e) => setIndustry(e.target.value)}
                                placeholder="输入关键词查询..."
                                className="flex-1 px-4 py-2 text-base bg-transparent border-none focus:outline-none font-bold text-slate-700 placeholder:text-slate-300"
                            />
                        </div>

                        {showSelector && (
                            <div className="absolute left-0 top-full mt-2 w-full min-w-[320px] max-h-[480px] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-200 z-[100] p-5 animate-in fade-in slide-in-from-top-2 duration-300 custom-scrollbar">
                                <div className="space-y-6">
                                    {API_KEYWORD_GROUPS.map((group) => (
                                        <div key={group.label} className="space-y-3">
                                            <div className="flex items-center gap-2 px-1">
                                                <group.icon className={`w-4 h-4 ${group.color}`} />
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{group.label}</span>
                                            </div>
                                            <div className="flex flex-wrap gap-2 items-center">
                                                {group.keywords.map(kwObj => (
                                                    <div key={`${kwObj.id}-${kwObj.keyword}`} className="relative group/tag">
                                                        <button
                                                            onClick={() => setIndustry(toggleKeyword(industry, kwObj.keyword))}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5 ${isKeywordSelected(industry, kwObj.keyword) ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-slate-50 border-slate-100 text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600'}`}
                                                        >
                                                            {kwObj.keyword}
                                                            {(kwObj.creator === currentUser || (kwObj.creator && currentUser === 'admin')) && (
                                                                <span
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setConfirmDelete({ id: kwObj.id, keyword: kwObj.keyword });
                                                                    }}
                                                                    className="absolute -top-1.5 -right-1.5 bg-slate-200 text-slate-500 rounded-full p-0.5 shadow-sm opacity-100 transition-all hover:bg-slate-300 hover:text-slate-700 hover:scale-110 active:scale-95 z-20"
                                                                    title="删除自定义关键词"
                                                                >
                                                                    <X className="w-2 h-2" />
                                                                </span>
                                                            )}
                                                        </button>
                                                    </div>
                                                ))}

                                                {addingToGroup === group.label ? (
                                                    <div className="flex items-center gap-1 bg-white border border-blue-200 rounded-lg p-1 animate-in zoom-in-95 duration-200">
                                                        <input
                                                            autoFocus
                                                            type="text"
                                                            value={newKeywordInput}
                                                            onChange={e => setNewKeywordInput(e.target.value)}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') handleAddKeyword(group.label);
                                                                if (e.key === 'Escape') setAddingToGroup(null);
                                                            }}
                                                            className="w-20 px-2 py-0.5 text-xs outline-none bg-transparent font-bold text-slate-700"
                                                        />
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleAddKeyword(group.label); }}
                                                            className="p-0.5 text-blue-600 hover:bg-blue-50 rounded"
                                                        >
                                                            <Check className="w-3 h-3" />
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setAddingToGroup(null); }}
                                                            className="p-0.5 text-slate-400 hover:bg-slate-50 rounded"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => setAddingToGroup(group.label)}
                                                        className="w-7 h-7 flex items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 hover:border-blue-500 hover:text-blue-500 hover:bg-blue-50 transition-all"
                                                        title="添加标签"
                                                    >
                                                        <Plus className="w-4 h-4" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="relative select-none z-30" ref={settingsRef}>
                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className={`p-2.5 rounded-lg border transition-all ${showSettings ? 'bg-blue-50 border-blue-200 text-blue-600 shadow-inner' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'}`}
                        >
                            <Settings className={`w-5 h-5 ${showSettings ? 'animate-spin-slow' : ''}`} />
                        </button>
                        {showSettings && (
                            <div className="absolute right-0 mt-2 w-80 md:w-[400px] bg-white rounded-2xl shadow-2xl border border-slate-200 z-[100] p-6 animate-in fade-in zoom-in-95 duration-200">
                                <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
                                    <h4 className="font-bold text-slate-800 flex items-center gap-2"><Settings className="w-4 h-4 text-blue-500" />推送设置</h4>
                                    <button onClick={() => setShowSettings(false)} className="text-slate-400"><Check className="w-4 h-4" /></button>
                                </div>
                                <div className="space-y-5">
                                    <div>
                                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">默认推送关键词</label>
                                        <div className="relative" ref={settingsSelectorRef}>
                                            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500/30 transition-all">
                                                <button
                                                    onClick={() => setShowSettingsSelector(!showSettingsSelector)}
                                                    className={`px-3 py-2 border-r border-slate-200 transition-colors ${showSettingsSelector ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-100'}`}
                                                >
                                                    <Tag className="w-4 h-4" />
                                                </button>
                                                <input
                                                    type="text" value={defaultIndustry}
                                                    onChange={(e) => { setDefaultIndustry(e.target.value); savePreferences(e.target.value, newsCountLimit, pushTime); }}
                                                    className="w-full px-3 py-2 bg-transparent focus:outline-none font-bold text-slate-700"
                                                />
                                            </div>

                                            {showSettingsSelector && (
                                                <div className="absolute left-0 top-full mt-2 w-full min-w-[300px] bg-white rounded-xl shadow-2xl border border-slate-200 z-[110] p-4 animate-in fade-in slide-in-from-top-1 duration-200 max-h-[300px] overflow-y-auto custom-scrollbar">
                                                    <div className="space-y-4">
                                                        {API_KEYWORD_GROUPS.map((group) => (
                                                            <div key={group.label} className="space-y-2">
                                                                <div className="flex items-center gap-2 px-1">
                                                                    <group.icon className={`w-3.5 h-3.5 ${group.color}`} />
                                                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{group.label}</span>
                                                                </div>
                                                                <div className="flex flex-wrap gap-1.5 items-center">
                                                                    {group.keywords.map(kwObj => (
                                                                        <div key={`${kwObj.id}-${kwObj.keyword}`} className="relative group/tag">
                                                                            <button
                                                                                key={kwObj.id}
                                                                                onClick={() => {
                                                                                    const newValue = toggleKeyword(defaultIndustry, kwObj.keyword);
                                                                                    setDefaultIndustry(newValue);
                                                                                    savePreferences(newValue, newsCountLimit, pushTime);
                                                                                }}
                                                                                className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all border flex items-center gap-1 ${isKeywordSelected(defaultIndustry, kwObj.keyword) ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-slate-50 border-slate-100 text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600'}`}
                                                                            >
                                                                                {kwObj.keyword}
                                                                                {(kwObj.creator === currentUser || (kwObj.creator && currentUser === 'admin')) && (
                                                                                    <span
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            setConfirmDelete({ id: kwObj.id, keyword: kwObj.keyword });
                                                                                        }}
                                                                                        className="absolute -top-1.5 -right-1.5 bg-slate-200 text-slate-500 rounded-full p-0.5 shadow-sm opacity-100 transition-all hover:bg-slate-300 hover:text-slate-700 hover:scale-110 active:scale-95 z-20"
                                                                                        title="删除自定义关键词"
                                                                                    >
                                                                                        <X className="w-2 h-2" />
                                                                                    </span>
                                                                                )}
                                                                            </button>
                                                                        </div>
                                                                    ))}

                                                                    {addingToGroup === group.label ? (
                                                                        <div className="flex items-center gap-1 bg-white border border-blue-200 rounded-lg p-0.5 animate-in zoom-in-95 duration-200">
                                                                            <input
                                                                                autoFocus
                                                                                type="text"
                                                                                value={newKeywordInput}
                                                                                onChange={e => setNewKeywordInput(e.target.value)}
                                                                                onKeyDown={e => {
                                                                                    if (e.key === 'Enter') handleAddKeyword(group.label);
                                                                                    if (e.key === 'Escape') setAddingToGroup(null);
                                                                                }}
                                                                                className="w-16 px-1.5 py-0.5 text-[10px] outline-none bg-transparent font-bold text-slate-700"
                                                                            />
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); handleAddKeyword(group.label); }}
                                                                                className="p-0.5 text-blue-600 hover:bg-blue-50 rounded"
                                                                            >
                                                                                <Check className="w-2.5 h-2.5" />
                                                                            </button>
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); setAddingToGroup(null); }}
                                                                                className="p-0.5 text-slate-400 hover:bg-slate-50 rounded"
                                                                            >
                                                                                <X className="w-2.5 h-2.5" />
                                                                            </button>
                                                                        </div>
                                                                    ) : (
                                                                        <button
                                                                            onClick={() => setAddingToGroup(group.label)}
                                                                            className="w-6 h-6 flex items-center justify-center rounded-md border border-dashed border-slate-300 text-slate-400 hover:border-blue-500 hover:text-blue-500 hover:bg-blue-50 transition-all"
                                                                        >
                                                                            <Plus className="w-3 h-3" />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">每日推送时间</label>
                                        <input
                                            type="time" value={pushTime}
                                            onChange={(e) => { setPushTime(e.target.value); savePreferences(defaultIndustry, newsCountLimit, e.target.value); }}
                                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-slate-700"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        {viewingHistoryId && (
                            <button
                                onClick={backToToday}
                                className="px-4 py-2.5 bg-blue-50 text-blue-600 font-bold text-sm rounded-xl border border-blue-200 hover:bg-blue-100 transition-all flex items-center gap-2"
                            >
                                <RefreshCw className="w-4 h-4" /> 今日
                            </button>
                        )}
                        <button
                            onClick={handleManualUpdate}
                            disabled={loading || !industry.trim()}
                            className={`flex items-center justify-center shrink-0 min-w-[100px] px-6 py-2.5 rounded-xl text-base font-bold transition-all shadow-lg ${loading || !industry.trim() ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-500/20'} `}
                        >
                            {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : '即时查询'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Layout Body */}
            <div className="flex-1 overflow-hidden flex flex-col lg:flex-row relative">
                {/* News Area */}
                <div className="flex-1 flex flex-col min-w-0 bg-slate-50/50 border-r border-slate-200/50">
                    <div className="flex-1 overflow-y-auto custom-scrollbar news-main-content">
                        <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-12 pb-32">
                            {error && <div className="p-4 bg-orange-50 border border-orange-200 text-orange-700 rounded-xl text-center shadow-sm">{error}</div>}

                            {loading && !data && (
                                <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-400">
                                    <RefreshCw className="w-8 h-8 animate-spin opacity-30" />
                                    <p className="text-sm font-bold tracking-widest uppercase">AI Data Fetching...</p>
                                </div>
                            )}

                            {data?.categories && Object.entries(data.categories).map(([key, category], catIdx) => (
                                <div key={key} className="space-y-6">
                                    <div className="flex items-center gap-4 relative">
                                        <div className="h-px flex-1 bg-slate-200" />
                                        <div className="flex items-center gap-3 px-6 py-2 bg-white border border-slate-200 rounded-full shadow-sm shrink-0">
                                            <span className="w-6 h-6 flex items-center justify-center bg-slate-800 text-white text-[10px] font-black rounded-lg">{catIdx + 1}</span>
                                            <h3 className="text-xl font-bold text-slate-800 tracking-widest uppercase">{category.name}</h3>
                                        </div>
                                        <div className="h-px flex-1 bg-slate-200" />
                                    </div>

                                    <div className="bg-white rounded-3xl border border-slate-200/60 shadow-sm divide-y divide-slate-100 overflow-hidden">
                                        {category.news_list.length > 0 ? category.news_list.map((news) => {
                                            const currentIndex = ++globalNewsIndex;
                                            return (
                                                <div key={currentIndex} className="flex items-start gap-5 px-6 py-5 hover:bg-slate-50/80 transition-colors group">
                                                    <div className="w-10 h-10 shrink-0 flex items-center justify-center bg-slate-50 rounded-xl text-slate-400 font-bold text-sm group-hover:bg-blue-600 group-hover:text-white transition-all shadow-sm">
                                                        {currentIndex.toString().padStart(2, '0')}
                                                    </div>
                                                    <div className="flex-1 flex flex-col gap-3">
                                                        <h4 className="font-bold text-xl text-slate-800 leading-relaxed group-hover:text-blue-600 transition-colors">
                                                            {news.url ? <a href={news.url} target="_blank" rel="noreferrer" className="hover:underline underline-offset-4">{news.title}</a> : news.title}
                                                        </h4>
                                                        <div className="flex items-center gap-5 text-xs font-bold text-slate-400 group-hover:text-slate-500">
                                                            <span className="bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200 text-slate-500">{news.source || '综合'}</span>
                                                            <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />{news.time}</span>
                                                            {news.url && (
                                                                <a href={news.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-500/60 hover:text-blue-500 transition-all font-black uppercase tracking-tighter ml-auto">
                                                                    Read Source <ExternalLink className="w-3.5 h-3.5" />
                                                                </a>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        }) : (
                                            <div className="py-12 text-center text-slate-300 italic font-medium">暂无此分类下的动态</div>
                                        )}
                                    </div>
                                </div>
                            ))}

                            {/* Analysis Results DisplayArea (Inside Scroll) */}
                            {analyzeResult && (
                                <div className="mt-20 space-y-6 animate-in fade-in slide-in-from-bottom-5 duration-500">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2.5 bg-indigo-500 rounded-xl shadow-lg shadow-indigo-500/20 text-white"><MessageSquare className="w-5 h-5" /></div>
                                        <h3 className="text-2xl font-bold text-slate-800 tracking-tight">深度解析报告</h3>
                                    </div>
                                    <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-xl shadow-slate-200/40 p-10 md:p-14 prose prose-indigo prose-lg max-w-none text-slate-700 line-height-relaxed font-normal">
                                        <ReactMarkdown>{analyzeResult}</ReactMarkdown>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Chat-style Input Box (Fixed at Bottom) */}
                    <div className="shrink-0 bg-white border-t border-slate-200 px-6 py-6 shadow-[0_-10px_30px_-15px_rgba(0,0,0,0.05)] z-10">
                        <div className="max-w-6xl mx-auto flex flex-col gap-4">
                            <div className="flex items-center gap-3 px-1 text-slate-500">
                                <Sparkles className="w-4 h-4 text-indigo-500" />
                                <span className="text-xs font-black uppercase tracking-widest">深度解析</span>
                                {analyzeLoading && <span className="ml-auto text-[10px] text-indigo-500 animate-pulse font-bold flex items-center gap-1.5"><RefreshCw className="w-3 h-3 animate-spin" /> 解析中...</span>}
                            </div>
                            <div className="flex items-center gap-4 bg-slate-50 p-1.5 rounded-2xl border border-slate-200 focus-within:ring-4 focus-within:ring-indigo-500/10 focus-within:border-indigo-500 transition-all shadow-inner">
                                <input
                                    type="text"
                                    value={analyzeQuery}
                                    onChange={e => setAnalyzeQuery(e.target.value)}
                                    placeholder="针对以上资讯，输入您的解析诉求，例如“详细说说第三条新闻的影响”..."
                                    className="flex-1 px-5 py-3.5 bg-transparent border-none outline-none font-bold text-slate-700 text-lg placeholder:text-slate-300"
                                    onKeyDown={e => e.key === 'Enter' && !analyzeLoading && handleAnalyze()}
                                />
                                <button
                                    disabled={analyzeLoading || !analyzeQuery.trim()}
                                    onClick={handleAnalyze}
                                    className={`px-6 py-3.5 rounded-xl font-black flex items-center gap-2 transition-all shadow-lg ${analyzeLoading || !analyzeQuery.trim()
                                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                        : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-500/40 active:scale-95'
                                        }`}
                                >
                                    {analyzeLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <><Send className="w-5 h-5" /> 解析</>}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Sidebar History */}
                <aside className="hidden 2xl:flex w-[340px] shrink-0 bg-white border-l border-slate-200 flex-col shadow-[-10px_0_20px_-10px_rgba(0,0,0,0.02)]">
                    <div className="p-6 flex items-center justify-between border-b border-slate-100">
                        <h3 className="font-black text-slate-800 flex items-center gap-2 tracking-tight">
                            <History className="w-4 h-4 text-slate-400" /> 历史推送日志
                        </h3>
                        {history.length > 0 && <button onClick={clearHistory} className="text-[10px] font-black text-slate-300 hover:text-red-500 uppercase tracking-widest transition-colors">Clear</button>}
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                        {historyLoading ? (
                            <div className="py-20 flex flex-col items-center gap-3 text-slate-300">
                                <RefreshCw className="w-6 h-6 animate-spin opacity-30" />
                                <span className="text-[10px] font-black uppercase tracking-widest">History Loading</span>
                            </div>
                        ) : history.length === 0 ? (
                            <div className="py-20 text-center text-slate-300">
                                <Clock className="w-8 h-8 opacity-10 mx-auto mb-3" />
                                <p className="text-xs font-bold uppercase tracking-widest">No Records Yet</p>
                            </div>
                        ) : history.map(item => (
                            <div
                                key={item.id} onClick={() => loadHistoryItem(item.id)}
                                className={`group relative p-4.5 rounded-2xl border transition-all cursor-pointer ${viewingHistoryId === item.id ? 'bg-blue-50/50 border-blue-500 shadow-lg shadow-blue-500/5' : 'bg-white border-slate-100 hover:border-blue-300 hover:shadow-md hover:-translate-y-0.5'}`}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-widest ${viewingHistoryId === item.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}`}>Log #{item.id}</span>
                                    <button onClick={e => deleteHistoryItem(e, item.id)} className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                                </div>
                                <h4 className="text-sm font-bold text-slate-800 mb-1.5 line-clamp-1 group-hover:text-blue-600">{item.industry || '综合行业抓取'}</h4>
                                <div className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5"><Clock className="w-3 h-3" />{formatDateTime(item.created_at)}</div>
                                {viewingHistoryId === item.id && <div className="mt-2.5 pt-2.5 border-t border-blue-100 text-[10px] font-black text-blue-600 flex items-center gap-1 uppercase tracking-widest">Selected Log <Check className="w-3 h-3" /></div>}
                            </div>
                        ))}
                    </div>
                </aside>
            </div>
            {/* 删除确认弹窗 */}
            {confirmDelete && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300">
                    <div
                        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="p-6 space-y-4">
                            <div className="flex items-center justify-center w-12 h-12 mx-auto bg-rose-50 rounded-full">
                                <Trash2 className="w-6 h-6 text-rose-500" />
                            </div>
                            <div className="text-center space-y-2">
                                <h3 className="text-lg font-bold text-slate-800">确认删除关键词？</h3>
                                <p className="text-sm text-slate-500">
                                    您确定要移除 <span className="font-bold text-slate-700">"{confirmDelete.keyword}"</span> 吗？此操作不可撤销。
                                </p>
                            </div>
                        </div>
                        <div className="flex border-t border-slate-100">
                            <button
                                onClick={() => setConfirmDelete(null)}
                                className="flex-1 px-4 py-4 text-sm font-bold text-slate-500 hover:bg-slate-50 transition-colors border-r border-slate-100"
                            >
                                取消
                            </button>
                            <button
                                onClick={() => handleDeleteKeyword(confirmDelete.id, confirmDelete.keyword)}
                                className="flex-1 px-4 py-4 text-sm font-bold text-rose-500 hover:bg-rose-50 transition-colors"
                            >
                                确认删除
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
