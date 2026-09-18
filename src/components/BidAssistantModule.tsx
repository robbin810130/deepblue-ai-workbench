import React, { useState, useEffect, useRef, useCallback } from 'react';
import { renderAsync } from 'docx-preview';
import {
    Upload, FileText, ArrowLeft, Trash2, Save, Loader2,
    FolderOpen, Plus, X, Download, RefreshCw, CheckCircle, AlertCircle, PenLine,
    Search, ArrowRightLeft, ChevronDown, ChevronUp, ChevronLeft, ChevronRight
} from 'lucide-react';
import { fetchWithAuth } from '../utils/authFetch';
import { BID_ASSISTANT_API, BID_ASSISTANT_PARSE_ENDPOINT } from '../config';
import { sysAlert } from '../utils/dialog';

// ==========================================
// 类型定义
// ==========================================
interface Chapter {
    id: string;
    title: string;
    level: number;
    order: number;
    contentText: string;
    contentHtml: string;
    originalContentText?: string;
    originalContentHtml?: string;
    edited?: boolean;
}

interface DraftSummary {
    id: number;
    project_name: string;
    file_name: string;
    status: string;
    chapter_count: number;
    created_at: string;
    updated_at: string;
}

interface TemplateSection {
    name: string;
    content: string;
}

interface Template {
    id: number;
    name: string;
    content: string;
    sections: TemplateSection[];
    created_by: string;
    created_at: string;
    updated_at: string;
}

type ViewMode = 'home' | 'editor';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// ==========================================
// 工具函数
// ==========================================

/** 将后端返回的多层级章节树扁平化为编辑用的扁平列表 */
function flattenChapters(nodes: any[], out: Chapter[] = []): Chapter[] {
    for (const n of nodes || []) {
        out.push({
            id: n.id,
            title: n.title || '',
            level: n.level || 1,
            order: n.order ?? out.length,
            contentText: n.contentText || '',
            contentHtml: n.contentHtml || '',
            originalContentText: n.originalContentText ?? n.contentText ?? '',
            originalContentHtml: n.originalContentHtml ?? n.contentHtml ?? '',
            edited: n.edited || false
        });
        if (Array.isArray(n.children) && n.children.length > 0) {
            flattenChapters(n.children, out);
        }
    }
    return out;
}

function formatTime(iso: string): string {
    if (!iso) return '-';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ==========================================
// 主组件
// ==========================================
export const BidAssistantModule: React.FC = () => {
    const [viewMode, setViewMode] = useState<ViewMode>('home');

    // ─── 首页：草稿列表与上传 ───
    const [drafts, setDrafts] = useState<DraftSummary[]>([]);
    const [loadingDrafts, setLoadingDrafts] = useState(false);
    const [parsing, setParsing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);

    // ─── 编辑器状态 ───
    const [draftId, setDraftId] = useState<number | null>(null);
    const [projectName, setProjectName] = useState('');
    const [chapters, setChapters] = useState<Chapter[]>([]);
    const [activeChapterId, setActiveChapterId] = useState<string>('');
    const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const chaptersRef = useRef<Chapter[]>([]);
    const draftIdRef = useRef<number | null>(null);
    const [exporting, setExporting] = useState(false);

    // ─── 查找替换 ───
    const [findText, setFindText] = useState('');
    const [replaceText, setReplaceText] = useState('');
    const [findReplaceLoading, setFindReplaceLoading] = useState(false);
    const [findReplaceResult, setFindReplaceResult] = useState('');
    const [showReplaceInput, setShowReplaceInput] = useState(false);
    const [findError, setFindError] = useState('');
    const [matchCount, setMatchCount] = useState(0);
    const [currentMatchIdx, setCurrentMatchIdx] = useState(0); // 0-based
    const [matchContexts, setMatchContexts] = useState<{index: number; context: string}[]>([]);

    // ─── 编辑器文档预览 ───
    const [editorPreviewLoading, setEditorPreviewLoading] = useState(false);
    const [editorPreviewError, setEditorPreviewError] = useState('');
    const [previewVersion, setPreviewVersion] = useState(0);
    const editorPreviewRef = useRef<HTMLDivElement>(null);
    const editorPreviewBlobRef = useRef<Blob | null>(null);
    const editorPreviewRenderedRef = useRef(false);

    // ─── 模板管理 ───
    const [showTemplateModal, setShowTemplateModal] = useState(false);
    const [templates, setTemplates] = useState<Template[]>([]);
    const [templateEditMode, setTemplateEditMode] = useState<'list' | 'create' | 'edit'>('list');
    const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
    const [tplName, setTplName] = useState('');
    const [tplSections, setTplSections] = useState<TemplateSection[]>([]);
    const [tplSaving, setTplSaving] = useState(false);
    const [applyTemplateLoading, setApplyTemplateLoading] = useState(false);

    // ─── 模板匹配预览 ───
    interface MatchedParagraph {
        index: number;
        position: number;
        text: string;
        parentChapter: string;
        parentChapterId: string | null;
    }
    interface TemplateMatchPreview {
        sectionName: string;
        cleanName: string;
        searchText: string;
        matchedParagraphs: MatchedParagraph[];
    }
    const [showTemplateMatchDialog, setShowTemplateMatchDialog] = useState(false);
    const [templateMatches, setTemplateMatches] = useState<TemplateMatchPreview[]>([]);
    const [selectedMatchPositions, setSelectedMatchPositions] = useState<Record<string, number[]>>({}); // sectionName -> position[]
    const [pendingTemplateId, setPendingTemplateId] = useState<number | null>(null);

    // 同步 ref
    useEffect(() => { chaptersRef.current = chapters; }, [chapters]);
    useEffect(() => { draftIdRef.current = draftId; }, [draftId]);

    // ─── 编辑器文档预览：加载并渲染 docx ───
    const loadEditorPreview = useCallback(async () => {
        if (!draftId) return;
        setEditorPreviewLoading(true);
        setEditorPreviewError('');
        editorPreviewBlobRef.current = null;
        editorPreviewRenderedRef.current = false;
        try {
            let res = await fetchWithAuth(`${BID_ASSISTANT_API}/preview/${draftId}`);
            if (!res.ok) {
                res = await fetchWithAuth(`${BID_ASSISTANT_API}/export/${draftId}`);
            }
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.message || '加载文档失败');
            }
            const blob = await res.blob();
            editorPreviewBlobRef.current = blob;
            setEditorPreviewLoading(false);
            setPreviewVersion(v => v + 1); // 触发重新渲染
        } catch (e: any) {
            setEditorPreviewError(e.message || '文档加载失败');
            setEditorPreviewLoading(false);
        }
    }, [draftId]);

    // 进入编辑器或 draftId 变化时加载预览
    useEffect(() => {
        if (viewMode === 'editor' && draftId) {
            loadEditorPreview();
        }
    }, [viewMode, draftId, loadEditorPreview]);

    // 当 blob 加载完成且容器存在时，渲染 docx
    useEffect(() => {
        if (editorPreviewLoading || editorPreviewError) return;
        const blob = editorPreviewBlobRef.current;
        const container = editorPreviewRef.current;
        if (!blob || !container || editorPreviewRenderedRef.current) return;
        editorPreviewRenderedRef.current = true;
        container.innerHTML = '';
        renderAsync(blob, container, undefined, {
            className: 'docx-preview-body',
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: true,
            breakPages: true,
            ignoreLastRenderedPageBreak: false,
            experimental: true,
        }).then(() => {
        }).catch(e => {
            console.error('[编辑器预览] renderAsync 失败:', e);
            setEditorPreviewError('文档渲染失败: ' + e.message);
        });
    }, [editorPreviewLoading, editorPreviewError, previewVersion]);

    // ─── 预览中文本选中 → 填充查找框 ───
    useEffect(() => {
        const container = editorPreviewRef.current;
        if (!container) return;

        const handleMouseUp = () => {
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed) return;
            const selectedText = selection.toString().trim();
            if (selectedText && selectedText.length > 0 && selectedText.length < 200) {
                setFindText(selectedText);
                setFindError('');
                setFindReplaceResult('');
            }
        };

        container.addEventListener('mouseup', handleMouseUp);
        return () => container.removeEventListener('mouseup', handleMouseUp);
    }, [editorPreviewLoading]);

    // ─── 点击章节 → 滚动预览到对应位置 ───
    const scrollToChapter = useCallback((title: string) => {
        const container = editorPreviewRef.current;
        if (!container) return;
        // 找到可滚动的父容器
        const scrollParent = container.closest('.overflow-auto') as HTMLElement;
        if (!scrollParent) {
            return;
        }
        // 规范化标题：去除数字前缀、空白、特殊字符
        const normalizedTitle = title.replace(/^[\d\s\.\、\（\）\(\)]+/, '').trim();
        const titleKeywords = normalizedTitle.split(/[\s\、，,]+/).filter(k => k.length > 1);
        
        // 在 docx-preview 渲染的 DOM 中查找包含该标题的段落元素
        const allElements = container.querySelectorAll('p, h1, h2, h3, h4, h5, h6, div, span');
        let targetEl: Element | null = null;
        let bestScore = 0;
        
        for (const el of allElements) {
            const text = el.textContent?.trim() || '';
            if (!text) continue;
            
            // 计算匹配分数
            let score = 0;
            
            // 完全匹配
            if (text === title) {
                score = 100;
            }
            // 包含匹配
            else if (text.includes(title) || title.includes(text)) {
                score = 80;
            }
            // 关键词匹配
            else if (titleKeywords.length > 0) {
                const matchedKeywords = titleKeywords.filter(k => text.includes(k));
                score = (matchedKeywords.length / titleKeywords.length) * 60;
            }
            
            if (score > bestScore && score >= 60) {
                bestScore = score;
                targetEl = el;
                if (score === 100) break; // 完美匹配，直接跳出
            }
        }
        
        if (targetEl) {
            // 计算相对于可滚动父容器的偏移量
            const parentRect = scrollParent.getBoundingClientRect();
            const targetRect = targetEl.getBoundingClientRect();
            const scrollTop = scrollParent.scrollTop + (targetRect.top - parentRect.top) - 20;
            scrollParent.scrollTo({ top: scrollTop, behavior: 'smooth' });
            // 高亮闪烁效果
            const htmlEl = targetEl as HTMLElement;
            const origBg = htmlEl.style.backgroundColor;
            htmlEl.style.backgroundColor = '#fef3c7';
            htmlEl.style.transition = 'background-color 0.3s';
            setTimeout(() => {
                htmlEl.style.backgroundColor = origBg;
            }, 1500);
        }
    }, []);

    // ==========================================
    // 草稿列表
    // ==========================================
    const loadDrafts = useCallback(async () => {
        setLoadingDrafts(true);
        try {
            const res = await fetchWithAuth(`${BID_ASSISTANT_API}/drafts`);
            const data = await res.json();
            if (data.code === 0) setDrafts(data.data || []);
        } catch (e) {
            console.error('加载草稿列表失败:', e);
        } finally {
            setLoadingDrafts(false);
        }
    }, []);

    useEffect(() => {
        if (viewMode === 'home') loadDrafts();
    }, [viewMode, loadDrafts]);

    // ==========================================
    // 上传并解析标书文件
    // ==========================================
    const handleFileUpload = async (file: File) => {
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (ext !== 'docx') {
            sysAlert('仅支持 .docx 格式的标书文件');
            return;
        }
        setParsing(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetchWithAuth(BID_ASSISTANT_PARSE_ENDPOINT, { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok || data.code !== 0) {
                throw new Error(data.message || '文件解析失败');
            }
            const flat = flattenChapters(data.data.chapters);
            setDraftId(data.data.draftId);
            setProjectName(data.data.projectName);
            setChapters(flat);
            setActiveChapterId(flat[0]?.id || '');
            setSaveStatus('idle');
            setViewMode('editor');
        } catch (e: any) {
            sysAlert(e.message || '文件解析失败，请重试');
        } finally {
            setParsing(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // ==========================================
    // 打开已有草稿
    // ==========================================
    const openDraft = async (id: number) => {
        try {
            const res = await fetchWithAuth(`${BID_ASSISTANT_API}/drafts/${id}`);
            const data = await res.json();
            if (!res.ok || data.code !== 0) throw new Error(data.message || '加载草稿失败');
            const draft = data.data;
            setDraftId(draft.id);
            setProjectName(draft.project_name);
            setChapters(Array.isArray(draft.chapters) ? draft.chapters : []);
            setActiveChapterId((Array.isArray(draft.chapters) ? draft.chapters[0]?.id : '') || '');
            setSaveStatus('idle');
            setFindText('');
            setReplaceText('');
            setFindReplaceResult('');
            setFindError('');
            setMatchCount(0);
            setCurrentMatchIdx(0);
            setMatchContexts([]);
            setViewMode('editor');
        } catch (e: any) {
            sysAlert(e.message || '加载草稿失败');
        }
    };

    const deleteDraft = async (id: number) => {
        if (!window.confirm('确定删除该草稿？删除后不可恢复。')) return;
        try {
            const res = await fetchWithAuth(`${BID_ASSISTANT_API}/drafts/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.code === 0) loadDrafts();
            else sysAlert(data.message || '删除失败');
        } catch (e) {
            sysAlert('删除失败，请重试');
        }
    };

    // ==========================================
    // 自动保存（防抖）
    // ==========================================
    const doSave = useCallback(async () => {
        const id = draftIdRef.current;
        const chs = chaptersRef.current;
        if (!id) return;
        setSaveStatus('saving');
        try {
            const res = await fetchWithAuth(`${BID_ASSISTANT_API}/drafts/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chapters: chs })
            });
            const data = await res.json();
            setSaveStatus(data.code === 0 ? 'saved' : 'error');
        } catch {
            setSaveStatus('error');
        }
    }, []);

    // 组件卸载时立即保存
    useEffect(() => {
        return () => {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
                doSave();
            }
        };
    }, [doSave]);

    // ==========================================
    // 查找替换操作
    // ==========================================
    const handleFind = async () => {
        if (!findText.trim()) { setFindError('请输入查找内容'); return; }
        if (!draftId) return;
        setFindReplaceLoading(true);
        setFindError('');
        setFindReplaceResult('');
        try {
            const res = await fetchWithAuth(`${BID_ASSISTANT_API}/find-replace`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ draftId, findText: findText.trim() })
            });
            const data = await res.json();
            if (!res.ok || data.code !== 0) throw new Error(data.message || '查找失败');
            const { count, matches } = data.data;
            setMatchCount(count);
            setMatchContexts(matches || []);
            setCurrentMatchIdx(0);
            if (count === 0) {
                setFindReplaceResult('未找到匹配内容');
            } else {
                setFindReplaceResult(`找到 ${count} 处匹配`);
            }
        } catch (e: any) {
            setFindError(e.message || '查找失败');
        } finally {
            setFindReplaceLoading(false);
        }
    };

    const handleReplaceCurrent = async () => {
        if (!findText.trim()) { setFindError('请输入查找内容'); return; }
        if (!draftId) return;
        setFindReplaceLoading(true);
        setFindError('');
        setFindReplaceResult('');
        try {
            const res = await fetchWithAuth(`${BID_ASSISTANT_API}/find-replace`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    draftId,
                    findText: findText.trim(),
                    replaceText: replaceText,
                    replaceIndex: currentMatchIdx
                })
            });
            const data = await res.json();
            if (!res.ok || data.code !== 0) throw new Error(data.message || '替换失败');
            const { count, message } = data.data;
            if (count === 0) {
                setFindReplaceResult('未找到匹配内容');
            } else {
                setFindReplaceResult(message || '已替换');
                loadEditorPreview();
                // 替换后重新查找以更新匹配数（延迟确保服务端写入完成）
                setTimeout(() => { handleFind(); }, 1000);
            }
        } catch (e: any) {
            setFindError(e.message || '替换失败');
        } finally {
            setFindReplaceLoading(false);
        }
    };

    const handleReplaceAll = async () => {
        if (!findText.trim()) { setFindError('请输入查找内容'); return; }
        if (!draftId) return;
        setFindReplaceLoading(true);
        setFindError('');
        setFindReplaceResult('');
        try {
            const res = await fetchWithAuth(`${BID_ASSISTANT_API}/find-replace`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    draftId,
                    findText: findText.trim(),
                    replaceText: replaceText,
                    replaceAll: true
                })
            });
            const data = await res.json();
            if (!res.ok || data.code !== 0) throw new Error(data.message || '替换失败');
            const { count, message } = data.data;
            if (count === 0) {
                setFindReplaceResult('未找到匹配内容');
            } else {
                setFindReplaceResult(message || `已替换 ${count} 处`);
                setMatchCount(0);
                setCurrentMatchIdx(0);
                setMatchContexts([]);
                loadEditorPreview();
            }
        } catch (e: any) {
            setFindError(e.message || '替换失败');
        } finally {
            setFindReplaceLoading(false);
        }
    };

    // ==========================================
    // 生成标书下载
    // ==========================================
    const handleExport = async () => {
        if (!draftId) return;
        setExporting(true);
        try {
            const res = await fetchWithAuth(`${BID_ASSISTANT_API}/export/${draftId}`);
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.message || '生成标书失败');
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${(projectName || '投标文件').replace(/[\\/:*?"<>|]/g, '_')}.docx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e: any) {
            sysAlert(e.message || '生成标书失败，请重试');
        } finally {
            setExporting(false);
        }
    };

    const backToHome = () => {
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        doSave();
        setViewMode('home');
    };

    // ==========================================
    // 模板 CRUD
    // ==========================================
    const loadTemplates = useCallback(async () => {
        try {
            const res = await fetchWithAuth(`${BID_ASSISTANT_API}/templates`);
            const data = await res.json();
            if (data.code === 0) setTemplates(data.data || []);
        } catch (e) {
            console.error('加载模板列表失败:', e);
        }
    }, []);

    const openTemplateModal = () => {
        setShowTemplateModal(true);
        setTemplateEditMode('list');
        loadTemplates();
    };

    const saveTemplate = async () => {
        if (!tplName.trim()) { sysAlert('请输入模板名称'); return; }
        setTplSaving(true);
        try {
            const isEdit = templateEditMode === 'edit' && editingTemplate;
            const res = await fetchWithAuth(
                isEdit ? `${BID_ASSISTANT_API}/templates/${editingTemplate!.id}` : `${BID_ASSISTANT_API}/templates`,
                {
                    method: isEdit ? 'PUT' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: tplName.trim(), sections: tplSections })
                }
            );
            const data = await res.json();
            if (data.code !== 0) throw new Error(data.message || '保存失败');
            setTemplateEditMode('list');
            setTplName(''); setEditingTemplate(null); setTplSections([]);
            loadTemplates();
        } catch (e: any) {
            sysAlert(e.message || '保存模板失败');
        } finally {
            setTplSaving(false);
        }
    };

    const applyTemplate = async (templateId: number) => {
        if (!draftId) return;
        setApplyTemplateLoading(true);
        try {
            // 第一步：预览匹配结果
            const previewRes = await fetchWithAuth(`${BID_ASSISTANT_API}/apply-template-preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ draftId, templateId })
            });
            const previewData = await previewRes.json();
            if (!previewRes.ok || previewData.code !== 0) throw new Error(previewData.message || '预览匹配失败');
            const matches: TemplateMatchPreview[] = previewData.data.matches;
            
            if (matches.length === 0 || matches.every(m => m.matchedParagraphs.length === 0)) {
                sysAlert('未找到匹配的章节，请检查模板段落名称与文档章节标题是否对应');
                setApplyTemplateLoading(false);
                return;
            }
            
            // 检查是否有多个匹配位置（需要用户选择）
            const hasMultiple = matches.some(m => m.matchedParagraphs.length > 1);
            
            if (!hasMultiple) {
                // 每个段落只有一个匹配，直接应用
                const allPositions = matches.flatMap(m => m.matchedParagraphs.map(p => p.position));
                await doApplyTemplate(templateId, allPositions);
            } else {
                // 有多个匹配，显示选择对话框
                setTemplateMatches(matches);
                // 默认选中每个 section 的第一个匹配
                const defaultSelections: Record<string, number[]> = {};
                for (const m of matches) {
                    if (m.matchedParagraphs.length > 0) {
                        defaultSelections[m.sectionName] = [m.matchedParagraphs[0].position];
                    }
                }
                setSelectedMatchPositions(defaultSelections);
                setPendingTemplateId(templateId);
                setShowTemplateMatchDialog(true);
            }
        } catch (e: any) {
            sysAlert(e.message || '应用模板失败');
        } finally {
            setApplyTemplateLoading(false);
        }
    };

    const doApplyTemplate = async (templateId: number, selectedPositions: number[] | null) => {
        if (!draftId) return;
        setApplyTemplateLoading(true);
        try {
            const body: any = { draftId, templateId };
            if (selectedPositions) body.selectedPositions = selectedPositions;
            const res = await fetchWithAuth(`${BID_ASSISTANT_API}/apply-template`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!res.ok || data.code !== 0) throw new Error(data.message || '应用模板失败');
            const { applied, message } = data.data;
            if (applied.length === 0) {
                sysAlert('未找到匹配的章节，请检查模板段落名称与文档章节标题是否对应');
            } else {
                sysAlert(`${message}\n\n已追加: ${applied.map((a: any) => a.chapterTitle).join('、')}`);
                const draftRes = await fetchWithAuth(`${BID_ASSISTANT_API}/drafts/${draftId}`);
                const draftData = await draftRes.json();
                if (draftRes.ok && draftData.code === 0) {
                    const draft = draftData.data;
                    setChapters(Array.isArray(draft.chapters) ? draft.chapters : []);
                }
                loadEditorPreview();
            }
        } catch (e: any) {
            sysAlert(e.message || '应用模板失败');
        } finally {
            setApplyTemplateLoading(false);
            setShowTemplateMatchDialog(false);
        }
    };

    const deleteTemplate = async (id: number) => {
        if (!window.confirm('确定删除该模板？')) return;
        try {
            const res = await fetchWithAuth(`${BID_ASSISTANT_API}/templates/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.code === 0) loadTemplates();
            else sysAlert(data.message || '删除失败');
        } catch {
            sysAlert('删除失败，请重试');
        }
    };

    // ==========================================
    // 渲染：保存状态指示
    // ==========================================
    const renderSaveStatus = () => {
        switch (saveStatus) {
            case 'saving':
                return <span className="flex items-center gap-1 text-[11px] text-slate-400"><Loader2 className="w-3 h-3 animate-spin" />保存中...</span>;
            case 'saved':
                return <span className="flex items-center gap-1 text-[11px] text-emerald-600"><CheckCircle className="w-3 h-3" />已自动保存</span>;
            case 'error':
                return <span className="flex items-center gap-1 text-[11px] text-red-500"><AlertCircle className="w-3 h-3" />保存失败</span>;
            default:
                return <span className="text-[11px] text-slate-300">待保存</span>;
        }
    };

    // ==========================================
    // 渲染：首页（草稿列表 + 上传）
    // ==========================================
    if (viewMode === 'home') {
        return (
            <div className="h-full flex flex-col bg-slate-50 relative">
                {/* 顶部标题 */}
                <div className="px-3 py-2 border-b border-slate-200 bg-white flex-shrink-0">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center">
                                <FileText className="w-4.5 h-4.5 text-white" />
                            </div>
                            <div>
                                <h2 className="text-sm font-bold text-slate-800">投标</h2>
                                <p className="text-[11px] text-slate-400">上传标书 → 查找替换 → 一键生成投标文件</p>
                            </div>
                        </div>
                        <button
                            onClick={openTemplateModal}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                        >
                            <FolderOpen className="w-3.5 h-3.5" /> 固定内容模板
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                    {/* 上传区域 */}
                    <div
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={(e) => {
                            e.preventDefault();
                            setDragOver(false);
                            const file = e.dataTransfer.files?.[0];
                            if (file) handleFileUpload(file);
                        }}
                        onClick={() => !parsing && fileInputRef.current?.click()}
                        className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-all
                            ${dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300 bg-white hover:border-indigo-300 hover:bg-indigo-50/40'}`}
                    >
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".docx"
                            className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }}
                        />
                        {parsing ? (
                            <div className="flex flex-col items-center gap-2">
                                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                                <p className="text-sm font-medium text-slate-700">正在解析标书文件，请稍候...</p>
                                <p className="text-[11px] text-slate-400">系统正在自动识别章节结构</p>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-2">
                                <Upload className="w-8 h-8 text-indigo-400" />
                                <p className="text-sm font-medium text-slate-700">点击或拖拽上传标书文件</p>
                                <p className="text-[11px] text-slate-400">支持 .docx 格式，上传后自动解析章节内容</p>
                            </div>
                        )}
                    </div>

                    {/* 草稿列表 */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-xs font-bold text-slate-600">我的草稿</h3>
                            <button onClick={loadDrafts} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-indigo-500 transition-colors">
                                <RefreshCw className="w-3 h-3" /> 刷新
                            </button>
                        </div>
                        {loadingDrafts ? (
                            <div className="flex items-center justify-center py-8 text-slate-400">
                                <Loader2 className="w-5 h-5 animate-spin" />
                            </div>
                        ) : drafts.length === 0 ? (
                            <div className="bg-white rounded-lg border border-slate-200 py-8 text-center text-xs text-slate-400">
                                暂无草稿，上传标书文件开始编制
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {drafts.map(d => (
                                    <div key={d.id} className="bg-white rounded-lg border border-slate-200 shadow-sm px-3 py-2.5 flex items-center justify-between hover:border-indigo-200 transition-colors">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                                                <FileText className="w-4.5 h-4.5 text-indigo-500" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-slate-800 truncate">{d.project_name || '未命名项目'}</p>
                                                <p className="text-[11px] text-slate-400 mt-0.5">
                                                    {d.chapter_count} 个章节 · 更新于 {formatTime(d.updated_at)}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <button
                                                onClick={() => openDraft(d.id)}
                                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg transition-colors"
                                            >
                                                <PenLine className="w-3 h-3" /> 继续编辑
                                            </button>
                                            <button
                                                onClick={() => deleteDraft(d.id)}
                                                className="p-1.5 text-slate-300 hover:text-red-500 transition-colors"
                                                title="删除草稿"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* 模板管理弹窗 */}
                {showTemplateModal && renderTemplateModal()}
            </div>
        );
    }

    // ==========================================
    // 渲染：模板管理弹窗
    // ==========================================
    function renderTemplateModal() {
        return (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-50">
                <div className="bg-white rounded-xl shadow-xl w-[800px] max-w-[95%] max-h-[92%] flex flex-col overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
                        <h3 className="text-sm font-bold text-slate-800">固定内容模板管理</h3>
                        <button onClick={() => setShowTemplateModal(false)} className="text-slate-400 hover:text-slate-600">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4">
                        {templateEditMode === 'list' ? (
                            <>
                                <div className="flex items-center gap-2 mb-3">
                                    <button
                                        onClick={() => { setTemplateEditMode('create'); setTplName(''); setTplSections([]); }}
                                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg transition-colors"
                                    >
                                        <Plus className="w-3.5 h-3.5" /> 新建文本模板
                                    </button>
                                </div>
                                {templates.length === 0 ? (
                                    <div className="py-8 text-center text-xs text-slate-400">
                                        暂无模板，点击“新建文本模板”开始创建
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {templates.map(t => (
                                            <div key={t.id} className="border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between hover:border-indigo-200 transition-colors">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <p className="text-xs font-semibold text-slate-800 truncate">{t.name}</p>
                                                    </div>
                                                    <p className="text-[10px] text-slate-400 mt-0.5">更新于 {formatTime(t.updated_at)}</p>
                                                </div>
                                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                                    {viewMode === 'editor' && (
                                                        <button
                                                            onClick={() => applyTemplate(t.id)}
                                                            disabled={applyTemplateLoading}
                                                            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded transition-colors disabled:opacity-50"
                                                            title="将模板内容追加到匹配的章节"
                                                        >
                                                            {applyTemplateLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                                                            应用
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => { setTemplateEditMode('edit'); setEditingTemplate(t); setTplName(t.name); setTplSections(Array.isArray(t.sections) ? t.sections : []); }}
                                                        className="p-1.5 text-slate-400 hover:text-indigo-500 transition-colors" title="编辑"
                                                    >
                                                        <PenLine className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        onClick={() => deleteTemplate(t.id)}
                                                        className="p-1.5 text-slate-300 hover:text-red-500 transition-colors" title="删除"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="space-y-2.5">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1">模板名称</label>
                                    <input
                                        value={tplName}
                                        onChange={(e) => setTplName(e.target.value)}
                                        placeholder="如：公司简介、资质说明、通用条款"
                                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                    />
                                </div>
                                {/* 模板段落列表 */}
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="text-xs font-semibold text-slate-600">模板段落（按章节名匹配）</label>
                                        <button
                                            onClick={() => setTplSections([...tplSections, { name: '', content: '' }])}
                                            className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                                        >
                                            <Plus className="w-3 h-3" /> 添加段落
                                        </button>
                                    </div>
                                    {tplSections.length === 0 ? (
                                        <div className="py-4 text-center text-[11px] text-slate-400 border border-dashed border-slate-200 rounded-lg">
                                            点击“添加段落”添加模板段落，每个段落名称将用于匹配文档章节标题
                                        </div>
                                    ) : (
                                        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                                            {tplSections.map((sec, idx) => (
                                                <div key={idx} className="border border-slate-200 rounded-lg p-3 space-y-2">
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            value={sec.name}
                                                            onChange={(e) => {
                                                                const newSecs = [...tplSections];
                                                                newSecs[idx] = { ...newSecs[idx], name: e.target.value };
                                                                setTplSections(newSecs);
                                                            }}
                                                            placeholder="段落名称（用于匹配章节标题，如：营业执照、财务会计制度）"
                                                            className="flex-1 min-w-0 px-2.5 py-1.5 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-300"
                                                        />
                                                        <button
                                                            onClick={() => setTplSections(tplSections.filter((_, i) => i !== idx))}
                                                            className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                                                        >
                                                            <X className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                    <textarea
                                                        value={sec.content}
                                                        onChange={(e) => {
                                                            const newSecs = [...tplSections];
                                                            newSecs[idx] = { ...newSecs[idx], content: e.target.value };
                                                            setTplSections(newSecs);
                                                        }}
                                                        onInput={(e) => {
                                                            const t = e.target as HTMLTextAreaElement;
                                                            t.style.height = 'auto';
                                                            t.style.height = t.scrollHeight + 'px';
                                                        }}
                                                        placeholder="段落内容（将追加到匹配章节下方）"
                                                        rows={6}
                                                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-300 resize-none overflow-hidden"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center justify-end gap-2">
                                    <button
                                        onClick={() => { setTemplateEditMode('list'); setEditingTemplate(null); setTplName(''); setTplSections([]); }}
                                        className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
                                    >
                                        取消
                                    </button>
                                    <button
                                        onClick={saveTemplate}
                                        disabled={tplSaving}
                                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg transition-colors disabled:opacity-50"
                                    >
                                        {tplSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} 保存
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // ==========================================
    // 渲染：编辑器（查找替换面板 + 文档预览）
    // ==========================================
    return (
        <div className="h-full flex flex-col bg-slate-50 relative">
            {/* 顶部栏 */}
            <div className="px-3 py-2 border-b border-slate-200 bg-white flex-shrink-0">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                        <button onClick={backToHome} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 transition-colors flex-shrink-0">
                            <ArrowLeft className="w-3.5 h-3.5" /> 返回
                        </button>
                        <div className="h-4 w-px bg-slate-200 flex-shrink-0" />
                        <h2 className="text-sm font-bold text-slate-800 truncate">{projectName || '未命名项目'}</h2>
                        {renderSaveStatus()}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                            onClick={openTemplateModal}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                        >
                            <FolderOpen className="w-3.5 h-3.5" /> 模板管理
                        </button>
                        <button
                            onClick={handleExport}
                            disabled={exporting || chapters.length === 0}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg transition-colors disabled:opacity-50"
                        >
                            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                            {exporting ? '生成中...' : '生成标书'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* 左侧：章节目录树 */}
                <div className="w-64 border-r border-slate-200 bg-white flex flex-col flex-shrink-0">
                    <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
                        <span className="text-xs font-bold text-slate-600">章节目录</span>
                        <span className="text-[10px] text-slate-400">{chapters.length} 个章节</span>
                    </div>
                    <div className="flex-1 overflow-y-auto py-1">
                        {chapters.map(c => {
                            const isActive = activeChapterId === c.id;
                            const levelColors: Record<number, string> = { 1: 'bg-indigo-500', 2: 'bg-blue-400', 3: 'bg-emerald-400', 4: 'bg-amber-400' };
                            const dotColor = levelColors[Math.min(c.level || 1, 4)];
                            return (
                                <button
                                    key={c.id}
                                    onClick={() => {
                                        setActiveChapterId(c.id);
                                        scrollToChapter(c.title);
                                    }}
                                    className={`w-full text-left px-3 py-1.5 transition-colors border-l-2 ${
                                        isActive
                                            ? 'bg-indigo-50/80 border-indigo-500'
                                            : 'border-transparent hover:bg-slate-50'
                                    }`}
                                    style={{ paddingLeft: `${8 + (Math.min(c.level || 1, 4) - 1) * 16}px` }}
                                >
                                    <div className="flex items-center gap-1.5">
                                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
                                        <span className={`text-xs truncate flex-1 ${isActive ? 'text-indigo-700 font-semibold' : 'text-slate-700'}`}>
                                            {c.title}
                                        </span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* 右侧：查找替换 + 文档预览 */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* 查找替换工具栏 */}
                    <div className="border-b border-slate-200 bg-white flex-shrink-0">
                        <div className="px-3 py-2 flex items-center gap-2">
                            <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
                            <div className="flex-1 flex items-center gap-2 min-w-0">
                                <input
                                    type="text"
                                    value={findText}
                                    onChange={(e) => { setFindText(e.target.value); setFindError(''); setFindReplaceResult(''); setMatchCount(0); setCurrentMatchIdx(0); }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleFind();
                                        }
                                    }}
                                    placeholder="查找内容...（选中预览文本自动填充）"
                                    className="flex-1 min-w-0 px-2.5 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300"
                                />
                                <button
                                    onClick={handleFind}
                                    disabled={findReplaceLoading || !findText.trim()}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors disabled:opacity-50 flex-shrink-0"
                                >
                                    {findReplaceLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                                    查找
                                </button>
                                {/* 匹配计数和导航 */}
                                {matchCount > 0 && (
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                        <button
                                            onClick={() => setCurrentMatchIdx(Math.max(0, currentMatchIdx - 1))}
                                            disabled={currentMatchIdx <= 0}
                                            className="p-1 text-slate-500 hover:text-indigo-600 disabled:opacity-30 transition-colors"
                                        >
                                            <ChevronLeft className="w-3.5 h-3.5" />
                                        </button>
                                        <span className="text-[11px] text-slate-600 font-medium min-w-[36px] text-center">
                                            {currentMatchIdx + 1}/{matchCount}
                                        </span>
                                        <button
                                            onClick={() => setCurrentMatchIdx(Math.min(matchCount - 1, currentMatchIdx + 1))}
                                            disabled={currentMatchIdx >= matchCount - 1}
                                            className="p-1 text-slate-500 hover:text-indigo-600 disabled:opacity-30 transition-colors"
                                        >
                                            <ChevronRight className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                )}
                                <button
                                    onClick={() => { setShowReplaceInput(!showReplaceInput); }}
                                    className={`flex items-center gap-1 px-2 py-1.5 text-xs rounded-md transition-colors flex-shrink-0 ${
                                        showReplaceInput ? 'text-indigo-600 bg-indigo-50' : 'text-slate-500 hover:bg-slate-100'
                                    }`}
                                >
                                    替换 {showReplaceInput ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                </button>
                            </div>
                        </div>
                        {/* 替换输入行 */}
                        {showReplaceInput && (
                            <div className="px-3 pb-2 flex items-center gap-2">
                                <ArrowRightLeft className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                <input
                                    type="text"
                                    value={replaceText}
                                    onChange={(e) => setReplaceText(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            handleReplaceAll();
                                        }
                                    }}
                                    placeholder="替换为..."
                                    className="flex-1 min-w-0 px-2.5 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300"
                                />
                                <button
                                    onClick={handleReplaceCurrent}
                                    disabled={findReplaceLoading || !findText.trim() || matchCount === 0}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors disabled:opacity-50 flex-shrink-0"
                                >
                                    {findReplaceLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRightLeft className="w-3 h-3" />}
                                    替换当前
                                </button>
                                <button
                                    onClick={handleReplaceAll}
                                    disabled={findReplaceLoading || !findText.trim()}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-500 hover:bg-indigo-600 rounded-md transition-colors disabled:opacity-50 flex-shrink-0"
                                >
                                    {findReplaceLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRightLeft className="w-3 h-3" />}
                                    全部替换
                                </button>
                            </div>
                        )}
                        {/* 查找匹配上下文预览 */}
                        {matchCount > 0 && matchContexts.length > 0 && (
                            <div className="px-3 pb-2">
                                <div className="max-h-20 overflow-y-auto space-y-0.5">
                                    {matchContexts.slice(Math.max(0, currentMatchIdx - 2), currentMatchIdx + 3).map((m) => (
                                        <div
                                            key={m.index}
                                            className={`text-[11px] px-2 py-0.5 rounded cursor-pointer transition-colors ${
                                                m.index - 1 === currentMatchIdx
                                                    ? 'bg-indigo-50 text-indigo-700 font-medium'
                                                    : 'text-slate-500 hover:bg-slate-50'
                                            }`}
                                            onClick={() => setCurrentMatchIdx(m.index - 1)}
                                        >
                                            <span className="text-slate-400 mr-1">#{m.index}</span>
                                            ...{m.context}...
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {/* 查找替换结果/错误提示 */}
                        {(findReplaceResult || findError) && (
                            <div className={`px-3 pb-2 flex items-center gap-1.5 text-[11px] ${findError ? 'text-red-500' : 'text-emerald-600'}`}>
                                {findError ? <AlertCircle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                                {findError || findReplaceResult}
                            </div>
                        )}
                    </div>

                    {/* 文档预览区域 */}
                    <div className="flex-1 overflow-auto bg-slate-100 p-4 flex justify-center">
                        {editorPreviewLoading ? (
                            <div className="flex flex-col items-center gap-3 py-20">
                                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                                <p className="text-sm text-slate-500">正在加载文档...</p>
                            </div>
                        ) : editorPreviewError ? (
                            <div className="flex flex-col items-center gap-3 py-20">
                                <AlertCircle className="w-8 h-8 text-red-400" />
                                <p className="text-sm text-red-500">{editorPreviewError}</p>
                                <button
                                    onClick={loadEditorPreview}
                                    className="px-4 py-1.5 text-xs text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg"
                                >
                                    重试
                                </button>
                            </div>
                        ) : (
                            <div
                                ref={editorPreviewRef}
                                className="bg-white shadow-lg w-full"
                                style={{ minHeight: 500 }}
                            />
                        )}
                    </div>
                </div>
            </div>

            {/* 模板管理弹窗（编辑器内也可打开） */}
            {showTemplateModal && renderTemplateModal()}

            {/* 模板匹配选择对话框 */}
            {showTemplateMatchDialog && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
                    <div className="bg-white rounded-xl shadow-2xl w-[750px] max-w-[95%] max-h-[85%] flex flex-col">
                        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                            <h3 className="text-base font-bold text-slate-800">选择要追加的目标位置</h3>
                            <button onClick={() => setShowTemplateMatchDialog(false)} className="text-slate-400 hover:text-slate-600 text-lg">&times;</button>
                        </div>
                        <div className="px-5 py-3 overflow-auto flex-1 space-y-4">
                            <p className="text-xs text-slate-500">检测到文档中有多处匹配，请选择要追加内容的目标位置：</p>
                            {templateMatches.map((match) => (
                                <div key={match.sectionName} className="border border-slate-200 rounded-lg p-3">
                                    <div className="text-sm font-semibold text-slate-700 mb-2">
                                        模板段落：{match.sectionName}
                                        <span className="text-xs text-slate-400 ml-2">（找到 {match.matchedParagraphs.length} 处）</span>
                                    </div>
                                    {match.matchedParagraphs.length > 0 ? (
                                        <div className="space-y-1.5 max-h-[30vh] overflow-auto">
                                            {match.matchedParagraphs.map((para) => {
                                                const isSelected = (selectedMatchPositions[match.sectionName] || []).includes(para.position);
                                                return (
                                                    <label
                                                        key={para.position}
                                                        className={`flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                                                            isSelected ? 'bg-indigo-50 border border-indigo-200' : 'bg-slate-50 border border-transparent hover:bg-slate-100'
                                                        }`}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={() => {
                                                                setSelectedMatchPositions(prev => {
                                                                    const current = prev[match.sectionName] || [];
                                                                    const next = isSelected
                                                                        ? current.filter(p => p !== para.position)
                                                                        : [...current, para.position];
                                                                    return { ...prev, [match.sectionName]: next };
                                                                });
                                                            }}
                                                            className="mt-0.5"
                                                        />
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-xs text-indigo-500 font-medium mb-0.5">📍 {para.parentChapter}</div>
                                                            <div className="text-sm text-slate-700 truncate" title={para.text}>
                                                                {para.text || '(空段落)'}
                                                            </div>
                                                        </div>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="text-xs text-red-400">未找到匹配的位置</div>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
                            <button
                                onClick={() => setShowTemplateMatchDialog(false)}
                                className="px-4 py-1.5 text-sm rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
                            >
                                取消
                            </button>
                            <button
                                onClick={() => {
                                    if (!pendingTemplateId) return;
                                    const allPositions = Object.values(selectedMatchPositions).flat();
                                    if (allPositions.length === 0) {
                                        sysAlert('请至少选择一个目标位置');
                                        return;
                                    }
                                    doApplyTemplate(pendingTemplateId, allPositions);
                                }}
                                disabled={applyTemplateLoading}
                                className="px-4 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                            >
                                {applyTemplateLoading ? '应用中...' : '确认应用'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BidAssistantModule;
