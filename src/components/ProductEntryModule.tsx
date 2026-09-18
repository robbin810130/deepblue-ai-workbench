import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { UploadCloud, FileSpreadsheet, X, CheckCircle2, Loader2, Sparkles, History, Trash2, Database, ChevronDown, Merge, Undo2, ArrowLeft, GitBranch, Search, AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { fetchWithAuth } from '../utils/authFetch';
import { sysAlert } from '../utils/dialog';

// ─── 多行字段正则（只读/可编辑共用） ────────────────────────────
const MULTI_LINE_FIELD_RE = /name|名称|品\s*名|描述|description|品牌|brand|分类|category|供应商|vendor|规格|spec|链接|link|url/i;

// ─── 类型定义 ──────────────────────────────────────────────────
interface UploadedFile {
    file: File;
    preview: string;
}

interface SkuItem {
    row: number;
    sku_code: string;
    name: string;
    spec: string;
    unit: string;
    price: number | string;
    category: string;
    mergedInto?: number; // SPU group index
    split?: boolean; // 已拆分，不允许再合并
    // 扩展字段（来自 Dify 解析结果）
    brand?: string;
    retail_price?: number | string;
    supply_price?: number | string;
    weight?: string;
    box_count?: number | string;
    description?: string;
    online_link?: string;
    package_size?: string;
    [key: string]: any; // 允许其他动态字段
}

interface SpuGroup {
    spu_name: string;
    sku_rows: number[];
}

interface HistoryRecord {
    id: number;
    file_names: string;
    parse_result: string;
    confirm_result: string;
    sku_count: number;
    spu_count: number;
    status: string;
    created_at: string;
    username: string;
}

type Step = 'upload' | 'selectSheet' | 'parse' | 'confirm' | 'completionInfo' | 'confirmCompletion';

const DRAFT_KEY = 'product_entry_draft';

interface DraftState {
    step: Step;
    supplier: string;
    sheets: string[];
    selectedSheet: string;
    formToken: string;
    workflowRunId: string;
    taskId: string;  // 用于停止工作流
    brandList: string[];
    selectedBrand: string;
    supplierList: string[];
    selectedSupplier: string;
    skuList: SkuItem[];
    spuGroups: SpuGroup[];
    parseResult: string;
    fileIds: string[];
    completionList: any[];
    completionFormToken: string;
    completionWorkflowRunId: string;
    completionTaskId: string;  // 用于停止工作流
    visibleColumns: string[];
    savedAt: number;
}

// ─── 主组件 ──────────────────────────────────────────────────
export const ProductEntryModule: React.FC = () => {
    // 文件上传
    const [xlsxFiles, setXlsxFiles] = useState<UploadedFile[]>([]);
    const [dragOver, setDragOver] = useState(false);

    // 供应商名称（可选）
    const [supplier, setSupplier] = useState<string>('');

    // 步骤控制
    const [step, setStep] = useState<Step>('upload');

    // Sheet 选择
    const [sheets, setSheets] = useState<string[]>([]);
    const [selectedSheet, setSelectedSheet] = useState<string>('');
    const [formToken, setFormToken] = useState<string>('');
    const [workflowRunId, setWorkflowRunId] = useState<string>('');
    const [taskId, setTaskId] = useState<string>('');  // 用于停止工作流
    const [selectedBrand, setSelectedBrand] = useState<string>('');
    const [brandList, setBrandList] = useState<string[]>([]);
    const [brandSearch, setBrandSearch] = useState<string>('');
    const [selectedSupplier, setSelectedSupplier] = useState<string>('');
    const [supplierList, setSupplierList] = useState<string[]>([]);
    const [supplierSearch, setSupplierSearch] = useState<string>('');

    // 解析结果
    const [parseResult, setParseResult] = useState<string>('');
    const [skuList, setSkuList] = useState<SkuItem[]>([]);
    const [fileIds, setFileIds] = useState<string[]>([]);

    // 从 skuList 数据中自动提取所有字段 key 作为表头（动态列）
    const dynamicKeys = React.useMemo(() => {
        const keySet = new Set<string>();
        skuList.forEach(item => {
            Object.keys(item).forEach(k => {
                // 排除内部字段
                if (!['row', 'mergedInto', 'selected', 'split', 'SPLIT'].includes(k)) {
                    keySet.add(k);
                }
            });
        });
        return Array.from(keySet);
    }, [skuList]);

    // SPU 合并
    const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
    const [spuGroups, setSpuGroups] = useState<SpuGroup[]>([]);

    // SKU 表格排序
    const [sortKey, setSortKey] = useState<string | null>(null);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const handleSort = (key: string) => {
        if (sortKey === key) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDirection('asc');
        }
    };

    // 录入结果
    const [confirmResult, setConfirmResult] = useState<string>('');
    const [entryErrors, setEntryErrors] = useState<{ spuErrors: any[]; skuErrors: any[]; priceErrors: any[]; generalError?: string } | null>(null);
    const [showRawData, setShowRawData] = useState(false);  // 原始返回数据折叠

    // 补全信息
    const [completionList, setCompletionList] = useState<any[]>([]);
    const [completionFormToken, setCompletionFormToken] = useState<string>('');
    const [completionWorkflowRunId, setCompletionWorkflowRunId] = useState<string>('');
    const [completionTaskId, setCompletionTaskId] = useState<string>('');  // 用于停止工作流
    const [_completionResult, setCompletionResult] = useState<string>('');
    const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

    // 可见列（支持删除列）- 初始只有固定列，动态列由 useEffect 自动添加
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set([
        'row', 'status', 'split'
    ]));

    // 历史记录
    const [history, setHistory] = useState<HistoryRecord[]>([]);
    const [showHistory, setShowHistory] = useState(false);

    // 加载状态
    const [isParsing, setIsParsing] = useState(false);
    const [parseProgress, setParseProgress] = useState<string>('');  // 解析进度信息
    const [isConfirming, setIsConfirming] = useState(false);
    const [confirmProgress, setConfirmProgress] = useState<string>('');  // 录入进度信息
    const [isReadOnly, setIsReadOnly] = useState(false);  // 确认录入后只读

    // 图片悬浮预览
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const [previewPos, setPreviewPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

    // 草稿恢复
    const [showDraftDialog, setShowDraftDialog] = useState(false);
    const [draftInfo, setDraftInfo] = useState<{ savedAt: number; step: Step; supplier: string } | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const resultRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const parseProgressTimerRef = useRef<any>(null);
    const sheetProgressTimerRef = useRef<any>(null);
    const progressTimerRef = useRef<any>(null);

    // 稳定的 textarea ref 回调，避免每次渲染创建新函数
    const textareaRefCallback = useCallback((el: HTMLTextAreaElement | null) => {
        if (el) {
            // 使用 requestAnimationFrame 延迟到下一帧执行 DOM 测量
            requestAnimationFrame(() => {
                el.style.height = 'auto';
                el.style.height = el.scrollHeight + 'px';
            });
        }
    }, []);

    // 组件卸载时清理所有定时器，防止内存泄漏
    useEffect(() => {
        return () => {
            if (parseProgressTimerRef.current) clearInterval(parseProgressTimerRef.current);
            if (sheetProgressTimerRef.current) clearInterval(sheetProgressTimerRef.current);
            if (progressTimerRef.current) clearInterval(progressTimerRef.current);
        };
    }, []);

    // ======== 草稿持久化 ======== //
    const saveDraft = useCallback(() => {
        // 只在有意义的步骤保存（upload 步骤不保存）
        if (step === 'upload' || step === 'confirm') return;
        const draft: DraftState = {
            step, supplier, sheets, selectedSheet, formToken, workflowRunId, taskId,
            brandList, selectedBrand, supplierList, selectedSupplier, skuList, spuGroups, parseResult, fileIds,
            completionList, completionFormToken, completionWorkflowRunId, completionTaskId,
            visibleColumns: Array.from(visibleColumns),
            savedAt: Date.now()
        };
        try {
            localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        } catch (e) {
            console.warn('[商品库录入] 保存草稿失败:', e);
        }
    }, [step, supplier, sheets, selectedSheet, formToken, workflowRunId, taskId, brandList, selectedBrand, supplierList, selectedSupplier, skuList, spuGroups, parseResult, fileIds, completionList, completionFormToken, completionWorkflowRunId, completionTaskId, visibleColumns]);

    const clearDraft = useCallback(() => {
        try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
    }, []);

    // 自动保存：状态变化后延迟 500ms 保存（防抖）
    useEffect(() => {
        if (step === 'upload' || step === 'confirm') return;
        const timer = setTimeout(saveDraft, 500);
        return () => clearTimeout(timer);
    }, [saveDraft, step]);

    // 组件挂载时检测草稿
    useEffect(() => {
        try {
            const raw = localStorage.getItem(DRAFT_KEY);
            if (!raw) return;
            const draft: DraftState = JSON.parse(raw);
            if (draft && draft.step !== 'upload' && draft.step !== 'confirm') {
                setDraftInfo({ savedAt: draft.savedAt, step: draft.step, supplier: draft.supplier });
                setShowDraftDialog(true);
            }
        } catch (e) {
            console.warn('[商品库录入] 读取草稿失败:', e);
        }
    }, []);

    const restoreDraft = () => {
        try {
            const raw = localStorage.getItem(DRAFT_KEY);
            if (!raw) return;
            const draft: DraftState = JSON.parse(raw);
            setStep(draft.step);
            setSupplier(draft.supplier || '');
            setSheets(draft.sheets || []);
            setSelectedSheet(draft.selectedSheet || '');
            setFormToken(draft.formToken || '');
            setWorkflowRunId(draft.workflowRunId || '');
            setTaskId(draft.taskId || '');
            setBrandList(draft.brandList || []);
            setSelectedBrand(draft.selectedBrand || '');
            setSupplierList(draft.supplierList || []);
            setSelectedSupplier(draft.selectedSupplier || '');
            setSkuList(draft.skuList || []);
            setSpuGroups(draft.spuGroups || []);
            setParseResult(draft.parseResult || '');
            setFileIds(draft.fileIds || []);
            setCompletionList(draft.completionList || []);
            setCompletionFormToken(draft.completionFormToken || '');
            setCompletionWorkflowRunId(draft.completionWorkflowRunId || '');
            setCompletionTaskId(draft.completionTaskId || '');
            if (draft.visibleColumns) setVisibleColumns(new Set(draft.visibleColumns));
        } catch (e) {
            console.warn('[商品库录入] 恢复草稿失败:', e);
            sysAlert('恢复失败，请重新开始');
        }
        setShowDraftDialog(false);
        setDraftInfo(null);
    };

    const discardDraft = () => {
        // 停止 Dify 工作流任务（优先使用 taskId）
        try {
            const raw = localStorage.getItem(DRAFT_KEY);
            if (raw) {
                const draft: DraftState = JSON.parse(raw);
                // 收集需要停止的任务：优先使用 taskId，如果没有则用 workflowRunId
                const tasksToStop: Array<{ taskId?: string; workflowRunId?: string }> = [];
                if (draft.taskId || draft.workflowRunId) {
                    tasksToStop.push({ taskId: draft.taskId, workflowRunId: draft.workflowRunId });
                }
                if (draft.completionTaskId || draft.completionWorkflowRunId) {
                    tasksToStop.push({ taskId: draft.completionTaskId, workflowRunId: draft.completionWorkflowRunId });
                }
                tasksToStop.forEach(task => {
                    fetchWithAuth('/api/product-entry/stop-workflow', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(task)
                    }).catch(() => {});
                });
            }
        } catch (e) { /* ignore */ }
        clearDraft();
        setShowDraftDialog(false);
        setDraftInfo(null);
    };

    const stepLabels: Record<Step, string> = {
        upload: '上传文件', selectSheet: '选择 Sheet', parse: '解析结果',
        confirm: '录入完成', completionInfo: '补全信息', confirmCompletion: '确认补全'
    };

    // ======== 加载历史记录 ======== //
    const loadHistory = useCallback(async () => {
        try {
            const res = await fetchWithAuth('/api/product-entry/history');
            const data = await res.json();
            if (data.success) setHistory(data.data || []);
        } catch (e) {
            console.warn('加载历史记录失败', e);
        }
    }, []);

    // ======== 解析录入结果错误 ======== //
    const parseEntryErrors = (resultStr: string) => {
        try {
            // 尝试解析 JSON
            const parsed = JSON.parse(resultStr);
            let responseData: any = null;
            
            // response 可能是字符串或对象
            if (parsed.response) {
                if (typeof parsed.response === 'string') {
                    // response 是字符串，尝试解析为 JSON
                    try {
                        responseData = JSON.parse(parsed.response);
                    } catch {
                        // response 不是有效 JSON，说明是接口调用失败（如 "400 Client Error: Bad Request..."）
                        setEntryErrors({
                            spuErrors: [], skuErrors: [], priceErrors: [],
                            generalError: parsed.response || '接口调用失败'
                        });
                        return;
                    }
                } else {
                    responseData = parsed.response;
                }
            } else if (parsed.code !== undefined) {
                responseData = parsed;
            }
            
            if (responseData && responseData.code === 200 && responseData.data) {
                const { spuErrors = [], skuErrors = [], priceErrors = [] } = responseData.data;
                if (spuErrors.length > 0 || skuErrors.length > 0 || priceErrors.length > 0) {
                    setEntryErrors({ spuErrors, skuErrors, priceErrors });
                } else {
                    setEntryErrors(null);
                }
            } else if (responseData && responseData.code !== 200) {
                // code 不是 200，显示 message
                setEntryErrors({
                    spuErrors: [], skuErrors: [], priceErrors: [],
                    generalError: responseData.message || `接口返回错误 (code: ${responseData.code})`
                });
            } else {
                setEntryErrors(null);
            }
        } catch (e) {
            // resultStr 不是有效 JSON，直接作为错误信息展示
            const errorText = resultStr.trim();
            if (errorText && !errorText.startsWith('{') && !errorText.startsWith('[')) {
                setEntryErrors({
                    spuErrors: [], skuErrors: [], priceErrors: [],
                    generalError: errorText.length > 200 ? errorText.substring(0, 200) + '...' : errorText
                });
            } else {
                setEntryErrors(null);
            }
        }
    };

    useEffect(() => { loadHistory(); }, [loadHistory]);

    // 动态列变化时自动加入可见列（新字段默认显示）
    useEffect(() => {
        if (dynamicKeys.length === 0) return;
        setVisibleColumns(prev => {
            const newSet = new Set(prev);
            let changed = false;
            dynamicKeys.forEach(k => {
                if (!newSet.has(k)) {
                    newSet.add(k);
                    changed = true;
                }
            });
            return changed ? newSet : prev;
        });
    }, [dynamicKeys]);

    // ======== 文件处理 ======== //
    const clearFiles = () => {
        xlsxFiles.forEach(f => URL.revokeObjectURL(f.preview));
        setXlsxFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const addFiles = (files: FileList) => {
        if (files.length === 0) return;
        const file = files[0]; // 只取第一个文件
        const isValid = file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            || file.type === 'application/vnd.ms-excel'
            || file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
        if (!isValid) {
            sysAlert(`文件 "${file.name}" 不是 Excel 格式`);
            return;
        }
        if (file.size > 100 * 1024 * 1024) {
            sysAlert(`文件大小超过 100MB（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）`);
            return;
        }
        // 替换已有文件
        clearFiles();
        setXlsxFiles([{ file, preview: URL.createObjectURL(file) }]);
    };

    const removeFile = (index: number) => {
        setXlsxFiles(prev => {
            const removed = prev[index];
            if (removed) URL.revokeObjectURL(removed.preview);
            return prev.filter((_, i) => i !== index);
        });
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) addFiles(e.target.files);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
    };

    // ======== 第一步：上传文件并获取 Sheet 列表 ======== //
    const handleParse = async () => {
        if (xlsxFiles.length === 0) {
            sysAlert('请至少上传一个 xlsx/xls 表格文件！');
            return;
        }

        try {
            setIsParsing(true);
            setParseProgress('');  // 清空上次进度

            // 上传文件到 Dify
            const uploadToDify = async (file: File): Promise<string> => {
                const formData = new FormData();
                formData.append('file', file);
                const uploadResRaw = await fetchWithAuth('/api/product-entry/upload', {
                    method: 'POST', body: formData
                });
                const uploadRes = await uploadResRaw.json();
                if (!uploadRes.success) throw new Error(uploadRes.message || '文件上传失败');
                return uploadRes.file_id;
            };

            const ids = await Promise.all(xlsxFiles.map(f => uploadToDify(f.file)));
            setFileIds(ids);

            // 启动解析进度轮询
            if (ids[0]) {
                setParseProgress('正在准备数据...');
                parseProgressTimerRef.current = setInterval(async () => {
                    try {
                        const progressRes = await fetchWithAuth(`/api/product-entry/parse-progress/${ids[0]}`);
                        const progressData = await progressRes.json();
                        if (progressData.progress) {
                            setParseProgress(progressData.progress);
                        }
                    } catch (_) {}
                }, 2000);
            }

            try {
                // 调用获取 Sheet 列表工作流
                const sheetsResRaw = await fetchWithAuth('/api/product-entry/sheets', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fileId: ids[0],
                        fileName: xlsxFiles[0].file.name
                    })
                });

                const sheetsRes = await sheetsResRaw.json();
                if (!sheetsRes.success) throw new Error(sheetsRes.message || '获取 Sheet 列表失败');

                // 保存 Sheet 列表和工作流信息
                setSheets(sheetsRes.sheets || []);
                setFormToken(sheetsRes.formToken || '');
                setWorkflowRunId(sheetsRes.workflowRunId || '');
                setTaskId(sheetsRes.taskId || '');  // 用于停止工作流

                // 从 Dify 人工介入表单获取品牌列表
                if (Array.isArray(sheetsRes.brands) && sheetsRes.brands.length > 0) {
                    setBrandList(sheetsRes.brands);
                    setSelectedBrand(sheetsRes.brands[0]); // 默认选中第一个
                }
                // 从 Dify 人工介入表单获取供应商列表
                if (Array.isArray(sheetsRes.suppliers) && sheetsRes.suppliers.length > 0) {
                    setSupplierList(sheetsRes.suppliers);
                    setSelectedSupplier(sheetsRes.suppliers[0]); // 默认选中第一个
                }

                // 如果有 Sheet 列表，显示选择界面
                if (sheetsRes.sheets && sheetsRes.sheets.length > 0) {
                    setSelectedSheet(sheetsRes.sheets[0]); // 默认选中第一个
                    setStep('selectSheet');
                } else {
                    // 没有 Sheet 列表，直接进入解析步骤
                    sysAlert('未获取到 Sheet 列表，请检查 Dify 工作流配置');
                }
            } finally {
                if (parseProgressTimerRef.current) clearInterval(parseProgressTimerRef.current);
            }

        } catch (error: any) {
            console.error('[ProductEntry Parse Error]', error);
            sysAlert(`解析失败：${error.message}`);
        } finally {
            setIsParsing(false);
            setParseProgress('');
        }
    };

    // ======== 第二步：确认 Sheet 选择 ======== //
    const handleConfirmSheet = async () => {
        if (!selectedSheet) {
            sysAlert('请选择一个 Sheet！');
            return;
        }
        if (!selectedBrand) {
            sysAlert('请选择品牌！');
            return;
        }
        if (supplierList.length > 0 && !selectedSupplier) {
            sysAlert('请选择供应商！');
            return;
        }

        const startTime = Date.now();
        try {
            setIsParsing(true);
            setParseProgress('正在提交数据...');

            // 启动解析进度轮询（应对长时间等待）
            if (workflowRunId) {
                sheetProgressTimerRef.current = setInterval(async () => {
                    try {
                        const progressRes = await fetchWithAuth(`/api/product-entry/sheet-progress/${workflowRunId}`);
                        const progressData = await progressRes.json();
                        if (progressData.progress) {
                            setParseProgress(progressData.progress);
                        }
                    } catch (_) {}
                }, 2000);
            }

            try {
                // 调用确认 Sheet 工作流（恢复人工介入）
                const confirmSheetResRaw = await fetchWithAuth('/api/product-entry/confirm-sheet', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fileId: fileIds[0],
                        fileName: xlsxFiles[0]?.file.name,
                        selectedSheet,
                        selectedBrand: selectedBrand || undefined,
                        selectedSupplier: selectedSupplier || undefined,
                        formToken,
                        workflowRunId
                    })
                });

                const confirmSheetRes = await confirmSheetResRaw.json();
                if (!confirmSheetRes.success) throw new Error(confirmSheetRes.message || '确认 Sheet 失败');

                // 更新进度：数据已返回，正在处理
                setParseProgress('正在解析商品数据...');

                // 如果工作流再次暂停，说明有第二个人工介入节点（商品列表确认）
                if (confirmSheetRes.paused) {
                    // 更新 formToken 和 workflowRunId 用于后续提交
                    setFormToken(confirmSheetRes.formToken || '');
                    setWorkflowRunId(confirmSheetRes.workflowRunId || '');
                    setTaskId(confirmSheetRes.taskId || '');  // 用于停止工作流

                    // 提取解析出的商品数据
                    const parsedData = confirmSheetRes.parsedData || {};
                    // 优先从 productList 提取（后端从 form_content 解析的 JSON 数组）
                    const productData = parsedData.productList || parsedData.product_list || parsedData.sku_list || parsedData.result || parsedData.text || '';

                    if (Array.isArray(productData) && productData.length > 0) {
                        // 直接使用原始数据，添加行号即可（字段 key 为中文，直接作为表头）
                        setSkuList(productData.map((item: any, idx: number) => ({
                            row: idx + 1,
                            ...item
                        })));
                        // 保存原始 Markdown 文本（如果有）
                        setParseResult(JSON.stringify(productData, null, 2));
                    } else if (typeof productData === 'string' && productData.trim()) {
                        setParseResult(typeof productData === 'string' ? productData : JSON.stringify(productData, null, 2));
                        // 尝试从 Markdown 表格解析
                        const parsed = parseMarkdownTable(productData);
                        setSkuList(parsed);
                    }

                    setStep('parse');
                    setSelectedRows(new Set());
                    setSpuGroups([]);

                    setTimeout(() => {
                        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 300);
                    return;
                }

                // 工作流直接完成（没有第二个人工介入）
                setParseResult(confirmSheetRes.data || '');

                if (confirmSheetRes.skuList && confirmSheetRes.skuList.length > 0) {
                    // 直接使用原始数据
                    setSkuList(confirmSheetRes.skuList.map((item: any, idx: number) => ({
                        row: item.row || idx + 1,
                        ...item
                    })));
                } else {
                    const parsed = parseMarkdownTable(confirmSheetRes.data || '');
                    setSkuList(parsed);
                }

                setStep('parse');
                setSelectedRows(new Set());
                setSpuGroups([]);

                setTimeout(() => {
                    resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 300);
            } finally {
                if (sheetProgressTimerRef.current) clearInterval(sheetProgressTimerRef.current);
            }

        } catch (error: any) {
            console.error('[ProductEntry Confirm Sheet Error]', error);
            sysAlert(`确认 Sheet 失败：${error.message}`);
        } finally {
            // 立即清空进度，避免在 setTimeout 等待期间显示过时的旧进度文字
            setParseProgress('');
            // 确保 loading 状态至少显示 1.5 秒，让用户能看到进度文字
            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, 1500 - elapsed);
            setTimeout(() => {
                setIsParsing(false);
            }, remaining);
        }
    };

    // ======== Markdown 表格解析 ======== //
    const parseMarkdownTable = (md: string): SkuItem[] => {
        const lines = md.split('\n').filter(l => l.trim().startsWith('|'));
        if (lines.length < 3) return [];

        const parseRow = (line: string) =>
            line.split('|').map(c => c.trim()).filter(c => c && !c.match(/^-+$/));

        const headers = parseRow(lines[0]);
        // 跳过分割线 lines[1]
        const dataLines = lines.slice(2);

        return dataLines.map((line, idx) => {
            const cells = parseRow(line);
            return {
                row: idx + 1,
                sku_code: cells[headers.findIndex(h => h.includes('SKU') || h.includes('编码'))] || cells[1] || '',
                name: cells[headers.findIndex(h => h.includes('名称') || h.includes('商品'))] || cells[2] || '',
                spec: cells[headers.findIndex(h => h.includes('规格'))] || cells[3] || '',
                unit: cells[headers.findIndex(h => h.includes('单位'))] || cells[4] || '',
                price: cells[headers.findIndex(h => h.includes('单价') || h.includes('价格'))] || cells[5] || '',
                category: cells[headers.findIndex(h => h.includes('分类'))] || cells[6] || '',
            };
        }).filter(item => item.sku_code || item.name);
    };

    // ======== SKU 合并操作 ======== //
    const toggleRow = (row: number) => {
        setSelectedRows(prev => {
            const next = new Set(prev);
            if (next.has(row)) next.delete(row);
            else next.add(row);
            return next;
        });
    };

    const toggleAll = () => {
        const unmergedRows = skuList.filter(s => s.mergedInto === undefined).map(s => s.row);
        if (selectedRows.size === unmergedRows.length) {
            setSelectedRows(new Set());
        } else {
            setSelectedRows(new Set(unmergedRows));
        }
    };

    const handleMergeToSpu = () => {
        if (selectedRows.size < 2) {
            sysAlert('请至少选择两行进行合并');
            return;
        }
        // 检查是否有已拆分的行
        const hasSplit = skuList.some(s => selectedRows.has(s.row) && s.split);
        if (hasSplit) {
            sysAlert('已拆分的记录不允许再合并');
            return;
        }
        // 保存滚动位置
        const scrollTop = scrollContainerRef.current?.scrollTop || 0;
        // 直接用第一个选中商品的名称作为 SPU 名称，不需要弹窗输入
        const firstItem = skuList.find(s => s.row === Array.from(selectedRows)[0]);
        const spuName = firstItem?.name || `SPU-${Date.now().toString().slice(-4)}`;
        const rows = Array.from(selectedRows).sort((a, b) => a - b);
        const groupIdx = spuGroups.length;

        setSpuGroups(prev => [...prev, { spu_name: spuName, sku_rows: rows }]);
        setSkuList(prev => prev.map(item =>
            rows.includes(item.row) ? { ...item, mergedInto: groupIdx } : item
        ));
        setSelectedRows(new Set());
        // 恢复滚动位置
        requestAnimationFrame(() => {
            if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = scrollTop;
        });
    };

    const dissolveGroup = (groupIdx: number) => {
        // 保存滚动位置
        const scrollTop = scrollContainerRef.current?.scrollTop || 0;
        setSpuGroups(prev => prev.filter((_, i) => i !== groupIdx));
        setSkuList(prev => prev.map(item =>
            item.mergedInto === groupIdx
                ? { ...item, mergedInto: undefined }
                : item.mergedInto !== undefined && item.mergedInto > groupIdx
                    ? { ...item, mergedInto: item.mergedInto - 1 }
                    : item
        ));
        // 恢复滚动位置
        requestAnimationFrame(() => {
            if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = scrollTop;
        });
    };

    // ======== 第二步：确认录入 ======== //
    const handleDeleteSelectedRows = () => {
        if (selectedRows.size === 0) {
            sysAlert('请先勾选要删除的行');
            return;
        }
        // 删除后至少保留一条数据
        if (skuList.length - selectedRows.size < 1) {
            sysAlert('至少保留一条数据，不能全部删除');
            return;
        }
        setSkuList(prev => prev.filter(item => !selectedRows.has(item.row)));
        setSelectedRows(new Set());
    };

    const handleDeleteRow = (rowNum: number) => {
        setSkuList(prev => prev.filter(item => item.row !== rowNum));
        setSelectedRows(prev => {
            const next = new Set(prev);
            next.delete(rowNum);
            return next;
        });
    };

    const handleSplitToSpu = () => {
        if (selectedRows.size === 0) {
            sysAlert('请先勾选要操作的行');
            return;
        }
        // 检查表头是否存在「颜色」字段
        if (!dynamicKeys.includes('颜色')) {
            sysAlert('当前数据中没有「颜色」字段，无法进行颜色拆分');
            return;
        }
        // 保存滚动位置
        const scrollTop = scrollContainerRef.current?.scrollTop || 0;
        const rows = Array.from(selectedRows);
        // 判断选中行是否已全部拆分 → 是则取消拆分，否则执行拆分
        const allSplit = rows.every(r => skuList.find(s => s.row === r)?.split);
        if (allSplit) {
            setSkuList(prev => prev.map(item =>
                rows.includes(item.row) ? { ...item, split: undefined, SPLIT: undefined } : item
            ));
        } else {
            setSkuList(prev => prev.map(item =>
                rows.includes(item.row) ? { ...item, split: true, SPLIT: '颜色' } : item
            ));
        }
        setSelectedRows(new Set());
        // 恢复滚动位置
        requestAnimationFrame(() => {
            if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = scrollTop;
        });
    };
    const handleConfirm = async () => {
        try {
            setIsConfirming(true);
            setIsReadOnly(true);  // 点击确认录入后立即变为只读
            setConfirmProgress('正在准备数据...');

            // 将单个 SKU 转为中文 key 对象（数据已经是中文 key，直接保留）
            const skuToObj = (item: SkuItem): Record<string, any> => {
                const obj: Record<string, any> = {};
                for (const [key, val] of Object.entries(item)) {
                    // 跳过内部字段和空值
                    if (['row', 'mergedInto', 'split', 'SPLIT'].includes(key)) continue;
                    if (val === undefined || val === null || val === '') continue;
                    obj[key] = val;
                }
                // 保留拆分标记
                if (item.split && item.SPLIT) obj['SPLIT'] = item.SPLIT;
                return obj;
            };

            // 构建分组数据：数组的数组
            // SPU 合并组: [{...}, {...}]
            // 独立 SKU: [{...}]
            // 拆分 SKU: [{..., "SPLIT": "颜色"}]
            const mergedRows = new Set(spuGroups.flatMap(g => g.sku_rows));
            const productGroups: Record<string, any>[][] = [];

            // 先加 SPU 合并组
            spuGroups.forEach(group => {
                const items = group.sku_rows
                    .map(rowNum => skuList.find(s => s.row === rowNum))
                    .filter((s): s is SkuItem => !!s);
                productGroups.push(items.map(skuToObj));
            });

            // 再加独立/拆分的 SKU
            skuList.forEach(item => {
                if (!mergedRows.has(item.row)) {
                    productGroups.push([skuToObj(item)]);
                }
            });

            const skuData = {
                skus: skuList,
                spu_groups: spuGroups,
                product_groups: productGroups
            };

            setConfirmProgress('正在提交数据...');

            // 启动进度轮询
            if (workflowRunId) {
                progressTimerRef.current = setInterval(async () => {
                    try {
                        const progressRes = await fetchWithAuth(`/api/product-entry/confirm-progress/${workflowRunId}`);
                        const progressData = await progressRes.json();
                        if (progressData.progress) {
                            setConfirmProgress(progressData.progress);
                        }
                    } catch (_) {}
                }, 2000);
            }

            try {
                const confirmResRaw = await fetchWithAuth('/api/product-entry/confirm', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fileIds,
                        fileNames: xlsxFiles.map(f => f.file.name),
                        skuData,
                        parseResult,
                        formToken,
                        workflowRunId
                    })
                });

                const confirmRes = await confirmResRaw.json();
                if (!confirmRes.success) throw new Error(confirmRes.message || '录入失败');

                // 如果工作流在第三步暂停（补全信息人工介入）
                if (confirmRes.paused) {
                    setCompletionFormToken(confirmRes.completionFormToken || '');
                    setCompletionWorkflowRunId(confirmRes.completionWorkflowRunId || workflowRunId);
                    setCompletionTaskId(confirmRes.completionTaskId || '');
                    const compData = confirmRes.completionList || [];
                    const priceFieldKeys = ['proxyPrice', 'centralizedPrice', 'recommendedRetailPrice', 'platformPrice', 'bottomPrice'];
                    const cleaned = (Array.isArray(compData) ? compData : []).map((item: any) => {
                        const cleanedItem: any = {};
                        for (const [k, v] of Object.entries(item)) {
                            if (v === null || v === undefined) continue;
                            if (typeof v === 'string' && v.trim() === '') continue;
                            cleanedItem[k] = typeof v === 'string' ? v.trim() : v;
                        }
                        // 价格字段清理：去除特殊字符，确保为有效浮点数
                        priceFieldKeys.forEach(key => {
                            const val = cleanedItem[key];
                            if (val !== undefined && val !== null && val !== '') {
                                const cleaned_val = String(val).replace(/[^\d.]/g, '');
                                const parts = cleaned_val.split('.');
                                cleanedItem[key] = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : cleaned_val;
                            }
                        });
                        // isSelfManageStock 保持原始值 (0/1)，用于下拉框选择
                        // 兼容旧数据：将中文文本映射为下拉框数值（1=代发, 0=集采）
                        if (cleanedItem.isSelfManageStock === '代发') cleanedItem.isSelfManageStock = '1';
                        if (cleanedItem.isSelfManageStock === '自营' || cleanedItem.isSelfManageStock === '集采' || cleanedItem.isSelfManageStock === '非自营') cleanedItem.isSelfManageStock = '0';
                        return cleanedItem;
                    }).map(ensureRequiredFields);
                    setCompletionList(cleaned);
                    setStep('completionInfo');
                    setTimeout(() => {
                        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 300);
                    return;
                }

                const resultData = confirmRes.data || '';
                setConfirmResult(resultData);
                parseEntryErrors(resultData);
                setStep('confirm');
                clearDraft();
                loadHistory();

                // 发送通知中心消息
                try {
                    await fetchWithAuth('/api/notifications', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            appId: 'productentry',
                            appName: '商品库录入',
                            title: '商品录入完成',
                            message: `商品录入任务已执行完成，请查看录入结果。`
                        })
                    });
                    // 通知 SystemInterface 立即刷新通知列表
                    window.dispatchEvent(new CustomEvent('refresh-notifications'));
                } catch (e) {
                    console.error('发送通知失败:', e);
                }

                setTimeout(() => {
                    resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 300);
            } finally {
                if (progressTimerRef.current) clearInterval(progressTimerRef.current);
            }
        } catch (error: any) {
            sysAlert(`录入失败：${error.message}`);
            // 失败后重置状态，回到上传页面
            handleReset();
        } finally {
            setIsConfirming(false);
            setConfirmProgress('');
        }
    };

    // ======== 重置 ======== //
    const handleReset = () => {
        // 清除所有进度轮询定时器
        if (parseProgressTimerRef.current) clearInterval(parseProgressTimerRef.current);
        if (sheetProgressTimerRef.current) clearInterval(sheetProgressTimerRef.current);
        if (progressTimerRef.current) clearInterval(progressTimerRef.current);
        parseProgressTimerRef.current = null;
        sheetProgressTimerRef.current = null;
        progressTimerRef.current = null;

        // 停止 Dify 工作流任务（优先使用 taskId）
        const tasksToStop: Array<{ taskId?: string; workflowRunId?: string }> = [];
        if (taskId || workflowRunId) {
            tasksToStop.push({ taskId, workflowRunId });
        }
        if (completionTaskId || completionWorkflowRunId) {
            tasksToStop.push({ taskId: completionTaskId, workflowRunId: completionWorkflowRunId });
        }
        tasksToStop.forEach(task => {
            fetchWithAuth('/api/product-entry/stop-workflow', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(task)
            }).catch(() => {});
        });

        clearFiles();
        setStep('upload');
        setIsParsing(false);
        setParseProgress('');
        setConfirmProgress('');
        setParseResult('');
        setSkuList([]);
        setFileIds([]);
        setSelectedRows(new Set());
        setSpuGroups([]);
        setConfirmResult('');
        setEntryErrors(null);
        setShowRawData(false);
        setSupplier('');
        setSelectedSupplier('');
        setSupplierList([]);
        setSupplierSearch('');
        setTaskId('');
        setWorkflowRunId('');
        setFormToken('');
        setCompletionList([]);
        setCompletionFormToken('');
        setCompletionWorkflowRunId('');
        setCompletionTaskId('');
        setCompletionResult('');
        setIsReadOnly(false);  // 重置只读状态
        setVisibleColumns(new Set([
            'row', 'pic', 'vendorName', 'name', 'brand', 'sku_code', 'spec', 'category', 'ean', 'supply_price', 'centralized_price', 'retail_price', 'gross_profit', 'weight', 'box_count', 'description', 'online_link', 'status', 'split'
        ]));
        clearDraft();
    };

    // 补全信息字段映射（英文 → 中文）
    const completionFieldLabels: Record<string, string> = {
        pic: '主图',
        albumPics1: 'SPU主图1', albumPics2: 'SPU主图2', albumPics3: 'SPU主图3', albumPics4: 'SPU主图4', albumPics5: 'SPU主图5',
        brandName: '所属品牌名称', businessCode: '业务编码', categoryName: '分类名称', categoryName1: '一级分类', categoryName2: '二级分类', categoryName3: '三级分类',
        errorMsg: '错误信息', isSelfManageStock: '供货方式', productName: '商品名称', productTypeName: '商品类型',
        unitName: '单位', vendorName: '供应商名称',
        bottomPrice: '最低售价', centralizedPrice: '集采供货价', ean: '条码', externalSkuCode: '产品编码',
        proxyPrice: '代发供货价', recommendedRetailPrice: '建议零售价',
        specificationName: '规格名', specificationValue: '规格值',
        platformName: '平台名称', platformPrice: '平台售价', productLink: '商品链接',
    };
    // 必填字段列表（提交时需要校验）
    const requiredCompletionFields = [
        'isSelfManageStock', 'productTypeName', 'vendorName', 'productName', 'brandName',
        'businessCode', 'unitName', 'categoryName', 'pic',
        'recommendedRetailPrice', 'centralizedPrice', 'proxyPrice', 'platformPrice',
        'ean', 'externalSkuCode', 'specificationValue', 'specificationName',
        'platformName', 'productLink'
    ];
    // 确保必填字段都存在（即使为空值，以便用户补全）
    const ensureRequiredFields = (item: any) => {
        const result = { ...item };
        requiredCompletionFields.forEach(f => {
            if (!(f in result)) {
                result[f] = '';
            }
        });
        return result;
    };
    // 图片字段（不可编辑，显示图片）
    const imageFields = new Set(['pic', 'albumPics1', 'albumPics2', 'albumPics3', 'albumPics4', 'albumPics5']);
    // 字段排序：主图优先
    const sortCompletionKeys = (keys: string[]) => {
        const priority = ['pic', 'productName', 'brandName', 'vendorName', 'categoryName', 'categoryName1', 'productTypeName', 'unitName', 'businessCode', 'isSelfManageStock'];
        return [...keys].sort((a, b) => {
            const ai = priority.indexOf(a), bi = priority.indexOf(b);
            if (ai >= 0 && bi >= 0) return ai - bi;
            if (ai >= 0) return -1;
            if (bi >= 0) return 1;
            return keys.indexOf(a) - keys.indexOf(b);
        });
    };
    const getFieldLabel = (key: string) => completionFieldLabels[key] || key;

    // 更新补全信息某行某字段
    const updateCompletionField = (rowIdx: number, field: string, value: string) => {
        setCompletionList(prev => prev.map((item, idx) =>
            idx === rowIdx ? { ...item, [field]: value } : item
        ));
    };

    // ======== 步骤 7：确认补全信息选择 ======== //
    const handleConfirmCompletion = async () => {
        // 必填字段校验
        const requiredFields = [
            'isSelfManageStock', 'productTypeName', 'vendorName', 'productName', 'brandName',
            'businessCode', 'unitName', 'categoryName', 'pic',
            'recommendedRetailPrice',
            'specificationValue', 'specificationName', 'externalSkuCode'
        ];
        const fieldLabels: Record<string, string> = {
            isSelfManageStock: '供货方式', productTypeName: '商品类型', vendorName: '供应商名称',
            productName: '商品名称', brandName: '品牌名称', businessCode: '业务编码',
            unitName: '单位', categoryName: '分类名称', pic: '主图', ean: '条码',
            proxyPrice: '代发供货价', centralizedPrice: '集采供货价', recommendedRetailPrice: '建议零售价',
            productLink: '商品链接', platformName: '平台名称', specificationValue: '规格值',
            specificationName: '规格名', externalSkuCode: '产品编码'
        };
        for (let i = 0; i < completionList.length; i++) {
            const item = completionList[i];
            const missingFields = requiredFields.filter(f => {
                const val = item[f];
                return val === undefined || val === null || val === '';
            });
            // 根据供货方式校验对应价格字段
            const stockType = item.isSelfManageStock;
            const isDaifa = stockType === 1 || stockType === '1' || stockType === '代发';
            const isJicai = stockType === 0 || stockType === '0' || stockType === '集采';
            if (isDaifa && (!item.proxyPrice || item.proxyPrice === '')) {
                missingFields.push('proxyPrice');
            }
            if (isJicai && (!item.centralizedPrice || item.centralizedPrice === '')) {
                missingFields.push('centralizedPrice');
            }
            // 商品链接和平台名称必须同时填写或同时为空
            const hasLink = item.productLink && item.productLink !== '';
            const hasPlatform = item.platformName && item.platformName !== '';
            if (hasLink !== hasPlatform) {
                const productName = item.productName || item['商品名称'] || `第${i + 1}条`;
                sysAlert(`「${productName}」商品链接和平台名称必须同时填写或同时为空`);
                return;
            }
            if (missingFields.length > 0) {
                const productName = item.productName || item['商品名称'] || `第${i + 1}条`;
                const missingLabels = missingFields.map(f => fieldLabels[f] || f).join('、');
                sysAlert(`「${productName}」缺少必填字段：${missingLabels}`);
                return;
            }
        }

        // 价格字段清理：提交前去除特殊字符，确保为有效浮点数
        const priceFieldKeys = ['proxyPrice', 'centralizedPrice', 'recommendedRetailPrice', 'platformPrice', 'bottomPrice'];
        const sanitizedList = completionList.map(item => {
            const sanitized = { ...item };
            priceFieldKeys.forEach(key => {
                const val = sanitized[key];
                if (val !== undefined && val !== null && val !== '') {
                    // 去除所有非数字和小数点的字符
                    const cleaned = String(val).replace(/[^\d.]/g, '');
                    // 只保留第一个小数点（防止 "12.34.56" 这种无效数字）
                    const parts = cleaned.split('.');
                    sanitized[key] = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : cleaned;
                }
            });
            return sanitized;
        });

        try {
            setIsConfirming(true);
            const resRaw = await fetchWithAuth('/api/product-entry/confirm-completion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    formToken: completionFormToken,
                    workflowRunId: completionWorkflowRunId,
                    completionList: sanitizedList,
                    fileNames: xlsxFiles.map(f => f.file.name)
                })
            });
            const res = await resRaw.json();
            if (!res.success) throw new Error(res.message || '确认补全信息失败');

            const resultData = res.data || '';
            setConfirmResult(resultData);
            parseEntryErrors(resultData);
            setStep('confirm');
            clearDraft();
            loadHistory();

            // 发送通知中心消息
            try {
                await fetchWithAuth('/api/notifications', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        appId: 'productentry',
                        appName: '商品库录入',
                        title: '商品录入完成',
                        message: `商品录入任务已执行完成，请查看录入结果。`
                    })
                });
                // 通知 SystemInterface 立即刷新通知列表
                window.dispatchEvent(new CustomEvent('refresh-notifications'));
            } catch (e) {
                console.error('发送通知失败:', e);
            }

            setTimeout(() => {
                resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 300);
        } catch (error: any) {
            sysAlert(`确认补全信息失败：${error.message}`);
            // 失败后重置状态，回到上传页面
            handleReset();
        } finally {
            setIsConfirming(false);
        }
    };

    // ======== 查看历史记录 ======== //
    const viewHistoryResult = (record: HistoryRecord) => {
        const resultData = record.confirm_result || record.parse_result || '';
        setConfirmResult(resultData);
        parseEntryErrors(resultData);
        setStep('confirm');
        setShowHistory(false);
    };

    const deleteHistoryRecord = async (id: number) => {
        if (!window.confirm('确定要删除这条记录吗？')) return;
        try {
            const res = await fetchWithAuth(`/api/product-entry/history/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) loadHistory();
            else sysAlert(`删除失败：${data.message}`);
        } catch (error: any) {
            sysAlert(`删除失败：${error.message}`);
        }
    };

    // ======== 渲染：上传区域 ======== //
    const renderUploadArea = () => (
        <div
            className={`relative rounded-2xl border-2 overflow-hidden transition-all duration-300 group min-h-[260px] ${
                dragOver
                    ? 'border-dashed border-emerald-400 bg-emerald-50'
                    : xlsxFiles.length > 0
                        ? 'border-transparent shadow-lg shadow-black/5 bg-slate-50'
                        : 'border-dashed border-slate-300 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-400'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => xlsxFiles.length === 0 && fileInputRef.current?.click()}
        >
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".xlsx,.xls"
                onChange={handleChange}
            />

            {xlsxFiles.length > 0 ? (
                <div className="absolute inset-0 p-4 overflow-y-auto">
                    <div className="flex flex-col gap-2">
                        {xlsxFiles.map((f, idx) => (
                            <div key={idx} className="flex items-center gap-3 bg-white rounded-xl px-4 py-2.5 shadow-sm border border-slate-100 group/item hover:shadow-md transition-all">
                                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-emerald-50 text-emerald-500">
                                    <FileSpreadsheet className="w-4 h-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-700 truncate">{f.file.name}</p>
                                    <p className="text-[11px] text-slate-400">{(f.file.size / 1024 / 1024).toFixed(2)} MB</p>
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                                    className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover/item:opacity-100"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                        <button
                            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                            className="text-xs text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-all"
                        >
                            <UploadCloud className="w-3.5 h-3.5" /> 重新选择
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); clearFiles(); }}
                            className="text-xs text-red-400 hover:text-red-500 font-medium flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-all"
                        >
                            <Trash2 className="w-3.5 h-3.5" /> 清空全部
                        </button>
                    </div>
                </div>
            ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 p-6 cursor-pointer">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 transition-all duration-300 ${
                        dragOver
                            ? 'bg-emerald-100 text-emerald-500 scale-110'
                            : 'bg-white shadow-sm border border-slate-100 text-slate-400 group-hover:scale-105 group-hover:shadow group-hover:text-slate-600'
                    }`}>
                        <FileSpreadsheet className="w-7 h-7" />
                    </div>
                    <p className="text-sm font-medium text-slate-600 mb-1">点击打开 或 拖拽文件至此</p>
                    <p className="text-[11px] text-slate-400">支持 XLSX/XLS 格式，单个文件，大小不超过 100MB</p>
                </div>
            )}
        </div>
    );

    // 列定义（完全动态 + 固定列）
    const allColumns = [
        { key: 'row', label: '行号', canDelete: false },
        // 动态列（从数据中提取的字段，key 直接作为表头）
        ...dynamicKeys.map(k => ({ key: k, label: k, canDelete: true })),
        { key: 'status', label: '状态', canDelete: false },
        { key: 'split', label: '拆分', canDelete: false },
    ];
    const visibleCols = allColumns.filter(c => visibleColumns.has(c.key));
    const colSpan = visibleCols.length + 2; // +1 for checkbox, +1 for 操作 column

    // 列宽配置
    const getColWidth = (key: string) => {
        if (key === 'row') return 'w-12';
        if (key === 'status' || key === 'split') return 'w-16';
        if (key === '型号' || key === '69码' || key === '商品条码') return 'min-w-[160px]';
        if (key === '品名' || key === '品 名' || key === '产品名称' || key === '商品名称') return 'min-w-[200px]';
        if (key === '链接') return 'min-w-[180px]';
        return 'min-w-[120px]';
    };

    // 排序函数
    const sortItems = (items: SkuItem[]): SkuItem[] => {
        if (!sortKey) return items;
        return [...items].sort((a, b) => {
            const aVal = (a as any)[sortKey];
            const bVal = (b as any)[sortKey];
            if (aVal === undefined || aVal === null || aVal === '') return 1;
            if (bVal === undefined || bVal === null || bVal === '') return -1;
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
            }
            const aStr = String(aVal);
            const bStr = String(bVal);
            return sortDirection === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
        });
    };

    // 按 SPU 组聚合显示（useMemo 在组件顶层，避免 hooks 数量不一致）
    type RowData = { type: 'sku'; item: SkuItem } | { type: 'spu_header'; groupIdx: number; group: SpuGroup };
    const orderedRows = useMemo<RowData[]>(() => {
        const rows: RowData[] = [];
        const renderedRows = new Set<number>();

        spuGroups.forEach((group, groupIdx) => {
            rows.push({ type: 'spu_header', groupIdx, group });
            const members = group.sku_rows
                .map(rowNum => skuList.find(s => s.row === rowNum))
                .filter((s): s is SkuItem => !!s)
                .sort((a, b) => a.row - b.row);
            members.forEach(item => {
                rows.push({ type: 'sku', item });
                renderedRows.add(item.row);
            });
        });

        const independentItems: SkuItem[] = [];
        skuList.forEach(item => {
            if (!renderedRows.has(item.row)) {
                independentItems.push(item);
            }
        });
        sortItems(independentItems).forEach(item => {
            rows.push({ type: 'sku', item });
        });
        return rows;
    }, [skuList, spuGroups, sortKey, sortDirection]);

    // ======== 渲染：SKU 表格 ======== //
    const renderSkuTable = () => {
        if (skuList.length === 0) return null;

        // 渲染单元格内容
        const renderCell = (item: SkuItem, colKey: string) => {
            // 固定列 - 不可编辑
            if (colKey === 'row') return <>{item.row}</>;
            if (colKey === 'status') {
                return item.mergedInto !== undefined
                    ? <span className="text-xs bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full">已合并</span>
                    : item.split
                        ? <span className="text-xs bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full">已拆分</span>
                        : <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">独立</span>;
            }
            if (colKey === 'split') {
                return item.split
                    ? <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">{item.SPLIT || '拆分'}</span>
                    : <span className="text-xs text-slate-300">—</span>;
            }

            // 图片列 - 不可编辑，悬浮预览大图
            const val = (item as any)[colKey];
            if (typeof val === 'string' && /\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i.test(val)) {
                return (
                    <div
                        className="relative inline-block"
                        onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setPreviewPos({ x: rect.right + 8, y: rect.top });
                            setPreviewImage(val);
                        }}
                        onMouseLeave={() => setPreviewImage(null)}
                    >
                        <img src={val} alt={colKey} style={{ width: 32, height: 32, objectFit: 'cover' }} className="rounded border border-slate-200 bg-slate-50 cursor-zoom-in" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    </div>
                );
            }

            // 只读状态或已合并行 - 保持与可编辑状态一致的展示格式
            if (isReadOnly || item.mergedInto !== undefined) {
                if (val === undefined || val === null || val === '') return <span className="text-slate-300">-</span>;
                // URL 链接检测
                if (typeof val === 'string' && val.startsWith('http')) {
                    return <a href={val} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 underline text-[11px] max-w-[150px] truncate block" title={val}>查看链接</a>;
                }
                // 多行字段在只读/合并状态下也完整展示，保持与 textarea 一致的宽度约束
                const isMultiLineField = MULTI_LINE_FIELD_RE.test(colKey);
                if (isMultiLineField) {
                    return <span className="whitespace-pre-wrap break-all leading-relaxed text-slate-700 min-w-[120px] max-w-[250px] inline-block" title={String(val)}>{String(val)}</span>;
                }
                return <span className="text-slate-700 min-w-[120px] max-w-[200px] truncate inline-block" title={String(val)}>{String(val)}</span>;
            }

            // 可编辑字段 - 渲染输入框
            const displayVal = val === undefined || val === null ? '' : String(val);
            // 名称类字段用 textarea 支持换行展示
            const isNameField = MULTI_LINE_FIELD_RE.test(colKey);
            if (isNameField) {
                return (
                    <textarea
                        defaultValue={displayVal}
                        rows={1}
                        onClick={(e) => e.stopPropagation()}
                        ref={textareaRefCallback}
                        onInput={(e) => {
                            const el = e.target as HTMLTextAreaElement;
                            el.style.height = 'auto';
                            el.style.height = el.scrollHeight + 'px';
                        }}
                        onBlur={(e) => {
                            const newVal = e.target.value;
                            if (newVal !== displayVal) {
                                setSkuList(prev => prev.map(s => 
                                    s.row === item.row ? { ...s, [colKey]: newVal } : s
                                ));
                            }
                        }}
                        className="w-full min-w-[120px] px-1.5 py-1 text-xs rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500 bg-transparent focus:bg-white transition-all outline-none resize-none overflow-hidden"
                        placeholder="-"
                    />
                );
            }
            return (
                <input
                    type="text"
                    defaultValue={displayVal}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                        const newVal = e.target.value;
                        if (newVal !== displayVal) {
                            setSkuList(prev => prev.map(s => 
                                s.row === item.row ? { ...s, [colKey]: newVal } : s
                            ));
                        }
                    }}
                    className="w-full px-1.5 py-0.5 text-xs rounded border border-transparent hover:border-slate-200 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500 bg-transparent focus:bg-white transition-all outline-none"
                    placeholder="-"
                />
            );
        };

        return (
            <div className="overflow-x-auto overflow-y-hidden rounded-xl border border-slate-200 w-full">
                <table className="w-full min-w-[1200px] text-sm">
                    <thead className="bg-slate-50 sticky top-0 z-10">
                        <tr className="border-b border-slate-200">
                            <th className="w-10 py-2.5 px-3 text-center">
                                <input
                                    type="checkbox"
                                    className="rounded border-slate-300 text-emerald-500 focus:ring-emerald-500"
                                    onChange={toggleAll}
                                    checked={selectedRows.size > 0 && selectedRows.size === skuList.filter(s => s.mergedInto === undefined).length}
                                    disabled={isReadOnly}
                                />
                            </th>
                            {visibleCols.map(col => (
                                <th 
                                    key={col.key} 
                                    className={`${getColWidth(col.key)} py-2.5 px-3 text-left font-semibold text-slate-600 cursor-pointer hover:bg-slate-100 transition-colors select-none whitespace-nowrap`}
                                    onClick={() => handleSort(col.key)}
                                >
                                    <span className="flex items-center gap-1">
                                        {col.label}
                                        {sortKey === col.key ? (
                                            sortDirection === 'asc' 
                                                ? <span className="text-emerald-500 text-xs">↑</span>
                                                : <span className="text-emerald-500 text-xs">↓</span>
                                        ) : (
                                            <span className="text-slate-300 text-xs">⇅</span>
                                        )}
                                    </span>
                                </th>
                            ))}
                            <th className="py-2.5 px-2 text-center font-semibold text-slate-600 w-12 whitespace-nowrap">
                                {!isReadOnly && '操作'}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {orderedRows.map((row) => {
                            if (row.type === 'spu_header') {
                                return (
                                    <tr key={`spu-${row.groupIdx}`} className="bg-emerald-50 border-b border-emerald-200">
                                        <td colSpan={colSpan} className="py-2 px-3">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    {!isReadOnly && (
                                                        <button
                                                            onClick={() => dissolveGroup(row.groupIdx)}
                                                            className="text-xs text-red-400 hover:text-red-500 font-medium flex items-center gap-1 px-2 py-1 rounded hover:bg-red-50 transition-all"
                                                            title="解散此 SPU 组"
                                                        >
                                                            <Undo2 className="w-3 h-3" /> 解散
                                                        </button>
                                                    )}
                                                    <ChevronDown className="w-4 h-4 text-emerald-600" />
                                                    <span className="font-semibold text-emerald-700 text-sm">{row.group.spu_name}</span>
                                                    <span className="text-xs bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full">
                                                        {row.group.sku_rows.length} 个 SKU
                                                    </span>
                                                </div>
                                                {!isReadOnly && (
                                                    <button
                                                        onClick={() => dissolveGroup(row.groupIdx)}
                                                        className="text-xs text-red-400 hover:text-red-500 font-medium flex items-center gap-1 px-2 py-1 rounded hover:bg-red-50 transition-all"
                                                    >
                                                        <Undo2 className="w-3 h-3" /> 解散
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            }

                            const item = row.item;
                            const isMerged = item.mergedInto !== undefined;
                            const isSplit = item.split === true;
                            const isSelected = selectedRows.has(item.row);
                            const isDisabled = isMerged;

                            return (
                                <tr
                                    key={`sku-${item.row}`}
                                    className={`border-b border-slate-100 transition-colors cursor-pointer ${
                                        isMerged ? 'bg-slate-50/50' : isSplit ? 'bg-amber-50/40 hover:bg-amber-50' : 'hover:bg-slate-50'
                                    } ${isSelected ? 'bg-blue-50 hover:bg-blue-50' : ''}`}
                                    onClick={() => !isDisabled && !isReadOnly && toggleRow(item.row)}
                                >
                                    <td className="py-2 px-3 text-center">
                                        <input
                                            type="checkbox"
                                            className="rounded border-slate-300 text-emerald-500 focus:ring-emerald-500 disabled:opacity-40 pointer-events-none"
                                            checked={isSelected}
                                            disabled={isDisabled || isReadOnly}
                                            readOnly
                                            tabIndex={-1}
                                        />
                                    </td>
                                    {visibleCols.map(col => (
                                        <td key={col.key} className={`${getColWidth(col.key)} py-2 px-2 text-xs ${
                                            col.key === 'row' ? 'text-slate-500' : col.key === 'name' ? 'text-slate-700 text-sm font-medium' : 'text-slate-500'
                                        } ${isMerged && col.key === 'row' ? 'pl-8' : ''} ${
                                            ['status', 'split', 'row'].includes(col.key) ? 'whitespace-nowrap' : ''
                                        }`}>
                                            {isMerged && col.key === 'row' && <span className="text-emerald-400 mr-1">└─</span>}
                                            {renderCell(item, col.key)}
                                        </td>
                                    ))}
                                    <td className="py-2 px-2 text-center">
                                        {!isMerged && !isReadOnly && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleDeleteRow(item.row); }}
                                                className="w-6 h-6 rounded flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all mx-auto"
                                                title="删除此行"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    };

    // ======== 渲染：历史记录面板 ======== //
    const renderHistory = () => (
        <div className="shrink-0 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <h3 className="font-semibold text-slate-700 flex items-center gap-2 mb-3">
                <History className="w-4 h-4 text-emerald-500" />
                录入历史记录
            </h3>
            {history.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">暂无历史记录</p>
            ) : (
                <div className="max-h-[300px] overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-slate-50">
                            <tr className="border-b border-slate-200">
                                <th className="text-left py-2 px-3 font-medium text-slate-500">时间</th>
                                <th className="text-left py-2 px-3 font-medium text-slate-500">文件</th>
                                <th className="text-left py-2 px-3 font-medium text-slate-500">状态</th>
                                <th className="text-left py-2 px-3 font-medium text-slate-500">操作人</th>
                                <th className="text-left py-2 px-3 font-medium text-slate-500">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.map((record) => (
                                <tr key={record.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                    <td className="py-2 px-3 text-slate-600 text-xs">{new Date(record.created_at).toLocaleString('zh-CN')}</td>
                                    <td className="py-2 px-3 text-slate-700 text-xs truncate max-w-[150px]">{record.file_names || '-'}</td>
                                    <td className="py-2 px-3">
                                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                                            record.status === 'confirmed' ? 'bg-emerald-100 text-emerald-600' : 'bg-yellow-100 text-yellow-600'
                                        }`}>{record.status === 'confirmed' ? '已录入' : '已解析'}</span>
                                    </td>
                                    <td className="py-2 px-3 text-slate-500 text-xs">{record.username}</td>
                                    <td className="py-2 px-3">
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => viewHistoryResult(record)} className="text-xs text-blue-500 hover:text-blue-600 font-medium">查看</button>
                                            <button onClick={() => deleteHistoryRecord(record.id)} className="text-xs text-red-400 hover:text-red-500 font-medium">删除</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );

    // ======== 主渲染 ======== //
    return (
        <div className="h-full flex flex-col gap-6 p-4 sm:p-6 md:p-8 md:px-12 bg-slate-50/50 overflow-y-auto overflow-x-hidden relative">
            {/* 草稿恢复对话框 */}
            {showDraftDialog && draftInfo && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4 animate-in fade-in zoom-in duration-200">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                                <History className="w-5 h-5 text-amber-600" />
                            </div>
                            <h3 className="text-lg font-bold text-slate-800">检测到未完成的任务</h3>
                        </div>
                        <div className="bg-slate-50 rounded-xl p-4 mb-5 space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">供应商</span>
                                <span className="font-medium text-slate-700">{draftInfo.supplier || '未填写'}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">当前步骤</span>
                                <span className="font-medium text-emerald-600">{stepLabels[draftInfo.step]}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">保存时间</span>
                                <span className="font-medium text-slate-700">{new Date(draftInfo.savedAt).toLocaleString('zh-CN')}</span>
                            </div>
                        </div>
                        <p className="text-xs text-slate-500 mb-5">是否恢复到上次的工作进度？</p>
                        <div className="flex gap-3">
                            <button
                                onClick={discardDraft}
                                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all"
                            >
                                重新开始
                            </button>
                            <button
                                onClick={restoreDraft}
                                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm transition-all"
                            >
                                恢复进度
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="shrink-0 bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex-1">
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Database className="w-5 h-5 text-emerald-500" />
                        商品库录入工具
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">支持上传 .xlsx / .xls 格式表格，AI 自动解析商品信息，支持 SKU 合并或拆分为 SPU 后批量录入商品库。</p>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                    {step !== 'upload' && (
                        <button
                            onClick={handleReset}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 transition-all"
                        >
                            <ArrowLeft className="w-4 h-4" /> 重新上传
                        </button>
                    )}
                    <button
                        onClick={() => setShowHistory(!showHistory)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                            showHistory ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'
                        }`}
                    >
                        <History className="w-4 h-4" /> 历史记录
                    </button>
                </div>
            </div>

            {/* 历史记录面板 */}
            {showHistory && renderHistory()}

            {/* 阶段一：上传 */}
            {step === 'upload' && (
                <>
                    <div className="shrink-0">
                        <div className="flex items-center justify-between px-1 mb-3">
                            <h3 className="font-semibold text-slate-700 flex items-center gap-2 text-sm">
                                <FileSpreadsheet className="w-4 h-4" />
                                XLSX 表格文件
                                <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-sm font-bold">必填</span>
                            </h3>
                            {xlsxFiles.length > 0 && (
                                <div className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium bg-emerald-50 px-2 py-1 rounded">
                                    <CheckCircle2 className="w-3.5 h-3.5" /> 已选择
                                </div>
                            )}
                        </div>
                        {renderUploadArea()}
                    </div>



                    <div className="shrink-0 bg-white p-4 rounded-2xl border border-slate-200 shadow-[0_-4px_20px_-15px_rgba(0,0,0,0.1)] flex flex-col items-center">
                        <button
                            onClick={handleParse}
                            disabled={isParsing || xlsxFiles.length === 0}
                            className={`w-[280px] h-12 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 text-[15px] shrink-0 ${
                                xlsxFiles.length > 0 && !isParsing
                                    ? 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:-translate-y-0.5'
                                    : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                            }`}
                        >
                            {isParsing ? (
                                <><Loader2 className="w-5 h-5 animate-spin" /> {parseProgress || '正在解析商品数据...'}</>
                            ) : (
                                <><Sparkles className="w-5 h-5" /> 开始解析</>
                            )}
                        </button>
                    </div>
                </>
            )}

            {/* 阶段二：Sheet 选择 */}
            {step === 'selectSheet' && (
                <div className="shrink-0 flex flex-col gap-4">
                    {/* 一行三列：Sheet + 品牌 + 供应商 */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Sheet 选择 */}
                        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-2">
                                <Database className="w-4 h-4 text-emerald-500" />
                                选择 Sheet
                                <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{sheets.length} 个</span>
                            </h3>
                            <div className="max-h-[180px] overflow-y-auto rounded-xl border border-slate-200">
                                {sheets.map((sheet, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => setSelectedSheet(sheet)}
                                        disabled={isParsing}
                                        className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-all border-b border-slate-100 last:border-b-0 ${
                                            isParsing ? 'cursor-not-allowed opacity-60' : ''
                                        } ${
                                            selectedSheet === sheet
                                                ? 'bg-emerald-50 text-emerald-700'
                                                : 'bg-white text-slate-700 hover:bg-slate-50'
                                        }`}
                                    >
                                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                                            selectedSheet === sheet
                                                ? 'bg-emerald-500 text-white'
                                                : 'bg-slate-100 text-slate-400'
                                        }`}>{idx + 1}</span>
                                        <span className="flex-1 truncate text-sm">{sheet}</span>
                                        {selectedSheet === sheet && (
                                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* 品牌选择 */}
                        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                            <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                                <Database className="w-4 h-4 text-emerald-500" />
                                选择品牌
                                <span className="text-[10px] bg-red-50 text-red-500 px-1.5 py-0.5 rounded-sm font-normal">必填</span>
                            </label>
                            <div className="relative mb-2">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                                <input
                                    type="text"
                                    value={brandSearch}
                                    onChange={(e) => setBrandSearch(e.target.value)}
                                    placeholder="搜索品牌..."
                                    disabled={isParsing}
                                    className="w-full pl-8 pr-2 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:bg-slate-50 disabled:cursor-not-allowed"
                                />
                            </div>
                            <div className="max-h-[140px] overflow-y-auto rounded-xl border border-slate-200">
                                {brandList.filter(b => !brandSearch || b.toLowerCase().includes(brandSearch.toLowerCase())).length === 0 ? (
                                    <div className="px-3 py-2 text-xs text-slate-400 text-center">{brandSearch ? '无匹配品牌' : '品牌库为空'}</div>
                                ) : (
                                    brandList.filter(b => !brandSearch || b.toLowerCase().includes(brandSearch.toLowerCase())).map((b, i) => (
                                        <button
                                            key={i}
                                            type="button"
                                            onClick={() => { setSelectedBrand(b); setBrandSearch(''); }}
                                            disabled={isParsing}
                                            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                                                isParsing ? 'cursor-not-allowed opacity-60' : ''
                                            } ${
                                                selectedBrand === b ? 'bg-emerald-50 text-emerald-700 font-medium' : 'hover:bg-slate-50 text-slate-700'
                                            }`}
                                        >
                                            <span className="flex-1 truncate text-sm">{b}</span>
                                            {selectedBrand === b && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                                        </button>
                                    ))
                                )}
                            </div>
                            {selectedBrand && (
                                <div className="mt-1.5 flex items-center gap-1.5">
                                    <span className="text-xs text-slate-500">已选：</span>
                                    <span className="text-xs bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded-full font-medium">{selectedBrand}</span>
                                    {!isParsing && (
                                        <button onClick={() => setSelectedBrand('')} className="text-xs text-slate-400 hover:text-red-500">×</button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* 供应商选择 */}
                        {supplierList.length > 0 ? (
                            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                                <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                                    <Database className="w-4 h-4 text-emerald-500" />
                                    选择供应商
                                    <span className="text-[10px] bg-red-50 text-red-500 px-1.5 py-0.5 rounded-sm font-normal">必填</span>
                                </label>
                                <div className="relative mb-2">
                                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                                    <input
                                        type="text"
                                        value={supplierSearch}
                                        onChange={(e) => setSupplierSearch(e.target.value)}
                                        placeholder="搜索供应商..."
                                        disabled={isParsing}
                                        className="w-full pl-8 pr-2 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:bg-slate-50 disabled:cursor-not-allowed"
                                    />
                                </div>
                                <div className="max-h-[140px] overflow-y-auto rounded-xl border border-slate-200">
                                    {supplierList.filter(s => !supplierSearch || s.toLowerCase().includes(supplierSearch.toLowerCase())).length === 0 ? (
                                        <div className="px-3 py-2 text-xs text-slate-400 text-center">{supplierSearch ? '无匹配供应商' : '供应商库为空'}</div>
                                    ) : (
                                        supplierList.filter(s => !supplierSearch || s.toLowerCase().includes(supplierSearch.toLowerCase())).map((s, i) => (
                                            <button
                                                key={i}
                                                type="button"
                                                onClick={() => { setSelectedSupplier(s); setSupplierSearch(''); }}
                                                disabled={isParsing}
                                                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                                                    isParsing ? 'cursor-not-allowed opacity-60' : ''
                                                } ${
                                                    selectedSupplier === s ? 'bg-emerald-50 text-emerald-700 font-medium' : 'hover:bg-slate-50 text-slate-700'
                                                }`}
                                            >
                                                <span className="flex-1 truncate text-sm">{s}</span>
                                                {selectedSupplier === s && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                                            </button>
                                        ))
                                    )}
                                </div>
                                {selectedSupplier && (
                                    <div className="mt-1.5 flex items-center gap-1.5">
                                        <span className="text-xs text-slate-500">已选：</span>
                                        <span className="text-xs bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded-full font-medium">{selectedSupplier}</span>
                                        {!isParsing && (
                                            <button onClick={() => setSelectedSupplier('')} className="text-xs text-slate-400 hover:text-red-500">×</button>
                                        )}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-center">
                                <div className="text-center text-slate-400">
                                    <Database className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                    <p className="text-sm">无供应商可选</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 确认并解析按钮 - 固定在底部 */}
                    <div className="sticky bottom-0 bg-white p-4 rounded-2xl border border-slate-200 shadow-lg flex justify-center z-10">
                        <button
                            onClick={handleConfirmSheet}
                            disabled={isParsing || !selectedSheet || !selectedBrand || (supplierList.length > 0 && !selectedSupplier)}
                            className={`w-[320px] h-12 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 text-[15px] shrink-0 ${
                                selectedSheet && selectedBrand && (!supplierList.length || selectedSupplier) && !isParsing
                                    ? 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:-translate-y-0.5'
                                    : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                            }`}
                        >
                            {isParsing ? (
                                <><Loader2 className="w-5 h-5 animate-spin" /> {parseProgress || '正在解析...'}</>
                            ) : (
                                <><CheckCircle2 className="w-5 h-5" /> 确认并解析</>
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* 阶段三：解析结果 + SKU 合并 */}
            {step === 'parse' && (
                <div ref={resultRef} className="shrink-0 flex flex-col gap-4 min-w-0">
                    {/* SKU 表格 */}
                    {skuList.length > 0 && (
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm relative flex flex-col max-h-[calc(100vh-200px)]">
                            {/* 固定标题栏：标题 + 操作按钮 */}
                            <div className="z-20 bg-white border-b border-slate-200 px-4 py-3 rounded-t-2xl flex items-center justify-between shrink-0">
                                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                    <Database className="w-5 h-5 text-emerald-500" />
                                    解析结果 — SKU 列表
                                    <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{skuList.length} 行</span>
                                    {selectedRows.size > 0 && (
                                        <span className="text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">已选 {selectedRows.size} 行</span>
                                    )}
                                    {spuGroups.length > 0 && (
                                        <span className="text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">{spuGroups.length} 个 SPU 组</span>
                                    )}
                                </h3>
                                {/* 悬浮操作按钮组 */}
                                {!isReadOnly && (
                                    <div className="flex items-center gap-2">
                                        {(() => {
                                            const allSplit = selectedRows.size > 0 && Array.from(selectedRows).every(r => skuList.find(s => s.row === r)?.split);
                                            const hasColorField = dynamicKeys.includes('颜色');
                                            return (
                                                <button
                                                    onClick={handleSplitToSpu}
                                                    disabled={selectedRows.size === 0 || (!allSplit && !hasColorField)}
                                                    title={!hasColorField ? '数据中没有「颜色」字段，无法拆分' : undefined}
                                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                                        selectedRows.size > 0 && (allSplit || hasColorField)
                                                            ? allSplit
                                                                ? 'bg-slate-500 hover:bg-slate-600 text-white shadow-sm'
                                                                : 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm'
                                                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                                    }`}
                                                >
                                                    <GitBranch className="w-3.5 h-3.5" /> {allSplit ? '取消拆分' : '颜色拆分为 SPU'}
                                                </button>
                                            );
                                        })()}
                                        <button
                                            onClick={handleMergeToSpu}
                                            disabled={selectedRows.size < 2}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                                selectedRows.size >= 2
                                                    ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm'
                                                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                            }`}
                                        >
                                            <Merge className="w-3.5 h-3.5" /> 合并为 SPU
                                        </button>
                                        <button
                                            onClick={handleDeleteSelectedRows}
                                            disabled={selectedRows.size === 0 || selectedRows.size >= skuList.length}
                                            title={selectedRows.size >= skuList.length ? '至少保留一条数据' : undefined}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                                selectedRows.size > 0 && selectedRows.size < skuList.length
                                                    ? 'bg-red-500 hover:bg-red-600 text-white shadow-sm'
                                                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                            }`}
                                        >
                                            <Trash2 className="w-3.5 h-3.5" /> 删除选中行
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* 可滚动表格区域 */}
                            <div ref={scrollContainerRef} className="overflow-auto flex-1 p-4">
                                {renderSkuTable()}
                            </div>
                        </div>
                    )}



                    {/* 确认按钮 */}
                    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-[0_-4px_20px_-15px_rgba(0,0,0,0.1)] flex flex-col items-center">
                        <button
                            onClick={handleConfirm}
                            disabled={isConfirming || skuList.length === 0}
                            className={`w-[280px] h-12 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 text-[15px] shrink-0 ${
                                skuList.length > 0 && !isConfirming
                                    ? 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:-translate-y-0.5'
                                    : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                            }`}
                        >
                            {isConfirming ? (
                                <><Loader2 className="w-5 h-5 animate-spin" /> {confirmProgress || '正在录入商品库...'}</>
                            ) : (
                                <><CheckCircle2 className="w-5 h-5" /> 确认录入</>
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* 阶段 6：补全信息列表（卡片可编辑） */}
            {step === 'completionInfo' && (
                <div ref={resultRef} className="shrink-0 flex flex-col gap-4">
                    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-emerald-500" />
                                补全信息列表
                                <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{completionList.length} 项</span>
                                <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full ml-1">可编辑</span>
                            </h3>
                        </div>

                        {completionList.length > 0 ? (
                            <div className="flex flex-col gap-4 max-h-[600px] overflow-y-auto pr-1">
                                {completionList.map((item, idx) => {
                                    const keys = sortCompletionKeys(Object.keys(item));
                                    const picUrl = item.pic || '';
                                    const albumPics = ['albumPics1','albumPics2','albumPics3','albumPics4','albumPics5']
                                        .map(k => ({ key: k, url: item[k] }))
                                        .filter(a => a.url);
                                    const editableKeys = keys.filter(k => !imageFields.has(k));
                                    const errorMsg = item.errorMsg;
                                    const picKey = `card-${idx}-${picUrl}`;
                                    const imgFailed = failedImages.has(picKey);

                                    return (
                                        <div key={idx} className={`rounded-xl border-2 ${
                                            errorMsg ? 'border-red-300 bg-red-50/50' : 'border-slate-300 bg-white'
                                        }`}>
                                            {/* 卡片头部 */}
                                            <div className={`px-4 py-2.5 flex items-center justify-between border-b-2 ${
                                                errorMsg ? 'bg-red-100/60 border-red-200' : 'bg-slate-100 border-slate-200'
                                            } rounded-t-xl`}>
                                                <div className="flex items-center gap-2">
                                                    <span className="w-7 h-7 rounded-full bg-emerald-500 text-white text-xs flex items-center justify-center font-bold">{idx + 1}</span>
                                                    <span className="text-sm font-semibold text-slate-700 truncate max-w-[300px]">
                                                        {item.productName || item.productTypeName || `商品 #${idx + 1}`}
                                                    </span>
                                                </div>
                                                {errorMsg && (
                                                    <span className="text-xs text-red-500 font-medium truncate max-w-[200px]" title={errorMsg}>
                                                        ⚠ {errorMsg}
                                                    </span>
                                                )}
                                            </div>

                                            {/* 卡片内容：左图 + 右字段 */}
                                            <div className="p-4 flex gap-4 min-h-[160px]">
                                                {/* 左侧：图片区域 */}
                                                <div className="shrink-0 flex flex-col gap-1.5" style={{ width: 140 }}>
                                                    {/* 主图 */}
                                                    {picUrl && !imgFailed ? (
                                                        <img
                                                            src={picUrl}
                                                            alt="主图"
                                                            style={{ width: 140, height: 140, objectFit: 'contain' }}
                                                            className="rounded-lg border border-slate-200 bg-slate-50"
                                                            onError={() => setFailedImages(prev => new Set(prev).add(picKey))}
                                                        />
                                                    ) : (
                                                        <div className="rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 flex items-center justify-center text-slate-400 text-xs"
                                                            style={{ width: 140, height: 140 }}>
                                                            暂无主图
                                                        </div>
                                                    )}
                                                    <span className="text-[10px] text-slate-400 text-center">主图</span>
                                                    {/* SPU 图册缩略图 */}
                                                    {albumPics.length > 0 && (
                                                        <div className="flex flex-wrap gap-1 mt-1">
                                                            {albumPics.map(a => {
                                                                const aKey = `album-${idx}-${a.key}-${a.url}`;
                                                                const aFailed = failedImages.has(aKey);
                                                                return aFailed ? null : (
                                                                    <img
                                                                        key={a.key}
                                                                        src={a.url}
                                                                        alt={a.key}
                                                                        style={{ width: 36, height: 36, objectFit: 'cover' }}
                                                                        className="rounded border border-slate-200 bg-slate-50 cursor-pointer hover:border-emerald-400 hover:scale-110 transition-all"
                                                                        title={getFieldLabel(a.key)}
                                                                        onError={() => setFailedImages(prev => new Set(prev).add(aKey))}
                                                                    />
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* 右侧：字段网格 */}
                                                <div className="flex-1 grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
                                                    {editableKeys.map(key => {
                                                        const rawVal = item[key];
                                                        // 价格字段格式化（去除¥符号）
                                                        const isPriceField = key === 'proxyPrice' || key === 'centralizedPrice' || key === 'recommendedRetailPrice' || key === 'platformPrice' || key === 'bottomPrice';
                                                        let displayVal = String(rawVal ?? '');
                                                        if (isPriceField && displayVal) {
                                                            // 如果是数字，格式化为两位小数；如果是字符串，只保留数字和小数点
                                                            displayVal = typeof rawVal === 'number' 
                                                                ? rawVal.toFixed(2) 
                                                                : displayVal.replace(/[^\d.]/g, '');
                                                        }
                                                        return (
                                                        <div key={key} className="flex flex-col gap-0.5">
                                                            <label className="text-[11px] text-slate-500 font-medium">{getFieldLabel(key)}</label>
                                                            {key === 'isSelfManageStock' ? (
                                                                <select
                                                                    defaultValue={String(rawVal ?? '')}
                                                                    onChange={(e) => updateCompletionField(idx, key, e.target.value)}
                                                                    className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent focus:bg-white transition-all"
                                                                >
                                                                    <option value="">请选择</option>
                                                                    <option value="1">代发</option>
                                                                    <option value="0">集采</option>
                                                                </select>
                                                            ) : (
                                                                <input
                                                                    type="text"
                                                                    defaultValue={displayVal}
                                                                    onChange={(e) => {
                                                                        if (isPriceField) {
                                                                            // 价格字段只保留数字和小数点
                                                                            const filtered = e.target.value.replace(/[^\d.]/g, '');
                                                                            e.target.value = filtered;
                                                                        }
                                                                    }}
                                                                    onBlur={(e) => updateCompletionField(idx, key, e.target.value)}
                                                                    className={`w-full px-2.5 py-1.5 text-xs rounded-lg border transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent ${
                                                                        key === 'errorMsg'
                                                                            ? 'border-red-300 bg-red-50 text-red-600'
                                                                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 focus:bg-white'
                                                                    }`}
                                                                    placeholder={getFieldLabel(key)}
                                                                />
                                                            )}
                                                        </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="text-sm text-slate-400 text-center py-8">暂无补全信息数据</p>
                        )}
                    </div>

                    {/* 确认补全按钮 */}
                    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-[0_-4px_20px_-15px_rgba(0,0,0,0.1)] flex flex-col items-center">
                        <button
                            onClick={handleConfirmCompletion}
                            disabled={isConfirming || completionList.length === 0}
                            className={`w-[280px] h-12 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 text-[15px] shrink-0 ${
                                completionList.length > 0 && !isConfirming
                                    ? 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:-translate-y-0.5'
                                    : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                            }`}
                        >
                            {isConfirming ? (
                                <><Loader2 className="w-5 h-5 animate-spin" /> 正在提交补全信息...</>
                            ) : (
                                <><CheckCircle2 className="w-5 h-5" /> 确认补全并录入</>
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* 阶段：录入完成 */}
            {step === 'confirm' && (
                <div ref={resultRef} className="shrink-0 bg-white border border-slate-100 rounded-2xl p-4 sm:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] animate-in fade-in slide-in-from-top-4 duration-500 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50/50 rounded-full -mr-16 -mt-16 blur-3xl group-hover:bg-emerald-100/50 transition-colors duration-700"></div>

                    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100 relative">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${entryErrors ? 'bg-red-50' : 'bg-emerald-50'}`}>
                            {entryErrors ? (
                                <AlertCircle className="w-5 h-5 text-red-500" />
                            ) : (
                                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                            )}
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800 text-lg">商品录入结果</h3>
                            <p className="text-[11px] text-slate-400">
                                {entryErrors ? '部分数据录入失败，请检查后重新提交' : '商品库批量录入完成'}
                            </p>
                        </div>
                    </div>

                    {/* 错误信息展示 */}
                    {entryErrors && (
                        <div className="mb-6 space-y-4">
                            {/* 通用错误（接口调用失败） */}
                            {entryErrors.generalError && (
                                <div className="border border-red-300 rounded-xl overflow-hidden">
                                    <div className="bg-red-50 px-4 py-3 flex items-center gap-2">
                                        <AlertCircle className="w-4 h-4 text-red-500" />
                                        <span className="font-semibold text-red-700 text-sm">接口调用失败，请联系技术人员</span>
                                    </div>
                                    <div className="px-4 py-2 bg-white border-t border-red-200">
                                        <pre className="text-xs text-red-600 whitespace-pre-wrap break-all font-mono">{entryErrors.generalError}</pre>
                                    </div>
                                </div>
                            )}

                            {/* SPU + SKU 组合错误（按 businessCode 关联） */}
                            {(entryErrors.spuErrors.length > 0 || entryErrors.skuErrors.length > 0) && (() => {
                                // 按 businessCode 合并 SPU 和 SKU 错误
                                const mergedMap = new Map<string, { spu?: any; skus: any[] }>();
                                entryErrors.spuErrors.forEach(err => {
                                    const code = err.businessCode || '';
                                    if (!mergedMap.has(code)) mergedMap.set(code, { skus: [] });
                                    mergedMap.get(code)!.spu = err;
                                });
                                entryErrors.skuErrors.forEach(err => {
                                    const code = err.businessCode || '';
                                    if (!mergedMap.has(code)) mergedMap.set(code, { skus: [] });
                                    mergedMap.get(code)!.skus.push(err);
                                });
                                const mergedList = Array.from(mergedMap.entries());

                                // 图片字段
                                const imageFields = new Set(['albumPics1', 'albumPics2', 'albumPics3', 'albumPics4', 'albumPics5', 'pic']);
                                // SPU 字段 mapping
                                const spuFieldLabels: Record<string, string> = {
                                    businessCode: '业务编码', productName: '商品名称', brandName: '品牌',
                                    productTypeName: '商品类型', vendorName: '供应商', unitName: '单位',
                                    categoryName1: '一级分类', categoryName2: '二级分类', categoryName3: '三级分类',
                                    isSelfManageStock: '供货方式', albumPics1: 'SPU主图1', albumPics2: 'SPU主图2',
                                    albumPics3: 'SPU主图3', albumPics4: 'SPU主图4', albumPics5: 'SPU主图5'
                                };
                                // SKU Field mapping
                                const skuFieldLabels: Record<string, string> = {
                                    businessCode: '业务编码', externalSkuCode: '产品编码', pic: 'SKU主图',
                                    ean: '条码', specificationName: '规格名', specificationValue: '规格值',
                                    proxyPrice: '代发供货价', centralizedPrice: '集采供货价',
                                    recommendedRetailPrice: '建议零售价', bottomPrice: '最低售价'
                                };
                                const formatValue = (key: string, val: any) => {
                                    if (val === null || val === undefined || val === '') return '-';
                                    if (key === 'isSelfManageStock') return val === 1 || val === '1' ? '代发' : val === 0 || val === '0' ? '集采' : String(val);
                                    if (typeof val === 'number' && (key.includes('Price') || key === 'bottomPrice')) return val.toFixed(2);
                                    if (typeof val === 'string' && (key.includes('Price') || key === 'bottomPrice')) return val.replace(/^[¥￥]/, '');
                                    return String(val);
                                };

                                return (
                                    <div className="border border-red-200 rounded-xl overflow-hidden">
                                        <div className="bg-red-50 px-4 py-2.5 border-b border-red-200 flex items-center gap-2">
                                            <AlertCircle className="w-4 h-4 text-red-500" />
                                            <span className="font-semibold text-red-700 text-sm">SPU {mergedList.length} 条</span>
                                            <span className="text-xs text-red-500 ml-2">（含 SKU 错误 {entryErrors.skuErrors.length} 条）</span>
                                        </div>
                                        <div className="divide-y divide-slate-100">
                                            {mergedList.map(([, { spu, skus }], idx) => (
                                                <div key={idx} className="p-4 bg-white hover:bg-blue-50/40 transition-colors">
                                                    {/* SPU 信息 */}
                                                    {spu && (
                                                        <div className="mb-3">
                                                            <div className="flex items-start gap-2 mb-3 pb-2 border-b border-slate-100">
                                                                <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded font-medium shrink-0 mt-0.5">SPU</span>
                                                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 flex-1">
                                                                    <div className="flex items-center gap-1.5 text-sm">
                                                                        <span className="text-slate-400">SPU名称:</span>
                                                                        <span className="text-slate-700 font-medium">{spu.productName || '-'}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-1.5 text-sm">
                                                                        <span className="text-slate-400">品牌:</span>
                                                                        <span className="text-slate-700">{spu.brandName || '-'}</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            {/* 图片区域 */}
                                                            {Object.entries(spuFieldLabels).filter(([key]) => imageFields.has(key) && spu[key]).length > 0 && (
                                                                <div className="flex gap-2 mb-3 ml-2">
                                                                    {Object.entries(spuFieldLabels).filter(([key]) => imageFields.has(key) && spu[key]).map(([key, label]) => (
                                                                        <div key={key} className="flex flex-col items-center gap-1">
                                                                            <img src={String(spu[key])} alt={label} className="w-16 h-16 object-contain rounded border border-slate-200 bg-slate-50" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                                                            <span className="text-[10px] text-slate-400">{label}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            {/* 字段区域 */}
                                                            <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 ml-2">
                                                                {Object.entries(spuFieldLabels).filter(([key]) => !imageFields.has(key) && spu[key] && key !== 'productName' && key !== 'brandName').map(([key, label]) => (
                                                                    <div key={key} className="flex items-baseline gap-2 text-sm">
                                                                        <span className="text-slate-400 shrink-0 w-20">{label}</span>
                                                                        <span className="text-slate-700 truncate" title={formatValue(key, spu[key])}>{formatValue(key, spu[key])}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                            {/* 错误信息 */}
                                                            {spu.errorMsg && (
                                                                <div className="mt-3 ml-2 flex items-start gap-2">
                                                                    <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded shrink-0">错误</span>
                                                                    <span className="text-sm text-red-600 leading-5">{spu.errorMsg}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    {/* 关联的 SKU 错误 */}
                                                    {skus.length > 0 && (
                                                        <div className="mt-3 pt-3 border-t border-slate-100">
                                                            <div className="flex items-center gap-2 mb-3">
                                                                <span className="text-xs bg-orange-500 text-white px-2 py-0.5 rounded font-medium">SKU</span>
                                                                <span className="text-xs text-slate-400">{skus.length} 条错误</span>
                                                            </div>
                                                            <div className="space-y-2 ml-2">
                                                                {skus.map((sku, si) => (
                                                                    <div key={si} className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                                                                        {/* SKU 头部：图片 + 基本信息 */}
                                                                        <div className="flex items-start gap-3">
                                                                            {sku.pic && (
                                                                                <img src={String(sku.pic)} alt="SKU主图" className="w-14 h-14 object-contain rounded border border-slate-200 bg-white shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                                                            )}
                                                                            <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5 flex-1">
                                                                                {Object.entries(skuFieldLabels).filter(([key]) => !imageFields.has(key) && key !== 'businessCode' && sku[key]).map(([key, label]) => (
                                                                                    <div key={key} className="flex items-baseline gap-1.5 text-sm">
                                                                                        <span className="text-slate-400 shrink-0">{label}:</span>
                                                                                        <span className="text-slate-700 truncate" title={formatValue(key, sku[key])}>{formatValue(key, sku[key])}</span>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                        {/* SKU 错误信息 */}
                                                                        {sku.errorMsg && (
                                                                            <div className="mt-2 flex items-start gap-2">
                                                                                <span className="text-xs bg-orange-500 text-white px-2 py-0.5 rounded shrink-0">错误</span>
                                                                                <span className="text-sm text-orange-600 leading-5">{sku.errorMsg}</span>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* 价格错误 */}
                            {entryErrors.priceErrors.length > 0 && (() => {
                                const priceFieldLabels: Record<string, string> = {
                                    externalSkuCode: '产品编码', platformName: '平台名称',
                                    platformPrice: '平台售价', productLink: '商品链接'
                                };
                                return (
                                    <div className="border border-yellow-200 rounded-xl overflow-hidden">
                                        <div className="bg-yellow-50 px-4 py-2.5 border-b border-yellow-200 flex items-center gap-2">
                                            <AlertCircle className="w-4 h-4 text-yellow-500" />
                                            <span className="font-semibold text-yellow-700 text-sm">价格错误 ({entryErrors.priceErrors.length})</span>
                                        </div>
                                        <div className="divide-y divide-yellow-100">
                                            {entryErrors.priceErrors.map((err: any, i) => (
                                                <div key={i} className="p-4 hover:bg-yellow-50/20">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <span className="text-xs bg-yellow-100 text-yellow-600 px-2 py-0.5 rounded font-medium">价格</span>
                                                    </div>
                                                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-2 mb-2 ml-8">
                                                        {Object.entries(priceFieldLabels).map(([key, label]) => {
                                                            const val = err[key];
                                                            if (val === null || val === undefined || val === '') return null;
                                                            return (
                                                                <div key={key} className="flex items-baseline gap-1.5 text-sm">
                                                                    <span className="text-slate-400 shrink-0">{label}:</span>
                                                                    <span className="text-slate-700 truncate" title={String(val)}>
                                                                        {String(val)}
                                                                    </span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    {err.errorMsg && (
                                                        <div className="ml-8 flex items-start gap-1.5">
                                                            <span className="text-xs text-yellow-500 shrink-0">错误:</span>
                                                            <span className="text-sm text-yellow-600 font-medium">{err.errorMsg}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    )}

                    {/* 成功提示 */}
                    {!entryErrors && (
                        <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3">
                            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                            <span className="text-emerald-700 text-sm font-medium">所有数据已成功录入商品库</span>
                        </div>
                    )}

                    {/* 原始返回数据（折叠） */}
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                        <button
                            onClick={() => setShowRawData(!showRawData)}
                            className="w-full px-4 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center justify-between transition-colors"
                        >
                            <span className="text-sm font-medium text-slate-600 flex items-center gap-2">
                                <Database className="w-4 h-4" />
                                原始返回数据
                            </span>
                            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showRawData ? 'rotate-180' : ''}`} />
                        </button>
                        {showRawData && (
                            <div className="product-entry-tables relative border-t border-slate-200">
                                <style>{`
                                    .product-entry-tables table { border-collapse: collapse; width: 100%; margin-bottom: 1rem; font-size: 12px; }
                                    .product-entry-tables th { background: #f8fafc; border: 1px solid #e2e8f0; padding: 6px 10px; text-align: left; font-weight: 600; color: #475569; }
                                    .product-entry-tables td { border: 1px solid #e2e8f0; padding: 5px 10px; color: #64748b; }
                                    .product-entry-tables tr:hover td { background: #f1f5f9; }
                                `}</style>
                                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                                    {confirmResult}
                                </ReactMarkdown>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 图片悬浮预览大图 */}
            {previewImage && (
                <div
                    className="fixed z-[9999] pointer-events-none"
                    style={{ left: previewPos.x, top: previewPos.y }}
                >
                    <div className="bg-white rounded-xl shadow-2xl border border-slate-200 p-2 max-w-[400px] max-h-[400px]">
                        <img
                            src={previewImage}
                            alt="预览"
                            className="max-w-full max-h-[380px] object-contain rounded-lg"
                            onError={(e) => { (e.target as HTMLImageElement).src = ''; (e.target as HTMLImageElement).alt = '图片加载失败'; }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProductEntryModule;
