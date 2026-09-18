import React, { useState, useCallback, useRef } from 'react';
import { Search, RotateCcw, ChevronLeft, ChevronRight, Package, Sparkles, Download, ExternalLink } from 'lucide-react';
import { fetchWithAuth } from '../utils/authFetch';
import { PRODUCT_LIBRARY_API } from '../config';
import * as ExcelJS from 'exceljs';

interface ProductItem {
  sku_name?: string | null;
  product_sn?: string | null;
  sku_code?: string | null;
  brand_name?: string | null;
  supply_mode?: string | null;
  cat_l1?: string | null;
  cat_l2?: string | null;
  cat_l3?: string | null;
  category_path?: string | null;
  ean?: string | null;
  unit?: string | null;
  spec_name?: string | null;
  spec_value?: string | null;
  price?: number | string | null;
  bottom_price?: number | string | null;
  profit?: number | string | null;
  score?: number | null;
  platform_name?: string | null;
  platform_price?: number | string | null;
  product_link?: string | null;
  weight?: number | string | null;
  pic?: string | null;
}

interface FilterState {
  category: string;
  brand: string;
  price_min: string;
  price_max: string;
  supply_mode: string;
  gross_margin_min: string;
  gross_margin_max: string;
  similarity: string;
}

const initialFilter: FilterState = {
  category: '',
  brand: '',
  price_min: '',
  price_max: '',
  supply_mode: '',
  gross_margin_min: '',
  gross_margin_max: '',
  similarity: 'low',
};


export const ProductLibraryModule: React.FC = () => {
  const [filter, setFilter] = useState<FilterState>(initialFilter);
  const [naturalQuery, setNaturalQuery] = useState('');
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [optimizedQuery, setOptimizedQuery] = useState<string | null>(null);
  const [queryDuration, setQueryDuration] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [queried, setQueried] = useState(false);
  const [filterCollapsed, setFilterCollapsed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const taskIdRef = useRef<string | null>(null);
  const [previewImg, setPreviewImg] = useState<{ url: string; x: number; y: number } | null>(null);
  const [selectionGrossMargin, setSelectionGrossMargin] = useState('');

  const handleQuery = useCallback(async () => {
    // 中断上一次未完成的请求
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setQueried(true);
    setOptimizedQuery(null);
    setQueryDuration(null);
    const startTime = Date.now();
    try {
      const body: Record<string, unknown> = {};
      if (naturalQuery.trim()) body.query = naturalQuery.trim();
      if (filter.category.trim()) body.category = filter.category.trim();
      if (filter.brand.trim()) body.brand = filter.brand.trim();
      if (filter.price_min.trim() !== '') body.price_min = parseFloat(filter.price_min);
      if (filter.price_max.trim() !== '') body.price_max = parseFloat(filter.price_max);
      if (filter.supply_mode.trim()) body.supply_mode = filter.supply_mode.trim();
      if (filter.gross_margin_min.trim() !== '') body.gross_margin_min = parseFloat(filter.gross_margin_min);
      if (filter.gross_margin_max.trim() !== '') body.gross_margin_max = parseFloat(filter.gross_margin_max);
      body.similarity = filter.similarity;

      const res = await fetchWithAuth(`${PRODUCT_LIBRARY_API}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // 非 2xx 响应直接走错误分支，避免尝试读取非 SSE 的 JSON 错误体
      if (!res.ok) {
        let msg = `请求失败 (${res.status})`;
        try { const errJson = await res.json(); if (errJson?.message) msg = errJson.message; } catch { /* ignore */ }
        throw new Error(msg);
      }

      if (!res.body) throw new Error('响应体为空，无法读取');

      // 处理 SSE 流式响应
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      let finalData: ProductItem[] | null = null;
      let sseError: string | null = null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
          const sseLines = sseBuffer.split('\n');
          sseBuffer = sseLines.pop() || '';
          for (const sseLine of sseLines) {
            if (!sseLine.startsWith('data: ')) continue;
            const jsonStr = sseLine.slice(6).trim();
            if (!jsonStr) continue;
            try {
              const evt = JSON.parse(jsonStr);
              // 捕获 task_id 用于中断
              if (evt.type === 'started' && evt.task_id) {
                taskIdRef.current = evt.task_id;
              }
              // 接收最终数据
              if (evt.type === 'finished') {
                if (evt.success && Array.isArray(evt.data)) {
                  finalData = evt.data;
                  if (evt.optimized_query) {
                    setOptimizedQuery(evt.optimized_query);
                  }
                }
              }
              if (evt.type === 'error') {
                sseError = evt.message || '工作流执行失败';
              }
            } catch {
              // 忽略非 JSON 行
            }
          }
        }
      } catch (readErr) {
        // 流读取中断（可能是请求被 abort）
        if (controller.signal.aborted) return;
        throw readErr;
      }

      if (sseError) throw new Error(sseError);

      if (finalData) {
        setProducts(Array.isArray(finalData) ? finalData : []);
      } else {
        setProducts([]);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setProducts([]);
    } finally {
      setLoading(false);
      setQueryDuration(Math.round((Date.now() - startTime) / 1000 * 10) / 10);
      taskIdRef.current = null;
    }
  }, [filter, naturalQuery]);

  const handleReset = async () => {
    // 中断正在进行的 Dify 工作流请求
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    // 调用后端停止接口，传入 task_id 实现 Dify 侧中断
    const currentTaskId = taskIdRef.current;
    taskIdRef.current = null;
    try {
      await fetchWithAuth(`${PRODUCT_LIBRARY_API}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: currentTaskId }),
      });
    } catch {
      // 停止接口调用失败不影响重置操作
    }
    setFilter(initialFilter);
    setNaturalQuery('');
    setProducts([]);
    setOptimizedQuery(null);
    setQueried(false);
  };

  const formatPrice = (val: number | string | null | undefined) => {
    if (val === undefined || val === null || val === '') return '-';
    const num = typeof val === 'string' ? parseFloat(val) : val;
    if (isNaN(num)) return '-';
    return `¥${num.toFixed(2)}`;
  };

  const handleDownload = async () => {
    /*
    const textFilterFields: { key: keyof FilterState; label: string; placeholder: string }[] = [
      { key: 'business_code', label: 'SPU编号', placeholder: '输入SPU编号' },
      { key: 'product_code', label: 'SKU编号', placeholder: '输入SKU编号' },
      { key: 'brand', label: '品牌', placeholder: '输入品牌搜索' },
      { key: 'supplier', label: '供应商', placeholder: '输入供应商搜索' },
      { key: 'category', label: '分类', placeholder: '输入分类搜索' },
      { key: 'barcode', label: '条码', placeholder: '输入条码精确匹配' },
    ];
  
    const priceRangeFields: { prefix: string; label: string; minKey: keyof FilterState; maxKey: keyof FilterState }[] = [
      { prefix: 'price_retail', label: '建议零售价', minKey: 'price_retail_min', maxKey: 'price_retail_max' },
      { prefix: 'price_agency', label: '代发供货价', minKey: 'price_agency_min', maxKey: 'price_agency_max' },
      { prefix: 'price_collect', label: '集采供货价', minKey: 'price_collect_min', maxKey: 'price_collect_max' },
      { prefix: 'price_min', label: '最低售价', minKey: 'price_min_min', maxKey: 'price_min_max' },
    ];
    */

    if (products.length === 0) return;

    // 选品毛利率（输入值转小数，未填为 0）
    const marginRate = selectionGrossMargin ? parseFloat(selectionGrossMargin) / 100 : 0;

    // 创建 workbook 和 worksheet
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('提报产品信息');

    // 定义列
    ws.columns = [
      { width: 6 },   // A - 序号
      { width: 14 },  // B - 一级类目
      { width: 14 },  // C - 二级类目
      { width: 14 },  // D - 三级类目
      { width: 14 },  // E - 品牌名称
      { width: 35 },  // F - 商品名称
      { width: 25 },  // G - 商品型号或规格
      { width: 16 },  // H - 内部编码
      { width: 18 },  // I - 69码
      { width: 12 },  // J - 图片
      { width: 14 },  // K - 市场指导价
      { width: 20 },  // L - 优识代发成本价格
      { width: 22 },  // M - 建议渠道代发单价（含税运）
      { width: 22 },  // N - 不含税金额
      { width: 14 },  // O - 税额
      { width: 14 },  // P - 税率
      { width: 22 },  // Q - 京猫最低折扣率
      { width: 18 },  // R - 市场指导价折扣率
      { width: 12 },  // S - 京东
      { width: 12 },  // T - 天猫
      { width: 12 },  // U - 苏宁
      { width: 40 },  // V - 链接1
      { width: 12 },  // W - 截图1
      { width: 12 },  // X - 京东(比价)
      { width: 40 },  // Y - 链接2
      { width: 12 },  // Z - 截图2
      { width: 12 },  // AA - 天猫(比价)
      { width: 40 },  // AB - 链接3
      { width: 12 },  // AC - 截图3
      { width: 12 },  // AD - 苏宁(比价)
      { width: 20 },  // AE - 线上平台比价最低毛利率
      { width: 18 },  // AF - 优识达标毛利率
      { width: 18 },  // AG - 发货时效
      { width: 18 },  // AH - 全国配送范围
      { width: 18 },  // AI - 全国配送成本
      { width: 16 },  // AJ - 供应商编码
    ];

    // ===== 表头第1行 =====
    const headerRow1 = ws.getRow(1);
    const headers1 = [
      '序号', '一级类目', '二级类目', '三级类目', '品牌名称', '商品名称（品牌+产品名称）',
      '商品型号或规格', 'SKU编号', '69码', '图片', '市场指导价',
      '优识代发成本价格（含税运）', '建议渠道代发单价（含税运）',
      '建议渠道代发单价不含税金额', '建议渠道代发单价税额', '建议渠道代发单价税率',
      '建议渠道代发单价京猫最低折扣率', '市场指导价折扣率',
    ];
    headers1.forEach((h, i) => {
      const cell = headerRow1.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, size: 11 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });
    // 19-21列合并: 电商平台询比价
    ws.mergeCells('S1:U1');
    const mergeCell1 = ws.getCell('S1');
    mergeCell1.value = '电商平台询比价';
    mergeCell1.font = { bold: true, size: 11 };
    mergeCell1.alignment = { horizontal: 'center', vertical: 'middle' };
    mergeCell1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    mergeCell1.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    // 22-30列合并: 长文本
    ws.mergeCells('V1:AD1');
    const mergeCell2 = ws.getCell('V1');
    mergeCell2.value = '*首选：京东、天猫、苏宁等主流电商平台品牌自营旗舰店、官方店铺产品链接；\n*次选：如三大主流电商平台找不到比价信息，则可填其他网站或渠道价格信息；\n*务必体现"货比三家"原则，同一款产品务必在以上三个平台搜索比价；找不到价格链接，也须截图未能找到比价链接的截图留痕。';
    mergeCell2.font = { bold: true, size: 10 };
    mergeCell2.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    mergeCell2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    mergeCell2.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    // 31-36列
    const headers3 = ['线上平台比价最低毛利率', '优识达标毛利率', '发货时效（文字）', '全国配送范围（文字）', '全国配送成本（文字）', '供应商编码'];
    headers3.forEach((h, i) => {
      const cell = headerRow1.getCell(31 + i);
      cell.value = h;
      cell.font = { bold: true, size: 11 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });
    headerRow1.height = 60;

    // ===== 表头第2行 =====
    const headerRow2 = ws.getRow(2);
    // 1-18列: 与第1行合并（已自动继承）
    for (let i = 1; i <= 18; i++) {
      ws.mergeCells(1, i, 2, i);
    }
    // 19-21: 京东、天猫、苏宁
    const platforms = ['京东', '天猫', '苏宁'];
    platforms.forEach((p, i) => {
      const cell = headerRow2.getCell(19 + i);
      cell.value = p;
      cell.font = { bold: true, size: 11 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });
    // 22-30: 链接1 京东 截图1 链接2 天猫 截图2 链接3 苏宁 截图3
    const linkHeaders = ['链接1', '京东', '截图1', '链接2', '天猫', '截图2', '链接3', '苏宁', '截图3'];
    linkHeaders.forEach((h, i) => {
      const cell = headerRow2.getCell(22 + i);
      cell.value = h;
      cell.font = { bold: true, size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });
    // 31-36列与第1行合并
    for (let i = 31; i <= 36; i++) {
      ws.mergeCells(1, i, 2, i);
    }
    headerRow2.height = 28;

    // ===== 数据行 =====
    for (let idx = 0; idx < products.length; idx++) {
      const p = products[idx];
      const rowNum = idx + 3;
      const row = ws.getRow(rowNum);

      // 计算建议渠道代发单价（含税运）
      const channelPrice = (p.bottom_price != null && p.bottom_price !== '')
        ? Math.round(parseFloat(String(p.bottom_price)) / (1 - marginRate) * 100) / 100
        : null;

      // 计算京猫最低折扣率 = 建议渠道代发单价 / MIN(京东, 天猫, 苏宁)（展示为百分比）
      const platformPrices = [p.platform_price].filter(v => v != null && v !== '').map(v => parseFloat(String(v)));
      const minPlatformPrice = platformPrices.length > 0 ? Math.min(...platformPrices) : null;
      const jdTmallDiscountRate = (channelPrice && minPlatformPrice)
        ? `${Math.round(channelPrice / minPlatformPrice * 10000) / 100}%`
        : null;

      // 计算市场指导价折扣率 = 建议渠道代发单价 / 市场指导价（展示为百分比）
      const marketGuidePrice = p.price != null && p.price !== '' ? parseFloat(String(p.price)) : null;
      const marketGuideDiscountRate = (channelPrice && marketGuidePrice)
        ? `${Math.round(channelPrice / marketGuidePrice * 10000) / 100}%`
        : null;

      // 计算线上平台比价最低毛利率 = (platform_price - 建议渠道代发单价) / platform_price
      const platformPrice = p.platform_price != null && p.platform_price !== '' ? parseFloat(String(p.platform_price)) : null;
      const minGrossMargin = (platformPrice && channelPrice)
        ? `${Math.round((platformPrice - channelPrice) / platformPrice * 10000) / 100}%`
        : null;

      // 计算优识达标毛利率 = 1 - 建议渠道代发单价 / 优识代发成本价格
      const bottomPrice = p.bottom_price != null && p.bottom_price !== '' ? parseFloat(String(p.bottom_price)) : null;
      const standardGrossMargin = (channelPrice && bottomPrice)
        ? `${Math.round((1 - channelPrice / bottomPrice) * 10000) / 100}%`
        : null;

      const values = [
        idx + 1,
        p.cat_l1 || '',
        p.cat_l2 || '',
        p.cat_l3 || '', // 三级类目
        p.brand_name || '',
        p.sku_name || '',
        p.spec_value || '',
        p.product_sn || '',
        p.ean || '',
        '', // 图片（后续嵌入）
        p.price ?? '',
        p.bottom_price ?? '',
        channelPrice ?? '', // 建议渠道代发单价（含税运）
        '', '', '', // 不含税金额、税额、税率（3个空值）
        jdTmallDiscountRate ?? '', // 京猫最低折扣率
        marketGuideDiscountRate ?? '', // 市场指导价折扣率
        p.platform_price ?? '', '', '', // 19-21列：平台价格（京东/天猫/苏宁）
        p.product_link || '', '', '', // 22-24列：链接1 + 京东 + 截图1
        '', '', '', // 25-27列：链接2 + 天猫 + 截图2
        '', '', '', // 28-30列：链接3 + 苏宁 + 截图3
        minGrossMargin ?? '', // 线上平台比价最低毛利率
        standardGrossMargin ?? '', // 优识达标毛利率
        '', '', '', '', // 发货时效、配送、供应商
      ];
      values.forEach((v, i) => {
        const cell = row.getCell(i + 1);
        cell.value = v;
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      });

      // 图片列：超链接
      if (p.pic) {
        const picCell = row.getCell(10);
        picCell.value = { text: '查看图片', hyperlink: p.pic };
        picCell.font = { color: { argb: 'FF0563C1' }, underline: true };
      }

      // 链接1/2/3列：直接展示完整链接
      if (p.product_link) {
        row.getCell(22).value = p.product_link; // 链接1
      }

      row.height = 20;
    }

    // 导出文件
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `选品报价单_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* 左侧筛选面板 */}
      <div
        className={`flex-shrink-0 transition-all duration-300 ${filterCollapsed ? 'w-0 overflow-hidden opacity-0' : 'w-[280px] opacity-100'}`}
        style={{ background: 'linear-gradient(180deg, rgba(241,245,249,0.97) 0%, rgba(226,232,240,0.95) 100%)', borderRight: '1px solid rgba(148,163,184,0.3)' }}
      >
        <div className="flex flex-col h-full w-[280px] p-4">
          {/* 智能选品助手卡片 */}
          <div
            className="mb-4 rounded-xl p-[1px]"
            style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.4), rgba(59,130,246,0.25), rgba(14,165,233,0.2))' }}
          >
            <div className="rounded-[11px] bg-gradient-to-b from-white to-slate-50/80 px-3.5 pt-3 pb-3.5">
              {/* 标题行 */}
              <div className="flex items-center gap-2 mb-2.5">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center shadow-sm">
                  <Sparkles size={13} className="text-white" />
                </div>
                <span className="text-sm font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">智能选品助手</span>
              </div>
              {/* 输入框 */}
              <textarea
                value={naturalQuery}
                onChange={e => setNaturalQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleQuery();
                  }
                }}
                rows={5}
                disabled={loading}
                placeholder="描述你的选品需求...&#10;如：适合送礼的高端护肤品"
                className="w-full px-3 py-2.5 text-sm rounded-lg bg-white border border-slate-200/80 text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100/60 transition-all resize-none leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04)' }}
              />
              {/* 相似度切换 */}
              <div className="mt-2.5 flex items-center gap-2">
                <span className="text-[11px] text-slate-400 flex-shrink-0">相似度</span>
                <div className="flex-1 flex bg-slate-100/80 rounded-lg p-0.5">
                  {[
                    { value: 'high', label: '高', icon: '🎯' },
                    { value: 'low', label: '低', icon: '🔍' },
                  ].map(opt => (
                    <label
                      key={opt.value}
                      className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                        } ${filter.similarity === opt.value
                          ? 'bg-white text-blue-600 shadow-sm'
                          : 'text-slate-400 hover:text-slate-600'
                        }`}
                    >
                      <input
                        type="radio"
                        name="similarity"
                        value={opt.value}
                        checked={filter.similarity === opt.value}
                        onChange={() => setFilter(prev => ({ ...prev, similarity: opt.value }))}
                        className="sr-only"
                      />
                      <span className="text-[11px]">{opt.icon}</span>
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 精确筛选 */}
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-300/60 to-transparent" />
            <span className="text-[10px] text-slate-400 whitespace-nowrap tracking-wide">精确筛选</span>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-300/60 to-transparent" />
          </div>

          <div className="flex flex-col gap-3.5 flex-1 overflow-y-auto">
            {/* 分类 */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1.5 tracking-wide">分类</label>
              <input
                type="text"
                value={filter.category}
                onChange={e => setFilter(prev => ({ ...prev, category: e.target.value }))}
                placeholder="如：美妆、鞋类"
                disabled={loading}
                className="w-full px-3 py-2 text-sm rounded-lg bg-white border border-slate-200/80 text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04)' }}
              />
            </div>

            {/* 品牌 */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1.5 tracking-wide">品牌</label>
              <input
                type="text"
                value={filter.brand}
                onChange={e => setFilter(prev => ({ ...prev, brand: e.target.value }))}
                placeholder="如：珀莱雅、Nike"
                disabled={loading}
                className="w-full px-3 py-2 text-sm rounded-lg bg-white border border-slate-200/80 text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04)' }}
              />
            </div>

            {/* 价格区间（建议零售价） */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1.5 tracking-wide">价格区间（建议零售价）</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={filter.price_min}
                  onChange={e => setFilter(prev => ({ ...prev, price_min: e.target.value }))}
                  placeholder="最低"
                  disabled={loading}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-white border border-slate-200/80 text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04)' }}
                />
                <span className="text-slate-300 text-sm flex-shrink-0">~</span>
                <input
                  type="number"
                  value={filter.price_max}
                  onChange={e => setFilter(prev => ({ ...prev, price_max: e.target.value }))}
                  placeholder="最高"
                  disabled={loading}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-white border border-slate-200/80 text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04)' }}
                />
              </div>
            </div>

            {/* 供货方式 */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1.5 tracking-wide">供货方式</label>
              <div className="flex bg-slate-100/80 rounded-lg p-0.5">
                {[
                  { value: '', label: '全部' },
                  { value: '代发', label: '代发' },
                  { value: '集采', label: '集采' },
                ].map(opt => (
                  <label
                    key={opt.value || 'all'}
                    className={`flex-1 flex items-center justify-center py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                      } ${filter.supply_mode === opt.value
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-slate-400 hover:text-slate-600'
                      }`}
                  >
                    <input
                      type="radio"
                      name="supply_mode"
                      value={opt.value}
                      checked={filter.supply_mode === opt.value}
                      onChange={() => setFilter(prev => ({ ...prev, supply_mode: opt.value }))}
                      className="sr-only"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>

            {/* 毛利区间 */}
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1.5 tracking-wide">毛利区间（范围 -15% ~ 50%）</label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="number"
                    min={-15}
                    max={50}
                    value={filter.gross_margin_min}
                    onChange={e => {
                      const v = e.target.value;
                      const num = v === '' ? '' : Math.max(-15, Math.min(50, parseFloat(v)));
                      setFilter(prev => {
                        const next = { ...prev, gross_margin_min: String(num) };
                        // 最低 > 最高时，清空最高
                        if (num !== '' && prev.gross_margin_max !== '' && Number(num) > parseFloat(prev.gross_margin_max)) {
                          next.gross_margin_max = '';
                        }
                        return next;
                      });
                    }}
                    placeholder="最低"
                    disabled={loading}
                    className="w-full px-3 py-2 pr-6 text-sm rounded-lg bg-white border border-slate-200/80 text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04)' }}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 pointer-events-none">%</span>
                </div>
                <span className="text-slate-300 text-sm flex-shrink-0">~</span>
                <div className="relative flex-1">
                  <input
                    type="number"
                    min={-15}
                    max={50}
                    value={filter.gross_margin_max}
                    onChange={e => {
                      const v = e.target.value;
                      const num = v === '' ? '' : Math.max(-15, Math.min(50, parseFloat(v)));
                      setFilter(prev => {
                        const next = { ...prev, gross_margin_max: String(num) };
                        // 最高 < 最低时，清空最低
                        if (num !== '' && prev.gross_margin_min !== '' && Number(num) < parseFloat(prev.gross_margin_min)) {
                          next.gross_margin_min = '';
                        }
                        return next;
                      });
                    }}
                    placeholder="最高"
                    disabled={loading}
                    className="w-full px-3 py-2 pr-6 text-sm rounded-lg bg-white border border-slate-200/80 text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04)' }}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 pointer-events-none">%</span>
                </div>
              </div>
            </div>
          </div>

          {/* 查询按钮 */}
          <div className="mt-4 flex flex-col gap-2">
            <button
              onClick={handleQuery}
              disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Search size={15} />
              {loading ? '选品中...' : '开始选品'}
            </button>
            <button
              onClick={handleReset}
              className="w-full py-2.5 rounded-lg text-sm font-medium text-slate-500 bg-white/60 border border-slate-200 hover:bg-white hover:text-slate-700 transition-all flex items-center justify-center gap-2"
            >
              <RotateCcw size={14} />
              重置筛选
            </button>
          </div>
        </div>
      </div>

      {/* 折叠切换按钮 */}
      <button
        onClick={() => setFilterCollapsed(!filterCollapsed)}
        className="flex-shrink-0 w-5 flex items-center justify-center text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition-colors self-stretch"
        style={{ borderRight: '1px solid rgba(148,163,184,0.2)' }}
      >
        {filterCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      {/* 右侧商品列表 */}
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/80">
        {/* 表格头部 */}
        <div className="px-5 py-3 border-b border-slate-200/80 bg-white/60 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">
            商品列表
            {queried && !loading && (
              <span className="ml-2 text-xs font-normal text-slate-400">共 {products.length} 条结果</span>
            )}
          </h3>
          {products.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-500 whitespace-nowrap">输入毛利率</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={selectionGrossMargin}
                  onChange={e => {
                    let val = e.target.value;
                    if (val !== '') {
                      const num = parseFloat(val);
                      if (num > 99) val = '99';
                      else if (num < 1) val = '1';
                    }
                    setSelectionGrossMargin(val);
                  }}
                  placeholder="%"
                  className="w-16 px-2 py-1 text-xs rounded-md bg-white border border-slate-200 text-slate-700 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                />
              </div>
              <button
                onClick={handleDownload}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-blue-600 hover:border-blue-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download size={13} />
                下载报价单
              </button>
            </div>
          )}
        </div>
        {/* AI 优化查询提示 */}
        {optimizedQuery && (
          <div className="px-5 py-2 bg-blue-50/60 border-b border-blue-100/60 flex items-start gap-2">
            <Sparkles size={13} className="text-blue-400 mt-0.5 flex-shrink-0" />
            <span className="text-xs text-blue-600/80 leading-relaxed">
              {optimizedQuery}
              {queryDuration !== null && (
                <span className="ml-2 text-blue-400">耗时 {queryDuration}s</span>
              )}
            </span>
          </div>
        )}

        {/* 表格内容 */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-slate-400">正在加载商品数据...</span>
            </div>
          ) : !queried ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
              <Package size={48} strokeWidth={1} />
              <span className="text-sm">请在左侧设置筛选条件后点击开始选品</span>
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
              <Package size={48} strokeWidth={1} />
              <span className="text-sm">暂无符合条件的商品数据</span>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-100/90">
                  <th className="px-3 py-3 text-center text-xs font-semibold text-slate-600 whitespace-nowrap w-[52px]">图片</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 min-w-[200px] max-w-[200px]">商品名称</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 whitespace-nowrap">SPU/SKU编号</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 whitespace-nowrap">品牌</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 min-w-[100px] max-w-[120px]">分类</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 min-w-[80px] max-w-[120px]">规格</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-slate-600 whitespace-nowrap">单位</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-slate-600 whitespace-nowrap max-w-[120px]">条码</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-slate-600 whitespace-nowrap">建议零售价</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-slate-600 whitespace-nowrap">最低售价</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold text-slate-600 whitespace-nowrap">建议渠道售价</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-slate-600 whitespace-nowrap">供货方式</th>
                  <th className="px-3 py-3 text-center text-xs font-semibold text-slate-600 whitespace-nowrap">匹配度</th>
                  <th className="px-3 py-3 text-left text-xs font-semibold text-slate-600 min-w-[120px]">平台信息</th>
                </tr>
              </thead>
              <tbody>
                {products.map((item, idx) => (
                  <tr
                    key={idx}
                    className={`border-b border-slate-100 hover:bg-blue-50/70 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}
                  >
                    <td className="px-3 py-2.5 text-center">
                      {item.pic ? (
                        <img
                          src={item.pic}
                          alt=""
                          className="w-9 h-9 rounded-md object-cover border border-slate-200/60 cursor-pointer"
                          onMouseEnter={e => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setPreviewImg({ url: item.pic!, x: rect.right + 8, y: rect.top + rect.height / 2 - 162 });
                          }}
                          onMouseLeave={() => setPreviewImg(null)}
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-md bg-slate-100 flex items-center justify-center">
                          <Package size={14} className="text-slate-300" />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-left text-slate-700 font-medium leading-relaxed whitespace-normal break-words max-w-[200px]">{item.sku_name || '-'}</td>
                    <td className="px-3 py-2.5 text-left text-slate-600 font-mono text-xs">
                      <div>{item.product_sn || '-'}</div>
                      <div className="text-slate-400">{item.sku_code || '-'}</div>
                    </td>
                    <td className="px-3 py-2.5 text-left text-slate-600 break-words leading-relaxed">{item.brand_name || '-'}</td>
                    <td className="px-3 py-2.5 text-left text-slate-600 leading-relaxed max-w-[120px] whitespace-normal break-words">
                      <div className="text-xs text-slate-500">{item.cat_l1 || '-'}</div>
                      {item.cat_l2 && <div className="text-xs text-slate-500">{item.cat_l2}</div>}
                      {item.cat_l3 && <div className="text-xs text-slate-500">{item.cat_l3}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-left text-slate-600 break-words leading-relaxed max-w-[120px] whitespace-normal">{item.spec_value || '-'}</td>
                    <td className="px-3 py-2.5 text-center text-slate-600">{item.unit || '-'}</td>
                    <td className="px-3 py-2.5 text-center text-slate-600 font-mono text-xs whitespace-normal break-all max-w-[120px]">{item.ean || '-'}</td>
                    <td className="px-3 py-2.5 text-right text-slate-700 font-medium">{formatPrice(item.price)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{formatPrice(item.bottom_price)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">
                      {(() => {
                        const marginRate = selectionGrossMargin ? parseFloat(selectionGrossMargin) / 100 : 0;
                        const minPrice = item.bottom_price != null && item.bottom_price !== '' ? parseFloat(String(item.bottom_price)) : null;
                        if (minPrice && minPrice > 0) {
                          const channelPrice = Math.round(minPrice / (1 - marginRate) * 100) / 100;
                          return `¥${channelPrice}`;
                        }
                        return '-';
                      })()}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {item.supply_mode ? (
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${item.supply_mode === '集采' ? 'bg-purple-50 text-purple-600' :
                            'bg-amber-50 text-amber-600'
                          }`}>{item.supply_mode}</span>
                      ) : '-'}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {item.score !== undefined && item.score !== null ? (
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${item.score >= 0.95 ? 'bg-emerald-50 text-emerald-600' :
                            item.score >= 0.9 ? 'bg-blue-50 text-blue-600' :
                              'bg-slate-50 text-slate-500'
                          }`}>{(item.score * 100).toFixed(1)}%</span>
                      ) : '-'}
                    </td>
                    <td className="px-3 py-2.5 text-left text-slate-600 leading-relaxed">
                      {item.platform_name ? (
                        <>
                          <div className="text-xs text-slate-700 font-medium">{item.platform_name}</div>
                          <div className="text-xs text-slate-500">{formatPrice(item.platform_price)}</div>
                          {item.product_link && (
                            <a href={item.product_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-xs text-blue-500 hover:text-blue-700 hover:underline mt-0.5" title={item.product_link}>
                              <ExternalLink size={11} /> 查看商品
                            </a>
                          )}
                        </>
                      ) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {/* 图片悬浮放大预览 */}
      {previewImg && (
        <img
          src={previewImg.url}
          alt=""
          className="fixed z-[9999] w-[324px] h-[324px] rounded-lg object-cover shadow-2xl border border-slate-200 pointer-events-none"
          style={{ left: previewImg.x, top: previewImg.y }}
        />
      )}
    </div>
  );
};

export default ProductLibraryModule;
