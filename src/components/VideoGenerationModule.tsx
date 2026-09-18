import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Film, Image as ImageIcon, Video, Copy, Trash2, Loader2, RefreshCw, ChevronDown, ChevronUp, Plus, Save, Download, RotateCcw, X, History } from 'lucide-react';
import { sysAlert, sysConfirm } from '../utils/dialog';
import { fetchWithAuth } from '../utils/authFetch';
import { AI_VIDEOGEN_GENERATE_ENDPOINT } from '../config';

interface StoryboardCard {
  id: string;
  description: string;
  script: string;
  imagePrompt: string;
  cameraPrompt: string;
  imageUrl?: string;
  imageStatus?: 'idle' | 'loading' | 'success' | 'error';
}

interface ImageModalState {
  visible: boolean;
  url: string;
}

export const VideoGenerationModule: React.FC = () => {
  const [query, setQuery] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [storyboards, setStoryboards] = useState<StoryboardCard[]>([]);
  
  // 生成状态强制流转（从卡片状态派生）
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [imageModal, setImageModal] = useState<ImageModalState>({ visible: false, url: '' });
  const [videoModal, setVideoModal] = useState(false);
  // mock 视频地址（实际对接后端后替换为真实 URL）
  const MOCK_VIDEO_URL = 'https://www.w3schools.com/html/mov_bbb.mp4';
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState('');

  // 所有卡片都已生成图片时，才允许生成视频
  const imageGenerated = storyboards.length > 0 && storyboards.every(c => c.imageStatus === 'success');
  
  // 卡片折叠状态
  const [collapsedCards, setCollapsedCards] = useState<Set<string>>(new Set());
  
  // 历史记录
  const [history, setHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  
  // 定时器引用，用于支持“终止任务”
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  const generateId = () => Math.random().toString(36).substring(2, 9);

  // 初始化加载缓存
  useEffect(() => {
    try {
      const draft = localStorage.getItem('videogen_draft');
      if (draft) {
        const parsed = JSON.parse(draft);
        setQuery(parsed.query || '');
        setStoryboards((parsed.storyboards || []).map((c: StoryboardCard) => ({ ...c, imageStatus: c.imageStatus || 'idle', imageUrl: c.imageUrl || '' })));
      }
      const hist = localStorage.getItem('videogen_history');
      if (hist) setHistory(JSON.parse(hist));
    } catch (e) {
      console.error('Failed to parse videogen cache', e);
    }
  }, []);

  // 自动保存
  useEffect(() => {
    localStorage.setItem('videogen_draft', JSON.stringify({ query, storyboards }));
  }, [query, storyboards]);

  // 点击外部隐藏历史记录
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const saveToHistory = (val: string) => {
    if (!val.trim()) return;
    setHistory(prev => {
      const next = [val, ...prev.filter(item => item !== val)].slice(0, 10);
      localStorage.setItem('videogen_history', JSON.stringify(next));
      return next;
    });
  };

  const handleManualSave = () => {
    localStorage.setItem('videogen_draft', JSON.stringify({ query, storyboards }));
    sysAlert('草稿已手动保存至本地');
  };

  const stopTask = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsAnalyzing(false);
    sysAlert('任务已终止');
  };

  const executeAnalyze = async () => {
    setIsAnalyzing(true);
    saveToHistory(query);
    try {
      const res = await fetchWithAuth(AI_VIDEOGEN_GENERATE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || '服务器返回错误');
      setStoryboards(data.storyboards);
      setCollapsedCards(new Set());
      sysAlert('分镜脚本生成成功！');
      setTimeout(() => listEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err: any) {
      sysAlert(`生成失败：${err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAnalyze = () => {
    if (!query.trim()) {
      sysAlert('请输入视频标题或生成描述');
      return;
    }
    if (storyboards.length > 0) {
      sysConfirm('重新生成将覆盖当前分镜，是否继续？', () => executeAnalyze());
    } else {
      executeAnalyze();
    }
  };

  const handleCardChange = (id: string, field: keyof StoryboardCard, value: string) => {
    setStoryboards(prev => prev.map(card => card.id === id ? { ...card, [field]: value } : card));
  };

  const handleDeleteCard = (id: string) => {
    setStoryboards(prev => prev.filter(card => card.id !== id));
  };

  const handleCopyCard = (card: StoryboardCard, index: number) => {
    const newCard = { ...card, id: generateId(), imageStatus: 'idle' as const, imageUrl: '' };
    setStoryboards(prev => {
      const newList = [...prev];
      newList.splice(index + 1, 0, newCard);
      return newList;
    });
    sysAlert('卡片已复制');
  };

  const handleResetCard = (id: string) => {
    setStoryboards(prev => prev.map(card => card.id === id ? { ...card, description: '', script: '', imagePrompt: '', cameraPrompt: '', imageStatus: 'idle', imageUrl: '' } : card));
  };

  // 单独重绘某张分镜图
  const handleRedrawCard = (id: string) => {
    setStoryboards(prev => prev.map(c => c.id === id ? { ...c, imageStatus: 'loading' } : c));
    setTimeout(() => {
      // mock: 用渐变色占位图模拟生成结果
      const colors = ['#6366f1,#a855f7', '#f59e0b,#ef4444', '#10b981,#3b82f6', '#ec4899,#8b5cf6'];
      const pick = colors[Math.floor(Math.random() * colors.length)];
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='480' height='270'><defs><linearGradient id='g' x1='0%' y1='0%' x2='100%' y2='100%'><stop offset='0%' stop-color='${pick.split(',')[0]}'/><stop offset='100%' stop-color='${pick.split(',')[1]}'/></linearGradient></defs><rect width='480' height='270' fill='url(#g)'/></svg>`;
      const url = `data:image/svg+xml;base64,${btoa(svg)}`;
      setStoryboards(prev => prev.map(c => c.id === id ? { ...c, imageStatus: 'success', imageUrl: url } : c));
    }, 1500);
  };

  const handlePreviewImage = (url: string) => setImageModal({ visible: true, url });

  const toggleCollapse = (id: string) => {
    setCollapsedCards(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const moveCard = (index: number, direction: 'up' | 'down') => {
    setStoryboards(prev => {
      const newList = [...prev];
      if (direction === 'up' && index > 0) {
        [newList[index - 1], newList[index]] = [newList[index], newList[index - 1]];
      } else if (direction === 'down' && index < newList.length - 1) {
        [newList[index + 1], newList[index]] = [newList[index], newList[index + 1]];
      }
      return newList;
    });
  };

  const handleAddCard = () => {
    setStoryboards(prev => [...prev, { id: generateId(), description: '', script: '', imagePrompt: '', cameraPrompt: '', imageStatus: 'idle', imageUrl: '' }]);
    setTimeout(() => listEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const copyToClipboard = (text: string) => {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => sysAlert('已复制到剪贴板'))
        .catch(err => {
          console.warn('Clipboard writeText failed, using fallback:', err);
          fallbackCopyToClipboard(text);
        });
    } else {
      fallbackCopyToClipboard(text);
    }
  };

  const fallbackCopyToClipboard = (text: string) => {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      if (successful) {
        sysAlert('已复制到剪贴板');
      } else {
        sysAlert('复制失败，请手动复制');
      }
    } catch (err) {
      console.error('Fallback copy error:', err);
      sysAlert('复制失败，请手动复制');
    }
  };

  const handleGenerateImages = () => {
    setIsGeneratingImage(true);
    // 把所有卡片标为 loading
    setStoryboards(prev => prev.map(c => ({ ...c, imageStatus: 'loading' as const })));
    const total = storyboards.length;
    storyboards.forEach((card, i) => {
      setTimeout(() => {
        const colors = ['#6366f1,#a855f7', '#f59e0b,#ef4444', '#10b981,#3b82f6', '#ec4899,#8b5cf6'];
        const pick = colors[i % colors.length];
        const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='480' height='270'><defs><linearGradient id='g' x1='0%' y1='0%' x2='100%' y2='100%'><stop offset='0%' stop-color='${pick.split(',')[0]}'/><stop offset='100%' stop-color='${pick.split(',')[1]}'/></linearGradient></defs><rect width='480' height='270' fill='url(#g)'/></svg>`;
        const url = `data:image/svg+xml;base64,${btoa(svg)}`;
        setStoryboards(prev => prev.map(c => c.id === card.id ? { ...c, imageStatus: 'success', imageUrl: url } : c));
        if (i === total - 1) {
          setIsGeneratingImage(false);
          sysAlert('所有分镜图片生成成功！现在可以合成最终视频了');
        }
      }, 800 + i * 600);
    });
  };

  const handleGenerateVideo = () => {
    setIsGeneratingVideo(true);
    setTimeout(() => {
      setIsGeneratingVideo(false);
      setGeneratedVideoUrl(MOCK_VIDEO_URL);
      setVideoModal(true);
    }, 2500);
  };

  const handleExport = () => {
    if (storyboards.length === 0) {
      sysAlert('暂无内容可导出');
      return;
    }
    let textContent = `====== AI智能视频分镜脚本 ======\n需求描述：${query}\n时间：${new Date().toLocaleString()}\n================================\n\n`;
    storyboards.forEach((card, index) => {
      textContent += `【场景 ${index + 1}】\n`;
      textContent += `画面描述：${card.description}\n`;
      textContent += `解说文案：${card.script}\n`;
      textContent += `图片提示词：${card.imagePrompt}\n`;
      textContent += `视频运镜：${card.cameraPrompt}\n\n`;
    });
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `分镜脚本_${new Date().getTime()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    sysAlert('分镜脚本导出成功');
  };

  const renderTextarea = (card: StoryboardCard, field: keyof StoryboardCard, label: string, colorClass: string, placeholder: string) => (
    <div className="flex flex-col gap-1.5 relative group/ta">
      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">{label}</label>
      <div className="relative">
        <textarea
          value={card[field]}
          onChange={e => handleCardChange(card.id, field, e.target.value)}
          className={`w-full text-sm p-3 pr-8 bg-slate-50/50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:${colorClass} focus:bg-white resize-none h-14 transition-colors`}
          placeholder={placeholder}
        />
        <button
          onClick={() => copyToClipboard(card[field] ?? '')}
          className="absolute right-2 bottom-2 p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded opacity-0 group-hover/ta:opacity-100 transition-opacity"
          title="复制内容"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

  return (
    <>
    <div className="flex flex-col h-full bg-slate-50 font-sans overflow-hidden">
      {/* 区域1：顶部 - 需求输入与触发区 */}
      <div className="shrink-0 p-6 bg-white border-b border-slate-200 shadow-sm z-10 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg shadow-sm text-white">
              <Film className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 tracking-tight">AI智能视频生成</h2>
          </div>
          
          <div className="flex items-center gap-2">
            <button onClick={handleManualSave} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-md flex items-center gap-1.5 transition-colors">
              <Save className="w-4 h-4" /> 自动保存中
            </button>
            {storyboards.length > 0 && !isAnalyzing && (
              <button onClick={handleAnalyze} className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-md flex items-center gap-1.5 transition-colors font-semibold">
                <RotateCcw className="w-4 h-4" /> 重新生成
              </button>
            )}
          </div>
        </div>
        
        <div className="flex flex-col gap-2 relative" ref={historyRef}>
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-slate-700">视频生成需求 / 标题</label>
            <span className="text-xs text-slate-400">{query.length} / 500</span>
          </div>
          <div className="flex flex-col lg:flex-row gap-4 relative">
            <div className="relative flex-1">
              <textarea
                value={query}
                onChange={e => setQuery(e.target.value.slice(0, 500))}
                onFocus={() => setShowHistory(true)}
                placeholder="请输入视频标题或生成描述，例：海外美妆博主开箱国货遮瑕爆款短视频"
                className="w-full min-h-[80px] p-3 pr-10 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-y transition-shadow"
              />
              {query && (
                <button onClick={() => setQuery('')} className="absolute right-3 top-3 p-1 text-slate-400 hover:bg-slate-200 rounded-full transition-colors" title="清空">
                  <X className="w-4 h-4" />
                </button>
              )}
              
              {/* 历史需求下拉列表 */}
              {showHistory && history.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 shadow-xl rounded-xl overflow-hidden z-50">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 flex items-center gap-1">
                    <History className="w-3.5 h-3.5" /> 历史生成需求
                  </div>
                  <ul className="max-h-48 overflow-y-auto">
                    {history.map((item, idx) => (
                      <li 
                        key={idx}
                        className="px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 cursor-pointer truncate transition-colors border-b border-slate-50 last:border-0"
                        onClick={() => { setQuery(item); setShowHistory(false); }}
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {isAnalyzing ? (
              <button onClick={stopTask} className="shrink-0 self-end lg:self-stretch px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all min-w-[240px] bg-red-50 text-red-600 hover:bg-red-100 border border-red-200">
                <Loader2 className="w-5 h-5 animate-spin" /> 终止任务
              </button>
            ) : (
              <button onClick={handleAnalyze} className="shrink-0 self-end lg:self-stretch px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all min-w-[240px] shadow-sm bg-blue-600 text-white hover:bg-blue-700 hover:shadow-blue-500/20">
                <Sparkles className="w-5 h-5" /> B站热门视频智能生成分镜
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 区域2：中间 - 分镜结果展示区 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 relative">
        <div className="max-w-5xl mx-auto flex flex-col h-full">
          <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center justify-between">
            <span className="flex items-center gap-2">
              分镜脚本详情
              {storyboards.length > 0 && (
                <span className="text-xs font-normal px-2 py-0.5 bg-blue-100 text-blue-700 rounded-md">
                  共 {storyboards.length} 幕
                </span>
              )}
            </span>
          </h3>
          
          {storyboards.length === 0 ? (
            <div className="flex-1 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-400 gap-3 bg-white/50 min-h-[300px]">
              {isAnalyzing ? (
                <>
                  <RefreshCw className="w-8 h-8 animate-spin text-blue-400" />
                  <p>AI 正在深度思考分镜脚本，请稍候...</p>
                </>
              ) : (
                <>
                  <Film className="w-10 h-10 text-slate-300" />
                  <p>请输入需求并触发分析，生成分镜脚本</p>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-6 pb-20">
              {storyboards.map((card, index) => {
                const isCollapsed = collapsedCards.has(card.id);
                return (
                  <div key={card.id} className="bg-white rounded-xl shadow-sm border border-slate-200 hover:border-blue-300 transition-colors group overflow-hidden">
                    {/* Card Header */}
                    <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
                      <span className="font-bold text-slate-700 flex items-center gap-2 cursor-pointer select-none" onClick={() => toggleCollapse(card.id)}>
                        <div className="w-6 h-6 rounded-md bg-slate-800 text-white flex items-center justify-center text-xs">
                          {index + 1}
                        </div>
                        场景 {index + 1}
                        {isCollapsed ? <ChevronDown className="w-4 h-4 text-slate-400 ml-1" /> : <ChevronUp className="w-4 h-4 text-slate-400 ml-1" />}
                      </span>
                      <div className="flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => moveCard(index, 'up')} disabled={index === 0} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md disabled:opacity-30 disabled:hover:bg-transparent" title="上移">
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button onClick={() => moveCard(index, 'down')} disabled={index === storyboards.length - 1} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md disabled:opacity-30 disabled:hover:bg-transparent" title="下移">
                          <ChevronDown className="w-4 h-4" />
                        </button>
                        <div className="w-px h-4 bg-slate-200 mx-1" />
                        <button onClick={() => handleResetCard(card.id)} className="p-1.5 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded-md" title="清空该卡片内容">
                          <RotateCcw className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleCopyCard(card, index)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md" title="复制此场景">
                          <Copy className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDeleteCard(card.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md" title="删除">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    
                    {/* Card Body: 左右双栏 */}
                    {!isCollapsed && (
                      <div className="flex min-h-[280px]">
                        {/* 左栏：文本区 65% */}
                        <div className="flex-[65] p-4 flex flex-col gap-3 min-w-0">
                          {renderTextarea(card, 'description', '场景描述', 'ring-blue-500', '输入镜头画面描述...')}
                          {renderTextarea(card, 'script', '解说文案', 'ring-blue-500', '输入人物台词或旁白...')}
                          {renderTextarea(card, 'imagePrompt', '分镜图片提示词 (Image Prompt)', 'ring-purple-500', 'Midjourney / Stable Diffusion Prompt...')}
                          {renderTextarea(card, 'cameraPrompt', '视频运镜提示词 (Video Prompt)', 'ring-emerald-500', 'Runway / Sora Camera Prompt...')}
                        </div>

                        {/* 分隔线 */}
                        <div className="w-px bg-slate-100 shrink-0 my-3" />

                        {/* 右栏：图片预览区 35% */}
                        <div className="flex-[35] p-4 flex flex-col gap-3 shrink-0">
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">场景{index + 1} 分镜预览</p>

                          {/* 16:9 预览框 */}
                          <div className="w-full aspect-video rounded-lg border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center relative">
                            {!card.imageStatus || card.imageStatus === 'idle' ? (
                              <div className="flex flex-col items-center gap-2 text-slate-400 text-center px-2">
                                <ImageIcon className="w-7 h-7 text-slate-300" />
                                <p className="text-xs">点击下方按钮生成分镜图片</p>
                              </div>
                            ) : card.imageStatus === 'loading' ? (
                              <div className="flex flex-col items-center gap-2 text-slate-400">
                                <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
                                <p className="text-xs">生成中...</p>
                              </div>
                            ) : card.imageStatus === 'success' ? (
                              <img
                                src={card.imageUrl}
                                alt={`场景${index + 1}分镜`}
                                className="w-full h-full object-cover cursor-zoom-in hover:opacity-90 transition-opacity"
                                onClick={() => handlePreviewImage(card.imageUrl!)}
                              />
                            ) : (
                              <div className="flex flex-col items-center gap-2 text-red-400 text-center px-2">
                                <X className="w-6 h-6" />
                                <p className="text-xs cursor-pointer hover:underline" onClick={() => handleRedrawCard(card.id)}>生成失败，点击重试</p>
                              </div>
                            )}
                          </div>

                          {/* 操作按钮组 */}
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleRedrawCard(card.id)}
                              disabled={storyboards.length === 0 || isGeneratingImage || card.imageStatus === 'loading'}
                              className={`flex-1 py-1.5 text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 transition-all ${
                                storyboards.length === 0 || isGeneratingImage || card.imageStatus === 'loading'
                                  ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                                  : 'bg-white border border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-600'
                              }`}
                            >
                              {card.imageStatus === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                              单独重绘
                            </button>
                            <button
                              onClick={() => handlePreviewImage(card.imageUrl!)}
                              disabled={card.imageStatus !== 'success'}
                              className={`flex-1 py-1.5 text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 transition-all ${
                                card.imageStatus !== 'success'
                                  ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                                  : 'bg-white border border-slate-200 text-slate-600 hover:border-purple-300 hover:text-purple-600'
                              }`}
                            >
                              <Sparkles className="w-3 h-3" /> 放大查看
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              
              <button 
                onClick={handleAddCard}
                className="w-full py-4 border-2 border-dashed border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 rounded-xl text-slate-500 hover:text-blue-600 font-bold flex items-center justify-center gap-2 transition-all"
              >
                <Plus className="w-5 h-5" /> 手动添加新场景
              </button>
              
              <div ref={listEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* 区域3：底部 - 最终生成操作区 */}
      <div className="shrink-0 bg-white border-t border-slate-200 p-4 shadow-[0_-10px_30px_-15px_rgba(0,0,0,0.05)] z-20">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          
          <button
            onClick={handleExport}
            className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-800 rounded-lg flex items-center gap-2 transition-colors border border-transparent"
          >
            <Download className="w-4 h-4" /> 导出分镜脚本 (TXT)
          </button>

          <div className="flex items-center gap-4">
            <button
              onClick={handleGenerateImages}
              disabled={storyboards.length === 0 || isGeneratingImage || isGeneratingVideo}
              className={`px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all border ${
                storyboards.length === 0 || isGeneratingImage || isGeneratingVideo 
                  ? 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'
                  : 'bg-white hover:bg-blue-50 border-blue-200 text-blue-600 shadow-sm hover:shadow'
              }`}
            >
              {isGeneratingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
              {imageGenerated ? '重新生图' : '生成分镜图片'}
            </button>
            
            <button
              onClick={handleGenerateVideo}
              disabled={!imageGenerated || storyboards.length === 0 || isGeneratingVideo || isGeneratingImage}
              className={`px-8 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all shadow-md ${
                !imageGenerated || storyboards.length === 0 || isGeneratingVideo || isGeneratingImage
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                  : 'bg-blue-600 hover:bg-blue-700 text-white hover:shadow-blue-500/30'
              }`}
            >
              {isGeneratingVideo ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> 视频合成中...</>
              ) : (
                <><Video className="w-5 h-5" /> 生成最终视频</>
              )}
            </button>

            {/* 视频已生成时显示查看按钮 */}
            {generatedVideoUrl && !isGeneratingVideo && (
              <button
                onClick={() => setVideoModal(true)}
                className="px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-all bg-emerald-600 hover:bg-emerald-700 text-white shadow-md hover:shadow-emerald-500/30"
              >
                <Video className="w-5 h-5" /> 查看视频结果
              </button>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* 图片放大预览弹窗 */}
    {imageModal.visible && (
      <div
        className="fixed inset-0 z-[9999] bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm"
        onClick={() => setImageModal({ visible: false, url: '' })}
      >
        <div className="relative max-w-4xl w-full" onClick={e => e.stopPropagation()}>
          <img src={imageModal.url} alt="分镜预览" className="w-full rounded-xl shadow-2xl" />
          <div className="absolute top-3 right-3 flex gap-2">
            <a
              href={imageModal.url}
              download="storyboard.png"
              className="p-2 bg-white/90 hover:bg-white rounded-lg shadow-lg transition-colors"
              title="下载图片"
            >
              <Download className="w-5 h-5 text-slate-700" />
            </a>
            <button
              onClick={() => setImageModal({ visible: false, url: '' })}
              className="p-2 bg-white/90 hover:bg-white rounded-lg shadow-lg transition-colors"
            >
              <X className="w-5 h-5 text-slate-700" />
            </button>
          </div>
        </div>
      </div>
    )}

    {/* 视频预览弹窗 */}
    {videoModal && generatedVideoUrl && (
      <div
        className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm"
        onClick={() => setVideoModal(false)}
      >
        <div className="relative max-w-4xl w-full bg-black rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
          {/* 标题栏 */}
          <div className="flex items-center justify-between px-5 py-3 bg-slate-900">
            <div className="flex items-center gap-2">
              <Film className="w-4 h-4 text-indigo-400" />
              <span className="text-white font-semibold text-sm">视频生成结果预览</span>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={generatedVideoUrl}
                download="generated_video.mp4"
                className="px-3 py-1.5 text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-white rounded-lg flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> 下载视频
              </a>
              <button
                onClick={() => setVideoModal(false)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* 播放器 */}
          <video
            src={generatedVideoUrl}
            controls
            autoPlay
            className="w-full aspect-video bg-black"
            style={{ maxHeight: '70vh' }}
          />

          {/* 补充信息栏 */}
          <div className="px-5 py-3 bg-slate-900 flex items-center justify-between text-xs text-slate-400">
            <span>请求描述：{query || '未输入'}</span>
            <span>生成时间：{new Date().toLocaleString()}</span>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

