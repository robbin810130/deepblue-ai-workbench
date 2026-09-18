import React, { useState, useRef, useEffect } from 'react';
import {
  Upload, Copy, FileDown,
  Plus, Trash2, FileAudio, Loader2, CheckCircle2,
  ClipboardList, Clock, ChevronDown, ChevronUp
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { sysAlert } from '../utils/dialog';
import { AudioProcessor } from '../utils/audioProcessor';

interface HistoryItem {
  id: string;
  filename: string;
  time: string;
  originalText: string;
  minutes: string;
  stats?: {
    originalSize: number;
    compressedSize: number;
  }
}

export const MeetingMinutes: React.FC = () => {
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'processing' | 'summarizing' | 'completed' | 'error'>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isTransExpanded, setIsTransExpanded] = useState(false);
  const resultContainerRef = useRef<HTMLDivElement>(null);

  const [currentResult, setCurrentResult] = useState<{
    filename: string;
    originalText: string;
    minutes: string;
    stats?: {
      originalSize: number;
      compressedSize: number;
    }
  }>({
    filename: '',
    originalText: '',
    minutes: ''
  });

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const token = localStorage.getItem('blue_os_token')?.trim().replace(/^["']|["']$/g, '');

  // ── localStorage 持久化工具函数 ──────────────────────────────────
  const LS_KEY = 'mm_history_cache';

  const lsGetHistory = (): HistoryItem[] => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
  };
  const lsSaveHistory = (items: HistoryItem[]) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(items)); } catch { }
  };
  const lsAddItem = (item: HistoryItem) => {
    const items = lsGetHistory().filter(i => i.id !== item.id);
    lsSaveHistory([item, ...items].slice(0, 50)); // 最多保留50条
  };
  const lsRemoveItem = (id: string) => {
    lsSaveHistory(lsGetHistory().filter(i => i.id !== id));
  };

  // 1. 初始化拉取历史记录：DB 优先，失败则用 localStorage
  useEffect(() => {
    const loadHistory = async () => {
      // 先用 localStorage 快速填充，避免白屏
      const cached = lsGetHistory();
      if (cached.length > 0) setHistory(cached);

      try {
        const res = await fetch('/api/meeting-minutes/history', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.success && Array.isArray(data.history)) {
          if (data.history.length > 0) {
            setHistory(data.history);
            lsSaveHistory(data.history); // 同步更新 localStorage 缓存
          }
          // 若 DB 返回空但 localStorage 有数据，保留 localStorage 的（说明 DB 同步可能滞后）
        }
      } catch (err) {
        console.warn('[Load History] DB 加载失败，使用本地缓存:', err);
        // 已在上方用 localStorage 填充，无需额外操作
      }
    };
    loadHistory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 直接开始处理，跳过任何压缩逻辑
    startProcessing(file.name, file, {
      originalSize: file.size,
      compressedSize: file.size
    });
  };

  const uploadFileWithProgress = (file: Blob, filename: string): Promise<{ fileName: string }> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('file', file, filename);

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(percent);
        }
      });

      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch (e) {
              reject(new Error('解析响应失败'));
            }
          } else {
            reject(new Error(`上传失败: HTTP ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => reject(new Error('网络请求异常'));

      const isViteProxy = window.location.port === '8081';
      const backendUrl = isViteProxy
        ? `http://${window.location.hostname}:3001/api/meeting-minutes/upload`
        : '/api/meeting-minutes/upload';

      xhr.open('POST', backendUrl);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });
  };

  const startProcessing = async (filename: string, fileBlob: Blob, stats?: any) => {
    setUploadState('uploading');
    setUploadProgress(0);
    setCurrentResult({ filename, originalText: '', minutes: '', stats });

    try {
      // 1. 上传文件
      const uploadData = await uploadFileWithProgress(fileBlob, filename);
      const serverFileName = uploadData.fileName;
      console.log(`[DashScope] File uploaded: ${serverFileName}`);

      // 2. 创建任务
      setUploadState('processing');
      const createResponse = await fetch('/api/meeting-minutes/chat', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fileName: serverFileName, originalName: filename })
      });

      if (!createResponse.ok) {
        const errData = await createResponse.json();
        throw new Error(errData.error || '提交异步识别任务失败');
      }

      const { taskId } = await createResponse.json();
      console.log(`[DashScope] Task created: ${taskId}`);

      // 3. 轮询结果
      let isDone = false;
      const POLLING_INTERVAL = 5000;

      while (!isDone) {
        await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
        const statusRes = await fetch(`/api/meeting-minutes/status/${taskId}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!statusRes.ok) continue;

        const data = await statusRes.json();
        const { status, transcription, message } = data;
        console.log(`[DashScope] Task status: ${status}`);

        if (status === 2) { // 转写成功
          isDone = true;
          const transcriptionText = transcription || '转写完成，无文本内容';

          // --- 第一阶段：更新原文并显示 [NEW] ---
          setCurrentResult(prev => ({
            ...prev,
            originalText: transcriptionText,
            filename // 确保文件名保持
          }));
          setUploadState('summarizing'); // 切换到摘要生成状态

          // --- 第二阶段：发起 Dify 摘要请求 [NEW] ---
          try {
            const sumRes = await fetch('/api/meeting-minutes/summarize', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${localStorage.getItem('blue_os_token')?.trim().replace(/^["']|["']$/g, '')}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ originalText: transcriptionText })
            });

            const sumData = await sumRes.json();

            // --- 最终阶段：更新纪要并完成 ---
            const finalMinutes = sumData.minutes || '未能生成纪要内容';
            const finalResult = {
              filename,
              originalText: transcriptionText,
              minutes: finalMinutes,
              stats
            };

            setCurrentResult(finalResult);
            setUploadState('completed');
            window.dispatchEvent(new CustomEvent('app-task-done', { detail: { appId: 'doccopywriting' } }));

            const newId = Math.random().toString(36).substr(2, 9);
            const newItem: HistoryItem = {
              id: newId,
              time: new Date().toLocaleString(),
              ...finalResult
            };

            // --- 第三阶段：保存至数据库（检查响应，确保真正持久化） ---
            try {
              const saveRes = await fetch('/api/meeting-minutes/history/save', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${localStorage.getItem('blue_os_token')?.trim().replace(/^[\"']|[\"']$/g, '')}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  id: newId,
                  filename,
                  originalText: transcriptionText,
                  minutes: finalMinutes
                })
              });
              if (!saveRes.ok) {
                console.error('[Save History Failed] HTTP', saveRes.status, await saveRes.text());
              }
            } catch (saveErr) {
              console.error('[Save History Error]', saveErr);
            }

            // 先写入 localStorage（即使 DB 失败也不会丢失）
            lsAddItem(newItem);
            setHistory(prev => [newItem, ...prev]);
            setSelectedHistoryId(newItem.id);
          } catch (sumErr: any) {
            console.error('[Summary Error]', sumErr);
            // 摘要失败：仍保存原文记录到数据库，避免刷新后历史丢失
            const errorMinutes = '生成摘要时出错，请重试。';
            setCurrentResult(prev => ({ ...prev, minutes: errorMinutes }));
            setUploadState('completed');

            const newId = Math.random().toString(36).substr(2, 9);
            const newItem: HistoryItem = {
              id: newId,
              time: new Date().toLocaleString(),
              filename,
              originalText: transcriptionText,
              minutes: errorMinutes,
              stats
            };
            try {
              await fetch('/api/meeting-minutes/history/save', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${localStorage.getItem('blue_os_token')?.trim().replace(/^[\"']|[\"']$/g, '')}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ id: newId, filename, originalText: transcriptionText, minutes: errorMinutes })
              });
            } catch (saveErr) {
              console.error('[Save History Error in catch]', saveErr);
            }
            // 先写入 localStorage（即使 DB 失败也不会丢失）
            lsAddItem(newItem);
            setHistory(prev => [newItem, ...prev]);
            setSelectedHistoryId(newItem.id);
          }
          return;
        } else if (status === 3) { // 失败
          throw new Error(message || '语音识别任务执行失败');
        }
      }
    } catch (error: any) {
      console.error('Processing Error:', error);
      sysAlert(`处理失败: ${error.message}`);
      setUploadState('idle');
    }
  };

  const handleRestart = () => {
    setUploadState('idle');
    setUploadProgress(0);
    if (uploadInputRef.current) uploadInputRef.current.value = '';
  };

  const handleClear = () => {
    setCurrentResult({ filename: '', originalText: '', minutes: '' });
    setSelectedHistoryId(null);
    if (uploadState === 'completed') setUploadState('idle');
  };

  const handleCopy = (text: string) => {
    if (!text) return;
    
    // Modern API (HTTPS or localhost)
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        sysAlert('已复制到剪贴板');
      }).catch((err) => {
        console.error('复制失败', err);
        fallbackCopyTextToClipboard(text);
      });
    } else {
      // Fallback for HTTP environments
      fallbackCopyTextToClipboard(text);
    }
  };

  const fallbackCopyTextToClipboard = (text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      const successful = document.execCommand('copy');
      if (successful) {
        sysAlert('已使用兼容模式复制到剪贴板');
      } else {
        sysAlert('当前浏览器不支持快捷复制，请手动选中复制');
      }
    } catch (err) {
      console.error('Fallback verify copy failed', err);
      sysAlert('复制操作遭遇系统拦截，请手动复制');
    }
    document.body.removeChild(textArea);
  };

  const handleDeleteHistory = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    // 立即从 localStorage 和 UI 移除，保证体验流畅
    lsRemoveItem(id);
    setHistory(prev => prev.filter(item => item.id !== id));
    if (selectedHistoryId === id) handleClear();
    // 异步同步到 DB
    try {
      await fetch(`/api/meeting-minutes/history/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (err) {
      console.error('[Delete Error]', err);
    }
  };

  const handleSelectHistory = (item: HistoryItem) => {
    setSelectedHistoryId(item.id);
    setCurrentResult({
      filename: item.filename,
      originalText: item.originalText,
      minutes: item.minutes,
      stats: item.stats
    });
    setUploadState('completed');
  };

  const handleExport = async () => {
    if (!currentResult.minutes || isExporting) return;

    setIsExporting(true);
    try {
      const res = await fetch('/api/meeting-minutes/export', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          minutes: currentResult.minutes,
          filename: currentResult.filename.replace(/\.[^/.]+$/, "") + "_会议纪要.docx"
        })
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.message || '导出失败');
      }

      // 触发下载 (使用 fetch 携带鉴权头并转换为 Blob 下载)
      const downloadName = data.filename || (currentResult.filename.replace(/\.[^/.]+$/, "") + "_会议纪要.docx");
      const proxyUrl = `/api/meeting-minutes/download-proxy?url=${encodeURIComponent(data.downloadUrl)}&filename=${encodeURIComponent(downloadName)}`;

      const downloadRes = await fetch(proxyUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!downloadRes.ok) throw new Error('下载文件失败，请重试');

      const blob = await downloadRes.blob();
      const blobUrl = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = downloadName; // 此时 blobUrl 是本地的，download 属性将生效
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl); // 释放内存

      sysAlert('导出成功，请在浏览器下载栏查看');
    } catch (err: any) {
      console.error('[Export Error]', err);
      sysAlert(`导出失败: ${err.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex h-full p-4 gap-4 bg-slate-100/50 overflow-hidden font-sans">
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .shimmer-bar {
          background: linear-gradient(90deg, #3b82f6 0%, #60a5fa 50%, #3b82f6 100%);
          background-size: 200% 100%;
          animation: shimmer 2s infinite linear;
        }
      `}</style>

      {/* LEFT: Upload Console */}
      <div className="flex-[3] min-w-[300px] max-w-[400px] h-full">
        <div className="h-full bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col p-6 overflow-y-auto">
          <div className="mb-8">
            <h2 className="text-xl font-bold text-slate-800">录音转写</h2>
          </div>

          <div className="flex-1 flex flex-col justify-center">
            {uploadState === 'idle' && (
              <div
                onClick={() => uploadInputRef.current?.click()}
                className="group border-2 border-dashed border-slate-200 rounded-3xl p-10 flex flex-col items-center justify-center gap-4 cursor-pointer hover:border-blue-500 hover:bg-blue-50/30 transition-all duration-300"
              >
                <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <Upload className="w-8 h-8 text-slate-400 group-hover:text-blue-500" />
                </div>
                <div className="text-center">
                  <p className="text-base font-medium text-slate-600 group-hover:text-blue-600 transition-colors">点击或拖拽上传会议录音</p>
                  <p className="text-xs text-slate-400 mt-2">支持 mp3 / wav / m4a 等格式</p>
                </div>
                <input
                  type="file"
                  ref={uploadInputRef}
                  onChange={handleFileUpload}
                  accept=".mp3,.wav,.m4a"
                  className="hidden"
                />
              </div>
            )}

            {uploadState === 'uploading' && (
              <div className="space-y-6 p-6 bg-blue-50/50 rounded-[2.5rem] border border-blue-100">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-blue-700 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    文件上传中...
                  </span>
                  <span className="text-2xl font-black text-blue-600">{uploadProgress}%</span>
                </div>
                <div className="h-3 bg-slate-200/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {uploadState === 'processing' && (
              <div className="mt-4 flex flex-col items-center justify-center gap-6 p-8 bg-indigo-50/50 rounded-[2.5rem] border border-indigo-100">
                <div className="relative w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-sm">
                  <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                </div>
                <div className="text-center space-y-3">
                  <h3 className="text-base font-bold text-indigo-900">AI 智能识别中</h3>
                  <div className="space-y-1">
                    <p className="text-[11px] text-indigo-400 font-medium">正在通过大模型解析语音波形...</p>
                    <p className="text-[11px] text-amber-600 font-bold bg-amber-50 px-3 py-1 rounded-full border border-amber-100/50">
                      温馨提示：录音转写可能需要 5~10 分钟，请耐心等待，完成后将自动为您展示
                    </p>
                  </div>
                </div>
              </div>
            )}

            {uploadState === 'completed' && (
              <div className="flex flex-col items-center justify-center gap-6 py-6 text-center">
                <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                </div>
                <div className="space-y-1 text-center">
                  <h3 className="text-lg font-bold text-slate-800">识别已完成</h3>
                  <button
                    onClick={handleRestart}
                    className="mt-6 px-10 py-3 rounded-2xl bg-blue-500 text-white font-bold hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/25 flex items-center gap-2 mx-auto"
                  >
                    <Plus className="w-5 h-5" /> 重新上传
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MIDDLE: Result Area */}
      <div className="flex-[5] min-w-[500px] h-full flex flex-col gap-4">
        <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
          <div
            ref={resultContainerRef}
            className="flex-1 overflow-y-auto p-8 space-y-8 scroll-smooth"
          >
            {currentResult.filename ? (
              <>
                <section className="relative">
                  {/* Sticky Header - Solid BG and proper alignment to close gaps */}
                  <div className="sticky -top-8 z-20 bg-white -mx-8 px-8 py-4 mb-2 flex items-center justify-between transition-all border-b border-slate-100/50 shadow-sm shadow-slate-200/5">
                    <div
                      onClick={() => {
                        if (isTransExpanded && resultContainerRef.current) {
                          resultContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                        setIsTransExpanded(!isTransExpanded);
                      }}
                      className="flex items-center gap-3 cursor-pointer group"
                    >
                      <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                          <ClipboardList className="w-4 h-4 text-blue-500" />
                        </div>
                        原始转写文本
                      </h3>
                      {isTransExpanded ? (
                        <ChevronUp className="w-4 h-4 text-slate-400 group-hover:text-blue-500 transition-colors" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-blue-500 transition-colors" />
                      )}
                    </div>
                    <button
                      onClick={() => handleCopy(currentResult.originalText)}
                      className="px-4 py-2 bg-slate-50 hover:bg-slate-100 rounded-xl text-xs font-bold text-slate-500 flex items-center gap-2 transition-all active:scale-95"
                    >
                      <Copy className="w-3.5 h-3.5" /> 复制
                    </button>
                  </div>

                  {isTransExpanded && (
                    <div className="bg-slate-50/50 rounded-2xl p-6 border border-slate-100 text-slate-600 text-[15px] leading-relaxed whitespace-pre-wrap animate-in fade-in slide-in-from-top-4 duration-500">
                      {currentResult.originalText || '等待结果中...'}
                    </div>
                  )}
                </section>

                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                      <ClipboardList className="w-5 h-5 text-emerald-500" />
                      会议纪要
                    </h3>
                  </div>
                  <div className="bg-white border-2 border-slate-100 rounded-2xl p-8 text-left">
                    {uploadState === 'summarizing' ? (
                      <div className="flex flex-col items-center gap-4 py-8 text-center">
                        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                        <p className="text-emerald-600 font-bold animate-pulse text-sm">AI 正在深度整理会议纪要...</p>
                        <p className="text-slate-400 text-xs">进度：原文已就绪，正在分析关键决策与后续待办</p>
                      </div>
                    ) : (
                      <div className="prose prose-slate prose-sm max-w-none prose-headings:text-slate-800 prose-headings:font-black prose-p:text-slate-600 prose-strong:text-emerald-600 prose-table:border prose-table:rounded-xl overflow-hidden">
                        {currentResult.minutes ? (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {currentResult.minutes}
                          </ReactMarkdown>
                        ) : (
                          <p className="text-slate-400 font-medium italic text-center">
                            等待摘要生成中...
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-6 py-20">
                <FileAudio className="w-20 h-20 opacity-10" />
                <p className="text-lg font-bold opacity-30">请在左侧上传音频文件</p>
              </div>
            )}
          </div>

          <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              {currentResult.filename && (
                <span className="text-xs font-bold text-slate-400 bg-white px-3 py-1.5 rounded-full border border-slate-200">
                  当前文件：{currentResult.filename} ({AudioProcessor.formatSize(currentResult.stats?.originalSize || 0)})
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={handleClear} className="px-4 py-2 text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors">清空</button>
              <button
                disabled={!currentResult.minutes || isExporting}
                onClick={handleExport}
                className="px-6 py-2 bg-slate-800 text-white text-sm font-bold rounded-xl hover:bg-slate-900 transition-all flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    导出中...
                  </>
                ) : (
                  <>
                    <FileDown className="w-4 h-4" /> 导出结果
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT: History */}
      <div className="flex-[2] min-w-[200px] h-full">
        <div className="h-full bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
          <div className="p-5 border-b border-slate-100 font-bold text-slate-800 flex items-center justify-between">
            最近记录
            <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded-md text-slate-400">{history.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {history.map(item => (
              <div
                key={item.id}
                onClick={() => handleSelectHistory(item)}
                className={`p-3 rounded-xl border-2 transition-all cursor-pointer group ${selectedHistoryId === item.id ? 'border-blue-500 bg-blue-50' : 'border-transparent bg-slate-50 hover:bg-white hover:border-slate-100'}`}
              >
                <div className="flex justify-between items-start">
                  <p className="text-sm font-bold text-slate-700 truncate flex-1">{item.filename}</p>
                  <button onClick={(e) => handleDeleteHistory(e, item.id)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-400 font-medium">
                  <Clock className="w-3 h-3" /> {item.time}
                </div>
              </div>
            ))}
            {history.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center py-20 opacity-20"><Clock className="w-10 h-10 mb-2" /><p className="text-xs font-bold">无记录</p></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
