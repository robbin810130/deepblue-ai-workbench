import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
    Send, Bot, User, Plus, Trash2, MessageSquare, Square,
    Paperclip, X, Loader2, Pen, Check, Upload, ChevronDown, Clock,
    Sparkles, Wand2, History, ChevronRight, ChevronLeft, Copy, CheckCheck,
    ChevronsDownUp, ChevronsUpDown, Dice5
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { fetchWithAuth } from '../utils/authFetch';
import {
    AI_PRODUCT_SELECTION_CHAT_ENDPOINT,
    AI_PRODUCT_SELECTION_UPLOAD_ENDPOINT
} from '../config';

// ─── 类型定义 ──────────────────────────────────────────────────
interface FileAttachment {
    upload_file_id: string;
    filename: string;
    mimetype: string;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    files?: FileAttachment[];
    created_at: string;
    status?: 'sending' | 'streaming' | 'success' | 'error';
    stopped?: boolean;
}

interface Conversation {
    id: number;
    title: string;
    created_at: string;
    updated_at: string;
}

// ─── 思考内容折叠组件 ──────────────────────────────────────────
const ThinkingBlock: React.FC<{ content: string; elapsedMs?: number }> = ({ content, elapsedMs }) => {
    const [expanded, setExpanded] = useState(false);
    const formatElapsed = (ms: number) => {
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    };
    return (
        <div className="mb-3 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(148,163,184,0.25)', background: 'linear-gradient(135deg, rgba(248,250,252,0.9) 0%, rgba(241,245,249,0.8) 100%)' }}>
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-xs transition-colors hover:bg-slate-100/60"
                style={{ color: '#64748b' }}
            >
                <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center w-5 h-5 rounded-md" style={{ background: 'rgba(99,102,241,0.1)' }}>
                        <ChevronDown className={`w-3 h-3 transition-transform duration-200 text-indigo-500 ${expanded ? 'rotate-180' : ''}`} />
                    </div>
                    <span className="font-medium text-slate-600">{expanded ? '收起思考过程' : '展开思考过程'}</span>
                </div>
                {elapsedMs != null && elapsedMs > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(99,102,241,0.08)', color: '#818cf8' }}>
                        <Clock className="w-3 h-3" />
                        {formatElapsed(elapsedMs)}
                    </span>
                )}
            </button>
            {expanded && (
                <div className="overflow-y-auto border-t" style={{ maxHeight: '300px', borderColor: 'rgba(148,163,184,0.15)' }}>
                    <div className="px-5 py-4" style={{ fontSize: '13px', lineHeight: '1.85', letterSpacing: '0.02em', color: '#64748b', wordSpacing: '0.05em' }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                            {content}
                        </ReactMarkdown>
                    </div>
                </div>
            )}
        </div>
    );
};

// ─── 解析 AI 回复，提取思考内容（支持流式未完成标签） ──────────────
function parseAIContent(content: string): { type: 'thinking' | 'content'; text: string }[] {
    const parts: { type: 'thinking' | 'content'; text: string }[] = [];
    // 匹配已闭合的  标签
    const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
    let lastIndex = 0;
    let match;

    while ((match = thinkRegex.exec(content)) !== null) {
        if (match.index > lastIndex) {
            const before = content.slice(lastIndex, match.index).trim();
            if (before) parts.push({ type: 'content', text: before });
        }
        const thinking = match[1].trim();
        if (thinking) parts.push({ type: 'thinking', text: thinking });
        lastIndex = match.index + match[0].length;
    }

    // 处理流式中未闭合的  标签
    const remaining = content.slice(lastIndex);
    const unclosedMatch = remaining.match(/<think>([\s\S]*)$/);
    if (unclosedMatch) {
        const beforeThink = remaining.slice(0, unclosedMatch.index).trim();
        if (beforeThink) parts.push({ type: 'content', text: beforeThink });
        const thinkingContent = unclosedMatch[1].trim();
        if (thinkingContent) parts.push({ type: 'thinking', text: thinkingContent });
    } else {
        const trimmed = remaining.trim();
        if (trimmed || parts.length === 0) {
            parts.push({ type: 'content', text: trimmed });
        }
    }

    return parts;
}

// ─── 代码块组件（带语言标签 + 复制按钮 + 折叠展开） ────────────────
const CodeBlock: React.FC<{ className?: string; children?: React.ReactNode }> = ({ className, children }) => {
    const [copied, setCopied] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const lang = className?.replace(/^language-/, '') || '';
    const codeText = String(children).replace(/\n$/, '');
    const COLLAPSE_HEIGHT = 280;

    // 用行数判断是否需要折叠（避免 DOM 测量导致闪烁）
    const lineCount = codeText.split('\n').length;
    const needsCollapse = lineCount > 14;
    const isCollapsed = needsCollapse && !expanded;

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(codeText).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }, [codeText]);

    return (
        <div className="not-prose my-4 rounded-xl" style={{ border: '1px solid rgba(30,30,50,0.25)', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
            {/* 顶栏 */}
            <div className="flex items-center justify-between px-4 py-2 relative" style={{ zIndex: 10, background: 'linear-gradient(135deg, #2d2d3f 0%, #1e1e2e 100%)' }}>
                <div className="flex items-center gap-2">
                    <div className="flex gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#ff5f57' }} />
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#febc2e' }} />
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#28c840' }} />
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono ml-1">{lang || 'code'}</span>
                </div>
                <div className="flex items-center gap-1">
                    {needsCollapse && (
                        <button
                            type="button"
                            onClick={() => setExpanded(v => !v)}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] hover:bg-white/10 transition-colors cursor-pointer"
                            style={{ color: '#94a3b8' }}
                        >
                            {expanded ? <ChevronsDownUp className="w-3 h-3" /> : <ChevronsUpDown className="w-3 h-3" />}
                            {expanded ? '折叠' : '展开'}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleCopy}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] hover:bg-white/10 transition-colors cursor-pointer"
                        style={{ color: copied ? '#34d399' : '#94a3b8' }}
                    >
                        {copied ? <CheckCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copied ? '已复制' : '复制'}
                    </button>
                </div>
            </div>
            {/* 代码内容 */}
            <div style={{ background: '#1e1e2e', overflow: 'hidden' }}>
                <div
                    style={isCollapsed ? { maxHeight: `${COLLAPSE_HEIGHT}px`, overflow: 'hidden', position: 'relative' } : { position: 'relative' }}
                >
                    <pre
                        style={{
                            margin: 0,
                            padding: '16px',
                            background: 'transparent',
                            overflowX: 'auto',
                        }}
                    >
                        <code
                            style={{
                                display: 'block',
                                fontSize: '13px',
                                lineHeight: '1.75',
                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                whiteSpace: 'pre',
                                color: '#cdd6f4',
                                background: 'transparent',
                            }}
                        >
                            {children}
                        </code>
                    </pre>
                    {/* 折叠时的渐变遮罩 + 展开按钮 */}
                    {isCollapsed && (
                        <div
                            className="flex items-end justify-center pb-3 pt-10 cursor-pointer"
                            style={{
                                position: 'absolute',
                                bottom: 0,
                                left: 0,
                                right: 0,
                                background: 'linear-gradient(to bottom, transparent 0%, rgba(30,30,46,0.95) 70%)',
                                zIndex: 5,
                            }}
                            onClick={() => setExpanded(true)}
                        >
                            <div className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12px] font-medium" style={{ background: 'rgba(255,255,255,0.1)', color: '#cdd6f4' }}>
                                <ChevronsUpDown className="w-3.5 h-3.5" />
                                展开全部
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ─── 拆分文本与代码块，使代码块渲染在 prose 容器外 ──────────────
function splitByCodeBlocks(text: string): { type: 'text' | 'code'; content: string; lang?: string }[] {
    const result: { type: 'text' | 'code'; content: string; lang?: string }[] = [];
    const regex = /```(\w*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            result.push({ type: 'text', content: text.slice(lastIndex, match.index) });
        }
        result.push({ type: 'code', content: match[2].replace(/\n$/, ''), lang: match[1] || undefined });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
        result.push({ type: 'text', content: text.slice(lastIndex) });
    }
    if (result.length === 0) {
        result.push({ type: 'text', content: text });
    }
    return result;
}

// ─── AI 消息渲染组件 ──────────────────────────────────────────
const AIMessageContent: React.FC<{ content: string; isStreaming: boolean; msgCreatedAt?: string }> = ({ content, isStreaming, msgCreatedAt }) => {
    const { parts, thinkElapsedMs } = useMemo(() => {
        const parsed = parseAIContent(content);
        let elapsed: number | undefined;
        if (msgCreatedAt) {
            const firstContentIdx = parsed.findIndex(p => p.type === 'content');
            if (firstContentIdx > 0) {
                const start = new Date(msgCreatedAt).getTime();
                elapsed = Date.now() - start;
            } else if (parsed.length === 1 && parsed[0].type === 'thinking') {
                const start = new Date(msgCreatedAt).getTime();
                elapsed = Date.now() - start;
            }
        }
        return { parts: parsed, thinkElapsedMs: elapsed };
    }, [content, msgCreatedAt]);

    const proseClass = "prose prose-sm max-w-none prose-leading-relaxed prose-p:my-3 prose-li:my-1.5 prose-headings:text-slate-800 prose-headings:font-semibold prose-headings:mt-5 prose-headings:mb-2 prose-p:text-slate-700 prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline prose-strong:text-slate-800 prose-code:text-indigo-600 prose-code:bg-indigo-50/60 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-[13px] prose-code:font-medium prose-code:before:content-none prose-code:after:content-none prose-ul:my-2 prose-ol:my-2 prose-blockquote:my-4 prose-blockquote:border-indigo-400 prose-blockquote:bg-indigo-50/30 prose-blockquote:rounded-r-lg prose-blockquote:py-1 prose-blockquote:text-slate-600 prose-blockquote:italic prose-hr:my-5 prose-hr:border-slate-200 prose-table:my-3 prose-img:rounded-xl prose-img:my-3";

    return (
        <div>
            {parts.map((part, idx) => {
                if (part.type === 'thinking') {
                    return <ThinkingBlock key={idx} content={part.text} elapsedMs={thinkElapsedMs} />;
                }
                // 拆分文本与代码块
                const segments = splitByCodeBlocks(part.text);
                return (
                    <React.Fragment key={idx}>
                        {segments.map((seg, si) => {
                            if (seg.type === 'code') {
                                return <CodeBlock key={`code-${si}`} className={seg.lang ? `language-${seg.lang}` : undefined}>{seg.content}</CodeBlock>;
                            }
                            return (
                                <div key={`text-${si}`} className={proseClass} style={{ letterSpacing: '0.01em', wordSpacing: '0.03em' }}>
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                                        {seg.content}
                                    </ReactMarkdown>
                                </div>
                            );
                        })}
                    </React.Fragment>
                );
            })}
            {isStreaming && (
                <span className="inline-block w-1.5 h-4 bg-blue-500 animate-pulse ml-0.5 align-text-bottom" />
            )}
        </div>
    );
};

// ─── 快捷向导示例数据 ──────────────────────────────────────
const WIZARD_EXAMPLES = [
    { project: '2026东南亚美妆选品', quantity: '15-20个SKU', category: '护肤品', target: '东南亚18-35岁女性', price: '30-120元', brand: '国货新锐品牌平替', channel: 'Shopee、Lazada直播', extra: '偏好美白、防晒功效，需有清真认证潜力' },
    { project: '2026母婴爆品筛选', quantity: '10个SKU', category: '母婴用品', target: '国内25-35岁宝妈', price: '50-300元', brand: '国际大牌+国货精品', channel: '抖音母婴直播间、天猫旗舰店', extra: '关注成分安全、无添加，需有检测报告' },
    { project: '2026保健品新品规划', quantity: '8-12个SKU', category: '保健品', target: '国内中老年人群', price: '100-500元', brand: '澳洲/日本进口品牌', channel: '京东健康、线下药店', extra: '需有蓝帽子认证或跨境备案，偏好胶原蛋白、氨糖类' },
    { project: '浦发银行积分商城选品', quantity: '20-30个SKU', category: '小家电/个护', target: '银行信用卡持卡人', price: '100-800元', brand: '知名品牌、高性价比', channel: '银行积分兑换商城', extra: '需支持定制包装，兑换率预估需达30%以上' },
];

// ─── 组件 ──────────────────────────────────────────────────
export const ProductSelectionStrategyModule: React.FC = () => {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [currentConvId, setCurrentConvId] = useState<number | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputText, setInputText] = useState('');
    const [pendingFiles, setPendingFiles] = useState<FileAttachment[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState('');
    const [uploadingFiles, setUploadingFiles] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [wizardCollapsed, setWizardCollapsed] = useState(false);
    const [historyCollapsed, setHistoryCollapsed] = useState(false);

    // ─── 快捷向导状态 ──────────────────────────────────────
    const [wz_project, setWzProject] = useState('');
    const [wz_quantity, setWzQuantity] = useState('');
    const [wz_category, setWzCategory] = useState('');
    const [wz_target, setWzTarget] = useState('');
    const [wz_price, setWzPrice] = useState('');
    const [wz_brand, setWzBrand] = useState('');
    const [wz_channel, setWzChannel] = useState('');
    const [wz_extra, setWzExtra] = useState('');

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const taskIdRef = useRef<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ─── 自动滚动 ──────────────────────────────────────────
    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

    // ─── 加载会话列表 ──────────────────────────────────────
    const loadConversations = useCallback(async () => {
        try {
            const res = await fetchWithAuth('/api/product-selection/conversations');
            const data = await res.json();
            if (data.success) setConversations(data.data);
        } catch (e) { console.error('加载会话列表失败', e); }
    }, []);

    useEffect(() => { loadConversations(); }, [loadConversations]);

    // ─── 加载历史消息 ──────────────────────────────────────
    const loadMessages = useCallback(async (convId: number) => {
        setIsLoadingHistory(true);
        try {
            const res = await fetchWithAuth(`/api/product-selection/conversations/${convId}/messages`);
            const data = await res.json();
            if (data.success) {
                setMessages(data.data.map((m: any) => ({
                    ...m,
                    id: String(m.id),
                    status: 'success' as const,
                    files: m.files || undefined,
                    stopped: m.stopped || false
                })));
            }
        } catch (e) { console.error('加载消息失败', e); }
        setIsLoadingHistory(false);
    }, []);

    // ─── 选择会话 ──────────────────────────────────────────
    const handleSelectConversation = (conv: Conversation) => {
        setCurrentConvId(conv.id);
        loadMessages(conv.id);
    };

    // ─── 新建对话 ──────────────────────────────────────────
    const handleNewConversation = () => {
        setCurrentConvId(null);
        setMessages([]);
        setInputText('');
        setPendingFiles([]);
        inputRef.current?.focus();
    };

    // ─── 删除会话 ──────────────────────────────────────────
    const handleDeleteConversation = async (convId: number, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await fetchWithAuth(`/api/product-selection/conversations/${convId}`, { method: 'DELETE' });
            if (currentConvId === convId) handleNewConversation();
            loadConversations();
        } catch (e) { console.error('删除失败', e); }
    };

    // ─── 更新标题 ──────────────────────────────────────────
    const handleSaveTitle = async () => {
        if (!currentConvId || !titleDraft.trim()) return;
        try {
            await fetchWithAuth(`/api/product-selection/conversations/${currentConvId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: titleDraft.trim() })
            });
            setEditingTitle(false);
            loadConversations();
        } catch (e) { console.error('更新标题失败', e); }
    };

    // ─── 文件上传 ──────────────────────────────────────────
    const uploadSingleFile = async (file: File): Promise<FileAttachment | null> => {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const allowedImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
        const allowedDoc = ['pdf', 'xlsx', 'docx'];
        if (![...allowedImage, ...allowedDoc].includes(ext)) {
            alert(`不支持的文件类型: ${ext}`);
            return null;
        }
        if (file.size > 20 * 1024 * 1024) {
            alert(`文件 ${file.name} 超过 20MB 限制`);
            return null;
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetchWithAuth(AI_PRODUCT_SELECTION_UPLOAD_ENDPOINT, {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                return {
                    upload_file_id: data.upload_file_id,
                    filename: data.filename || file.name,
                    mimetype: data.mimetype || file.type
                };
            } else {
                alert(`上传失败: ${data.message}`);
                return null;
            }
        } catch (err) {
            console.error('文件上传失败', err);
            alert('文件上传失败');
            return null;
        }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;

        setUploadingFiles(true);
        const fileArray = Array.from(files);
        
        // 并行上传所有文件
        const results = await Promise.all(fileArray.map(file => uploadSingleFile(file)));
        const validFiles = results.filter((f): f is FileAttachment => f !== null);
        
        if (validFiles.length > 0) {
            setPendingFiles(prev => [...prev, ...validFiles]);
        }
        
        setUploadingFiles(false);
        // 清空 input 以支持重复选择同名文件
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // ─── 拖拽上传 ──────────────────────────────────────────
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const files = e.dataTransfer.files;
        if (files.length === 0) return;

        setUploadingFiles(true);
        const fileArray = Array.from(files);
        const results = await Promise.all(fileArray.map(file => uploadSingleFile(file)));
        const validFiles = results.filter((f): f is FileAttachment => f !== null);
        
        if (validFiles.length > 0) {
            setPendingFiles(prev => [...prev, ...validFiles]);
        }
        
        setUploadingFiles(false);
    };

    const removePendingFile = (idx: number) => {
        setPendingFiles(prev => prev.filter((_, i) => i !== idx));
    };

    // ─── 发送消息 ──────────────────────────────────────────
    const handleSend = async () => {
        const text = inputText.trim();
        if (!text && pendingFiles.length === 0) return;
        if (isStreaming) return;

        const userMsg: ChatMessage = {
            id: `user_${Date.now()}`,
            role: 'user',
            content: text,
            files: pendingFiles.length > 0 ? [...pendingFiles] : undefined,
            created_at: new Date().toISOString(),
            status: 'success'
        };

        const assistantMsg: ChatMessage = {
            id: `assistant_${Date.now()}`,
            role: 'assistant',
            content: '',
            created_at: new Date().toISOString(),
            status: 'streaming'
        };

        setMessages(prev => [...prev, userMsg, assistantMsg]);
        setInputText('');
        const filesToSend = pendingFiles.length > 0 ? [...pendingFiles] : undefined;
        setPendingFiles([]);
        setIsStreaming(true);

        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const token = localStorage.getItem('blue_os_token');
            const res = await fetch(AI_PRODUCT_SELECTION_CHAT_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    conversation_id: currentConvId,
                    message: text,
                    files: filesToSend
                }),
                signal: controller.signal
            });

            // 处理 401/403 鉴权失败
            if (res.status === 401 || res.status === 403) {
                localStorage.removeItem('blue_os_token');
                window.dispatchEvent(new Event('auth-unauthorized'));
                throw new Error('授权已过期，请重新登录');
            }

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.message || `请求失败 (${res.status})`);
            }

            const reader = res.body?.getReader();
            if (!reader) throw new Error('无法读取响应流');

            const decoder = new TextDecoder();
            let buffer = '';
            let accumulated = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data:')) continue;
                    const jsonStr = line.slice(5).trim();
                    if (!jsonStr) continue;

                    try {
                        const eventData = JSON.parse(jsonStr);

                        // 从任意事件中提取 task_id，确保早期停止也能生效
                        if (eventData.task_id) taskIdRef.current = eventData.task_id;

                        if (eventData.event === 'message') {
                            accumulated += eventData.answer || '';
                            setMessages(prev => {
                                const updated = [...prev];
                                const last = updated[updated.length - 1];
                                if (last && last.role === 'assistant') {
                                    updated[updated.length - 1] = { ...last, content: accumulated };
                                }
                                return updated;
                            });
                        } else if (eventData.event === 'complete') {
                            if (eventData.conversation_id && !currentConvId) {
                                setCurrentConvId(eventData.conversation_id);
                                loadConversations();
                            }
                            setMessages(prev => {
                                const updated = [...prev];
                                const last = updated[updated.length - 1];
                                if (last && last.role === 'assistant') {
                                    updated[updated.length - 1] = { ...last, content: eventData.answer || accumulated, status: 'success' };
                                }
                                return updated;
                            });
                        } else if (eventData.event === 'error') {
                            setMessages(prev => {
                                const updated = [...prev];
                                const last = updated[updated.length - 1];
                                if (last && last.role === 'assistant') {
                                    updated[updated.length - 1] = { ...last, content: `错误: ${eventData.message}`, status: 'error' };
                                }
                                return updated;
                            });
                        }
                    } catch (e) { /* ignore parse errors */ }
                }
            }
        } catch (err: any) {
            if (err.name === 'AbortError') {
                setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.role === 'assistant' && last.status === 'streaming') {
                        updated[updated.length - 1] = { ...last, content: last.content || '', status: 'success', stopped: true };
                    }
                    return updated;
                });
            } else {
                setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.role === 'assistant') {
                        updated[updated.length - 1] = { ...last, content: `请求失败: ${err.message}`, status: 'error' };
                    }
                    return updated;
                });
            }
        } finally {
            setIsStreaming(false);
            abortRef.current = null;
            taskIdRef.current = '';
        }
    };

    // ─── 停止生成 ──────────────────────────────────────────
    const handleStop = async () => {
        if (abortRef.current) {
            abortRef.current.abort();
        }
        if (taskIdRef.current) {
            try {
                await fetchWithAuth('/api/product-selection/stop', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ task_id: taskIdRef.current, conversation_id: currentConvId })
                });
            } catch (e) { console.error('停止失败', e); }
        }
    };

    // ─── 键盘事件 ──────────────────────────────────────────
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    // ─── textarea 自动高度 ──────────────────────────────────
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInputText(e.target.value);
        const el = e.target;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    };

    // ─── 向导生成需求 ──────────────────────────────────────
    const handleWizardGenerate = () => {
        const parts: string[] = [];
        if (wz_project.trim()) parts.push(`项目名称：${wz_project.trim()}`);
        if (wz_quantity.trim()) parts.push(`商品数量要求：${wz_quantity.trim()}`);
        if (wz_category.trim()) parts.push(`产品类目：${wz_category.trim()}`);
        if (wz_target.trim()) parts.push(`目标市场/人群：${wz_target.trim()}`);
        if (wz_price.trim()) parts.push(`价格区间：${wz_price.trim()}`);
        if (wz_brand.trim()) parts.push(`品牌要求：${wz_brand.trim()}`);
        if (wz_channel.trim()) parts.push(`销售渠道：${wz_channel.trim()}`);
        if (wz_extra.trim()) parts.push(wz_extra.trim());
        if (parts.length === 0) return;
        const prompt = `请帮我分析以下选品需求：\n\n${parts.join('\n')}\n\n请从市场趋势、竞争格局、利润空间、风险点等维度进行综合分析，并给出具体的选品建议。`;
        setInputText(prompt);
        inputRef.current?.focus();
    };

    const handleWizardReset = () => {
        setWzProject(''); setWzQuantity(''); setWzCategory(''); setWzTarget(''); setWzPrice(''); setWzBrand(''); setWzChannel(''); setWzExtra('');
    };

    const handleFillExample = () => {
        const example = WIZARD_EXAMPLES[Math.floor(Math.random() * WIZARD_EXAMPLES.length)];
        setWzProject(example.project);
        setWzQuantity(example.quantity);
        setWzCategory(example.category);
        setWzTarget(example.target);
        setWzPrice(example.price);
        setWzBrand(example.brand);
        setWzChannel(example.channel);
        setWzExtra(example.extra);
    };

    // ─── 当前会话标题 ──────────────────────────────────────
    const currentTitle = currentConvId
        ? conversations.find(c => c.id === currentConvId)?.title || '对话'
        : '新对话';

    // ─── 格式化时间 ──────────────────────────────────────
    const formatTime = (dateStr: string) => {
        try {
            const d = new Date(dateStr);
            return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        } catch { return ''; }
    };

    const formatDate = (dateStr: string) => {
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
        } catch { return ''; }
    };

    // ─── 渲染 ──────────────────────────────────────────────
    return (
        <div className="flex h-full bg-slate-50/80">
            {/* ─── 左侧快捷向导 ─── */}
            <div className={`${wizardCollapsed ? 'w-0 overflow-hidden' : 'w-[280px]'} flex-shrink-0 border-r border-slate-200/60 bg-white/70 backdrop-blur-sm flex flex-col transition-all duration-300`}>
                <div className="p-3 border-b border-slate-200/60">
                    <div className="flex items-center gap-2 mb-1">
                        <Wand2 className="w-4 h-4 text-violet-500" />
                        <h3 className="text-sm font-semibold text-slate-700">快捷生成向导</h3>
                    </div>
                    <p className="text-[11px] text-slate-400">填写关键信息，快速组装选品需求</p>
                    <button onClick={handleFillExample} className="mt-1 flex items-center gap-1 text-[11px] text-violet-500 hover:text-violet-700 transition-colors">
                        <Dice5 className="w-3 h-3" />
                        一键填入示例
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                    <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">项目名称</label>
                        <input value={wz_project} onChange={e => setWzProject(e.target.value)} placeholder="如：2026美妆选品..." className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400/30 bg-white" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">商品数量要求</label>
                        <input value={wz_quantity} onChange={e => setWzQuantity(e.target.value)} placeholder="如：10-20个SKU、不少于50个..." className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400/30 bg-white" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">产品类目</label>
                        <input value={wz_category} onChange={e => setWzCategory(e.target.value)} placeholder="如：护肤品、彩妆、保健品..." className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400/30 bg-white" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">目标市场/人群</label>
                        <input value={wz_target} onChange={e => setWzTarget(e.target.value)} placeholder="如：东南亚年轻女性、国内宝妈..." className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400/30 bg-white" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">价格区间</label>
                        <input value={wz_price} onChange={e => setWzPrice(e.target.value)} placeholder="如：50-200元、高端线..." className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400/30 bg-white" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">品牌要求</label>
                        <input value={wz_brand} onChange={e => setWzBrand(e.target.value)} placeholder="如：国际大牌平替、国货新锐..." className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400/30 bg-white" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">销售渠道</label>
                        <input value={wz_channel} onChange={e => setWzChannel(e.target.value)} placeholder="如：浦发银行、辉山、线下CS..." className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400/30 bg-white" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">补充说明</label>
                        <textarea value={wz_extra} onChange={e => setWzExtra(e.target.value)} placeholder="其他特殊要求或关注点..." rows={2} className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400/30 bg-white resize-none" />
                    </div>
                </div>
                <div className="p-3 border-t border-slate-200/60 flex gap-2">
                    <button
                        onClick={handleWizardGenerate}
                        disabled={!wz_project && !wz_quantity && !wz_category && !wz_target && !wz_price && !wz_brand && !wz_channel && !wz_extra}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-purple-600 text-white text-sm font-medium hover:from-violet-600 hover:to-purple-700 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Sparkles className="w-3.5 h-3.5" />
                        生成需求
                    </button>
                    <button
                        onClick={handleWizardReset}
                        className="px-3 py-2 rounded-lg border border-slate-200 text-slate-500 text-sm hover:bg-slate-50 transition-colors"
                    >
                        重置
                    </button>
                </div>
            </div>

            {/* ─── 中间对话主区域 ─── */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* 顶部标题栏 */}
                <div className="h-12 flex items-center px-4 border-b border-slate-200/60 bg-white/50 backdrop-blur-sm">
                    <button
                        onClick={() => setWizardCollapsed(!wizardCollapsed)}
                        className="mr-3 p-1 rounded hover:bg-slate-100 text-slate-500"
                        title={wizardCollapsed ? '展开向导' : '收起向导'}
                    >
                        {wizardCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                    </button>
                    {editingTitle ? (
                        <div className="flex items-center gap-2 flex-1">
                            <input
                                value={titleDraft}
                                onChange={e => setTitleDraft(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleSaveTitle()}
                                className="flex-1 text-sm border border-blue-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                autoFocus
                            />
                            <button onClick={handleSaveTitle} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check className="w-4 h-4" /></button>
                            <button onClick={() => setEditingTitle(false)} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X className="w-4 h-4" /></button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 flex-1">
                            <h2 className="text-sm font-medium text-slate-700 truncate">{currentTitle}</h2>
                            {currentConvId && (
                                <button onClick={() => { setTitleDraft(currentTitle); setEditingTitle(true); }} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded">
                                    <Pen className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    )}
                    <button
                        onClick={() => setHistoryCollapsed(!historyCollapsed)}
                        className="ml-2 p-1 rounded hover:bg-slate-100 text-slate-500"
                        title={historyCollapsed ? '展开历史' : '收起历史'}
                    >
                        <History className="w-4 h-4" />
                    </button>
                </div>

                {/* 消息流区域 */}
                <div className="flex-1 overflow-y-auto py-4">
                    {isLoadingHistory ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                        </div>
                    ) : messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <Bot className="w-12 h-12 mb-3 text-slate-300" />
                            <p className="text-sm">开始一段新的选品策略对话</p>
                            <p className="text-xs mt-1">输入文字描述或上传附件，AI 将为您分析选品方向</p>
                        </div>
                    ) : (
                        <div className="px-4 space-y-5">
                            {messages.map((msg) => (
                                <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                                    {/* 头像 */}
                                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                                        msg.role === 'user'
                                            ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white'
                                            : 'bg-gradient-to-br from-violet-100 to-indigo-100 text-violet-600'
                                    }`}>
                                        {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                                    </div>
                                    {/* 消息主体 */}
                                    <div className={`flex flex-col max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                        {/* 附件展示 */}
                                        {msg.files && msg.files.length > 0 && (
                                            <div className="flex flex-wrap gap-2 mb-1.5">
                                                {msg.files.map((f, idx) => (
                                                    <div key={idx} className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100/80 rounded-lg text-xs text-slate-600">
                                                        <Paperclip className="w-3 h-3" />
                                                        <span className="truncate max-w-[120px]">{f.filename}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {/* 消息气泡 */}
                                        <div className={`px-4 py-3 ${
                                            msg.role === 'user'
                                                ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-2xl rounded-br-md shadow-blue-200/50 shadow-md'
                                                : 'bg-white rounded-2xl rounded-bl-md shadow-sm border border-slate-100/80'
                                        }`}>
                                            {msg.role === 'assistant' ? (
                                                <>
                                                    <AIMessageContent content={msg.content || (msg.status === 'streaming' ? '思考中...' : '')} isStreaming={msg.status === 'streaming'} msgCreatedAt={msg.created_at} />
                                                    {msg.stopped && (
                                                        <div className="flex items-center gap-1.5 mt-3 pt-2.5 border-t border-slate-100 text-xs text-slate-400">
                                                            <Square className="w-3 h-3" />
                                                            <span>已手动停止生成</span>
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                                            )}
                                        </div>
                                        {/* 时间戳 */}
                                        <p className={`text-[11px] mt-1.5 px-1 ${msg.role === 'user' ? 'text-right text-slate-400' : 'text-slate-400'}`}>
                                            {formatTime(msg.created_at)}
                                        </p>
                                    </div>
                                </div>
                            ))}
                            <div ref={messagesEndRef} />
                        </div>
                    )}
                </div>

                {/* 输入区 */}
                <div
                    className={`border-t bg-white/70 backdrop-blur-sm py-3 transition-all ${
                        isDragOver ? 'border-blue-400 border-2 bg-blue-50/50' : 'border-slate-200/60'
                    }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    <div className="px-4">
                        {/* 拖拽提示 */}
                        {isDragOver && (
                            <div className="flex items-center justify-center gap-2 py-4 text-blue-500">
                                <Upload className="w-5 h-5 animate-bounce" />
                                <span className="text-sm font-medium">释放文件以上传</span>
                            </div>
                        )}
                        {/* 待发送文件列表 */}
                        {pendingFiles.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-2">
                                {pendingFiles.map((f, idx) => (
                                    <div key={idx} className="relative group flex items-center gap-1.5 px-2 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
                                        <Paperclip className="w-3 h-3 flex-shrink-0" />
                                        <span className="truncate max-w-[100px]">{f.filename}</span>
                                        <button
                                            onClick={() => removePendingFile(idx)}
                                            className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <X className="w-2.5 h-2.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {/* 输入框容器：按钮内置于右下角 */}
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.xlsx,.docx"
                            onChange={handleFileSelect}
                            className="hidden"
                        />
                        <div className="relative rounded-xl border border-slate-200 bg-white focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400/30 transition-all shadow-sm">
                            <textarea
                                ref={inputRef}
                                value={inputText}
                                onChange={handleInputChange}
                                onKeyDown={handleKeyDown}
                                placeholder="输入选品需求描述... (Shift+Enter 换行，Enter 发送)"
                                className="w-full resize-none rounded-xl px-3.5 pt-2.5 pb-10 text-sm leading-relaxed bg-transparent focus:outline-none"
                                style={{ maxHeight: '200px', minHeight: '80px' }}
                                rows={3}
                                disabled={isStreaming}
                            />
                            {/* 底部工具栏：左侧模型标签 + 右侧按钮组 */}
                            <div className="absolute left-2 bottom-2 right-2 flex items-center justify-between">
                                {/* 左侧模型标签 */}
                                <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-50 border border-slate-200 text-xs text-slate-500">
                                    <Sparkles className="w-3 h-3 text-indigo-400" />
                                    <span>qwen3.7-plus</span>
                                </div>
                                {/* 右侧按钮组 */}
                                <div className="flex items-center gap-1.5">
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={uploadingFiles}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition-colors disabled:opacity-50"
                                    title="上传附件"
                                >
                                    {uploadingFiles ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Paperclip className="w-4 h-4" />
                                    )}
                                </button>
                                {isStreaming ? (
                                    <button
                                        onClick={handleStop}
                                        className="p-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
                                        title="停止生成"
                                    >
                                        <Square className="w-4 h-4" />
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleSend}
                                        disabled={!inputText.trim() && pendingFiles.length === 0}
                                        className="p-1.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                        title="发送"
                                    >
                                        <Send className="w-4 h-4" />
                                    </button>
                                )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ─── 右侧历史会话列表 ─── */}
            <div className={`${historyCollapsed ? 'w-0 overflow-hidden' : 'w-[260px]'} flex-shrink-0 border-l border-slate-200/60 bg-white/70 backdrop-blur-sm flex flex-col transition-all duration-300`}>
                <div className="p-3 border-b border-slate-200/60">
                    <button
                        onClick={handleNewConversation}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm font-medium hover:from-blue-600 hover:to-indigo-700 transition-all shadow-sm"
                    >
                        <Plus className="w-4 h-4" />
                        新建对话
                    </button>
                </div>
                <div className="flex items-center gap-2 px-3 pt-2 pb-1">
                    <History className="w-3.5 h-3.5 text-slate-400" />
                    <h3 className="text-xs font-medium text-slate-500">历史对话</h3>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {conversations.map(conv => (
                        <div
                            key={conv.id}
                            onClick={() => handleSelectConversation(conv)}
                            className={`group relative px-3 py-3 cursor-pointer border-r-3 transition-all ${
                                currentConvId === conv.id
                                    ? 'bg-blue-50/80 border-r-blue-500'
                                    : 'border-r-transparent hover:bg-slate-50'
                            }`}
                        >
                            <div className="flex items-start gap-2">
                                <MessageSquare className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-slate-700 truncate">{conv.title || '未命名对话'}</p>
                                    <p className="text-xs text-slate-400 mt-1">{formatDate(conv.updated_at)}</p>
                                </div>
                                <button
                                    onClick={(e) => handleDeleteConversation(conv.id, e)}
                                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all"
                                    title="删除"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    ))}
                    {conversations.length === 0 && (
                        <div className="text-center text-slate-400 text-xs mt-8">暂无历史对话</div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProductSelectionStrategyModule;
