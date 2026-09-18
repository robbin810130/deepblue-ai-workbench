import React, { useState, useEffect } from 'react';
import { Search, BrainCircuit, AlertCircle, Loader2, Target, Calendar, Flame, PieChart, Tag, Lightbulb, Zap, BarChart3, LineChart } from 'lucide-react';
import { AI_MARKET_INSIGHT_RUN_ENDPOINT } from '../config';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { fetchWithAuth } from '../utils/authFetch';
import { useConfig } from '../hooks/useConfig';
import { sysAlert } from '../utils/dialog';

// --- 表单配置数据 ---
const INSIGHT_FORM_CONFIG = {
  categories: ['口红', '粉饼', '粉底液', '眼影', '面膜', '精华', '卸妆产品'],
  timeRanges: ['近 7 天', '近 30 天', '近 90 天']
};

// --- 日期选择子组件 ---
const DateSelector = ({ label, value, onChange, disabled }: any) => {
  const years = Array.from({ length: 11 }, (_, i) => 2020 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const days = Array.from({ length: 31 }, (_, i) => i + 1);

  return (
    <div className={`flex flex-col gap-1.5 flex-1 min-w-0 transition-opacity duration-300 ${disabled ? 'opacity-70' : 'opacity-100'}`}>
      <span className="text-xs uppercase font-bold text-slate-400 ml-1">{label}</span>
      <div className="grid grid-cols-[5fr_4fr_4fr] gap-1.5 px-0.5">
        <select
          disabled={disabled}
          value={value.y}
          onChange={(e) => onChange({ ...value, y: e.target.value })}
          className={`text-sm h-9 pl-1 pr-1 bg-slate-50 border border-slate-200 rounded-lg outline-none transition-all shadow-sm font-medium ${disabled ? 'cursor-not-allowed text-slate-400 bg-slate-50/50' : 'cursor-pointer focus:border-blue-400 focus:bg-white'}`}
        >
          {years.map(y => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select
          disabled={disabled}
          value={value.m}
          onChange={(e) => onChange({ ...value, m: e.target.value })}
          className={`text-sm h-9 pl-1 pr-1 bg-slate-50 border border-slate-200 rounded-lg outline-none transition-all shadow-sm font-medium ${disabled ? 'cursor-not-allowed text-slate-400 bg-slate-50/50' : 'cursor-pointer focus:border-blue-400 focus:bg-white'}`}
        >
          {months.map(m => <option key={m} value={m}>{m}月</option>)}
        </select>
        <select
          disabled={disabled}
          value={value.d}
          onChange={(e) => onChange({ ...value, d: e.target.value })}
          className={`text-sm h-9 pl-1 pr-1 bg-slate-50 border border-slate-200 rounded-lg outline-none transition-all shadow-sm font-medium ${disabled ? 'cursor-not-allowed text-slate-400 bg-slate-50/50' : 'cursor-pointer focus:border-blue-400 focus:bg-white'}`}
        >
          {days.map(d => <option key={d} value={d}>{d}日</option>)}
        </select>
      </div>
    </div>
  );
};

// --- 结果模块解析器 ---
const parseMarkdownSections = (text: string) => {
  const sections: Record<string, string> = {};
  const keywords = [
    { key: 'heat', title: '行业热度' },
    { key: 'trends', title: '搜索 / 关注变化' },
    { key: 'hotWords', title: '今日热词' },
    { key: 'risingWords', title: '今日飙升词' },
    { key: 'categories', title: '热门品类' },
    { key: 'price', title: '价格趋势' },
    { key: 'opportunity', title: '一句话机会总结' }
  ];

  // 1. 提取顶部的核心数据表格 (即使是在流式加载中的半行也能稳健捕获)
  const tableRegex = /((?:^[ \t]*\|.*\n?)+)/m;
  const tableMatch = text.match(tableRegex);
  if (tableMatch) {
    sections['summaryTable'] = tableMatch[1].trim();
  }

  // 2. 提取各个业务模块
  keywords.forEach(({ key, title }) => {
    const regex = new RegExp(`(?:#+\\s*|\\*+|\\d+\\.\\s*|^)\\s*${title}[：:]?\\s*([\\s\\S]*?)(?=\\n(?:#+\\s*|\\*+|\\d+\\.\\s*|^)\\s*(?:${keywords.map(k => k.title).join('|')})|$)`, 'im');
    const match = text.match(regex);
    if (match && match[1]) {
      sections[key] = match[1].trim();
    }
  });

  return sections;
};

// --- 结果卡片子组件 ---
const InsightCard = ({ icon: Icon, title, content, colorClass, delay }: any) => {
  if (!content) return null;
  return (
    <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm p-5 hover:shadow-md transition-all animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both`} style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center gap-3 mb-4">
        <div className={`p-2 rounded-xl ${colorClass}`}>
          <Icon className="w-5 h-5" />
        </div>
        <h4 className="font-bold text-slate-800 text-sm">{title}</h4>
      </div>
      <div className="prose prose-slate prose-sm max-w-none prose-p:leading-relaxed prose-strong:text-blue-600 prose-li:my-0">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
};

// --- 自定义 Markdown 渲染组件 (提取到外部避免流式渲染时由于引用变化导致 DOM 闪烁重绘) ---
const MarkdownComponents = {
  table: ({ children }: any) => (
    <table className="w-full border-collapse text-left m-0">{children}</table>
  ),
  thead: ({ children }: any) => (
    <thead>
      {/* 全局大标题行 */}
      <tr className="bg-slate-900 border-b border-slate-800">
        <th colSpan={3} className="px-8 py-5 text-base font-black text-white tracking-[0.3em] text-center border-0">
          <div className="flex items-center justify-center gap-3">
            <BarChart3 className="w-5 h-5 text-blue-400" />
            <span>核心数据维度概览</span>
          </div>
        </th>
      </tr>
      {/* 对原表头行（即 children）进行样式注入 */}
      {React.Children.map(children, (child: any) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as any, {
            className: "bg-gradient-to-r from-blue-600 to-indigo-600 border-b border-blue-700"
          });
        }
        return child;
      })}
    </thead>
  ),
  th: ({ children }: any) => (
    <th className="px-6 py-6 text-sm font-black text-white uppercase tracking-[0.25em] border-r border-white/10 last:border-0">
      {children}
    </th>
  ),
  td: ({ children }: any) => {
    const highlightNumbers = (content: any) => {
      if (typeof content !== 'string') return content;
      const regex = /((?:\+|-)?\d+(?:\.\d+)?%|\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)(?:\s*(?:元|万|亿|%))?|\d+(?:\.\d+)?\s*(?:万|亿|元|w|k|\+|万\+)|增长超\s*\d+%|约\s*\d+(?:\.\d+)?)/gi;
      const parts = content.split(regex);
      return parts.map((part, i) => {
        if (regex.test(part)) {
          if (!part.match(/\d/)) return part;
          const isPositive = part.includes('+') || (part.includes('%') && !part.includes('-'));
          return (
            <span key={i} className={`inline-flex items-center px-2 py-0.5 rounded-lg border font-mono font-black text-[1.2em] mx-0.5 shadow-sm leading-none tracking-tight ${isPositive
              ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
              : 'bg-indigo-50 text-indigo-600 border-indigo-200'
              }`}>
              {part}
            </span>
          );
        }
        return part;
      });
    };

    return (
      <td className="px-6 py-5 text-sm text-slate-700 border-b border-slate-100 border-r border-slate-50 last:border-r-0 leading-relaxed group-hover:bg-blue-50/20 transition-colors font-medium text-center first:text-left">
        {highlightNumbers(children)}
      </td>
    );
  },
  tr: ({ children, className }: any) => (
    <tr className={`transition-colors group last:border-0 border-b border-slate-100 ${className || ''}`}>
      {children}
    </tr>
  ),
};

export const MarketInsightModule = () => {
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
      requestAnimationFrame(() => {
          setTimeout(() => setIsReady(true), 50);
      });
  }, []);

  // ... (保持现有状态和逻辑)
  // --- 表单状态 ---
  const [categories, setCategories] = useState<string[]>([]);
  const [customCategory, setCustomCategory] = useState('');
  const [timeRange, setTimeRange] = useState('近 30 天');

  // --- 动态配置加载 ---
  const { data: configCategories } = useConfig<{name: string}>('product_types', 'market');
  const API_CATEGORIES = configCategories.map(c => c.name);

  // 时间范围状态
  const today = new Date();
  const lastMonth = new Date(new Date().setMonth(today.getMonth() - 1));

  const [startDate, setStartDate] = useState({
    y: lastMonth.getFullYear().toString(),
    m: (lastMonth.getMonth() + 1).toString(),
    d: lastMonth.getDate().toString()
  });
  const [endDate, setEndDate] = useState({
    y: today.getFullYear().toString(),
    m: (today.getMonth() + 1).toString(),
    d: today.getDate().toString()
  });
  const [isCustomTime, setIsCustomTime] = useState(false);

  // 当预设时间改变时，自动计算并更新具体日期
  useEffect(() => {
    if (!isCustomTime) {
      const end = new Date();
      const start = new Date();
      const daysStr = timeRange.match(/\d+/)?.[0] || '7';
      const days = parseInt(daysStr);
      start.setDate(end.getDate() - days);

      setStartDate({
        y: start.getFullYear().toString(),
        m: (start.getMonth() + 1).toString(),
        d: start.getDate().toString()
      });
      setEndDate({
        y: end.getFullYear().toString(),
        m: (end.getMonth() + 1).toString(),
        d: end.getDate().toString()
      });
    }
  }, [timeRange, isCustomTime]);

  // --- 附件及生成状态 ---
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [apiResult, setApiResult] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // 切换多选数组的工具函数
  const toggleSelection = (item: string) => {
    setCategories(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]);
  };

  const handleRunAnalysis = async () => {
    // 基本校验
    if (categories.length === 0 && !customCategory.trim()) {
      sysAlert("请至少选择或输入一个品类进行分析！");
      return;
    }

    setIsAnalyzing(true);
    setApiResult('');
    setErrorMsg('');

    try {
      const pad = (n: string) => n.padStart(2, '0');
      const formattedCustomTime = `${startDate.y}.${pad(startDate.m)}.${pad(startDate.d)}-${endDate.y}.${pad(endDate.m)}.${pad(endDate.d)}`;

      const inputs: any = {
        "category": [...categories, ...(customCategory.trim() ? [customCategory.trim()] : [])].join(', '),
        "timeRange": isCustomTime ? formattedCustomTime : timeRange,
      };

      const payload = {
        inputs: inputs,
        response_mode: "streaming",
        user: "admin",
        files: [],
        query: "进行市场洞察分析"
      };

      const response = await fetchWithAuth(AI_MARKET_INSIGHT_RUN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error(`请求失败 (${response.status})`);
      if (!response.body) throw new Error("ReadableStream not supported");

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
            } catch (e) { console.error("解析 SSE 失败", e); }
          }
        }
      }

    } catch (error: any) {
      setErrorMsg(error.message || "分析过程中发生未知错误。");
    } finally {
      setIsAnalyzing(false);
      // 通知菜单栏：后台任务完成
      window.dispatchEvent(new CustomEvent('app-task-done', { detail: { appId: 'market' } }));
      setTimeout(() => {
        document.getElementById('result-section')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  };

  const parsedSections = React.useMemo(() => parseMarkdownSections(apiResult), [apiResult]);
  if (!isReady) return null;

  return (
    <div className="h-full flex flex-col pt-2 pb-0 px-2 min-h-0 animate-fade-in overflow-hidden gap-6">
      <div className="shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-200">
            <Search className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-800 tracking-tight">市场洞察</h2>
          </div>
        </div>
        <button
          onClick={handleRunAnalysis}
          disabled={isAnalyzing}
          className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-70 disabled:cursor-not-allowed text-white px-8 py-3 rounded-xl font-bold shadow-xl shadow-blue-200 transition-all flex items-center gap-2 transform active:scale-95"
        >
          {isAnalyzing ? <Loader2 className="animate-spin w-5 h-5" /> : <BrainCircuit className="w-5 h-5" />}
          {isAnalyzing ? '深度剖析中...' : '启动智能分析'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1 pb-0">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-8">
          {/* 品类选择 - 6列 */}
          <div className="lg:col-span-6 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-4">
            <div className="flex items-center gap-2 border-b border-slate-50 pb-3">
              <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg"><Target className="w-5 h-5" /></div>
              <h3 className="font-bold text-slate-800">产品分类选择</h3>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {API_CATEGORIES.map(opt => (
                <button
                  key={opt}
                  onClick={() => toggleSelection(opt)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all border ${categories.includes(opt)
                    ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-100'
                    : 'bg-slate-50 text-slate-600 border-slate-100 hover:bg-slate-100 hover:border-slate-300'
                    }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            <div className="relative mt-2">
              <input
                type="text"
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="没有找到您的品类？请在此输入..."
                className="w-full text-sm px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-500 focus:bg-white transition-all text-slate-700"
              />
            </div>
          </div>

          {/* 日期范围 - 6列 */}
          <div className="lg:col-span-6 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-4">
            <div className="flex items-center gap-2 border-b border-slate-50 pb-3">
              <div className="p-1.5 bg-teal-50 text-teal-600 rounded-lg"><Calendar className="w-5 h-5" /></div>
              <h3 className="font-bold text-slate-800">日期范围</h3>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {INSIGHT_FORM_CONFIG.timeRanges.map(t => (
                <button
                  key={t} onClick={() => { setTimeRange(t); setIsCustomTime(false); }}
                  className={`py-2 text-xs font-bold rounded-xl border transition-all ${timeRange === t && !isCustomTime ? 'bg-teal-600 text-white border-teal-600 shadow-md shadow-teal-100' : 'bg-slate-50 text-slate-600 border-slate-100 hover:bg-slate-100'
                    }`}
                >
                  {t}
                </button>
              ))}
              <button
                onClick={() => setIsCustomTime(true)}
                className={`py-2 text-xs font-bold rounded-xl border transition-all ${isCustomTime ? 'bg-teal-600 text-white border-teal-600 shadow-md shadow-teal-100' : 'bg-slate-50 text-slate-600 border-slate-100 hover:bg-slate-100'}`}
              >
                自定义
              </button>
            </div>
            <div className="flex items-center gap-3 mt-2 animate-in fade-in slide-in-from-top-2">
              <DateSelector
                label="开始日期"
                value={startDate}
                onChange={setStartDate}
                disabled={!isCustomTime}
              />
              <div className="text-slate-300 mt-6 shrink-0 font-light">—</div>
              <DateSelector
                label="结束日期"
                value={endDate}
                onChange={setEndDate}
                disabled={!isCustomTime}
              />
            </div>
          </div>
        </div>

        {/* ================= 下半部：模块化结果展示 ================= */}
        <div id="result-section" className="flex flex-col gap-6 min-h-[500px] mb-12">
          {apiResult || errorMsg ? (
            <div className="flex items-center gap-3 px-2">
              <div className="w-1.5 h-6 bg-blue-600 rounded-full" />
              <h3 className="text-xl font-black text-slate-900 tracking-tight">智能分析报告</h3>
              {isAnalyzing && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
            </div>
          ) : null}

          {errorMsg ? (
            <div className="bg-red-50 border border-red-100 rounded-2xl p-12 flex flex-col items-center text-center">
              <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
              <h3 className="text-lg font-bold text-red-900 mb-2">分析引擎遇到障碍</h3>
              <p className="text-red-600/80 max-w-md">{errorMsg}</p>
            </div>
          ) : apiResult ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* 核心数据维度表格 - 置顶全宽 */}
              {parsedSections.summaryTable && (
                <div className="col-span-full">
                  <div className="bg-white rounded-[2rem] border border-slate-200 shadow-2xl my-6 overflow-hidden animate-in fade-in slide-in-from-top-6 duration-700 translate-z-0">
                    <div className="prose prose-slate max-w-none">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeRaw]}
                        components={MarkdownComponents}
                      >
                        {parsedSections.summaryTable}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}

              {/* 大跨度总结卡片 */}
              <div className="md:col-span-2 lg:col-span-3">
                <InsightCard
                  icon={Lightbulb} title="一句话机会总结" content={parsedSections.opportunity}
                  colorClass="bg-amber-50 text-amber-600" delay={0}
                />
              </div>

              {/* 核心趋势卡片 */}
              <InsightCard
                icon={Flame} title="行业热度" content={parsedSections.heat}
                colorClass="bg-red-50 text-red-600" delay={100}
              />
              <InsightCard
                icon={LineChart} title="搜索 / 关注变化" content={parsedSections.trends}
                colorClass="bg-blue-50 text-blue-600" delay={200}
              />
              <InsightCard
                icon={BarChart3} title="价格趋势" content={parsedSections.price}
                colorClass="bg-purple-50 text-purple-600" delay={300}
              />

              {/* 关键词与品类卡片 */}
              <InsightCard
                icon={PieChart} title="热门品类" content={parsedSections.categories}
                colorClass="bg-emerald-50 text-emerald-600" delay={400}
              />
              <InsightCard
                icon={Tag} title="今日热词" content={parsedSections.hotWords}
                colorClass="bg-indigo-50 text-indigo-600" delay={500}
              />
              <InsightCard
                icon={Zap} title="今日飙升词" content={parsedSections.risingWords}
                colorClass="bg-cyan-50 text-cyan-600" delay={600}
              />

              {/* 兜底展示：如果解析失败或内容过多，显示完整版 */}
              {!Object.values(parsedSections).some(v => v) && (
                <div className="col-span-full bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
                  <div className="prose prose-slate max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{apiResult}</ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center py-20 bg-slate-50/50 rounded-3xl border border-dashed border-slate-200">
              <div className="w-20 h-20 rounded-3xl bg-white shadow-xl shadow-slate-200 flex items-center justify-center mb-6 animate-pulse">
                <BrainCircuit className="w-10 h-10 text-slate-300" />
              </div>
              <h3 className="text-lg font-bold text-slate-400">准备绪，等待指令</h3>
              <p className="text-sm text-slate-400 mt-2">点击“启动智能分析”开启深度解码</p>
            </div>
          )}
        </div>
      </div>
    </div >
  );
};