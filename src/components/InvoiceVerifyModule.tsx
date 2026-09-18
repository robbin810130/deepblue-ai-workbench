import React, { useState, useRef, useEffect, useCallback } from 'react';
import { UploadCloud, FileText, FileSpreadsheet, X, CheckCircle2, Loader2, Sparkles, History, Trash2, Receipt } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { fetchWithAuth } from '../utils/authFetch';
import { sysAlert } from '../utils/dialog';

interface UploadedFile {
    file: File;
    preview: string; // object URL or file name
}

interface HistoryRecord {
    id: number;
    pdf_name: string;
    xlsx_name: string;
    result_text: string;
    supplier_name?: string;
    status?: string;
    created_at: string;
    username: string;
}

export const InvoiceVerifyModule: React.FC = () => {
    // 上传文件状态
    const [pdfFiles, setPdfFiles] = useState<UploadedFile[]>([]);
    const [xlsxFiles, setXlsxFiles] = useState<UploadedFile[]>([]);

    // 进度与结果状态
    const [isVerifying, setIsVerifying] = useState(false);
    const [verifyResult, setVerifyResult] = useState<string>('');

    // 拖动状态
    const [dragOverArea, setDragOverArea] = useState<'pdf' | 'xlsx' | null>(null);

    // 历史记录
    const [history, setHistory] = useState<HistoryRecord[]>([]);
    const [showHistory, setShowHistory] = useState(false);

    // 当前查看的报告状态（用于状态操作）
    const [currentRecordId, setCurrentRecordId] = useState<number | null>(null);
    const [currentRecordStatus, setCurrentRecordStatus] = useState<string>('');

    const pdfInputRef = useRef<HTMLInputElement>(null);
    const xlsxInputRef = useRef<HTMLInputElement>(null);
    const resultRef = useRef<HTMLDivElement>(null);

    // ======== 加载历史记录 ======== //
    const loadHistory = useCallback(async () => {
        try {
            const res = await fetchWithAuth('/api/invoice-verify/history');
            const data = await res.json();
            if (data.success) {
                setHistory(data.data || []);
            }
        } catch (e) {
            console.warn('加载历史记录失败', e);
        }
    }, []);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    // ======== 清理函数 ======== //
    const clearPdfFiles = () => {
        pdfFiles.forEach(f => URL.revokeObjectURL(f.preview));
        setPdfFiles([]);
        if (pdfInputRef.current) pdfInputRef.current.value = '';
    };

    const clearXlsxFiles = () => {
        xlsxFiles.forEach(f => URL.revokeObjectURL(f.preview));
        setXlsxFiles([]);
        if (xlsxInputRef.current) xlsxInputRef.current.value = '';
    };

    // ======== 文件处理逻辑 ======== //
    const addPdfFiles = (files: FileList) => {
        const newFiles: UploadedFile[] = [];
        const currentCount = pdfFiles.length;
        const currentSize = pdfFiles.reduce((sum, f) => sum + f.file.size, 0);
        let addedSize = 0;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (file.type !== 'application/pdf') {
                sysAlert(`文件 "${file.name}" 不是 PDF 格式，已跳过`);
                continue;
            }
            if (currentCount + newFiles.length >= 4) {
                sysAlert(`最多上传 4 个文件，已跳过 "${file.name}"`);
                break;
            }
            if (currentSize + addedSize + file.size > 100 * 1024 * 1024) {
                sysAlert(`文件总大小超过 100MB，已跳过 "${file.name}"`);
                continue;
            }
            addedSize += file.size;
            newFiles.push({ file, preview: URL.createObjectURL(file) });
        }
        if (newFiles.length > 0) {
            setPdfFiles(prev => [...prev, ...newFiles]);
        }
    };

    const addXlsxFiles = (files: FileList) => {
        const newFiles: UploadedFile[] = [];
        const currentCount = xlsxFiles.length;
        const currentSize = xlsxFiles.reduce((sum, f) => sum + f.file.size, 0);
        let addedSize = 0;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const isValid = file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                || file.type === 'application/vnd.ms-excel'
                || file.name.endsWith('.xlsx')
                || file.name.endsWith('.xls');
            if (!isValid) {
                sysAlert(`文件 "${file.name}" 不是 Excel 格式，已跳过`);
                continue;
            }
            if (currentCount + newFiles.length >= 4) {
                sysAlert(`最多上传 4 个文件，已跳过 "${file.name}"`);
                break;
            }
            if (currentSize + addedSize + file.size > 100 * 1024 * 1024) {
                sysAlert(`文件总大小超过 100MB，已跳过 "${file.name}"`);
                continue;
            }
            addedSize += file.size;
            newFiles.push({ file, preview: URL.createObjectURL(file) });
        }
        if (newFiles.length > 0) {
            setXlsxFiles(prev => [...prev, ...newFiles]);
        }
    };

    const removePdfFile = (index: number) => {
        setPdfFiles(prev => {
            const removed = prev[index];
            if (removed) URL.revokeObjectURL(removed.preview);
            return prev.filter((_, i) => i !== index);
        });
    };

    const removeXlsxFile = (index: number) => {
        setXlsxFiles(prev => {
            const removed = prev[index];
            if (removed) URL.revokeObjectURL(removed.preview);
            return prev.filter((_, i) => i !== index);
        });
    };

    const handlePdfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) addPdfFiles(e.target.files);
    };

    const handleXlsxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) addXlsxFiles(e.target.files);
    };

    const handleDrop = (e: React.DragEvent, area: 'pdf' | 'xlsx') => {
        e.preventDefault();
        setDragOverArea(null);
        const files = e.dataTransfer.files;
        if (area === 'pdf') addPdfFiles(files);
        else addXlsxFiles(files);
    };

    // ======== 核心校验逻辑 ======== //
    const handleVerify = async () => {
        if (pdfFiles.length === 0) {
            sysAlert('请至少上传一个发票 PDF 文件！');
            return;
        }
        if (xlsxFiles.length === 0) {
            sysAlert('请至少上传一个 xlsx 表格文件！');
            return;
        }

        try {
            setIsVerifying(true);
            setVerifyResult('');

            // 1. 上传所有文件到 Dify 获取 file_id
            const uploadToDify = async (file: File): Promise<string> => {
                const formData = new FormData();
                formData.append('file', file);

                const uploadResRaw = await fetchWithAuth('/api/invoice-verify/upload', {
                    method: 'POST',
                    body: formData
                });

                const uploadRes = await uploadResRaw.json();
                if (!uploadRes.success) {
                    throw new Error(uploadRes.message || '文件上传到工作流失败');
                }
                return uploadRes.file_id;
            };

            // 并行上传所有文件
            const pdfIds = await Promise.all(pdfFiles.map(f => uploadToDify(f.file)));
            const xlsxIds = await Promise.all(xlsxFiles.map(f => uploadToDify(f.file)));

            // 2. 调用校验工作流
            const runResRaw = await fetchWithAuth('/api/invoice-verify/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pdfIds,
                    xlsxIds,
                    pdfNames: pdfFiles.map(f => f.file.name),
                    xlsxNames: xlsxFiles.map(f => f.file.name),
                })
            });

            const runRes = await runResRaw.json();
            if (!runRes.success) {
                throw new Error(runRes.message || '调用发票校验工作流失败');
            }

            // 3. 展示结果
            setVerifyResult(runRes.data);
            // 设置当前记录ID和状态（新校验结果默认为待确认）
            if (runRes.isVerifySuccess && runRes.historyId) {
                setCurrentRecordId(runRes.historyId);
                setCurrentRecordStatus('待确认');
            } else {
                setCurrentRecordId(null);
                setCurrentRecordStatus('');
            }
            loadHistory(); // 刷新历史
            window.dispatchEvent(new CustomEvent('app-task-done', { detail: { appId: 'invoiceverify' } }));

            // 只有校验成功才清空上传文件
            if (runRes.isVerifySuccess) {
                clearPdfFiles();
                clearXlsxFiles();
            }

            // 自动滚动到结果区域
            setTimeout(() => {
                resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 300);

        } catch (error: any) {
            console.error('[InvoiceVerify Error]', error);
            sysAlert(`校验失败：${error.message}`);
        } finally {
            setIsVerifying(false);
        }
    };

    // ======== 查看历史记录详情 ======== //
    const viewHistoryResult = (record: HistoryRecord) => {
        setVerifyResult(record.result_text);
        setCurrentRecordId(record.id);
        setCurrentRecordStatus(record.status || '待确认');
        setShowHistory(false);
        // 自动滚动到结果区域
        setTimeout(() => {
            resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 200);
    };

    // ======== 删除历史记录 ======== //
    const deleteHistoryRecord = async (id: number) => {
        if (!window.confirm('确定要删除这条校验记录吗？')) return;
        try {
            const res = await fetchWithAuth(`/api/invoice-verify/history/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                loadHistory();
            } else {
                sysAlert(`删除失败：${data.message}`);
            }
        } catch (error: any) {
            console.error('[InvoiceVerify Delete Error]', error);
            sysAlert(`删除失败：${error.message}`);
        }
    };

    // ======== 更新历史记录状态 ======== //
    const updateHistoryStatus = async (id: number, newStatus: string) => {
        try {
            const res = await fetchWithAuth(`/api/invoice-verify/history/${id}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });
            const data = await res.json();
            if (data.success) {
                loadHistory();
                // 如果当前正在查看这条记录，同步更新状态
                if (currentRecordId === id) {
                    setCurrentRecordStatus(newStatus);
                }
            } else {
                sysAlert(`状态更新失败：${data.message}`);
            }
        } catch (error: any) {
            console.error('[InvoiceVerify Status Update Error]', error);
            sysAlert(`状态更新失败：${error.message}`);
        }
    };

    // ======== 格式化校验结果 ======== //
    const formatVerifyResult = (text: string) => {
        if (!text) return '';
        let formatted = text.replace(/\[([^\]]+)\]\s*[:：]?/g, '\n\n#### $1：\n\n');
        return formatted.trim();
    };

    // ======== 上传区域渲染 ======== //
    const renderUploadArea = (
        area: 'pdf' | 'xlsx',
        files: UploadedFile[],
        inputRef: React.RefObject<HTMLInputElement | null>,
        clearFn: () => void,
        removeFn: (index: number) => void,
        title: string,
        icon: React.ReactNode,
        accept: string,
        color: string
    ) => {
        const isDragOver = dragOverArea === area;

        return (
            <div className="flex-1 flex flex-col gap-3 min-w-0">
                <div className="flex items-center justify-between px-1">
                    <h3 className="font-semibold text-slate-700 flex items-center gap-2 text-sm">
                        {icon}
                        {title}
                        <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-sm font-bold">必填</span>
                    </h3>
                    {files.length > 0 && (
                        <div className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium bg-emerald-50 px-2 py-1 rounded">
                            <CheckCircle2 className="w-3.5 h-3.5" /> {files.length} 个文件
                        </div>
                    )}
                </div>

                <div
                    className={`flex-1 min-h-[200px] relative rounded-2xl border-2 overflow-hidden transition-all duration-300 group ${
                        files.length > 0
                            ? 'border-transparent shadow-lg shadow-black/5 bg-slate-50'
                            : isDragOver
                                ? `border-dashed ${color === 'blue' ? 'border-blue-400 bg-blue-50' : 'border-green-400 bg-green-50'}`
                                : 'border-dashed border-slate-300 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-400'
                    }`}
                    onDragOver={(e) => { e.preventDefault(); setDragOverArea(area); }}
                    onDragLeave={() => setDragOverArea(null)}
                    onDrop={(e) => handleDrop(e, area)}
                    onClick={() => files.length === 0 && inputRef.current?.click()}
                >
                    <input
                        type="file"
                        ref={inputRef}
                        className="hidden"
                        accept={accept}
                        multiple
                        onChange={area === 'pdf' ? handlePdfChange : handleXlsxChange}
                    />

                    {files.length > 0 ? (
                        <div className="absolute inset-0 p-4 overflow-y-auto">
                            <div className="flex flex-col gap-2">
                                {files.map((f, idx) => (
                                    <div key={idx} className="flex items-center gap-3 bg-white rounded-xl px-4 py-2.5 shadow-sm border border-slate-100 group/item hover:shadow-md transition-all">
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${color === 'blue' ? 'bg-blue-50 text-blue-500' : 'bg-green-50 text-green-500'}`}>
                                            {area === 'pdf' ? <FileText className="w-4 h-4" /> : <FileSpreadsheet className="w-4 h-4" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-slate-700 truncate">{f.file.name}</p>
                                            <p className="text-[11px] text-slate-400">{(f.file.size / 1024 / 1024).toFixed(2)} MB</p>
                                        </div>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); removeFn(idx); }}
                                            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover/item:opacity-100"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <div className="flex items-center gap-2 mt-3">
                                <button
                                    onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
                                    className="text-xs text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-all"
                                >
                                    <UploadCloud className="w-3.5 h-3.5" /> 继续添加
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); clearFn(); }}
                                    className="text-xs text-red-400 hover:text-red-500 font-medium flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-all"
                                >
                                    <Trash2 className="w-3.5 h-3.5" /> 清空全部
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 p-6 cursor-pointer">
                            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-all duration-300 ${
                                isDragOver
                                    ? `${color === 'blue' ? 'bg-blue-100 text-blue-500' : 'bg-green-100 text-green-500'} scale-110`
                                    : 'bg-white shadow-sm border border-slate-100 text-slate-400 group-hover:scale-105 group-hover:shadow group-hover:text-slate-600'
                            }`}>
                                {area === 'pdf' ? <FileText className="w-7 h-7" /> : <FileSpreadsheet className="w-7 h-7" />}
                            </div>
                            <p className="text-sm font-medium text-slate-600 mb-1">点击打开 或 拖拽文件至此</p>
                            <p className="text-[11px] text-slate-400">{area === 'pdf' ? '支持 PDF 格式，最多 4 个文件' : '支持 XLSX/XLS 格式，最多 4 个文件'}，总大小不超过 100MB</p>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="h-full flex flex-col gap-6 p-4 sm:p-6 md:p-8 md:px-12 bg-slate-50/50 overflow-y-auto overflow-x-hidden relative">
            {/* Header */}
            <div className="shrink-0 bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex-1">
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Receipt className="w-5 h-5 text-blue-500" />
                        发票校验工具
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">上传发票 PDF 和 xlsx 表格，系统自动对比商品名称、开票金额、税率等细节差异。</p>
                </div>

                <div className="shrink-0 flex items-center gap-2">
                    <button
                        onClick={() => setShowHistory(!showHistory)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                            showHistory
                                ? 'bg-blue-50 text-blue-600 border border-blue-200'
                                : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'
                        }`}
                    >
                        <History className="w-4 h-4" />
                        历史记录
                    </button>
                </div>
            </div>

            {/* 历史记录面板 */}
            {showHistory && (
                <div className="shrink-0 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
                    <h3 className="font-semibold text-slate-700 flex items-center gap-2 mb-3">
                        <History className="w-4 h-4 text-blue-500" />
                        校验历史记录
                    </h3>
                    {history.length === 0 ? (
                        <p className="text-sm text-slate-400 text-center py-6">暂无历史记录</p>
                    ) : (
                        <div className="max-h-[300px] overflow-y-auto">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-slate-50">
                                    <tr className="border-b border-slate-200">
                                        <th className="text-left py-2 px-3 font-medium text-slate-500">时间</th>
                                        <th className="text-left py-2 px-3 font-medium text-slate-500">PDF 文件</th>
                                        <th className="text-left py-2 px-3 font-medium text-slate-500">XLSX 文件</th>
                                        <th className="text-left py-2 px-3 font-medium text-slate-500">供应商</th>
                                        <th className="text-left py-2 px-3 font-medium text-slate-500">操作人</th>
                                        <th className="text-left py-2 px-3 font-medium text-slate-500">状态</th>
                                        <th className="text-left py-2 px-3 font-medium text-slate-500">操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {history.map((record) => (
                                        <tr key={record.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                            <td className="py-2 px-3 text-slate-600 text-xs">{new Date(record.created_at).toLocaleString('zh-CN')}</td>
                                            <td className="py-2 px-3 text-slate-700 text-xs truncate max-w-[150px]">{record.pdf_name}</td>
                                            <td className="py-2 px-3 text-slate-700 text-xs truncate max-w-[150px]">{record.xlsx_name}</td>
                                            <td className="py-2 px-3 text-slate-700 text-xs truncate max-w-[120px]">{record.supplier_name || '-'}</td>
                                            <td className="py-2 px-3 text-slate-500 text-xs">{record.username}</td>
                                            <td className="py-2 px-3">
                                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                                    record.status === '已确认' ? 'bg-green-100 text-green-700' :
                                                    record.status === '已退票' ? 'bg-red-100 text-red-700' :
                                                    'bg-yellow-100 text-yellow-700'
                                                }`}>
                                                    {record.status || '待确认'}
                                                </span>
                                            </td>
                                            <td className="py-2 px-3">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <button
                                                        onClick={() => viewHistoryResult(record)}
                                                        className="text-xs text-blue-500 hover:text-blue-600 font-medium"
                                                    >
                                                        查看结果
                                                    </button>
                                                    {(!record.status || record.status === '待确认') && (
                                                        <>
                                                            <button
                                                                onClick={() => updateHistoryStatus(record.id, '已确认')}
                                                                className="text-xs text-green-500 hover:text-green-600 font-medium"
                                                            >
                                                                已确认
                                                            </button>
                                                            <button
                                                                onClick={() => updateHistoryStatus(record.id, '已退票')}
                                                                className="text-xs text-orange-500 hover:text-orange-600 font-medium"
                                                            >
                                                                已退票
                                                            </button>
                                                        </>
                                                    )}
                                                    <button
                                                        onClick={() => deleteHistoryRecord(record.id)}
                                                        className="text-xs text-red-400 hover:text-red-500 font-medium"
                                                    >
                                                        删除
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* Main Workspace: 双栏上传区 */}
            <div className="h-[360px] shrink-0 flex gap-6">
                {renderUploadArea('pdf', pdfFiles, pdfInputRef, clearPdfFiles, removePdfFile, '发票 PDF 文件', <FileText className="w-4 h-4" />, '.pdf', 'blue')}

                {/* 中央分割线 */}
                <div className="w-px bg-gradient-to-b from-transparent via-slate-200 to-transparent self-stretch my-8 relative flex flex-col items-center justify-center">
                    <div className="absolute w-8 h-8 rounded-full bg-white border border-slate-200 shadow-sm text-slate-400 flex items-center justify-center text-[10px] font-bold tracking-widest leading-none z-10">
                        VS
                    </div>
                </div>

                {renderUploadArea('xlsx', xlsxFiles, xlsxInputRef, clearXlsxFiles, removeXlsxFile, 'XLSX 表格文件', <FileSpreadsheet className="w-4 h-4" />, '.xlsx,.xls', 'green')}
            </div>

            {/* Bottom: 操作按钮与结果 */}
            <div className="shrink-0 bg-white p-4 rounded-2xl border border-slate-200 shadow-[0_-4px_20px_-15px_rgba(0,0,0,0.1)] flex flex-col items-center">
                <button
                    onClick={handleVerify}
                    disabled={isVerifying}
                    className={`w-[280px] h-12 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 text-[15px] shrink-0
                        ${pdfFiles.length > 0 && xlsxFiles.length > 0 && !isVerifying
                            ? 'bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 text-white shadow-blue-500/30 hover:shadow-blue-500/50 hover:-translate-y-0.5'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                        }`}
                >
                    {isVerifying ? (
                        <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            正在校验发票中...
                        </>
                    ) : (
                        <>
                            <Receipt className="w-5 h-5" />
                            开始发票校验
                        </>
                    )}
                </button>

                {/* AI 校验结果展示 */}
                {verifyResult && (
                    <div ref={resultRef} className="w-full mt-6 bg-white border border-slate-100 rounded-2xl p-4 sm:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-top-4 duration-500 relative overflow-hidden group">
                        {/* 装饰性背景 */}
                        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50/50 rounded-full -mr-16 -mt-16 blur-3xl group-hover:bg-blue-100/50 transition-colors duration-700"></div>

                        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100 relative">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                                    <Sparkles className="w-5 h-5 text-blue-600" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-800 text-lg">发票校验报告</h3>
                                    <p className="text-[11px] text-slate-400">商品名称、开票金额、税率差异分析</p>
                                </div>
                            </div>
                            {/* 状态操作按钮（只有待确认状态才显示） */}
                            {currentRecordId && currentRecordStatus === '待确认' && (
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => updateHistoryStatus(currentRecordId, '已确认')}
                                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-50 text-green-600 hover:bg-green-100 border border-green-200 transition-all"
                                    >
                                        已确认
                                    </button>
                                    <button
                                        onClick={() => updateHistoryStatus(currentRecordId, '已退票')}
                                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-50 text-orange-600 hover:bg-orange-100 border border-orange-200 transition-all"
                                    >
                                        已退票
                                    </button>
                                </div>
                            )}
                            {/* 状态标签（已确认/已退票时显示） */}
                            {currentRecordId && currentRecordStatus !== '待确认' && (
                                <span className={`text-xs px-3 py-1 rounded-full font-medium ${
                                    currentRecordStatus === '已确认' ? 'bg-green-100 text-green-700' :
                                    currentRecordStatus === '已退票' ? 'bg-red-100 text-red-700' :
                                    'bg-yellow-100 text-yellow-700'
                                }`}>
                                    {currentRecordStatus}
                                </span>
                            )}
                        </div>

                        <div className="prose prose-sm max-w-none prose-headings:text-slate-800 prose-headings:font-bold prose-headings:mt-6 prose-headings:first:mt-0 prose-p:leading-relaxed prose-strong:text-blue-700 relative">
                            {/* 表格横向滚动容器 */}
                            <style>{`
                                .invoice-result-tables { padding: 12px 16px 16px; }
                                .invoice-result-tables table { border-collapse: collapse; width: 100%; margin-bottom: 1rem; font-size: 12px; }
                                .invoice-result-tables th { background: #f8fafc; border: 1px solid #e2e8f0; padding: 6px 10px; text-align: left; font-weight: 600; color: #475569; white-space: nowrap; position: sticky; top: 0; z-index: 1; }
                                .invoice-result-tables td { border: 1px solid #e2e8f0; padding: 5px 10px; color: #64748b; white-space: nowrap; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
                                .invoice-result-tables tr:hover td { background: #f1f5f9; }
                                .invoice-result-tables h2 { font-size: 1.1rem; margin-top: 8px; margin-bottom: 0.5rem; padding-left: 4px; }
                                .invoice-result-tables h3 { font-size: 0.95rem; margin-top: 1.2rem; margin-bottom: 0.5rem; padding-left: 8px; }
                                .invoice-result-tables blockquote { border-left: 3px solid #3b82f6; padding-left: 12px; margin: 8px 0; color: #64748b; font-size: 13px; background: #f8fafc; padding: 8px 12px; border-radius: 0 8px 8px 0; }
                                .invoice-result-tables blockquote p { margin: 0; }
                            `}</style>
                            <div className="invoice-result-tables overflow-x-auto rounded-xl border border-slate-200">
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    rehypePlugins={[rehypeRaw]}
                                >
                                    {formatVerifyResult(verifyResult)}
                                </ReactMarkdown>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
