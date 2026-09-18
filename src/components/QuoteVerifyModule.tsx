import React, { useState, useRef } from 'react';
import { UploadCloud, Search, Loader2, FileText, X, Sparkles, CheckCircle2, XCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { fetchWithAuth } from '../utils/authFetch';
import { sysAlert } from '../utils/dialog';
import { Button, Card, EmptyState, Tag, Textarea, cn } from './ui';

// ===== Mock 开关：设为 true 可使用模拟数据预览完整流程效果 =====
const USE_MOCK = true;

const MOCK_NAME_RESULT = `## 客户报价核查结果

> 客户：**深圳市华美达电子科技有限公司**
> 核查时间：2025-07-30 14:32:05

### 核查明细

| 序号 | 物料名称 | 规格型号 | 报价单价(元) | 市场参考价(元) | 偏差率 | 判定 |
|------|----------|----------|-------------|---------------|--------|------|
| 1 | 电容器 100μF | 0805/25V | 0.035 | 0.032 | +9.4% | ✅ 正常 |
| 2 | 电阻器 10kΩ | 0603/1% | 0.008 | 0.007 | +14.3% | ⚠️ 偏高 |
| 3 | LED 发光二极管 | 3528/白光 | 0.120 | 0.085 | +41.2% | ❌ 异常 |
| 4 | PCB 电路板 | FR-4/双面板 | 3.500 | 3.200 | +9.4% | ✅ 正常 |
| 5 | 连接器 USB-C | 16Pin/沉板 | 0.850 | 0.780 | +9.0% | ✅ 正常 |

### 汇总分析

- **核查物料总数**：5 项
- **正常项**：3 项（60%）
- **偏高项**：1 项（20%）
- **异常项**：1 项（20%）

### 建议

1. **LED 发光二极管** 报价偏差达 41.2%，建议重新询价或更换客户
2. **电阻器 10kΩ** 报价略高于市场均价，可尝试议价至 0.007 元/个以内`;

export const QuoteVerifyModule: React.FC = () => {
    // 客户名称
    const [supplierName, setSupplierName] = useState('');
    // 上传文件
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    // 加载状态
    const [isRunningName, setIsRunningName] = useState(false);
    const [isRunningFile, setIsRunningFile] = useState(false);
    // 结果
    const [nameResult, setNameResult] = useState('');
    const [fileUploadStatus, setFileUploadStatus] = useState<'success' | 'error' | null>(null);
    const [fileUploadMsg, setFileUploadMsg] = useState('');
    // 拖动状态
    const [dragOver, setDragOver] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const resultRef = useRef<HTMLDivElement>(null);

    // ======== 客户名称核查 ======== //
    const handleNameVerify = async () => {
        if (!supplierName.trim()) {
            sysAlert('请输入客户名称');
            return;
        }
        setIsRunningName(true);
        setNameResult('');

        // Mock 模式：模拟延迟后返回假数据
        if (USE_MOCK) {
            await new Promise(r => setTimeout(r, 1500));
            setNameResult(MOCK_NAME_RESULT);
            setIsRunningName(false);
            return;
        }

        try {
            const res = await fetchWithAuth('/api/quote-verify/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ supplierName: supplierName.trim() })
            });
            const data = await res.json();
            if (data.success) {
                setNameResult(data.data || '未返回结果');
            } else {
                sysAlert(data.message || '核查失败');
            }
        } catch (e: any) {
            console.error('[核查报价-名称]', e);
            sysAlert(e.message || '请求失败');
        } finally {
            setIsRunningName(false);
        }
    };

    // ======== 文件上传核查 ======== //
    const handleFileUpload = async () => {
        if (!uploadFile) {
            sysAlert('请先选择报价文件');
            return;
        }
        setIsRunningFile(true);
        setFileUploadStatus(null);
        setFileUploadMsg('');
        const fileName = uploadFile.name;

        // Mock 模式：模拟延迟后返回假数据
        if (USE_MOCK) {
            await new Promise(r => setTimeout(r, 2000));
            clearFile();
            setFileUploadStatus('success');
            setFileUploadMsg(`文件「${fileName}」上传成功`);
            setIsRunningFile(false);
            return;
        }

        try {
            const formData = new FormData();
            formData.append('file', uploadFile);
            const res = await fetchWithAuth('/api/quote-verify/upload', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                clearFile();
                setFileUploadStatus('success');
                setFileUploadMsg(`文件「${fileName}」上传成功`);
            } else {
                setFileUploadStatus('error');
                setFileUploadMsg(data.message || '文件上传失败');
            }
        } catch (e: any) {
            console.error('[核查报价-文件]', e);
            setFileUploadStatus('error');
            setFileUploadMsg(e.message || '请求失败');
        } finally {
            setIsRunningFile(false);
        }
    };

    // ======== 文件选择 ======== //
    const handleFileSelect = (files: FileList | null) => {
        if (files && files.length > 0) {
            setUploadFile(files[0]);
        }
    };

    const clearFile = () => {
        setUploadFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // ======== 拖放处理 ======== //
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(true);
    };
    const handleDragLeave = () => setDragOver(false);
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        handleFileSelect(e.dataTransfer.files);
    };

    const isLoading = isRunningName || isRunningFile;
    const uploadOk = fileUploadStatus === 'success';

    return (
        <div className="flex-1 flex flex-col h-full bg-slate-50/80">
            {/* 顶部标题栏 */}
            <div className="flex-shrink-0 px-6 py-4 border-b border-slate-200/60 bg-white/70 backdrop-blur-sm">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center shadow-sm">
                        <Search className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-lead font-semibold text-slate-800">核查报价</h1>
                        <p className="text-caption text-slate-500">AI 驱动的客户报价核查与分析</p>
                    </div>
                </div>
            </div>

            {/* 主体内容：左右布局 */}
            <div className="flex-1 flex gap-0 overflow-hidden">
                {/* 左侧操作区 */}
                <div className="w-80 flex-shrink-0 border-r border-slate-200/60 bg-white/50 backdrop-blur-sm overflow-y-auto p-5 flex flex-col gap-5">
                    {/* 客户名称输入 */}
                    <div className="flex flex-col gap-2">
                        <label className="text-body font-medium text-slate-700 flex items-center gap-1.5">
                            <Search className="w-3.5 h-3.5" />
                            客户名称核查
                        </label>
                        <Textarea
                            value={supplierName}
                            onChange={e => setSupplierName(e.target.value)}
                            placeholder="请输入客户名称..."
                            rows={3}
                        />
                        <Button
                            variant="primary"
                            block
                            loading={isRunningName}
                            icon={<Sparkles className="w-4 h-4" />}
                            onClick={handleNameVerify}
                        >
                            {isRunningName ? '核查中...' : '开始核查'}
                        </Button>
                    </div>

                    {/* 分隔线 */}
                    <div className="border-t border-slate-200/80" />

                    {/* 文件上传区 */}
                    <div className="flex flex-col gap-2">
                        <label className="text-body font-medium text-slate-700 flex items-center gap-1.5">
                            <UploadCloud className="w-3.5 h-3.5" />
                            报价文件上传
                        </label>
                        <div
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                            className={cn(
                                'relative rounded-panel border-2 border-dashed p-4 text-center cursor-pointer transition-all',
                                dragOver
                                    ? 'border-brand-400 bg-brand-50/50'
                                    : uploadFile
                                        ? 'border-emerald-300 bg-emerald-50/30'
                                        : 'border-slate-300 hover:border-brand-300 hover:bg-brand-50/30',
                            )}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".xlsx,.xls,.csv"
                                onChange={e => handleFileSelect(e.target.files)}
                                className="hidden"
                            />
                            {uploadFile ? (
                                <div className="flex items-center gap-2 text-body">
                                    <FileText className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                                    <span className="text-slate-700 truncate flex-1 text-left">{uploadFile.name}</span>
                                    <button
                                        onClick={e => { e.stopPropagation(); clearFile(); }}
                                        className="p-0.5 rounded hover:bg-slate-200 transition-colors"
                                        title="移除文件"
                                    >
                                        <X className="w-3.5 h-3.5 text-slate-500" />
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-1.5 py-2">
                                    <UploadCloud className="w-8 h-8 text-slate-400" />
                                    <p className="text-caption text-slate-500">点击或拖拽上传报价文件</p>
                                    <p className="text-caption text-slate-400">支持 Excel / CSV</p>
                                </div>
                            )}
                        </div>
                        <Button
                            variant="secondary"
                            block
                            loading={isRunningFile}
                            disabled={!uploadFile}
                            icon={<UploadCloud className="w-4 h-4" />}
                            onClick={handleFileUpload}
                        >
                            {isRunningFile ? '处理中...' : '上传报价文件'}
                        </Button>
                    </div>
                </div>

                {/* 右侧结果区 */}
                <div ref={resultRef} className="flex-1 overflow-y-auto p-6">
                    {!nameResult && !fileUploadStatus && !isLoading ? (
                        <div className="h-full flex items-center justify-center">
                            <EmptyState
                                icon={<Search className="w-12 h-12" />}
                                title="在左侧输入客户名称或上传报价文件"
                                description="核查结果将在此处展示"
                            />
                        </div>
                    ) : (
                        <div className="space-y-5">
                            {/* 客户名称核查结果 */}
                            {nameResult && (
                                <Card
                                    padded={false}
                                    title={
                                        <span className="flex items-center gap-2">
                                            <Sparkles className="w-4 h-4 text-brand-600" />
                                            客户名称核查结果
                                        </span>
                                    }
                                    bodyClassName="p-5 prose prose-sm max-w-none prose-headings:text-slate-800 prose-p:text-slate-600 prose-a:text-brand-600 prose-strong:text-slate-700 prose-code:bg-slate-100 prose-code:px-1 prose-code:rounded"
                                >
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                                        {nameResult}
                                    </ReactMarkdown>
                                </Card>
                            )}

                            {/* 文件上传结果 */}
                            {fileUploadStatus && (
                                <Card
                                    title={
                                        <span className="flex items-center gap-2">
                                            {uploadOk
                                                ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                                : <XCircle className="w-4 h-4 text-red-600" />}
                                            文件上传结果
                                        </span>
                                    }
                                    extra={<Tag tone={uploadOk ? 'success' : 'danger'} dot>{uploadOk ? '成功' : '失败'}</Tag>}
                                >
                                    <div className="flex items-center gap-3">
                                        {uploadOk
                                            ? <CheckCircle2 className="w-8 h-8 text-emerald-500 flex-shrink-0" />
                                            : <XCircle className="w-8 h-8 text-red-500 flex-shrink-0" />}
                                        <p className={cn('text-body', uploadOk ? 'text-emerald-700' : 'text-red-700')}>
                                            {fileUploadMsg}
                                        </p>
                                    </div>
                                </Card>
                            )}

                            {/* 加载状态 */}
                            {isLoading && (
                                <Card padded={false} bodyClassName="p-8 flex flex-col items-center gap-3">
                                    <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
                                    <p className="text-body text-slate-500 animate-pulse">
                                        {isRunningName ? '正在核查客户报价信息...' : '正在处理上传文件...'}
                                    </p>
                                </Card>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default QuoteVerifyModule;
