import React, { useState, useEffect } from 'react';
import {
    Send, RefreshCcw, Loader2, Globe, ShoppingBag, Palette,
    FileText, CheckCircle2, Copy, Sparkles, AlertCircle, Type, Package, TestTube, LayoutTemplate
} from 'lucide-react';
import { fetchWithAuth } from '../utils/authFetch';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useConfig } from '../hooks/useConfig';

interface TranslatedContent {
    original: string;
    translation: string;
}

interface SECMarketingData {
    seo_titles: TranslatedContent[];
    ecommerce_listing: TranslatedContent;
    koc_script: TranslatedContent;
    platform: string;
}

export const SEAMarketingModule: React.FC = () => {
    const [isReady, setIsReady] = useState(false);
    useEffect(() => {
        requestAnimationFrame(() => {
            setTimeout(() => setIsReady(true), 50);
        });
    }, []);

    // Form states
    const [productName, setProductName] = useState('');
    const [productInfo, setProductInfo] = useState('');
    const [ingredients, setIngredients] = useState('');
    const [targetLanguage, setTargetLanguage] = useState('英语');
    const [targetPlatform, setTargetPlatform] = useState('TikTok');
    const [marketingStyle, setMarketingStyle] = useState('种草风格');

    // UI states
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [resultData, setResultData] = useState<SECMarketingData | null>(null);
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

    // Preview states
    const [selectedTitle, setSelectedTitle] = useState('');
    const [selectedTemplate, setSelectedTemplate] = useState<string>('tiktok');

    const [showTranslations, setShowTranslations] = useState({
        seo: false,
        listing: false,
        koc: false
    });

    const toggleTranslation = (section: 'seo' | 'listing' | 'koc') => {
        setShowTranslations(prev => ({ ...prev, [section]: !prev[section] }));
    };

    // --- Dynamic Configurations Loader ---
    const { data: configLanguages } = useConfig<{ name: string, code: string, flag_emoji: string }>('languages');
    const { data: configPlatforms } = useConfig<{ name: string, label: string }>('platforms');
    const { data: configStyles } = useConfig<{ name: string }>('marketing_styles');

    const API_LANGUAGES = configLanguages;
    const API_PLATFORMS = configPlatforms;
    const API_STYLES = configStyles.map(s => s.name);

    const handleReset = () => {
        setProductName('');
        setProductInfo('');
        setIngredients('');
        setTargetLanguage('英语');
        setTargetPlatform('TikTok');
        setMarketingStyle('种草风格');
        setResultData(null);
        setError(null);
        setSelectedTitle('');
        setSelectedTemplate('');
        setShowTranslations({ seo: false, listing: false, koc: false });
    };

    const handleFillTestCase = () => {
        setProductName('巧克力丝滑妆前乳');
        setProductInfo('质地丝滑服帖，隐形毛孔，保湿控油，持妆一整天，敏感肌也能用');
        setIngredients('玻尿酸、甘油、维生素 E、烟酰胺');
        setTargetLanguage('印尼语');
        setTargetPlatform('Shopee');
        setMarketingStyle('种草风格');
        setResultData(null);
        setError(null);
    };

    const handleCopy = async (text: string, index: number) => {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                textArea.style.top = '-999999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                document.execCommand('copy');
                textArea.remove();
            }
            setCopiedIndex(index);
            setTimeout(() => setCopiedIndex(null), 2000);
        } catch (err) {
            console.error('Copy failed:', err);
        }
    };

    const handleGenerate = async () => {
        if (!productName.trim() || !productInfo.trim()) {
            setError('产品名称和产品信息为必填项');
            return;
        }

        setLoading(true);
        setError(null);
        setShowTranslations({ seo: false, listing: false, koc: false });

        try {
            const response = await fetchWithAuth('/api/sea-marketing/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    product_name: productName,
                    product_info: productInfo,
                    ingredient: ingredients,
                    target_language: targetLanguage,
                    target_platform: targetPlatform,
                    marketing_style: marketingStyle
                })
            });

            const resData = await response.json();

            if (!resData.success) {
                throw new Error(resData.error || '生成失败');
            }

            const answer = resData.data?.answer || '';
            if (!answer) {
                throw new Error('未获取到有效的生成内容');
            }

            // 解析 Markdown 中的三大板块内容
            const extractSection = (text: string, currentHeader: string, nextHeader: string | null) => {
                const lines = text.split('\n');
                let inSection = false;
                let content = [];
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (!inSection) {
                        if (line.includes(currentHeader)) {
                            inSection = true;
                        }
                    } else {
                        if (nextHeader && line.includes(nextHeader)) {
                            break;
                        }
                        content.push(line);
                    }
                }
                return content.join('\n').trim();
            };

            const seoSection = extractSection(answer, 'SEO标题', '电商详情页');
            const listingSection = extractSection(answer, '电商详情页', 'KOC社媒种草');
            const kocSection = extractSection(answer, 'KOC社媒种草', null);

            const extractTranslationLegacy = (text: string) => {
                let original = text;
                let translation = '';
                const match = text.match(/\*\*(?:中文翻译|翻译)\s*：\*\*/);
                if (match) {
                    const transIdx = match.index!;
                    original = text.substring(0, transIdx).trim();
                    translation = text.substring(transIdx + match[0].length).trim();
                    original = original.replace(/^\*\*(.*?[语文]).*?：\*\*/, '').trim();
                    return { original, translation };
                }
                const fallback = text.indexOf('中文翻译：');
                if (fallback !== -1) {
                    original = text.substring(0, fallback).trim();
                    translation = text.substring(fallback + '中文翻译：'.length).trim();
                    original = original.replace(/^.*?[语文].*?：/, '').trim();
                    return { original, translation };
                }
                return null;
            };

            const parseSEO = (text: string) => {
                const legacy = extractTranslationLegacy(text);
                if (legacy) {
                    const splitTitles = (t: string) => t.split('\n').map(l => l.replace(/^[-*•0-9.]+\s*/, '').replace(/^\*\*(.*?)\*\*$/, '$1').trim()).filter(l => l.length > 0 && !l.startsWith('---'));
                    const origTitles = splitTitles(legacy.original);
                    const transTitles = splitTitles(legacy.translation);
                    return origTitles.map((orig, i) => ({ original: orig, translation: transTitles[i] || '' }));
                }

                // 支持交叉出现(ID, CN, ID, CN) 或者 分组出现 (ID*5, CN*5)
                const lines = text.split('\n')
                    .map(l => l.trim())
                    .filter(l => l && !l.startsWith('---') && !/^#+\s/.test(l) && !l.includes('中文翻译'));
                const originalLines: string[] = [];
                const translationLines: string[] = [];
                
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const cleanLine = line.replace(/^\*\*(.*?)\*\*$/, '$1').replace(/^[-*•0-9.]+\s*/, '');
                    const isChinese = (line.match(/[\u4e00-\u9fa5]/g) || []).length > 3;
                    
                    if (isChinese) {
                        translationLines.push(cleanLine);
                    } else {
                        originalLines.push(cleanLine);
                    }
                }
                
                // 将原文与翻译一一映射
                return originalLines.map((orig, i) => ({
                    original: orig,
                    translation: translationLines[i] || ''
                }));
            };

            const parseListing = (text: string) => {
                const legacy = extractTranslationLegacy(text);
                if (legacy) return legacy;

                const paras = text.split('\n\n').filter(p => p.trim() && !p.startsWith('---'));
                if (paras.length === 0) return { original: '', translation: '' };

                const firstParaLines = paras[0].split('\n').map(l => l.trim()).filter(l => l);
                let originalTitle = '';
                let translationTitle = '';
                let bodyParas = paras;

                // 判断第一个段落是否是“双语标题”
                if (firstParaLines.length >= 2 && (firstParaLines[1].match(/[\u4e00-\u9fa5]/g) || []).length > 3) {
                    originalTitle = firstParaLines[0];
                    translationTitle = firstParaLines[1];
                    bodyParas = paras.slice(1);
                }

                let splitIdx = bodyParas.length;
                for (let i = 0; i < bodyParas.length; i++) {
                    const firstLine = bodyParas[i].split('\n')[0];
                    const isChinese = (firstLine.match(/[\u4e00-\u9fa5]/g) || []).length > 3;
                    if (isChinese) {
                        splitIdx = i;
                        break;
                    }
                }

                const originalBody = bodyParas.slice(0, splitIdx);
                const translationBody = bodyParas.slice(splitIdx);

                return { 
                    original: [originalTitle, ...originalBody].filter(Boolean).join('\n\n'), 
                    translation: [translationTitle, ...translationBody].filter(Boolean).join('\n\n') 
                };
            };

            const parseKOC = (text: string) => {
                const legacy = extractTranslationLegacy(text);
                if (legacy) return legacy;

                const paras = text.split('\n\n').filter(p => p.trim() && !p.startsWith('---'));
                let originalParts = [];
                let translationParts = [];
                let currentPrefix = '';

                for (let i = 0; i < paras.length; i++) {
                    let para = paras[i];
                    const match = para.match(/^(\*\*\d+\.\*\*\s*\n?|^#?\s*\d+\.\s*\n?)/); 
                    if (match) {
                        currentPrefix = match[1];
                        if (para.trim() === match[1].trim()) continue; // 如果这一段仅仅是序号，跳过
                    }
                    const isChinese = (para.match(/[\u4e00-\u9fa5]/g) || []).length > 5;
                    
                    if (isChinese) {
                        if (currentPrefix && !para.startsWith(currentPrefix.trim())) {
                            para = currentPrefix + para;
                        }
                        translationParts.push(para);
                    } else {
                        if (currentPrefix && !para.startsWith(currentPrefix.trim())) {
                            para = currentPrefix + para;
                        }
                        originalParts.push(para);
                    }
                }

                return { original: originalParts.join('\n\n'), translation: translationParts.join('\n\n') };
            };

            const seoTitles = parseSEO(seoSection);
            const listingPair = parseListing(listingSection);
            const kocPair = parseKOC(kocSection);

            const platform = targetPlatform;
            setResultData({
                seo_titles: seoTitles.length > 0 ? seoTitles : [{original: '(未获取到 SEO 标题)', translation: ''}],
                ecommerce_listing: listingPair.original ? listingPair : {original: '(未获取到详情页内容)', translation: ''},
                koc_script: kocPair.original ? kocPair : {original: '(未获取到短视频脚本)', translation: ''},
                platform: platform
            });

            // 设置默认选中态和预览模板
            setSelectedTitle(seoTitles.length > 0 ? seoTitles[0].original : '');
            if (platform === 'Shopee') setSelectedTemplate('Shopee 标准版');
            else if (platform === 'Lazada') setSelectedTemplate('Lazada 简约版');
            else setSelectedTemplate('TikTok 商品卡版');

            // 通知菜单栏：后台任务完成
            window.dispatchEvent(new CustomEvent('app-task-done', { detail: { appId: 'seamarketing' } }));

        } catch (err: any) {
            console.error('Generation Error:', err);
            setError(err.message || '内容生成失败，请重试');
        } finally {
            setLoading(false);
        }
    };
    if (!isReady) return null;

    return (
        <div className="flex-1 bg-slate-50 overflow-hidden flex flex-col h-full rounded-tl-3xl shadow-inner relative">
            {/* Header */}
            <div className="bg-white/80 backdrop-blur-md border-b border-slate-200 p-6 flex items-center justify-between z-10 sticky top-0">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-xl shadow-lg shadow-teal-500/20 text-white transform hover:scale-105 transition-transform">
                        <Globe className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-800 to-emerald-600">出海本地化营销内容生成</h2>
                        <p className="text-sm text-slate-500 font-medium">针对东南亚市场一键生成 SEO 标题、电商 Listing 及短视频脚本 (TikTok / Shopee / Lazada)</p>
                    </div>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={handleReset}
                        className="flex items-center gap-2 px-4 py-2 border-2 border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all font-bold"
                        disabled={loading}
                    >
                        <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        重置填报
                    </button>
                    <button
                        onClick={handleGenerate}
                        className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-teal-500 to-emerald-600 text-white rounded-xl shadow-lg shadow-teal-500/30 hover:shadow-xl hover:scale-105 transition-all font-bold active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                        disabled={loading}
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        {loading ? '生成中...' : '生成营销方案'}
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-auto xl:overflow-hidden p-6 flex flex-col xl:flex-row gap-6">
                {/* Left Panel: Inputs */}
                <div className="w-full xl:max-w-xl flex flex-col gap-6 shrink-0 h-fit xl:h-full overflow-visible xl:overflow-y-auto custom-scrollbar xl:pr-2 pb-4">
                    <div className="bg-white rounded-2xl p-6 border border-slate-200/60 shadow-sm relative overflow-hidden shrink-0">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-teal-50 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none opacity-50"></div>
                        <div className="flex items-center justify-between mb-6 relative z-10">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 m-0">
                                <Package className="w-5 h-5 text-teal-500" />
                                基础产品信息
                            </h3>
                            <button
                                onClick={handleFillTestCase}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-teal-600 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors border border-teal-100 shadow-sm"
                                disabled={loading}
                                title="一键填充演示数据"
                            >
                                <Sparkles className="w-3.5 h-3.5" />
                                演示用例
                            </button>
                        </div>

                        <div className="space-y-5 relative z-10">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                                    <Type className="w-4 h-4 text-slate-400" />产品名称 <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={productName}
                                    onChange={(e) => setProductName(e.target.value)}
                                    placeholder="如：巧克力丝滑妆前乳 / 清透保湿粉底液 / 控油哑光散粉"
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500 transition-all font-medium text-slate-800 placeholder:text-slate-400"
                                    disabled={loading}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-slate-400" />产品核心信息 <span className="text-red-500">*</span>
                                </label>
                                <textarea
                                    value={productInfo}
                                    onChange={(e) => setProductInfo(e.target.value)}
                                    placeholder="描述产品的核心卖点、使用场景、功能参数等..."
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500 transition-all min-h-[80px] resize-y font-medium text-slate-800 placeholder:text-slate-400"
                                    disabled={loading}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                                    <TestTube className="w-4 h-4 text-slate-400" />成分或材质 <span className="text-slate-400 font-normal text-xs">(选填)</span>
                                </label>
                                <textarea
                                    value={ingredients}
                                    onChange={(e) => setIngredients(e.target.value)}
                                    placeholder="如：水、甘油、矿物成分、玻尿酸、维生素 E、烟酰胺..."
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500 transition-all min-h-[80px] resize-y font-medium text-slate-800 placeholder:text-slate-400"
                                    disabled={loading}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl p-6 border border-slate-200/60 shadow-sm relative overflow-hidden shrink-0">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none opacity-50"></div>
                        <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-emerald-500" />
                            本地化营销策略
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 relative z-10">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">目标语种</label>
                                <div className="relative">
                                    <select
                                        value={targetLanguage}
                                        onChange={(e) => setTargetLanguage(e.target.value)}
                                        className="w-full gap-2 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/50 transition-all font-bold text-slate-700 appearance-none pr-10 cursor-pointer"
                                        disabled={loading}
                                    >
                                        {API_LANGUAGES.map(lang => (
                                            <option key={lang.name} value={lang.name}>
                                                {lang.flag_emoji} {lang.name}
                                            </option>
                                        ))}
                                    </select>
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                        ▼
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">目标平台</label>
                                <div className="relative">
                                    <select
                                        value={targetPlatform}
                                        onChange={(e) => setTargetPlatform(e.target.value)}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/50 transition-all font-bold text-slate-700 appearance-none pr-10 cursor-pointer"
                                        disabled={loading}
                                    >
                                        {API_PLATFORMS.map(p => (
                                            <option key={p.name} value={p.name}>
                                                {p.name} ({p.label})
                                            </option>
                                        ))}
                                    </select>
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                        ▼
                                    </div>
                                </div>
                            </div>

                            <div className="md:col-span-2">
                                <label className="block text-sm font-bold text-slate-700 mb-2">内容营销风格</label>
                                <div className="grid grid-cols-3 gap-3 p-1.5 bg-slate-100/80 rounded-xl">
                                    {API_STYLES.map((style) => (
                                        <button
                                            key={style}
                                            onClick={() => setMarketingStyle(style)}
                                            className={`py-2 px-3 rounded-lg text-sm font-bold transition-all ${marketingStyle === style
                                                ? 'bg-white text-teal-600 shadow-sm border border-slate-200/60'
                                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                                                }`}
                                            disabled={loading}
                                        >
                                            {style === '种草风格' && '🌟 '}
                                            {style === '专业风格' && '👔 '}
                                            {style === '平价风格' && '💰 '}
                                            {style}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Panel: Results */}
                <div className="flex-1 flex flex-col w-full min-h-[600px] xl:min-h-0 xl:h-full bg-white rounded-3xl border border-slate-200/60 shadow-lg overflow-hidden relative">
                    {/* State: Empty */}
                    {!resultData && !loading && !error && (
                        <div className="flex-1 flex items-center justify-center flex-col text-slate-400 p-8 text-center bg-slate-50/50">
                            <div className="w-24 h-24 mb-6 rounded-3xl bg-teal-50 flex items-center justify-center rotate-12 -z-10 absolute opacity-50 blur-xl"></div>
                            <div className="w-20 h-20 mb-6 rounded-full bg-slate-100 flex items-center justify-center shadow-inner border border-slate-200/60">
                                <Globe className="w-10 h-10 text-slate-300" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-600 mb-2">等待生成本地化内容</h3>
                            <p className="max-w-sm text-sm leading-relaxed">请在左侧填写产品信息并选择目标市场属性，点击生成获取定制化的高转化电商营销文案。</p>
                            <div className="mt-6 flex items-start gap-2 text-amber-600 bg-amber-50 px-4 py-3 rounded-xl max-w-sm text-left border border-amber-100 shadow-sm">
                                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                                <p className="text-sm font-medium">温馨提示：该智能体执行逻辑较为复杂，每次运行大约需要等待 2~3 分钟，请耐心等待。</p>
                            </div>
                        </div>
                    )}

                    {/* State: Loading */}
                    {loading && (
                        <div className="flex-1 flex items-center justify-center flex-col p-8 bg-slate-50/50">
                            <div className="relative">
                                <div className="absolute inset-0 bg-teal-200 rounded-full blur-xl opacity-50 animate-pulse"></div>
                                <div className="w-16 h-16 bg-white rounded-2xl shadow-lg border border-slate-100 flex items-center justify-center relative animate-bounce">
                                    <RefreshCcw className="w-8 h-8 text-teal-600 animate-spin-slow" />
                                </div>
                            </div>
                            <h3 className="text-lg font-bold text-slate-700 mt-6 mb-2">AI 智能本地化翻译与润色中...</h3>
                            <p className="text-sm text-slate-500 animate-pulse">正在为您定制 {targetPlatform} 平台的专属 {marketingStyle} 方案</p>
                        </div>
                    )}

                    {/* State: Error */}
                    {error && !loading && (
                        <div className="flex-1 flex items-center justify-center p-8 bg-slate-50/50">
                            <div className="bg-rose-50 borderborder-rose-200 rounded-2xl p-6 text-center max-w-sm">
                                <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
                                <h3 className="text-rose-800 font-bold mb-1">内容生成失败</h3>
                                <p className="text-rose-600 text-sm">{error}</p>
                            </div>
                        </div>
                    )}

                    {/* State: Results */}
                    {resultData && !loading && (
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6 bg-slate-50/30">
                            <div className="flex items-center gap-3 pb-4 border-b border-slate-100 -mx-6 px-6 -mt-6 pt-6">
                                <div className="w-8 h-8 rounded-lg bg-teal-100 text-teal-600 flex items-center justify-center">
                                    <CheckCircle2 className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800">营销方案已生成</h3>
                                    <p className="text-xs text-slate-500 font-medium">针对 <strong>{targetLanguage}</strong> / <strong>{targetPlatform}</strong> 定制化适配</p>
                                </div>
                            </div>

                            {/* Result: SEO Titles */}
                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden group">
                                <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Type className="w-4 h-4 text-emerald-500" />
                                        <h4 className="font-bold text-slate-700 text-sm">高转化 SEO 标题组 (Top 5)</h4>
                                    </div>
                                    <button 
                                        onClick={() => toggleTranslation('seo')}
                                        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors font-bold ${showTranslations.seo ? 'bg-teal-100 border-teal-200 text-teal-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                                    >
                                        {showTranslations.seo ? '隐藏中文翻译' : '💡 显示中文翻译'}
                                    </button>
                                </div>
                                <div className="p-2 space-y-1">
                                    {resultData.seo_titles?.map((titleObj, index) => {
                                        const title = titleObj.original;
                                        return (
                                        <div key={index}
                                            onClick={() => setSelectedTitle(title)}
                                            className={`flex items-start gap-4 p-4 rounded-xl transition-colors group/item cursor-pointer border-2 ${selectedTitle === title ? 'border-teal-500 bg-teal-50/50 shadow-sm' : 'border-transparent hover:bg-slate-50'}`}>
                                            <div className={`w-7 h-7 rounded-lg font-black text-[11px] flex items-center justify-center shrink-0 border mt-0.5 ${selectedTitle === title ? 'bg-teal-500 text-white border-teal-600' : 'bg-white text-slate-400 border-slate-200 shadow-sm'}`}>
                                                0{index + 1}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-base font-bold leading-snug ${selectedTitle === title ? 'text-teal-900' : 'text-slate-800'}`}>{title}</p>
                                                <div className={`grid transition-all duration-300 ease-in-out ${showTranslations.seo && titleObj.translation ? 'grid-rows-[1fr] opacity-100 mt-2.5' : 'grid-rows-[0fr] opacity-0 mt-0'}`}>
                                                    <div className="overflow-hidden">
                                                        <div className="bg-slate-100/70 p-2.5 rounded-lg border border-slate-200 flex gap-2">
                                                            <div className="text-[10px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded font-bold shrink-0 self-start mt-0.5">中文</div>
                                                            <p className="text-sm text-slate-600 leading-relaxed font-medium">{titleObj.translation}</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleCopy(title, index); }}
                                                className="p-2 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors shrink-0"
                                                title="复制当前外文标题"
                                            >
                                                {copiedIndex === index ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5" />}
                                            </button>
                                        </div>
                                    )})}
                                </div>
                            </div>

                            {/* Result: E-commerce Listing */}
                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:h-[500px]">
                                <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between shrink-0">
                                    <div className="flex items-center gap-2">
                                        <ShoppingBag className="w-5 h-5 text-blue-600" />
                                        <h4 className="font-bold text-slate-800 text-sm">原生地道电商 Listing 主长文案</h4>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button 
                                            onClick={() => toggleTranslation('listing')}
                                            className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-all shadow-sm ${showTranslations.listing ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-blue-600'}`}
                                        >
                                            <Globe className="w-3.5 h-3.5" />
                                            {showTranslations.listing ? '隐藏中文对照' : '开启双语对照'}
                                        </button>
                                        <button
                                            onClick={() => handleCopy(resultData.ecommerce_listing.original, 99)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 border border-blue-700 text-white rounded-lg hover:bg-blue-700 transition-all text-xs font-bold shadow hover:shadow-md"
                                        >
                                            {copiedIndex === 99 ? <CheckCircle2 className="w-3.5 h-3.5 text-blue-200" /> : <Copy className="w-3.5 h-3.5" />}
                                            一键复制外文
                                        </button>
                                    </div>
                                </div>
                                <div className="flex flex-col md:flex-row overflow-hidden flex-1 bg-slate-50/50">
                                    <div className={`p-6 overflow-y-auto custom-scrollbar flex-1 relative transition-all duration-300 ${showTranslations.listing ? 'md:w-1/2 border-b md:border-b-0 md:border-r border-slate-200' : 'w-full'}`}>
                                        {showTranslations.listing && <div className="sticky top-0 float-right -mt-2 -mr-2 bg-blue-100/50 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold backdrop-blur-sm shadow-sm border border-blue-200/50 z-10">外文正式版</div>}
                                        <div className="prose prose-sm prose-slate max-w-none prose-p:leading-relaxed prose-li:my-1 prose-strong:text-slate-900 prose-strong:font-bold">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                                                {resultData.ecommerce_listing.original}
                                            </ReactMarkdown>
                                        </div>
                                    </div>
                                    {showTranslations.listing && (
                                        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 relative bg-blue-50/40 md:w-1/2 transition-all duration-300">
                                            <div className="sticky top-0 float-right -mt-2 -mr-2 bg-slate-200 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold backdrop-blur-sm shadow-sm border border-slate-300 z-10">中文释义</div>
                                            <div className="prose prose-sm prose-slate max-w-none prose-p:leading-relaxed prose-li:my-1 prose-strong:text-slate-800">
                                                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                                                    {resultData.ecommerce_listing.translation || '暂无翻译'}
                                                </ReactMarkdown>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Result: KOC Script */}
                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:h-[500px]">
                                <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between shrink-0">
                                    <div className="flex items-center gap-2">
                                        <Palette className="w-5 h-5 text-purple-600" />
                                        <h4 className="font-bold text-slate-800 text-sm">KOC 社媒种草视频脚本 (含时间轴)</h4>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button 
                                            onClick={() => toggleTranslation('koc')}
                                            className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-all shadow-sm ${showTranslations.koc ? 'bg-purple-100 border-purple-300 text-purple-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-purple-600'}`}
                                        >
                                            <Globe className="w-3.5 h-3.5" />
                                            {showTranslations.koc ? '隐藏中文对照' : '开启双语对照'}
                                        </button>
                                        <button
                                            onClick={() => handleCopy(resultData.koc_script.original, 100)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 border border-purple-700 text-white rounded-lg hover:bg-purple-700 transition-all text-xs font-bold shadow hover:shadow-md"
                                        >
                                            {copiedIndex === 100 ? <CheckCircle2 className="w-3.5 h-3.5 text-purple-200" /> : <Copy className="w-3.5 h-3.5" />}
                                            一键复制脚本
                                        </button>
                                    </div>
                                </div>
                                <div className="flex flex-col md:flex-row overflow-hidden flex-1 bg-slate-50/50">
                                    <div className={`p-6 overflow-y-auto custom-scrollbar flex-1 relative transition-all duration-300 ${showTranslations.koc ? 'md:w-1/2 border-b md:border-b-0 md:border-r border-slate-200' : 'w-full'}`}>
                                        {showTranslations.koc && <div className="sticky top-0 float-right -mt-2 -mr-2 bg-purple-100/50 text-purple-700 px-2 py-0.5 rounded text-[10px] font-bold backdrop-blur-sm shadow-sm border border-purple-200/50 z-10">外文口播版</div>}
                                        <div className="border-l-4 border-purple-300 pl-5 py-2">
                                            <div className="prose prose-sm prose-slate max-w-none prose-p:leading-relaxed prose-li:my-1 prose-strong:text-purple-900 prose-strong:font-bold">
                                                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                                                    {resultData.koc_script.original}
                                                </ReactMarkdown>
                                            </div>
                                        </div>
                                    </div>
                                    {showTranslations.koc && (
                                        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 relative bg-purple-50/40 md:w-1/2 transition-all duration-300">
                                            <div className="sticky top-0 float-right -mt-2 -mr-2 bg-slate-200 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold backdrop-blur-sm shadow-sm border border-slate-300 z-10">中文释义</div>
                                            <div className="border-l-4 border-slate-300 pl-5 py-2">
                                                <div className="prose prose-sm prose-slate max-w-none prose-p:leading-relaxed prose-li:my-1 prose-strong:text-slate-700">
                                                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                                                        {resultData.koc_script.translation || '暂无翻译'}
                                                    </ReactMarkdown>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Prototype Preview Section */}
                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col mt-4">
                                <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
                                    <div className="flex items-center gap-2">
                                        <LayoutTemplate className="w-4 h-4 text-orange-500" />
                                        <h4 className="font-bold text-slate-700 text-sm">本地化平台卡片预览 ({resultData.platform})</h4>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold text-slate-500">选择模板：</span>
                                        <select
                                            value={selectedTemplate}
                                            onChange={(e) => setSelectedTemplate(e.target.value)}
                                            className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500/50 font-bold text-slate-700 bg-white shadow-sm cursor-pointer"
                                        >
                                            {resultData.platform === 'Shopee' && (
                                                <>
                                                    <option>Shopee 标准版</option>
                                                    <option>Shopee 大促版</option>
                                                </>
                                            )}
                                            {resultData.platform === 'Lazada' && (
                                                <>
                                                    <option>Lazada 简约版</option>
                                                    <option>Lazada 详情版</option>
                                                </>
                                            )}
                                            {resultData.platform === 'TikTok' && (
                                                <>
                                                    <option>TikTok 商品卡版</option>
                                                    <option>TikTok 短视频封面版</option>
                                                </>
                                            )}
                                        </select>
                                    </div>
                                </div>
                                <div className="p-6 bg-slate-100/50 flex justify-center items-center py-12">
                                    {/* Inline Render logic for Preview Card */}
                                    {(() => {
                                        const t = selectedTemplate;
                                        const title = selectedTitle;
                                        const listing = resultData.ecommerce_listing.original;

                                        if (t.includes('Shopee')) {
                                            return (
                                                <div className="w-[320px] bg-white rounded-md shadow-md overflow-hidden font-sans border border-slate-200 hover:shadow-lg transition-shadow">
                                                    <div className="h-48 bg-slate-100 relative flex items-center justify-center text-slate-400">
                                                        <ShoppingBag className="w-8 h-8 opacity-20" />
                                                        {t === 'Shopee 大促版' && (
                                                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-r from-orange-500 to-red-500 text-white text-xs font-bold px-2 py-1">
                                                                🔥 Mega Sale - Diskon s/d 50%
                                                            </div>
                                                        )}
                                                        {!t.includes('大促版') && (
                                                            <div className="absolute top-2 left-2 bg-white text-orange-500 border border-orange-500 text-[10px] px-1 font-bold">100% ORI</div>
                                                        )}
                                                    </div>
                                                    <div className="p-3">
                                                        <div className="text-sm text-slate-800 line-clamp-2 leading-snug">
                                                            <span className="bg-[#ee4d2d] text-white text-[10px] px-1 py-0.5 rounded-sm mr-1.5 font-bold">Shopee Mall</span>
                                                            {title}
                                                        </div>
                                                        <div className="mt-2 text-[#ee4d2d] font-bold text-lg">Rp 99.000</div>
                                                        <div className="flex flex-wrap gap-1 mt-2">
                                                            <span className="text-[10px] border border-[#ee4d2d] text-[#ee4d2d] px-1 py-0.5">Gratis Ongkir</span>
                                                            <span className="text-[10px] bg-[#fdf4f4] text-[#ee4d2d] px-1 py-0.5">Cashback 5%</span>
                                                        </div>
                                                        <div className="mt-3 text-[11px] text-slate-500 line-clamp-3">
                                                            {listing.length > 50 ? listing.substring(0, 100) + '...' : listing}
                                                        </div>
                                                        <button className="w-full mt-3 bg-[#ee4d2d] text-white font-bold py-2 rounded text-sm hover:opacity-90 transition-opacity shadow-sm">
                                                            Beli Sekarang
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        }
                                        if (t.includes('Lazada')) {
                                            return (
                                                <div className="w-[320px] bg-[#eff0f5] p-2 rounded-md overflow-hidden font-sans hover:shadow-lg transition-shadow">
                                                    <div className="bg-white rounded-lg overflow-hidden shadow-sm border border-slate-100/50">
                                                        <div className="h-48 bg-slate-100 flex items-center justify-center text-slate-400 relative">
                                                            <ShoppingBag className="w-8 h-8 opacity-20" />
                                                            {t === 'Lazada 详情版' && (
                                                                <div className="absolute top-0 left-0 bg-indigo-600 text-white text-[10px] px-2 py-1 rounded-br-lg font-bold">
                                                                    LazMall
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="p-3">
                                                            <div className="mt-1 text-indigo-600 font-bold text-xl">Rp 89.000</div>
                                                            <div className="text-xs text-slate-400 line-through mb-1">Rp 150.000</div>
                                                            <div className="text-sm font-medium text-slate-800 line-clamp-2 leading-snug">
                                                                {title}
                                                            </div>

                                                            {t === 'Lazada 详情版' && (
                                                                <div className="mt-3 text-[11px] text-slate-600 border-t border-slate-100 pt-2 line-clamp-4">
                                                                    {listing.substring(0, 150)}...
                                                                </div>
                                                            )}

                                                            <button className="w-full mt-4 bg-gradient-to-r from-[#f53d2d] to-[#ff6b00] text-white font-bold py-2 rounded-lg text-sm hover:opacity-90 shadow-sm shadow-orange-500/20">
                                                                Tambah ke Troli
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        }
                                        if (t.includes('TikTok')) {
                                            const isVideo = t === 'TikTok 短视频封面版';
                                            return (
                                                <div className="w-[320px] bg-black rounded-[2rem] shadow-2xl overflow-hidden flex flex-col font-sans text-white h-[600px] relative border-[6px] border-slate-800 hover:shadow-cyan-900/40 transition-shadow">
                                                    <div className="absolute inset-0 bg-gradient-to-b from-slate-800 to-slate-900 flex flex-col items-center justify-center text-slate-500">
                                                        {isVideo ? <Palette className="w-12 h-12 opacity-20" /> : <ShoppingBag className="w-12 h-12 opacity-20" />}
                                                    </div>

                                                    {/* 顶栏 */}
                                                    <div className="absolute top-8 left-4 right-4 flex justify-center z-10">
                                                        <span className="font-bold text-sm text-shadow flex gap-4">
                                                            <span className="text-white/60">Following</span>
                                                            <span className="text-white border-b-2 border-white pb-1">For You</span>
                                                        </span>
                                                    </div>

                                                    {/* 侧边互动区 */}
                                                    <div className="absolute right-3 bottom-32 flex flex-col gap-5 items-center z-10">
                                                        <div className="w-10 h-10 rounded-full bg-slate-300 border border-white"></div>
                                                        <div className="flex flex-col items-center gap-1"><div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">❤️</div><span className="text-[10px] font-bold">12.5K</span></div>
                                                        <div className="flex flex-col items-center gap-1"><div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">💬</div><span className="text-[10px] font-bold">148</span></div>
                                                        <div className="flex flex-col items-center gap-1"><div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">↗️</div><span className="text-[10px] font-bold">Share</span></div>
                                                    </div>

                                                    {/* 底部信息区 */}
                                                    <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent z-10 pb-8">
                                                        <h3 className="font-bold text-sm mb-1.5 flex items-center gap-1">@BeautyCreator <CheckCircle2 className="w-3 h-3 text-sky-400" /></h3>
                                                        <p className="text-sm line-clamp-2 leading-snug mb-3 font-medium text-white/90">
                                                            {title} <span className="text-sky-300">#beauty #makeup #foryou</span>
                                                        </p>

                                                        {/* 购物车卡片 */}
                                                        {!isVideo && (
                                                            <div className="bg-white/95 backdrop-blur rounded-lg p-2.5 flex gap-3 items-center text-black mb-2 relative shadow-lg">
                                                                <div className="absolute -top-2 left-2 bg-rose-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">TikTok Shop</div>
                                                                <div className="w-14 h-14 bg-slate-100 rounded shrink-0 flex items-center justify-center border border-slate-200">
                                                                    <ShoppingBag className="w-5 h-5 text-slate-300" />
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="text-xs font-bold truncate text-slate-800">Special Bundle Offer</div>
                                                                    <div className="text-[10px] text-slate-500 truncate line-clamp-1 mt-0.5">{listing.substring(0, 40)}...</div>
                                                                    <div className="text-rose-500 font-bold text-sm mt-1">Rp 79.000</div>
                                                                </div>
                                                                <button className="bg-rose-500 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-rose-600 transition-colors shadow-sm">Buy</button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return null;
                                    })()}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
