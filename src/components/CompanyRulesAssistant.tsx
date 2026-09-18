import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeRaw from 'rehype-raw';
import { Bot, User, Send, Plus, Loader2, MessageSquare, Edit2, Trash2 } from 'lucide-react';
import { API_RULES_ASSISTANT_BASE } from '../config';
import { fetchWithAuth } from '../utils/authFetch';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt?: number;
}

interface Conversation {
    id: string;
    name: string;
    inputs: Record<string, any>;
    status: string;
    created_at: number;
}

interface CompanyRulesAssistantProps {
    username?: string;
}

import { KnowledgeManagement } from './KnowledgeManagement';

export const CompanyRulesAssistant: React.FC<CompanyRulesAssistantProps> = ({ username: propUsername }) => {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [currentConvId, setCurrentConvId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [showKbManagement, setShowKbManagement] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const username = propUsername || localStorage.getItem('__mock_user') || 'web_user';

    // 1. 获取会话列表
    const fetchConversations = async () => {
        try {
            const res = await fetchWithAuth(`${API_RULES_ASSISTANT_BASE}/conversations?user=${username}&limit=50`);
            if (!res.ok) return;
            const data = await res.json();
            const list = data.data || [];
            // 基于 updated_at 或 created_at 强制置顶最新发言的会话记录
            list.sort((a: any, b: any) => (b.updated_at || b.created_at || 0) - (a.updated_at || a.created_at || 0));
            setConversations(list);
        } catch (e) { console.error('Failed to fetch conversations:', e); }
    };

    useEffect(() => { fetchConversations(); }, []);

    const loadMessages = async (convId: string) => {
        setCurrentConvId(convId);
        setMessages([]);
        setShowKbManagement(false);
        try {
            const res = await fetchWithAuth(`${API_RULES_ASSISTANT_BASE}/messages?user=${username}&conversation_id=${convId}`);
            if (!res.ok) return;
            const data = await res.json();
            const loaded: Message[] = [];
            data.data.forEach((m: any) => {
                loaded.push({ id: m.id + '-q', role: 'user', content: m.query, createdAt: m.created_at });
                loaded.push({ id: m.id + '-a', role: 'assistant', content: m.answer, createdAt: m.created_at });
            });
            setMessages(loaded.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
        } catch (e) { console.error('Failed to load messages:', e); }
    };

    // 自动滚动
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isTyping]);

    // 3. 发送消息 (SSE 流式)
    const handleSend = async () => {
        if (!input.trim() || isTyping) return;
        const query = input.trim();
        setInput('');
        const userMsg: Message = { id: Date.now().toString(), role: 'user', content: query };
        setMessages(prev => [...prev, userMsg]);
        setIsTyping(true);

        const asstMsgId = (Date.now() + 1).toString();
        setMessages(prev => [...prev, { id: asstMsgId, role: 'assistant', content: '' }]);

        let localConvId = currentConvId;

        try {
            const res = await fetchWithAuth(`${API_RULES_ASSISTANT_BASE}/chat-messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inputs: { current_tenant_id: username === 'admin' ? 'ADMIN' : username || 'DEFAULT_TENANT' },
                    query,
                    response_mode: 'streaming',
                    conversation_id: localConvId || '',
                    user: username
                })
            });

            if (!res.ok) throw new Error(await res.text());

            const reader = res.body?.getReader();
            const decoder = new TextDecoder();
            let assistantResponse = '';

            while (reader) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const dataStr = line.slice(6).trim();
                    if (!dataStr) continue;
                    try {
                        const data = JSON.parse(dataStr);
                        if (data.event === 'message') {
                            if (!localConvId && data.conversation_id) {
                                localConvId = data.conversation_id;
                                setCurrentConvId(prevId => prevId === null ? localConvId : prevId);
                                fetchConversations();
                            }
                            assistantResponse += data.answer;
                            setMessages(prev => prev.map(m => m.id === asstMsgId ? { ...m, content: assistantResponse } : m));
                        } else if (data.event === 'message_end' && data.conversation_id) {
                            if (!localConvId) {
                                localConvId = data.conversation_id;
                                setCurrentConvId(prevId => prevId === null ? localConvId : prevId);
                                fetchConversations();
                            }
                        }
                    } catch (e) { /* ignore parse error for incomplete chunks */ }
                }
            }

            // 无条件拉取列表以确保最新发言被挤到最前端
            fetchConversations();

            // 通知菜单栏：后台任务完成
            window.dispatchEvent(new CustomEvent('app-task-done', { detail: { appId: 'rules' } }));
        } catch (err: any) {
            setMessages(prev => prev.map(m => m.id === asstMsgId ? { ...m, content: `❌ 请求失败: ${err.message}` } : m));
        } finally {
            setIsTyping(false);
        }
    };

    // 4. 重命名会话
    const handleRename = async (id: string, newName: string) => {
        try {
            await fetchWithAuth(`${API_RULES_ASSISTANT_BASE}/conversations/${id}/name`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName, user: username })
            });
            fetchConversations();
        } catch (e) { console.error('Rename failed', e); }
    };

    // 5. 删除会话
    const handleDelete = async (id: string) => {
        try {
            await fetchWithAuth(`${API_RULES_ASSISTANT_BASE}/conversations/${id}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user: username })
            });
            if (currentConvId === id) {
                setCurrentConvId(null);
                setMessages([]);
            }
            fetchConversations();
        } catch (e) { console.error('Delete failed', e); }
    };

    const handleNewChat = () => {
        setCurrentConvId(null);
        setMessages([]);
        setShowKbManagement(false);
    };

    return (
        <div className="flex h-full w-full bg-transparent overflow-hidden font-sans">
            {/* 侧边栏：历史会话 */}
            <div className="w-64 bg-white/80 backdrop-blur-md border-r border-slate-200 flex flex-col shrink-0">
                <div className="p-4 border-b border-slate-100">
                    <button
                        onClick={handleNewChat}
                        className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm flex items-center justify-center gap-2 transition-colors font-medium text-sm"
                    >
                        <Plus className="w-4 h-4" /> 新建问答
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                    {conversations.length === 0 ? (
                        <div className="text-center text-slate-400 text-xs py-10">暂无历史记录</div>
                    ) : conversations.map(conv => (
                        <div
                            key={conv.id}
                            onClick={() => { if (editingId !== conv.id) loadMessages(conv.id); }}
                            className={`group flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${currentConvId === conv.id ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-100 text-slate-700'}`}
                        >
                            <div className="flex items-center gap-2.5 overflow-hidden flex-1">
                                <MessageSquare className={`w-4 h-4 shrink-0 ${currentConvId === conv.id ? 'text-indigo-500' : 'text-slate-400'}`} />
                                {editingId === conv.id ? (
                                    <input
                                        autoFocus
                                        value={editName}
                                        onChange={e => setEditName(e.target.value)}
                                        onClick={e => e.stopPropagation()}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') { handleRename(conv.id, editName); setEditingId(null); }
                                            if (e.key === 'Escape') setEditingId(null);
                                        }}
                                        onBlur={() => { handleRename(conv.id, editName); setEditingId(null); }}
                                        className="flex-1 min-w-0 bg-white border border-indigo-300 rounded px-1 py-0.5 text-xs outline-none"
                                    />
                                ) : (
                                    <span className="truncate text-sm font-medium">{conv.name || '新的对话'}</span>
                                )}
                            </div>

                            {/* 操作按钮区 */}
                            {editingId !== conv.id && (
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                    <button onClick={(e) => { e.stopPropagation(); setEditName(conv.name); setEditingId(conv.id); }} className="p-1 hover:bg-white rounded text-slate-400 hover:text-indigo-600">
                                        <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); handleDelete(conv.id); }} className="p-1 hover:bg-white rounded text-slate-400 hover:text-red-600">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* 主对话区 */}
            {!showKbManagement && (
            <div className="flex-1 flex flex-col bg-slate-50/50 relative transition-all">
                {/* 顶部标题区 */}
                <div className="h-14 shrink-0 border-b border-slate-200 bg-white/50 backdrop-blur flex items-center justify-between px-6">
                    <div className="flex items-center">
                        <div className="bg-gradient-to-tr from-indigo-500 to-purple-500 p-1.5 rounded-lg mr-3 shadow-sm">
                            <Bot className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h2 className="text-slate-800 font-semibold leading-tight">公司制度问答助手</h2>
                            <p className="text-xs text-slate-500">基于企业知识库</p>
                        </div>
                    </div>
                    <button 
                        onClick={() => setShowKbManagement(!showKbManagement)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${showKbManagement ? 'bg-indigo-100 text-indigo-700' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                    >
                        <Bot className="w-4 h-4" /> 知识库管理
                    </button>
                </div>

                {/* 聊天消息流 */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    {messages.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
                            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-2">
                                <Bot className="w-8 h-8 text-slate-300" />
                            </div>
                            <p className="text-sm">我是企业制度问答助手，您可以随时向我提问关于公司规章、流程等任何问题。</p>
                            <div className="flex gap-2 text-xs">
                                <span className="px-3 py-1.5 bg-white border border-slate-200 rounded-full shadow-sm cursor-pointer hover:border-indigo-300 transition-colors" onClick={() => setInput('公司考勤制度是怎样的？')}>公司考勤制度是怎样的？</span>
                                <span className="px-3 py-1.5 bg-white border border-slate-200 rounded-full shadow-sm cursor-pointer hover:border-indigo-300 transition-colors" onClick={() => setInput('公司年假有几天？')}>公司年假有几天？</span>
                            </div>
                        </div>
                    ) : (
                        messages.map((msg, idx) => {
                            // 跳过渲染空数据的系统级或结构异常的消息
                            if (!msg || !msg.id) return null;
                            return (
                                <div key={msg.id || idx} className={`flex gap-4 max-w-4xl mx-auto ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${msg.role === 'user' ? 'bg-indigo-100 text-indigo-600' : 'bg-gradient-to-tr from-indigo-500 to-purple-500 text-white'}`}>
                                        {msg.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                                    </div>
                                    <div className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} max-w-[80%]`}>
                                        <div className={`px-5 py-3.5 rounded-2xl shadow-sm text-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-white border border-slate-200/60 text-slate-700 rounded-tl-sm'}`}>
                                            {msg.role === 'assistant' ? (
                                                <div className="prose prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-slate-800 prose-pre:text-slate-100">
                                                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeRaw]}>
                                                        {msg.content || '正在思考...'}
                                                    </ReactMarkdown>
                                                </div>
                                            ) : (
                                                <div className="whitespace-pre-wrap">{msg.content}</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* 输入区 */}
                <div className="p-4 bg-white/80 backdrop-blur border-t border-slate-200 shrink-0">
                    <div className="max-w-4xl mx-auto relative flex items-end shadow-sm border border-slate-300 rounded-xl overflow-hidden bg-white focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 transition-all">
                        <textarea
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                            }}
                            placeholder="输入你的问题，按 Enter 发送，Shift + Enter 换行..."
                            className="w-full max-h-32 min-h-[52px] py-3.5 pl-4 pr-12 resize-none outline-none text-sm text-slate-700 bg-transparent"
                            rows={1}
                        />
                        <button
                            onClick={handleSend}
                            disabled={!input.trim() || isTyping}
                            className={`absolute right-2 bottom-2 p-2 rounded-lg transition-colors ${!input.trim() || isTyping ? 'text-slate-300' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                        >
                            {isTyping ? <Loader2 className="w-4 h-4 animate-spin text-indigo-500" /> : <Send className="w-4 h-4" />}
                        </button>
                    </div>
                    <div className="text-center mt-2 text-[11px] text-slate-400">
                        内容由 AI 生成，对于特定的规章制度请参考公司内部正式文件。
                    </div>
                </div>
            </div>
            )}
            
            {/* 右侧抽屉 / 面板 - 知识库管理 */}
            {showKbManagement && (
                <div className="flex-1 bg-white z-10 flex flex-col transition-all">
                    {/* 给知识库管理增加一个明确的返回按钮 */}
                    <div className="h-14 shrink-0 border-b border-slate-200 bg-white/50 backdrop-blur flex items-center px-6">
                        <button 
                            onClick={() => setShowKbManagement(false)}
                            className="flex items-center gap-1 text-slate-500 hover:text-indigo-600 font-medium text-sm transition-colors"
                        >
                            <span className="text-lg leading-none">&larr;</span> 返回问答
                        </button>
                    </div>
                    <div className="flex-1 relative overflow-hidden">
                        <KnowledgeManagement username={username} datasetId="company_rules" />
                    </div>
                </div>
            )}
        </div>
    );
};
