import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback, Fragment } from 'react';
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Cell
} from 'recharts';
import { Upload, Loader2, CheckCircle, XCircle, X, Download, Info, Settings } from 'lucide-react';
import { REVIEW_PARTNER_UPLOAD_ENDPOINT, REVIEW_PARTNER_AD_ZONE_ENDPOINT, REVIEW_PARTNER_MINI_PROGRAM_ENDPOINT, REVIEW_PARTNER_MINI_PROGRAM_UPLOAD_ENDPOINT, REVIEW_PARTNER_MINI_PROGRAM_REMARK_ENDPOINT, REVIEW_PARTNER_MINI_PROGRAM_AVG_ENDPOINT, REVIEW_PARTNER_ORDER_PAGE_ENDPOINT, REVIEW_PARTNER_ORDER_PAGE_UPLOAD_ENDPOINT, REVIEW_PARTNER_TRANSACTION_ENDPOINT, REVIEW_PARTNER_TRANSACTION_UPLOAD_ENDPOINT, REVIEW_PARTNER_TRANSACTION_UPDATE_ENDPOINT, REVIEW_PARTNER_TRANSACTION_ADD_ENDPOINT } from '../config';

// ─── 列显隐 Hook ──────────────────────────────────────────────────
export interface ColDef {
  key: string;
  label: string;
  fixed?: boolean;
}

function useColumnVisibility(storageKey: string, defaults: ColDef[]) {
  const [visible, setVisible] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return new Set(JSON.parse(saved));
    } catch { /* ignore */ }
    return new Set(defaults.map(c => c.key));
  });
  const toggle = (key: string) => {
    setVisible(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem(storageKey, JSON.stringify([...next]));
      return next;
    });
  };
  const resetAll = () => {
    const all = new Set(defaults.map(c => c.key));
    setVisible(all);
    localStorage.setItem(storageKey, JSON.stringify([...all]));
  };
  const isFixed = (key: string) => defaults.find(c => c.key === key)?.fixed ?? false;
  return { visible, toggle, resetAll, isFixed };
}

// ── 列设置面板组件 ───────────────────────────────────────────────
function ColumnSettingsPanel({ columns, visible, onToggle, onReset, onClose, anchorPos }: {
  columns: ColDef[];
  visible: Set<string>;
  onToggle: (key: string) => void;
  onReset: () => void;
  onClose: () => void;
  anchorPos?: { top: number; left: number } | null;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelTop, setPanelTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (anchorPos && panelRef.current) {
      const h = panelRef.current.offsetHeight;
      setPanelTop(anchorPos.top - h - 4);
    }
  }, [anchorPos]);

  const maxH = anchorPos ? Math.max(anchorPos.top - 8, 120) : 320;

  return (
    <div className="fixed inset-0 z-50 bg-black/15" onClick={onClose}>
      <div
        ref={panelRef}
        className="bg-white rounded-lg shadow-2xl border border-slate-200 w-64 p-4 flex flex-col"
        style={anchorPos
          ? { position: 'fixed', top: panelTop ?? 0, left: anchorPos.left, maxHeight: maxH, visibility: panelTop !== null ? 'visible' as const : 'hidden' as const }
          : { position: 'fixed', top: 56, right: 16 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3 shrink-0">
          <span className="text-sm font-semibold text-slate-700">列设置</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 transition"><X className="w-4 h-4 text-slate-400" /></button>
        </div>
        <div className="space-y-1.5 overflow-y-auto flex-1 min-h-0">
          {columns.map(c => (
            <label key={c.key} className={`flex items-center gap-2 text-xs py-1 px-2 rounded hover:bg-slate-50 cursor-pointer ${c.fixed ? 'text-slate-400' : 'text-slate-600'}`}>
              <input
                type="checkbox"
                checked={visible.has(c.key)}
                onChange={() => !c.fixed && onToggle(c.key)}
                disabled={c.fixed}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>{c.label}{c.fixed ? ' (固定)' : ''}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100 shrink-0">
          <button onClick={onReset} className="flex-1 px-2 py-1.5 text-xs border border-slate-300 rounded hover:bg-slate-50 text-slate-600 transition">恢复默认</button>
          <button onClick={onClose} className="flex-1 px-2 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition">关闭</button>
        </div>
      </div>
    </div>
  );
}

// ─── 类型定义 ─────────────────────────────────────────────────────
interface MiniProgramRow {
  id?: number;
  date: string;
  stat_date?: string;
  scan_users: number;
  scan_views: number;
  partner_visits: number;
  yz_users: number;
  yz_views: number;
  dau: number;
  display_rate: number;
  transaction_users: number;
  remark: string;
}
interface OrderPageRow {
  date: string;
  nayuki: number;
  heytea: number;
  starbucks: number;
  jasmine: number;
  tasiting: number;
  cudi: number;
  mcdonalds: number;
  luckin: number;
  kfc: number;
}
interface TransactionRow {
  date: string;
  online_goods: number;
  virtual_card: number;
  cash_coupon: number;
  phone_recharge: number;
  dining: number;
  movie_ticket: number;
  transaction_users: number;
  transaction_count: number;
}
interface AdZoneRow {
  ad_id: number;
  business_type: string;
  promotion_name: string;
  ad_name: string;
  date: string;
  stat_date: string;
  impressions: number;
  impression_users: number;
  clicks: number;
  click_users: number;
  zone_id: number | null;
  zone_name: string;
  zone_content: string;
  pv: number;
  uv_openid: number;
  uv_channel: number;
  zone_clicks: number;
  zone_click_users: number;
  avg_stay_seconds: number | string;
  material_name: string;
  we_date: string;
  we_visitors: number;
  we_visits: number;
}

// ─── 工具函数 ──────────────────────────────────────────────────────
function formatDate(d: string) {
  return d.slice(5);
}

function parseMiniProgramRows(rawData: any[]): MiniProgramRow[] {
  return rawData.map((r: any) => {
    let dateStr = r.stat_date;
    if (dateStr instanceof Date) {
      const y = dateStr.getFullYear();
      const m = String(dateStr.getMonth() + 1).padStart(2, '0');
      const d = String(dateStr.getDate()).padStart(2, '0');
      dateStr = `${y}-${m}-${d}`;
    } else if (typeof dateStr === 'string') {
      if (/^\d{8}$/.test(dateStr)) {
        dateStr = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
      } else if (dateStr.length > 10) {
        dateStr = dateStr.slice(0, 10);
      }
    }
    return { ...r, stat_date: dateStr, date: dateStr };
  });
}

function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1;
}

function formatLocalDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fetchStartForPrev(sd: string, ed: string) {
  const span = daysBetween(sd, ed);
  return formatLocalDate(new Date(new Date(sd).getTime() - span * 86400000));
}

function getDefaultDates(): [string, string] {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 29); // 默认 30 天
  return [start.toISOString().slice(0, 10), today.toISOString().slice(0, 10)];
}

// ─── Tab 配置 ──────────────────────────────────────────────────────
const TABS = [
  { key: 'mini_program', label: '小程序访问情况' },
  // { key: 'order_page', label: '点餐聚合页情况' }, // 暂时不使用
  { key: 'ad_zone', label: '刷码页业务数据情况' },
  { key: 'transaction', label: '交易情况' },
] as const;

// ─── 主组件 ────────────────────────────────────────────────────────
export function ReviewPartnerModule() {
  const [activeTab, setActiveTab] = useState<string>('mini_program');
  const [dateRange, setDateRange] = useState<[string, string]>(getDefaultDates());

  const [startDate, setStartDate] = useState(dateRange[0]);
  const [endDate, setEndDate] = useState(dateRange[1]);
  const [quickRange, setQuickRange] = useState<number>(30);

  // 广告-专区数据（从数据库查询）
  const [allAdZoneData, setAllAdZoneData] = useState<AdZoneRow[]>([]);
  const [adZoneLoading, setAdZoneLoading] = useState(false);
  // 广告-专区的已应用日期范围（初始为默认 30 天）
  const [adZoneDateFilter, setAdZoneDateFilter] = useState<[string | null, string | null]>(getDefaultDates());

  // 小程序访问情况数据（从数据库查询）
  const [allMiniProgramData, setAllMiniProgramData] = useState<MiniProgramRow[]>([]);
  const [miniProgramLoading, setMiniProgramLoading] = useState(false);
  const [miniProgramDateFilter, setMiniProgramDateFilter] = useState<[string | null, string | null]>(getDefaultDates());

  // 点餐聚合页数据（从数据库查询）
  const [allOrderPageData, setAllOrderPageData] = useState<OrderPageRow[]>([]);
  const [orderPageLoading, setOrderPageLoading] = useState(false);
  const [orderPageDateFilter, setOrderPageDateFilter] = useState<[string | null, string | null]>(getDefaultDates());

  // 交易情况数据（从数据库查询）
  const [allTransactionData, setAllTransactionData] = useState<TransactionRow[]>([]);
  const [transactionLoading, setTransactionLoading] = useState(false);
  const [transactionDateFilter, setTransactionDateFilter] = useState<[string | null, string | null]>(getDefaultDates());

  const fetchTransactionData = useCallback(async (sd?: string | null, ed?: string | null) => {
    setTransactionLoading(true);
    try {
      const params = new URLSearchParams();
      if (sd) params.set('start_date', sd);
      if (ed) params.set('end_date', ed);
      const res = await fetch(`${REVIEW_PARTNER_TRANSACTION_ENDPOINT}?${params}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('blue_os_token') || ''}` }
      });
      const json = await res.json();
      if (json.success) {
        setAllTransactionData(json.data.map((r: any) => ({
          date: r.stat_date,
          online_goods: Number(r.online_goods) || 0,
          virtual_card: Number(r.virtual_card) || 0,
          cash_coupon: Number(r.cash_coupon) || 0,
          phone_recharge: Number(r.phone_recharge) || 0,
          dining: Number(r.dining) || 0,
          movie_ticket: Number(r.movie_ticket) || 0,
          transaction_users: Number(r.transaction_users) || 0,
          transaction_count: Number(r.transaction_count) || 0,
        })));
      }
    } catch (e) {
      console.error('获取交易数据失败', e);
    } finally {
      setTransactionLoading(false);
    }
  }, []);

    useEffect(() => {
      if (activeTab === 'transaction') fetchTransactionData(transactionDateFilter[0], transactionDateFilter[1]);
    }, [transactionDateFilter, fetchTransactionData, activeTab]);

  const transactionData = useMemo(
    () => allTransactionData.filter(r => r.date >= (transactionDateFilter[0] || '') && r.date <= (transactionDateFilter[1] || '')),
    [allTransactionData, transactionDateFilter]
  );
  const prevTransactionData = useMemo(() => {
    const [s, e] = transactionDateFilter;
    if (!s || !e) return [];
    const days = Math.round((new Date(e).getTime() - new Date(s).getTime()) / 86400000) + 1;
    const ps = new Date(new Date(s).getTime() - days * 86400000);
    const pe = new Date(new Date(s).getTime() - 86400000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return allTransactionData.filter(r => r.date >= fmt(ps) && r.date <= fmt(pe));
  }, [allTransactionData, transactionDateFilter]);

  const fetchAdZoneData = useCallback(async (sd?: string | null, ed?: string | null) => {
    setAdZoneLoading(true);
    try {
      // 获取双倍日期范围（当期 + 上期），用于计算环比
      let fetchStart = sd;
      if (sd && ed) {
        const span = daysBetween(sd, ed);
        const prevStart = new Date(new Date(sd).getTime() - span * 86400000);
        fetchStart = formatLocalDate(prevStart);
      }
      const params = new URLSearchParams();
      if (fetchStart) params.set('start_date', fetchStart);
      if (ed) params.set('end_date', ed);
      const res = await fetch(`${REVIEW_PARTNER_AD_ZONE_ENDPOINT}?${params}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('blue_os_token') || ''}` }
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          const rows = json.data.map((r: any) => {
            let dateStr = r.stat_date;
            if (dateStr instanceof Date) {
              const y = dateStr.getFullYear();
              const m = String(dateStr.getMonth() + 1).padStart(2, '0');
              const d = String(dateStr.getDate()).padStart(2, '0');
              dateStr = `${y}-${m}-${d}`;
            } else if (typeof dateStr === 'string' && dateStr.length > 10) {
              dateStr = dateStr.slice(0, 10);
            }
            return { ...r, stat_date: dateStr, date: dateStr };
          });
          setAllAdZoneData(rows);
        }
      }
    } catch (e) {
      // ignore
    } finally {
      setAdZoneLoading(false);
    }
  }, []);

  // 拆分广告-专区当期 + 上期数据
  const { adZoneData, prevAdZoneData } = useMemo(() => {
    const [sd, ed] = adZoneDateFilter;
    if (!sd || !ed) return { adZoneData: allAdZoneData, prevAdZoneData: [] as AdZoneRow[] };
    return {
      adZoneData: allAdZoneData.filter(r => r.date >= sd && r.date <= ed),
      prevAdZoneData: allAdZoneData.filter(r => r.date < sd && r.date >= fetchStartForPrev(sd, ed)),
    };
  }, [allAdZoneData, adZoneDateFilter]);

  // 仅当对应 tab 被选中时才加载数据
  useEffect(() => {
    if (activeTab === 'ad_zone') fetchAdZoneData(adZoneDateFilter[0], adZoneDateFilter[1]);
  }, [adZoneDateFilter, fetchAdZoneData, activeTab]);

  const fetchMiniProgramData = useCallback(async (sd?: string | null, ed?: string | null) => {
    setMiniProgramLoading(true);
    try {
      // 获取双倍日期范围（当期 + 上期），用于计算环比
      let fetchStart = sd;
      if (sd && ed) {
        const span = daysBetween(sd, ed);
        const prevStart = new Date(new Date(sd).getTime() - span * 86400000);
        fetchStart = formatLocalDate(prevStart);
      }
      const params = new URLSearchParams();
      if (fetchStart) params.set('start_date', fetchStart);
      if (ed) params.set('end_date', ed);
      const res = await fetch(`${REVIEW_PARTNER_MINI_PROGRAM_ENDPOINT}?${params}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('blue_os_token') || ''}` }
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setAllMiniProgramData(parseMiniProgramRows(json.data));
        }
      }
    } catch (e) {
      // ignore
    } finally {
      setMiniProgramLoading(false);
    }
  }, []);

  // 拆分当期 + 上期数据
  const { miniProgramData, prevMiniProgramData } = useMemo(() => {
    const [sd, ed] = miniProgramDateFilter;
    if (!sd || !ed) return { miniProgramData: allMiniProgramData, prevMiniProgramData: [] as MiniProgramRow[] };
    return {
      miniProgramData: allMiniProgramData.filter(r => r.date >= sd && r.date <= ed),
      prevMiniProgramData: allMiniProgramData.filter(r => r.date < sd && r.date >= fetchStartForPrev(sd, ed)),
    };
  }, [allMiniProgramData, miniProgramDateFilter]);

  // 更新备注
  const handleRemarkSave = useCallback(async (id: number, remark: string) => {
    try {
      const res = await fetch(`${REVIEW_PARTNER_MINI_PROGRAM_REMARK_ENDPOINT}/${id}/remark`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('blue_os_token') || ''}`,
        },
        body: JSON.stringify({ remark }),
      });
      if (res.ok) {
        setAllMiniProgramData(prev => prev.map(r => r.id === id ? { ...r, remark } : r));
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }, []);

  useEffect(() => {
    if (activeTab === 'mini_program') fetchMiniProgramData(miniProgramDateFilter[0], miniProgramDateFilter[1]);
  }, [miniProgramDateFilter, fetchMiniProgramData, activeTab]);

  const fetchOrderPageData = useCallback(async (sd?: string | null, ed?: string | null) => {
    setOrderPageLoading(true);
    try {
      let fetchStart = sd;
      if (sd && ed) {
        const span = daysBetween(sd, ed);
        const prevStart = new Date(new Date(sd).getTime() - span * 86400000);
        fetchStart = formatLocalDate(prevStart);
      }
      const params = new URLSearchParams();
      if (fetchStart) params.set('start_date', fetchStart);
      if (ed) params.set('end_date', ed);
      const res = await fetch(`${REVIEW_PARTNER_ORDER_PAGE_ENDPOINT}?${params}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('blue_os_token') || ''}` }
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          const rows = json.data.map((r: any) => {
            let dateStr = r.stat_date;
            if (typeof dateStr === 'string' && dateStr.length > 10) dateStr = dateStr.slice(0, 10);
            return { ...r, date: dateStr };
          });
          setAllOrderPageData(rows);
        }
      }
    } catch (e) {
      // ignore
    } finally {
      setOrderPageLoading(false);
    }
  }, []);

  const { orderPageData, prevOrderPageData } = useMemo(() => {
    const [sd, ed] = orderPageDateFilter;
    if (!sd || !ed) return { orderPageData: allOrderPageData, prevOrderPageData: [] as OrderPageRow[] };
    return {
      orderPageData: allOrderPageData.filter(r => r.date >= sd && r.date <= ed),
      prevOrderPageData: allOrderPageData.filter(r => r.date < sd && r.date >= fetchStartForPrev(sd, ed)),
    };
  }, [allOrderPageData, orderPageDateFilter]);

  useEffect(() => {
    if (activeTab === 'order_page') fetchOrderPageData(orderPageDateFilter[0], orderPageDateFilter[1]);
  }, [orderPageDateFilter, fetchOrderPageData, activeTab]);


  function handleApplyDate() {
    if (startDate && endDate && startDate <= endDate) {
      setDateRange([startDate, endDate]);
      setAdZoneDateFilter([startDate, endDate]);
      setMiniProgramDateFilter([startDate, endDate]);
      setOrderPageDateFilter([startDate, endDate]);
      setTransactionDateFilter([startDate, endDate]);
      setQuickRange(0); // 自定义日期时取消快捷高亮
    }
  }

  // 快速时间切换
  function handleQuickRange(days: number) {
    setQuickRange(days);
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    const sd = formatLocalDate(start);
    const ed = formatLocalDate(today);
    setStartDate(sd);
    setEndDate(ed);
    setDateRange([sd, ed]);
    setAdZoneDateFilter([sd, ed]);
    setMiniProgramDateFilter([sd, ed]);
    setOrderPageDateFilter([sd, ed]);
    setTransactionDateFilter([sd, ed]);
  }

  return (
    <div className="h-full flex flex-col bg-slate-50 text-slate-800">
      {/* 顶部控制栏 */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-200 bg-white">
        <h2 className="text-lg font-bold text-slate-800 whitespace-nowrap">复盘搭子</h2>
        <div className="flex items-center gap-2 ml-auto">
          {/* 快速时间切换 */}
          <div className="flex items-center gap-1 mr-2">
            {[7, 30, 60, 90].map(d => (
              <button
                key={d}
                onClick={() => handleQuickRange(d)}
                className={`px-2 py-1 text-xs rounded border transition ${
                  quickRange === d
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'border-slate-200 text-slate-500 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600'
                }`}
              >
                {d}天
              </button>
            ))}
          </div>
          <label className="text-sm text-slate-500">开始</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="bg-white border border-slate-300 rounded px-2 py-1 text-sm text-slate-700 focus:outline-none focus:border-blue-500"
          />
          <label className="text-sm text-slate-500">结束</label>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="bg-white border border-slate-300 rounded px-2 py-1 text-sm text-slate-700 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleApplyDate}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-1 rounded transition"
          >
            查询
          </button>
        </div>
      </div>

      {/* Tab 页签 */}
      <div className="flex border-b border-slate-200 px-6 bg-white">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition border-b-2 ${
              activeTab === tab.key
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 flex flex-col min-h-0 relative">
        {adZoneLoading && (
          <div className="absolute inset-0 bg-white/60 z-10 flex items-center justify-center">
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">加载中...</span>
            </div>
          </div>
        )}
        {activeTab === 'mini_program' && <div className="flex-1 overflow-auto p-6"><MiniProgramTab data={miniProgramData} prevData={prevMiniProgramData} loading={miniProgramLoading} onUploadSuccess={() => fetchMiniProgramData(miniProgramDateFilter[0], miniProgramDateFilter[1])} onRemarkSave={handleRemarkSave} /></div>}
        {activeTab === 'order_page' && <div className="flex-1 overflow-auto p-6"><OrderPageTab data={orderPageData} prevData={prevOrderPageData} loading={orderPageLoading} onUploadSuccess={() => fetchOrderPageData(orderPageDateFilter[0], orderPageDateFilter[1])} /></div>}
        {activeTab === 'transaction' && <div className="flex-1 overflow-auto p-6"><TransactionTab data={transactionData} prevData={prevTransactionData} loading={transactionLoading} onUploadSuccess={() => fetchTransactionData(transactionDateFilter[0], transactionDateFilter[1])} /></div>}
        {activeTab === 'ad_zone' && <div className="flex-1 overflow-auto p-6"><AdZoneTab data={adZoneData} prevData={prevAdZoneData} loading={adZoneLoading} onUploadSuccess={() => fetchAdZoneData(adZoneDateFilter[0], adZoneDateFilter[1])} /></div>}
      </div>
    </div>
  );
}

// ─── Tab 1: 小程序访问情况 ──────────────────────────────────────────
function MiniProgramTab({ data, prevData, loading, onUploadSuccess, onRemarkSave }: {
  data: MiniProgramRow[];
  prevData?: MiniProgramRow[];
  loading?: boolean;
  onUploadSuccess?: () => void;
  onRemarkSave?: (id: number, remark: string) => Promise<boolean>;
}) {
  const [uvPvFile, setUvPvFile] = useState<File | null>(null);
  const [coreMetricsFile, setCoreMetricsFile] = useState<File | null>(null);
  const [clickJsonFile, setClickJsonFile] = useState<File | null>(null);
  const [beginDate, setBeginDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingRemark, setEditingRemark] = useState<{ id: number; value: string } | null>(null);
  const [showAvg, setShowAvg] = useState(false);
  const [avgRawData, setAvgRawData] = useState<MiniProgramRow[] | null>(null);
  const [avgLoading, setAvgLoading] = useState(false);
  const uvPvFileRef = useRef<HTMLInputElement>(null);
  const coreMetricsFileRef = useRef<HTMLInputElement>(null);
  const clickJsonFileRef = useRef<HTMLInputElement>(null);
  const [showColSettings, setShowColSettings] = useState(false);
  const [miniAnchorPos, setMiniAnchorPos] = useState<{ top: number; left: number } | null>(null);
  const MINI_COLS: ColDef[] = [
    { key: 'date', label: '日期', fixed: true },
    { key: 'yz_users', label: '羊城通用户数' },
    { key: 'yz_views', label: '羊城通曝光次数' },
    { key: 'scan_users', label: '刷码页用户数' },
    { key: 'scan_views', label: '刷码页曝光次数' },
    { key: 'display_rate', label: '展示率' },
    { key: 'dau', label: '刷码页DAU' },
    { key: 'dau_ratio', label: '刷码页DAU占比率' },
    { key: 'churn_rate', label: '出行搭子访问流失率' },
    { key: 'conversion_rate', label: '出行搭子访问转化率' },
    { key: 'partner_visits', label: '出行搭子访问数' },
    { key: 'jump_rate', label: '刷码跳转率' },
    { key: 'transaction_users', label: '交易人数' },
    { key: 'tx_rate', label: '交易率' },
    { key: 'remark', label: '备注' },
  ];
  const miniCol = useColumnVisibility('review_mini_program_cols', MINI_COLS);
  const MINI_COL_KEYS = ['date','yz_users','yz_views','scan_users','scan_views','display_rate','dau','dau_ratio','churn_rate','conversion_rate','partner_visits','jump_rate','transaction_users','tx_rate','remark'] as const;

  const chartData = useMemo(() => {
    // 数据库返回按日期降序，图表需要从旧到新（左→右）
    const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.map(r => ({
      date: formatDate(r.date),
      刷码页用户数: Number(r.scan_users) || 0,
      曝光次数: Number(r.scan_views) || 0,
      出行搭子访问数: Number(r.partner_visits) || 0,
    }));
  }, [data]);

  const fetchAvgData = async () => {
    setAvgLoading(true);
    try {
      const res = await fetch(REVIEW_PARTNER_MINI_PROGRAM_AVG_ENDPOINT, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('blue_os_token') || ''}` },
      });
      const json = await res.json();
      if (json.success && json.data) {
        setAvgRawData(json.data.map((r: any) => ({
          date: r.stat_date,
          scan_users: Number(r.scan_users) || 0,
          scan_views: Number(r.scan_views) || 0,
          partner_visits: Number(r.partner_visits) || 0,
          yz_users: Number(r.yz_users) || 0,
          yz_views: Number(r.yz_views) || 0,
          dau: Number(r.dau) || 0,
          display_rate: Number(r.display_rate) || 0,
          transaction_users: Number(r.transaction_users) || 0,
          remark: '',
        })));
      }
    } catch { /* ignore */ }
    setAvgLoading(false);
  };

  const avgData = useMemo(() => {
    if (!avgRawData?.length || !showAvg) return null;
    const today = new Date();
    const dow = today.getDay();
    const lastMon = new Date(today);
    lastMon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) - 7);
    const prevMon = new Date(lastMon);
    prevMon.setDate(lastMon.getDate() - 7);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const calcPeriod = (dates: string[]) => {
      const rows = avgRawData.filter(r => dates.includes(r.date));
      const n = rows.length;
      if (n === 0) return null;
      const u = rows.reduce((s, r) => s + (Number(r.scan_users) || 0), 0);
      const v = rows.reduce((s, r) => s + (Number(r.scan_views) || 0), 0);
      const pv = rows.reduce((s, r) => s + (Number(r.partner_visits) || 0), 0);
      const yzu = rows.reduce((s, r) => s + (Number(r.yz_users) || 0), 0);
      const yzv = rows.reduce((s, r) => s + (Number(r.yz_views) || 0), 0);
      const dauSum = rows.reduce((s, r) => s + (Number(r.dau) || 0), 0);
      const txUsers = rows.reduce((s, r) => s + (Number(r.transaction_users) || 0), 0);
      const rateNum = u > 0 ? pv / u * 100 : 0;
      const dauAvg = dauSum / n;
      const yzuAvg = yzu / n;
      const uAvg = u / n;
      const dauRatioNum = yzuAvg > 0 ? dauAvg / yzuAvg * 100 : 0;
      const displayRateNum = yzuAvg > 0 ? uAvg / yzuAvg * 100 : 0;
      const pvAvg = pv / n;
      const txUsersAvg = txUsers / n;
      const txRateNum = pvAvg > 0 ? txUsersAvg / pvAvg * 100 : 0;
      return { u: Math.round(u / n), v: Math.round(v / n), pv: Math.round(pv / n), rate: rateNum.toFixed(2), rateNum, displayRate: displayRateNum.toFixed(2), displayRateNum, yzu: Math.round(yzu / n), yzv: Math.round(yzv / n), dau: Math.round(dauSum / n), dauRatio: dauRatioNum.toFixed(2), dauRatioNum, txUsers: Math.round(txUsers / n), txRate: txRateNum.toFixed(2), txRateNum };
    };
    const lastWeekDates = Array.from({ length: 7 }, (_, i) => { const d = new Date(lastMon); d.setDate(lastMon.getDate() + i); return fmt(d); });
    const prevWeekDates = Array.from({ length: 7 }, (_, i) => { const d = new Date(prevMon); d.setDate(prevMon.getDate() + i); return fmt(d); });
    const tw = calcPeriod(lastWeekDates);
    const lw = calcPeriod(prevWeekDates);
    const year = today.getFullYear();
    const months = [3, 4, 5, 6, 7];
    const ma: Record<number, ReturnType<typeof calcPeriod>> = {};
    for (const m of months) {
      const prefix = `${year}-${String(m).padStart(2, '0')}`;
      const dates = avgRawData.filter(r => r.date.startsWith(prefix)).map(r => r.date);
      ma[m] = calcPeriod(dates);
    }
    return { tw, lw, ma };
  }, [avgRawData, showAvg]);

  const openModal = () => {
    setUvPvFile(null);
    setCoreMetricsFile(null);
    setClickJsonFile(null);
    setResult(null);
    // 默认上周1和周日
    const today = new Date();
    const dow = today.getDay();
    const daysBack = dow === 0 ? 6 : dow + 6;
    const lastMon = new Date(today);
    lastMon.setDate(today.getDate() - daysBack);
    const lastSun = new Date(lastMon);
    lastSun.setDate(lastMon.getDate() + 6);
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    setBeginDate(fmt(lastMon));
    setEndDate(fmt(lastSun));
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setUvPvFile(null); setCoreMetricsFile(null); setClickJsonFile(null); setBeginDate(''); setEndDate(''); };

  const handleUpload = async () => {
    if (!uvPvFile) { setResult({ success: false, message: '请选择 UV-PV 数据文件' }); return; }
    if (!coreMetricsFile) { setResult({ success: false, message: '请选择核心指标数据文件' }); return; }
    if (!clickJsonFile) { setResult({ success: false, message: '请选择点击数据文件' }); return; }
    if (!beginDate || !endDate) { setResult({ success: false, message: '请选择开始日期和结束日期' }); return; }
    if (beginDate > endDate) { setResult({ success: false, message: '开始日期不能晚于结束日期' }); return; }
    setUploading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('uv_pv', uvPvFile);
      formData.append('core_metrics', coreMetricsFile);
      formData.append('click_json', clickJsonFile);
      formData.append('begin_date', beginDate.replace(/-/g, ''));
      formData.append('end_date', endDate.replace(/-/g, ''));
      const res = await fetch(REVIEW_PARTNER_MINI_PROGRAM_UPLOAD_ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('blue_os_token') || ''}` },
        body: formData,
      });
      if (!res.ok) {
        let msg = `请求失败 (${res.status})`;
        try { const err = await res.json(); msg = err.message || msg; } catch {}
        setResult({ success: false, message: msg });
        return;
      }
      const json = await res.json();
      if (json.success) {
        setResult({ success: true, message: json.message || '数据整理完成' });
        setUvPvFile(null); setCoreMetricsFile(null); setClickJsonFile(null);
        if (uvPvFileRef.current) uvPvFileRef.current.value = '';
        if (coreMetricsFileRef.current) coreMetricsFileRef.current.value = '';
        if (clickJsonFileRef.current) clickJsonFileRef.current.value = '';
        onUploadSuccess?.();
      } else {
        setResult({ success: false, message: json.message || '上传失败' });
      }
    } catch (err: any) {
      setResult({ success: false, message: err.message || '网络错误' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="overflow-auto">
      {loading ? (
        <div className="flex items-center gap-2 py-12 justify-center text-slate-400"><Loader2 className="w-4 h-4 animate-spin" />加载中...</div>
      ) : (
        <div className="space-y-6">
          {/* 指标卡 */}
          {(() => {
            const n = data.length || 1;
            const curUsers = data.reduce((s, r) => s + (Number(r.scan_users) || 0), 0);
            const curViews = data.reduce((s, r) => s + (Number(r.scan_views) || 0), 0);
            const curVisits = data.reduce((s, r) => s + (Number(r.partner_visits) || 0), 0);
            const avgUsers = Math.round(curUsers / n);
            const avgViews = Math.round(curViews / n);
            const avgVisits = Math.round(curVisits / n);
            const todayDau = data.length > 0 ? (Number(data[0].dau) || 0) : 0;
            const yesterdayDau = data.length > 1 ? (Number(data[1].dau) || 0) : 0;
            const today = new Date();
            const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
            const monthAgo = new Date(today); monthAgo.setDate(today.getDate() - 30);
            const weekStr = weekAgo.toISOString().slice(0, 10);
            const monthStr = monthAgo.toISOString().slice(0, 10);
            const weekRows = data.filter(r => r.date >= weekStr);
            const monthRows = data.filter(r => r.date >= monthStr);
            const weekAvgDau = weekRows.length > 0 ? Math.round(weekRows.reduce((s, r) => s + (Number(r.dau) || 0), 0) / weekRows.length) : 0;
            const monthAvgDau = monthRows.length > 0 ? Math.round(monthRows.reduce((s, r) => s + (Number(r.dau) || 0), 0) / monthRows.length) : 0;
            const prev = prevData ?? [];
            const pn = prev.length || 1;
            const curYzUsers = data.reduce((s, r) => s + (Number(r.yz_users) || 0), 0);
            const avgYzUsersForRate = curYzUsers / n;
            const avgScanUsersForRate = curUsers / n;
            const avgDisplayRate = avgYzUsersForRate > 0 ? (avgScanUsersForRate / avgYzUsersForRate * 100) : 0;
            const avgYzUsers = Math.round(curYzUsers / n);
            const avgDau = Math.round(data.reduce((s, r) => s + (Number(r.dau) || 0), 0) / n);
            const dauRatio = avgYzUsers > 0 ? (avgDau / avgYzUsers * 100) : 0;
            const prevDauRatio = pn > 0 && Math.round(prev.reduce((s, r) => s + (Number(r.yz_users) || 0), 0) / pn) > 0
              ? (Math.round(prev.reduce((s, r) => s + (Number(r.dau) || 0), 0) / pn) / Math.round(prev.reduce((s, r) => s + (Number(r.yz_users) || 0), 0) / pn) * 100) : 0;
            const curTxUsers = data.reduce((s, r) => s + (Number(r.transaction_users) || 0), 0);
            const avgTxUsers = Math.round(curTxUsers / n);
            const prevTxUsers = prev.reduce((s, r) => s + (Number(r.transaction_users) || 0), 0);
            const prevAvgTxUsers = Math.round(prevTxUsers / pn);
            const curRate = curUsers > 0 ? (curVisits / curUsers) * 100 : 0;
            const prevUsers = prev.reduce((s, r) => s + (Number(r.scan_users) || 0), 0);
            const prevViews = prev.reduce((s, r) => s + (Number(r.scan_views) || 0), 0);
            const prevVisits = prev.reduce((s, r) => s + (Number(r.partner_visits) || 0), 0);
            const prevAvgUsers = Math.round(prevUsers / pn);
            const prevAvgViews = Math.round(prevViews / pn);
            const prevAvgVisits = Math.round(prevVisits / pn);
            const prevRate = prevUsers > 0 ? (prevVisits / prevUsers) * 100 : 0;
            const hb = (cur: number, prv: number) => {
              if (prv === 0) return null;
              return ((cur - prv) / prv * 100).toFixed(1);
            };
            const cards = [
              { label: '日均刷码用户', desc: 'AVG(刷码页用户数)', value: avgUsers.toLocaleString(), color: 'text-blue-600', bg: 'bg-blue-50', hbVal: hb(avgUsers, prevAvgUsers) },
              { label: '日均曝光次数', desc: 'AVG(刷码页曝光次数)', value: avgViews.toLocaleString(), color: 'text-emerald-600', bg: 'bg-emerald-50', hbVal: hb(avgViews, prevAvgViews) },
              { label: '展示率', desc: '刷码页用户数/羊城通用户数', value: avgDisplayRate.toFixed(2) + '%', color: 'text-pink-600', bg: 'bg-pink-50', hbVal: null },
              { label: '每日刷码页DAU', desc: '最新日DAU', value: todayDau.toLocaleString(), color: 'text-indigo-600', bg: 'bg-indigo-50', hbVal: hb(todayDau, yesterdayDau) },
              { label: '周均刷码页DAU', desc: '近7天AVG', value: weekAvgDau.toLocaleString(), color: 'text-indigo-600', bg: 'bg-indigo-50', hbVal: null },
              { label: '月均刷码页DAU', desc: '近30天AVG', value: monthAvgDau.toLocaleString(), color: 'text-indigo-600', bg: 'bg-indigo-50', hbVal: null },
              { label: '刷码页DAU占比率', desc: 'DAU/羊城通用户数', value: dauRatio.toFixed(2) + '%', color: 'text-orange-600', bg: 'bg-orange-50', hbVal: prev.length > 0 ? (dauRatio - prevDauRatio).toFixed(2) + 'pp' : null },
              { label: '日均出行搭子访问', desc: 'AVG(出行搭子访问数)', value: avgVisits.toLocaleString(), color: 'text-amber-600', bg: 'bg-amber-50', hbVal: hb(avgVisits, prevAvgVisits) },
              { label: '平均刷码跳转率', desc: '出行搭子访问数/刷码页用户数', value: curRate.toFixed(2) + '%', color: 'text-purple-600', bg: 'bg-purple-50', hbVal: prev.length > 0 ? (curRate - prevRate).toFixed(2) + 'pp' : null },
              { label: '日均交易人数', desc: 'AVG(交易人数)', value: avgTxUsers.toLocaleString(), color: 'text-rose-600', bg: 'bg-rose-50', hbVal: hb(avgTxUsers, prevAvgTxUsers) },
            ];
            const row1 = cards.slice(0, 5);
            const row2 = cards.slice(5, 10);
            const renderCard = (c: typeof cards[0]) => (
              <div key={c.label} className={`${c.bg} rounded-lg p-4 border border-slate-100`}>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs text-slate-500">{c.label}</span>
                  <span className="text-[10px] text-slate-400">{c.desc}</span>
                </div>
                <div className={`text-2xl font-bold ${c.color} mt-1`}>{c.value}</div>
                {c.hbVal !== null && (
                  <div className={`text-xs mt-1 ${(c.label === '平均刷码跳转率' || c.label === '刷码页DAU占比率') ? (parseFloat(c.hbVal) >= 0 ? 'text-purple-500' : 'text-slate-400') : (parseFloat(c.hbVal) >= 0 ? 'text-emerald-500' : 'text-red-500')}`}>
                    环比 {parseFloat(c.hbVal) >= 0 ? '↑' : '↓'} {Math.abs(parseFloat(c.hbVal))}{(c.label === '平均刷码跳转率' || c.label === '刷码页DAU占比率') ? '' : '%'}
                  </div>
                )}
                {c.hbVal === null && <div className="text-xs mt-1 text-slate-400">环比 -</div>}
              </div>
            );
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">{row1.map(renderCard)}</div>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">{row2.map(renderCard)}</div>
              </div>
            );
          })()}

          {/* 访问趋势 */}
          <div className="bg-white rounded-lg p-4 shadow-sm border border-slate-200">
            <div className="flex items-center mb-1">
              <h3 className="text-sm font-medium text-slate-600">访问趋势</h3>
            </div>
            <p className="text-[11px] text-slate-400 mb-3">双 Y 轴：左轴 用户/曝光，右轴 出行搭子</p>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" stroke="#64748b" fontSize={12} />
                <YAxis yAxisId="left" stroke="#64748b" fontSize={12} />
                <YAxis yAxisId="right" orientation="right" stroke="#FBBF24" fontSize={12} />
                <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }} />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="刷码页用户数" stroke="#60A5FA" strokeWidth={2} dot={false} />
                <Line yAxisId="left" type="monotone" dataKey="曝光次数" stroke="#34D399" strokeWidth={2} dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="出行搭子访问数" stroke="#FBBF24" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* 数据表格 */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200">
            <div className="flex items-center px-4 py-3 border-b border-slate-100">
              <h3 className="text-sm font-medium text-slate-600">数据表格</h3>
              <button onClick={() => { setShowAvg(v => { if (!v) fetchAvgData(); return !v; }); }}
                disabled={avgLoading}
                className={`ml-2 flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border transition whitespace-nowrap ${avgLoading ? 'bg-blue-50 border-blue-200 text-blue-400 cursor-wait' : showAvg ? 'bg-blue-50 border-blue-300 text-blue-600' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
                {avgLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : showAvg ? '✓' : null}周/月日均
              </button>
              <button onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMiniAnchorPos({ top: r.top, left: r.left }); setShowColSettings(true); }}
                className="ml-2 px-1.5 py-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-400 transition" title="列设置">
                <Settings className="w-3.5 h-3.5" />
              </button>
              <button onClick={openModal}
                className="ml-auto flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded transition whitespace-nowrap">
                <Upload className="w-3 h-3" />上传文件
              </button>
              <button
                onClick={() => {
                  const _labelMap: Record<string, string> = { date:'日期', yz_users:'羊城通用户数', yz_views:'羊城通曝光次数', scan_users:'刷码页用户数', scan_views:'刷码页曝光次数', display_rate:'展示率', dau:'刷码页DAU', dau_ratio:'刷码页DAU占比率', conversion_rate:'出行搭子访问转化率', churn_rate:'出行搭子访问流失率', partner_visits:'出行搭子访问数', jump_rate:'刷码跳转率', transaction_users:'交易人数', tx_rate:'交易率', remark:'备注' };
                  const visKeys = MINI_COL_KEYS.filter(k => miniCol.visible.has(k));
                  const headers = visKeys.map(k => _labelMap[k]);
                  const rows = data.map(r => {
                    const rate = Number(r.scan_users) > 0 ? ((Number(r.partner_visits) / Number(r.scan_users)) * 100).toFixed(2) + '%' : '-';
                    const displayRate = Number(r.yz_users) > 0 ? (Number(r.scan_users) / Number(r.yz_users) * 100).toFixed(2) + '%' : '-';
                    const dauRatio = Number(r.yz_users) > 0 ? (Number(r.dau) / Number(r.yz_users) * 100).toFixed(2) + '%' : '-';
                    const txRate = Number(r.partner_visits) > 0 ? ((Number(r.transaction_users || 0) / Number(r.partner_visits)) * 100).toFixed(2) + '%' : '-';
                    const convRate = Number(r.dau) > 0 ? ((Number(r.partner_visits) / Number(r.dau)) * 100).toFixed(2) + '%' : '-';
                    const churnRate = Number(r.dau) > 0 ? ((1 - Number(r.partner_visits) / Number(r.dau)) * 100).toFixed(2) + '%' : '-';
                    const _v: Record<string, any> = { date: r.date, yz_users: r.yz_users, yz_views: r.yz_views, scan_users: r.scan_users, scan_views: r.scan_views, display_rate: displayRate, dau: r.dau, dau_ratio: dauRatio, conversion_rate: convRate, churn_rate: churnRate, partner_visits: r.partner_visits, jump_rate: rate, transaction_users: r.transaction_users || 0, tx_rate: txRate, remark: r.remark || '' };
                    return visKeys.map(k => _v[k]);
                  });
                  const allRows = [headers, ...rows];
                  if (showAvg && avgData) {
                    const fmtHb = (cur: number, prev: number) => prev > 0 ? `${((cur - prev) / prev * 100).toFixed(1)}%` : '-';
                    const buildAvgRow = (label: string, d: any, isHb = false) => {
                      const _av: Record<string, any> = isHb ? {
                        yz_users: avgData.tw && avgData.lw ? fmtHb(avgData.tw.yzu, avgData.lw.yzu) : '-',
                        yz_views: avgData.tw && avgData.lw ? fmtHb(avgData.tw.yzv, avgData.lw.yzv) : '-',
                        scan_users: avgData.tw && avgData.lw ? fmtHb(avgData.tw.u, avgData.lw.u) : '-',
                        scan_views: avgData.tw && avgData.lw ? fmtHb(avgData.tw.v, avgData.lw.v) : '-',
                        display_rate: avgData.tw && avgData.lw && avgData.lw.displayRateNum > 0 ? fmtHb(avgData.tw.displayRateNum, avgData.lw.displayRateNum) : '-',
                        dau: avgData.tw && avgData.lw ? fmtHb(avgData.tw.dau, avgData.lw.dau) : '-',
                        dau_ratio: avgData.tw && avgData.lw && avgData.lw.dauRatioNum > 0 ? fmtHb(avgData.tw.dauRatioNum, avgData.lw.dauRatioNum) : '-',
                        conversion_rate: (() => { const twN = avgData.tw && avgData.tw.dau > 0 ? avgData.tw.pv / avgData.tw.dau * 100 : 0; const lwN = avgData.lw && avgData.lw.dau > 0 ? avgData.lw.pv / avgData.lw.dau * 100 : 0; return avgData.tw && avgData.lw && lwN > 0 ? fmtHb(twN, lwN) : '-'; })(),
                        churn_rate: (() => { const twN = avgData.tw && avgData.tw.dau > 0 ? (1 - avgData.tw.pv / avgData.tw.dau) * 100 : 0; const lwN = avgData.lw && avgData.lw.dau > 0 ? (1 - avgData.lw.pv / avgData.lw.dau) * 100 : 0; return avgData.tw && avgData.lw && lwN > 0 ? fmtHb(twN, lwN) : '-'; })(),
                        partner_visits: avgData.tw && avgData.lw ? fmtHb(avgData.tw.pv, avgData.lw.pv) : '-',
                        jump_rate: avgData.tw && avgData.lw && avgData.lw.rateNum > 0 ? fmtHb(avgData.tw.rateNum, avgData.lw.rateNum) : '-',
                        transaction_users: avgData.tw && avgData.lw ? fmtHb(avgData.tw.txUsers, avgData.lw.txUsers) : '-',
                        tx_rate: avgData.tw && avgData.lw && avgData.lw.txRateNum > 0 ? fmtHb(avgData.tw.txRateNum, avgData.lw.txRateNum) : '-',
                        remark: '',
                      } : {
                        yz_users: d?.yzu ?? '-', yz_views: d?.yzv ?? '-',
                        scan_users: d?.u ?? '-', scan_views: d?.v ?? '-',
                        display_rate: d?.displayRate ? `${d.displayRate}%` : '-',
                        dau: d?.dau ?? '-', dau_ratio: d?.dauRatio ? `${d.dauRatio}%` : '-',
                        conversion_rate: d?.dau > 0 ? `${(d.pv / d.dau * 100).toFixed(2)}%` : '-',
                        churn_rate: d?.dau > 0 ? `${((1 - d.pv / d.dau) * 100).toFixed(2)}%` : '-',
                        partner_visits: d?.pv ?? '-',
                        jump_rate: d?.rate ? `${d.rate}%` : '-',
                        transaction_users: d?.txUsers ?? '-',
                        tx_rate: d?.txRate ? `${d.txRate}%` : '-',
                        remark: '',
                      };
                      return [label, ...visKeys.filter(k => k !== 'date').map(k => _av[k])];
                    };
                    allRows.push(buildAvgRow('上周日均', avgData.tw));
                    allRows.push(buildAvgRow('上上周日均', avgData.lw));
                    allRows.push(buildAvgRow('周环比', null, true));
                    for (const m of [3, 4, 5, 6, 7]) {
                      allRows.push(buildAvgRow(`${m}月平均`, avgData.ma[m]));
                    }
                  }
                  const csv = '\uFEFF' + allRows.map(r => r.map((c: any) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
                  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = `小程序访问数据_${new Date().toISOString().slice(0, 10)}.csv`;
                  a.click(); URL.revokeObjectURL(url);
                }}
                className="ml-2 flex items-center gap-1 px-3 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-600 text-xs font-medium rounded transition whitespace-nowrap"
              >
                <Download className="w-3 h-3" />下载数据
              </button>
            </div>
            <div className="overflow-x-auto relative">
              {avgLoading && (
                <div className="absolute inset-0 bg-white/60 z-10 flex items-center justify-center gap-2 text-sm text-blue-500">
                  <Loader2 className="w-4 h-4 animate-spin" />加载5个月数据中...
                </div>
              )}
              <table className="text-sm" style={{ tableLayout: 'auto', width: '100%', minWidth: 'fit-content' }}>
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {MINI_COL_KEYS.filter(k => miniCol.visible.has(k)).map(k => {
                      const cls = `py-2.5 px-3 text-slate-500 font-medium whitespace-nowrap${k === 'date' ? ' text-left' : k === 'remark' ? ' text-left min-w-[320px]' : ' text-right'}`;
                      const labels: Record<string, any> = {
                        date: '日期', yz_users: '羊城通用户数', yz_views: '羊城通曝光次数',
                        scan_users: '刷码页用户数', scan_views: '刷码页曝光次数',
                        display_rate: <span title="刷码页用户数 / 羊城通用户数 × 100%">展示率 <Info className="inline w-3 h-3 text-slate-400 cursor-help" /></span>,
                        dau: '刷码页DAU',
                        dau_ratio: <span title="刷码页DAU / 羊城通用户数 × 100%"><span className="inline-flex items-start gap-1"><span className="flex flex-col items-center leading-tight"><span>刷码页DAU</span><span>占比率</span></span><Info className="w-3 h-3 text-slate-400 cursor-help shrink-0 mt-0.5" /></span></span>,
                        conversion_rate: <span title="出行搭子访问数 / 刷码页DAU × 100%"><span className="inline-flex items-start gap-1"><span className="flex flex-col items-center leading-tight"><span>出行搭子访问</span><span>转化率</span></span><Info className="w-3 h-3 text-slate-400 cursor-help shrink-0 mt-0.5" /></span></span>,
                        churn_rate: <span title="(1 - 出行搭子访问数 / 刷码页DAU) × 100%"><span className="inline-flex items-start gap-1"><span className="flex flex-col items-center leading-tight"><span>出行搭子访问</span><span>流失率</span></span><Info className="w-3 h-3 text-slate-400 cursor-help shrink-0 mt-0.5" /></span></span>,
                        partner_visits: '出行搭子访问数',
                        jump_rate: <span title="出行搭子访问数 / 刷码页用户数 × 100%">刷码跳转率 <Info className="inline w-3 h-3 text-slate-400 cursor-help" /></span>,
                        transaction_users: '交易人数',
                        transaction_count: '交易笔数',
                        tx_count_rate: <span title="交易笔数 / 交易人数 × 100%">交易笔数转化率 <Info className="inline w-3 h-3 text-slate-400 cursor-help" /></span>,
                        tx_rate: <span title="交易人数 / 出行搭子访问数 × 100%">交易率 <Info className="inline w-3 h-3 text-slate-400 cursor-help" /></span>,
                        remark: '备注',
                      };
                      return <th key={k} className={cls}>{labels[k]}</th>;
                    })}
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => {
                    const rate = Number(r.scan_users) > 0 ? ((Number(r.partner_visits) / Number(r.scan_users)) * 100).toFixed(2) : '0.00';
                    const displayRate = Number(r.yz_users) > 0 ? (Number(r.scan_users) / Number(r.yz_users) * 100).toFixed(2) : '0.00';
                    const dauRatio = Number(r.yz_users) > 0 ? (Number(r.dau) / Number(r.yz_users) * 100).toFixed(2) : '0.00';
                    const txRate = Number(r.partner_visits) > 0 ? (Number(r.transaction_users || 0) / Number(r.partner_visits) * 100).toFixed(2) : '0.00';
                    const convRate = Number(r.dau) > 0 ? (Number(r.partner_visits) / Number(r.dau) * 100).toFixed(2) : '0.00';
                    const churnRate = Number(r.dau) > 0 ? ((1 - Number(r.partner_visits) / Number(r.dau)) * 100).toFixed(2) : '0.00';
                    const _cells: Record<string, React.ReactNode> = {
                      date: <td key="date" className="py-2 px-3 text-slate-700 whitespace-nowrap">{r.date}</td>,
                      yz_users: <td key="yz_users" className="py-2 px-3 text-right text-cyan-600 tabular-nums">{Number(r.yz_users).toLocaleString()}</td>,
                      yz_views: <td key="yz_views" className="py-2 px-3 text-right text-teal-600 tabular-nums">{Number(r.yz_views).toLocaleString()}</td>,
                      scan_users: <td key="scan_users" className="py-2 px-3 text-right text-blue-600 tabular-nums">{Number(r.scan_users).toLocaleString()}</td>,
                      scan_views: <td key="scan_views" className="py-2 px-3 text-right text-emerald-600 tabular-nums">{Number(r.scan_views).toLocaleString()}</td>,
                      display_rate: <td key="display_rate" className="py-2 px-3 text-right text-pink-600 tabular-nums">{displayRate}%</td>,
                      dau: <td key="dau" className="py-2 px-3 text-right text-indigo-600 tabular-nums">{Number(r.dau).toLocaleString()}</td>,
                      dau_ratio: <td key="dau_ratio" className="py-2 px-3 text-center text-orange-600 tabular-nums">{dauRatio}%</td>,
                      conversion_rate: <td key="conversion_rate" className="py-2 px-3 text-center text-lime-600 tabular-nums">{convRate}%</td>,
                      churn_rate: <td key="churn_rate" className="py-2 px-3 text-center text-sky-600 tabular-nums">{churnRate}%</td>,
                      partner_visits: <td key="partner_visits" className="py-2 px-3 text-right text-amber-600 tabular-nums">{Number(r.partner_visits).toLocaleString()}</td>,
                      jump_rate: <td key="jump_rate" className="py-2 px-3 text-right text-purple-600 tabular-nums">{rate}%</td>,
                      transaction_users: <td key="transaction_users" className="py-2 px-3 text-right text-rose-600 tabular-nums">{Number(r.transaction_users || 0).toLocaleString()}</td>,
                      tx_rate: <td key="tx_rate" className="py-2 px-3 text-right text-fuchsia-600 tabular-nums">{txRate}%</td>,
                      remark: <td key="remark" className="py-2 px-3 min-w-[320px]">
                        {editingRemark?.id === r.id ? (
                          <input
                            autoFocus
                            value={editingRemark!.value}
                            onChange={e => setEditingRemark({ id: editingRemark!.id, value: e.target.value })}
                            onBlur={async () => {
                              if (r.id != null) {
                                await onRemarkSave?.(r.id, editingRemark!.value);
                                setEditingRemark(null);
                              }
                            }}
                            onKeyDown={async e => {
                              if (e.key === 'Enter' && r.id != null) {
                                await onRemarkSave?.(r.id, editingRemark!.value);
                                setEditingRemark(null);
                              }
                              if (e.key === 'Escape') setEditingRemark(null);
                            }}
                            className="w-full px-2 py-0.5 border border-blue-400 rounded text-sm outline-none focus:ring-1 focus:ring-blue-300"
                          />
                        ) : (
                          <span
                            onClick={() => setEditingRemark({ id: r.id!, value: r.remark || '' })}
                            className="cursor-pointer text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded px-1 py-0.5 -mx-1 block truncate"
                            title={r.remark || '点击编辑备注'}
                          >
                            {r.remark || '点击添加'}
                          </span>
                        )}
                      </td>,
                    };
                    return (
                    <tr key={r.date} className="border-b border-slate-100 hover:bg-blue-50/40 transition-colors">
                      {MINI_COL_KEYS.filter(k => miniCol.visible.has(k)).map(k => _cells[k])}
                    </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-sm">
                    {(() => {
                      const _f: Record<string, React.ReactNode> = {
                        date: <td key="date" className="py-2.5 px-3 text-slate-700">合计</td>,
                        yz_users: <td key="yz_users" className="py-2.5 px-3 text-right text-cyan-600 tabular-nums">{data.reduce((s, r) => s + (Number(r.yz_users) || 0), 0).toLocaleString()}</td>,
                        yz_views: <td key="yz_views" className="py-2.5 px-3 text-right text-teal-600 tabular-nums">{data.reduce((s, r) => s + (Number(r.yz_views) || 0), 0).toLocaleString()}</td>,
                        scan_users: <td key="scan_users" className="py-2.5 px-3 text-right text-blue-600 tabular-nums">{data.reduce((s, r) => s + (Number(r.scan_users) || 0), 0).toLocaleString()}</td>,
                        scan_views: <td key="scan_views" className="py-2.5 px-3 text-right text-emerald-600 tabular-nums">{data.reduce((s, r) => s + (Number(r.scan_views) || 0), 0).toLocaleString()}</td>,
                        display_rate: <td key="display_rate" className="py-2.5 px-3 text-right text-pink-600 tabular-nums">{(() => { const tYz = data.reduce((s, r) => s + (Number(r.yz_users) || 0), 0); const tSu = data.reduce((s, r) => s + (Number(r.scan_users) || 0), 0); return tSu > 0 ? `${(tYz / tSu * 100).toFixed(2)}%` : '-'; })()}</td>,
                        dau: <td key="dau" className="py-2.5 px-3 text-right text-indigo-600 tabular-nums">{data.reduce((s, r) => s + (Number(r.dau) || 0), 0).toLocaleString()}</td>,
                        dau_ratio: <td key="dau_ratio" className="py-2.5 px-3 text-center text-orange-600 tabular-nums">{(() => { const tDau = data.reduce((s, r) => s + (Number(r.dau) || 0), 0); const tYz = data.reduce((s, r) => s + (Number(r.yz_users) || 0), 0); return tYz > 0 ? `${(tDau / tYz * 100).toFixed(2)}%` : '-'; })()}</td>,
                        conversion_rate: <td key="conversion_rate" className="py-2.5 px-3 text-center text-lime-600 tabular-nums">{(() => { const tDau = data.reduce((s, r) => s + (Number(r.dau) || 0), 0); const tPv = data.reduce((s, r) => s + (Number(r.partner_visits) || 0), 0); return tDau > 0 ? `${(tPv / tDau * 100).toFixed(2)}%` : '-'; })()}</td>,
                        churn_rate: <td key="churn_rate" className="py-2.5 px-3 text-center text-sky-600 tabular-nums">{(() => { const tDau = data.reduce((s, r) => s + (Number(r.dau) || 0), 0); const tPv = data.reduce((s, r) => s + (Number(r.partner_visits) || 0), 0); return tDau > 0 ? `${((1 - tPv / tDau) * 100).toFixed(2)}%` : '-'; })()}</td>,
                        partner_visits: <td key="partner_visits" className="py-2.5 px-3 text-right text-amber-600 tabular-nums">{data.reduce((s, r) => s + (Number(r.partner_visits) || 0), 0).toLocaleString()}</td>,
                        jump_rate: <td key="jump_rate" className="py-2.5 px-3 text-right text-purple-600 tabular-nums">{(() => { const su = data.reduce((s, r) => s + (Number(r.scan_users) || 0), 0); const pv = data.reduce((s, r) => s + (Number(r.partner_visits) || 0), 0); return su > 0 ? `${((pv / su) * 100).toFixed(2)}%` : '-'; })()}</td>,
                        transaction_users: <td key="transaction_users" className="py-2.5 px-3 text-right text-rose-600 tabular-nums">{data.reduce((s, r) => s + (Number(r.transaction_users) || 0), 0).toLocaleString()}</td>,
                        tx_rate: <td key="tx_rate" className="py-2.5 px-3 text-right text-fuchsia-600 tabular-nums">{(() => { const tTx = data.reduce((s, r) => s + (Number(r.transaction_users) || 0), 0); const tPv = data.reduce((s, r) => s + (Number(r.partner_visits) || 0), 0); return tPv > 0 ? `${(tTx / tPv * 100).toFixed(2)}%` : '-'; })()}</td>,
                        remark: <td key="remark" className="py-2.5 px-3 text-center text-slate-400">-</td>,
                      };
                      return MINI_COL_KEYS.filter(k => miniCol.visible.has(k)).map(k => _f[k]);
                    })()}
                  </tr>
                  {showAvg && !avgLoading && avgData && (() => {
                    const hbPct = (cur: number, prev: number) => prev > 0 ? ((cur - prev) / prev * 100).toFixed(1) : null;
                    const hbCell = (cur: number, prev: number) => {
                      const v = hbPct(cur, prev);
                      if (v === null) return <span className="text-slate-300">-</span>;
                      return <span className={parseFloat(v) >= 0 ? 'text-emerald-500' : 'text-red-500'}>{parseFloat(v) >= 0 ? '+' : ''}{v}%</span>;
                    };
                    const avgRow = (label: string, d: any, isHb = false) => {
                      const _a: Record<string, React.ReactNode> = isHb ? {
                        yz_users: <td key="yz_users" className="py-2 px-3 text-right tabular-nums">{avgData.tw && avgData.lw ? hbCell(avgData.tw.yzu, avgData.lw.yzu) : <span className="text-slate-300">-</span>}</td>,
                        yz_views: <td key="yz_views" className="py-2 px-3 text-right tabular-nums">{avgData.tw && avgData.lw ? hbCell(avgData.tw.yzv, avgData.lw.yzv) : <span className="text-slate-300">-</span>}</td>,
                        scan_users: <td key="scan_users" className="py-2 px-3 text-right tabular-nums">{avgData.tw && avgData.lw ? hbCell(avgData.tw.u, avgData.lw.u) : <span className="text-slate-300">-</span>}</td>,
                        scan_views: <td key="scan_views" className="py-2 px-3 text-right tabular-nums">{avgData.tw && avgData.lw ? hbCell(avgData.tw.v, avgData.lw.v) : <span className="text-slate-300">-</span>}</td>,
                        display_rate: <td key="display_rate" className="py-2 px-3 text-right tabular-nums">{avgData.tw && avgData.lw && avgData.lw.displayRateNum > 0 ? hbCell(avgData.tw.displayRateNum, avgData.lw.displayRateNum) : <span className="text-slate-300">-</span>}</td>,
                        dau: <td key="dau" className="py-2 px-3 text-right tabular-nums">{avgData.tw && avgData.lw ? hbCell(avgData.tw.dau, avgData.lw.dau) : <span className="text-slate-300">-</span>}</td>,
                        dau_ratio: <td key="dau_ratio" className="py-2 px-3 text-center tabular-nums">{avgData.tw && avgData.lw && avgData.lw.dauRatioNum > 0 ? hbCell(avgData.tw.dauRatioNum, avgData.lw.dauRatioNum) : <span className="text-slate-300">-</span>}</td>,
                        conversion_rate: <td key="conversion_rate" className="py-2 px-3 text-center tabular-nums">{(() => { const twN = avgData.tw && avgData.tw.dau > 0 ? avgData.tw.pv / avgData.tw.dau * 100 : 0; const lwN = avgData.lw && avgData.lw.dau > 0 ? avgData.lw.pv / avgData.lw.dau * 100 : 0; return avgData.tw && avgData.lw && lwN > 0 ? hbCell(twN, lwN) : <span className="text-slate-300">-</span>; })()}</td>,
                        churn_rate: <td key="churn_rate" className="py-2 px-3 text-center tabular-nums">{(() => { const twN = avgData.tw && avgData.tw.dau > 0 ? (1 - avgData.tw.pv / avgData.tw.dau) * 100 : 0; const lwN = avgData.lw && avgData.lw.dau > 0 ? (1 - avgData.lw.pv / avgData.lw.dau) * 100 : 0; return avgData.tw && avgData.lw && lwN > 0 ? hbCell(twN, lwN) : <span className="text-slate-300">-</span>; })()}</td>,
                        partner_visits: <td key="partner_visits" className="py-2 px-3 text-right tabular-nums">{avgData.tw && avgData.lw ? hbCell(avgData.tw.pv, avgData.lw.pv) : <span className="text-slate-300">-</span>}</td>,
                        jump_rate: <td key="jump_rate" className="py-2 px-3 text-right tabular-nums">{avgData.tw && avgData.lw && avgData.lw.rateNum > 0 ? hbCell(avgData.tw.rateNum, avgData.lw.rateNum) : <span className="text-slate-300">-</span>}</td>,
                        transaction_users: <td key="transaction_users" className="py-2 px-3 text-right tabular-nums">{avgData.tw && avgData.lw ? hbCell(avgData.tw.txUsers, avgData.lw.txUsers) : <span className="text-slate-300">-</span>}</td>,
                        tx_rate: <td key="tx_rate" className="py-2 px-3 text-right tabular-nums">{avgData.tw && avgData.lw && avgData.lw.txRateNum > 0 ? hbCell(avgData.tw.txRateNum, avgData.lw.txRateNum) : <span className="text-slate-300">-</span>}</td>,
                        remark: <td key="remark" className="py-2 px-3 text-center text-slate-300">-</td>,
                      } : {
                        yz_users: <td key="yz_users" className="py-2 px-3 text-right text-cyan-600 tabular-nums">{d?.yzu?.toLocaleString() ?? '-'}</td>,
                        yz_views: <td key="yz_views" className="py-2 px-3 text-right text-teal-600 tabular-nums">{d?.yzv?.toLocaleString() ?? '-'}</td>,
                        scan_users: <td key="scan_users" className="py-2 px-3 text-right text-blue-600 tabular-nums">{d?.u?.toLocaleString() ?? '-'}</td>,
                        scan_views: <td key="scan_views" className="py-2 px-3 text-right text-emerald-600 tabular-nums">{d?.v?.toLocaleString() ?? '-'}</td>,
                        display_rate: <td key="display_rate" className="py-2 px-3 text-right text-pink-600 tabular-nums">{d?.displayRate ? `${d.displayRate}%` : '-'}</td>,
                        dau: <td key="dau" className="py-2 px-3 text-right text-indigo-600 tabular-nums">{d?.dau?.toLocaleString() ?? '-'}</td>,
                        dau_ratio: <td key="dau_ratio" className="py-2 px-3 text-center text-orange-600 tabular-nums">{d?.dauRatio ? `${d.dauRatio}%` : '-'}</td>,
                        conversion_rate: <td key="conversion_rate" className="py-2 px-3 text-center text-lime-600 tabular-nums">{d?.dau > 0 ? `${(d.pv / d.dau * 100).toFixed(2)}%` : '-'}</td>,
                        churn_rate: <td key="churn_rate" className="py-2 px-3 text-center text-sky-600 tabular-nums">{d?.dau > 0 ? `${((1 - d.pv / d.dau) * 100).toFixed(2)}%` : '-'}</td>,
                        partner_visits: <td key="partner_visits" className="py-2 px-3 text-right text-amber-600 tabular-nums">{d?.pv?.toLocaleString() ?? '-'}</td>,
                        jump_rate: <td key="jump_rate" className="py-2 px-3 text-right text-purple-600 tabular-nums">{d?.rate ? `${d.rate}%` : '-'}</td>,
                        transaction_users: <td key="transaction_users" className="py-2 px-3 text-right text-rose-600 tabular-nums">{d?.txUsers?.toLocaleString() ?? '-'}</td>,
                        tx_rate: <td key="tx_rate" className="py-2 px-3 text-right text-fuchsia-600 tabular-nums">{d?.txRate ? `${d.txRate}%` : '-'}</td>,
                        remark: <td key="remark" className="py-2 px-3 text-center text-slate-300">-</td>,
                      };
                      return (
                        <tr key={label} className="border-b border-slate-100 text-sm">
                          <td className="py-2 px-3 text-slate-500 font-medium">{label}</td>
                          {MINI_COL_KEYS.filter(k => k !== 'date' && miniCol.visible.has(k)).map(k => _a[k])}
                        </tr>
                      );
                    };
                    return (
                      <>
                        {avgRow('上周日均', avgData.tw)}
                        {avgRow('上上周日均', avgData.lw)}
                        {avgRow('周环比', null, true)}
                        {[3, 4, 5, 6, 7].map(m => avgRow(`${m}月平均`, avgData.ma[m]))}
                      </>
                    );
                  })()}
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 列设置面板 */}
      {showColSettings && (
        <ColumnSettingsPanel columns={MINI_COLS} visible={miniCol.visible} onToggle={miniCol.toggle} onReset={miniCol.resetAll} onClose={() => setShowColSettings(false)} anchorPos={miniAnchorPos} />
      )}

      {/* 上传文件弹窗 */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={closeModal}>
          <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-800">上传小程序访问数据</h3>
              <button onClick={closeModal} className="p-1 rounded hover:bg-slate-100 transition">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto">
              <p className="text-sm text-slate-500">请上传 3 个 Excel 表格文件，上传后将触发数据整理工作流。</p>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">UV-PV 数据</span>
                <button
                  onClick={() => uvPvFileRef.current?.click()}
                  className={`flex items-center gap-2 px-3 py-2.5 border rounded-lg text-sm transition w-full text-left ${
                    uvPvFile ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {uvPvFile ? (
                    <><CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" /><span className="truncate flex-1">{uvPvFile.name}</span></>
                  ) : (
                    <><Upload className="w-4 h-4 text-slate-400 flex-shrink-0" /><span>选择 Excel 文件</span></>
                  )}
                </button>
                <input ref={uvPvFileRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={e => { setUvPvFile(e.target.files?.[0] || null); setResult(null); }} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">核心指标数据</span>
                <button
                  onClick={() => coreMetricsFileRef.current?.click()}
                  className={`flex items-center gap-2 px-3 py-2.5 border rounded-lg text-sm transition w-full text-left ${
                    coreMetricsFile ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {coreMetricsFile ? (
                    <><CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" /><span className="truncate flex-1">{coreMetricsFile.name}</span></>
                  ) : (
                    <><Upload className="w-4 h-4 text-slate-400 flex-shrink-0" /><span>选择 Excel 文件</span></>
                  )}
                </button>
                <input ref={coreMetricsFileRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={e => { setCoreMetricsFile(e.target.files?.[0] || null); setResult(null); }} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">点击数据</span>
                <button
                  onClick={() => clickJsonFileRef.current?.click()}
                  className={`flex items-center gap-2 px-3 py-2.5 border rounded-lg text-sm transition w-full text-left ${
                    clickJsonFile ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {clickJsonFile ? (
                    <><CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" /><span className="truncate flex-1">{clickJsonFile.name}</span></>
                  ) : (
                    <><Upload className="w-4 h-4 text-slate-400 flex-shrink-0" /><span>选择 Excel 文件</span></>
                  )}
                </button>
                <input ref={clickJsonFileRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={e => { setClickJsonFile(e.target.files?.[0] || null); setResult(null); }} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">开始日期</span>
                  <input
                    type="date" value={beginDate}
                    onChange={e => { setBeginDate(e.target.value); setResult(null); }}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">结束日期</span>
                  <input
                    type="date" value={endDate}
                    onChange={e => { setEndDate(e.target.value); setResult(null); }}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                  />
                </div>
              </div>
              {result && (
                <div className={`flex items-center gap-2 p-3 rounded text-sm ${
                  result.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                }`}>
                  {result.success ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
                  <span>{result.message}</span>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end px-6 py-4 border-t border-slate-200">
              <button
                onClick={handleUpload}
                disabled={uploading || !uvPvFile || !coreMetricsFile || !beginDate || !endDate}
                className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded transition"
              >
                {uploading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />上传中...</>
                ) : (
                  <><Upload className="w-4 h-4" />确认上传</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab 2: 点餐聚合页情况 ──────────────────────────────────────────
const BRANDS = ['nayuki', 'heytea', 'starbucks', 'jasmine', 'tasiting', 'cudi', 'mcdonalds', 'luckin', 'kfc'] as const;
const BRAND_LABELS: Record<string, string> = {
  nayuki: '奈雪', heytea: '喜茶', starbucks: '星爸爸', jasmine: '茉莉奶白',
  tasiting: '塔斯汀', cudi: '库迪', mcdonalds: '麦当当', luckin: '瑞幸咖啡', kfc: '肯德基',
};
const BRAND_COLORS = ['#60A5FA', '#34D399', '#FBBF24', '#F472B6', '#A78BFA', '#FB923C', '#38BDF8', '#4ADE80', '#E879F9'];

function OrderPageTab({ data, prevData, loading, onUploadSuccess }: { data: OrderPageRow[]; prevData?: OrderPageRow[]; loading?: boolean; onUploadSuccess?: () => void }) {
  const [orderFile, setOrderFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [beginDate, setBeginDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [chartType, setChartType] = useState<'bar' | 'line' | 'table'>('bar');
  const fileRef = useRef<HTMLInputElement>(null);

  const totals = BRANDS.map(b => ({
    name: BRAND_LABELS[b],
    value: data.reduce((sum, r) => sum + (r[b] as number), 0),
  }));

  // 柱状图数据：按值从高到低排序
  const sortedTotals = useMemo(() => {
    return [...totals].sort((a, b) => b.value - a.value);
  }, [totals]);

  // 趋势数据：按日期分组
  const trendData = useMemo(() => {
    return data.map(r => {
      const row: any = { date: r.date };
      BRANDS.forEach(b => {
        row[BRAND_LABELS[b]] = r[b] as number;
      });
      return row;
    });
  }, [data]);

  // 品牌明细表：排名/品牌/累计/占比/日均/峰值日期/峰值/环比
  const brandDetail = useMemo(() => {
    const prev = prevData ?? [];
    const days = data.length || 1;
    const grandTotal = totals.reduce((s, t) => s + t.value, 0);
    return BRANDS.map((b, i) => {
      const cur = data.reduce((s, r) => s + (r[b] as number), 0);
      const prv = prev.reduce((s, r) => s + (r[b] as number), 0);
      const peak = data.reduce((max, r) => (r[b] as number) > max.val ? { val: r[b] as number, date: r.date } : max, { val: 0, date: '' });
      const hb = prv === 0 ? null : ((cur - prv) / prv * 100).toFixed(1);
      return {
        brand: BRAND_LABELS[b],
        color: BRAND_COLORS[i],
        total: cur,
        pct: grandTotal > 0 ? (cur / grandTotal * 100).toFixed(1) : '0',
        avg: (cur / days).toFixed(1),
        peakDate: peak.date,
        peakVal: peak.val,
        hb,
      };
    }).sort((a, b) => b.total - a.total);
  }, [data, prevData, totals]);

  // 4个指标卡数据
  const metricCards = useMemo(() => {
    const prev = prevData ?? [];
    const grandTotal = totals.reduce((s, t) => s + t.value, 0);
    const prevGrandTotal = prev.reduce((s, r) => s + BRANDS.reduce((bs, b) => bs + (r[b] as number), 0), 0);
    const totalHb = prevGrandTotal === 0 ? null : ((grandTotal - prevGrandTotal) / prevGrandTotal * 100).toFixed(1);
    const top1 = brandDetail[0];
    const fastest = brandDetail.filter(b => b.hb !== null).sort((a, b) => parseFloat(b.hb!) - parseFloat(a.hb!))[0];
    const activeCount = brandDetail.filter(b => b.total > 0).length;
    return { grandTotal, totalHb, top1, fastest, activeCount };
  }, [brandDetail, totals, prevData]);

  // const _openModal = () => { setOrderFile(null); setResult(null); setBeginDate(''); setEndDate(''); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setOrderFile(null); };

  const handleUpload = async () => {
    if (!orderFile) { setResult({ success: false, message: '请选择 Excel 文件' }); return; }
    if (!beginDate || !endDate) { setResult({ success: false, message: '请选择开始日期和结束日期' }); return; }
    if (beginDate > endDate) { setResult({ success: false, message: '开始日期不能大于结束日期' }); return; }
    setUploading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('order_page', orderFile);
      formData.append('begin_date', beginDate.replace(/-/g, ''));
      formData.append('end_date', endDate.replace(/-/g, ''));
      const res = await fetch(REVIEW_PARTNER_ORDER_PAGE_UPLOAD_ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('blue_os_token') || ''}` },
        body: formData,
      });
      if (!res.ok) {
        let msg = `请求失败 (${res.status})`;
        try { const err = await res.json(); msg = err.message || msg; } catch {}
        setResult({ success: false, message: msg });
        return;
      }
      const json = await res.json();
      if (json.success) {
        setResult({ success: true, message: json.message || '导入成功' });
        setOrderFile(null);
        if (fileRef.current) fileRef.current.value = '';
        onUploadSuccess?.();
      } else {
        setResult({ success: false, message: json.message || '上传失败' });
      }
    } catch (err: any) {
      setResult({ success: false, message: err.message || '网络错误' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /><span className="ml-2 text-sm text-slate-500">加载中...</span></div>
      ) : (
        <div className="space-y-4">
          {/* 4个指标卡 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {(() => {
              const cards = [
                { label: '聚合页总访问量', desc: 'SUM(访问量)', value: metricCards.grandTotal.toLocaleString(), color: 'text-blue-600', bg: 'bg-blue-50', hbVal: metricCards.totalHb },
                { label: 'TOP1 品牌', desc: 'MAX(累计)', value: metricCards.top1?.brand || '-', color: 'text-emerald-600', bg: 'bg-emerald-50', hbVal: null, sub: `占比 ${metricCards.top1?.pct || 0}%` },
                { label: '增长最快品牌', desc: 'MAX(环比)', value: metricCards.fastest?.brand || '-', color: 'text-amber-600', bg: 'bg-amber-50', hbVal: metricCards.fastest?.hb ?? null },
                { label: '活跃品牌数', desc: 'COUNT(>0)', value: `${metricCards.activeCount} / ${BRANDS.length}`, color: 'text-purple-600', bg: 'bg-purple-50', hbVal: null, sub: metricCards.activeCount === BRANDS.length ? '全部有访问' : `${metricCards.activeCount} 个品牌有数据` },
              ];
              return cards.map(c => (
                <div key={c.label} className={`${c.bg} rounded-lg p-4 border border-slate-100`}>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xs text-slate-500">{c.label}</span>
                    <span className="text-[10px] text-slate-400">{c.desc}</span>
                  </div>
                  <div className={`text-2xl font-bold ${c.color} mt-1`}>{c.value}</div>
                  {c.hbVal !== null && c.hbVal !== undefined ? (
                    <div className={`text-xs mt-1 ${parseFloat(c.hbVal) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                      环比 {parseFloat(c.hbVal) >= 0 ? '↑' : '↓'} {Math.abs(parseFloat(c.hbVal))}%
                    </div>
                  ) : c.sub ? (
                    <div className="text-xs mt-1 text-slate-500">{c.sub}</div>
                  ) : (
                    <div className="text-xs mt-1 text-slate-400">环比 -</div>
                  )}
                </div>
              ));
            })()}
          </div>

          {/* 图表区域 */}
          <div className="bg-white rounded-lg p-4 shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-medium text-slate-600">
                {chartType === 'bar' ? '品牌对比（汇总）' : chartType === 'line' ? '趋势对比' : '占比结构'}
              </h3>
              <div className="flex items-center gap-1">
                <button onClick={() => setChartType('bar')}
                  className={`px-2.5 py-1 text-xs rounded transition ${chartType === 'bar' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  品牌对比
                </button>
                <button onClick={() => setChartType('line')}
                  className={`px-2.5 py-1 text-xs rounded transition ${chartType === 'line' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  趋势对比
                </button>
                <button onClick={() => setChartType('table')}
                  className={`px-2.5 py-1 text-xs rounded transition ${chartType === 'table' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  占比结构
                </button>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
              {chartType === 'bar' ? 'SUM(各品牌累计访问量)，按总量降序排列' : chartType === 'line' ? '各品牌每日访问量走势，X轴为日期，Y轴为访问量' : '各品牌累计占比，进度条宽度按百分比缩放'}
            </p>
            {chartType !== 'table' ? (
            <ResponsiveContainer width="100%" height={360}>
              {chartType === 'bar' ? (
                <BarChart data={sortedTotals}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={11} angle={-20} textAnchor="end" height={50} />
                  <YAxis stroke="#64748b" fontSize={12} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }} />
                  <Bar dataKey="value" name="总访问量" radius={[4, 4, 0, 0]}>
                    {sortedTotals.map((_, i) => (
                      <Cell key={i} fill={BRAND_COLORS[i % BRAND_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              ) : (
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={12} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }} />
                  <Legend />
                  {BRANDS.map((b, i) => (
                    <Line key={b} type="monotone" dataKey={BRAND_LABELS[b]} stroke={BRAND_COLORS[i]} strokeWidth={2} dot={{ r: 3 }} />
                  ))}
                </LineChart>
              )}
            </ResponsiveContainer>
            ) : (
                <div className="space-y-2 py-2">
                  {brandDetail.map((bd) => {
                    const pctNum = parseFloat(bd.pct);
                    const wide = pctNum >= 15;
                    return (
                      <div key={bd.brand} className="flex items-center gap-3">
                        <span className="text-xs text-slate-500 w-16 text-right shrink-0">{bd.brand}</span>
                        <div className="flex-1 h-7 bg-slate-100 rounded relative">
                          <div className="h-full rounded transition-all"
                            style={{ width: `${Math.max(pctNum, 2)}%`, backgroundColor: bd.color }} />
                          <span className={`absolute top-0 h-full flex items-center text-xs font-medium ${wide ? 'left-2 text-white drop-shadow' : 'text-slate-600'}`}
                            style={wide ? {} : { left: `calc(${Math.max(pctNum, 2)}% + 6px)` }}>
                            {bd.total.toLocaleString()}
                          </span>
                        </div>
                        <span className="text-xs text-slate-400 w-12 shrink-0 tabular-nums">{bd.pct}%</span>
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
                    <span className="text-xs text-slate-400 w-16 text-right shrink-0">合计</span>
                    <span className="flex-1 text-xs text-slate-400">{data.length} 天数据 · {brandDetail.filter(b => b.total > 0).length} 个品牌</span>
                    <span className="text-xs text-slate-500 w-12 shrink-0 tabular-nums">100%</span>
                  </div>
                </div>
            )}
          </div>

          {/* 数据表格 */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200">
            <div className="flex items-center px-4 py-3 border-b border-slate-100">
              <h3 className="text-sm font-medium text-slate-600">数据表格</h3>
              {data.length > 0 && (
                <button
                  onClick={() => {
                    const headers = ['日期', ...BRANDS.map(b => BRAND_LABELS[b])];
                    const rows = data.map(r => [r.date, ...BRANDS.map(b => r[b] as number)]);
                    const csv = '\uFEFF' + [headers, ...rows].map(r => r.map((c: any) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = `点餐聚合页数据_${new Date().toISOString().slice(0, 10)}.csv`;
                    a.click(); URL.revokeObjectURL(url);
                  }}
                  className="ml-auto flex items-center gap-1 px-3 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-600 text-xs font-medium rounded transition whitespace-nowrap"
                >
                  <Download className="w-3 h-3" />下载数据
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="text-sm" style={{ tableLayout: 'auto', width: '100%', minWidth: 'fit-content' }}>
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left py-2.5 px-3 text-slate-500 font-medium whitespace-nowrap sticky left-0 bg-slate-50">日期</th>
                    {BRANDS.map(b => (
                      <th key={b} className="text-right py-2.5 px-3 text-slate-500 font-medium whitespace-nowrap">{BRAND_LABELS[b]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
                    <tr key={r.date} className="border-b border-slate-100 hover:bg-blue-50/40 transition-colors">
                      <td className="py-2 px-3 text-slate-700 sticky left-0 bg-white">{r.date}</td>
                      {BRANDS.map(b => (
                        <td key={b} className="py-2 px-3 text-right text-slate-700 tabular-nums">{(r[b] as number).toLocaleString()}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-sm">
                    <td className="py-2.5 px-3 text-slate-700">合计</td>
                    {BRANDS.map(b => (
                      <td key={b} className="py-2.5 px-3 text-right text-slate-700 tabular-nums">{data.reduce((s, r) => s + (r[b] as number), 0).toLocaleString()}</td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 上传文件弹窗 */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={closeModal}>
          <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-800">上传点餐聚合页数据</h3>
              <button onClick={closeModal} className="p-1 rounded hover:bg-slate-100 transition">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto">
              <p className="text-sm text-slate-500">请上传 1 个 Excel 表格文件，上传后将触发数据整理工作流。</p>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">点餐聚合页数据</span>
                <button
                  onClick={() => fileRef.current?.click()}
                  className={`flex items-center gap-2 px-3 py-2.5 border rounded-lg text-sm transition w-full text-left ${
                    orderFile ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {orderFile ? (
                    <><CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" /><span className="truncate flex-1">{orderFile.name}</span></>
                  ) : (
                    <><Upload className="w-4 h-4 text-slate-400 flex-shrink-0" /><span>选择 Excel 文件</span></>
                  )}
                </button>
                <input ref={fileRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={e => { setOrderFile(e.target.files?.[0] || null); setResult(null); }} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">开始日期</span>
                  <input
                    type="date" value={beginDate}
                    onChange={e => { setBeginDate(e.target.value); setResult(null); }}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">结束日期</span>
                  <input
                    type="date" value={endDate}
                    onChange={e => { setEndDate(e.target.value); setResult(null); }}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                  />
                </div>
              </div>
              {result && (
                <div className={`flex items-center gap-2 p-3 rounded text-sm ${
                  result.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                }`}>
                  {result.success ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
                  <span>{result.message}</span>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end px-6 py-4 border-t border-slate-200">
              <button
                onClick={handleUpload}
                disabled={uploading || !orderFile || !beginDate || !endDate}
                className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded transition"
              >
                {uploading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />上传中...</>
                ) : (
                  <><Upload className="w-4 h-4" />确认上传</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab 3: 交易情况 ───────────────────────────────────────────────
const TX_CATEGORIES = [
  { key: 'dining', label: '大牌点餐', color: '#A78BFA' },
  { key: 'movie_ticket', label: '电影票购买', color: '#FB923C' },
  { key: 'phone_recharge', label: '话费充值', color: '#F472B6' },
  { key: 'virtual_card', label: '虚拟权益', color: '#34D399' },
  { key: 'online_goods', label: '线上货物', color: '#60A5FA' },
  { key: 'cash_coupon', label: '立减金', color: '#FBBF24' },
  { key: 'transaction_users', label: '交易人数', color: '#38BDF8' },
  { key: 'transaction_count', label: '交易笔数', color: '#22D3EE' },
] as const;

// 卡片/图表展示的 6 个金额字段
const TX_DISPLAY_KEYS = ['dining', 'movie_ticket', 'phone_recharge', 'virtual_card', 'online_goods', 'cash_coupon'] as const;

function TransactionTab({ data, prevData, loading, onUploadSuccess }: { data: TransactionRow[]; prevData?: TransactionRow[]; loading?: boolean; onUploadSuccess?: () => void }) {
  const [orderListFile, setOrderListFile] = useState<File | null>(null);
  const [localLifeFile, setLocalLifeFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ stat_date: '', online_goods: 0, virtual_card: 0, cash_coupon: 0, phone_recharge: 0, dining: 0, movie_ticket: 0, transaction_users: 0, transaction_count: 0 });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState('');
  const orderListRef = useRef<HTMLInputElement>(null);
  const localLifeRef = useRef<HTMLInputElement>(null);
  const [txChartType, setTxChartType] = useState<'trend' | 'structure'>('trend');
  const [showTxColSettings, setShowTxColSettings] = useState(false);
  const [txAnchorPos, setTxAnchorPos] = useState<{ top: number; left: number } | null>(null);
  const TX_TABLE_COLS: ColDef[] = [
    { key: 'date', label: '日期', fixed: true },
    { key: 'weekly_gmv', label: '当周GMV' },
    { key: 'daily_gmv', label: '当天GMV' },
    { key: 'dining', label: '大牌点餐' },
    { key: 'movie_ticket', label: '电影票购买' },
    { key: 'phone_recharge', label: '话费充值' },
    { key: 'virtual_card', label: '虚拟权益' },
    { key: 'online_goods', label: '线上货物' },
    { key: 'cash_coupon', label: '立减金' },
    { key: 'transaction_users', label: '交易人数' },
    { key: 'avg_user_price', label: '客单价（周）' },
    { key: 'transaction_count', label: '交易笔数' },
    { key: 'avg_count_price', label: '笔单价（周）' },
  ];
  const txCol = useColumnVisibility('review_transaction_cols', TX_TABLE_COLS);

  // 可编辑字段
  const EDITABLE_KEYS = new Set(['phone_recharge', 'cash_coupon', 'movie_ticket', 'transaction_users', 'transaction_count']);
  const [editCell, setEditCell] = useState<{ date: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  const handleCellEdit = useCallback((date: string, field: string, currentVal: number) => {
    setEditCell({ date, field });
    setEditValue(currentVal === 0 ? '' : String(currentVal));
    setTimeout(() => editInputRef.current?.focus(), 50);
  }, []);

  const handleCellSave = useCallback(async () => {
    if (!editCell) return;
    const numVal = parseFloat(editValue) || 0;
    setEditSaving(true);
    try {
      const res = await fetch(`${REVIEW_PARTNER_TRANSACTION_UPDATE_ENDPOINT}/${editCell.date}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('blue_os_token') || ''}`,
        },
        body: JSON.stringify({ [editCell.field]: numVal }),
      });
      const json = await res.json();
      if (json.success) {
        // 更新本地 data
        const row = data.find(r => r.date === editCell.date);
        if (row) (row as any)[editCell.field] = numVal;
      }
    } catch (e) {
      console.error('更新失败', e);
    } finally {
      setEditSaving(false);
      setEditCell(null);
    }
  }, [editCell, editValue, data]);

  const chartData = data.map(r => ({
    date: formatDate(r.date),
    ...TX_CATEGORIES.reduce((acc, c) => ({ ...acc, [c.label]: r[c.key as keyof TransactionRow] as number }), {} as Record<string, number>),
  }));

  // 图表只展示 5 个金额字段
  const AMOUNT_KEYS = TX_CATEGORIES.filter(c => TX_DISPLAY_KEYS.includes(c.key as any));

  // 占比结构数据
  const structureData = useMemo(() => {
    const grandTotal = AMOUNT_KEYS.reduce((s, c) => s + data.reduce((rs, r) => rs + (r[c.key as keyof TransactionRow] as number), 0), 0);
    return AMOUNT_KEYS.map(c => {
      const total = data.reduce((s, r) => s + (r[c.key as keyof TransactionRow] as number), 0);
      const pct = grandTotal > 0 ? (total / grandTotal * 100) : 0;
      return { key: c.key, label: c.label, color: c.color, total, pct };
    }).sort((a, b) => b.total - a.total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // 6 个金额字段 key
  const INT_KEYS = ['transaction_users', 'transaction_count'] as const;
  const AMT_KEYS_6 = ['online_goods', 'virtual_card', 'cash_coupon', 'phone_recharge', 'dining', 'movie_ticket'] as const;

  // 按 ISO 周分组（周一~周日）
  const weekGroups = useMemo(() => {
    const getMonday = (d: Date) => {
      const day = d.getDay();
      const diff = d.getDate() - (day === 0 ? 6 : day - 1);
      return new Date(d.getFullYear(), d.getMonth(), diff);
    };
    const fmt = (d: Date) => {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const map = new Map<string, TransactionRow[]>();
    const sorted = [...data].sort((a, b) => b.date.localeCompare(a.date));
    for (const row of sorted) {
      const d = new Date(row.date + 'T00:00:00');
      const mon = getMonday(d);
      const key = fmt(mon);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return Array.from(map.entries()).map(([monDate, rows]) => {
      const mon = new Date(monDate + 'T00:00:00');
      const sun = new Date(mon.getTime() + 6 * 86400000);
      return { weekStart: monDate, weekEnd: fmt(sun), rows };
    });
  }, [data]);

  const openModal = () => { setOrderListFile(null); setLocalLifeFile(null); setResult(null); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setOrderListFile(null); setLocalLifeFile(null); };
  
    const handleAddSubmit = async () => {
      if (!addForm.stat_date) { setAddError('请选择日期'); return; }
      setAddSaving(true);
      setAddError('');
      try {
        const res = await fetch(REVIEW_PARTNER_TRANSACTION_ADD_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('blue_os_token') || ''}` },
          body: JSON.stringify(addForm),
        });
        const json = await res.json();
        if (json.success) {
          setShowAddModal(false);
          onUploadSuccess?.();
        } else {
          setAddError(json.message || '新增失败');
        }
      } catch (e: any) {
        setAddError(e.message || '网络错误');
      } finally {
        setAddSaving(false);
      }
    };

  const handleUpload = async () => {
    if (!orderListFile) { setResult({ success: false, message: '请选择订单列表文件' }); return; }
    if (!localLifeFile) { setResult({ success: false, message: '请选择本地生活订单列表文件' }); return; }
    setUploading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('order_list', orderListFile);
      formData.append('local_life', localLifeFile);
      const res = await fetch(REVIEW_PARTNER_TRANSACTION_UPLOAD_ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('blue_os_token') || ''}` },
        body: formData,
      });
      if (!res.ok) {
        let msg = `请求失败 (${res.status})`;
        try { const err = await res.json(); msg = err.message || msg; } catch {}
        setResult({ success: false, message: msg });
        return;
      }
      const json = await res.json();
      if (json.success) {
        setResult({ success: true, message: json.message || '数据整理完成' });
        setOrderListFile(null);
        setLocalLifeFile(null);
        if (orderListRef.current) orderListRef.current.value = '';
        if (localLifeRef.current) localLifeRef.current.value = '';
        onUploadSuccess?.();
      } else {
        setResult({ success: false, message: json.message || '上传失败' });
      }
    } catch (err: any) {
      setResult({ success: false, message: err.message || '网络错误' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /><span className="ml-2 text-sm text-slate-500">加载中...</span></div>
      ) : (
        <div className="space-y-4">
          {/* 指标卡 */}
          {(() => {
            const prev = prevData ?? [];
            const AMT_KEYS = ['online_goods', 'virtual_card', 'cash_coupon', 'phone_recharge', 'dining', 'movie_ticket'];
            const sumAmt = (rows: TransactionRow[]) => rows.reduce((s, r) => s + AMT_KEYS.reduce((a, k) => a + (r[k as keyof TransactionRow] as number), 0), 0);
            const sumUsers = (rows: TransactionRow[]) => rows.reduce((s, r) => s + (r.transaction_users || 0), 0);
            const sumCount = (rows: TransactionRow[]) => rows.reduce((s, r) => s + (r.transaction_count || 0), 0);
            const curAmt = sumAmt(data), prvAmt = sumAmt(prev);
            const curUsers = sumUsers(data), prvUsers = sumUsers(prev);
            const curCount = sumCount(data), prvCount = sumCount(prev);
            const curAvgPrice = curUsers > 0 ? curAmt / curUsers : 0;
            const prvAvgPrice = prvUsers > 0 ? prvAmt / prvUsers : 0;
            const curAvgCount = curUsers > 0 ? curCount / curUsers : 0;
            const prvAvgCount = prvUsers > 0 ? prvCount / prvUsers : 0;
            const hb = (cur: number, prv: number) => {
              if (prv === 0) return null;
              return ((cur - prv) / prv * 100).toFixed(1);
            };
            const cards = [
              { label: '总交易额', desc: 'SUM(6个金额字段)', value: curAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), color: 'text-blue-600', bg: 'bg-blue-50', hbVal: hb(curAmt, prvAmt) },
              { label: '总交易人数', desc: 'SUM(交易人数)', value: curUsers.toLocaleString(), color: 'text-emerald-600', bg: 'bg-emerald-50', hbVal: hb(curUsers, prvUsers) },
              { label: '总交易笔数', desc: 'SUM(交易笔数)', value: curCount.toLocaleString(), color: 'text-amber-600', bg: 'bg-amber-50', hbVal: hb(curCount, prvCount) },
              { label: '人均客单价', desc: '总交易额 ÷ 总交易人数', value: curAvgPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), color: 'text-purple-600', bg: 'bg-purple-50', hbVal: hb(curAvgPrice, prvAvgPrice) },
              { label: '人均笔数', desc: '总交易笔数 ÷ 总交易人数', value: curAvgCount.toFixed(2), color: 'text-pink-600', bg: 'bg-pink-50', hbVal: hb(curAvgCount, prvAvgCount) },
            ];
            return (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {cards.map(c => (
                  <div key={c.label} className={`${c.bg} rounded-lg p-4 border border-slate-100`}>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xs text-slate-500">{c.label}</span>
                      <span className="text-[10px] text-slate-400">{c.desc}</span>
                    </div>
                    <div className={`text-2xl font-bold ${c.color} mt-1`}>{c.value}</div>
                    {c.hbVal !== null ? (
                      <div className={`text-xs mt-1 ${parseFloat(c.hbVal) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        环比 {parseFloat(c.hbVal) >= 0 ? '↑' : '↓'} {Math.abs(parseFloat(c.hbVal))}%
                      </div>
                    ) : (
                      <div className="text-xs mt-1 text-slate-400">环比 -</div>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* 交易趋势 */}
          <div className="bg-white rounded-lg p-4 shadow-sm border border-slate-200">
            <div className="flex items-center mb-1">
              <h3 className="text-sm font-medium text-slate-600">
                {txChartType === 'trend' ? '交易趋势' : '占比结构'}
              </h3>
              <div className="flex items-center gap-1 ml-auto">
                <button onClick={() => setTxChartType('trend')}
                  className={`px-2.5 py-1 text-xs rounded transition ${txChartType === 'trend' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  趋势对比
                </button>
                <button onClick={() => setTxChartType('structure')}
                  className={`px-2.5 py-1 text-xs rounded transition ${txChartType === 'structure' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  占比结构
                </button>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
              {txChartType === 'trend' ? '各品类每日交易额走势，折线对比' : '各品类累计占比，进度条宽度按百分比缩放'}
            </p>
            {txChartType === 'trend' ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={12} />
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }} />
                  <Legend />
                  {AMOUNT_KEYS.map(c => (
                    <Line key={c.key} type="monotone" dataKey={c.label} stroke={c.color} strokeWidth={2} dot={{ r: 3 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="space-y-2 py-2">
                {structureData.map((item) => {
                  const pctNum = item.pct;
                  const wide = pctNum >= 15;
                  return (
                    <div key={item.key} className="flex items-center gap-3">
                      <span className="text-xs text-slate-500 w-20 text-right shrink-0">{item.label}</span>
                      <div className="flex-1 h-7 bg-slate-100 rounded relative">
                        <div className="h-full rounded transition-all"
                          style={{ width: `${Math.max(pctNum, 2)}%`, backgroundColor: item.color }} />
                        <span className={`absolute top-0 h-full flex items-center text-xs font-medium ${wide ? 'left-2 text-white drop-shadow' : 'text-slate-600'}`}
                          style={wide ? {} : { left: `calc(${Math.max(pctNum, 2)}% + 6px)` }}>
                          {item.total.toLocaleString()}
                        </span>
                      </div>
                      <span className="text-xs text-slate-400 w-12 shrink-0 tabular-nums">{item.pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 数据表格 */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200">
            <div className="flex items-center px-4 py-3 border-b border-slate-100">
              <h3 className="text-sm font-medium text-slate-600">数据表格</h3>
              <button onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setTxAnchorPos({ top: r.top, left: r.left }); setShowTxColSettings(true); }}
                className="ml-2 px-1.5 py-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-400 transition" title="列设置">
                <Settings className="w-3.5 h-3.5" />
              </button>
              {data.length > 0 && (
                <button onClick={() => { setAddForm({ stat_date: '', online_goods: 0, virtual_card: 0, cash_coupon: 0, phone_recharge: 0, dining: 0, movie_ticket: 0, transaction_users: 0, transaction_count: 0 }); setAddError(''); setShowAddModal(true); }}
                  className="ml-auto flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded transition whitespace-nowrap">
                  <span className="text-xs">+</span>新增数据
                </button>
              )}
              <button onClick={openModal}
                className={`${data.length === 0 ? 'ml-auto' : 'ml-2'} flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded transition whitespace-nowrap`}>
                <Upload className="w-3 h-3" />上传文件
              </button>
              {data.length > 0 && (
                <button
                  onClick={() => {
                    const INT_FIELDS = new Set(['transaction_users', 'transaction_count']);
                    const allCols: { key: string; label: string }[] = [
                      { key: 'date', label: '日期' }, { key: 'weekly_gmv', label: '当周GMV' }, { key: 'daily_gmv', label: '当天GMV' },
                      ...TX_CATEGORIES.slice(0, 6).map(c => ({ key: c.key, label: c.label })),
                    ];
                    TX_CATEGORIES.slice(6).forEach((c, ci) => {
                      allCols.push({ key: c.key, label: c.label });
                      if (ci === 0) allCols.push({ key: 'avg_user_price', label: '客单价(周)' });
                      if (ci === 1) allCols.push({ key: 'avg_count_price', label: '笔单价(周)' });
                    });
                    const filtered = allCols.filter(c => txCol.visible.has(c.key));
                    const headers = filtered.map(c => c.label);
                    const rows = data.map(r => {
                      const dayAmt = TX_CATEGORIES.slice(0, 6).reduce((s, c) => s + (r[c.key as keyof TransactionRow] as number), 0);
                      return filtered.map(col => {
                        if (col.key === 'date') return r.date;
                        if (col.key === 'weekly_gmv') return ''; // CSV doesn't have weekly grouping
                        if (col.key === 'daily_gmv') return dayAmt.toFixed(2);
                        if (col.key === 'avg_user_price') { const users = r.transaction_users || 0; return users > 0 ? (dayAmt / users).toFixed(2) : '0.00'; }
                        if (col.key === 'avg_count_price') { const count = r.transaction_count || 0; return count > 0 ? (dayAmt / count).toFixed(2) : '0.00'; }
                        const v = r[col.key as keyof TransactionRow] as number;
                        return INT_FIELDS.has(col.key) ? String(v) : v.toFixed(2);
                      });
                    });
                    const csv = '\uFEFF' + [headers, ...rows].map(r => r.map((c: any) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `交易情况数据_${new Date().toISOString().slice(0, 10)}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="ml-2 flex items-center gap-1 px-3 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-600 text-xs font-medium rounded transition whitespace-nowrap"
                >
                  <Download className="w-3 h-3" />下载数据
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="text-sm" style={{ tableLayout: 'auto', width: '100%', minWidth: 'fit-content' }}>
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {txCol.visible.has('date') && <th className="text-left py-2.5 px-3 text-slate-500 font-medium whitespace-nowrap">日期</th>}
                    {txCol.visible.has('weekly_gmv') && <th className="text-right py-2.5 px-3 text-slate-500 font-medium whitespace-nowrap">当周GMV</th>}
                    {txCol.visible.has('daily_gmv') && <th className="text-right py-2.5 px-3 text-slate-500 font-medium whitespace-nowrap">当天GMV</th>}
                    {TX_CATEGORIES.slice(0, 6).filter(c => txCol.visible.has(c.key)).map(c => (
                      <th key={c.key} className="text-right py-2.5 px-3 text-slate-500 font-medium whitespace-nowrap">{c.label}</th>
                    ))}
                    {TX_CATEGORIES.slice(6).map((c, ci) => {
                      const extra: any[] = [];
                      if (ci === 0 && txCol.visible.has('avg_user_price')) extra.push(<th key="avgUser" className="text-right py-2.5 px-3 text-slate-500 font-medium whitespace-nowrap">客单价（周）</th>);
                      if (ci === 1 && txCol.visible.has('avg_count_price')) extra.push(<th key="avgCount" className="text-right py-2.5 px-3 text-slate-500 font-medium whitespace-nowrap">笔单价（周）</th>);
                      if (!txCol.visible.has(c.key)) return extra;
                      return [<th key={c.key} className="text-right py-2.5 px-3 text-slate-500 font-medium whitespace-nowrap">{c.label}</th>, ...extra];
                    })}
                  </tr>
                </thead>
                <tbody>
                  {weekGroups.map(wk => {
                    const n = wk.rows.length;
                    const wkAmtTotal = wk.rows.reduce((s, r) =>
                      s + (AMT_KEYS_6 as unknown as string[]).reduce((ss, k) => ss + (r[k as keyof TransactionRow] as number), 0), 0);
                    const wkUsers = wk.rows.reduce((s, r) => s + (r.transaction_users || 0), 0);
                    const wkCount = wk.rows.reduce((s, r) => s + (r.transaction_count || 0), 0);
                    const wkAvgPrice = wkUsers > 0 ? wkAmtTotal / wkUsers : 0;
                    const wkAvgPerTx = wkCount > 0 ? wkAmtTotal / wkCount : 0;
                    return (
                      <Fragment key={wk.weekStart}>
                        {wk.rows.map((r, idx) => {
                          return (
                            <tr key={r.date} className="border-b border-slate-100 hover:bg-blue-50/40 transition-colors">
                              {txCol.visible.has('date') && <td className="py-2 px-3 text-slate-700 whitespace-nowrap">{r.date}</td>}
                              {/* 当周GMV：每周合并 N 行 */}
                              {idx === 0 && txCol.visible.has('weekly_gmv') && (
                                <td rowSpan={n} className="py-2 px-3 text-right text-blue-600 font-bold tabular-nums whitespace-nowrap bg-slate-50 align-middle border border-slate-300">
                                  {wkAmtTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                              )}
                              {/* 当天GMV：当天 6 项金额之和 */}
                              {txCol.visible.has('daily_gmv') && (
                              <td className="py-2 px-3 text-right text-emerald-600 font-semibold tabular-nums whitespace-nowrap">
                                {TX_CATEGORIES.slice(0, 6).reduce((s, c) => s + (r[c.key as keyof TransactionRow] as number), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              )}
                              {TX_CATEGORIES.slice(0, 6).filter(c => txCol.visible.has(c.key)).map(c => {
                                const v = r[c.key as keyof TransactionRow] as number;
                                const isEditing = editCell?.date === r.date && editCell?.field === c.key;
                                const isEditable = EDITABLE_KEYS.has(c.key);
                                if (isEditing) {
                                  return (
                                    <td key={c.key} className="py-1 px-1">
                                      <input ref={editInputRef} type="number" step="0.01" value={editValue}
                                        onChange={e => setEditValue(e.target.value)}
                                        onBlur={() => !editSaving && handleCellSave()}
                                        onKeyDown={e => { if (e.key === 'Enter') handleCellSave(); if (e.key === 'Escape') setEditCell(null); }}
                                        className="w-20 text-right text-sm px-1 py-0.5 border border-blue-400 rounded outline-none focus:ring-1 focus:ring-blue-300 tabular-nums"
                                      />
                                    </td>
                                  );
                                }
                                return (
                                  <td key={c.key} className={`py-2 px-3 text-right tabular-nums whitespace-nowrap ${isEditable ? 'cursor-pointer hover:bg-blue-50 text-blue-700' : 'text-slate-700'}`}
                                    onClick={() => isEditable && handleCellEdit(r.date, c.key, v)}
                                    title={isEditable ? '点击编辑' : undefined}
                                  >
                                    {v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                );
                              })}
                              {TX_CATEGORIES.slice(6).map((c, ci) => {
                                const v = r[c.key as keyof TransactionRow] as number;
                                const isInt = INT_KEYS.includes(c.key as any);
                                const isEditing = editCell?.date === r.date && editCell?.field === c.key;
                                const isEditable = EDITABLE_KEYS.has(c.key);
                                const cells: any[] = [];
                                if (txCol.visible.has(c.key)) {
                                  if (isEditing) {
                                    cells.push(
                                      <td key={c.key} className="py-1 px-1">
                                        <input ref={editInputRef} type="number" step="0.01" value={editValue}
                                          onChange={e => setEditValue(e.target.value)}
                                          onBlur={() => !editSaving && handleCellSave()}
                                          onKeyDown={e => { if (e.key === 'Enter') handleCellSave(); if (e.key === 'Escape') setEditCell(null); }}
                                          className="w-20 text-right text-sm px-1 py-0.5 border border-blue-400 rounded outline-none focus:ring-1 focus:ring-blue-300 tabular-nums"
                                        />
                                      </td>
                                    );
                                  } else {
                                    cells.push(
                                      <td key={c.key} className={`py-2 px-3 text-right tabular-nums whitespace-nowrap ${isEditable ? 'cursor-pointer hover:bg-blue-50 text-blue-700' : 'text-slate-700'}`}
                                        onClick={() => isEditable && handleCellEdit(r.date, c.key, v)}
                                        title={isEditable ? '点击编辑' : undefined}
                                      >
                                        {isInt ? v.toLocaleString() : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </td>
                                    );
                                  }
                                }
                                /* 交易人数后插入 客单价(周) */
                                if (ci === 0 && idx === 0 && txCol.visible.has('avg_user_price')) {
                                  cells.push(
                                    <td key="avgUser" rowSpan={n} className="py-2 px-3 text-right text-blue-600 font-semibold tabular-nums whitespace-nowrap bg-slate-50 align-middle border border-slate-300">
                                      {wkAvgPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                  );
                                }
                                /* 交易笔数后插入 笔单价(周) */
                                if (ci === 1 && idx === 0 && txCol.visible.has('avg_count_price')) {
                                  cells.push(
                                    <td key="avgCount" rowSpan={n} className="py-2 px-3 text-right text-blue-600 font-semibold tabular-nums whitespace-nowrap bg-slate-50 align-middle border border-slate-300">
                                      {wkAvgPerTx.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                  );
                                }
                                return cells;
                              })}
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                  {/* 合计行 */}
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                    {txCol.visible.has('date') && <td className="py-2.5 px-3 text-slate-700">合计</td>}
                    {(() => {
                      const amtTotalSum = data.reduce((s, r) => s + (['online_goods', 'virtual_card', 'cash_coupon', 'phone_recharge', 'dining', 'movie_ticket'] as const)
                        .reduce((ss, k) => ss + (r[k as keyof TransactionRow] as number), 0), 0);
                      return (
                        <>
                          {txCol.visible.has('weekly_gmv') && (
                          <td className="py-2.5 px-3 text-right text-blue-600 tabular-nums whitespace-nowrap">
                            {amtTotalSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          )}
                          {txCol.visible.has('daily_gmv') && <td className="py-2.5 px-3 text-right text-emerald-600 tabular-nums whitespace-nowrap">—</td>}
                          {TX_CATEGORIES.slice(0, 6).filter(c => txCol.visible.has(c.key)).map(c => {
                            const total = data.reduce((s, r) => s + (r[c.key as keyof TransactionRow] as number), 0);
                            return (
                              <td key={c.key} className="py-2.5 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">
                                {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            );
                          })}
                          {TX_CATEGORIES.slice(6).map((c, ci) => {
                            const total = data.reduce((s, r) => s + (r[c.key as keyof TransactionRow] as number), 0);
                            const isInt = INT_KEYS.includes(c.key as any);
                            const cells: any[] = [];
                            if (txCol.visible.has(c.key)) {
                              cells.push(
                                <td key={c.key} className="py-2.5 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">
                                  {isInt ? total.toLocaleString() : total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                              );
                            }
                            if (ci === 0 && txCol.visible.has('avg_user_price')) {
                              const totalUsers = data.reduce((s, r) => s + (r.transaction_users || 0), 0);
                              const avgP = totalUsers > 0 ? amtTotalSum / totalUsers : 0;
                              cells.push(
                                <td key="avgUser" className="py-2.5 px-3 text-right text-blue-600 tabular-nums whitespace-nowrap">
                                  {avgP.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                              );
                            }
                            if (ci === 1 && txCol.visible.has('avg_count_price')) {
                              const totalCount = data.reduce((s, r) => s + (r.transaction_count || 0), 0);
                              const avgT = totalCount > 0 ? amtTotalSum / totalCount : 0;
                              cells.push(
                                <td key="avgCount" className="py-2.5 px-3 text-right text-blue-600 tabular-nums whitespace-nowrap">
                                  {avgT.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                              );
                            }
                            return cells;
                          })}
                        </>
                      );
                    })()}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 上传弹窗 */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={closeModal}>
          <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-800">上传交易情况数据</h3>
              <button onClick={closeModal} className="p-1 rounded hover:bg-slate-100 transition">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto">
              <p className="text-sm text-slate-500">请上传 2 个 Excel 表格文件，上传后将触发数据整理工作流。</p>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">订单列表</span>
                <button
                  onClick={() => orderListRef.current?.click()}
                  className={`flex items-center gap-2 px-3 py-2.5 border rounded-lg text-sm transition w-full text-left ${
                    orderListFile ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {orderListFile ? (
                    <><CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" /><span className="truncate flex-1">{orderListFile.name}</span></>
                  ) : (
                    <><Upload className="w-4 h-4 text-slate-400 flex-shrink-0" /><span>选择 Excel 文件</span></>
                  )}
                </button>
                <input ref={orderListRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={e => { setOrderListFile(e.target.files?.[0] || null); setResult(null); }} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">本地生活订单列表</span>
                <button
                  onClick={() => localLifeRef.current?.click()}
                  className={`flex items-center gap-2 px-3 py-2.5 border rounded-lg text-sm transition w-full text-left ${
                    localLifeFile ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {localLifeFile ? (
                    <><CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" /><span className="truncate flex-1">{localLifeFile.name}</span></>
                  ) : (
                    <><Upload className="w-4 h-4 text-slate-400 flex-shrink-0" /><span>选择 Excel 文件</span></>
                  )}
                </button>
                <input ref={localLifeRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={e => { setLocalLifeFile(e.target.files?.[0] || null); setResult(null); }} />
              </div>
              {result && (
                <div className={`flex items-center gap-2 p-3 rounded text-sm ${
                  result.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                }`}>
                  {result.success ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
                  <span>{result.message}</span>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end px-6 py-4 border-t border-slate-200">
              <button
                onClick={handleUpload}
                disabled={uploading || !orderListFile || !localLifeFile}
                className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded transition"
              >
                {uploading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />上传中...</>
                ) : (
                  <><Upload className="w-4 h-4" />确认上传</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 列设置面板 */}
      {showTxColSettings && (
        <ColumnSettingsPanel columns={TX_TABLE_COLS} visible={txCol.visible} onToggle={txCol.toggle} onReset={txCol.resetAll} onClose={() => setShowTxColSettings(false)} anchorPos={txAnchorPos} />
      )}

      {/* 新增数据弹窗 */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-[420px] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-800">新增交易数据</h3>
              <button onClick={() => setShowAddModal(false)} className="p-1 rounded hover:bg-slate-100 transition">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <div className="flex items-center gap-3">
                <label className="text-sm text-slate-600 w-24 text-right flex-shrink-0">日期</label>
                <input type="date" value={addForm.stat_date}
                  onChange={e => setAddForm(f => ({ ...f, stat_date: e.target.value }))}
                  className="flex-1 px-3 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              {(['online_goods', 'virtual_card', 'cash_coupon', 'phone_recharge', 'dining', 'movie_ticket', 'transaction_users', 'transaction_count'] as const).map(key => {
                const labels: Record<string, string> = { online_goods: '线上货物', virtual_card: '虚拟卡券', cash_coupon: '立减金', phone_recharge: '话费充值', dining: '大牌点餐', movie_ticket: '电影票购买', transaction_users: '交易人数', transaction_count: '交易笔数' };
                return (
                  <div key={key} className="flex items-center gap-3">
                    <label className="text-sm text-slate-600 w-24 text-right flex-shrink-0">{labels[key]}</label>
                    <input type="number" value={addForm[key] || ''} placeholder="0"
                      onChange={e => setAddForm(f => ({ ...f, [key]: parseFloat(e.target.value) || 0 }))}
                      className="flex-1 px-3 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                );
              })}
              {addError && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{addError}</div>}
            </div>
            <div className="flex items-center justify-end px-6 py-4 border-t border-slate-200">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-1.5 text-sm text-slate-500 hover:text-slate-700 mr-2">取消</button>
              <button onClick={handleAddSubmit} disabled={addSaving}
                className="px-5 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white text-sm font-medium rounded transition">
                {addSaving ? '保存中...' : '确认新增'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab 4: 广告-专区 ──────────────────────────────────────────────
function AdZoneTab({ data, prevData, loading, onUploadSuccess }: { data: AdZoneRow[]; prevData?: AdZoneRow[]; loading?: boolean; onUploadSuccess?: () => void }) {
  const [summaryFile, setSummaryFile] = useState<File | null>(null);
  const [adFile, setAdFile] = useState<File | null>(null);
  const [zoneFile, setZoneFile] = useState<File | null>(null);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const summaryRef = useRef<HTMLInputElement>(null);
  const adRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLInputElement>(null);
  const batchRef = useRef<HTMLInputElement>(null);

  const [filterBusinessTypes, setFilterBusinessTypes] = useState<string[]>([]);
  const [filterAdNames, setFilterAdNames] = useState<string[]>([]);
  const [filterZones, setFilterZones] = useState<string[]>([]);
  const [btDropdownOpen, setBtDropdownOpen] = useState(false);
  const [adDropdownOpen, setAdDropdownOpen] = useState(false);
  const [zoneDropdownOpen, setZoneDropdownOpen] = useState(false);
  const [tblBtDropdownOpen, setTblBtDropdownOpen] = useState(false);
  const [tblAdDropdownOpen, setTblAdDropdownOpen] = useState(false);
  const [tblZoneDropdownOpen, setTblZoneDropdownOpen] = useState(false);
  const btDropdownRef = useRef<HTMLDivElement>(null);
  const adDropdownRef = useRef<HTMLDivElement>(null);
  const zoneDropdownRef = useRef<HTMLDivElement>(null);
  const tblBtDropdownRef = useRef<HTMLDivElement>(null);
  const tblAdDropdownRef = useRef<HTMLDivElement>(null);
  const tblZoneDropdownRef = useRef<HTMLDivElement>(null);
  const [showAzColSettings, setShowAzColSettings] = useState(false);
  const [azAnchorPos, setAzAnchorPos] = useState<{ top: number; left: number } | null>(null);
  const AZ_COLS: ColDef[] = [
    { key: 'date', label: '日期', fixed: true },
    { key: 'business_type', label: '业务类型' },
    { key: 'ad_id', label: '广告 ID' },
    { key: 'ad_name', label: '广告名称' },
    { key: 'impressions', label: '曝光量' },
    { key: 'impression_users', label: '曝光人数' },
    { key: 'clicks', label: '点击量' },
    { key: 'click_users', label: '点击人数' },
    { key: 'zone_id', label: '专区 ID' },
    { key: 'zone_name', label: '专区名称' },
    { key: 'zone_content', label: '专区内容' },
    { key: 'pv', label: 'PV' },
    { key: 'uv_openid', label: 'UV(OpenId)' },
    { key: 'uv_channel', label: 'UV(渠道)' },
    { key: 'zone_clicks', label: '专区点击量' },
    { key: 'zone_click_users', label: '专区点击人数' },
    { key: 'avg_stay_seconds', label: '次均停留 (秒)' },
    { key: 'material_name', label: '素材名称' },
    { key: 'we_visitors', label: '访问人数' },
    { key: 'we_visits', label: '访问次数' },
    { key: 'promotion_name', label: '推广名称' },
  ];
  const azCol = useColumnVisibility('review_ad_zone_cols', AZ_COLS);
  const AZ_COL_KEYS = AZ_COLS.map(c => c.key);

  // 筛选选项（三级联动：广告名称和专区受业务类型筛选）
  const adOptions = useMemo(() => {
    const src = filterBusinessTypes.length > 0
      ? data.filter(r => filterBusinessTypes.includes(r.business_type))
      : data;
    return Array.from(new Set(src.map(r => r.ad_name).filter(Boolean))).sort();
  }, [data, filterBusinessTypes]);

  const zoneOptions = useMemo(() => {
    const src = filterBusinessTypes.length > 0
      ? data.filter(r => filterBusinessTypes.includes(r.business_type))
      : data;
    return Array.from(new Set(src.map(r => r.zone_name).filter(Boolean))).sort();
  }, [data, filterBusinessTypes]);

  const businessTypeOptions = useMemo(() => Array.from(new Set(data.map(r => r.business_type).filter(Boolean))).sort(), [data]);

  // 业务类型变化时，清除不在新选项中的已选广告和专区
  useEffect(() => {
    if (filterAdNames.length > 0 && adOptions.length > 0) {
      const validAds = new Set(adOptions);
      const newSelection = filterAdNames.filter(a => validAds.has(a));
      if (newSelection.length !== filterAdNames.length) {
        setFilterAdNames(newSelection);
      }
    }
    if (filterZones.length > 0 && zoneOptions.length > 0) {
      const validZones = new Set(zoneOptions);
      const newSelection = filterZones.filter(z => validZones.has(z));
      if (newSelection.length !== filterZones.length) {
        setFilterZones(newSelection);
      }
    }
  }, [filterBusinessTypes, adOptions, zoneOptions]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (btDropdownRef.current && !btDropdownRef.current.contains(e.target as Node)) setBtDropdownOpen(false);
      if (adDropdownRef.current && !adDropdownRef.current.contains(e.target as Node)) setAdDropdownOpen(false);
      if (zoneDropdownRef.current && !zoneDropdownRef.current.contains(e.target as Node)) setZoneDropdownOpen(false);
      if (tblBtDropdownRef.current && !tblBtDropdownRef.current.contains(e.target as Node)) setTblBtDropdownOpen(false);
      if (tblAdDropdownRef.current && !tblAdDropdownRef.current.contains(e.target as Node)) setTblAdDropdownOpen(false);
      if (tblZoneDropdownRef.current && !tblZoneDropdownRef.current.contains(e.target as Node)) setTblZoneDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 筛选后数据（当期 + 上期同样筛选）
  const filtered = useMemo(() => {
    let d = data;
    if (filterBusinessTypes.length > 0) d = d.filter(r => filterBusinessTypes.includes(r.business_type));
    if (filterAdNames.length > 0) d = d.filter(r => filterAdNames.includes(r.ad_name));
    if (filterZones.length > 0) d = d.filter(r => filterZones.includes(r.zone_name));
    return d;
  }, [data, filterBusinessTypes, filterAdNames, filterZones]);

  const prevFiltered = useMemo(() => {
    let d = prevData ?? [];
    if (filterBusinessTypes.length > 0) d = d.filter(r => filterBusinessTypes.includes(r.business_type));
    if (filterAdNames.length > 0) d = d.filter(r => filterAdNames.includes(r.ad_name));
    if (filterZones.length > 0) d = d.filter(r => filterZones.includes(r.zone_name));
    return d;
  }, [prevData, filterBusinessTypes, filterAdNames, filterZones]);

  // 2. 漏斗图数据
  const funnelData = useMemo(() => {
    const totalImpressions = filtered.reduce((s, r) => s + (Number(r.impressions) || 0), 0);
    const totalClicks = filtered.reduce((s, r) => s + (Number(r.clicks) || 0), 0);
    const totalUvChannel = filtered.reduce((s, r) => s + (Number(r.uv_channel) || 0), 0);
    const totalZoneClicks = filtered.reduce((s, r) => s + (Number(r.zone_clicks) || 0), 0);
    return [
      { name: '曝光量', value: totalImpressions, fill: '#3B82F6' },
      { name: '点击量', value: totalClicks, fill: '#F59E0B' },
      { name: 'UV(渠道)', value: totalUvChannel, fill: '#EC4899' },
      { name: '专区点击量', value: totalZoneClicks, fill: '#10B981' },
    ];
  }, [filtered]);

  // 3. 广告CTR横向柱状图
  const adCtrData = useMemo(() => {
    const map = new Map<string, { impressions: number; clicks: number }>();
    filtered.forEach(r => {
      const cur = map.get(r.ad_name) || { impressions: 0, clicks: 0 };
      cur.impressions += Number(r.impressions) || 0;
      cur.clicks += Number(r.clicks) || 0;
      map.set(r.ad_name, cur);
    });
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ctr: v.impressions > 0 ? +(v.clicks / v.impressions * 100).toFixed(2) : 0 }))
      .sort((a, b) => b.ctr - a.ctr)
      .slice(0, 15);
  }, [filtered]);

  // 4. 趋势折线图
  const trendData = useMemo(() => {
    const map = new Map<string, { impressions: number; clicks: number }>();
    filtered.forEach(r => {
      const cur = map.get(r.date) || { impressions: 0, clicks: 0 };
      cur.impressions += Number(r.impressions) || 0;
      cur.clicks += Number(r.clicks) || 0;
      map.set(r.date, cur);
    });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date: formatDate(date),
        impressions: v.impressions,
        clicks: v.clicks,
        ctr: v.impressions > 0 ? +(v.clicks / v.impressions * 100).toFixed(2) : 0,
      }));
  }, [filtered]);



  const openModal = () => {
    setSummaryFile(null);
    setAdFile(null);
    setZoneFile(null);
    setBatchFiles([]);
    setResult(null);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setSummaryFile(null);
    setAdFile(null);
    setZoneFile(null);
    setBatchFiles([]);
  };

  const handleUpload = async () => {
    if (!summaryFile || !adFile || !zoneFile) {
      setResult({ success: false, message: '请上传全部 3 个文件' });
      return;
    }
    setUploading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('index_json', summaryFile);
      formData.append('ad_json', adFile);
      formData.append('zone_json', zoneFile);
      // 批量文件
      for (const f of batchFiles) {
        formData.append('material_files', f);
      }

      const res = await fetch(REVIEW_PARTNER_UPLOAD_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('blue_os_token') || ''}`
        },
        body: formData,
      });
      if (!res.ok) {
        let msg = `请求失败 (${res.status})`;
        try { const err = await res.json(); msg = err.message || msg; } catch {}
        setResult({ success: false, message: msg });
        return;
      }
      const data = await res.json();
      if (data.success) {
        setResult({ success: true, message: '数据整理完成，工作流已执行' });
        // 清空文件输入框
        setSummaryFile(null);
        setAdFile(null);
        setZoneFile(null);
        setBatchFiles([]);
        // 清空 file input 的值
        if (summaryRef.current) summaryRef.current.value = '';
        if (adRef.current) adRef.current.value = '';
        if (zoneRef.current) zoneRef.current.value = '';
        if (batchRef.current) batchRef.current.value = '';
        // 通知父组件刷新数据
        onUploadSuccess?.();
      } else {
        setResult({ success: false, message: data.message || '上传失败' });
      }
    } catch (err: any) {
      setResult({ success: false, message: err.message || '网络错误' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="overflow-auto">
      {/* 筛选器 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* 业务类型多选下拉 */}
        {businessTypeOptions.length > 0 && (
          <div className="relative" ref={btDropdownRef}>
            <button
              onClick={() => setBtDropdownOpen(v => !v)}
              className="flex items-center gap-1.5 border border-slate-300 rounded bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:border-blue-400 focus:border-blue-500 focus:outline-none min-w-[140px]"
            >
              <span className="flex-1 text-left truncate">
                {filterBusinessTypes.length === 0 ? '业务类型' :
                 filterBusinessTypes.length <= 2 ? filterBusinessTypes.join(', ') :
                 `已选 ${filterBusinessTypes.length} 项`}
              </span>
              {filterBusinessTypes.length > 0 && (
                <span
                  onClick={e => { e.stopPropagation(); setFilterBusinessTypes([]); }}
                  className="text-slate-400 hover:text-red-500"
                >
                  <X className="w-3.5 h-3.5" />
                </span>
              )}
              <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {btDropdownOpen && (
              <div className="absolute z-50 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100">
                  <button
                    onClick={() => setFilterBusinessTypes([...businessTypeOptions])}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >全选</button>
                  <button
                    onClick={() => setFilterBusinessTypes([])}
                    className="text-xs text-slate-500 hover:text-red-500"
                  >全部取消</button>
                </div>
                <div className="max-h-48 overflow-auto">
                {businessTypeOptions.map(bt => {
                  const checked = filterBusinessTypes.includes(bt);
                  return (
                    <label key={bt} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-slate-50 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setFilterBusinessTypes(prev =>
                          checked ? prev.filter(v => v !== bt) : [...prev, bt]
                        )}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className={checked ? 'text-blue-700 font-medium' : 'text-slate-700'}>{bt}</span>
                    </label>
                  );
                })}
                </div>
              </div>
            )}
          </div>
        )}
        {/* 广告名称多选下拉 */}
        {adOptions.length > 0 && (
          <div className="relative" ref={adDropdownRef}>
            <button
              onClick={() => setAdDropdownOpen(v => !v)}
              className="flex items-center gap-1.5 border border-slate-300 rounded bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:border-blue-400 focus:border-blue-500 focus:outline-none min-w-[140px]"
            >
              <span className="flex-1 text-left truncate">
                {filterAdNames.length === 0 ? '广告名称' :
                 filterAdNames.length <= 2 ? filterAdNames.join(', ') :
                 `已选 ${filterAdNames.length} 项`}
              </span>
              {filterAdNames.length > 0 && (
                <span
                  onClick={e => { e.stopPropagation(); setFilterAdNames([]); }}
                  className="text-slate-400 hover:text-red-500"
                >
                  <X className="w-3.5 h-3.5" />
                </span>
              )}
              <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {adDropdownOpen && (
              <div className="absolute z-50 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100">
                  <button
                    onClick={() => setFilterAdNames([...adOptions])}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >全选</button>
                  <button
                    onClick={() => setFilterAdNames([])}
                    className="text-xs text-slate-500 hover:text-red-500"
                  >全部取消</button>
                </div>
                <div className="max-h-48 overflow-auto">
                {adOptions.map(ad => {
                  const checked = filterAdNames.includes(ad);
                  return (
                    <label key={ad} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-slate-50 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setFilterAdNames(prev =>
                          checked ? prev.filter(v => v !== ad) : [...prev, ad]
                        )}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className={checked ? 'text-blue-700 font-medium' : 'text-slate-700'}>{ad}</span>
                    </label>
                  );
                })}
                </div>
              </div>
            )}
          </div>
        )}
        {/* 专区多选下拉 */}
        {zoneOptions.length > 0 && (
          <div className="relative" ref={zoneDropdownRef}>
            <button
              onClick={() => setZoneDropdownOpen(v => !v)}
              className="flex items-center gap-1.5 border border-slate-300 rounded bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:border-blue-400 focus:border-blue-500 focus:outline-none min-w-[140px]"
            >
              <span className="flex-1 text-left truncate">
                {filterZones.length === 0 ? '专区名称' :
                 filterZones.length <= 2 ? filterZones.join(', ') :
                 `已选 ${filterZones.length} 项`}
              </span>
              {filterZones.length > 0 && (
                <span
                  onClick={e => { e.stopPropagation(); setFilterZones([]); }}
                  className="text-slate-400 hover:text-red-500"
                >
                  <X className="w-3.5 h-3.5" />
                </span>
              )}
              <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {zoneDropdownOpen && (
              <div className="absolute z-50 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100">
                  <button
                    onClick={() => setFilterZones([...zoneOptions])}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >全选</button>
                  <button
                    onClick={() => setFilterZones([])}
                    className="text-xs text-slate-500 hover:text-red-500"
                  >全部取消</button>
                </div>
                <div className="max-h-48 overflow-auto">
                {zoneOptions.map(zone => {
                  const checked = filterZones.includes(zone);
                  return (
                    <label key={zone} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-slate-50 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setFilterZones(prev =>
                          checked ? prev.filter(v => v !== zone) : [...prev, zone]
                        )}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className={checked ? 'text-blue-700 font-medium' : 'text-slate-700'}>{zone}</span>
                    </label>
                  );
                })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-4">
          {/* 业务类型分组指标卡 */}
          {filterBusinessTypes.length > 0 && (() => {
            const hb = (cur: number, prv: number) => {
              if (prv === 0) return null;
              return ((cur - prv) / prv * 100).toFixed(1);
            };

            return (
              <div className="space-y-4">
                {filterBusinessTypes.map(bt => {
                  const btData = filtered.filter(r => r.business_type === bt);
                  const btPrev = prevFiltered.filter(r => r.business_type === bt);
                  const ti = btData.reduce((s, r) => s + (Number(r.impressions) || 0), 0);
                  const tc = btData.reduce((s, r) => s + (Number(r.clicks) || 0), 0);
                  const ctr = ti > 0 ? (tc / ti * 100) : 0;
                  const stayArr = btData.map(r => Number(r.avg_stay_seconds) || 0).filter(v => v > 0);
                  const avgStay = stayArr.length > 0 ? stayArr.reduce((a, b) => a + b, 0) / stayArr.length : 0;
                  const pti = btPrev.reduce((s, r) => s + (Number(r.impressions) || 0), 0);
                  const ptc = btPrev.reduce((s, r) => s + (Number(r.clicks) || 0), 0);
                  const pCtr = pti > 0 ? (ptc / pti * 100) : 0;
                  const pStayArr = btPrev.map(r => Number(r.avg_stay_seconds) || 0).filter(v => v > 0);
                  const pAvgStay = pStayArr.length > 0 ? pStayArr.reduce((a, b) => a + b, 0) / pStayArr.length : 0;
                  const cards = [
                    { label: '总曝光', desc: 'SUM(曝光量)', value: ti.toLocaleString(), color: 'text-blue-600', bg: 'bg-blue-50', hbVal: hb(ti, pti) },
                    { label: '总点击', desc: 'SUM(点击量)', value: tc.toLocaleString(), color: 'text-amber-600', bg: 'bg-amber-50', hbVal: hb(tc, ptc) },
                    { label: '整体CTR', desc: '总点击 ÷ 总曝光 × 100%', value: `${ctr.toFixed(2)}%`, color: 'text-emerald-600', bg: 'bg-emerald-50', hbVal: btPrev.length > 0 ? (ctr - pCtr).toFixed(2) + 'pp' : null },
                    { label: '平均停留(秒)', desc: 'AVG(次均停留时长)', value: avgStay.toFixed(1), color: 'text-purple-600', bg: 'bg-purple-50', hbVal: btPrev.length > 0 ? (avgStay - pAvgStay).toFixed(1) + 's' : null },
                  ];
                  return (
                    <div key={bt} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-1 rounded-full bg-blue-400" />
                        <span className="text-sm font-medium text-slate-700">{bt}</span>
                      </div>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {cards.map(c => (
                          <div key={c.label} className={`${c.bg} rounded-lg p-4 border border-slate-100`}>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-xs text-slate-500">{c.label}</span>
                              <span className="text-[10px] text-slate-400" title={c.desc}>{c.desc}</span>
                            </div>
                            <div className={`text-2xl font-bold ${c.color} mt-1`}>{c.value}</div>
                            {c.hbVal !== null && (
                              <div className={`text-xs mt-1 ${
                                c.label === '整体CTR' ? (parseFloat(c.hbVal) >= 0 ? 'text-emerald-500' : 'text-red-500') :
                                c.label === '平均停留(秒)' ? (parseFloat(c.hbVal) >= 0 ? 'text-purple-500' : 'text-slate-400') :
                                (parseFloat(c.hbVal) >= 0 ? 'text-emerald-500' : 'text-red-500')
                              }`}>
                                环比 {parseFloat(c.hbVal) >= 0 ? '↑' : '↓'} {Math.abs(parseFloat(c.hbVal))}{c.label === '整体CTR' ? '' : c.label === '平均停留(秒)' ? '' : '%'}
                              </div>
                            )}
                            {c.hbVal === null && <div className="text-xs mt-1 text-slate-400">环比 -</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* Row 1: 整体指标卡（选中业务类型时不显示） */}
          {filterBusinessTypes.length === 0 && (() => {
            const hb = (cur: number, prv: number) => {
              if (prv === 0) return null;
              return ((cur - prv) / prv * 100).toFixed(1);
            };
            const prev = prevFiltered;
            const prevImpressions = prev.reduce((s, r) => s + (Number(r.impressions) || 0), 0);
            const prevClicks = prev.reduce((s, r) => s + (Number(r.clicks) || 0), 0);
            const prevCtr = prevImpressions > 0 ? (prevClicks / prevImpressions * 100) : 0;
            const prevStayArr = prev.map(r => Number(r.avg_stay_seconds) || 0).filter(v => v > 0);
            const prevAvgStay = prevStayArr.length > 0 ? prevStayArr.reduce((a, b) => a + b, 0) / prevStayArr.length : 0;
            const curImpressions = filtered.reduce((s, r) => s + (Number(r.impressions) || 0), 0);
            const curClicks = filtered.reduce((s, r) => s + (Number(r.clicks) || 0), 0);
            const curCtr = curImpressions > 0 ? (curClicks / curImpressions * 100) : 0;
            const curStayArr = filtered.map(r => Number(r.avg_stay_seconds) || 0).filter(v => v > 0);
            const curAvgStay = curStayArr.length > 0 ? curStayArr.reduce((a, b) => a + b, 0) / curStayArr.length : 0;
            const cards = [
              { label: '总曝光', desc: 'SUM(曝光量)', value: curImpressions.toLocaleString(), color: 'text-blue-600', bg: 'bg-blue-50', hbVal: hb(curImpressions, prevImpressions) },
              { label: '总点击', desc: 'SUM(点击量)', value: curClicks.toLocaleString(), color: 'text-amber-600', bg: 'bg-amber-50', hbVal: hb(curClicks, prevClicks) },
              { label: '整体CTR', desc: '总点击 ÷ 总曝光 × 100%', value: `${curCtr.toFixed(2)}%`, color: 'text-emerald-600', bg: 'bg-emerald-50', hbVal: prev.length > 0 ? (curCtr - prevCtr).toFixed(2) + 'pp' : null },
              { label: '平均停留(秒)', desc: 'AVG(次均停留时长)', value: curAvgStay.toFixed(1), color: 'text-purple-600', bg: 'bg-purple-50', hbVal: prev.length > 0 ? (curAvgStay - prevAvgStay).toFixed(1) + 's' : null },
            ];
            return (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {cards.map(c => (
                  <div key={c.label} className={`${c.bg} rounded-lg p-4 border border-slate-100`}>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xs text-slate-500">{c.label}</span>
                      <span className="text-[10px] text-slate-400" title={c.desc}>{c.desc}</span>
                    </div>
                    <div className={`text-2xl font-bold ${c.color} mt-1`}>{c.value}</div>
                    {c.hbVal !== null && (
                      <div className={`text-xs mt-1 ${
                        c.label === '整体CTR' ? (parseFloat(c.hbVal) >= 0 ? 'text-emerald-500' : 'text-red-500') :
                        c.label === '平均停留(秒)' ? (parseFloat(c.hbVal) >= 0 ? 'text-purple-500' : 'text-slate-400') :
                        (parseFloat(c.hbVal) >= 0 ? 'text-emerald-500' : 'text-red-500')
                      }`}>
                        环比 {parseFloat(c.hbVal) >= 0 ? '↑' : '↓'} {Math.abs(parseFloat(c.hbVal))}{c.label === '整体CTR' ? '' : c.label === '平均停留(秒)' ? '' : '%'}
                      </div>
                    )}
                    {c.hbVal === null && <div className="text-xs mt-1 text-slate-400">环比 -</div>}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Row 2: 漏斗(50%) + 广告CTR(50%) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 漏斗图 */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
              <h3 className="text-sm font-medium text-slate-600 mb-1">转化漏斗</h3>
              <p className="text-[11px] text-slate-400 mb-3">曝光量 → 点击量 → UV(渠道) → 专区点击量，逐级递减展示全站汇总</p>
              <div className="space-y-2">
                {funnelData.map((item) => {
                  const maxVal = funnelData[0].value || 1;
                  const pct = (item.value / maxVal * 100);
                  const pctStr = pct >= 1 ? pct.toFixed(1) : pct >= 0.01 ? pct.toFixed(2) : '<0.01';
                  // 使用平方根缩放，让数据差距大时小条形仍然可见
                  const barWidth = Math.sqrt(pct / 100) * 100;
                  const wide = barWidth >= 25;
                  return (
                    <div key={item.name} className="flex items-center gap-3">
                      <span className="text-xs text-slate-500 w-24 text-right shrink-0">{item.name}</span>
                      <div className="flex-1 h-7 bg-slate-100 rounded relative">
                        <div className="h-full rounded transition-all"
                          style={{ width: `${Math.max(barWidth, 3)}%`, backgroundColor: item.fill }} />
                        <span className={`absolute top-0 h-full flex items-center text-xs font-medium ${wide ? 'left-2 text-white drop-shadow' : 'text-slate-600'}`}
                          style={wide ? {} : { left: `calc(${Math.max(barWidth, 3)}% + 6px)` }}>
                          {item.value.toLocaleString()}
                        </span>
                      </div>
                      <span className="text-xs text-slate-400 w-12 shrink-0">{pctStr}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* 广告CTR对比 */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
              <h3 className="text-sm font-medium text-slate-600 mb-1">广告 CTR 排行</h3>
              <p className="text-[11px] text-slate-400 mb-3">CTR = SUM(点击量) ÷ SUM(曝光量) × 100%，按广告名称汇总降序 Top15</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={adCtrData} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <XAxis type="number" fontSize={11} tickFormatter={(v: number) => `${v}%`} />
                  <YAxis type="category" dataKey="name" fontSize={11} width={100} tick={{ overflow: 'hidden' }} />
                  <Tooltip formatter={(v) => `${v}%`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="ctr" name="CTR" radius={[0, 4, 4, 0]} barSize={14}>
                    {adCtrData.map((_, i) => (
                      <Cell key={i} fill={`hsl(${210 - i * 15}, 70%, 55%)`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Row 3: 趋势折线满宽 */}
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
            <h3 className="text-sm font-medium text-slate-600 mb-1">趋势分析</h3>
            <p className="text-[11px] text-slate-400 mb-3">左轴: 曝光量/点击量（柱状），右轴: CTR = 点击量 ÷ 曝光量 × 100%（折线），按日期汇总</p>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" fontSize={11} stroke="#64748b" />
                <YAxis yAxisId="left" fontSize={11} stroke="#3b82f6" tickFormatter={(v: number) => v >= 10000 ? `${(v / 10000).toFixed(0)}万` : String(v)} />
                <YAxis yAxisId="right" orientation="right" fontSize={11} stroke="#10b981" tickFormatter={(v: number) => `${v}%`} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Legend />
                <Bar yAxisId="left" dataKey="impressions" name="曝光量" fill="#3B82F6" fillOpacity={0.5} barSize={20} radius={[2, 2, 0, 0]} />
                <Bar yAxisId="left" dataKey="clicks" name="点击量" fill="#F59E0B" fillOpacity={0.5} barSize={20} radius={[2, 2, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="ctr" name="CTR(%)" stroke="#10B981" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

        </div>

      {/* 表格卡片 */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 mt-4">
        {/* 表格标题 */}
        <div className="flex items-center px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-medium text-slate-600">数据表格</h3>
          <button onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setAzAnchorPos({ top: r.top, left: r.left }); setShowAzColSettings(true); }}
            className="ml-2 px-1.5 py-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-400 transition" title="列设置">
            <Settings className="w-3.5 h-3.5" />
          </button>
          {/* 表格级过滤器 */}
          <div className="flex items-center gap-2 ml-3">
            {/* 业务类型 */}
            {businessTypeOptions.length > 0 && (
              <div className="relative" ref={tblBtDropdownRef}>
                <button
                  onClick={() => setTblBtDropdownOpen(v => !v)}
                  className="flex items-center gap-1 border border-slate-300 rounded bg-white px-2 py-1 text-xs text-slate-700 hover:border-blue-400 focus:outline-none min-w-[100px]"
                >
                  <span className="flex-1 text-left truncate">
                    {filterBusinessTypes.length === 0 ? '业务类型' :
                     filterBusinessTypes.length <= 1 ? filterBusinessTypes[0] :
                     `${filterBusinessTypes.length}项`}
                  </span>
                  {filterBusinessTypes.length > 0 && (
                    <span onClick={e => { e.stopPropagation(); setFilterBusinessTypes([]); }} className="text-slate-400 hover:text-red-500">
                      <X className="w-3 h-3" />
                    </span>
                  )}
                  <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
                {tblBtDropdownOpen && (
                  <div className="absolute z-50 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
                    <div className="flex items-center justify-between px-3 py-1 border-b border-slate-100">
                      <button onClick={() => setFilterBusinessTypes([...businessTypeOptions])} className="text-xs text-blue-600 hover:text-blue-800">全选</button>
                      <button onClick={() => setFilterBusinessTypes([])} className="text-xs text-slate-500 hover:text-red-500">取消</button>
                    </div>
                    <div className="max-h-40 overflow-auto">
                      {businessTypeOptions.map(bt => {
                        const checked = filterBusinessTypes.includes(bt);
                        return (
                          <label key={bt} className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-slate-50 text-xs">
                            <input type="checkbox" checked={checked}
                              onChange={() => setFilterBusinessTypes(prev => checked ? prev.filter(v => v !== bt) : [...prev, bt])}
                              className="rounded border-slate-300 text-blue-600" />
                            <span className={checked ? 'text-blue-700 font-medium' : 'text-slate-700'}>{bt}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* 广告名称 */}
            {adOptions.length > 0 && (
              <div className="relative" ref={tblAdDropdownRef}>
                <button
                  onClick={() => setTblAdDropdownOpen(v => !v)}
                  className="flex items-center gap-1 border border-slate-300 rounded bg-white px-2 py-1 text-xs text-slate-700 hover:border-blue-400 focus:outline-none min-w-[100px]"
                >
                  <span className="flex-1 text-left truncate">
                    {filterAdNames.length === 0 ? '广告名称' :
                     filterAdNames.length <= 1 ? filterAdNames[0] :
                     `${filterAdNames.length}项`}
                  </span>
                  {filterAdNames.length > 0 && (
                    <span onClick={e => { e.stopPropagation(); setFilterAdNames([]); }} className="text-slate-400 hover:text-red-500">
                      <X className="w-3 h-3" />
                    </span>
                  )}
                  <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
                {tblAdDropdownOpen && (
                  <div className="absolute z-50 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
                    <div className="flex items-center justify-between px-3 py-1 border-b border-slate-100">
                      <button onClick={() => setFilterAdNames([...adOptions])} className="text-xs text-blue-600 hover:text-blue-800">全选</button>
                      <button onClick={() => setFilterAdNames([])} className="text-xs text-slate-500 hover:text-red-500">取消</button>
                    </div>
                    <div className="max-h-40 overflow-auto">
                      {adOptions.map(ad => {
                        const checked = filterAdNames.includes(ad);
                        return (
                          <label key={ad} className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-slate-50 text-xs">
                            <input type="checkbox" checked={checked}
                              onChange={() => setFilterAdNames(prev => checked ? prev.filter(v => v !== ad) : [...prev, ad])}
                              className="rounded border-slate-300 text-blue-600" />
                            <span className={checked ? 'text-blue-700 font-medium' : 'text-slate-700'}>{ad}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* 专区 */}
            {zoneOptions.length > 0 && (
              <div className="relative" ref={tblZoneDropdownRef}>
                <button
                  onClick={() => setTblZoneDropdownOpen(v => !v)}
                  className="flex items-center gap-1 border border-slate-300 rounded bg-white px-2 py-1 text-xs text-slate-700 hover:border-blue-400 focus:outline-none min-w-[100px]"
                >
                  <span className="flex-1 text-left truncate">
                    {filterZones.length === 0 ? '专区名称' :
                     filterZones.length <= 1 ? filterZones[0] :
                     `${filterZones.length}项`}
                  </span>
                  {filterZones.length > 0 && (
                    <span onClick={e => { e.stopPropagation(); setFilterZones([]); }} className="text-slate-400 hover:text-red-500">
                      <X className="w-3 h-3" />
                    </span>
                  )}
                  <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
                {tblZoneDropdownOpen && (
                  <div className="absolute z-50 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
                    <div className="flex items-center justify-between px-3 py-1 border-b border-slate-100">
                      <button onClick={() => setFilterZones([...zoneOptions])} className="text-xs text-blue-600 hover:text-blue-800">全选</button>
                      <button onClick={() => setFilterZones([])} className="text-xs text-slate-500 hover:text-red-500">取消</button>
                    </div>
                    <div className="max-h-40 overflow-auto">
                      {zoneOptions.map(zone => {
                        const checked = filterZones.includes(zone);
                        return (
                          <label key={zone} className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-slate-50 text-xs">
                            <input type="checkbox" checked={checked}
                              onChange={() => setFilterZones(prev => checked ? prev.filter(v => v !== zone) : [...prev, zone])}
                              className="rounded border-slate-300 text-blue-600" />
                            <span className={checked ? 'text-blue-700 font-medium' : 'text-slate-700'}>{zone}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <button onClick={openModal}
            className="ml-auto flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded transition whitespace-nowrap">
            <Upload className="w-3 h-3" />上传文件
          </button>
          {filtered.length > 0 && (
            <button
              onClick={() => {
                const headers = AZ_COL_KEYS.filter(k => azCol.visible.has(k)).map(k => AZ_COLS.find(c => c.key === k)!.label);
                const rows = filtered.map(r => {
                  const _rv: Record<string, any> = { business_type: r.business_type || '', promotion_name: r.promotion_name || '', ad_id: r.ad_id, ad_name: r.ad_name, date: r.date, impressions: r.impressions, impression_users: r.impression_users, clicks: r.clicks, click_users: r.click_users, zone_id: r.zone_id ?? '', zone_name: r.zone_name, zone_content: r.zone_content, pv: r.pv, uv_openid: r.uv_openid, uv_channel: r.uv_channel, zone_clicks: r.zone_clicks, zone_click_users: r.zone_click_users, avg_stay_seconds: r.avg_stay_seconds, material_name: r.material_name ?? '', we_visitors: r.we_visitors ?? '', we_visits: r.we_visits ?? '' };
                  return AZ_COL_KEYS.filter(k => azCol.visible.has(k)).map(k => _rv[k]);
                });
                const csv = '\uFEFF' + [headers, ...rows].map(r => r.map((c: any) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `广告专区数据_${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="ml-2 flex items-center gap-1 px-3 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-600 text-xs font-medium rounded transition whitespace-nowrap"
            >
              <Download className="w-3 h-3" />下载数据
            </button>
          )}
        </div>
        {/* 表格 */}
        <div className="overflow-x-auto">
          {loading && <div className="flex items-center gap-2 py-8 justify-center text-slate-400"><Loader2 className="w-4 h-4 animate-spin" />加载中...</div>}
          {!loading && filtered.length === 0 && <div className="text-center py-8 text-slate-400 text-sm">暂无数据</div>}
          {filtered.length > 0 && <table className="text-sm" style={{ tableLayout: 'auto', minWidth: '100%', width: 'max-content' }}>
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {AZ_COL_KEYS.filter(k => azCol.visible.has(k)).map(k => {
                  const leftKeys = new Set(['business_type','promotion_name','ad_id','ad_name','date','zone_id','zone_name','zone_content','material_name']);
                  const wideKeys = new Set(['ad_name','zone_name','material_name']);
                  const align = leftKeys.has(k) ? 'text-left' : 'text-right';
                  const wide = wideKeys.has(k) ? ' w-[120px]' : '';
                  const nowrap = ' whitespace-nowrap';
                  const labels: Record<string, string> = { business_type:'业务类型', promotion_name:'推广名称', ad_id:'广告 ID', ad_name:'广告名称', date:'日期', impressions:'曝光量', impression_users:'曝光人数', clicks:'点击量', click_users:'点击人数', zone_id:'专区 ID', zone_name:'专区名称', zone_content:'专区内容', pv:'PV', uv_openid:'UV(OpenId)', uv_channel:'UV(渠道)', zone_clicks:'专区点击量', zone_click_users:'专区点击人数', avg_stay_seconds:'次均停留 (秒)', material_name:'素材名称', we_visitors:'访问人数', we_visits:'访问次数' };
                  return <th key={k} className={`${align} py-2.5 px-3 text-slate-500 font-medium${wide}${nowrap}`}>{labels[k]}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const fmt = (v: any) => (v != null && !isNaN(v)) ? Number(v).toLocaleString() : '-';
                const _cells: Record<string, React.ReactNode> = {
                  business_type: <td key="business_type" className="py-2 px-3 text-slate-500 whitespace-nowrap">{r.business_type || ''}</td>,
                  promotion_name: <td key="promotion_name" className="py-2 px-3 text-slate-700 whitespace-nowrap">{r.promotion_name || ''}</td>,
                  ad_id: <td key="ad_id" className="py-2 px-3 text-blue-600 font-medium whitespace-nowrap">{r.ad_id}</td>,
                  ad_name: <td key="ad_name" className="py-2 px-3 text-slate-700 w-[120px] whitespace-pre-line leading-relaxed" title={r.ad_name}>{r.ad_name}</td>,
                  date: <td key="date" className="py-2 px-3 text-slate-500 whitespace-nowrap">{r.date}</td>,
                  impressions: <td key="impressions" className="py-2 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">{fmt(r.impressions)}</td>,
                  impression_users: <td key="impression_users" className="py-2 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">{fmt(r.impression_users)}</td>,
                  clicks: <td key="clicks" className="py-2 px-3 text-right text-amber-600 tabular-nums whitespace-nowrap">{fmt(r.clicks)}</td>,
                  click_users: <td key="click_users" className="py-2 px-3 text-right text-amber-600 tabular-nums whitespace-nowrap">{fmt(r.click_users)}</td>,
                  zone_id: <td key="zone_id" className="py-2 px-3 text-emerald-600 whitespace-nowrap">{r.zone_id ?? '-'}</td>,
                  zone_name: <td key="zone_name" className="py-2 px-3 text-slate-700 w-[120px] break-all whitespace-normal leading-relaxed" title={r.zone_name || '-'}>{r.zone_name || '-'}</td>,
                  zone_content: <td key="zone_content" className="py-2 px-3 text-slate-700 whitespace-nowrap">{r.zone_content || '-'}</td>,
                  pv: <td key="pv" className="py-2 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">{fmt(r.pv)}</td>,
                  uv_openid: <td key="uv_openid" className="py-2 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">{fmt(r.uv_openid)}</td>,
                  uv_channel: <td key="uv_channel" className="py-2 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">{fmt(r.uv_channel)}</td>,
                  zone_clicks: <td key="zone_clicks" className="py-2 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">{fmt(r.zone_clicks)}</td>,
                  zone_click_users: <td key="zone_click_users" className="py-2 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">{fmt(r.zone_click_users)}</td>,
                  avg_stay_seconds: <td key="avg_stay_seconds" className="py-2 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">{r.avg_stay_seconds != null ? r.avg_stay_seconds : '-'}</td>,
                  material_name: <td key="material_name" className="py-2 px-3 text-slate-700 w-[120px] whitespace-pre-line leading-relaxed" title={r.material_name || '-'}>{r.material_name || '-'}</td>,
                  we_visitors: <td key="we_visitors" className="py-2 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">{fmt(r.we_visitors)}</td>,
                  we_visits: <td key="we_visits" className="py-2 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">{fmt(r.we_visits)}</td>,
                };
                return (
                <tr key={`${r.date}-${r.ad_id}-${r.zone_id ?? 'none'}`} className="border-b border-slate-100 hover:bg-blue-50/40 transition-colors">
                  {AZ_COL_KEYS.filter(k => azCol.visible.has(k)).map(k => _cells[k])}
                </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-sm">
                {(() => {
                  const _ft: Record<string, React.ReactNode> = {
                    date: <td key="date" className="py-2.5 px-3 text-slate-700 whitespace-nowrap">合计</td>,
                    business_type: <td key="business_type" className="py-2.5 px-3 text-center text-slate-400 whitespace-nowrap">-</td>,
                    promotion_name: <td key="promotion_name" className="py-2.5 px-3 text-center text-slate-400 whitespace-nowrap">-</td>,
                    ad_id: <td key="ad_id" className="py-2.5 px-3 text-center text-slate-400 whitespace-nowrap">-</td>,
                    ad_name: <td key="ad_name" className="py-2.5 px-3 text-center text-slate-400 whitespace-nowrap">-</td>,
                    impressions: <td key="impressions" className="py-2.5 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">{filtered.reduce((s, r) => s + (Number(r.impressions) || 0), 0).toLocaleString()}</td>,
                    impression_users: <td key="impression_users" className="py-2.5 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">{filtered.reduce((s, r) => s + (Number(r.impression_users) || 0), 0).toLocaleString()}</td>,
                    clicks: <td key="clicks" className="py-2.5 px-3 text-right text-amber-600 tabular-nums whitespace-nowrap">{filtered.reduce((s, r) => s + (Number(r.clicks) || 0), 0).toLocaleString()}</td>,
                    click_users: <td key="click_users" className="py-2.5 px-3 text-right text-amber-600 tabular-nums whitespace-nowrap">{filtered.reduce((s, r) => s + (Number(r.click_users) || 0), 0).toLocaleString()}</td>,
                    zone_id: <td key="zone_id" className="py-2.5 px-3 text-center text-slate-400 whitespace-nowrap">-</td>,
                    zone_name: <td key="zone_name" className="py-2.5 px-3 text-center text-slate-400 whitespace-nowrap">-</td>,
                    zone_content: <td key="zone_content" className="py-2.5 px-3 text-center text-slate-400 whitespace-nowrap">-</td>,
                    pv: <td key="pv" className="py-2.5 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">{filtered.reduce((s, r) => s + (Number(r.pv) || 0), 0).toLocaleString()}</td>,
                    uv_openid: <td key="uv_openid" className="py-2.5 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">{filtered.reduce((s, r) => s + (Number(r.uv_openid) || 0), 0).toLocaleString()}</td>,
                    uv_channel: <td key="uv_channel" className="py-2.5 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">{filtered.reduce((s, r) => s + (Number(r.uv_channel) || 0), 0).toLocaleString()}</td>,
                    zone_clicks: <td key="zone_clicks" className="py-2.5 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">{filtered.reduce((s, r) => s + (Number(r.zone_clicks) || 0), 0).toLocaleString()}</td>,
                    zone_click_users: <td key="zone_click_users" className="py-2.5 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">{filtered.reduce((s, r) => s + (Number(r.zone_click_users) || 0), 0).toLocaleString()}</td>,
                    avg_stay_seconds: <td key="avg_stay_seconds" className="py-2.5 px-3 text-center text-slate-400 whitespace-nowrap">-</td>,
                    material_name: <td key="material_name" className="py-2.5 px-3 text-center text-slate-400 whitespace-nowrap">-</td>,
                    we_visitors: <td key="we_visitors" className="py-2.5 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">{filtered.reduce((s, r) => s + (Number(r.we_visitors) || 0), 0).toLocaleString()}</td>,
                    we_visits: <td key="we_visits" className="py-2.5 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">{filtered.reduce((s, r) => s + (Number(r.we_visits) || 0), 0).toLocaleString()}</td>,
                  };
                  return AZ_COL_KEYS.filter(k => azCol.visible.has(k)).map(k => _ft[k]);
                })()}
              </tr>
            </tfoot>
          </table>}
        </div>
      </div>

      {/* 列设置面板 */}
      {showAzColSettings && (
        <ColumnSettingsPanel columns={AZ_COLS} visible={azCol.visible} onToggle={azCol.toggle} onReset={azCol.resetAll} onClose={() => setShowAzColSettings(false)} anchorPos={azAnchorPos} />
      )}

      {/* 上传文件弹窗 */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={closeModal}>
          <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-base font-semibold text-slate-800">上传刷码页业务数据情况</h3>
              <button onClick={closeModal} className="p-1 rounded hover:bg-slate-100 transition">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            {/* 弹窗内容 */}
            <div className="px-6 py-5 space-y-4 overflow-y-auto">
              <p className="text-sm text-slate-500">请上传 3 个 Excel 表格文件和批量素材文件，上传后将触发数据整理工作流。</p>
              {/* 关联关系索引 */}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">关联关系索引</span>
                <button
                  onClick={() => summaryRef.current?.click()}
                  className={`flex items-center gap-2 px-3 py-2.5 border rounded-lg text-sm transition w-full text-left ${
                    summaryFile ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {summaryFile ? (
                    <><CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" /><span className="truncate flex-1">{summaryFile.name}</span></>
                  ) : (
                    <><Upload className="w-4 h-4 text-slate-400 flex-shrink-0" /><span>选择 Excel 文件</span></>
                  )}
                </button>
                <input ref={summaryRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={e => { setSummaryFile(e.target.files?.[0] || null); setResult(null); }} />
              </div>
              {/* 广告位 */}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">广告位数据</span>
                <button
                  onClick={() => adRef.current?.click()}
                  className={`flex items-center gap-2 px-3 py-2.5 border rounded-lg text-sm transition w-full text-left ${
                    adFile ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {adFile ? (
                    <><CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" /><span className="truncate flex-1">{adFile.name}</span></>
                  ) : (
                    <><Upload className="w-4 h-4 text-slate-400 flex-shrink-0" /><span>选择 Excel 文件</span></>
                  )}
                </button>
                <input ref={adRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={e => { setAdFile(e.target.files?.[0] || null); setResult(null); }} />
              </div>
              {/* 专区页 */}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">专区页数据</span>
                <button
                  onClick={() => zoneRef.current?.click()}
                  className={`flex items-center gap-2 px-3 py-2.5 border rounded-lg text-sm transition w-full text-left ${
                    zoneFile ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {zoneFile ? (
                    <><CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" /><span className="truncate flex-1">{zoneFile.name}</span></>
                  ) : (
                    <><Upload className="w-4 h-4 text-slate-400 flex-shrink-0" /><span>选择 Excel 文件</span></>
                  )}
                </button>
                <input ref={zoneRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={e => { setZoneFile(e.target.files?.[0] || null); setResult(null); }} />
              </div>
              {/* 批量素材文件 */}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">We分析推广数据</span>
                <button
                  onClick={() => batchRef.current?.click()}
                  className={`flex items-center gap-2 px-3 py-2.5 border rounded-lg text-sm transition w-full text-left ${
                    batchFiles.length > 0 ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {batchFiles.length > 0 ? (
                    <><CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" /><span className="truncate flex-1">已选择 {batchFiles.length} 个文件</span></>
                  ) : (
                    <><Upload className="w-4 h-4 text-slate-400 flex-shrink-0" /><span>选择 Excel 文件（可多选）</span></>
                  )}
                </button>
                <input ref={batchRef} type="file" accept=".xls,.xlsx" multiple className="hidden" onChange={e => { setBatchFiles(Array.from(e.target.files || [])); setResult(null); }} />
                {batchFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {batchFiles.map((f, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded">{f.name}</span>
                    ))}
                  </div>
                )}
              </div>
              {result && (
                <div className={`flex items-center gap-2 p-3 rounded text-sm ${
                  result.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                }`}>
                  {result.success ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
                  <span>{result.message}</span>
                </div>
              )}
            </div>
            {/* 弹窗底部 */}
            <div className="flex items-center justify-end px-6 py-4 border-t border-slate-200">
              <button
                onClick={handleUpload}
                disabled={uploading || !summaryFile || !adFile || !zoneFile || batchFiles.length === 0}
                className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded transition"
              >
                {uploading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />上传中...</>
                ) : (
                  <><Upload className="w-4 h-4" />确认上传</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
