import React, { useState, useEffect, useRef } from 'react';
import { X, Send, Smile, Grid, Loader2, ArrowUp, FileText, Download, Minus, Copy, Square } from 'lucide-react';
import { fetchWithAuth } from '../utils/authFetch';
import { AI_DIGITAL_EMPLOYEE_CHAT_ENDPOINT, AI_DIGITAL_EMPLOYEE_PARAMS_ENDPOINT } from '../config';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { maskCustomerName } from '../utils/demoMask';

interface DigitalEmployeeProps {
  username?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  status?: 'sending' | 'success' | 'error';
}

const renderMessageContent = (content: string) => {
  if (!content) return null;
  const regex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const fileCards = [];
  let match;

  // 强制按原名下载的代理逻辑
  const handleFileDownload = async (e: React.MouseEvent, url: string, filename: string) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Fetch failed');
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // 预扫描全部外链，提取为底部的文件卡片
  while ((match = regex.exec(content)) !== null) {
    const linkText = match[1];
    const linkUrl = match[2];
    
    // 抓取后缀
    const extMatch = linkText.match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? extMatch[1].toUpperCase() : 'FILE';
    
    // 渲染卡片
    fileCards.push(
      <a 
        key={`card-${match.index}`} 
        href={linkUrl} 
        target="_blank" 
        rel="noopener noreferrer" 
        className="block mt-2 no-underline w-full max-w-[280px]"
        onClick={(e) => handleFileDownload(e, linkUrl, linkText)}
      >
        <div className="flex items-center justify-between border border-slate-200 rounded-xl p-3 bg-white hover:bg-slate-50 transition-colors shadow-sm group/file">
          <div className="flex flex-col gap-1.5 overflow-hidden pr-3">
            <span className="text-[13.5px] font-semibold text-slate-700 truncate max-w-full block" title={linkText}>{linkText}</span>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-medium leading-none">
              <div className="w-4 h-4 rounded bg-blue-100 flex items-center justify-center shrink-0">
                <FileText className="w-3 h-3 text-blue-600" />
              </div>
              <span className="tracking-wide">{ext} 文档</span>
            </div>
          </div>
          <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-slate-400 group-hover/file:bg-blue-100 group-hover/file:text-blue-600 transition-colors">
            <Download className="w-3.5 h-3.5" />
          </div>
        </div>
      </a>
    );
  }

  return (
    <>
      <div className="prose prose-sm prose-slate max-w-none break-words leading-relaxed
                      prose-p:my-1.5 prose-headings:my-2.5 prose-ul:my-1.5 prose-li:my-0.5 prose-hr:my-3
                      marker:text-slate-400">
        <ReactMarkdown 
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({node, href, children, ...props}) => {
              const filename = String(children);
              return (
                <a 
                  href={href as string} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-blue-600 hover:text-blue-700 hover:underline break-all no-underline font-medium"
                  onClick={(e) => {
                    if (href && href.startsWith('http')) {
                      handleFileDownload(e, href, filename);
                    }
                  }}
                  {...props}
                >
                  {children}
                </a>
              );
            }
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
      {fileCards.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 pt-2 border-t border-slate-200/60">
          {fileCards}
        </div>
      )}
    </>
  );
};

export const DigitalEmployee: React.FC<DigitalEmployeeProps> = ({ username }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [hasUnread, setHasUnread] = useState(true);
  const [customerMasks, setCustomerMasks] = useState<{ regex: RegExp | null, map: Record<string, string>, exactMap: Record<string, string> }>({ regex: null, map: {}, exactMap: {} });

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  
  const [showScrollTop, setShowScrollTop] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Dragging State
  const [dragOffset, setDragOffset] = useState({ y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startY: number, initialOffset: number, hasMoved: boolean } | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = {
      startY: e.clientY,
      initialOffset: dragOffset.y,
      hasMoved: false
    };
    setIsDragging(false);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const dy = e.clientY - dragStartRef.current.startY;
    if (Math.abs(dy) > 3) {
      dragStartRef.current.hasMoved = true;
      setIsDragging(true);
      let newY = dragStartRef.current.initialOffset + dy;
      
      // 限制拖拽区间，防止拖出屏幕可视区域
      // 默认位置是 bottom-24 (距离底部约 96px)
      const maxDown = 16; // 往下最多拖动一点点，不遮挡底部任务栏 (64px)
      const maxUp = -(window.innerHeight - 180); // 往上不要超过屏幕顶部
      
      if (newY > maxDown) newY = maxDown;
      if (newY < maxUp) newY = maxUp;
      
      setDragOffset({ y: newY });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const wasDrag = dragStartRef.current.hasMoved;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragStartRef.current = null;
    setTimeout(() => setIsDragging(false), 50);
    // 如果没有实际拖拽，视为点击
    if (!wasDrag) {
      setIsOpen(true);
      setHasUnread(false);
    }
  };

  // Load Customer mappings for Global Desensitization
  useEffect(() => {
    fetch('/customer_analysis.json')
      .then(r => r.json())
      .then(data => {
        if (data && Array.isArray(data.customer_analysis_data)) {
          const map: Record<string, string> = {};
          const exactMap: Record<string, string> = {};
          const names: string[] = [];
          data.customer_analysis_data.forEach((row: any[]) => {
            const id = row[0] as number;
            const name = row[1] as string;
            if (name && typeof name === 'string' && name.length > 2) {
               const masked = maskCustomerName(id, name);
               map[name.toLowerCase()] = masked;
               exactMap[name] = masked;
               names.push(name);
            }
          });
          names.sort((a, b) => b.length - a.length); // match longest first
          
          if (names.length > 0) {
            const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regexStr = names.map(escapeRegex).join('|');
            const regex = new RegExp(regexStr, 'gi');
            setCustomerMasks({ regex, map, exactMap });
          }
        }
      })
      .catch((e) => console.error('Failed to load customer map for masking', e));
  }, []);

  // Fetch opening statement
  useEffect(() => {
    fetchWithAuth(AI_DIGITAL_EMPLOYEE_PARAMS_ENDPOINT)
      .then(res => res.json())
      .then(data => {
        if (data && data.opening_statement) {
          setMessages([
            { id: 'greeting', role: 'assistant', content: data.opening_statement, timestamp: new Date() }
          ]);
        } else {
          setMessages([
            { id: 'greeting', role: 'assistant', content: `您好，${username || '用户'}。我是您的专属数字员工，有什么我可以帮您的吗？`, timestamp: new Date() }
          ]);
        }
      })
      .catch(() => {
        setMessages([
          { id: 'greeting', role: 'assistant', content: `您好，${username || '用户'}。我是您的专属数字员工，有什么我可以帮您的吗？`, timestamp: new Date() }
        ]);
      });
  }, [username]);

  // ---------- Chat Logic ----------
  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isGenerating]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (e.currentTarget.scrollTop > 50) {
      setShowScrollTop(true);
    } else {
      setShowScrollTop(false);
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isGenerating) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsGenerating(true);

    const assistantId = (Date.now() + 1).toString();
    setMessages(prev => [
      ...prev,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        status: 'sending'
      }
    ]);

    try {
      const response = await fetchWithAuth(AI_DIGITAL_EMPLOYEE_CHAT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: userMessage.content,
          response_mode: 'streaming'
        })
      });

      if (!response.ok) {
        throw new Error('请求失败');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder('utf-8');
      if (!reader) throw new Error('流读取器初始化失败');

      let currentResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.replace('data: ', '').trim();
            if (dataStr === '[DONE]') continue;
            try {
              const data = JSON.parse(dataStr);
              if (data.event === 'message' || data.event === 'agent_message') {
                currentResponse += data.answer || '';
                setMessages(prev => prev.map(msg => 
                  msg.id === assistantId ? { ...msg, content: currentResponse, status: 'success' } : msg
                ));
              }
            } catch (e) {
              console.error('Dify chunk parse error:', e, dataStr);
            }
          }
        }
      }

      setMessages(prev => prev.map(msg => 
        msg.id === assistantId && !msg.content ? { ...msg, content: '已收到指令，执行完毕。', status: 'success' } : msg
      ));

    } catch (e) {
      setMessages(prev => prev.map(msg => 
        msg.id === assistantId ? { ...msg, content: '发送失败，点击重试', status: 'error' } : msg
      ));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      {/* 入口按钮 (Trigger Button) - 防遮挡任务栏 */}
      <div 
        className={`fixed bottom-24 right-6 z-[9999] ease-[cubic-bezier(0.2,0.8,0.2,1)] select-none touch-none ${isOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'} ${isDragging ? 'transition-none cursor-grabbing' : 'transition-all duration-500 cursor-pointer'}`}
        style={{ transform: `translate(${isOpen ? '8rem' : '0'}, ${dragOffset.y}px)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div 
          className="relative group"
        >
          <div className="w-12 h-12 rounded-full bg-blue-600 shadow-[0_2px_8px_rgba(0,0,0,0.15)] flex items-center justify-center transition-all duration-200 group-hover:scale-[1.05] group-hover:shadow-[0_4px_12px_rgba(0,0,0,0.25)]">
            <Smile className="w-6 h-6 text-white absolute transition-opacity duration-300 pointer-events-none" />
          </div>
          {hasUnread && (
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 animate-ping" />
          )}
          {hasUnread && (
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 shadow-sm" />
          )}
        </div>
      </div>

      {/* 核心对话区 (Popup Chat Window) */}
      <div 
        className={`fixed z-[9998] bg-slate-50 shadow-2xl transition-all duration-300 ease-out flex flex-col overflow-hidden border border-white/40 backdrop-blur-3xl`}
        style={{
          top: isMaximized ? '0px' : '24px',
          bottom: isMaximized ? '0px' : '84px',
          right: isOpen ? (isMaximized ? '0px' : '24px') : '-55vw',
          width: isMaximized ? '100vw' : '45vw',
          maxWidth: isMaximized ? '100vw' : '800px',
          minWidth: '400px',
          borderRadius: isMaximized ? '0px' : '16px',
          opacity: isOpen ? 1 : 0,
        }}
      >
        {/* 顶部导航栏 (Header) */}
        <div className="h-14 bg-white/80 backdrop-blur-md border-b border-slate-200 flex items-center justify-between px-4 shrink-0 select-none z-10">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-100 to-blue-50 flex items-center justify-center border border-blue-200 shadow-sm overflow-hidden">
                <Smile className="w-5 h-5 text-blue-600" />
              </div>
              <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white ring-1 ring-black/5" />
            </div>
            <div className="flex flex-col">
              <span className="text-[15px] font-bold text-slate-800 leading-tight">数字员工助手</span>
              <div className="flex items-center gap-1 opacity-70">
                <span className="text-[10px] text-slate-500 font-medium">智能支持</span>
              </div>
            </div>
          </div>

          <div className="flex items-center">
            <button 
              className="w-11 h-10 hover:bg-slate-200/80 flex items-center justify-center transition-colors text-slate-600 cursor-default" 
              onClick={() => setIsOpen(false)}
              title="最小化"
            >
              <Minus strokeWidth={1.5} className="w-[18px] h-[18px]" />
            </button>
            <button 
              className="w-11 h-10 hover:bg-slate-200/80 flex items-center justify-center transition-colors text-slate-600 cursor-default" 
              onClick={() => setIsMaximized(!isMaximized)}
              title={isMaximized ? "还原窗口" : "最大化"}
            >
              {isMaximized ? (
                <Copy strokeWidth={1.5} className="w-[16px] h-[16px]" />
              ) : (
                <Square strokeWidth={1.5} className="w-[15px] h-[15px]" />
              )}
            </button>
            <button 
              className="w-11 h-10 hover:bg-red-500 hover:text-white flex items-center justify-center transition-colors text-slate-600 cursor-default" 
              onClick={() => {
                 setIsOpen(false);
                 setIsMaximized(false);
              }}
              title="关闭"
            >
              <X strokeWidth={1.5} className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>

        {/* 聊天记录内容区 */}
        <div 
          className="flex-1 overflow-y-auto px-4 py-4 relative bg-[linear-gradient(to_bottom,rgba(248,250,252,0.8),rgba(241,245,249,0.9))] z-10"
          ref={scrollContainerRef}
          onScroll={handleScroll}
          style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.02) 1px, transparent 1px)', backgroundSize: '16px 16px' }}
        >
          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            
            // Handle Desensitization
            let displayContent = msg.content;
            if (!isUser && customerMasks.regex && displayContent) {
              displayContent = displayContent.replace(customerMasks.regex, (match) => {
                return customerMasks.exactMap[match] || customerMasks.map[match.toLowerCase()] || match;
              });
            }

            return (
              <div key={msg.id} className={`flex w-full mb-5 ${isUser ? 'justify-end' : 'justify-start'}`}>
                {!isUser && (
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex-shrink-0 flex items-center justify-center mr-3 mt-1 border border-blue-200">
                    <Smile className="w-4 h-4 text-blue-600" />
                  </div>
                )}
                <div className={`max-w-[80%] flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                  <div 
                    className={`rounded-2xl px-4 py-3 shadow-md text-[15px] leading-relaxed break-words
                      ${isUser 
                        ? 'bg-blue-100 text-slate-800 border border-blue-200/60 rounded-tr-sm shadow-[0_2px_8px_rgba(59,130,246,0.08)]' 
                        : 'bg-white text-slate-800 border border-slate-100 rounded-tl-sm shadow-[0_4px_12px_rgba(0,0,0,0.04)]'}
                      ${msg.status === 'error' ? 'border-red-300 bg-red-50 text-red-700 cursor-pointer hover:bg-red-100' : ''}`}
                    onClick={() => {
                      if (msg.status === 'error' && isUser) {
                        setInputValue(msg.content);
                        setMessages(prev => prev.filter(m => m.id !== msg.id));
                      }
                    }}
                  >
                    {msg.status === 'sending' && !isUser && !msg.content ? (
                      <div className="flex items-center gap-1.5 h-5 px-1">
                        <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    ) : (
                      <>
                        {msg.status === 'error' ? (
                          '发送失败，点击重试'
                        ) : isUser ? (
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                        ) : (
                          renderMessageContent(displayContent)
                        )}
                      </>
                    )}
                  </div>
                  <div className="text-[12px] text-slate-400 mt-1.5 px-1 font-medium">
                    {msg.timestamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Scroll To Top Button */}
        <div className={`absolute bottom-[80px] right-6 z-20 transition-all duration-300 ${showScrollTop ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
          <button 
            className="w-10 h-10 rounded-full bg-white shadow-xl text-slate-600 flex items-center justify-center hover:bg-slate-50 border border-slate-200"
            onClick={() => scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <ArrowUp className="w-5 h-5" />
          </button>
        </div>

        {/* 输入区 (Bottom Input) */}
        <div className="h-[72px] bg-white border-t border-slate-200 flex items-center px-4 shrink-0 z-10 w-full relative drop-shadow-sm">
          <div className="flex-1 h-12 bg-slate-50 border border-slate-200 rounded-xl flex items-center px-2 overflow-hidden transition-all focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 shadow-inner">
            <button className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition-colors shrink-0">
              <Smile className="w-5 h-5" />
            </button>
            <input 
              className="flex-1 h-full bg-transparent border-none outline-none px-2 text-[15px] text-slate-700 placeholder:text-slate-400 min-w-0"
              placeholder="请输入您的问题或指令..."
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            {isGenerating ? (
              <div className="w-10 h-10 flex items-center justify-center shrink-0">
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
              </div>
            ) : (
              <button 
                className="w-10 h-10 rounded-lg flex items-center justify-center text-white bg-blue-600 hover:bg-blue-700 transition-colors shrink-0 shadow-md"
                onClick={handleSend}
              >
                <Send className="w-4 h-4 ml-0.5" />
              </button>
            )}
            <div className="w-[1px] h-6 bg-slate-200 mx-2" />
            <button className="w-10 h-10 rounded-lg flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors shrink-0">
              <Grid className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
