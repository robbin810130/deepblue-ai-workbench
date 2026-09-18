import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
    UploadCloud, X, Sparkles, Loader2, ZoomIn,
    Image as ImagePlaceholder, ChevronRight, ChevronDown, Check, Send, RefreshCw,
    Info, Download, ImageIcon
} from 'lucide-react';
import { fetchWithAuth } from '../utils/authFetch';
import { useConfig } from '../hooks/useConfig';
import { sysAlert } from '../utils/dialog';

const MAX_REFS = 5;

// 分辨率 × 比例 → 像素尺寸查找表
const SIZE_MAP: Record<'2K' | '4K', Record<string, string>> = {
    '2K': {
        '1:1': '2048x2048', '4:3': '2304x1728', '3:4': '1728x2304',
        '16:9': '2848x1600', '9:16': '1600x2848', '3:2': '2496x1664',
        '2:3': '1664x2496', '21:9': '3136x1344',
    },
    '4K': {
        '1:1': '4096x4096', '4:3': '4704x3520', '3:4': '3520x4704',
        '16:9': '5504x3040', '9:16': '3040x5504', '3:2': '4992x3328',
        '2:3': '3328x4992', '21:9': '6240x2656',
    },
};

const MODELS = [
    { label: 'doubao-seedream-4.0', value: 'doubao-seedream-4-0-250828', disabled: false },
    { label: 'doubao-seedream-4.5', value: 'doubao-seedream-4-5-251128', disabled: false },
    { label: 'Nano Banana', value: 'nano-banana', disabled: true },
    { label: 'Gemini 3.1 Flash Image', value: 'gemini-3.1-flash', disabled: true },
];

const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'] as const;
type AspectRatio = typeof ASPECT_RATIOS[number];

export interface AIScene {
    id: string;
    label: string;
    emoji: string;
    desc: string;
    fields: {
        id: string;
        label: string;
        options: string[];
    }[];
}

interface RefImage { id: string; file: File; preview: string; }
interface GeneratedImage { id: string; url: string; label: string; }
interface ChatMessage { role: 'user' | 'assistant'; content: string; images?: GeneratedImage[]; }
interface MatchResult {
    id: string; name: string; brand: string; category: string;
    subcategory: string; color_name: string; finish: string;
    tags: string[]; image: string; similarity: number;
}

// 图源模式：'ref' 使用原始参考图，'generated' 使用上次生成的图
type ImageSourceMode = 'ref' | 'generated';

export const AIImageModule: React.FC = () => {
    // --- 动态配置库数据 ---
    const { data: aiScenes, loading: isScenesLoading } = useConfig<AIScene>('ai_scenes');
    const [isReady, setIsReady] = useState(false);

    // --- 场景 & 选项 ---
    const [selectedScene, setSelectedScene] = useState<string>('text_to_image');
    const [selectedSubOptions, setSelectedSubOptions] = useState<Record<string, string>>({});

    // --- 参考图 ---
    const [refImages, setRefImages] = useState<RefImage[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- 对话历史 ---
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [prompt, setPrompt] = useState('');
    const chatEndRef = useRef<HTMLDivElement>(null);

    // --- 图源选择（多轮对话专用） ---
    const [imageSourceMode, setImageSourceMode] = useState<ImageSourceMode>('ref');

    // --- 智能匹配结果 ---
    const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
    const [matchAnalysis, setMatchAnalysis] = useState<any>(null);

    // --- 生成状态 ---
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatingStatus, setGeneratingStatus] = useState('');
    const [generateError, setGenerateError] = useState('');

    // --- 图片设置 ---
    const [imageResolution, setImageResolution] = useState<'2K' | '4K'>('2K');
    const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
    const pixelSize = SIZE_MAP[imageResolution][aspectRatio];

    // --- 大图预览 ---
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

    // --- 模型选择 ---
    const [selectedModel, setSelectedModel] = useState<string>(MODELS[0].value);
    const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
    const modelMenuRef = useRef<HTMLDivElement>(null);

    // 点击外部自动收起模型菜单
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (modelMenuRef.current && !modelMenuRef.current.contains(event.target as Node)) {
                setIsModelMenuOpen(false);
            }
        };
        if (isModelMenuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isModelMenuOpen]);

    // 渲染钩子防跃迁闪烁
    useEffect(() => {
        if (!isScenesLoading) {
            requestAnimationFrame(() => {
                setTimeout(() => setIsReady(true), 50);
            });
        }
    }, [isScenesLoading]);

    // 当切换场景或选项时，自动把向导生成的 prompt 填入输入框
    useEffect(() => {
        const scene = aiScenes.find(s => s.id === selectedScene);
        if (!scene) return;
        let newPrompt = "";
        scene.fields.forEach(f => {
            const val = selectedSubOptions[f.id];
            if (val) {
                newPrompt += `- ${f.label}：${val}\n`;
            }
        });
        setPrompt(newPrompt.trim());
    }, [selectedScene, selectedSubOptions]);

    // 消息自动滚动到底部
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatHistory, isGenerating]);

    // --- 文件操作 ---
    const addFiles = useCallback((files: FileList | File[]) => {
        const arr = Array.from(files);
        const validTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'image/gif'];
        const newImages: RefImage[] = [];
        for (const f of arr) {
            if (refImages.length + newImages.length >= MAX_REFS) { sysAlert(`最多只能上传 ${MAX_REFS} 张参考图`); break; }
            if (!validTypes.includes(f.type)) { sysAlert(`文件 "${f.name}" 格式不支持`); continue; }
            if (f.size > 10 * 1024 * 1024) { sysAlert(`文件 "${f.name}" 超过 10MB`); continue; }
            newImages.push({ id: `${Date.now()}-${Math.random()}`, file: f, preview: URL.createObjectURL(f) });
        }
        setRefImages(prev => [...prev, ...newImages]);
    }, [refImages]);

    const removeRefImage = (id: string) => {
        setRefImages(prev => {
            const img = prev.find(i => i.id === id);
            if (img) URL.revokeObjectURL(img.preview);
            return prev.filter(i => i.id !== id);
        });
    };

    // 取最近一轮 AI 生成的图片列表
    const latestGeneratedImages: GeneratedImage[] = [...chatHistory]
        .reverse()
        .find(m => m.role === 'assistant' && m.images && m.images.length > 0)?.images || [];

    // 是否有可用的生成图，决定是否展示图源选择器
    const hasGeneratedImages = latestGeneratedImages.length > 0;

    // --- 智能匹配逻辑 ---
    const handleSmartMatch = async () => {
        if (refImages.length === 0) {
            sysAlert('请上传一张产品图用于智能匹配'); return;
        }
        setIsGenerating(true);
        setGeneratingStatus('AI 正在分析图片并检索数据库...');
        setGenerateError('');
        setMatchResults([]);
        setMatchAnalysis(null);

        try {
            const formData = new FormData();
            formData.append('image', refImages[0].file);
            if (selectedSubOptions['category']) formData.append('category', selectedSubOptions['category']);
            if (selectedSubOptions['color_name']) formData.append('color_name', selectedSubOptions['color_name']);
            if (selectedSubOptions['finish']) formData.append('finish', selectedSubOptions['finish']);

            const response = await fetchWithAuth('/api/smart-match', { method: 'POST', body: formData });
            if (!response.ok) {
                const err = await response.json().catch(() => ({ error: '请求失败' }));
                throw new Error(err.error || `HTTP ${response.status}`);
            }

            const data = await response.json();
            if (data.success) {
                setMatchResults(data.results);
                setMatchAnalysis(data.aiAnalysis);
                setGeneratingStatus('');
                setChatHistory(prev => [...prev, {
                    role: 'assistant',
                    content: `✅ 智能匹配完成。为您找到 ${data.results.length} 个相似产品。（AI分析：${data.aiAnalysis.category || '未识别'} / ${data.aiAnalysis.color_name || '未识别'}）`
                }]);

                // 通知菜单栏：后台任务完成
                window.dispatchEvent(new CustomEvent('app-task-done', { detail: { appId: 'aiimage' } }));
            } else {
                throw new Error('匹配结果解析失败');
            }
        } catch (err: any) {
            console.error('[智能匹配] 出错:', err);
            setGenerateError(err.message || '匹配失败，请重试');
            setGeneratingStatus('');
        } finally {
            setIsGenerating(false);
        }
    };

    // --- 生成逻辑 ---
    const handleGenerate = async () => {
        if (selectedScene === 'smart_match') {
            await handleSmartMatch();
            return;
        }

        const isFirstRound = chatHistory.length === 0;
        const isTextToImage = selectedScene === 'text_to_image';

        // 文字出图逻辑
        if (!isTextToImage) {
            // 其他功能：首轮必须有参考图
            if (isFirstRound && refImages.length === 0) {
                sysAlert('请至少上传一张参考图后再生成'); return;
            }
            if (!isFirstRound && imageSourceMode === 'ref' && refImages.length === 0) {
                sysAlert('请至少上传一张参考图后再生成'); return;
            }
        }
        if (!prompt.trim()) { sysAlert('请填写提示词后再生成'); return; }

        const userMsg = prompt.trim();
        setChatHistory(prev => [...prev, { role: 'user', content: userMsg }]);
        setPrompt('');
        setIsGenerating(true);
        setGeneratingStatus('正在连接生成服务...');
        setGenerateError('');

        // 构造完整的系统指令（后台拼接）
        const scene = aiScenes.find(s => s.id === selectedScene);
        const prefix = scene ? `作为专业电商美工，请根据参考图执行【${scene.label}】操作。\n具体要求如下：\n` : "";
        const suffix = `\n其他要求：请确保光线自然、细节清晰、无多余文字水印、色彩质感真实、无畸变、符合商品实拍标准。`;

        // 构建带上下文的最终 prompt
        const finalPrompt = !isFirstRound
            ? `【历史对话参考】\n${chatHistory.filter(m => m.role === 'user').map(m => m.content).join('\n---\n')}\n\n【本次修改要求】\n${userMsg}`
            : (isSmartMatch ? userMsg : `${prefix}${userMsg}${suffix}`);

        try {
            const formData = new FormData();
            formData.append('prompt', finalPrompt);
            formData.append('size', pixelSize);
            formData.append('model', selectedModel);

            console.log('[AIImageModule] handleGenerate - Current Model:', selectedModel);

            if (!isFirstRound && imageSourceMode === 'generated' && latestGeneratedImages.length > 0) {
                // 使用上次生成的最后一张图（fetch 为 Blob）
                setGeneratingStatus('正在获取上次生成的图片...');
                const lastImg = latestGeneratedImages[latestGeneratedImages.length - 1];
                const imgResp = await fetch(lastImg.url);
                const blob = await imgResp.blob();
                formData.append('images', blob, 'generated.jpg');
            } else if (refImages.length > 0) {
                // 使用原始参考图（文字出图无图时跳过）
                refImages.forEach(img => formData.append('images', img.file));
            }

            const response = await fetchWithAuth('/api/generate-image', { method: 'POST', body: formData });
            if (!response.ok) {
                const err = await response.json().catch(() => ({ error: '请求失败' }));
                throw new Error(err.error || `HTTP ${response.status}`);
            }

            const reader = response.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let imageCount = 0;
            const roundImages: GeneratedImage[] = [];
            setGeneratingStatus('AI 正在创作中，请稍候...');

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const jsonStr = line.slice(6).trim();
                    if (!jsonStr) continue;
                    try {
                        const event = JSON.parse(jsonStr);
                        if (event.type === 'partial' && event.url) {
                            imageCount++;
                            setGeneratingStatus(`已生成第 ${imageCount} 张，继续生成中...`);
                            roundImages.push({ id: `gen-${Date.now()}-${imageCount}`, url: event.url, label: `生成图片 ${imageCount}` });
                        } else if (event.type === 'complete') {
                            setGeneratingStatus(`✅ 全部完成，共 ${event.total} 张`);
                        } else if (event.type === 'error') {
                            throw new Error(event.message);
                        }
                    } catch (parseErr: any) {
                        if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
                    }
                }
            }

            if (imageCount === 0) {
                setGeneratingStatus('未生成任何图片，请检查参考图或重试');
                setChatHistory(prev => [...prev, { role: 'assistant', content: '⚠️ 本轮未生成任何图片，请检查参考图和提示词后重试。', images: [] }]);
            } else {
                const sourceTip = (!isFirstRound && imageSourceMode === 'generated')
                    ? '（基于上次生成图进行的修改）'
                    : '';
                setChatHistory(prev => [...prev, {
                    role: 'assistant',
                    content: `✅ 本轮共生成 ${imageCount} 张图片${sourceTip}。如需继续调整，请在下方输入修改意见。`,
                    images: roundImages
                }]);

                // 通知菜单栏：后台任务完成
                window.dispatchEvent(new CustomEvent('app-task-done', { detail: { appId: 'aiimage' } }));
            }
        } catch (err: any) {
            console.error('[电商生图] 出错:', err);
            const errMsg = err.message || '生成失败，请重试';
            setGenerateError(errMsg);
            setGeneratingStatus('');
            setChatHistory(prev => [...prev, { role: 'assistant', content: `❌ 生成出错：${errMsg}`, images: [] }]);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleGenerate();
    };

    const currentScene = aiScenes.find(s => s.id === selectedScene);
    const isFirstRound = chatHistory.length === 0;
    const isTextToImage = selectedScene === 'text_to_image';
    const isSmartMatch = selectedScene === 'smart_match';

    let canGenerate = false;
    if (isSmartMatch) {
        canGenerate = refImages.length > 0 && !isGenerating;
    } else {
        const promptIsValid = prompt.trim().length > 0;
        const imagesReady = isTextToImage
            ? true  // 文字出图无需参考图
            : (isFirstRound ? refImages.length > 0 : (imageSourceMode === 'ref' ? refImages.length > 0 : hasGeneratedImages));
        canGenerate = promptIsValid && !isGenerating && imagesReady;
    }

    const latestImages = latestGeneratedImages;

    if (!isReady) return null;

    return (
        <div className="h-full flex min-h-0 overflow-hidden bg-slate-50">

            {/* ======================= 左侧：场景菜单栏 ======================= */}
            <aside className="w-[400px] shrink-0 h-full flex flex-col bg-white border-r border-slate-100 shadow-sm overflow-hidden">
                {/* 顶部参考图上传 */}
                <div className="p-3 border-b border-slate-100">
                    <p className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2 px-1">参考图上传</p>
                    <input ref={fileInputRef} type="file" className="hidden" accept="image/*" multiple
                        onChange={e => { if (e.target.files) { addFiles(e.target.files); e.target.value = ''; } }} />

                    {refImages.length < MAX_REFS && (
                        <div
                            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files) addFiles(e.dataTransfer.files); }}
                            onClick={() => fileInputRef.current?.click()}
                            className={`border-2 border-dashed rounded-xl p-3 flex flex-col items-center justify-center cursor-pointer transition-all text-center
                                ${dragOver ? 'border-violet-500 bg-violet-50' : 'border-slate-200 hover:border-violet-400 hover:bg-violet-50/40'}`}
                        >
                            <UploadCloud className={`w-5 h-5 mb-1 ${dragOver ? 'text-violet-600' : 'text-slate-400'}`} />
                            <p className="text-sm text-slate-500 leading-snug">点击或拖拽上传<br /><span className="text-slate-400">最多 {MAX_REFS} 张</span></p>
                        </div>
                    )}

                    {refImages.length > 0 && (
                        <div className="grid grid-cols-3 gap-1 mt-2">
                            {refImages.map(img => (
                                <div key={img.id} className="relative group aspect-square rounded-lg overflow-hidden border border-slate-200">
                                    <img src={img.preview} alt={img.file.name} className="w-full h-full object-cover" />
                                    <button type="button"
                                        onClick={e => { e.stopPropagation(); removeRefImage(img.id); }}
                                        className="absolute top-0.5 right-0.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow">
                                        <X className="w-2.5 h-2.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 场景菜单列表 */}
                <div className="flex-1 overflow-y-auto p-2">
                    <p className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2 px-1 pt-1">功能选择</p>
                    <nav className="flex flex-col gap-1">
                        {aiScenes.map(scene => (
                            <button
                                key={scene.id}
                                onClick={() => { setSelectedScene(scene.id); setSelectedSubOptions({}); }}
                                className={`w-full text-left px-3 py-3 rounded-xl transition-all group relative flex items-start gap-2.5
                                    ${selectedScene === scene.id
                                        ? 'bg-violet-600 text-white shadow-md shadow-violet-300'
                                        : 'text-slate-600 hover:bg-violet-50 hover:text-violet-700'}`}
                            >
                                <span className="text-base shrink-0 leading-snug">{scene.emoji}</span>
                                <div className="min-w-0">
                                    <p className="text-base font-semibold leading-snug">{scene.label}</p>
                                    <p className={`text-sm leading-snug mt-0.5 ${selectedScene === scene.id ? 'text-violet-200' : 'text-slate-400'}`}>{scene.desc}</p>
                                </div>
                                {selectedScene === scene.id && <ChevronRight className="w-3.5 h-3.5 ml-auto shrink-0 mt-0.5 text-violet-200" />}
                            </button>
                        ))}
                    </nav>
                </div>

                {/* 底部：分辨率 & 比例 */}
                <div className="p-3 border-t border-slate-100 flex flex-col gap-2">
                    <div>
                        <p className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-1">分辨率</p>
                        <div className="flex gap-1">
                            {(['2K', '4K'] as const).map(r => (
                                <button key={r} onClick={() => setImageResolution(r)}
                                    className={`flex-1 py-2 text-sm font-bold rounded-lg border transition-all
                                        ${imageResolution === r ? 'bg-violet-600 border-violet-600 text-white' : 'border-slate-200 text-slate-500 hover:border-violet-400'}`}>
                                    {r}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <p className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-1">比例 <span className="font-mono text-violet-600 ml-1">{aspectRatio}</span></p>
                        <div className="grid grid-cols-4 gap-1">
                            {ASPECT_RATIOS.map(r => (
                                <button key={r} onClick={() => setAspectRatio(r)}
                                    className={`py-1.5 text-sm font-semibold rounded border transition-all
                                        ${aspectRatio === r ? 'bg-violet-600 border-violet-600 text-white' : 'border-slate-200 text-slate-500 hover:border-violet-400'}`}>
                                    {r}
                                </button>
                            ))}
                        </div>
                    </div>
                    <p className="text-center text-sm text-violet-500 font-mono bg-violet-50 rounded-lg px-2 py-2">{pixelSize}</p>
                </div>
            </aside>

            {/* ======================= 中间：图片结果展示 ======================= */}
            <main className="flex-1 min-w-0 h-full flex flex-col overflow-hidden bg-slate-50">
                {/* 顶部标题栏 */}
                <div className="shrink-0 px-6 py-4 bg-white border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Sparkles className="w-5 h-5 text-violet-600" />
                        <span className="font-bold text-slate-800 text-lg">电商 AI 生图</span>
                        {currentScene && (
                            <span className="text-sm px-3 py-1 bg-violet-100 text-violet-700 rounded-full font-semibold">
                                {currentScene.emoji} {currentScene.label}
                            </span>
                        )}
                    </div>

                    {/* 模型选择：自定义高级下拉组件 */}
                    <div className="relative" ref={modelMenuRef}>
                        <button
                            onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
                            className={`flex items-center gap-4 px-4 py-2.5 rounded-2xl border transition-all duration-300 group
                                ${isModelMenuOpen
                                    ? 'bg-white border-violet-400 shadow-lg shadow-violet-100 ring-2 ring-violet-50'
                                    : 'bg-slate-50 border-slate-200 hover:border-violet-300 hover:bg-white hover:shadow-md'}`}
                        >
                            <label className="text-sm font-bold text-slate-400 group-hover:text-slate-500 transition-colors pointer-events-none">模型选择</label>
                            <div className="flex items-center gap-2">
                                <span className={`text-sm font-bold transition-colors ${isModelMenuOpen ? 'text-violet-600' : 'text-slate-700'}`}>
                                    {MODELS.find(m => m.value === selectedModel)?.label}
                                </span>
                                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${isModelMenuOpen ? 'rotate-180 text-violet-500' : 'group-hover:text-slate-600'}`} />
                            </div>
                        </button>

                        {/* 下拉菜单面板 */}
                        {isModelMenuOpen && (
                            <div className="absolute top-full right-0 mt-3 w-72 bg-white/95 backdrop-blur-xl rounded-2xl border border-slate-200 shadow-2xl overflow-hidden z-[60] animate-in fade-in zoom-in-95 duration-200 origin-top-right">
                                <div className="p-2 flex flex-col gap-1">
                                    {MODELS.map(m => {
                                        const isSelected = selectedModel === m.value;
                                        return (
                                            <button
                                                key={m.value}
                                                disabled={m.disabled}
                                                onClick={() => {
                                                    if (!m.disabled) {
                                                        setSelectedModel(m.value);
                                                        setIsModelMenuOpen(false);
                                                    }
                                                }}
                                                className={`flex items-center justify-between px-3 py-3 rounded-xl transition-all duration-200 group/item
                                                    ${isSelected
                                                        ? 'bg-violet-600 text-white shadow-md shadow-violet-200'
                                                        : m.disabled
                                                            ? 'opacity-40 cursor-not-allowed bg-transparent'
                                                            : 'text-slate-600 hover:bg-violet-50 hover:text-violet-700'}`}
                                            >
                                                <div className="flex flex-col items-start gap-0.5">
                                                    <span className="text-sm font-bold leading-none">{m.label}</span>
                                                    {m.disabled && <span className="text-[10px] font-medium opacity-80">当前版本暂不可选</span>}
                                                </div>
                                                {isSelected && <Check className="w-4 h-4 text-white" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {latestImages.length > 0 && (
                        <span className="text-xs text-slate-400">{latestImages.length} 张最新结果</span>
                    )}
                </div>

                {/* 图片画廊 */}
                <div className="flex-1 overflow-y-auto p-4">
                    {isGenerating && latestImages.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-4 min-h-[300px]">
                            <div className="w-16 h-16 rounded-full border-4 border-violet-100 border-t-violet-500 animate-spin" />
                            <p className="text-sm font-medium text-slate-500">{generatingStatus || 'AI 正在创作中...'}</p>
                            <p className="text-xs text-slate-400">这需要约 10-30 秒，请耐心等待</p>
                        </div>
                    ) : latestImages.length > 0 ? (
                        <>
                            <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                                {latestImages.map(img => (
                                    <div key={img.id}
                                        className="relative group aspect-square rounded-xl overflow-hidden border border-slate-200 shadow-sm cursor-pointer hover:shadow-md hover:border-violet-300 transition-all"
                                        onClick={() => setLightboxUrl(img.url)}>
                                        <img src={img.url} alt={img.label} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center gap-2">
                                            <ZoomIn className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
                                            <a href={img.url} download={`generated-${img.id}.jpg`}
                                                onClick={e => e.stopPropagation()}
                                                className="w-7 h-7 rounded-full bg-white/20 backdrop-blur flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Download className="w-3.5 h-3.5 text-white" />
                                            </a>
                                        </div>
                                    </div>
                                ))}
                                {isGenerating && (
                                    <div className="aspect-square rounded-xl border-2 border-dashed border-violet-300 bg-violet-50 flex items-center justify-center">
                                        <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
                                    </div>
                                )}
                            </div>
                            {generatingStatus && (
                                <p className="text-center text-xs text-violet-500 mt-3">{generatingStatus}</p>
                            )}
                        </>
                    ) : (isSmartMatch && matchResults.length > 0) ? (
                        <div className="flex flex-col gap-4">
                            {matchAnalysis && (
                                <div className="bg-violet-50 p-3 rounded-xl border border-violet-100 flex items-start gap-3 text-sm">
                                    <Sparkles className="w-4 h-4 text-violet-500 mt-0.5 shrink-0" />
                                    <div>
                                        <p className="font-semibold text-violet-800 mb-1">AI 视觉分析结果</p>
                                        <p className="text-violet-600">类型：{matchAnalysis.category || '-'} / {matchAnalysis.subcategory || '-'}</p>
                                        <p className="text-violet-600">颜色：{matchAnalysis.color_name || '-'} | 质地：{matchAnalysis.finish || '-'}</p>
                                        <p className="text-violet-600">标签：{matchAnalysis.tags?.join(', ') || '-'}</p>
                                    </div>
                                </div>
                            )}
                            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                                {matchResults.map((item, idx) => (
                                    <div key={item.id} className="bg-white rounded-xl overflow-hidden border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                                        <img src={item.image} alt={item.name} className="w-full aspect-square object-cover" />
                                        <div className="p-3">
                                            <div className="flex justify-between items-start mb-1">
                                                <p className="font-bold text-slate-800 line-clamp-1">{item.name}</p>
                                                <span className={`text-xs px-1.5 py-0.5 rounded font-mono font-bold
                                                    ${idx === 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                                                    {item.similarity}%
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-500 mb-2">{item.brand} · {item.color_name}</p>
                                            <div className="flex flex-wrap gap-1">
                                                {item.tags.slice(0, 3).map(t => (
                                                    <span key={t} className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{t}</span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-4 min-h-[300px]">
                            <div className="w-28 h-28 rounded-3xl bg-white border-2 border-dashed border-slate-200 flex items-center justify-center shadow-sm">
                                <ImagePlaceholder className="w-10 h-10 text-slate-200" />
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-medium text-slate-400">暂无生成结果</p>
                                <p className="text-xs text-slate-300 mt-1">选择功能场景，上传参考图，<br />在右侧填写需求后点击发送</p>
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {/* ======================= 右侧：关键词选择 + 对话框 ======================= */}
            <aside className="w-[500px] shrink-0 h-full flex flex-col bg-white border-l border-slate-100 shadow-sm overflow-hidden">

                {/* 上半：快捷生成向导 */}
                <div className="flex-[0_0_auto] max-h-[50%] flex flex-col border-b border-slate-100">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2 shrink-0">
                        <Info className="w-3.5 h-3.5 text-violet-500" />
                        <span className="text-base font-bold text-slate-600">快捷生成向导</span>
                        {currentScene && (
                            <span className="ml-auto text-sm text-slate-400">{currentScene.emoji} {currentScene.label}</span>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
                        {currentScene?.fields.map(field => (
                            <div key={field.id}>
                                <p className="text-sm font-semibold text-slate-500 mb-2">{field.label}</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {field.options.map(opt => {
                                        const isSelected = selectedSubOptions[field.id] === opt;
                                        return (
                                            <button
                                                key={opt}
                                                onClick={() => setSelectedSubOptions(prev => ({
                                                    ...prev,
                                                    [field.id]: isSelected ? '' : opt
                                                }))}
                                                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all leading-snug
                                                    ${isSelected
                                                        ? 'bg-violet-600 text-white shadow-sm'
                                                        : 'bg-slate-100 text-slate-600 hover:bg-violet-100 hover:text-violet-700'}`}
                                            >
                                                {opt}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                        {!currentScene && (
                            <div className="text-center text-slate-300 text-xs py-4">请在左侧选择功能场景</div>
                        )}
                    </div>
                </div>

                {/* 下半：多轮对话提示词框 */}
                <div className="flex-1 min-h-0 flex flex-col">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-2">
                            <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                            <span className="text-base font-bold text-slate-600">提示词 & 修改对话</span>
                        </div>
                        {chatHistory.length > 0 && (
                            <button
                                onClick={() => { setChatHistory([]); setGenerateError(''); setGeneratingStatus(''); setImageSourceMode('ref'); }}
                                className="flex items-center gap-1 text-sm text-slate-400 hover:text-red-400 transition-colors"
                            >
                                <RefreshCw className="w-3 h-3" /> 清空对话
                            </button>
                        )}
                    </div>

                    {/* 对话历史记录 */}
                    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
                        {chatHistory.length === 0 ? (
                            <div className="text-center text-slate-400 text-sm py-4 leading-relaxed">
                                从左侧选择场景后，关键词会自动<br />
                                填入下方提示词，也可手动修改。<br />
                                <span className="text-violet-400">📝 发送后可继续对话修改</span>
                            </div>
                        ) : (
                            chatHistory.map((msg, idx) => (
                                <div key={idx} className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                    <div className={`max-w-[90%] px-4 py-3 rounded-2xl text-sm leading-relaxed
                                        ${msg.role === 'user'
                                            ? 'bg-violet-600 text-white rounded-tr-sm'
                                            : 'bg-slate-100 text-slate-700 rounded-tl-sm'}`}
                                    >
                                        {msg.content}
                                    </div>
                                    {msg.images && msg.images.length > 0 && (
                                        <div className="flex flex-wrap gap-1 max-w-[90%]">
                                            {msg.images.slice(0, 4).map(img => (
                                                <img key={img.id} src={img.url} alt={img.label}
                                                    className="w-14 h-14 object-cover rounded-lg border border-slate-200 cursor-pointer hover:border-violet-400 transition-colors"
                                                    onClick={() => setLightboxUrl(img.url)} />
                                            ))}
                                            {msg.images.length > 4 && (
                                                <div className="w-14 h-14 rounded-lg border border-slate-200 bg-slate-100 flex items-center justify-center text-xs text-slate-400">
                                                    +{msg.images.length - 4}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                        {isGenerating && (
                            <div className="flex items-start gap-2">
                                <div className="bg-slate-100 rounded-2xl rounded-tl-sm px-3 py-2 flex items-center gap-1.5">
                                    <Loader2 className="w-3 h-3 animate-spin text-violet-500" />
                                    <span className="text-sm text-slate-500">{generatingStatus || 'AI 生成中...'}</span>
                                </div>
                            </div>
                        )}
                        {generateError && !isGenerating && (
                            <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-sm text-red-600">
                                <span className="font-semibold">出错：</span>{generateError}
                            </div>
                        )}
                        <div ref={chatEndRef} />
                    </div>

                    {/* 图源选择器（有生成结果后的后续轮次才显示） */}
                    {hasGeneratedImages && !isFirstRound && (
                        <div className="shrink-0 px-3 py-2 border-t border-slate-100 bg-slate-50">
                            <p className="text-xs font-semibold text-slate-500 mb-1.5">下次生成基于：</p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setImageSourceMode('ref')}
                                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium border transition-all
                                        ${imageSourceMode === 'ref'
                                            ? 'bg-violet-600 border-violet-600 text-white shadow-sm'
                                            : 'border-slate-200 text-slate-600 hover:border-violet-400 hover:bg-violet-50'}`}
                                >
                                    <UploadCloud className="w-3.5 h-3.5" />
                                    原始参考图
                                </button>
                                <button
                                    onClick={() => setImageSourceMode('generated')}
                                    disabled={!hasGeneratedImages}
                                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium border transition-all
                                        ${imageSourceMode === 'generated'
                                            ? 'bg-violet-600 border-violet-600 text-white shadow-sm'
                                            : 'border-slate-200 text-slate-600 hover:border-violet-400 hover:bg-violet-50'}`}
                                >
                                    <ImageIcon className="w-3.5 h-3.5" />
                                    上次生成图
                                </button>
                            </div>
                        </div>
                    )}

                    {/* 输入区 */}
                    <div className="shrink-0 border-t border-slate-100 p-3">
                        <div className="relative bg-slate-50 rounded-xl border border-slate-200 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100 transition-all">
                            <textarea
                                value={prompt}
                                onChange={e => setPrompt(e.target.value)}
                                onKeyDown={handleKeyDown}
                                rows={4}
                                placeholder={chatHistory.length > 0
                                    ? "对本次结果不满意？说说你的修改意见..."
                                    : "描述你希望生成的图片效果，会自动填入向导内容..."
                                }
                                className="w-full bg-transparent px-3 pt-3 pb-12 text-base text-slate-700 resize-none outline-none leading-relaxed placeholder:text-slate-400"
                            />
                            <div className="absolute bottom-2 right-2 left-2 flex items-center justify-between">
                                <span className="text-sm text-slate-400">
                                    {isSmartMatch
                                        ? (refImages.length > 0 ? <span className="text-violet-500">🔎 上传完毕，点击进行智能检索</span> : '⚠️ 智能匹配需上传 1 张包含产品的参考图')
                                        : isTextToImage
                                            ? (prompt.includes('（未做细节指定）')
                                                ? <span className="text-amber-500">⚠️ 请选择关键词或修改提示词后发送</span>
                                                : <span className="text-green-500">✍️ 纯文字生图，无需参考图</span>)
                                            : (isFirstRound
                                                ? (refImages.length > 0 ? `已上传 ${refImages.length} 张参考图` : '⚠️ 请先上传参考图')
                                                : (imageSourceMode === 'generated' ? '📷 将基于上次生成图修改' : `原始参考图 (${refImages.length} 张)`))
                                    }
                                    <span className="ml-2 text-slate-300">Ctrl+Enter 发送</span>
                                </span>
                                <button
                                    onClick={handleGenerate}
                                    disabled={!canGenerate}
                                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold transition-all
                                        ${canGenerate
                                            ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-violet-200'
                                            : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                                >
                                    {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                                    {isSmartMatch ? '智能检索' : (chatHistory.length > 0 ? '修改' : '生成')}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </aside>

            {/* ======================= Lightbox 大图预览 ======================= */}
            {lightboxUrl && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 cursor-pointer"
                    onClick={() => setLightboxUrl(null)}>
                    <div className="relative max-w-4xl max-h-full">
                        <img src={lightboxUrl} alt="预览" className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl object-contain"
                            onClick={e => e.stopPropagation()} />
                        <button onClick={() => setLightboxUrl(null)}
                            className="absolute -top-3 -right-3 w-8 h-8 bg-white text-slate-700 rounded-full shadow-lg flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition-colors">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
