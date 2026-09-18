import React, { useState, useRef } from 'react';
import { UploadCloud, Image as ImageIcon, ArrowRightLeft, X, CheckCircle2, Info, Loader2, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { fetchWithAuth } from '../utils/authFetch';
import { sysAlert } from '../utils/dialog';

interface CompareImage {
    file: File;
    preview: string;
}

export const LayoutCompareModule: React.FC = () => {
    const [leftImage, setLeftImage] = useState<CompareImage | null>(null);
    const [rightImage, setRightImage] = useState<CompareImage | null>(null);

    // 进度与结果状态
    const [isComparing, setIsComparing] = useState(false);
    const [compareResult, setCompareResult] = useState<string>('');

    // 拖动状态枚举：null, 'left', 'right'
    const [dragOverArea, setDragOverArea] = useState<'left' | 'right' | null>(null);

    const leftInputRef = useRef<HTMLInputElement>(null);
    const rightInputRef = useRef<HTMLInputElement>(null);

    // ======== 视图清理 ======== //
    const clearLeft = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (leftImage) URL.revokeObjectURL(leftImage.preview);
        setLeftImage(null);
        if (leftInputRef.current) leftInputRef.current.value = '';
    };

    const clearRight = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (rightImage) URL.revokeObjectURL(rightImage.preview);
        setRightImage(null);
        if (rightInputRef.current) rightInputRef.current.value = '';
    };

    // ======== 文件处理逻辑 ======== //
    const processFile = (file: File, side: 'left' | 'right') => {
        if (!file.type.startsWith('image/')) {
            sysAlert('请上传图片文件！');
            return;
        }
        if (file.size > 15 * 1024 * 1024) {
            sysAlert('图片过大，请上传 15MB 以内的图片');
            return;
        }

        const previewURL = URL.createObjectURL(file);
        if (side === 'left') {
            if (leftImage) URL.revokeObjectURL(leftImage.preview);
            setLeftImage({ file, preview: previewURL });
        } else {
            if (rightImage) URL.revokeObjectURL(rightImage.preview);
            setRightImage({ file, preview: previewURL });
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, side: 'left' | 'right') => {
        const file = e.target.files?.[0];
        if (file) processFile(file, side);
    };

    const handleDrop = (e: React.DragEvent, side: 'left' | 'right') => {
        e.preventDefault();
        setDragOverArea(null);
        const file = e.dataTransfer.files?.[0];
        if (file) processFile(file, side);
    };

    // ======== 核心网络与对比交互逻辑 ======== //
    const handleCompare = async () => {
        if (!leftImage) {
            sysAlert('🚨 请至少上传左侧的基准图片！');
            return;
        }

        try {
            setIsComparing(true);
            setCompareResult('');

            // 1. 帮助函数：专门提传单张图片换取 Dify File ID
            const uploadToDify = async (file: File): Promise<string> => {
                const formData = new FormData();
                formData.append('file', file);

                const uploadResRaw = await fetchWithAuth('/api/dify/upload', {
                    method: 'POST',
                    body: formData // 不要手动设 Content-Type, 浏览器会结合 boundary 自动设置
                });

                const uploadRes = await uploadResRaw.json();

                if (!uploadRes.success) {
                    throw new Error(uploadRes.message || '图片上传到工作流失败');
                }
                return uploadRes.file_id;
            };

            const isSingle = !rightImage;

            // 2. 并行/串行上传所需图片
            let leftId = '';
            let rightId = '';

            leftId = await uploadToDify(leftImage.file);
            if (!isSingle && rightImage) {
                rightId = await uploadToDify(rightImage.file);
            }

            // 3. 将 File ID 发送到专属端点拉起分析
            const runResRaw = await fetchWithAuth('/api/layout-compare/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    leftImageId: leftId,
                    rightImageId: rightId,
                    isSingle: isSingle
                })
            });

            const runRes = await runResRaw.json();

            if (!runRes.success) {
                throw new Error(runRes.message || '调用生成比对工作流失败');
            }

            // 4. 展示结果
            setCompareResult(runRes.data);
            window.dispatchEvent(new CustomEvent('app-task-done', { detail: { appId: 'layoutcompare' } }));

        } catch (error: any) {
            console.error('[LayoutCompare Error]', error);
            sysAlert(`对比失败：${error.message}`);
        } finally {
            setIsComparing(false);
        }
    };

    // ======== UI渲染组件抽离 ======== //
    const renderUploadArea = (
        side: 'left' | 'right',
        imageState: CompareImage | null,
        inputRef: React.RefObject<HTMLInputElement | null>,
        clearFn: (e: React.MouseEvent) => void,
        title: string,
        isRequired: boolean
    ) => {
        const isDragOver = dragOverArea === side;

        return (
            <div className="flex-1 flex flex-col gap-3 min-w-0 h-full">
                <div className="flex items-center justify-between px-1">
                    <h3 className="font-semibold text-slate-700 flex items-center gap-2 text-sm">
                        {title}
                        {isRequired && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-sm font-bold">必填</span>}
                        {!isRequired && <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-sm font-bold">选填</span>}
                    </h3>
                    {imageState && (
                        <div className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium bg-emerald-50 px-2 py-1 rounded">
                            <CheckCircle2 className="w-3.5 h-3.5" /> 已就绪
                        </div>
                    )}
                </div>

                <div
                    className={`flex-1 relative rounded-2xl border-2 overflow-hidden transition-all duration-300 group ${imageState
                        ? 'border-transparent shadow-lg shadow-black/5 bg-slate-50'
                        : isDragOver
                            ? 'border-dashed border-sky-400 bg-sky-50'
                            : 'border-dashed border-slate-300 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-400'
                        }`}
                    onDragOver={(e) => { e.preventDefault(); setDragOverArea(side); }}
                    onDragLeave={() => setDragOverArea(null)}
                    onDrop={(e) => handleDrop(e, side)}
                    onClick={() => !imageState && inputRef.current?.click()}
                >
                    <input
                        type="file"
                        ref={inputRef}
                        className="hidden"
                        accept="image/*"
                        onChange={(e) => handleFileChange(e, side)}
                    />

                    {imageState ? (
                        <>
                            {/* 图片承载容器，object-contain 确保无论多高都完整显示 */}
                            <img
                                src={imageState.preview}
                                alt={`${side} preview`}
                                className="absolute inset-0 w-full h-full object-contain p-2"
                            />
                            {/* 悬浮遮罩及动作 */}
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center backdrop-blur-[2px]">
                                <button
                                    onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
                                    className="mb-3 px-5 py-2.5 bg-white/20 hover:bg-white/30 text-white rounded-xl backdrop-blur-md shadow-lg border border-white/20 transition-all text-sm font-medium flex items-center gap-2"
                                >
                                    <UploadCloud className="w-4 h-4" /> 重新选择
                                </button>
                                <button
                                    onClick={clearFn}
                                    className="px-5 py-2.5 bg-red-500/80 hover:bg-red-500 text-white rounded-xl backdrop-blur-md shadow-lg border border-white/20 transition-all text-sm font-medium flex items-center gap-2"
                                >
                                    <X className="w-4 h-4" /> 清除该图
                                </button>
                                <p className="absolute bottom-4 left-4 right-4 text-xs text-white/70 text-center truncate px-4">
                                    {imageState.file.name}
                                </p>
                            </div>
                        </>
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 p-6 cursor-pointer">
                            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-all duration-300 ${isDragOver ? 'bg-sky-100 text-sky-500 scale-110' : 'bg-white shadow-sm border border-slate-100 text-slate-400 group-hover:scale-105 group-hover:shadow group-hover:text-slate-600'
                                }`}>
                                <ImageIcon className="w-7 h-7" />
                            </div>
                            <p className="text-sm font-medium text-slate-600 mb-1">点击打开 或 拖拽图片至此</p>
                            <p className="text-[11px] text-slate-400">支持 JPG, PNG, WEBP (最大 15MB)</p>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // ======== 辅助格式化工具 ======== //
    const formatCompareResult = (text: string) => {
        if (!text) return '';

        // 1. 处理 [类别名称]：将其转换为四级标题，并将紧随其后的冒号也合并到标题中
        let formatted = text.replace(/\[([^\]]+)\]\s*[:：]?/g, '\n\n#### $1：\n\n');

        // 2. 处理差异高亮
        formatted = formatted.replace(/([^→\n]+) \s*→\s* ([^→\n]+)/g, (_match, p1, p2) => {
            let before = p1.trim();
            const after = p2.trim();

            // 如果内容开头仍有冒号（防止漏网），则剥离它
            before = before.replace(/^[:：]\s*/, '');

            return `\n<div class="my-5 flex flex-col gap-2 transition-all">
                <div class="flex items-start gap-2">
                    <span class="shrink-0 mt-1 text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded uppercase">版式 A</span>
                    <div class="flex-1 px-3 py-2 bg-slate-50 text-slate-500 rounded-lg border border-slate-100 text-[0.95em] shadow-sm">${before}</div>
                </div>
                <div class="flex items-center justify-center -my-2 relative z-10 text-emerald-500 font-bold opacity-60">
                    <div class="animate-bounce-subtle">↓</div>
                </div>
                <div class="flex items-start gap-2">
                    <span class="shrink-0 mt-1 text-[10px] font-bold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded uppercase">版式 B</span>
                    <div class="flex-1 px-3 py-2 bg-emerald-50 text-emerald-900 rounded-lg border border-emerald-100 font-bold shadow-md ring-1 ring-emerald-400/20">${after}</div>
                </div>
            </div>\n`;
        });

        return formatted.trim();
    };

    return (
        <div className="h-full flex flex-col gap-6 p-4 sm:p-6 md:p-8 md:px-12 bg-slate-50/50 overflow-y-auto overflow-x-hidden relative">
            {/* Header / 页面指引 */}
            <div className="shrink-0 bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex-1">
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <ArrowRightLeft className="w-5 h-5 text-emerald-500" />
                        A/B 版式视觉对比工具
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">分别上传基准版本和改版文件，对比两者的版式差异及视觉落差感知。</p>
                </div>

                <div className="shrink-0 flex items-start gap-1.5 p-2 bg-blue-50/50 rounded-lg border border-blue-100/50">
                    <Info className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                    <div className="text-[11px] text-slate-600 leading-snug">
                        <span className="font-semibold text-blue-700">智能识别提示：</span>系统将自动识别并处理两种对比输入：<br />
                        1. <span className="font-medium text-slate-700">单张左右分栏图：</span>默认「左侧=版式A，右侧=版式B」<br />
                        2. <span className="font-medium text-slate-700">两张独立图：</span>默认「第一张=版式A，第二张=版式B」
                    </div>
                </div>
            </div>

            {/* Main Workspace: 双栏画廊 - 设置固定高度防止在结果出现时缩放 */}
            <div className="h-[480px] shrink-0 flex gap-6">

                {/* 左侧：基准图 */}
                {renderUploadArea('left', leftImage, leftInputRef, clearLeft, '基准版式 A', true)}

                {/* 中央分割线 */}
                <div className="w-px bg-gradient-to-b from-transparent via-slate-200 to-transparent self-stretch my-8 relative flex flex-col items-center justify-center">
                    <div className="absolute w-8 h-8 rounded-full bg-white border border-slate-200 shadow-sm text-slate-400 flex items-center justify-center text-[10px] font-bold tracking-widest leading-none z-10">
                        VS
                    </div>
                </div>

                {/* 右侧：对比图 */}
                {renderUploadArea('right', rightImage, rightInputRef, clearRight, '对比版式 B', false)}

            </div>

            {/* Bottom Form Control 区与结果呈现 */}
            <div className="shrink-0 bg-white p-4 rounded-2xl border border-slate-200 shadow-[0_-4px_20px_-15px_rgba(0,0,0,0.1)] flex flex-col items-center">
                <button
                    onClick={handleCompare}
                    disabled={isComparing}
                    className={`w-[280px] h-12 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 text-[15px] shrink-0
                        ${leftImage && !isComparing
                            ? 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:-translate-y-0.5'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                        }`}
                >
                    {isComparing ? (
                        <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            AI 正在视觉扫描分析中...
                        </>
                    ) : (
                        <>
                            <ArrowRightLeft className="w-5 h-5" />
                            开始生成对比报告
                        </>
                    )}
                </button>

                {/* 内联的 AI 诊断结果展示文本框 */}
                {compareResult && (
                    <div className="w-full mt-6 bg-white border border-slate-100 rounded-2xl p-6 sm:p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-top-4 duration-500 relative overflow-hidden group">
                        {/* 装饰性背景 */}
                        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50/50 rounded-full -mr-16 -mt-16 blur-3xl group-hover:bg-emerald-100/50 transition-colors duration-700"></div>

                        <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-100 relative">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                                    <Sparkles className="w-5 h-5 text-emerald-600" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-800 text-lg">AI 版面视觉检测反馈</h3>
                                    <p className="text-[11px] text-slate-400">基于深度学习的像素级差异分析报告</p>
                                </div>
                            </div>
                        </div>

                        <div className="prose prose-sm sm:prose-base max-w-none prose-slate prose-img:rounded-xl prose-img:shadow-md prose-headings:text-slate-800 prose-headings:font-bold prose-headings:mt-8 prose-headings:first:mt-0 prose-p:leading-relaxed prose-strong:text-emerald-700 relative">
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                rehypePlugins={[rehypeRaw]}
                                components={{
                                    h4: ({ node, ...props }) => <h4 className="flex items-center gap-2 text-slate-800 mb-4 pb-2 border-b border-slate-50" {...props} />,
                                    p: ({ node, ...props }) => <p className="mb-4 text-slate-600" {...props} />
                                }}
                            >
                                {formatCompareResult(compareResult)}
                            </ReactMarkdown>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
