import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Send, User, BarChart3, LineChart as LineChartIcon, PieChart as PieChartIcon, Check, Copy, ExternalLink, RefreshCw, X, Maximize2, Plus, MessageSquare, Trash2, Paperclip, LayoutDashboard, Eye, Download, Globe, ArrowLeft, Bot, FileSpreadsheet, Sparkles } from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { fetchWithAuth } from '../utils/authFetch';
import { AI_BUSINESS_DASHBOARD_CHAT_ENDPOINT, AI_BUSINESS_DASHBOARD_UPLOAD_ENDPOINT } from '../config';

const CHART_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#6366f1', '#f43f5e'];

interface AttachedFile {
  name: string;
  size: number;
  type: string;
  id?: string;
  file?: File;
}


function extractFormToken(obj: any): string | null {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.event === 'workflow_paused' && obj.data && Array.isArray(obj.data.reasons) && obj.data.reasons.length > 0) {
    if (obj.data.reasons[0].form_token) return obj.data.reasons[0].form_token;
  }
  if (obj.human_input_token) return obj.human_input_token;
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object') {
      const res = extractFormToken(obj[key]);
      if (res) return res;
    } else if (typeof obj[key] === 'string' && key.toLowerCase().includes('token')) {
      return obj[key];
    }
  }
  return null;
}

function extractHumanInputDetails(obj: any): { prompts: string; user_actions: { action: string; label: string }[] } | null {
  if (!obj || typeof obj !== 'object') return null;
  
  if (obj.event === 'workflow_paused' && obj.data && Array.isArray(obj.data.reasons) && obj.data.reasons.length > 0) {
    const reason = obj.data.reasons[0];
    if (reason.TYPE === 'human_input_required') {
       return {
         prompts: reason.form_content || '',
         user_actions: (reason.actions || []).map((a: any) => ({ action: a.id, label: a.title }))
       };
    }
  }

  // Fallbacks
  if (obj.event === 'workflow_paused' && obj.data) {
     const data = obj.data;
     if (data.prompts || data.user_actions || data.form_content) {
        return {
           prompts: data.form_content || data.prompts || '',
           user_actions: data.actions ? data.actions.map((a:any)=>({action: a.id, label: a.title})) : (data.user_actions || [])
        };
     }
  }
  
  for (const key of Object.keys(obj)) {
    if (obj[key] && typeof obj[key] === 'object') {
       if (obj[key].user_actions && Array.isArray(obj[key].user_actions)) {
           return {
              prompts: obj[key].prompts || '',
              user_actions: obj[key].user_actions
           };
       }
       const res = extractHumanInputDetails(obj[key]);
       if (res) return res;
    }
  }
  return null;
}

function extractFinalReply(message: any): string {
  const candidates = [
    message?.answer,
    message?.data?.outputs?.text,
    message?.data?.outputs?.result,
    message?.outputs?.text,
    message?.outputs?.result,
    message?.message,
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') {
      const text = value.text ?? value.answer ?? value.message;
      if (typeof text === 'string' && text.trim()) return text.trim();
    }
  }
  return '';
}

interface MessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  rawJson?: any;
  files?: AttachedFile[];
  timestamp: string;
  chartData?: any;
  isError?: boolean;
  isSubmitting?: boolean;
  submittedAction?: string;
}

interface DashboardChatSession {
  id: string;
  title: string;
  timestamp: string;
  messages: MessageItem[];
}

// 历史会话仅需要用于回看文本、附件名称和待处理表单。完整工作流原始结果
// 可能包含大段 HTML，直接写入 localStorage 会触发配额异常，进而阻止新会话出现。
const compactMessageForStorage = (message: MessageItem): MessageItem => ({
  ...message,
  files: message.files?.map(({ name, size, type, id }) => ({ name, size, type, id })),
  chartData: undefined,
  rawJson: message.rawJson?.event === 'workflow_paused' ? message.rawJson : undefined,
});

function parseChartFromContent(content: string, rawJson?: any): { chartData: any | null; jsonObject: any | null } {
  let targetObj: any = rawJson;

  if (!targetObj && content) {
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        targetObj = JSON.parse(jsonMatch[1]);
      } catch (_) {}
    } else {
      try {
        const trimmed = content.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          targetObj = JSON.parse(trimmed);
        }
      } catch (_) {}
    }
  }

  if (!targetObj) return { chartData: null, jsonObject: null };

  if (targetObj.chartType || targetObj.type === 'bar' || targetObj.type === 'line' || targetObj.type === 'pie' || targetObj.type === 'area') {
    return { chartData: targetObj, jsonObject: targetObj };
  }

  if (targetObj.chart_data || targetObj.chart) {
    return { chartData: targetObj.chart_data || targetObj.chart, jsonObject: targetObj };
  }

  if (Array.isArray(targetObj) && targetObj.length > 0 && typeof targetObj[0] === 'object') {
    const keys = Object.keys(targetObj[0]);
    const hasNumberKey = keys.some(k => typeof targetObj[0][k] === 'number');
    if (hasNumberKey) {
      return {
        chartData: {
          chartType: targetObj.length <= 6 && keys.includes('name') && keys.includes('value') ? 'pie' : 'bar',
          data: targetObj,
          title: '业务数据可视化'
        },
        jsonObject: targetObj
      };
    }
  }

  if (targetObj.outputs) {
    const outputs = targetObj.outputs;
    if (outputs.chart_data) return { chartData: outputs.chart_data, jsonObject: targetObj };
    if (outputs.result && typeof outputs.result === 'object') {
      return parseChartFromContent('', outputs.result);
    }
  }

  return { chartData: null, jsonObject: targetObj };
}

const DynamicChartRenderer: React.FC<{ chartConfig: any }> = ({ chartConfig }) => {
  const chartType = (chartConfig.chartType || chartConfig.type || 'bar').toLowerCase();
  const title = chartConfig.title || chartConfig.name || '';
  const description = chartConfig.description || '';

  const data = useMemo(() => {
    if (Array.isArray(chartConfig.data)) return chartConfig.data;
    if (Array.isArray(chartConfig.series) && chartConfig.xAxis) {
      const xLabels = chartConfig.xAxis.data || chartConfig.xAxis;
      return xLabels.map((label: string, idx: number) => {
        const item: any = { name: label };
        chartConfig.series.forEach((s: any) => {
          item[s.name || '数值'] = s.data ? s.data[idx] : 0;
        });
        return item;
      });
    }
    return [];
  }, [chartConfig]);

  if (!data || data.length === 0) return null;

  const dataKeys = Object.keys(data[0] || {}).filter(k => k !== 'name' && typeof data[0][k] === 'number');
  const nameKey = Object.keys(data[0] || {}).find(k => k === 'name' || typeof data[0][k] === 'string') || 'name';

  return (
    <div className="my-4 p-5 bg-white rounded-2xl border border-slate-200/90 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
            {chartType === 'pie' ? <PieChartIcon className="w-4 h-4" /> : chartType === 'line' ? <LineChartIcon className="w-4 h-4" /> : <BarChart3 className="w-4 h-4" />}
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-800">{title || '业务指标可视化'}</h4>
            {description && <p className="text-xs text-slate-500">{description}</p>}
          </div>
        </div>
        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-semibold rounded-md uppercase">
          {chartType} chart
        </span>
      </div>

      <div className="h-64 w-full mt-2">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'pie' ? (
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={4}
                dataKey={dataKeys[0] || 'value'}
                nameKey={nameKey}
                label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {data.map((_: any, index: number) => (
                  <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', borderRadius: '8px', color: '#fff', border: 'none', fontSize: '12px' }}
                formatter={(val: any) => [Number(val).toLocaleString(), '']}
              />
              <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
            </PieChart>
          ) : chartType === 'line' ? (
            <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey={nameKey} stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderRadius: '8px', color: '#fff', border: 'none', fontSize: '12px' }} />
              <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: '12px' }} />
              {dataKeys.map((key, idx) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                  strokeWidth={2.5}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              ))}
            </LineChart>
          ) : chartType === 'area' ? (
            <AreaChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="areaColor" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey={nameKey} stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderRadius: '8px', color: '#fff', border: 'none', fontSize: '12px' }} />
              {dataKeys.map((key, idx) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                  fill="url(#areaColor)"
                  strokeWidth={2.5}
                />
              ))}
            </AreaChart>
          ) : (
            <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey={nameKey} stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderRadius: '8px', color: '#fff', border: 'none', fontSize: '12px' }} />
              <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: '12px' }} />
              {dataKeys.map((key, idx) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={CHART_COLORS[idx % CHART_COLORS.length]}
                  radius={[6, 6, 0, 0]}
                  maxBarSize={45}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};

// ─── 提取内容中包含的 HTML 看板与文件直链 ──────────────────────────
function extractDashboardLinks(content: string): { url: string; title: string }[] {
  const links: { url: string; title: string }[] = [];
  if (!content) return links;

  // 1. 匹配 Markdown 链接 [title](url)
  const mdLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+|\/[^\s\)]+)\)/g;
  let mdMatch: RegExpExecArray | null = null;
  while ((mdMatch = mdLinkRegex.exec(content)) !== null) {
    links.push({ title: mdMatch[1], url: mdMatch[2] });
  }

  // 2. 匹配 HTML <a> 标签 <a href="...">...</a>
  const aTagRegex = /<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
  let aMatch: RegExpExecArray | null = null;
  while ((aMatch = aTagRegex.exec(content)) !== null) {
    if (!links.some(l => l.url === aMatch![1])) {
      links.push({ title: aMatch[2].replace(/<[^>]+>/g, '').trim() || '经营分析看板', url: aMatch[1] });
    }
  }

  // 3. 匹配裸 URL (http/https 开头且以 .html、/files/ 等结尾或包含链接)
  const rawUrlRegex = /(https?:\/\/[^\s\<\>\[\]\(\)\"\']+)/g;
  let urlMatch: RegExpExecArray | null = null;
  while ((urlMatch = rawUrlRegex.exec(content)) !== null) {
    const rawUrl = urlMatch[1];
    if (!links.some(l => l.url === rawUrl)) {
      links.push({
        title: rawUrl.endsWith('.html') ? '经营分析看板 HTML' : '查看看板页面',
        url: rawUrl
      });
    }
  }

  return links;
}

// ─── 经营看板专属行动卡片 (支持内嵌/全屏预览/下载) ──────────────────
const DashboardActionCard: React.FC<{ links: { url: string; title: string }[] }> = ({ links }) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  if (!links || links.length === 0) return null;

  const handleCopy = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const handleDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || '经营分析看板.html';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="my-4 space-y-3">
      {links.map((link, idx) => (
        <div
          key={idx}
          className="p-4 bg-gradient-to-r from-blue-900/90 via-indigo-900/90 to-slate-900 rounded-2xl border border-blue-500/30 text-white shadow-md relative overflow-hidden"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-400/40 flex items-center justify-center text-blue-300 shadow-inner">
                <LayoutDashboard className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-white tracking-wide">
                    {link.title || '已生成经营分析看板'}
                  </h4>
                  <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-300 border border-cyan-400/30 rounded-full text-[10px] font-semibold">
                    HTML 看板
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-0.5 truncate max-w-sm font-mono opacity-80">
                  {link.url}
                </p>
              </div>
            </div>

            <div className="flex items-center flex-wrap gap-2">
              {/* 内嵌预览切换 */}
              <button
                type="button"
                onClick={() => setPreviewUrl(previewUrl === link.url ? null : link.url)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow transition-all cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>{previewUrl === link.url ? '收起预览' : '在线预览'}</span>
              </button>

              {/* 新标签页全屏打开 */}
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/20 transition-all cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>新窗口打开</span>
              </a>

              {/* 下载 HTML */}
              <button
                type="button"
                onClick={() => handleDownload(link.url, `${link.title || '经营分析看板'}.html`)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 text-xs font-medium border border-white/10 transition-all cursor-pointer"
                title="下载 HTML 文件"
              >
                <Download className="w-3.5 h-3.5" />
              </button>

              {/* 复制链接 */}
              <button
                type="button"
                onClick={() => handleCopy(link.url)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 text-xs font-medium border border-white/10 transition-all cursor-pointer"
                title="复制链接"
              >
                {copiedUrl === link.url ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* 内嵌 iframe 实时查看区域 */}
          {previewUrl === link.url && (
            <div className="mt-4 pt-3 border-t border-white/10">
              <div className="flex items-center justify-between pb-2 text-[11px] text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-cyan-400" />
                  内嵌交互式看板预览
                </span>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-300 hover:underline flex items-center gap-1"
                >
                  <Maximize2 className="w-3 h-3" /> 全屏查看
                </a>
              </div>
              <div className="w-full h-96 rounded-xl overflow-hidden bg-white border border-slate-700 shadow-inner">
                <iframe
                  src={link.url}
                  title="经营分析看板预览"
                  className="w-full h-full border-none"
                  sandbox="allow-scripts allow-same-origin allow-popups"
                />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const SUGGESTED_QUESTIONS = [
  '生成本月全渠道营收与转化分析看板',
  '各业务品类销售占比与毛利率图表',
  '分析各大直播与电商渠道投放 ROI 对比',
  '输出高动销热销明星商品 Top 10 榜单'
];

export const BusinessDashboardModule: React.FC = () => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  
  // @ts-ignore
  const [conversationId, setConversationId] = useState<string>('');
  // @ts-ignore
  const [sessions, setSessions] = useState<DashboardChatSession[]>(() => {
    const saved = localStorage.getItem('business_dashboard_sessions');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch(e) {}
    }
    // 兼容早期版本：会话索引丢失时，仍可从当前会话快照找回最近一次对话。
    const conversationId = localStorage.getItem('business_dashboard_conversation_id');
    const messages = localStorage.getItem('business_dashboard_messages');
    if (conversationId && messages) {
      try {
        const parsedMessages = JSON.parse(messages);
        if (Array.isArray(parsedMessages) && parsedMessages.length > 0) {
          const firstUserMessage = parsedMessages.find(message => message?.role === 'user' && String(message.content || '').trim());
          return [{
            id: conversationId,
            title: String(firstUserMessage?.content || '已恢复业务看板对话').trim().slice(0, 40) || '已恢复业务看板对话',
            timestamp: new Date().toISOString(),
            messages: parsedMessages,
          }];
        }
      } catch(e) {}
    }
    return [];
  });
  const [messages, setMessages] = useState<MessageItem[]>(() => [
    {
      id: 'welcome',
      role: 'assistant',
      content: '您好！我是**业务看板 AI 分析助手**。\n\n您可以直接向我提问关于经营业绩、各渠道转化率、品类毛利及爆款动销的任何分析需求，或上传业务数据文件（Excel/CSV/JSON）。系统将调用工作流返回结构化 JSON 并为您自动渲染出可视化图表。',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      rawJson: {
        status: "ready",
        workflow: "business_dashboard_agent",
        endpoint: "http://39.108.221.22/v1"
      }
    }
  ]);

  const [inputQuery, setInputQuery] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  
  const handleNewChat = () => {
    setMessages([{
      id: 'welcome',
      role: 'assistant',
      content: '您好！我是 **业务看板 AI 分析助手**。\n\n您可以直接向我提问关于经营业绩、各渠道转化率、品类毛利及爆款动销的任何分析需求，或上传业务数据文件（Excel/CSV/JSON）。系统将调用工作流返回结构化 JSON 并为您自动渲染出可视化图表。',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      rawJson: {
        status: "ready",
        workflow: "business_dashboard_agent",
        endpoint: "http://39.108.221.22/v1"
      }
    }]);
    setConversationId('');
    localStorage.removeItem('business_dashboard_messages');
    localStorage.removeItem('business_dashboard_conversation_id');
  };

  const handleSelectSession = (session: any) => {
    setConversationId(session.id);
    setMessages(session.messages);
    localStorage.setItem('business_dashboard_conversation_id', session.id);
    localStorage.setItem('business_dashboard_messages', JSON.stringify(session.messages));
  };

  const handleDeleteSession = (id: string) => {
    if (window.confirm('确定要删除这条对话历史吗？')) {
      setSessions(prev => {
        const newSessions = prev.filter(s => s.id !== id);
        localStorage.setItem('business_dashboard_sessions', JSON.stringify(newSessions));
        return newSessions;
      });
      if (conversationId === id) {
        handleNewChat();
      }
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Dify 在首条响应中返回 conversation_id。拿到它后立即建立本地会话，
  // 后续消息变化也同步保存，避免左侧历史只读取却从未写入的问题。
  useEffect(() => {
    if (!conversationId) return;

    const firstUserMessage = messages.find(message => message.role === 'user' && message.content.trim());
    const title = firstUserMessage?.content.trim().slice(0, 40) || '新建业务看板对话';

    setSessions(previousSessions => {
      const previous = previousSessions.find(session => session.id === conversationId);
      const updatedSession: DashboardChatSession = {
        id: conversationId,
        title,
        timestamp: previous?.timestamp || new Date().toISOString(),
        messages: messages.map(compactMessageForStorage),
      };
      const updatedSessions = previous
        ? previousSessions.map(session => session.id === conversationId ? updatedSession : session)
        : [updatedSession, ...previousSessions];
      const compactedSessions = updatedSessions.map(session => ({
        ...session,
        messages: session.messages.map(compactMessageForStorage),
      }));
      return compactedSessions;
    });
  }, [conversationId, messages]);

  // 存储失败不能影响 React 状态更新；否则 localStorage 配额不足时，左侧新会话
  // 会完全不显示。压缩后的历史通常远小于浏览器配额。
  useEffect(() => {
    try {
      localStorage.setItem('business_dashboard_sessions', JSON.stringify(sessions));
    } catch (error) {
      console.warn('Business dashboard session storage failed:', error);
    }
  }, [sessions]);

  useEffect(() => {
    if (!conversationId) return;
    try {
      localStorage.setItem('business_dashboard_conversation_id', conversationId);
      localStorage.setItem('business_dashboard_messages', JSON.stringify(messages.map(compactMessageForStorage)));
    } catch (error) {
      console.warn('Business dashboard current-session storage failed:', error);
    }
  }, [conversationId, messages]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles: AttachedFile[] = Array.from(files).map(f => ({
      name: f.name,
      size: f.size,
      type: f.type,
      file: f
    }));

    setAttachedFiles(prev => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleClearHistory = () => {
    setMessages([
      {
        id: Date.now().toString(),
        role: 'assistant',
        content: '会话已重置。请在下方输入您的业务分析问题或上传数据文件：',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ]);
  };

  
  const handleNodeSubmit = async (token: string, actionStr: string, actionLabel: string, msgId: string) => {
    try {
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, isSubmitting: true } : m));
      const res = await fetchWithAuth('/api/business-dashboard/chat-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form_token: token, action: actionStr, inputs: {} })
      });
      if (res.ok) {
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, isSubmitting: false, submittedAction: actionStr } : m));
        setMessages(prev => [...prev, {
          id: `user_action_${Date.now()}`,
          role: 'user',
          content: actionLabel,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }]);

        if (conversationId) {
            let polls = 0;
            const pollInterval = setInterval(async () => {
                polls++;
                if (polls > 15) {
                    clearInterval(pollInterval);
                    return;
                }
                try {
                    const mRes = await fetchWithAuth(`/api/business-dashboard/messages?conversation_id=${conversationId}`);
                    if (!mRes.ok) {
                        const errText = await mRes.text().catch(() => '');
                        console.warn('[BusinessDashboard] 后续流程轮询失败:', mRes.status, errText);
                        return;
                    }
                    
                    const mData = await mRes.json();
                    if (!mData.data || mData.data.length === 0) {
                         console.debug('[BusinessDashboard] 后续流程暂未返回消息');
                         return;
                    }

                    const lastMsg = mData.data[mData.data.length - 1];
                    if (lastMsg.extra_contents && lastMsg.extra_contents.length > 0) {
                        const lastExtra = lastMsg.extra_contents[lastMsg.extra_contents.length - 1];

                        if (lastExtra.type === 'human_input' && lastExtra.submitted === false) {
                            const newToken = lastExtra.form_definition?.form_token;
                            if (newToken && newToken !== token) {
                                clearInterval(pollInterval);
                                setMessages(prev => {
                                    if (prev.some(p => p.rawJson?.data?.reasons?.[0]?.form_token === newToken)) {
                                        return prev;
                                    }
                                    return [...prev, {
                                        id: `ai_polled_${Date.now()}`,
                                        role: 'assistant',
                                        content: '',
                                        rawJson: {
                                            event: 'workflow_paused',
                                            data: {
                                                reasons: [{
                                                    TYPE: 'human_input_required',
                                                    form_token: newToken,
                                                    form_content: lastExtra.form_definition.form_content,
                                                    actions: lastExtra.form_definition.actions
                                                }]
                                            }
                                        },
                                        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                    }];
                                });
                                return;
                            }
                        }
                    } else {
                        console.debug('[BusinessDashboard] 后续流程尚无人工介入表单:', lastMsg.status);
                    }

                    if (lastMsg.status !== 'paused' && lastMsg.status !== 'running') {
                        setMessages(prev => {
                            const completionId = `workflow_completion_${token}`;
                            if (prev.some(p => p.id === completionId)) return prev;
                            const isNormal = lastMsg.status === 'normal';
                            const finalReply = extractFinalReply(lastMsg);
                            if (isNormal && !finalReply) {
                                console.warn('[BusinessDashboard] 工作流已结束，但 Dify 消息中未包含最终回复。', lastMsg);
                                return prev;
                            }
                            return [...prev, {
                                id: completionId,
                                role: 'assistant',
                                content: isNormal
                                  ? finalReply
                                  : `⚠️ 工作流执行失败（状态：${lastMsg.status}）。${lastMsg.error || lastMsg.message || '请在 Dify 运行日志中查看详细原因。'}`,
                                timestamp: new Date().toLocaleTimeString()
                            }];
                        });
                        clearInterval(pollInterval);
                    }
                } catch(e: any) {
                    console.error('[BusinessDashboard] 后续流程轮询异常:', e);
                }
            }, 2000);
        }
      } else {
        throw new Error('提交失败');
      }
    } catch (e: any) {
      alert('操作提交失败: ' + e.message);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, isSubmitting: false } : m));
    }
  };

const handleSend = async (queryText?: string) => {
    const textToSend = (queryText || inputQuery).trim();
    if (!textToSend && attachedFiles.length === 0) return;
    if (isLoading) return;

    const userMessageId = `user_${Date.now()}`;
    const assistantMessageId = `ai_${Date.now()}`;

    const currentFiles = [...attachedFiles];
    setAttachedFiles([]);
    setInputQuery('');

    const userMsg: MessageItem = {
      id: userMessageId,
      role: 'user',
      content: textToSend,
      files: currentFiles,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const uploadedFileIds: string[] = [];
      for (const item of currentFiles) {
        if (item.file) {
          const formData = new FormData();
          formData.append('file', item.file);
          try {
            const upRes = await fetchWithAuth(AI_BUSINESS_DASHBOARD_UPLOAD_ENDPOINT, {
              method: 'POST',
              body: formData
            });
            if (upRes.ok) {
              const upData = await upRes.json();
              if (upData.id) uploadedFileIds.push(upData.id);
            }
          } catch (upErr) {
            console.warn('File upload warning:', upErr);
          }
        }
      }

      const fileObjects = uploadedFileIds.map(id => ({
        type: 'document',
        transfer_method: 'local_file',
        upload_file_id: id
      }));

      // 构造请求体：完全对齐 Dify 工作流（同时支持 files 顶层与 inputs.files）
      const queryText = textToSend || (fileObjects.length > 0 ? '请根据上传的业务数据文件进行深度分析并生成经营分析看板' : '请提供业务经营分析建议');

      const payload: any = {
        query: queryText,
        inputs: {
          query: queryText,
          files: fileObjects.length > 0 ? fileObjects : undefined
        },
        files: fileObjects,
        response_mode: 'streaming',
        user: 'web_client_user'
      };
      
        if (conversationId) {
            payload.conversation_id = conversationId;
        }

      const response = await fetchWithAuth(AI_BUSINESS_DASHBOARD_CHAT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      let replyContent = '';
      let replyJson: any = null;
      let streamedConversationId = '';

      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        const errDesc = errJson?.message || errJson?.error || errJson?.details || `HTTP ${response.status}`;
        
        replyContent = `### ⚠️ 接口调用提示\n\n${errDesc}\n\n> **配置提示**：请确认在根目录 \`.env\` 文件中已添加 \`DIFY_BUSINESS_DASHBOARD_API_KEY=app-xxxxxx\`（业务看板机器人的有效 API Key）并重启后端服务。`;
        replyJson = errJson || { error: errDesc, status: response.status };
        
        const aiMsg: MessageItem = {
          id: assistantMessageId,
          role: 'assistant',
          content: replyContent,
          rawJson: replyJson,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages(prev => [...prev, aiMsg]);
      } else {
        // Render initial empty message
        setMessages(prev => [...prev, {
          id: assistantMessageId,
          role: 'assistant',
          content: '正在生成分析中...',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }]);

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep the incomplete line in the buffer
            
            for (const line of lines) {
              const trimmedLine = line.trim();
              if (trimmedLine.startsWith('data: ')) {
                try {
                  const dataStr = trimmedLine.slice(6).trim();
                  if (!dataStr) continue;
                  const data = JSON.parse(dataStr);
                  if (data.conversation_id) streamedConversationId = data.conversation_id;
                  
                  if (data.event === 'message' || data.event === 'agent_message') {
                    replyContent += (data.answer || '');
                  } else if (data.event === 'workflow_finished') {
                    if (data.data?.outputs?.text) {
                      replyContent = data.data.outputs.text;
                    } else if (data.data?.outputs?.result) {
                      replyContent = typeof data.data.outputs.result === 'string' ? data.data.outputs.result : JSON.stringify(data.data.outputs.result, null, 2);
                    } else if (data.outputs?.text) {
                      replyContent = data.outputs.text;
                    }
                    replyJson = data.data?.outputs || data;
                  } else if (data.event === 'workflow_paused' || data.event === 'node_finished') {
                    // Dify sometimes sends paused info in node_finished if it's a manual intervention node
                    if (data.event === 'workflow_paused' || (data.data && data.data.status === 'paused')) {
                      replyJson = data;
                    }
                  }
                  
                  // Update UI periodically during stream
                  if (replyContent || replyJson) {
                    setMessages(prev => prev.map(m => m.id === assistantMessageId ? {
                      ...m,
                      content: replyContent, // Removing fallback text so it renders properly
                      rawJson: replyJson
                    } : m));
                  }
                } catch (e) {
                  console.warn('SSE Parse Error:', e, trimmedLine);
                }
              }
            }
          }
        }
        
        if (streamedConversationId && !conversationId) {
            setConversationId(streamedConversationId);
        }

        const { chartData, jsonObject } = parseChartFromContent(replyContent, replyJson);
        setMessages(prev => prev.map(m => m.id === assistantMessageId ? {
          ...m,
          content: replyContent,
          rawJson: jsonObject,
          chartData: chartData
        } : m));
      }
    } catch (err: any) {
      console.error('Workflow call error:', err);
      const errorMsg: MessageItem = {
        id: assistantMessageId,
        role: 'assistant',
        content: `**网络调用异常**：${err.message || '连接服务器超时'}\n\n请检查后端服务 (端口 3001) 是否正在运行以及 \`.env\` 中的网络连通性。`,
        rawJson: {
          error: err.message,
          endpoint: "http://39.108.221.22/v1"
        },
        isError: true,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    
    <div className="flex w-full h-full bg-slate-100 overflow-hidden">
      {/* 历史对话侧边栏 */}
      <div className="w-64 shrink-0 bg-white border-r border-slate-200/80 flex flex-col h-full shadow-sm z-20">
        <div className="h-14 flex items-center justify-between px-4 border-b border-slate-100 shrink-0">
          <span className="font-bold text-sm text-slate-800">历史对话</span>
          <button 
            onClick={handleNewChat}
            className="p-1.5 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors"
            title="新对话"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scroll p-2 space-y-1">
          {sessions.map(s => (
            <div 
              key={s.id} 
              onClick={() => handleSelectSession(s)}
              className={`px-3 py-2.5 rounded-xl cursor-pointer transition-all flex items-start gap-2 group ${
                conversationId === s.id ? 'bg-blue-50 border border-blue-200/50 shadow-sm' : 'hover:bg-slate-50 border border-transparent'
              }`}
            >
              <MessageSquare className={`w-4 h-4 mt-0.5 shrink-0 ${conversationId === s.id ? 'text-blue-500' : 'text-slate-400'}`} />
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-semibold truncate ${conversationId === s.id ? 'text-blue-700' : 'text-slate-700'}`}>
                  {s.title}
                </div>
                <div className="text-[10px] text-slate-400 mt-1">
                  {new Date(s.timestamp).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteSession(s.id);
                }}
                className={`p-1.5 rounded-md transition-colors opacity-0 group-hover:opacity-100 ${
                  conversationId === s.id ? 'text-blue-400 hover:bg-blue-100 hover:text-blue-600' : 'text-slate-400 hover:bg-slate-200 hover:text-rose-500'
                }`}
                title="删除会话"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {sessions.length === 0 && (
             <div className="text-center text-xs text-slate-400 mt-10">暂无历史对话</div>
          )}
        </div>
      </div>
      <div className="flex-1 flex flex-col h-full bg-slate-50 relative overflow-hidden font-sans text-slate-800">
      {previewUrl && (
        <div className="absolute inset-0 z-50 bg-white flex flex-col">
          <div className="h-14 border-b border-slate-200 flex items-center justify-between px-4 shrink-0 bg-slate-50">
            <button onClick={() => setPreviewUrl(null)} className="flex items-center gap-2 text-slate-600 hover:text-blue-600 transition-colors font-medium text-sm px-3 py-1.5 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 hover:shadow-sm">
              <ArrowLeft className="w-4 h-4" />
              返回对话
            </button>
            <div className="font-semibold text-slate-800 text-[15px]">
               经营分析看板预览
            </div>
            <a href={previewUrl} target="_blank" rel="noreferrer" className="p-2 text-slate-500 hover:text-blue-600 transition-colors hover:bg-white rounded-lg" title="在新窗口打开">
               <ExternalLink className="w-4.5 h-4.5" />
            </a>
          </div>
          <div className="flex-1 bg-slate-100">
             <iframe src={previewUrl} className="w-full h-full border-none" title="看板预览" />
          </div>
        </div>
      )}
      
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileChange}
        className="hidden"
        accept=".csv,.xlsx,.xls,.json,.txt,.pdf,.png,.jpg,.jpeg"
      />

      <div className="h-14 shrink-0 bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-6 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-md shadow-cyan-500/20">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">业务看板工作流助手</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                API 在线: 39.108.221.22
              </span>
            </div>
            <p className="text-[11px] text-slate-400">支持自然语言对话、文件分析与 JSON 图表动态渲染</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleClearHistory}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 text-xs font-medium transition-all cursor-pointer"
            title="清空对话"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>清空记录</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scroll p-6 space-y-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={`flex gap-3.5 ${isUser ? 'flex-row-reverse' : 'flex-row'} items-start`}
              >
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${
                    isUser
                      ? 'bg-blue-600 text-white'
                      : 'bg-gradient-to-br from-indigo-600 to-blue-600 text-white'
                  }`}
                >
                  {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>

                <div
                  className={`flex flex-col max-w-[85%] ${
                    isUser ? 'items-end' : 'items-start'
                  }`}
                >
                  {msg.files && msg.files.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {msg.files.map((file, fIdx) => (
                        <div
                          key={fIdx}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200/80 rounded-xl text-xs font-medium shadow-xs"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5 text-blue-600" />
                          <span className="truncate max-w-[180px]">{file.name}</span>
                          <span className="text-[10px] text-blue-400">({(file.size / 1024).toFixed(1)} KB)</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div
                    className={`p-4 rounded-2xl text-sm leading-relaxed shadow-sm ${
                      isUser
                        ? 'bg-blue-600 text-white rounded-tr-none'
                        : 'bg-white border border-slate-200/80 text-slate-800 rounded-tl-none w-full'
                    }`}
                  >
                    {msg.content && (
                      <div className={`prose prose-sm max-w-none break-words ${isUser ? 'text-white prose-invert' : 'text-slate-800'}`}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={{
                              a: ({node, ...props}) => {
                                if (props.href && props.href.includes('/files/tools/')) {
                                  return <a {...props} onClick={(e) => { e.preventDefault(); setPreviewUrl(props.href as string); }} className="text-blue-600 font-medium hover:underline cursor-pointer" />;
                                }
                                return <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline" />;
                              }
                            }}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    )}
                    {/* 人工介入节点 (直接输出) */}
                    {!isUser && msg.rawJson?.event === 'workflow_paused' && extractHumanInputDetails(msg.rawJson) && (
                      <div className="mt-4 flex flex-col gap-3 w-full">
                        {extractHumanInputDetails(msg.rawJson)?.prompts && (
                          <div className="prose prose-sm max-w-none text-slate-800">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={{
                              a: ({node, ...props}) => {
                                if (props.href && props.href.includes('/files/tools/')) {
                                  return <a {...props} onClick={(e) => { e.preventDefault(); setPreviewUrl(props.href as string); }} className="text-blue-600 font-medium hover:underline cursor-pointer" />;
                                }
                                return <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline" />;
                              }
                            }}>
                              {extractHumanInputDetails(msg.rawJson)!.prompts}
                            </ReactMarkdown>
                          </div>
                        )}
                        
                        {extractHumanInputDetails(msg.rawJson)?.user_actions && extractHumanInputDetails(msg.rawJson)!.user_actions.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {extractHumanInputDetails(msg.rawJson)!.user_actions.map((act, idx) => (
                              <button
                                key={idx}
                                disabled={msg.isSubmitting || !!msg.submittedAction}
                                onClick={() => {
                                  const token = extractFormToken(msg.rawJson);
                                  if (token) handleNodeSubmit(token, act.action, act.label || act.action, msg.id);
                                }}
                                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                                  msg.submittedAction === act.action 
                                    ? 'bg-blue-600 text-white shadow-md' 
                                    : msg.submittedAction
                                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                      : 'bg-white border border-blue-500 text-blue-600 hover:bg-blue-50 shadow-sm'
                                }`}
                              >
                                {act.label || act.action}
                                {msg.isSubmitting && !msg.submittedAction && '...'}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 经营看板 HTML 链接行动卡片 (支持内嵌/全屏预览/下载) */}
                    {!isUser && msg.content && (
                      <DashboardActionCard links={extractDashboardLinks(msg.content)} />
                    )}

                    {/* 智能图表展示区 */}
                    {!isUser && msg.chartData && (
                      <DynamicChartRenderer chartConfig={msg.chartData} />
                    )}

                    <div
                      className={`text-[10px] mt-2 select-none ${
                        isUser ? 'text-blue-200 text-right' : 'text-slate-400'
                      }`}
                    >
                      {msg.timestamp}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {isLoading && (
            <div className="flex gap-3.5 items-start">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-white border border-slate-200/80 p-4 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-3">
                <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
                <span className="text-xs text-slate-600 font-medium animate-pulse">
                  正在调用工作流接口并生成图表分析...
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="shrink-0 bg-white border-t border-slate-200/80 p-4 pb-5 z-10 shadow-lg">
        <div className="max-w-4xl mx-auto space-y-3">
          <div className="flex items-center gap-2 overflow-x-auto custom-scroll pb-1">
            <span className="text-[11px] font-semibold text-slate-400 shrink-0 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-500" />
              快捷提问:
            </span>
            {SUGGESTED_QUESTIONS.map((q, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(q)}
                disabled={isLoading}
                className="px-2.5 py-1 bg-slate-100 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 text-slate-600 border border-slate-200 rounded-full text-xs font-medium whitespace-nowrap transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {q}
              </button>
            ))}
          </div>

          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {attachedFiles.map((file, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 border border-slate-300/80 rounded-lg text-xs text-slate-700 font-medium shadow-2xs"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
                  <span className="truncate max-w-[150px]">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="p-0.5 hover:bg-slate-200 text-slate-400 hover:text-rose-500 rounded transition-colors cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl p-1.5 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all shadow-inner">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="hidden p-2 text-slate-500 hover:text-blue-600 hover:bg-white rounded-xl transition-all cursor-pointer disabled:opacity-50"
              title="上传数据文件 (Excel / CSV / JSON)"
            >
              <Paperclip className="w-5 h-5" />
            </button>

            <input
              type="text"
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="请输入您的业务看板分析问题或指令，按 Enter 发送..."
              disabled={isLoading}
              className="flex-1 bg-transparent border-none outline-none text-sm text-slate-800 placeholder-slate-400 px-2"
            />

            <button
              type="button"
              onClick={() => handleSend()}
              disabled={isLoading || (!inputQuery.trim() && attachedFiles.length === 0)}
              className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-blue-600/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <span>发送</span>
                  <Send className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
};
