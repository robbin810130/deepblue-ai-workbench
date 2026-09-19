import React, { useState, useRef, useMemo } from 'react';
import { FileText, Upload, ShieldCheck, AlertTriangle, CheckCircle, ArrowRight, Loader2, Users, Truck, RotateCcw, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import { fetchWithAuth } from '../utils/authFetch';
import { AI_CONTRACT_AUDIT_RUN_ENDPOINT } from '../config';

export const ContractAuditModule: React.FC = () => {
    const [file, setFile] = useState<File | null>(null);
    const [uploadFileId, setUploadFileId] = useState<string | null>(null);
    const [contractType, setContractType] = useState<'client' | 'supplier'>('client');
    const [isScanning, setIsScanning] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [apiResult, setApiResult] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // [Fix #1] 缓存 object URL，防止随 API 数据流回传引发的组件重新渲染导致 iframe 疯狂白屏闪烁
    // 后缀 #zoom=100&navpanes=0 强制渲染 100% 比例，并默认折叠左侧缩略图导航栏以腾出可视宽度
    const fileUrl = useMemo(() => file ? URL.createObjectURL(file) + '#zoom=100&navpanes=0' : '', [file]);

    const handleRemoveFile = (e: React.MouseEvent) => {
        e.stopPropagation();
        setFile(null);
        setUploadFileId(null);
        setApiResult('');
        setErrorMsg('');
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;

        setFile(selectedFile);
        setApiResult('');
        setErrorMsg('');
        setUploadFileId(null);
        setIsUploading(true);

        try {
            const formData = new FormData();
            formData.append('file', selectedFile);

            // D4 试点迁移：改走平台暂存（/api/v1/files/upload），执行时由任务中心上传给 Dify
            const response = await fetchWithAuth('/api/v1/files/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error('文件上传失败');
            const data = await response.json();
            setUploadFileId(data?.data?.file_id || data.id);
        } catch (err: any) {
            setErrorMsg(err.message || '上传过程中出错');
        } finally {
            setIsUploading(false);
        }
    };

    const runScan = async () => {
        if (!file || !uploadFileId) {
            setErrorMsg(!file ? '请先上传合同文件' : '文件尚在上传中，请稍候');
            return;
        }

        setIsScanning(true);
        setApiResult('');
        setErrorMsg('');

        try {
            const payload = {
                inputs: {},
                // [Fix #2] 强制调整提示词：约束大模型只要发现风险条款，必须通过 Markdown 的引用符把原句子原封不动地返回，以便触发前端拦截器画粗红框
                query: (contractType === 'client' ? '客户类合同审核' : '供应商类合同审核') + '。注意：如果在审查过程中发现任何需要修改或包含潜在风险的合同霸王条款，请务必使用 Markdown 的区块引用语法（即以 > 打头）将存在风险的【原始合同原文】予以完整摘录。',
                response_mode: "streaming",
                // D4 试点迁移：传平台暂存 file_id（服务端负责上传给 Dify）
                file_ids: [uploadFileId],
            };

            const response = await fetchWithAuth(AI_CONTRACT_AUDIT_RUN_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error(`请求失败 (${response.status})`);
            if (!response.body) throw new Error("环境不支持流式读取");

            // D4 试点迁移：任务中心模式返回完整 JSON（弃流式）；旧直连模式仍是 SSE。
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const j = await response.json();
                if (j.success === false) throw new Error(j.message || '任务执行失败');
                setApiResult(String(j.data ?? ''));
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6);
                        if (dataStr === '[DONE]') break;
                        try {
                            const eventData = JSON.parse(dataStr);
                            if (eventData.event === 'message' || eventData.event === 'agent_message') {
                                setApiResult(prev => prev + (eventData.answer || ''));
                            } else if (eventData.event === 'error') {
                                throw new Error(eventData.message);
                            }
                        } catch (e) {
                            console.error("解析流失败", e);
                        }
                    }
                }
            }
        } catch (err: any) {
            setErrorMsg(err.message || '审核分析过程中出错');
        } finally {
            setIsScanning(false);
            // 通知菜单栏：后台任务完成
            window.dispatchEvent(new CustomEvent('app-task-done', { detail: { appId: 'contractaudit' } }));
        }
    };

    return (
        <div className="h-full w-full flex flex-col px-6 pt-4 pb-4 space-y-4 text-slate-800 animate-in fade-in slide-in-from-bottom-4 duration-700 overflow-hidden">
            {/* 全新重组的顶部控制台 (标题 + 所有操作区压缩入横向顶栏) */}
            <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between shrink-0 gap-4 bg-white px-6 py-3 rounded-2xl shadow-sm border border-slate-200/60 z-10 relative">
                {/* 标题内容 */}
                <div className="flex flex-col">
                    <h1 className="text-3xl font-black bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent">智能合同审核工作台</h1>
                    <p className="text-slate-500 text-sm mt-1.5 font-medium">基于深度学习 AI 的自动化合规性扫描与多维风险评估</p>
                </div>

                {/* 右侧：交互操作流 */}
                <div className="flex flex-wrap items-center gap-4">
                    {/* 上传按钮群组 */}
                    <div className="relative group flex items-center min-w-[220px]">
                        <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
                        <button
                            onClick={() => !isScanning && !isUploading && fileInputRef.current?.click()}
                            className={`w-full py-3 px-5 rounded-2xl flex items-center justify-center gap-3 font-bold transition-all shadow-sm ${isUploading ? 'bg-slate-100 text-slate-400 cursor-wait' : file ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100' : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-md hover:scale-[1.02]'}`}
                        >
                            {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : (file ? <CheckCircle className="w-5 h-5" /> : <Upload className="w-5 h-5" />)}
                            <span className="truncate max-w-[160px] text-sm">{isUploading ? '上传解析中...' : (file ? file.name : '上传待审核合同')}</span>
                        </button>
                        {file && !isScanning && !isUploading && (
                            <button
                                onClick={handleRemoveFile}
                                className="absolute -top-2 -right-2 p-1.5 bg-red-100 text-red-500 rounded-full hover:bg-red-200 hover:scale-110 shadow-sm border border-red-200 z-10"
                                title="删除并重新上传"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    <div className="w-px h-10 bg-slate-200 hidden sm:block" />

                    {/* 合同类型切换滑块 */}
                    <div className="flex bg-slate-100/80 p-1.5 rounded-2xl border border-slate-200/50 relative">
                        <div className={`absolute top-1.5 bottom-1.5 w-[calc(50%-6px)] bg-white rounded-xl shadow-[0_2px_8px_-2px_rgba(0,0,0,0.1)] transition-transform duration-500 ease-out ${contractType === 'supplier' ? 'translate-x-[calc(100%+4px)]' : 'translate-x-0'}`} />
                        <button
                            onClick={() => setContractType('client')}
                            className={`relative z-10 py-2.5 px-6 rounded-xl flex items-center justify-center gap-2 text-sm font-bold transition-colors ${contractType === 'client' ? 'text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <Users className="w-4 h-4" /> 客户类
                        </button>
                        <button
                            onClick={() => setContractType('supplier')}
                            className={`relative z-10 py-2.5 px-6 rounded-xl flex items-center justify-center gap-2 text-sm font-bold transition-colors ${contractType === 'supplier' ? 'text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <Truck className="w-4 h-4" /> 供应商类
                        </button>
                    </div>

                    {/* 运行检测大按钮 */}
                    <button
                        onClick={runScan}
                        disabled={isScanning || isUploading || !file || !uploadFileId}
                        className={`ml-2 group h-12 px-8 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all duration-500 relative overflow-hidden shadow-md shrink-0
                            ${isScanning ? 'bg-slate-100 text-slate-400 border border-slate-200 shadow-none' :
                                file && uploadFileId ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-700 text-white hover:scale-[1.03] active:scale-95 shadow-blue-500/30' :
                                    'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'}
                        `}
                    >
                        {isScanning ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                <span>AI 深度剖析中...</span>
                            </>
                        ) : (
                            <>
                                <ShieldCheck className="w-5 h-5" />
                                <span>执行合规检测</span>
                                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                            </>
                        )}
                        {!isScanning && file && uploadFileId && <div className="absolute inset-0 bg-white/20 translate-x-[-100%] hover:translate-x-[100%] transition-transform duration-1000 skew-x-12" />}
                    </button>
                </div>
            </div>

            {/* 下侧巨幕区：分为 55% 极大图预览 与 45% 高亮审查结果 */}
            <div className="flex flex-col lg:flex-row gap-4 flex-1 overflow-hidden">

                {/* 修改主题为亮色调的全景源文件预览，彻底变大 */}
                <div className="hidden lg:flex flex-col bg-slate-50 rounded-2xl shadow-inner border border-slate-200/80 overflow-hidden relative w-full lg:w-[55%] shrink-0">
                    <div className="bg-white/80 px-4 py-3 flex items-center justify-between shrink-0 border-b border-slate-200/80 backdrop-blur-md">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center border border-blue-100">
                                <FileText className="w-5 h-5 text-blue-500" />
                            </div>
                            <div>
                                <h3 className="text-xl font-black text-slate-800 m-0 tracking-wide">源文件全景预览区</h3>
                                <div className="text-sm text-slate-400 font-bold tracking-wider mt-1">{file ? file.name : '管理上传合同控件'}</div>
                            </div>
                        </div>
                    </div>
                    {/* 亮色底板与 IFrame 显影 */}
                    <div className="flex-1 p-2 overflow-hidden relative flex items-center justify-center bg-slate-200/50">
                        {file ? (
                            file.name.toLowerCase().endsWith('.docx') || file.name.toLowerCase().endsWith('.doc') ? (
                                <div className="text-center flex flex-col items-center justify-center h-full space-y-6 px-8 animate-in fade-in duration-500">
                                    <FileText className="w-24 h-24 mx-auto text-slate-300 drop-shadow-sm" />

                                    <div className="bg-red-50 rounded-2xl p-6 border border-red-200 shadow-sm max-w-lg relative overflow-hidden">
                                        <div className="absolute top-0 left-0 w-1 h-full bg-red-500"></div>
                                        <div className="flex items-start gap-4">
                                            <AlertTriangle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
                                            <div className="text-left space-y-2">
                                                <h3 className="text-lg font-black text-red-900 tracking-tight">
                                                    不支持的文档预览格式
                                                </h3>
                                                <p className="text-[#b91c1c] text-sm font-bold leading-relaxed">
                                                    系统在此区域只有 <span className="bg-red-100 px-1 py-0.5 rounded text-red-800 border border-red-200 shadow-sm">.pdf</span> 格式文件可以展示原版高保真预览，<span className="bg-red-100 px-1 py-0.5 rounded border border-red-200 text-red-800/80 shadow-sm inline-block">.docx</span> 和 <span className="bg-red-100 px-1 py-0.5 rounded border border-red-200 text-red-800/80 shadow-sm inline-block">.doc</span> 文件无法预览。
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-amber-50 rounded-2xl p-5 border border-amber-200 max-w-lg shadow-sm w-full mx-auto relative overflow-hidden backdrop-blur-sm group">
                                        <div className="absolute top-0 right-0 w-8 h-8 flex items-center justify-center translate-x-3 -translate-y-3 rounded-full bg-amber-100 mix-blend-multiply opacity-50 group-hover:scale-150 transition-transform"></div>
                                        <p className="text-amber-900 font-black text-base tracking-wide flex items-center justify-center gap-2">
                                            ⚠️ 重要复杂合同，务必传 PDF 原件用于过审！
                                        </p>
                                    </div>

                                    <div className="bg-blue-50/50 rounded-xl p-4 border border-blue-100 shadow-sm max-w-lg">
                                        <p className="text-xs text-blue-600/80 leading-relaxed font-bold">
                                            ✅ 注：文件的数据流已送达，只是无法展现肉眼可视化预览。<br />您仍可正常点击右上方的【执行合规检测】获取 AI 风险分析报告。
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <iframe
                                    src={fileUrl}
                                    className="w-full h-full rounded-xl bg-white shadow-lg border border-slate-200/60"
                                    title="document-preview"
                                />
                            )
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full space-y-8 animate-in fade-in duration-700">
                                <div className="text-center text-slate-400 flex flex-col items-center relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                                    <div className="absolute inset-0 bg-blue-100 rounded-full scale-0 group-hover:scale-150 opacity-0 group-hover:opacity-20 transition-all duration-500"></div>
                                    <Upload className="w-16 h-16 mx-auto mb-4 opacity-30 group-hover:opacity-60 transition-opacity group-hover:text-blue-500 group-hover:-translate-y-2 duration-300" />
                                    <p className="text-xl font-bold tracking-widest group-hover:text-blue-600 transition-colors mt-2">点击此处载入合同数据</p>
                                </div>
                                <div className="bg-gradient-to-br from-amber-50 to-orange-50/30 rounded-2xl p-5 border border-amber-200/60 shadow-sm max-w-sm w-full mx-auto relative overflow-hidden">
                                    <div className="flex items-start gap-4">
                                        <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                                        <div className="text-left space-y-1.5">
                                            <p className="text-amber-900 font-bold text-base tracking-wide">
                                                重要复杂合同，务必上传 <span className="text-amber-700 bg-amber-100/80 px-2 py-0.5 rounded border border-amber-200 shadow-sm">PDF 原件</span>
                                            </p>
                                            <p className="text-amber-700/70 text-sm font-medium leading-relaxed mt-1">
                                                为了保证与真实纸质文件 100% 无偏差且防止错版断行，本系统前端画板不支持非 PDF 格式源文件的直出渲染。
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* 右栏：结果展示与红框高亮区 */}
                <div className="relative flex flex-col min-h-0 w-full lg:w-[45%] flex-1">
                    {/* 扫描时的覆盖层 */}
                    {isScanning && (
                        <div className="absolute inset-0 z-20 rounded-2xl border border-blue-200 bg-white/40 backdrop-blur-sm flex flex-col items-center justify-center space-y-4">
                            <div className="w-16 h-1 border-slate-100 bg-slate-100 rounded-full relative overflow-hidden">
                                <div className="absolute inset-0 bg-blue-500 animate-[loading_1.5s_infinite]" />
                            </div>
                            <span className="text-blue-600 font-bold text-sm tracking-widest animate-pulse">正在精读合同条款...</span>
                        </div>
                    )}

                    <div className={`flex-1 rounded-2xl p-6 border transition-all duration-500 shadow-2xl overflow-y-auto custom-scrollbar ${apiResult || errorMsg ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-100 flex items-center justify-center opacity-60'}`}>
                        {errorMsg ? (
                            <div className="flex flex-col items-center justify-center h-full text-center space-y-4 animate-in fade-in zoom-in-95">
                                <AlertTriangle className="w-12 h-12 text-red-500" />
                                <div className="text-red-500 font-bold">{errorMsg}</div>
                                <button
                                    onClick={() => { setErrorMsg(''); setFile(null); setUploadFileId(null); }}
                                    className="px-6 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-600 font-bold text-sm transition-colors flex items-center gap-2"
                                >
                                    <RotateCcw className="w-4 h-4" /> 重新尝试
                                </button>
                            </div>
                        ) : apiResult ? (
                            <div className="prose prose-slate max-w-none animate-in fade-in duration-500">
                                <div className="flex items-center gap-3 mb-8 pb-4 border-b border-slate-100 shrink-0">
                                    <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-100">
                                        <ShieldCheck className="w-6 h-6 text-white" />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-black text-slate-800 m-0">AI 审核报告</h3>
                                        <div className="text-xs text-slate-400 font-bold tracking-wider">结构化分析结果</div>
                                    </div>
                                </div>

                                <div className="prose prose-slate max-w-none text-slate-700 leading-relaxed text-sm">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm, remarkBreaks]}
                                        rehypePlugins={[rehypeRaw]}
                                        components={{
                                            h1: ({ node, ...props }) => <h1 className="text-2xl font-black text-slate-900 mb-4 mt-8" {...props} />,
                                            h2: ({ node, ...props }) => <h2 className="text-xl font-bold text-slate-800 mb-3 mt-6 border-l-4 border-blue-500 pl-3" {...props} />,
                                            h3: ({ node, ...props }) => <h3 className="text-lg font-bold text-slate-800 mb-2 mt-4" {...props} />,
                                            p: ({ node, ...props }) => <p className="mb-4 text-slate-600" {...props} />,
                                            ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-4 space-y-2" {...props} />,
                                            ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-4 space-y-2" {...props} />,
                                            li: ({ node, ...props }) => <li className="text-slate-600" {...props} />,
                                            table: ({ node, ...props }) => (
                                                <div className="overflow-x-auto my-6 rounded-xl border border-slate-200">
                                                    <table className="min-w-full divide-y divide-slate-200" {...props} />
                                                </div>
                                            ),
                                            thead: ({ node, ...props }) => <thead className="bg-slate-50" {...props} />,
                                            th: ({ node, ...props }) => <th className="px-4 py-3 text-left text-xs font-black text-slate-500 uppercase tracking-wider" {...props} />,
                                            td: ({ node, ...props }) => <td className="px-4 py-3 text-sm text-slate-600 border-t border-slate-100" {...props} />,
                                            blockquote: ({ node, ...props }) => (
                                                <blockquote className="my-5 pl-4 border-l-4 border-emerald-500 bg-emerald-50 rounded-r-xl py-4 pr-5 shadow-sm relative overflow-hidden group">
                                                    {/* 左侧优化后的刺眼流光 (改为绿色) */}
                                                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-emerald-500 to-teal-600 group-hover:w-1.5 transition-all duration-300" />
                                                    {/* 背景巨大警报图标投射 (改为绿色) */}
                                                    <div className="absolute -bottom-4 -right-4 text-emerald-300 opacity-10 group-hover:opacity-20 transition-opacity duration-300 pointer-events-none">
                                                        <AlertTriangle className="w-24 h-24" />
                                                    </div>
                                                    {/* 文本体 (改为色温更舒适的深绿) */}
                                                    <div className="text-emerald-900 font-bold text-[14px] leading-relaxed relative z-10 selection:bg-emerald-200">
                                                        {props.children}
                                                    </div>
                                                </blockquote>
                                            ),
                                            code: ({ node, ...props }) => <code className="bg-slate-100 px-1 rounded text-blue-600 font-mono text-xs" {...props} />
                                        }}
                                    >
                                        {apiResult}
                                    </ReactMarkdown>
                                </div>

                                {isScanning && (
                                    <div className="mt-4 flex items-center gap-2 text-blue-500 font-bold text-xs animate-pulse italic">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        <span>AI 正在深入解读后续条款...</span>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center text-center max-w-[200px]">
                                <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                                    <ShieldCheck className="w-8 h-8 text-slate-300" />
                                </div>
                                <h4 className="text-xl font-bold text-slate-400 mb-2">待检测</h4>
                                <p className="text-sm text-slate-400 mt-2 leading-relaxed max-w-[280px]">上传合同并点击“执行合规审查”，AI 审查结果将在此处输出格式且高明的鉴定。</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes loading {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(100%); }
                }
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #e2e8f0;
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: #cbd5e1;
                }
                
                /* =========================================
                   Docx-Preview 渲染引擎的视觉劫持与暴力修正
                   ========================================= */
                   
                /* 修复 Word 纸张背景与留白边距（注意：配置了 className='docx-document' 所以后缀改变） */
                .docx-document-wrapper {
                    padding: 0 !important;
                    background: transparent !important;
                }
                .docx-document-wrapper > section.docx-document {
                    box-shadow: none !important;
                    margin-bottom: 32px !important;
                    border-radius: 4px !important;
                    min-height: auto !important;
                    width: 100% !important; 
                    padding: 0 !important;
                }
                
                /* 修复合同表格中的宽度爆炸与错位溢出（如：金额合并单元格被挤压） */
                .docx-document table {
                    width: 100% !important;
                    max-width: 100% !important;
                    table-layout: auto !important; /* 让表格自适应而不会超出框线 */
                    border-collapse: collapse !important;
                    word-break: break-all !important;
                    margin-bottom: 2rem !important;
                    margin-top: 1rem !important;
                }
                .docx-document table td, 
                .docx-document table th {
                    border: 2px solid #cbd5e1 !important; /* 强制画出边框，防止隐形 */
                    padding: 6px 12px !important;
                    position: static !important; /* 防止浮动错位 */
                    width: auto !important; /* 抹杀原生 word 中带过来的内联绝对宽度 */
                }

                /* 修正下划线填空、特殊符号或印章造成的宽度错乱 */
                .docx-document p {
                    word-wrap: break-word !important;
                    white-space: pre-wrap !important;
                    max-width: 100% !important;
                    width: auto !important;
                    margin: 0.5em 0 !important;
                    padding: 0 !important;
                }
                
                /* 修复超大封面图片挤爆 A4 纸容器（例如 Deepblue 标志） */
                .docx-document img {
                    max-width: 100% !important;
                    height: auto !important;
                    object-fit: contain !important;
                    display: block !important;
                    margin: 0 auto !important; /* 保证图标强制居中 */
                }
                
                /* 削弱不可见元素的占位符误差（防止顶部出现异常巨型留白） */
                .docx-document .docx-ignore {
                    display: none !important;
                }
            `}</style>
        </div>
    );
};

export default ContractAuditModule;
