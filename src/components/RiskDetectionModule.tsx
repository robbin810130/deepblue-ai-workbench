import React, { useState, useMemo } from 'react';
import {
    ShieldCheck, ShoppingCart, FlaskConical, HelpCircle,
    ChevronDown, Image as ImageIcon, FileText, Upload,
    CheckCircle2, AlertTriangle, AlertCircle, Info, Download, FileBadge, ShieldAlert, ArrowLeft
} from 'lucide-react';

// Mock Config Data
const REGION_OPTIONS = ['国内', '美国'];
const RND_INDUSTRY_OPTIONS = ['化妆品', '食品', '保健品', '矿类'];

export const RiskDetectionModule: React.FC = () => {
    const [view, setView] = useState<'entry' | 'ecommerce' | 'rnd' | 'result'>('entry');
    const [loading, setLoading] = useState(false);

    // Form States
    const [region, setRegion] = useState('');
    const [industry, setIndustry] = useState('');

    // Ecommerce specifics
    const [ecomDetectionType, setEcomDetectionType] = useState<'image' | 'text'>('image');
    const [ecomImage, setEcomImage] = useState<string | null>(null);
    const [ecomFile, setEcomFile] = useState<File | null>(null);
    const [ecomTitle, setEcomTitle] = useState('');
    const [ecomDesc, setEcomDesc] = useState('');

    // R&D specifics
    const [rndDetectionType, setRndDetectionType] = useState<'image' | 'document' | 'text'>('image');
    const [rndImage, setRndImage] = useState<string | null>(null);
    const [rndImageFile, setRndImageFile] = useState<File | null>(null);
    const [rndFile, setRndFile] = useState<File | null>(null);
    const [rndText, setRndText] = useState('');

    // Result States
    const [resultTab, setResultTab] = useState<'overview' | 'details' | 'law'>('overview');
    const [exporting, setExporting] = useState(false);
    const [lastDetectionSource, setLastDetectionSource] = useState<'ecommerce' | 'rnd'>('ecommerce');
    const [auditReport, setAuditReport] = useState<string | null>(null);
    const [detectionTime, setDetectionTime] = useState('');

    const runDetection = async (source: 'ecommerce' | 'rnd') => {
        setLoading(true);
        setLastDetectionSource(source);

        if (source === 'ecommerce') {
            try {
                const token = localStorage.getItem('blue_os_token') || '';

                // === 严格隔离：仅传送用户当前选择的检测类型对应数据 ===
                let fileId: string | null = null;
                let sendTitle = '';
                let sendDesc = '';

                if (ecomDetectionType === 'image') {
                    // 图片模式：只上传图片，丢弃所有文本
                    if (!ecomFile) throw new Error('请先上传商品图片');
                    const formData = new FormData();
                    formData.append('file', ecomFile);
                    const uploadRes = await fetch('/api/risk-detection/ecommerce/upload', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}` },
                        body: formData
                    });
                    const uploadData = await uploadRes.json();
                    if (!uploadData.success) throw new Error(uploadData.message || '图片上传中转失败');
                    fileId = uploadData.file_id;
                    // 文本字段明确置空
                    sendTitle = '';
                    sendDesc = '';
                } else {
                    // 文本模式：只传文本，不传图片（fileId 保持 null）
                    sendTitle = ecomTitle;
                    sendDesc = ecomDesc;
                    fileId = null;
                }

                const runRes = await fetch('/api/risk-detection/ecommerce/run', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        country: region,
                        industry,
                        detectionType: ecomDetectionType,
                        title: sendTitle,
                        description: sendDesc,
                        fileId  // 文本模式下为 null，后端会忽略
                    })
                });

                const runData = await runRes.json();
                if (!runData.success) throw new Error(runData.message || '工作流调用失败');

                setAuditReport(runData.data);
                setDetectionTime(new Date().toLocaleString('zh-CN', { hour12: false }));
                setView('result');
                setResultTab('overview');
                // 通知任务栏 + 系统消息：电商广告法检测已完成
                window.dispatchEvent(new CustomEvent('app-task-done', { detail: { appId: 'riskdetection' } }));
            } catch (err: any) {
                alert('检测出错: ' + err.message);
            } finally {
                setLoading(false);
            }
        } else {
            try {
                const token = localStorage.getItem('blue_os_token') || '';

                // === 严格隔离：仅传送用户当前选择的配方输入方式 ===
                let fileId: string | null = null;
                let sendIngredientText = '';

                if (rndDetectionType === 'image') {
                    // 图片模式：只上传配方图片，丢弃文档和文本
                    if (!rndImageFile) throw new Error('请先上传配方图片');
                    const formData = new FormData();
                    formData.append('file', rndImageFile);
                    const uploadRes = await fetch('/api/risk-detection/rnd/upload', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}` },
                        body: formData
                    });
                    const uploadData = await uploadRes.json();
                    if (!uploadData.success) throw new Error(uploadData.message || '图片上传转译失败');
                    fileId = uploadData.file_id;
                    sendIngredientText = '';  // 明确不传文本

                } else if (rndDetectionType === 'document') {
                    // 文档模式：只上传配方文档，丢弃图片和文本
                    if (!rndFile) throw new Error('请先上传配方说明文档');
                    const formData = new FormData();
                    formData.append('file', rndFile);
                    const uploadRes = await fetch('/api/risk-detection/rnd/upload', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}` },
                        body: formData
                    });
                    const uploadData = await uploadRes.json();
                    if (!uploadData.success) throw new Error(uploadData.message || '文档上传转译失败');
                    fileId = uploadData.file_id;
                    sendIngredientText = '';  // 明确不传文本

                } else {
                    // 文本模式：只传成分文本，不上传任何文件
                    if (!rndText.trim()) throw new Error('请输入配方成分内容');
                    sendIngredientText = rndText;
                    fileId = null;  // 明确不传文件
                }

                const runRes = await fetch('/api/risk-detection/rnd/run', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        country: region,
                        industry,
                        detectionType: rndDetectionType,
                        ingredient_text: sendIngredientText,  // 文件模式下为空字符串
                        fileId  // 文本模式下为 null
                    })
                });

                const runData = await runRes.json();
                if (!runData.success) throw new Error(runData.message || '配方法规检测失败');

                setAuditReport(runData.data);
                setDetectionTime(new Date().toLocaleString('zh-CN', { hour12: false }));
                setView('result');
                setResultTab('overview');
                // 通知任务栏 + 系统消息：配方法规检测已完成
                window.dispatchEvent(new CustomEvent('app-task-done', { detail: { appId: 'riskdetection' } }));
            } catch (err: any) {
                alert('检测出错: ' + err.message);
            } finally {
                setLoading(false);
            }
        }
    };


    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'document', source: 'ecom' | 'rnd' = 'ecom') => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (type === 'image') {
            if (!file.type.startsWith('image/')) {
                alert('格式错误，请上传JPG/PNG格式');
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                alert('单张图片不超过5MB');
                return;
            }
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (source === 'rnd') {
                    setRndImage(ev.target?.result as string);
                    setRndImageFile(file);
                } else {
                    setEcomImage(ev.target?.result as string);
                    setEcomFile(file);
                }
            };
            reader.readAsDataURL(file);
        } else {
            if (!file.name.match(/\.(doc|docx|pdf)$/i)) {
                alert('格式错误，请上传Word/PDF格式');
                return;
            }
            if (file.size > 10 * 1024 * 1024) {
                alert('单个文件不超过10MB');
                return;
            }
            setRndFile(file);
        }
    };

    const isEcomReady = region && industry && (ecomDetectionType === 'image' ? ecomImage !== null : (ecomTitle.length > 0 || ecomDesc.length > 0));
    const isRndReady = region && industry && (rndDetectionType === 'image' ? rndImage !== null : (rndDetectionType === 'document' ? rndFile !== null : rndText.length > 0));

    const handleExport = () => {
        setExporting(true);
        setTimeout(() => {
            setExporting(false);
            alert('报告已导出至本地');
        }, 1500);
    };

    const parsedData = useMemo(() => {
        if (!auditReport) return { issues: [], laws: [], isPassed: false, passedCount: 0, highRisk: 0, mediumRisk: 0 };

        const cleanReport = auditReport.replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/gi, '').trim();

        function extractBlocks(text: string, level: string) {
            const startTag = `[[AUDIT_BLOCK_START_${level}]]`;
            const endTag = `[[AUDIT_BLOCK_END_${level}]]`;
            const regex = new RegExp(`${startTag.replace(/\[/g, '\\[').replace(/\]/g, '\\]')}([\\s\\S]*?)${endTag.replace(/\[/g, '\\[').replace(/\]/g, '\\]')}`, 'g');

            let matches;
            const results = [];
            while ((matches = regex.exec(text)) !== null) {
                results.push(matches[1].trim());
            }
            return results;
        }

        const highRisksText = extractBlocks(cleanReport, 'HIGH');
        const mediumRisksText = extractBlocks(cleanReport, 'MEDIUM');
        const passedItemsText = extractBlocks(cleanReport, 'PASS');

        const issues: Array<{ content: string, problem: string, suggestion: string, law: string, level: string, color: string }> = [];
        const lawsMap = new Map<string, { name: string, area: string, term: string }>();

        const parseBlock = (text: string, levelLabel: string, color: string) => {
            const contentMatch = text.match(/\*\*(?:原文内容|原文|风险成分|限用成分)\*\*[:：]?\s*([^]*?)(?=\n\s*- \*\*|$)/);
            let content = contentMatch ? contentMatch[1].trim() : '';
            content = content.replace(/^"|"$/g, '').trim();

            const problemMatch = text.match(/\*\*(?:涉及问题|审核结论|违规判定)\*\*[:：]?\s*([^]*?)(?=\n\s*- \*\*|$)/);
            const problem = problemMatch ? problemMatch[1].trim() : '';

            // Support both formats for law:
            // 1. Heading format: "### 法规依据\n《...》"
            // 2. Bullet format:  "- **法规依据**：《...》"
            let law = '';
            const lawHeadingParts = text.split('### 法规依据');
            if (lawHeadingParts.length > 1) {
                law = lawHeadingParts[1].trim();
            } else {
                const lawBulletMatch = text.match(/\*\*法规依据\*\*[:：]?\s*([^]*?)(?=\n\s*- \*\*|\[\[AUDIT|$)/);
                if (lawBulletMatch) law = lawBulletMatch[1].trim();
            }

            // R&D format: 修改建议 comes AFTER 法规依据, so search without law boundary
            // Ecom format: 修改建议/合规建议 comes BEFORE ### 法规依据
            // Strategy: try 修改建议/处理建议 first (can appear anywhere in block),
            //           then fall back to 合规建议, then 限制详情 (before law only)
            let suggestion = '';
            const modifyMatch = text.match(/\*\*(?:修改建议|处理建议)\*\*[:：]?\s*([^]*?)(?=\n\s*- \*\*|\[\[AUDIT|$)/);
            if (modifyMatch) {
                suggestion = modifyMatch[1].trim();
            } else {
                const complianceMatch = text.match(/\*\*合规建议\*\*[:：]?\s*([^]*?)(?=\n\s*- \*\*法规依据|\n\s*###|\[\[AUDIT|$)/);
                const limitMatch = text.match(/\*\*限制详情\*\*[:：]?\s*([^]*?)(?=\n\s*- \*\*法规依据|\n\s*###|\[\[AUDIT|$)/);
                suggestion = (complianceMatch?.[1] || limitMatch?.[1] || '').trim();
            }

            issues.push({ content, problem, suggestion, law, level: levelLabel, color });

            if (law) {
                const lawNameMatch = law.match(/(《[^》]+》[^,，\n]*)/);
                const lawName = lawNameMatch ? lawNameMatch[1].trim() : law.split('\n')[0].trim();
                lawsMap.set(lawName, { name: lawName, area: region || '未知', term: law });
            }
        };

        highRisksText.forEach(block => parseBlock(block, '高风险', 'red'));
        mediumRisksText.forEach(block => parseBlock(block, '中风险', 'amber'));

        // passedCount = 实际合规项数量（PASS块数）
        const passedCount = passedItemsText.length;
        // isPassed = 只有高/中风险均为0，才认为整体完全合规
        let isPassed = highRisksText.length === 0 && mediumRisksText.length === 0;
        if (!isPassed && passedCount === 0) {
            // fallback：无任何块但文字中包含合规表述
            isPassed = cleanReport.includes('完全合规') || cleanReport.includes('检测通过');
        }

        return {
            issues,
            laws: Array.from(lawsMap.values()),
            isPassed,
            passedCount,
            highRisk: highRisksText.length,
            mediumRisk: mediumRisksText.length
        };
    }, [auditReport, region]);

    return (
        <div className="flex h-full w-full bg-slate-50 font-sans text-slate-800 overflow-hidden">
            {/* Sidebar Navigation */}
            <aside className="w-[240px] shrink-0 bg-white border-r border-slate-200 flex flex-col z-20 shadow-[2px_0_10px_rgba(0,0,0,0.02)]">
                <div className="p-5 flex flex-col pt-6 pb-6 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-md flex items-center justify-center shrink-0">
                            <ShieldCheck className="w-5 h-5 text-white" />
                        </div>
                        <h1 className="text-lg font-bold text-slate-800 tracking-tight">合规检测系统</h1>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1 custom-scrollbar">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-3 mb-2 mt-2">功能导航</div>



                    <button
                        onClick={() => setView('ecommerce')}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all ${view === 'ecommerce' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
                    >
                        <ShoppingCart className={`w-4 h-4 ${view === 'ecommerce' ? 'text-blue-500' : 'text-slate-400'}`} />
                        电商广告法检测
                    </button>

                    <button
                        onClick={() => setView('rnd')}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all ${view === 'rnd' ? 'bg-green-50 text-green-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
                    >
                        <FlaskConical className={`w-4 h-4 ${view === 'rnd' ? 'text-green-500' : 'text-slate-400'}`} />
                        配方法规检测
                    </button>

                    {(view === 'result' || import.meta.env.DEV) && (
                        <>
                            <div className="my-3 border-t border-slate-100" />
                            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-3 mb-2 mt-2">检测分析</div>
                            <button
                                onClick={() => setView('result')}
                                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all ${view === 'result' ? 'bg-slate-100 text-slate-800 shadow-inner' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
                            >
                                <FileBadge className={`w-4 h-4 ${view === 'result' ? 'text-slate-600' : 'text-slate-400'}`} />
                                最新检测结果
                            </button>
                        </>
                    )}
                </div>

                <div className="p-4 border-t border-slate-100 bg-slate-50/50">
                    <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-start gap-3 shadow-sm cursor-pointer hover:border-slate-300 transition-colors">
                        <div className="p-1.5 bg-indigo-50 rounded-lg shrink-0">
                            <Info className="w-4 h-4 text-indigo-500" />
                        </div>
                        <div>
                            <div className="text-[13px] font-bold text-slate-700 mb-0.5">法规知识库</div>
                            <div className="text-[11px] text-slate-500 leading-snug font-medium">涵盖最新欧美、中东等海外合规政策法规解读...</div>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 overflow-hidden bg-[#F8FAFC] custom-scrollbar relative flex flex-col">
                {loading && (
                    <div className="absolute inset-0 bg-white/70 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
                        <div className="w-16 h-16 rounded-full border-4 border-slate-200 border-t-blue-500 animate-spin mb-4" />
                        <div className="text-xl font-bold tracking-widest text-slate-700 mb-2">检测中，请稍候</div>
                        <div className="text-slate-500 font-medium text-sm">正在深度解析内容并匹配全球法规库...</div>
                    </div>
                )}

                {/* === VIEW: Entry === */}
                {view === 'entry' && (
                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        <div className="max-w-5xl mx-auto px-8 py-10">
                            <div className="text-center mb-12 mt-8">
                                <h2 className="text-3xl font-black text-slate-800 tracking-tight mb-3">风险检测导览</h2>
                                <p className="text-slate-500 font-medium text-[15px]">选择对应场景板块，全方位排查产品内容与配方的合规风险</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* Ecommerce Card */}
                                <div
                                    onClick={() => setView('ecommerce')}
                                    className="group relative bg-[#E3F2FD] rounded-[2rem] p-8 pb-10 cursor-pointer overflow-hidden border-2 border-transparent hover:border-blue-200 hover:shadow-[0_20px_40px_-15px_rgba(37,99,235,0.15)] transition-all duration-300 transform hover:-translate-y-1"
                                >
                                    <div className="absolute right-0 top-0 translate-x-1/4 -translate-y-1/4 opacity-20 pointer-events-none group-hover:scale-110 transition-transform duration-500">
                                        <ShoppingCart className="w-64 h-64 text-blue-500" />
                                    </div>
                                    <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-6 relative z-10 border border-blue-100">
                                        <ShoppingCart className="w-8 h-8 text-blue-600" />
                                    </div>
                                    <h3 className="text-2xl font-black text-slate-800 mb-3 relative z-10">电商板块</h3>
                                    <p className="text-slate-600 font-medium leading-relaxed mb-8 relative z-10 max-w-[85%]">
                                        对电商商品的宣发图片、广告海报、商品标题及详情描述进行深度图文解析，排查是否违背目标区域广告法或存在敏感禁词。
                                    </p>
                                    <button className="bg-blue-600 text-white font-bold py-3 px-8 rounded-xl hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-lg shadow-blue-600/30 relative z-10 text-[15px]">
                                        立即检测
                                    </button>
                                </div>

                                {/* R&D Card */}
                                <div
                                    onClick={() => setView('rnd')}
                                    className="group relative bg-[#E8F5E9] rounded-[2rem] p-8 pb-10 cursor-pointer overflow-hidden border-2 border-transparent hover:border-green-200 hover:shadow-[0_20px_40px_-15px_rgba(34,197,94,0.15)] transition-all duration-300 transform hover:-translate-y-1"
                                >
                                    <div className="absolute right-0 top-0 translate-x-1/4 -translate-y-1/4 opacity-20 pointer-events-none group-hover:scale-110 transition-transform duration-500">
                                        <FlaskConical className="w-64 h-64 text-green-600" />
                                    </div>
                                    <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-6 relative z-10 border border-green-100">
                                        <FlaskConical className="w-8 h-8 text-green-600" />
                                    </div>
                                    <h3 className="text-2xl font-black text-slate-800 mb-3 relative z-10">研发板块</h3>
                                    <p className="text-slate-600 font-medium leading-relaxed mb-8 relative z-10 max-w-[85%]">
                                        检测产品配方表、BOM图纸等文档中的成分明细，依据海量官方标准判定其比例、成分构成是否存在行业合规性隐患。
                                    </p>
                                    <button className="bg-emerald-600 text-white font-bold py-3 px-8 rounded-xl hover:bg-emerald-700 active:bg-emerald-800 transition-colors shadow-lg shadow-emerald-600/30 relative z-10 text-[15px]">
                                        立即检测
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* === VIEW: Ecommerce === */}
                {view === 'ecommerce' && (
                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col min-h-full">
                            <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-200">
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => setView('entry')}
                                        className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 transition-colors"
                                        title="返回板块选择"
                                    >
                                        <ArrowLeft className="w-6 h-6" />
                                    </button>
                                    <div>
                                        <h2 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
                                            <ShoppingCart className="w-6 h-6 text-blue-500" /> 电商板块 - 广告法风险检测
                                        </h2>
                                        <p className="text-slate-500 text-sm font-medium mt-1">上传电商物料或文案，规避下架封号风险</p>
                                    </div>
                                </div>
                                <div className="group relative cursor-help flex items-center gap-1.5 text-slate-500 hover:text-blue-500 transition-colors bg-white px-3 py-1.5 rounded-full border border-slate-200 shadow-sm text-sm font-medium">
                                    <HelpCircle className="w-4 h-4" /> 操作指引
                                    <div className="absolute right-0 top-full mt-2 w-64 bg-slate-800 text-white text-xs p-3 rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all pointer-events-none z-50 leading-relaxed font-normal">
                                        请上传商品图片或输入标题/描述，选择对应地区和行业，发起检测。
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm mb-6 pb-8">
                                <h3 className="text-[15px] font-bold text-slate-800 flex items-center gap-2 mb-4 border-l-4 border-blue-500 pl-3">
                                    基础参数配置
                                </h3>
                                <div className="grid grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-[13px] font-bold text-slate-700 mb-2">目标国家/地区 <span className="text-red-500">*</span></label>
                                        <div className="relative">
                                            <select
                                                value={region} onChange={e => setRegion(e.target.value)}
                                                className="w-full appearance-none bg-slate-50 border border-slate-200 px-4 py-2.5 rounded-xl text-[14px] font-medium text-slate-700 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                            >
                                                <option value="" disabled>请选择目标地区</option>
                                                {REGION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                            </select>
                                            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-[13px] font-bold text-slate-700 mb-2">所属行业 <span className="text-red-500">*</span></label>
                                        <div className="relative">
                                            <select
                                                value={industry} onChange={e => setIndustry(e.target.value)}
                                                className="w-full appearance-none bg-slate-50 border border-slate-200 px-4 py-2.5 rounded-xl text-[14px] font-medium text-slate-700 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                            >
                                                <option value="" disabled>请选择所属行业</option>
                                                {RND_INDUSTRY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                            </select>
                                            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex-1 flex flex-col mb-6">
                                <h3 className="text-[15px] font-bold text-slate-800 flex items-center gap-2 mb-5 border-l-4 border-blue-500 pl-3">
                                    检测对象选择与录入
                                </h3>
                                <div className="flex items-center gap-8 mb-6">
                                    <label className="flex items-center gap-2.5 cursor-pointer group" onClick={() => setEcomDetectionType('image')}>
                                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${ecomDetectionType === 'image' ? 'border-blue-500' : 'border-slate-300 group-hover:border-blue-400'}`}>
                                            {ecomDetectionType === 'image' && <div className="w-2.5 h-2.5 bg-blue-500 rounded-full" />}
                                        </div>
                                        <span className={`font-bold transition-colors ${ecomDetectionType === 'image' ? 'text-blue-700' : 'text-slate-600'}`}>商品图片检测</span>
                                    </label>
                                    <label className="flex items-center gap-2.5 cursor-pointer group" onClick={() => setEcomDetectionType('text')}>
                                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${ecomDetectionType === 'text' ? 'border-blue-500' : 'border-slate-300 group-hover:border-blue-400'}`}>
                                            {ecomDetectionType === 'text' && <div className="w-2.5 h-2.5 bg-blue-500 rounded-full" />}
                                        </div>
                                        <span className={`font-bold transition-colors ${ecomDetectionType === 'text' ? 'text-blue-700' : 'text-slate-600'}`}>商品标题+描述检测</span>
                                    </label>
                                </div>

                                {ecomDetectionType === 'image' && (
                                    <div className="flex-1 min-h-[220px]">
                                        {ecomImage ? (
                                            <div className="relative w-full max-w-sm rounded-xl overflow-hidden border border-slate-200 group">
                                                <img src={ecomImage} alt="preview" className="w-full h-auto object-cover" />
                                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                                    <button onClick={() => setEcomImage(null)} className="bg-red-500 text-white px-4 py-2 rounded-lg font-bold text-sm shadow-md hover:bg-red-600">删除重传</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="border-2 border-dashed border-blue-200 hover:border-blue-400 hover:bg-blue-50/50 bg-slate-50 transition-all rounded-2xl flex-1 h-full flex flex-col items-center justify-center py-16 cursor-pointer relative overflow-hidden group">
                                                <input type="file" accept="image/png, image/jpeg" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => handleFileUpload(e, 'image')} />
                                                <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                                    <ImageIcon className="w-8 h-8 text-blue-500" />
                                                </div>
                                                <p className="text-slate-700 font-bold mb-1">点击或拖拽上传一张图片</p>
                                                <p className="text-slate-400 text-xs font-medium">支持 JPG、PNG 格式，单张不超过 5MB</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {ecomDetectionType === 'text' && (
                                    <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                        <div>
                                            <div className="flex items-center justify-between mb-1.5">
                                                <label className="text-[13px] font-bold text-slate-700">商品标题</label>
                                                <span className={`text-[11px] font-bold ${ecomTitle.length > 100 ? 'text-red-500' : 'text-slate-400'}`}>{ecomTitle.length}/100</span>
                                            </div>
                                            <input
                                                value={ecomTitle} onChange={e => setEcomTitle(e.target.value)}
                                                placeholder="请输入商品标题..."
                                                className={`w-full px-4 py-2.5 bg-slate-50 border rounded-xl font-medium text-slate-700 focus:outline-none focus:ring-2 focus:bg-white placeholder-slate-400 transition-all ${ecomTitle.length > 100 ? 'border-red-400 ring-red-100 focus:ring-red-100' : 'border-slate-200 focus:border-blue-400 focus:ring-blue-100'}`}
                                            />
                                        </div>
                                        <div>
                                            <div className="flex items-center justify-between mb-1.5">
                                                <label className="text-[13px] font-bold text-slate-700">宣传描述</label>
                                                <span className={`text-[11px] font-bold ${ecomDesc.length > 500 ? 'text-red-500' : 'text-slate-400'}`}>{ecomDesc.length}/500</span>
                                            </div>
                                            <textarea
                                                value={ecomDesc} onChange={e => setEcomDesc(e.target.value)}
                                                placeholder="请输入商品宣发物料中的描述文案内容..."
                                                rows={6}
                                                className={`w-full px-4 py-3 bg-slate-50 border rounded-xl font-medium text-slate-700 focus:outline-none focus:ring-2 focus:bg-white placeholder-slate-400 resize-y min-h-[120px] transition-all ${ecomDesc.length > 500 ? 'border-red-400 ring-red-100 focus:ring-red-100' : 'border-slate-200 focus:border-blue-400 focus:ring-blue-100'}`}
                                            />
                                        </div>
                                    </div>
                                )}

                            </div>

                            <div className="flex items-center justify-between mt-auto">
                                <span className="text-xs text-slate-400 font-medium"></span>
                                <div className="flex items-center gap-4">
                                    <span className="text-xs text-slate-500 font-medium underline underline-offset-2 cursor-pointer hover:text-blue-500">
                                        阅读检测须知
                                    </span>
                                    <button
                                        disabled={!isEcomReady}
                                        onClick={() => runDetection('ecommerce')}
                                        className={`w-[140px] py-2.5 rounded-xl font-black text-sm transition-all shadow-md ${isEcomReady ? 'bg-blue-600 text-white hover:bg-blue-700 hover:-translate-y-0.5 hover:shadow-lg shadow-blue-600/30' : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'}`}
                                    >
                                        发起检测
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* === VIEW: R&D === */}
                {view === 'rnd' && (
                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col min-h-full">
                            <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-200">
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => setView('entry')}
                                        className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 transition-colors"
                                        title="返回板块选择"
                                    >
                                        <ArrowLeft className="w-6 h-6" />
                                    </button>
                                    <div>
                                        <h2 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
                                            <FlaskConical className="w-6 h-6 text-green-600" /> 研发板块 - 配方法规风险检测
                                        </h2>
                                        <p className="text-slate-500 text-sm font-medium mt-1">检测产品配方文档或图纸成分的合规禁忌</p>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm mb-6">
                                <h3 className="text-[15px] font-bold text-slate-800 flex items-center gap-2 mb-4 border-l-4 border-green-500 pl-3">
                                    基础参数配置
                                </h3>
                                <div className="grid grid-cols-2 gap-5">
                                    <div>
                                        <label className="block text-[13px] font-bold text-slate-700 mb-2">目标国家/地区 <span className="text-red-500">*</span></label>
                                        <div className="relative">
                                            <select
                                                value={region} onChange={e => setRegion(e.target.value)}
                                                className="w-full appearance-none bg-slate-50 border border-slate-200 px-3 py-2.5 rounded-xl text-[14px] font-medium text-slate-700 focus:outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100"
                                            >
                                                <option value="" disabled>请选择目标地区</option>
                                                {REGION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                            </select>
                                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-[13px] font-bold text-slate-700 mb-2">所属行业 <span className="text-red-500">*</span></label>
                                        <div className="relative">
                                            <select
                                                value={industry} onChange={e => setIndustry(e.target.value)}
                                                className="w-full appearance-none bg-slate-50 border border-slate-200 px-3 py-2.5 rounded-xl text-[14px] font-medium text-slate-700 focus:outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100"
                                            >
                                                <option value="" disabled>选择行业大类</option>
                                                {RND_INDUSTRY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                            </select>
                                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex-1 flex flex-col mb-6">
                                <h3 className="text-[15px] font-bold text-slate-800 flex items-center gap-2 mb-5 border-l-4 border-green-500 pl-3">
                                    配方资料上传
                                </h3>
                                <div className="flex items-center gap-8 mb-6">
                                    <label className="flex items-center gap-2.5 cursor-pointer group" onClick={() => setRndDetectionType('image')}>
                                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${rndDetectionType === 'image' ? 'border-green-500' : 'border-slate-300 group-hover:border-green-400'}`}>
                                            {rndDetectionType === 'image' && <div className="w-2.5 h-2.5 bg-green-500 rounded-full" />}
                                        </div>
                                        <span className={`font-bold transition-colors ${rndDetectionType === 'image' ? 'text-green-700' : 'text-slate-600'}`}>配方表图片</span>
                                    </label>
                                    <label className="flex items-center gap-2.5 cursor-pointer group" onClick={() => setRndDetectionType('document')}>
                                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${rndDetectionType === 'document' ? 'border-green-500' : 'border-slate-300 group-hover:border-green-400'}`}>
                                            {rndDetectionType === 'document' && <div className="w-2.5 h-2.5 bg-green-500 rounded-full" />}
                                        </div>
                                        <span className={`font-bold transition-colors ${rndDetectionType === 'document' ? 'text-green-700' : 'text-slate-600'}`}>配方说明文档</span>
                                    </label>
                                    <label className="flex items-center gap-2.5 cursor-pointer group" onClick={() => setRndDetectionType('text')}>
                                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${rndDetectionType === 'text' ? 'border-green-500' : 'border-slate-300 group-hover:border-green-400'}`}>
                                            {rndDetectionType === 'text' && <div className="w-2.5 h-2.5 bg-green-500 rounded-full" />}
                                        </div>
                                        <span className={`font-bold transition-colors ${rndDetectionType === 'text' ? 'text-green-700' : 'text-slate-600'}`}>配方文本输入</span>
                                    </label>
                                </div>

                                {rndDetectionType === 'image' && (
                                    <div className="flex-1 min-h-[220px]">
                                        {rndImage ? (
                                            <div className="relative w-full max-w-sm rounded-xl overflow-hidden border border-slate-200 group">
                                                <img src={rndImage} alt="preview" className="w-full h-auto object-cover" />
                                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                                    <button onClick={() => { setRndImage(null); setRndImageFile(null); }} className="bg-red-500 text-white px-4 py-2 rounded-lg font-bold text-sm shadow-md hover:bg-red-600">删除重传</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="border-2 border-dashed border-green-200 hover:border-green-400 hover:bg-green-50/50 bg-slate-50 transition-all rounded-2xl flex-1 h-full flex flex-col items-center justify-center py-16 cursor-pointer relative overflow-hidden group">
                                                <input type="file" accept="image/png, image/jpeg" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => handleFileUpload(e, 'image', 'rnd')} />
                                                <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                                    <ImageIcon className="w-8 h-8 text-green-500" />
                                                </div>
                                                <p className="text-slate-700 font-bold mb-1">点击或拖拽上传配方图片</p>
                                                <p className="text-slate-400 text-xs font-medium">支持 JPG、PNG 格式，单张不超过 5MB</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {rndDetectionType === 'document' && (
                                    <div className="flex-1 min-h-[220px]">
                                        {rndFile ? (
                                            <div className="border border-green-200 bg-green-50 rounded-2xl p-6 flex flex-col items-center justify-center relative">
                                                <FileText className="w-12 h-12 text-green-600 mb-3" />
                                                <div className="text-[15px] font-bold text-slate-800 mb-1">{rndFile.name}</div>
                                                <div className="text-xs font-medium text-slate-500 mb-6">{(rndFile.size / 1024 / 1024).toFixed(2)} MB</div>
                                                <button onClick={() => setRndFile(null)} className="bg-white border border-red-200 text-red-500 px-4 py-1.5 rounded-lg font-bold text-xs shadow-sm hover:bg-red-50 transition-colors">移除文件</button>
                                            </div>
                                        ) : (
                                            <div className="border-2 border-dashed border-green-200 hover:border-green-400 hover:bg-green-50/50 bg-slate-50 transition-all rounded-2xl flex-1 h-full flex flex-col items-center justify-center py-16 cursor-pointer relative overflow-hidden group">
                                                <input type="file" accept=".doc,.docx,.pdf" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => handleFileUpload(e, 'document')} />
                                                <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                                    <Upload className="w-8 h-8 text-green-500" />
                                                </div>
                                                <p className="text-slate-700 font-bold mb-1">点击或拖拽上传配方文档</p>
                                                <p className="text-slate-400 text-xs font-medium">支持 Word、PDF 格式，单个文件不超过 10MB</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {rndDetectionType === 'text' && (
                                    <div className="flex-1 min-h-[220px]">
                                        <textarea
                                            value={rndText} onChange={e => setRndText(e.target.value)}
                                            placeholder="请在此处直接输入或粘贴成分明细表、配方表细节（如：水 70%、甘油 10%、丁二醇...）"
                                            className="w-full h-full min-h-[220px] px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-medium text-[14px] text-slate-700 focus:outline-none focus:border-green-400 focus:ring-2 focus:ring-green-100 placeholder-slate-400 resize-none transition-all custom-scrollbar flex-1"
                                        />
                                    </div>
                                )}

                            </div>

                            <div className="flex items-center justify-between mt-auto">
                                <span className="text-xs text-slate-400 font-medium"></span>
                                <div className="flex items-center gap-4">
                                    <button
                                        disabled={!isRndReady}
                                        onClick={() => runDetection('rnd')}
                                        className={`w-[140px] py-2.5 rounded-xl font-black text-sm transition-all shadow-md ${isRndReady ? 'bg-emerald-600 text-white hover:bg-emerald-700 hover:-translate-y-0.5 hover:shadow-lg shadow-emerald-600/30' : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'}`}
                                    >
                                        发起检测
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* === VIEW: Result === */}
                {view === 'result' && (
                    <div className="flex flex-col flex-1 overflow-hidden">
                        <div className="px-6 pt-6 pb-0 shrink-0 max-w-5xl w-full mx-auto">
                            <div className="bg-white border text-sm border-slate-200 rounded-xl p-4 shadow-sm mb-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                                <div className="flex flex-wrap items-center gap-y-2 gap-x-6 text-slate-600">
                                    <div className="flex items-center gap-2">
                                        <span className="text-slate-400 font-medium">检测源:</span>
                                        <span className="font-black text-blue-600 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-100 shadow-sm flex items-center gap-1">
                                            {lastDetectionSource === 'ecommerce' ? (
                                                <>电商广告法合规 <span className="text-blue-400 font-medium text-xs">({ecomDetectionType === 'image' ? '图片' : '图文'})</span></>
                                            ) : (
                                                <>产品研发合规 <span className="text-blue-400 font-medium text-xs">({rndDetectionType === 'image' ? '图片' : (rndDetectionType === 'document' ? '文档' : '文本')})</span></>
                                            )}
                                        </span>
                                    </div>
                                    <div className="w-1 h-1 rounded bg-slate-300 hidden md:block" />
                                    <div className="flex items-center gap-1.5"><span className="text-slate-400 font-medium">地区/行业:</span> <span className="font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">{region || '未指定'} / {industry || '未指定'}</span></div>
                                    <div className="w-1 h-1 rounded bg-slate-300 hidden md:block" />
                                    <div className="flex items-center gap-1.5"><span className="text-slate-400 font-medium">检测时间:</span> <span className="font-bold text-slate-700">{detectionTime}</span></div>
                                </div>
                                <div className={`border ${parsedData.isPassed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'} px-3 py-1 rounded-full flex items-center gap-1.5`}>
                                    {parsedData.isPassed ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <ShieldAlert className="w-4 h-4 text-red-500" />}
                                    <span className={`${parsedData.isPassed ? 'text-green-700' : 'text-red-700'} font-black tracking-wide`}>
                                        {parsedData.isPassed ? '安全达标' : '发现风险'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Tabs */}
                        <div className="shrink-0 max-w-5xl w-full mx-auto px-6">
                            <div className="flex items-center gap-2 border-b border-slate-200 bg-[#F8FAFC]">
                                {[
                                    { id: 'overview', label: '风险总览' },
                                    { id: 'details', label: '违规详情' },
                                    { id: 'law', label: '法规依据' }
                                ].map(t => (
                                    <button
                                        key={t.id}
                                        onClick={() => setResultTab(t.id as 'overview' | 'details' | 'law')}
                                        className={`relative px-6 py-3 text-sm font-bold transition-colors ${resultTab === t.id ? 'text-blue-600' : 'text-slate-500 hover:text-slate-800'}`}
                                    >
                                        {t.label}
                                        {resultTab === t.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Scrollable content area */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            <div className="max-w-5xl w-full mx-auto px-6 py-6">
                                <div className="flex-1">
                                    {resultTab === 'overview' && (
                                        <div className="animate-in fade-in slide-in-from-bottom-2">
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                                                <div className="bg-white border-t-4 border-red-500 rounded-xl shadow-sm p-6 text-center">
                                                    <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
                                                    <div className="text-3xl font-black text-slate-800 mb-1">{parsedData.highRisk}</div>
                                                    <div className="text-sm font-bold text-slate-500">高风险项</div>
                                                </div>
                                                <div className="bg-white border-t-4 border-amber-500 rounded-xl shadow-sm p-6 text-center">
                                                    <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
                                                    <div className="text-3xl font-black text-slate-800 mb-1">{parsedData.mediumRisk}</div>
                                                    <div className="text-sm font-bold text-slate-500">中风险项</div>
                                                </div>
                                                <div className="bg-white border-t-4 border-green-500 rounded-xl shadow-sm p-6 text-center opacity-70">
                                                    <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-3" />
                                                    <div className="text-3xl font-black text-slate-800 mb-1">{parsedData.passedCount}</div>
                                                    <div className="text-sm font-bold text-slate-500">已达标项</div>
                                                </div>
                                            </div>
                                            <div className={`border rounded-xl p-5 border-l-4 flex items-start gap-4 ${parsedData.isPassed ? 'bg-green-50 border-green-100 border-l-green-500' : 'bg-red-50 border-red-100 border-l-red-500'}`}>
                                                <Info className={`w-5 h-5 shrink-0 mt-0.5 ${parsedData.isPassed ? 'text-green-500' : 'text-red-500'}`} />
                                                <div>
                                                    <h4 className={`text-[15px] font-bold mb-1 ${parsedData.isPassed ? 'text-green-800' : 'text-red-800'}`}>重点结论</h4>
                                                    <p className={`text-sm font-medium leading-relaxed ${parsedData.isPassed ? 'text-green-700' : 'text-red-700'}`}>
                                                        {parsedData.isPassed
                                                            ? `经知识库相关法规比对，所有 ${parsedData.passedCount} 项成分均未命中禁限用名单，配方整体合规达标。`
                                                            : `本次检测共发现 ${parsedData.highRisk} 项高风险、${parsedData.mediumRisk} 项中风险${parsedData.passedCount > 0 ? `，${parsedData.passedCount} 项成分达标` : ''}。建议立即根据下方详情整改违规成分后再提交生产。`
                                                        }
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {resultTab === 'details' && (
                                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                                            {parsedData.isPassed ? (
                                                <div className="text-center py-20 text-slate-500 font-bold">没有违规内容，真棒！</div>
                                            ) : (
                                                parsedData.issues.map((item, idx) => (
                                                    <div key={idx} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm group">
                                                        <div className="flex items-start justify-between mb-3">
                                                            <div className="flex-1 pr-6">
                                                                <div className="text-[15px] font-black text-slate-800 mb-1.5"><span className="bg-yellow-100 px-1 rounded">{item.content}</span></div>
                                                                <div className="text-sm font-medium text-slate-600 leading-relaxed">{item.problem}</div>
                                                            </div>
                                                            <span className={`shrink-0 px-2.5 py-1 text-xs font-bold rounded flex items-center gap-1 border ${item.color === 'red' ? 'bg-red-50 text-red-600 border-red-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
                                                                <AlertTriangle className="w-3.5 h-3.5" /> {item.level}
                                                            </span>
                                                        </div>
                                                        {item.suggestion && (
                                                            <details className="mt-4 border-t border-slate-100 pt-3 opacity-80 group-hover:opacity-100 transition-opacity">
                                                                <summary className="text-[13px] font-bold text-blue-600 cursor-pointer outline-none hover:text-blue-700 select-none">
                                                                    展开查看修改建议
                                                                </summary>
                                                                <div className="mt-2 text-[13px] font-medium text-slate-600 bg-slate-50 p-3 rounded-lg leading-relaxed">
                                                                    {item.suggestion}
                                                                </div>
                                                            </details>
                                                        )}
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}

                                    {resultTab === 'law' && (
                                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                                            {parsedData.laws.length === 0 ? (
                                                <div className="text-center py-20 text-slate-500 font-bold">本次检测未命中需要列出的专属法规依据。</div>
                                            ) : (
                                                parsedData.laws.map((item, idx) => (
                                                    <div key={idx} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                                                        <div className="flex items-center gap-3 mb-3">
                                                            <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                                                                <FileText className="w-4 h-4 text-indigo-500" />
                                                            </div>
                                                            <div>
                                                                <h4 className="text-[14px] font-bold text-slate-800">{item.name}</h4>
                                                                <div className="text-[11px] font-bold text-slate-400 mt-0.5 uppercase tracking-wide">{item.area}</div>
                                                            </div>
                                                        </div>
                                                        <div className="text-[13px] font-medium text-slate-600 bg-slate-50 p-3 rounded-lg leading-relaxed border-l-2 border-indigo-200 whitespace-pre-line">
                                                            {item.term}
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Fixed Bottom Action Bar */}
                        <div className="shrink-0 bg-white border-t border-slate-200 px-8 py-4 flex items-center justify-end gap-4 shadow-[0_-4px_20px_rgba(0,0,0,0.04)]">
                            <button
                                onClick={handleExport}
                                disabled={exporting}
                                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 px-6 rounded-xl transition-colors flex items-center gap-2 text-sm disabled:opacity-50"
                            >
                                <Download className="w-4 h-4" />
                                {exporting ? '导出中...' : '导出报告 (PDF)'}
                            </button>
                            <button
                                onClick={() => setView(lastDetectionSource)}
                                className="bg-blue-600 text-white hover:bg-blue-700 font-bold py-2.5 px-6 rounded-xl transition-colors shadow-md shadow-blue-600/20 text-sm"
                            >
                                返回重新检测
                            </button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};

export default RiskDetectionModule;
