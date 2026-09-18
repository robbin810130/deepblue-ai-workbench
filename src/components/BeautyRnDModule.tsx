import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { fetchWithAuth } from '../utils/authFetch';
import {
    Beaker, Database, ShieldAlert,
    RefreshCcw, CheckCircle2, XCircle, ChevronDown, History, Info, Play, Square, Settings2, TestTube2, Fingerprint, Coins, ShieldCheck, Globe, Trash2,
    AlertTriangle, FileText, Layers, Users, Ban, Server, Save
} from 'lucide-react';
import { useConfig } from '../hooks/useConfig';
import { sysConfirm } from '../utils/dialog';

// === Mock Types & Interfaces ===
interface FormulaIngredient {
    phase: string;
    inci: string;
    percentage: number;
    function: string;
    warning?: string;
}

interface FormulaVersion {
    versionId: string;
    versionName: string;
    timestamp: string;
    ingredients: FormulaIngredient[];
}

interface HistoryItem {
    id: string;
    date: string;
    market: string;
    productType: string;
    painPoints?: string;
    certifications?: string[];
    costLimit?: number | '';
    reportContent?: string;
    conversation_id?: string;
    mockVersions?: FormulaVersion[];
}

export const BeautyRnDModule: React.FC = () => {
    const [isReady, setIsReady] = useState(false);
    useEffect(() => {
        requestAnimationFrame(() => {
            setTimeout(() => setIsReady(true), 50);
        });
    }, []);

    // --- Configurations Loader ---
    const { data: configMarkets } = useConfig<{ name: string }>('markets', 'beauty_rnd');
    const { data: configCertifications } = useConfig<{ name: string, region: string }>('certifications');
    const { data: configPainPoints } = useConfig<{ name: string }>('pain_points');

    const MARKETS = configMarkets.map(m => m.name);
    const PAIN_POINT_TAGS = configPainPoints.map(p => p.name);
    const CERT_OPTIONS = configCertifications.map(c => c.name);

    const PRODUCT_FORMS = ['水剂 (Toner)', '乳液 (Lotion)', '膏霜 (Cream)', '凝胶 (Gel)', '精华 (Serum)', '油剂 (Oil)', '粉体 (Powder)'];
    const SKIN_TYPES = ['干性/极干性', '油性/混油性', '中性肌肤', '敏感肌/受损肌', '熟龄肌 (抗老)', '婴童 (温和)'];
    const BLACKLIST_TAGS = ['无硅油', '无酒精', '无防腐体系', '无香精', '无动物衍生物(Vegan)', '孕妇慎用成分排除', '无硫酸盐(Sulfate-free)'];

    // --- Input States ---
    const [dataSource, setDataSource] = useState<'public' | 'private'>('public');
    const [productType, setProductType] = useState('');
    const [productForm, setProductForm] = useState('');
    const [skinType, setSkinType] = useState('');
    const [targetMarket, setTargetMarket] = useState('');
    const [painPoints, setPainPoints] = useState<string>('');
    const [blacklist, setBlacklist] = useState<string[]>([]);
    const [certifications, setCertifications] = useState<string[]>([]);
    const [costLimit, setCostLimit] = useState<number | ''>('');

    // --- UI States ---
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [reportReady, setReportReady] = useState(false);
    const [reportContent, setReportContent] = useState('');
    const [currentReportId, setCurrentReportId] = useState('');
    // Removed unused currentReportDate
    const [history, setHistory] = useState<HistoryItem[]>([]);

    const [marketOpen, setMarketOpen] = useState(false);
    const [formOpen, setFormOpen] = useState(false);
    const [skinOpen, setSkinOpen] = useState(false);
    
    const marketRef = useRef<HTMLDivElement>(null);
    const formRef = useRef<HTMLDivElement>(null);
    const skinRef = useRef<HTMLDivElement>(null);

    // --- Workspace States ---
    const [activeTab, setActiveTab] = useState<'formula' | 'report' | 'compliance'>('formula');
    const [versions, setVersions] = useState<FormulaVersion[]>([]);
    const [activeVersionId, setActiveVersionId] = useState<string>('');
    
    const [editableIngredients, setEditableIngredients] = useState<FormulaIngredient[]>([]);
    const [isEdited, setIsEdited] = useState(false);

    useEffect(() => {
        const activeVer = versions.find(v => v.versionId === activeVersionId);
        if (activeVer) {
            setEditableIngredients(JSON.parse(JSON.stringify(activeVer.ingredients)));
            setIsEdited(false);
        }
    }, [activeVersionId, versions]);

    const loadHistory = async () => {
        try {
            const res = await fetchWithAuth('/api/beauty-rnd/conversations', { method: 'GET' });
            const result = await res.json();
            if (result.data && Array.isArray(result.data)) {
                const loaded: HistoryItem[] = result.data.map((c: any) => ({
                    id: `RND-${c.id.substring(0, 6).toUpperCase()}`,
                    conversation_id: c.id,
                    date: new Date(c.created_at * 1000).toLocaleString(),
                    market: c.inputs?.target_market || '未知',
                    productType: c.inputs?.product_type || c.name || '未知品类',
                    painPoints: c.inputs?.pain_point || '',
                    certifications: c.inputs?.cert_require ? c.inputs.cert_require.split(', ') : [],
                    costLimit: c.inputs?.cost_limit || ''
                }));
                setHistory(loaded);
            }
        } catch (e) {
            console.error('Failed to load history', e);
        }
    };

    useEffect(() => {
        loadHistory();
        const handleClickOutside = (event: MouseEvent) => {
            if (marketRef.current && !marketRef.current.contains(event.target as Node)) setMarketOpen(false);
            if (formRef.current && !formRef.current.contains(event.target as Node)) setFormOpen(false);
            if (skinRef.current && !skinRef.current.contains(event.target as Node)) setSkinOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleCert = (cert: string) => {
        if (cert === '无认证') setCertifications(['无认证']);
        else setCertifications(prev => {
            const pure = prev.filter(c => c !== '无认证');
            return pure.includes(cert) ? pure.filter(c => c !== cert) : [...pure, cert];
        });
    };

    const toggleBlacklist = (tag: string) => {
        setBlacklist(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
    };

    const handleTagClick = (tag: string) => {
        setPainPoints(prev => {
            const arr = prev.split(/[,，、 ]+/).filter(Boolean);
            if (arr.includes(tag)) return prev;
            return prev ? `${prev}, ${tag}` : tag;
        });
    };

    const handleReset = () => {
        setDataSource('public');
        setProductType('');
        setProductForm('');
        setSkinType('');
        setTargetMarket('');
        setPainPoints('');
        setBlacklist([]);
        setCertifications([]);
        setCostLimit('');
        setReportReady(false);
        setError(null);
    };

    const handleDemo = () => {
        setDataSource('private');
        setProductType('修护面霜');
        setProductForm('膏霜 (Cream)');
        setSkinType('敏感肌/受损肌');
        setTargetMarket('中国');
        setPainPoints('深层修护屏障、快速退红、长效保湿不黏腻');
        setBlacklist(['无香精', '无酒精', '无防腐体系']);
        setCertifications(['NMPA 普通化妆品备案']);
        setCostLimit(12.50);
        setReportReady(false);
        setError(null);
    };

    const handleStop = () => {
        setLoading(false);
        setError('生成已中断');
    };

    const generateMockData = (dateStr: string): FormulaVersion[] => {
        return [
            {
                versionId: 'v1.0',
                versionName: 'V1.0 初始配方',
                timestamp: dateStr,
                ingredients: [
                    { phase: 'A', inci: 'Aqua', percentage: 65.0, function: '溶剂' },
                    { phase: 'A', inci: 'Glycerin', percentage: 5.0, function: '保湿剂' },
                    { phase: 'A', inci: 'Panthenol', percentage: 2.0, function: '维生素B5/修护' },
                    { phase: 'B', inci: 'Squalane', percentage: 8.0, function: '植物角鲨烷/仿生皮脂' },
                    { phase: 'B', inci: 'Cetearyl Alcohol', percentage: 3.5, function: '脂肪醇/增稠' },
                    { phase: 'B', inci: 'Ceramide NP', percentage: 1.0, function: '神经酰胺/屏障修护' },
                    { phase: 'C', inci: 'Centella Asiatica Extract', percentage: 2.0, function: '积雪草提取物/退红' },
                    { phase: 'C', inci: 'Sodium Hyaluronate', percentage: 0.5, function: '透明质酸钠/保湿' },
                    { phase: 'D', inci: '1,2-Hexanediol', percentage: 1.5, function: '替代防腐/保湿' },
                    { phase: 'D', inci: 'Hydroxyacetophenone', percentage: 0.5, function: '对羟基苯乙酮/替代防腐' }
                ]
            }
        ];
    };

    const parseFormulaVersions = (rawAnswer: string, dateStr: string) => {
        let formulaJsonStr = '';
        let reportMd = rawAnswer;
        if (rawAnswer.includes('<json>')) {
            const match = rawAnswer.match(/<json>([\s\S]*?)<\/json>/);
            if (match) {
                formulaJsonStr = match[1].trim();
            }
            reportMd = rawAnswer.replace(/<json>[\s\S]*?<\/json>/, '').trim();
        }
        
        let parsedJson = [];
        try {
            if (formulaJsonStr) parsedJson = JSON.parse(formulaJsonStr);
        } catch (e) {
            console.error("Failed to parse formula JSON", e);
        }
        
        let finalVersions: FormulaVersion[] = [];
        
        if (Array.isArray(parsedJson) && parsedJson.length > 0) {
            // Check if it's the new multi-formula format
            if (parsedJson[0].ingredients && Array.isArray(parsedJson[0].ingredients)) {
                finalVersions = parsedJson.map((f, idx) => ({
                    versionId: `v1.${idx}`,
                    versionName: f.formula_name || `V1.${idx} 配方${idx+1}`,
                    timestamp: dateStr,
                    ingredients: f.ingredients
                }));
            } else if (parsedJson[0].inci) {
                // Single array fallback
                finalVersions = [{
                    versionId: 'v1.0',
                    versionName: 'V1.0 AI 初代配方',
                    timestamp: dateStr,
                    ingredients: parsedJson
                }];
            }
        }
        
        if (finalVersions.length === 0) {
            finalVersions = generateMockData(dateStr);
        }
        
        return { reportMd, versions: finalVersions };
    };

    const handleGenerate = async () => {
        if (!productType || !targetMarket || !painPoints || !costLimit || !productForm || !skinType) {
            setError('请填齐所有带 * 号的必填项 (产品类型/剂型/肤质/市场/痛点/成本)');
            setTimeout(() => setError(null), 4000);
            return;
        }

        setLoading(true);
        setError(null);
        setReportReady(false);
        setReportContent('');
        setVersions([]);

        try {
            const response = await fetchWithAuth('/api/beauty-rnd/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_type: productType,
                    target_market: targetMarket,
                    pain_point: painPoints,
                    cert_require: certifications.length > 0 ? certifications.join(', ') : '无认证',
                    cost_limit: Number(costLimit),
                    product_form: productForm,
                    skin_type: skinType,
                    blacklist: blacklist.length > 0 ? blacklist.join(', ') : '无',
                    data_source: 'public' // 临时强制锁定为 public，等待私有 ERP 库打通
                })
            });

            const resData = await response.json();

            if (!resData.success) throw new Error(resData.error || '生成失败');

            const answer = resData.data?.answer || '';
            const conversation_id = resData.data?.conversation_id || '';
            
            // Dify 代码节点提取的输出通常在这个路径下
            const outputs = resData.data?.outputs || resData.data?.data?.outputs || {};
            
            // 组装可能散落的数据
            let combinedAnswer = answer;
            if (outputs.formula_json && outputs.report_markdown) {
                combinedAnswer = `<json>\n${outputs.formula_json}\n</json>\n\n${outputs.report_markdown}`;
            }

            if (!combinedAnswer) {
                console.error("Dify 原始返回结果：", resData);
                throw new Error('未获取到有效的生成内容。Dify返回体: ' + JSON.stringify(resData.data).substring(0, 300));
            }

            const rdate = new Date().toLocaleString();
            const parsed = parseFormulaVersions(combinedAnswer, rdate);
            
            if (!parsed.reportMd) {
                throw new Error('未获取到有效的生成内容');
            }

            const rid = `RND-${conversation_id ? conversation_id.substring(0, 6).toUpperCase() : Math.floor(Math.random() * 1000000)}`;

            setCurrentReportId(rid);
            // setCurrentReportDate removed
            setReportContent(parsed.reportMd);
            setVersions(parsed.versions);
            setActiveVersionId(parsed.versions[parsed.versions.length - 1].versionId);
            setActiveTab('formula');
            setReportReady(true);

            const newReport: HistoryItem = {
                id: rid,
                conversation_id,
                date: rdate,
                market: targetMarket,
                productType,
                painPoints,
                certifications: [...certifications],
                costLimit,
                reportContent: parsed.reportMd,
                mockVersions: parsed.versions
            };
            setHistory(prev => [newReport, ...prev]);
            window.dispatchEvent(new CustomEvent('app-task-done', { detail: { appId: 'beautyrnd' } }));

        } catch (err: any) {
            console.error('Generation Error:', err);
            setError(err.message || '内容生成失败，请稍后重试');
        } finally {
            setLoading(false);
        }
    };

    const clearHistory = () => {
        sysConfirm('确定要清空所有研发历史记录吗？', async () => {
            try {
                const res = await fetchWithAuth('/api/beauty-rnd/conversations', { method: 'DELETE' });
                if (res.ok) setHistory([]);
                else throw new Error('清理后端记录失败');
            } catch (e: any) {
                setError('无法清空历史记录：' + e.message);
            }
        });
    };

    const deleteHistoryItem = (e: React.MouseEvent, item: HistoryItem) => {
        e.stopPropagation();
        sysConfirm(`确定要删除记录 [${item.id}] 吗？`, async () => {
            try {
                const res = await fetchWithAuth(`/api/beauty-rnd/conversations/${item.conversation_id}`, { method: 'DELETE' });
                if (res.ok) setHistory(prev => prev.filter(h => h.id !== item.id));
                else throw new Error('删除后端记录失败');
            } catch (e: any) {
                setError('无法删除记录：' + e.message);
            }
        });
    };

    const handleHistoryClick = async (item: HistoryItem) => {
        if (item.productType) setProductType(item.productType);
        if (item.market) setTargetMarket(item.market);
        setPainPoints(item.painPoints || '');
        setCertifications(item.certifications || []);
        setCostLimit(item.costLimit || '');

        setError(null);
        setReportReady(false);
        setReportContent('');
        setVersions([]);

        if (item.reportContent) {
            setReportContent(item.reportContent);
            setCurrentReportId(item.id);
            // setCurrentReportDate removed
            setVersions(item.mockVersions || generateMockData(item.date));
            setActiveVersionId(item.mockVersions ? item.mockVersions[item.mockVersions.length - 1].versionId : 'v1.0');
            setActiveTab('formula');
            setReportReady(true);
        } else if (item.conversation_id) {
            setLoading(true);
            try {
                const res = await fetchWithAuth(`/api/beauty-rnd/messages?conversation_id=${item.conversation_id}`, { method: 'GET' });
                const data = await res.json();
                if (data.data && data.data.length > 0) {
                    const lastMsg = data.data[data.data.length - 1];
                    const answer = lastMsg.answer || lastMsg.text || '';
                    
                    const parsed = parseFormulaVersions(answer, item.date);
                    
                    try {
                        const customRes = await fetchWithAuth(`/api/beauty-rnd/versions?conversation_id=${item.conversation_id}`, { method: 'GET' });
                        const customData = await customRes.json();
                        if (customData.success && customData.versions && customData.versions.length > 0) {
                            const formattedCustomVersions = customData.versions.map((v: any) => ({
                                versionId: v.versionId,
                                versionName: v.versionName,
                                timestamp: v.timestamp,
                                ingredients: typeof v.ingredients === 'string' ? JSON.parse(v.ingredients) : v.ingredients
                            }));
                            parsed.versions = [...parsed.versions, ...formattedCustomVersions];
                        }
                    } catch (e) {
                        console.error('Failed to fetch custom versions', e);
                    }
                    
                    setReportContent(parsed.reportMd);
                    setCurrentReportId(item.id);
                    // setCurrentReportDate removed
                    setVersions(parsed.versions);
                    setActiveVersionId(parsed.versions[parsed.versions.length - 1].versionId);
                    setActiveTab('formula');
                    setReportReady(true);
                    setHistory(prev => prev.map(h => h.id === item.id ? { ...h, reportContent: parsed.reportMd, mockVersions: parsed.versions } : h));
                } else {
                    throw new Error("云端无该日志正文记录");
                }
            } catch (e: any) {
                setError("无法拉取报告内容：" + (e.message || '系统错误'));
            } finally {
                setLoading(false);
            }
        }
    };

    const handleIngredientChange = (index: number, field: keyof FormulaIngredient, value: string | number) => {
        const newIngs = [...editableIngredients];
        newIngs[index] = { ...newIngs[index], [field]: value };
        setEditableIngredients(newIngs);
        setIsEdited(true);
    };

    const handleSaveNewVersion = async () => {
        const activeVer = versions.find(v => v.versionId === activeVersionId);
        const baseName = activeVer ? activeVer.versionName : '配方1';
        
        let formulaBase = "配方1";
        const match = baseName.match(/(配方\d+)/);
        if (match) {
            formulaBase = match[1];
        }

        const existingEdits = versions.filter(v => v.versionName.startsWith(`${formulaBase}：手动修改V`));
        const editCount = existingEdits.length + 1;

        const nextVid = `v1.${versions.length}_custom_${Date.now()}`;
        const newVer: FormulaVersion = {
            versionId: nextVid,
            versionName: `${formulaBase}：手动修改V${editCount}`,
            timestamp: new Date().toLocaleString(),
            ingredients: editableIngredients
        };

        const convItem = history.find(h => h.id === currentReportId);
        const conversation_id = convItem ? convItem.conversation_id : null;
        
        if (conversation_id) {
            try {
                await fetchWithAuth('/api/beauty-rnd/versions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        conversation_id,
                        version_id: newVer.versionId,
                        version_name: newVer.versionName,
                        timestamp: newVer.timestamp,
                        ingredients: newVer.ingredients
                    })
                });
            } catch (e) {
                console.error('Failed to save custom version', e);
            }
        }

        const newVersions = [...versions, newVer];
        setVersions(newVersions);
        setActiveVersionId(nextVid);
        setIsEdited(false);
        setHistory(prev => prev.map(h => h.id === currentReportId ? { ...h, mockVersions: newVersions } : h));
    };

    const handleAddIngredient = () => {
        setEditableIngredients([...editableIngredients, { phase: 'A', inci: 'New Ingredient', percentage: 0.1, function: '补充成分' }]);
        setIsEdited(true);
    };

    const handleRemoveIngredient = (idx: number) => {
        const newIngs = [...editableIngredients];
        newIngs.splice(idx, 1);
        setEditableIngredients(newIngs);
        setIsEdited(true);
    };

    const totalPercentage = editableIngredients.reduce((acc, curr) => acc + Number(curr.percentage || 0), 0);

    if (!isReady) return null;

    return (
        <div className="flex-1 bg-slate-50 flex flex-col h-full overflow-hidden relative font-sans text-slate-800">
            {/* --- Global Header --- */}
            <header className="shrink-0 bg-white border-b border-slate-200/80 px-6 py-4 flex items-center justify-between shadow-sm z-20">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-rose-600 shadow-md shadow-pink-500/20 flex items-center justify-center">
                        <Beaker className="w-5 h-5 text-white drop-shadow" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
                            智能化妆品配方研发平台
                        </h1>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                            AI-Driven Beauty Formula Insights & Compliance
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button onClick={handleReset} className="px-4 py-2 border border-slate-200 text-slate-600 font-semibold text-sm rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center gap-2 bg-white shadow-sm">
                        <RefreshCcw className="w-4 h-4" /> 重置填报
                    </button>
                    {loading ? (
                        <button onClick={handleStop} className="px-4 py-2 bg-red-50 text-red-600 border border-red-200 font-bold text-sm rounded-xl hover:bg-red-100 transition-all flex items-center gap-2 shadow-sm">
                            <Square className="w-4 h-4" /> 停止生成
                        </button>
                    ) : (
                        <button onClick={handleGenerate} className="px-5 py-2 bg-gradient-to-r from-pink-500 to-rose-600 text-white font-bold text-sm rounded-xl shadow-md shadow-pink-500/30 hover:shadow-lg hover:-translate-y-0.5 transition-all flex items-center gap-2">
                            <Play className="w-4 h-4 fill-white flex-shrink-0" /> 开始生成配方
                        </button>
                    )}
                </div>
            </header>

            {/* --- Main Content Splitter --- */}
            <div className="flex-1 overflow-hidden flex flex-col lg:flex-row relative">

                {/* === 左侧：输入配置区 === */}
                <aside className="w-full lg:w-[380px] xl:w-[420px] shrink-0 bg-white border-r border-slate-200 flex flex-col h-full z-10">
                    <div className="p-5 pb-2 flex-shrink-0 flex items-center justify-between">
                        <h2 className="font-bold text-slate-800 flex items-center gap-2">
                            <Settings2 className="w-5 h-5 text-pink-500" />
                            配方参数与库限制
                        </h2>
                        <button
                            onClick={handleDemo}
                            className="px-2.5 py-1 text-xs font-bold text-pink-600 bg-pink-50 border border-pink-200 rounded hover:bg-pink-100 transition-colors shadow-sm"
                        >
                            演示用例
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto px-5 py-3 space-y-6 custom-scrollbar pb-10">
                        
                        {/* 数据源选择 */}
                        <div className="space-y-2 pb-3 border-b border-slate-100">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                                <Server className="w-4 h-4 text-slate-400" /> 原料数据库范围限制
                            </label>
                            <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200 shadow-inner">
                                <button onClick={() => setDataSource('public')} className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all ${dataSource==='public' ? 'bg-white text-slate-800 shadow-sm border border-slate-200/50' : 'text-slate-500 hover:text-slate-700'}`}>
                                    <Globe className="w-3.5 h-3.5" /> 通用市场库
                                </button>
                                <button onClick={() => setDataSource('private')} className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all ${dataSource==='private' ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                                    <Database className="w-3.5 h-3.5" /> 企业私有ERP库
                                </button>
                            </div>
                        </div>

                        {/* 产品形态 */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                                    <TestTube2 className="w-4 h-4 text-slate-400" /> 产品品类 <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={productType}
                                    onChange={e => setProductType(e.target.value)}
                                    placeholder="如: 精华水"
                                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-pink-500/50 shadow-sm placeholder-slate-400"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                                    <Layers className="w-4 h-4 text-slate-400" /> 产品剂型 <span className="text-red-500">*</span>
                                </label>
                                <div className="relative" ref={formRef}>
                                    <div onClick={() => setFormOpen(!formOpen)} className={`w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500/50 shadow-sm cursor-pointer flex items-center justify-between ${!productForm ? 'text-slate-400 font-medium' : 'text-slate-700 font-semibold'}`}>
                                        <span className="truncate">{productForm || '选择剂型'}</span>
                                        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                                    </div>
                                    {formOpen && (
                                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden max-h-48 overflow-y-auto">
                                            {PRODUCT_FORMS.map(f => (
                                                <div key={f} onClick={() => { setProductForm(f); setFormOpen(false); }} className={`px-4 py-2.5 text-sm font-semibold cursor-pointer ${productForm === f ? 'bg-pink-50 text-pink-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                                                    {f}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* 肤质与市场 */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                                    <Users className="w-4 h-4 text-slate-400" /> 适用肤质 <span className="text-red-500">*</span>
                                </label>
                                <div className="relative" ref={skinRef}>
                                    <div onClick={() => setSkinOpen(!skinOpen)} className={`w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500/50 shadow-sm cursor-pointer flex items-center justify-between ${!skinType ? 'text-slate-400 font-medium' : 'text-slate-700 font-semibold'}`}>
                                        <span className="truncate">{skinType || '选择肤质'}</span>
                                        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                                    </div>
                                    {skinOpen && (
                                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden max-h-48 overflow-y-auto">
                                            {SKIN_TYPES.map(s => (
                                                <div key={s} onClick={() => { setSkinType(s); setSkinOpen(false); }} className={`px-4 py-2.5 text-sm font-semibold cursor-pointer ${skinType === s ? 'bg-pink-50 text-pink-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                                                    {s}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                                    <Globe className="w-4 h-4 text-slate-400" /> 目标市场 <span className="text-red-500">*</span>
                                </label>
                                <div className="relative" ref={marketRef}>
                                    <div onClick={() => setMarketOpen(!marketOpen)} className={`w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500/50 shadow-sm cursor-pointer flex items-center justify-between ${!targetMarket ? 'text-slate-400 font-medium' : 'text-slate-700 font-semibold'}`}>
                                        <span className="truncate">{targetMarket || '选择市场'}</span>
                                        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                                    </div>
                                    {marketOpen && (
                                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
                                            {MARKETS.map(m => (
                                                <div key={m} onClick={() => { setTargetMarket(m); setMarketOpen(false); }} className={`px-4 py-2.5 text-sm font-semibold cursor-pointer ${targetMarket === m ? 'bg-pink-50 text-pink-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                                                    {m}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* 黑名单 (No-No List) */}
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                                <Ban className="w-4 h-4 text-red-400" /> 成分黑名单 / 纯净理念
                            </label>
                            <div className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-wrap gap-2">
                                {BLACKLIST_TAGS.map(tag => {
                                    const isActive = blacklist.includes(tag);
                                    return (
                                        <button
                                            key={tag}
                                            onClick={() => toggleBlacklist(tag)}
                                            className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all border ${isActive ? 'bg-red-50 border-red-200 text-red-600 shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-100'}`}
                                        >
                                            {isActive && <Ban className="w-3 h-3 inline-block mr-1 -mt-0.5" />}
                                            {tag}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 核心痛点 */}
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5 justify-between">
                                <span className="flex items-center gap-1.5"><Fingerprint className="w-4 h-4 text-slate-400" /> 核心功效与痛点 <span className="text-red-500">*</span></span>
                            </label>
                            <textarea
                                value={painPoints}
                                onChange={e => setPainPoints(e.target.value)}
                                placeholder="输入具体功效或质地要求..."
                                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-pink-500/50 shadow-sm min-h-[80px] resize-y placeholder-slate-400 text-sm"
                            />
                            <div className="flex flex-wrap gap-2 pt-1">
                                {PAIN_POINT_TAGS.map(tag => (
                                    <button key={tag} onClick={() => handleTagClick(tag)} className="px-2 py-0.5 bg-white border border-slate-200 rounded-md text-[11px] font-semibold text-slate-500 hover:border-pink-300 hover:text-pink-600 transition-colors">
                                        + {tag}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* 强制认证 */}
                        <div className="space-y-2 pb-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                                <ShieldCheck className="w-4 h-4 text-slate-400" /> 强制认证需求
                            </label>
                            <div className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 flex flex-col gap-2">
                                {CERT_OPTIONS.map(c => {
                                    const isActive = certifications.includes(c);
                                    return (
                                        <button
                                            key={c}
                                            onClick={() => toggleCert(c)}
                                            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-all border ${isActive ? 'bg-white border-pink-500 text-pink-700 ring-2 ring-pink-500/20 shadow-sm' : 'bg-transparent border-transparent text-slate-600 hover:bg-slate-200/50'}`}
                                        >
                                            <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${isActive ? 'bg-pink-500 border-pink-500' : 'bg-white border-slate-300'}`}>
                                                {isActive && <CheckCircle2 className="w-3 h-3 text-white" />}
                                            </div>
                                            {c}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 成本上限 */}
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                                <Coins className="w-4 h-4 text-slate-400" /> 目标成本上限 <span className="text-red-500">*</span>
                            </label>
                            <div className="relative">
                                <input
                                    type="number"
                                    value={costLimit}
                                    onChange={e => setCostLimit(e.target.value ? Number(e.target.value) : '')}
                                    placeholder="输入成本上限..."
                                    className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-pink-500/50 shadow-sm placeholder-slate-400"
                                />
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold border-l pl-3 border-slate-200">
                                    元
                                </div>
                            </div>
                        </div>
                    </div>
                </aside>

                {/* === 右侧：展示/结果区 === */}
                <main className="flex-1 overflow-hidden flex flex-col bg-slate-50/50 relative">

                    {/* Floating Toast Notification */}
                    <div className={`absolute top-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${error ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'}`}>
                        <div className="bg-rose-50 border border-rose-200 shadow-xl shadow-rose-500/10 rounded-xl px-4 py-3 flex items-center gap-3">
                            <ShieldAlert className="w-5 h-5 text-rose-500" />
                            <p className="text-sm font-bold text-rose-800">{error}</p>
                            <button onClick={() => setError(null)} className="ml-2 w-6 h-6 hover:bg-rose-100 rounded-md flex items-center justify-center text-rose-500 transition-colors">
                                <XCircle className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {!reportReady && !loading && (
                        <div className="flex-1 flex items-center justify-center p-8 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:20px_20px] opacity-70">
                            <div className="max-w-md text-center bg-white/80 backdrop-blur-sm border border-slate-200/60 p-10 rounded-3xl shadow-xl shadow-slate-200/40">
                                <div className="w-20 h-20 bg-pink-50 rounded-full flex items-center justify-center mx-auto mb-6 text-pink-400 border-[8px] border-white shadow-sm hover:scale-105 transition-transform duration-500">
                                    <Database className="w-8 h-8" />
                                </div>
                                <h3 className="text-2xl font-black text-slate-800 mb-3 tracking-tight">配方工作台已就绪</h3>
                                <p className="text-slate-500 font-medium mb-6 leading-relaxed">请输入左侧产品的细分需求，我们将为您检索结构化配方并支持版本手动微调。</p>
                                <div className="px-5 py-3 bg-blue-50/50 rounded-xl border border-blue-100 text-left text-xs font-medium text-slate-600">
                                    <Info className="w-4 h-4 text-blue-500 inline-block mr-1.5 -mt-0.5" />
                                    支持对接千万级专业法规库，生成后可以直接在配方表中手动修改并保存新版本。
                                </div>
                            </div>
                        </div>
                    )}

                    {loading && (
                        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-white/50 backdrop-blur-sm">
                            <div className="relative mb-8">
                                <div className="w-24 h-24 rounded-full border-4 border-slate-100 animate-pulse absolute" />
                                <div className="w-24 h-24 rounded-full border-4 border-transparent border-t-pink-500 border-r-rose-400 animate-spin" />
                                <div className="w-24 h-24 absolute inset-0 flex items-center justify-center">
                                    <Beaker className="w-8 h-8 text-pink-500 animate-bounce" />
                                </div>
                            </div>
                            <h3 className="text-xl font-bold text-slate-700 bg-clip-text text-transparent bg-gradient-to-r from-pink-600 to-rose-500 mb-2">
                                正在对接研发工作流...
                            </h3>
                            <p className="text-sm font-medium text-slate-400">正在按限制条件检索成分并生成架构模型</p>
                        </div>
                    )}

                    {reportReady && !loading && (
                        <div className="flex-1 overflow-hidden flex flex-col relative animate-in fade-in duration-500">
                            {/* Header / Version Control */}
                            <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0 shadow-sm z-10">
                                <div>
                                    <div className="flex items-center gap-3 mb-1">
                                        <h2 className="text-xl font-black text-slate-800 tracking-tight">智能配方研发工作台</h2>
                                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-teal-50 text-teal-700 text-xs font-bold rounded border border-teal-100">
                                            <CheckCircle2 className="w-3.5 h-3.5" /> 已就绪
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-slate-500">
                                        <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600">ID: {currentReportId}</span>
                                        <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-100">市场: {targetMarket}</span>
                                        <span className="bg-sky-50 text-sky-700 px-2 py-0.5 rounded border border-sky-100">剂型: {productForm}</span>
                                        <span className="bg-pink-50 text-pink-700 px-2 py-0.5 rounded border border-pink-100 font-mono">限制: ¥{Number(costLimit).toFixed(2)}</span>
                                    </div>
                                </div>
                                
                                <div className="flex flex-col items-end gap-1.5">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mr-1">版本历史</span>
                                    <div className="relative">
                                        <select 
                                            value={activeVersionId}
                                            onChange={(e) => setActiveVersionId(e.target.value)}
                                            className="pl-3 pr-8 py-1.5 text-sm font-bold bg-white border border-slate-200 rounded-lg shadow-sm text-pink-600 focus:outline-none focus:ring-2 focus:ring-pink-500/50 cursor-pointer appearance-none transition-colors hover:border-pink-300"
                                        >
                                            {versions.map(v => (
                                                <option key={v.versionId} value={v.versionId} className="text-slate-700 font-semibold">{v.versionName}</option>
                                            ))}
                                        </select>
                                        <ChevronDown className="w-4 h-4 text-pink-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                                    </div>
                                </div>
                            </div>

                            {/* Tabs */}
                            <div className="bg-slate-50/80 backdrop-blur border-b border-slate-200 px-6 pt-3 flex gap-6 shrink-0 justify-between">
                                <div className="flex gap-6">
                                    {[
                                        { id: 'formula', icon: TestTube2, label: '结构化配方表' },
                                        { id: 'report', icon: FileText, label: 'AI评估研报' },
                                        { id: 'compliance', icon: ShieldCheck, label: '合规与成本核算' }
                                    ].map(tab => (
                                        <button
                                            key={tab.id}
                                            onClick={() => setActiveTab(tab.id as any)}
                                            className={`flex items-center gap-2 pb-3 px-1 text-sm font-bold border-b-2 transition-colors ${activeTab === tab.id ? 'border-pink-500 text-pink-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                                        >
                                            <tab.icon className="w-4 h-4" /> {tab.label}
                                        </button>
                                    ))}
                                </div>
                                {activeTab === 'formula' && isEdited && (
                                    <div className="pb-2">
                                        <button onClick={handleSaveNewVersion} className="px-4 py-1.5 bg-gradient-to-r from-pink-500 to-rose-600 text-white font-bold text-xs rounded-lg shadow-md shadow-pink-500/30 hover:-translate-y-0.5 transition-all flex items-center gap-1.5">
                                            <Save className="w-3.5 h-3.5" /> 保存新版本
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Workspace Content */}
                            <div className="flex-1 overflow-hidden flex relative">
                                {/* Tab Content */}
                                <div className="flex-1 overflow-y-auto custom-scrollbar bg-white relative p-6 flex justify-center">
                                    {activeTab === 'formula' && (
                                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 w-full max-w-5xl">
                                            <div className="flex items-center justify-between mb-4">
                                                <div className="flex items-center gap-3">
                                                    <h3 className="font-bold text-slate-800 text-lg">配方成分明细表</h3>
                                                    <span className={`text-xs font-mono px-2 py-0.5 rounded ${totalPercentage !== 100 ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-green-100 text-green-700 border border-green-200'}`}>
                                                        总计: {totalPercentage.toFixed(2)}%
                                                    </span>
                                                </div>
                                                <div className="flex gap-2">
                                                    <button onClick={handleAddIngredient} className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 text-xs font-bold rounded-lg transition-colors shadow-sm">
                                                        + 添加成分
                                                    </button>
                                                    <button className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-600 text-xs font-bold rounded-lg transition-colors">
                                                        导出 Excel
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm pb-10">
                                                <table className="w-full text-left border-collapse">
                                                    <thead className="bg-slate-50 border-b border-slate-200">
                                                        <tr>
                                                            <th className="p-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-16 text-center">相</th>
                                                            <th className="p-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider">INCI 名称</th>
                                                            <th className="p-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider text-right w-28">添加量 (%)</th>
                                                            <th className="p-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider">核心作用</th>
                                                            <th className="p-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider w-24">操作</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100 bg-white">
                                                        {editableIngredients.map((ing, idx) => (
                                                            <tr key={idx} className="hover:bg-slate-50/80 transition-colors group">
                                                                <td className="p-2 text-center">
                                                                    <input 
                                                                        type="text"
                                                                        value={ing.phase}
                                                                        onChange={e => handleIngredientChange(idx, 'phase', e.target.value)}
                                                                        className="w-full text-center text-sm font-black text-slate-400 bg-transparent focus:bg-white focus:ring-1 focus:ring-pink-500 rounded py-1"
                                                                    />
                                                                </td>
                                                                <td className="p-2">
                                                                    <input 
                                                                        type="text"
                                                                        value={ing.inci}
                                                                        onChange={e => handleIngredientChange(idx, 'inci', e.target.value)}
                                                                        className="w-full text-sm font-semibold text-slate-700 bg-transparent focus:bg-white focus:ring-1 focus:ring-pink-500 rounded px-2 py-1"
                                                                    />
                                                                </td>
                                                                <td className="p-2">
                                                                    <input 
                                                                        type="number"
                                                                        step="0.01"
                                                                        value={ing.percentage}
                                                                        onChange={e => handleIngredientChange(idx, 'percentage', Number(e.target.value))}
                                                                        className="w-full text-sm font-bold text-slate-800 text-right font-mono bg-slate-50 focus:bg-white border border-transparent focus:border-pink-300 focus:ring-1 focus:ring-pink-500 rounded px-2 py-1 transition-colors"
                                                                    />
                                                                </td>
                                                                <td className="p-2">
                                                                    <input 
                                                                        type="text"
                                                                        value={ing.function}
                                                                        onChange={e => handleIngredientChange(idx, 'function', e.target.value)}
                                                                        className="w-full text-sm text-slate-600 bg-transparent focus:bg-white focus:ring-1 focus:ring-pink-500 rounded px-2 py-1"
                                                                    />
                                                                </td>
                                                                <td className="p-2 flex items-center gap-2">
                                                                    {ing.warning ? (
                                                                        <span title={ing.warning} className="inline-flex items-center gap-1 p-1 bg-amber-50 text-amber-700 border border-amber-200 rounded cursor-help">
                                                                            <AlertTriangle className="w-3 h-3" />
                                                                        </span>
                                                                    ) : (
                                                                        <span title="合规安全" className="inline-flex items-center gap-1 p-1 bg-green-50 text-green-700 border border-green-200 rounded">
                                                                            <CheckCircle2 className="w-3 h-3" />
                                                                        </span>
                                                                    )}
                                                                    <button onClick={() => handleRemoveIngredient(idx)} className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100">
                                                                        <Trash2 className="w-4 h-4" />
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}

                                    {activeTab === 'report' && (
                                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 w-full max-w-4xl">
                                            <article className="prose prose-slate max-w-none w-full
                                                prose-headings:font-black prose-headings:text-slate-800 
                                                prose-h1:text-center prose-h1:text-2xl prose-h1:mb-8 prose-h1:pb-6 prose-h1:border-b-2 prose-h1:border-pink-100
                                                prose-h2:text-xl prose-h2:text-pink-700 prose-h2:mt-10 prose-h2:mb-4 prose-h2:border-l-4 prose-h2:border-pink-500 prose-h2:pl-3
                                                prose-p:text-slate-600 prose-p:leading-relaxed prose-p:mb-4
                                                prose-strong:text-slate-800 prose-strong:font-bold
                                                prose-a:text-pink-600 hover:prose-a:text-pink-500
                                                prose-table:w-full prose-table:my-8 prose-table:border-collapse prose-table:rounded-xl prose-table:overflow-hidden prose-table:shadow-sm
                                                prose-thead:bg-slate-50
                                                prose-th:p-4 prose-th:text-left prose-th:text-sm prose-th:font-bold prose-th:text-slate-700 prose-th:border-b-2 prose-th:border-slate-200
                                                prose-tbody:bg-white
                                                prose-td:p-4 prose-td:text-sm prose-td:text-slate-600 prose-td:border-b prose-td:border-slate-100"
                                            >
                                                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                                                    {reportContent.replace(/## 3\. 合规.*?判定[\s\S]*?(?=## 5|$)/g, '').replace(/## 4\. 成本核算分析[\s\S]*?(?=## 5|$)/g, '')}
                                                </ReactMarkdown>
                                            </article>
                                        </div>
                                    )}

                                    {activeTab === 'compliance' && (
                                        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 w-full max-w-4xl">
                                            <article className="prose prose-slate max-w-none w-full
                                                prose-headings:font-black prose-headings:text-slate-800 
                                                prose-h2:text-xl prose-h2:text-teal-700 prose-h2:mb-4 prose-h2:border-l-4 prose-h2:border-teal-500 prose-h2:pl-3
                                                prose-p:text-slate-600 prose-p:leading-relaxed prose-p:mb-4
                                                prose-strong:text-slate-800 prose-strong:font-bold
                                                prose-ul:text-slate-600 prose-li:mb-1"
                                            >
                                                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                                                    {reportContent.match(/## 3\. 合规与红绿灯判定([\s\S]*)/) 
                                                        ? "## 3. 合规与红绿灯判定" + (reportContent.match(/## 3\. 合规与红绿灯判定([\s\S]*)/)?.[1] || "") 
                                                        : "暂无独立合规数据，请前往【AI评估研报】标签页查看完整内容。"}
                                                </ReactMarkdown>
                                            </article>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </main>

                {/* === 侧边栏：历史记录 === */}
                <aside className="hidden 2xl:flex w-[320px] shrink-0 bg-slate-50/80 backdrop-blur-md border-l border-slate-200 flex-col h-full z-10 shadow-[-10px_0_20px_-10px_rgba(0,0,0,0.02)]">
                    <div className="p-5 flex items-center justify-between border-b border-slate-200">
                        <h2 className="font-bold text-slate-700 flex items-center gap-2">
                            <History className="w-4 h-4 text-slate-500" /> 过往研发日志
                        </h2>
                        {history.length > 0 && (
                            <button onClick={clearHistory} className="text-[11px] font-bold text-slate-400 hover:text-red-500 transition-colors uppercase tracking-wide">
                                清空
                            </button>
                        )}
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 custom-scrollbar">
                        {history.length === 0 ? (
                            <div className="text-center text-sm font-medium text-slate-400 py-10 px-4">
                                <Database className="w-8 h-8 mx-auto mb-3 opacity-20" />
                                暂无生成的配方记录，快去开启工作流吧
                            </div>
                        ) : (
                            history.map(item => (
                                <div key={item.id}
                                    onClick={() => handleHistoryClick(item)}
                                    className={`bg-white border rounded-xl p-4 shadow-sm hover:shadow-md cursor-pointer transition-all group ${currentReportId === item.id ? 'border-pink-400 ring-2 ring-pink-500/10' : 'border-slate-200 hover:border-pink-200'}`}>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{item.id}</span>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={(e) => deleteHistoryItem(e, item)}
                                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 text-slate-300 hover:text-red-500 rounded transition-all"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </button>
                                            <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                                        </div>
                                    </div>
                                    <h4 className="font-bold text-slate-700 text-sm mb-1 group-hover:text-pink-600 transition-colors">{item.productType}</h4>
                                    <div className="text-[11px] font-semibold text-slate-500 bg-slate-50 inline-block px-1.5 py-0.5 rounded">
                                        {item.market}市场
                                    </div>
                                    <div className="text-[10px] font-medium text-slate-400 mt-3 pt-2 border-t border-slate-100 flex items-center gap-1.5">
                                        {item.date}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </aside>

            </div>
        </div>
    );
};
