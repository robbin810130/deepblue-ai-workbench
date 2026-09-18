import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Trash2, Package, Truck, FlaskConical, ChevronDown, ChevronUp, Search, FileText, ChevronLeft, ChevronRight, Sparkles, X, ImagePlus, Loader2, Upload } from 'lucide-react';
import { LOGISTICS_CONFIG_API } from '../config';
import { fetchWithAuth } from '../utils/authFetch';

// ─── 打包方案查询类型 ─────────────────────────────────────────────────────
interface SinglePackagingPlan {
  id: number;
  seq: number;
  product_code: string;
  code_qty: string;
  product_name: string;
  weight: number;
  volume: number;
  packaging_plan: string;
  packaging_material: string;
  attribute: string;
  material_code: string;
  sleeve: string;
  wrap_film: string;
  express_cost: number;
  material_cost_box: number;
  material_cost_sleeve: number;
  material_cost_wrap: number;
  extra_packing_fee: number;
  loading_fee: number;
  total_cost: number;
}

interface MultiPackagingPlan {
  id: number;
  product_codes: string;
  product_name: string;
  weight: number;
  packaging_plan: string;
  packaging_material: string;
  material_code: string;
  sleeve: string;
  wrap_film: string;
  express_cost: number;
  material_cost_box: number;
  material_cost_sleeve: number;
  material_cost_wrap: number;
  total_cost: number;
}

type PlanTab = 'single' | 'multi';

// ─── 耗材类型定义 ─────────────────────────────────────────────────────
interface PackagingOption {
  name: string;
  attribute: string;
  category: 'carton_3' | 'carton_5' | 'express_bag' | 'sleeve';
  spec: string;
  l: number;
  w: number;
  h: number;
  volume: number;
  price: number;
  weight: number;
}

/**
 * 根据包装类型、商品体积和尺寸匹配最小可用耗材
 * 条件：① 容积率≤96% ② 耗材三边均≥商品三边（允许旋转，排序后逐一比较）
 */
function matchPackaging(
  list: PackagingOption[],
  type: 'carton_3' | 'carton_5' | 'express_bag',
  productVolCm3: number,
  dims: [number, number, number],
): { price: number; name: string; attribute: string; dimensions: string } | null {
  if (productVolCm3 <= 0) return null;
  const sorted = [...dims].sort((a, b) => a - b);
  const candidates = list
    .filter(p => p.category === type && p.volume > 0)
    .sort((a, b) => a.volume - b.volume);
  for (const pkg of candidates) {
    const ratio = productVolCm3 / pkg.volume;
    if (ratio > 0.96) continue;
    const pkgSorted = [pkg.l, pkg.w, pkg.h].sort((a, b) => a - b);
    if (pkgSorted[0] >= sorted[0] && pkgSorted[1] >= sorted[1] && pkgSorted[2] >= sorted[2]) {
      const dimensions = `${pkg.l}*${pkg.w}*${pkg.h}cm`;
      return { price: pkg.price, name: pkg.name, attribute: pkg.attribute, dimensions };
    }
  }
  return null;
}

// ─── 类型定义 ─────────────────────────────────────────────────────
interface ItemRow {
  id: number;
  qty: number;
  length: number;
  width: number;
  height: number;
  weight: number;
}

/** 模型识别结果单项 */
interface RecognizedItem {
  name?: string;
  quantity?: number;
  length_cm?: number;
  width_cm?: number;
  height_cm?: number;
  weight_kg?: number;
}

/** 待识别文件（含缩略图预览地址） */
interface RecognizeFile {
  file: File;
  preview: string;
}

type SleeveType = 'none' | 'round' | 'square';
type PackagingType = 'carton' | 'express_bag';

/** 包装方案解析：根据用户选择和商品重量自动判定实际包装 */
interface ResolvedPkg { type: string; label: string; weight: number }
function resolvePackaging(selected: PackagingType, productWeight: number): ResolvedPkg {
  if (selected === 'carton') {
    return productWeight > 3
      ? { type: 'carton_5', label: '5层纸箱', weight: 0.15 }
      : { type: 'carton_3', label: '3层纸箱', weight: 0.15 };
  }
  // 快递袋
  if (productWeight <= 3) {
    return { type: 'express_bag', label: '快递袋', weight: 0.05 };
  }
  // 快递袋超重 → 自动升级纸箱
  return { type: 'carton_3', label: '纸箱(快递袋超重升级)', weight: 0.15 };
}

interface CalcResult {
  settlementWeight: number;
  totalFee: number;
  resolvedPkg: ResolvedPkg;
  packaging1Fee: number;
  packaging1Name: string;
  expressFee: number;
  warehouseFee: number;
  sortingFee: number;
  loadingFee: number;
  specialPkgFee: number;
  bubbleWrapFee: number;
  extraPackingFee: number;
}

// ─── 价格配置接口 ───────────────────────────────────────────────────
interface PriceConfig {
  express_fee_0_3: number;
  express_fee_0_5: number;
  express_fee_1: number;
  express_fee_1_5: number;
  express_fee_2: number;
  express_fee_3: number;
  express_fee_over3: number;
  warehouse_rent: number;
  sorting_1pc: number;
  sorting_2_3pc: number;
  sorting_over3_base: number;
  sorting_over3_step: number;
  sorting_max: number;
  loading_rate: number;
  special_pkg_round: number;
  special_pkg_square: number;
  bubble_wrap_0_5: number;
  bubble_wrap_2: number;
  bubble_wrap_over2: number;
  extra_packing_rate: number;
}

// 默认配置（全0，数据库无数据时费用为0）
const EMPTY_CONFIG: PriceConfig = {
  express_fee_0_3: 0, express_fee_0_5: 0, express_fee_1: 0,
  express_fee_1_5: 0, express_fee_2: 0, express_fee_3: 0,
  express_fee_over3: 0, warehouse_rent: 0,
  sorting_1pc: 0, sorting_2_3pc: 0, sorting_over3_base: 0,
  sorting_over3_step: 0, sorting_max: 0,
  loading_rate: 0, special_pkg_round: 0, special_pkg_square: 0,
  bubble_wrap_0_5: 0, bubble_wrap_2: 0, bubble_wrap_over2: 0,
  extra_packing_rate: 0,
};

// ─── 费用计算函数（纯前端，不展示子项） ─────────────────────────────

/** 纯快递费（含6%税）—— 阶梯查表 */
function calcExpressFee(w: number, c: PriceConfig): number {
  if (w <= 0) return 0;
  if (w <= 0.3) return c.express_fee_0_3;
  if (w <= 0.5) return c.express_fee_0_5;
  if (w <= 1) return c.express_fee_1;
  if (w <= 1.5) return c.express_fee_1_5;
  if (w <= 2) return c.express_fee_2;
  if (w <= 3) return c.express_fee_3;
  return +(c.express_fee_3 + Math.ceil(w - 3) * c.express_fee_over3).toFixed(2);
}

/** 仓租 */
function calcWarehouse(c: PriceConfig): number {
  return c.warehouse_rent;
}

/** 订单分拣费：按总件数分档 */
function calcSorting(totalPcs: number, c: PriceConfig): number {
  if (totalPcs <= 0) return 0;
  if (totalPcs === 1) return c.sorting_1pc;
  if (totalPcs <= 3) return c.sorting_2_3pc;
  return Math.min(c.sorting_over3_base + (totalPcs - 3) * c.sorting_over3_step, c.sorting_max);
}

/** 装卸费 */
function calcLoading(items: ItemRow[], c: PriceConfig): number {
  return items.reduce((sum, it) => {
    return sum + c.loading_rate * it.qty * it.length * it.width * it.height;
  }, 0);
}

/** 特殊包材 */
function calcSpecialPackaging(sleeve: SleeveType, sleeveQty: number, c: PriceConfig): number {
  if (sleeve === 'none' || sleeveQty <= 0) return 0;
  const price = sleeve === 'round' ? c.special_pkg_round : c.special_pkg_square;
  return price * sleeveQty;
}

/** 气泡膜：按结算重量分档，固定费用 */
function calcBubbleWrap(settlementWeight: number, c: PriceConfig): number {
  if (settlementWeight <= 0.5) return c.bubble_wrap_0_5;
  if (settlementWeight <= 2) return c.bubble_wrap_2;
  return c.bubble_wrap_over2;
}

/** 额外打包费用 */
function calcExtraPacking(sleeve: SleeveType, sleeveQty: number, c: PriceConfig): number {
  if (sleeve === 'none' || sleeveQty <= 0) return 0;
  return c.extra_packing_rate * sleeveQty;
}

/** 汇总计算：结算重量 + 整体物流费 */
function calculateAll(items: ItemRow[], sleeve: SleeveType, pkgType: PackagingType, useBubbleWrap: boolean, sleeveQty: number, c: PriceConfig, pkgList: PackagingOption[]): CalcResult {
  // 商品重量
  const totalPcs = items.reduce((s, it) => s + it.qty, 0);
  const productWeight = items.length === 1 && items[0].qty === 1
    ? items[0].weight
    : items.reduce((s, it) => s + it.weight * it.qty, 0);

  // 包装方案自动判定
  const resolved = resolvePackaging(pkgType, productWeight);
  const settlementWeight = +(productWeight + resolved.weight).toFixed(3);

  // 包材1：根据包装类型、商品体积和尺寸匹配最小耗材（输入单位 cm）
  const productVolCm3 = items.reduce((s, it) => {
    return s + (it.length * it.width * it.height) * it.qty;
  }, 0);
  // 商品尺寸：取所有明细中每维最大值
  const maxL = Math.max(...items.map(it => it.length));
  const maxW = Math.max(...items.map(it => it.width));
  const maxH = Math.max(...items.map(it => it.height));

  // 3KG以上优先选用5层纸箱，如果没有再选3层纸箱
  let pkgMatch = null;
  if (productWeight > 3 && resolved.type === 'carton_5') {
    pkgMatch = matchPackaging(pkgList, 'carton_5', productVolCm3, [maxL, maxW, maxH]);
    if (!pkgMatch) {
      // 5层纸箱没有匹配到，降级到3层纸箱
      pkgMatch = matchPackaging(pkgList, 'carton_3', productVolCm3, [maxL, maxW, maxH]);
    }
  } else {
    pkgMatch = matchPackaging(pkgList, resolved.type as any, productVolCm3, [maxL, maxW, maxH]);
  }

  const packaging1Fee = pkgMatch ? +pkgMatch.price.toFixed(2) : 0;
  const packaging1Name = pkgMatch ? `${pkgMatch.name}，${pkgMatch.attribute}，${pkgMatch.dimensions}` : '无匹配耗材';

  // 整体物流费 = 所有子项之和
  const expressFee = +calcExpressFee(settlementWeight, c).toFixed(2);
  const warehouseFee = +calcWarehouse(c).toFixed(2);
  const sortingFee = +calcSorting(totalPcs, c).toFixed(2);
  const loadingFee = +calcLoading(items, c).toFixed(2);
  const specialPkgFee = +calcSpecialPackaging(sleeve, sleeveQty, c).toFixed(2);
  const bubbleWrapFee = useBubbleWrap ? +calcBubbleWrap(settlementWeight, c).toFixed(2) : 0;
  const extraPackingFee = +calcExtraPacking(sleeve, sleeveQty, c).toFixed(2);

  const totalFee = expressFee + warehouseFee + sortingFee + loadingFee + packaging1Fee + specialPkgFee + bubbleWrapFee + extraPackingFee;

  return {
    settlementWeight,
    totalFee: +totalFee.toFixed(2),
    resolvedPkg: resolved,
    packaging1Fee, packaging1Name,
    expressFee, warehouseFee, sortingFee, loadingFee,
    specialPkgFee, bubbleWrapFee, extraPackingFee,
  };
}

// ─── 默认快递选项 ──────────────────────────────────────────────────
const EXPRESS_OPTIONS = ['邮政小包(包含偏远)'];

// ─── 测试数据 ──────────────────────────────────────────────────────
const TEST_CASES: { label: string; rows: Omit<ItemRow, 'id'>[] }[] = [
  {
    label: '案例单品',
    rows: [{ qty: 1, length: 25.5, width: 16.9, height: 6.5, weight: 1.23 }],
  },
  {
    label: '案例组合1',
    rows: [
      { qty: 2, length: 25.5, width: 16.9, height: 6.5, weight: 1.23 },
      { qty: 4, length: 23, width: 15.5, height: 6.3, weight: 0.51 },
    ],
  },
  {
    label: '案例组合2',
    rows: [
      { qty: 3, length: 20, width: 5.5, height: 3.7, weight: 0.127 },
      { qty: 1, length: 29.7, width: 15, height: 3, weight: 0.06 },
    ],
  },
  {
    label: '案例组合3',
    rows: [
      { qty: 1, length: 20, width: 5.5, height: 3.7, weight: 0.127 },
      { qty: 1, length: 23.3, width: 4.5, height: 2, weight: 0.021 },
    ],
  },
];

// ─── 组件 ──────────────────────────────────────────────────────────
export const LogisticsFeeModule: React.FC = () => {
  // 主Tab：手动计算 / 历史方案查询
  const [mainTab, setMainTab] = useState<'calc' | 'query'>('calc');
  // 历史方案子Tab：单SKU / 多品
  const [planTab, setPlanTab] = useState<PlanTab>('single');
  const [planKeyword, setPlanKeyword] = useState('');
  const [planSearchInput, setPlanSearchInput] = useState('');
  const [planPage, setPlanPage] = useState(1);
  const [planTotal, setPlanTotal] = useState(0);
  const [planTotalPages, setPlanTotalPages] = useState(0);
  const [singlePlans, setSinglePlans] = useState<SinglePackagingPlan[]>([]);
  const [multiPlans, setMultiPlans] = useState<MultiPackagingPlan[]>([]);
  const [planLoading, setPlanLoading] = useState(false);
  const [expandedPlanId, setExpandedPlanId] = useState<number | null>(null);

  const [expressType, setExpressType] = useState(EXPRESS_OPTIONS[0]);
  const [items, setItems] = useState<ItemRow[]>([
    { id: Date.now(), qty: 1, length: 0, width: 0, height: 0, weight: 0 },
  ]);
  const [sleeveType, setSleeveType] = useState<SleeveType>('none');
  const [sleeveQty, setSleeveQty] = useState(1);
  const [packagingType, setPackagingType] = useState<PackagingType>('carton');
  const [useBubbleWrap, setUseBubbleWrap] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [priceConfig, setPriceConfig] = useState<PriceConfig>(EMPTY_CONFIG);
  const [packagingList, setPackagingList] = useState<PackagingOption[]>([]);

  // 模型自动识别
  const [showRecognize, setShowRecognize] = useState(false);
  const [recognizeFiles, setRecognizeFiles] = useState<RecognizeFile[]>([]);
  const [recognizeText, setRecognizeText] = useState('');
  const [recognizing, setRecognizing] = useState(false);
  const [recognizeError, setRecognizeError] = useState('');

  // 耗材表格导入
  const [showPackagingImport, setShowPackagingImport] = useState(false);
  const [packagingFile, setPackagingFile] = useState<File | null>(null);
  const [importingPackaging, setImportingPackaging] = useState(false);
  const [packagingImportMsg, setPackagingImportMsg] = useState('');
  const [packagingImportError, setPackagingImportError] = useState('');

  let nextId = React.useRef(Date.now() + 1);

  // 从后端加载价格配置
  useEffect(() => {
    fetchWithAuth(LOGISTICS_CONFIG_API)
      .then(res => res.json())
      .then(json => {
        if (json.success && json.data) {
          setPriceConfig({ ...EMPTY_CONFIG, ...json.data });
        }
      })
      .catch(() => { /* 使用空配置 */ });
  }, []);

  // 从后端加载耗材数据
  const loadPackaging = useCallback(() => {
    return fetchWithAuth(LOGISTICS_CONFIG_API + '/packaging')
      .then(res => res.json())
      .then(json => {
        if (json.success && Array.isArray(json.data) && json.data.length > 0) {
          setPackagingList(json.data);
        }
      })
      .catch(() => { /* 使用空数组 */ });
  }, []);

  useEffect(() => {
    loadPackaging();
  }, [loadPackaging]);

  // 查询打包方案
  const fetchPackagingPlans = useCallback(async (tab: PlanTab, keyword: string, page: number) => {
    setPlanLoading(true);
    try {
      const params = new URLSearchParams({ type: tab, keyword, page: String(page), pageSize: '20' });
      const res = await fetchWithAuth(`${LOGISTICS_CONFIG_API}/packaging-plans?${params}`);
      const json = await res.json();
      if (json.success) {
        if (tab === 'single') {
          setSinglePlans(json.data);
        } else {
          setMultiPlans(json.data);
        }
        setPlanTotal(json.pagination.total);
        setPlanTotalPages(json.pagination.totalPages);
      }
    } catch {
      // 查询失败保持空数组
    } finally {
      setPlanLoading(false);
    }
  }, []);

  // 切换Tab或搜索时加载数据
  useEffect(() => {
    if (mainTab === 'query') {
      fetchPackagingPlans(planTab, planKeyword, planPage);
    }
  }, [mainTab, planTab, planKeyword, planPage, fetchPackagingPlans]);

  // 搜索处理
  const handlePlanSearch = () => {
    setPlanKeyword(planSearchInput);
    setPlanPage(1);
    setExpandedPlanId(null);
  };

  const handlePlanTabChange = (tab: PlanTab) => {
    setPlanTab(tab);
    setPlanPage(1);
    setPlanSearchInput('');
    setPlanKeyword('');
    setExpandedPlanId(null);
  };

  // 输入草稿：number 受控输入会吞掉 "0."、"0.0" 等中间态，导致无法输入 0.xx 小数
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});
  const draftKey = (id: number, field: string) => `${id}:${field}`;

  // 更新明细行
  const updateItem = (id: number, field: keyof Omit<ItemRow, 'id'>, value: string) => {
    setInputDrafts(prev => ({ ...prev, [draftKey(id, field)]: value }));
    const num = Math.max(0, parseFloat(value) || 0);
    setItems(prev => prev.map(it => (it.id === id ? { ...it, [field]: num } : it)));
  };

  // 失焦时清除草稿，显示规范化后的数值
  const commitDraft = (id: number, field: string) => {
    setInputDrafts(prev => {
      const next = { ...prev };
      delete next[draftKey(id, field)];
      return next;
    });
  };

  const addItem = () => {
    setItems(prev => [...prev, { id: nextId.current++, qty: 1, length: 0, width: 0, height: 0, weight: 0 }]);
  };

  const removeItem = (id: number) => {
    if (items.length <= 1) return;
    setItems(prev => prev.filter(it => it.id !== id));
  };

  // 一键填入测试数据
  const loadTestCase = (caseIdx: number) => {
    const tc = TEST_CASES[caseIdx];
    if (!tc) return;
    const base = Date.now();
    setItems(tc.rows.map((r, i) => ({ ...r, id: base + i })));
  };

  // ── 模型自动识别 ──────────────────────────────────────────────
  const RECOGNIZE_MAX_IMAGES = 5;

  const clearRecognizeFiles = (list: RecognizeFile[]) => {
    list.forEach(f => URL.revokeObjectURL(f.preview));
  };

  const closeRecognize = () => {
    clearRecognizeFiles(recognizeFiles);
    setRecognizeFiles([]);
    setRecognizeText('');
    setRecognizeError('');
    setShowRecognize(false);
  };

  // 组件卸载时释放预览地址
  const recognizeFilesRef = React.useRef<RecognizeFile[]>([]);
  useEffect(() => {
    recognizeFilesRef.current = recognizeFiles;
  }, [recognizeFiles]);
  useEffect(() => () => { clearRecognizeFiles(recognizeFilesRef.current); }, []);

  const handleRecognizeFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length === 0) return;
    const remain = RECOGNIZE_MAX_IMAGES - recognizeFiles.length;
    if (remain <= 0) {
      setRecognizeError(`最多上传 ${RECOGNIZE_MAX_IMAGES} 张图片`);
      return;
    }
    const accepted = picked.slice(0, remain);
    if (picked.length > remain) {
      setRecognizeError(`最多上传 ${RECOGNIZE_MAX_IMAGES} 张图片，已保留前 ${RECOGNIZE_MAX_IMAGES} 张`);
    } else {
      setRecognizeError('');
    }
    setRecognizeFiles(prev => [...prev, ...accepted.map(f => ({ file: f, preview: URL.createObjectURL(f) }))]);
  };

  const removeRecognizeFile = (idx: number) => {
    setRecognizeFiles(prev => {
      URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
    setRecognizeError('');
  };

  const submitRecognize = async () => {
    if (recognizeFiles.length === 0 && !recognizeText.trim()) {
      setRecognizeError('请至少上传1张图片或填写文字说明');
      return;
    }
    setRecognizing(true);
    setRecognizeError('');
    try {
      const fd = new FormData();
      recognizeFiles.forEach(f => fd.append('images', f.file));
      fd.append('text', recognizeText);
      const res = await fetchWithAuth(`${LOGISTICS_CONFIG_API}/recognize`, { method: 'POST', body: fd });
      const json = await res.json();
      if (!json.success || !json.data) {
        setRecognizeError(json.message || '识别失败，请重试');
        return;
      }
      const recognized: RecognizedItem[] = Array.isArray(json.data.items) ? json.data.items : [];
      if (recognized.length === 0) {
        setRecognizeError('未识别到商品信息，请调整图片后重试');
        return;
      }
      const base = Date.now();
      setItems(recognized.map((it, i) => ({
        id: base + i,
        qty: Math.max(1, Math.floor(Number(it.quantity) || 1)),
        length: Number(it.length_cm) || 0,
        width: Number(it.width_cm) || 0,
        height: Number(it.height_cm) || 0,
        weight: Number(it.weight_kg) || 0,
      })));
      closeRecognize();
    } catch {
      setRecognizeError('识别请求失败，请稍后重试');
    } finally {
      setRecognizing(false);
    }
  };

  // ── 耗材表格导入 ──────────────────────────────────────────────
  const openPackagingImport = () => {
    setPackagingFile(null);
    setPackagingImportMsg('');
    setPackagingImportError('');
    setShowPackagingImport(true);
  };

  const closePackagingImport = () => {
    setPackagingFile(null);
    setPackagingImportMsg('');
    setPackagingImportError('');
    setShowPackagingImport(false);
  };

  const handlePackagingFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    e.target.value = '';
    setPackagingFile(file);
    setPackagingImportError('');
    setPackagingImportMsg('');
  };

  const submitPackagingImport = async () => {
    if (!packagingFile) {
      setPackagingImportError('请选择要导入的表格文件');
      return;
    }
    setImportingPackaging(true);
    setPackagingImportError('');
    setPackagingImportMsg('');
    try {
      const fd = new FormData();
      fd.append('file', packagingFile);
      const res = await fetchWithAuth(`${LOGISTICS_CONFIG_API}/packaging/import`, { method: 'POST', body: fd });
      const json = await res.json();
      if (!json.success) {
        setPackagingImportError(json.message || '导入失败，请重试');
        return;
      }
      await loadPackaging();
      setPackagingImportMsg(`导入成功，共 ${json.count} 条耗材数据`);
      setPackagingFile(null);
    } catch {
      setPackagingImportError('导入请求失败，请稍后重试');
    } finally {
      setImportingPackaging(false);
    }
  };

  // 实时计算（子项费用不展示）
  const result = useMemo(() => calculateAll(items, sleeveType, packagingType, useBubbleWrap, sleeveQty, priceConfig, packagingList), [items, sleeveType, packagingType, useBubbleWrap, sleeveQty, priceConfig, packagingList]);

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-slate-50 to-blue-50/30">
      {/* ── 顶部标题栏 + Tab切换 ── */}
      <div className="px-6 py-4 bg-white/80 backdrop-blur border-b border-slate-200/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm">
              <Truck className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">物流费计算</h2>
              <p className="text-xs text-slate-500">录入商品明细，自动计算结算重量与整体物流费</p>
            </div>
          </div>
          {/* 主Tab切换 */}
          <div className="flex bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => setMainTab('calc')}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-md transition-all ${
                mainTab === 'calc'
                  ? 'bg-white text-blue-600 font-medium shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <FlaskConical className="w-4 h-4" />
              手动计算
            </button>
            <button
              onClick={() => setMainTab('query')}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-md transition-all ${
                mainTab === 'query'
                  ? 'bg-white text-blue-600 font-medium shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <FileText className="w-4 h-4" />
              历史方案查询
            </button>
          </div>
        </div>
      </div>

      {/* ── 内容区 ── */}
      <div className="flex-1 overflow-auto p-6 space-y-5">
        {mainTab === 'calc' && (
          <>
        {/* 计算结果 —— 置顶展示，只展示结算重量 + 整体物流费 */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl shadow-lg p-6 text-white">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-blue-200 text-xs mb-1">结算重量</div>
              <div className="text-2xl font-bold">
                {result.settlementWeight.toFixed(3)}
                <span className="text-sm font-normal text-blue-200 ml-1">kg</span>
              </div>
            </div>
            <div>
              <div className="text-blue-200 text-xs mb-1">预估整体物流费（含6%税）</div>
              <div className="text-2xl font-bold">
                ¥{result.totalFee.toFixed(2)}
              </div>
            </div>
          </div>
        </div>

        {/* 费用明细展开 */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200/60 overflow-hidden">
          <button
            onClick={() => setShowDetail(!showDetail)}
            className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <span>费用明细</span>
            {showDetail ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showDetail && (
            <div className="px-5 pb-4 border-t border-slate-100">
              <table className="w-full text-sm mt-2">
                <tbody>
                  {[
                    { label: '纯快递费', value: result.expressFee },
                    { label: '仓租', value: result.warehouseFee },
                    { label: '订单分拣费', value: result.sortingFee },
                    { label: '装卸费', value: result.loadingFee },
                    { label: `包材1 (${result.packaging1Name})`, value: result.packaging1Fee },
                    { label: '特殊包材', value: result.specialPkgFee },
                    { label: '气泡膜', value: result.bubbleWrapFee },
                    { label: '额外打包费', value: result.extraPackingFee },
                  ].map((row, i) => (
                    <tr key={i} className={`${i % 2 === 0 ? 'bg-slate-50/50' : ''}`}>
                      <td className="px-3 py-2 text-slate-600">{row.label}</td>
                      <td className="px-3 py-2 text-right font-medium text-slate-700">¥{row.value.toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-200">
                    <td className="px-3 py-2 font-semibold text-slate-700">合计</td>
                    <td className="px-3 py-2 text-right font-bold text-blue-600">¥{result.totalFee.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 商品明细表格 */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200/60 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-slate-700 flex items-center gap-2">
              <Package className="w-4 h-4" />
              商品明细
            </h3>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <FlaskConical className="w-3.5 h-3.5" />
                测试案例：
              </div>
              {TEST_CASES.map((tc, idx) => (
                <button
                  key={idx}
                  onClick={() => loadTestCase(idx)}
                  className="px-2 py-1 text-xs text-indigo-600 bg-indigo-50 rounded hover:bg-indigo-100 transition-colors"
                >
                  {tc.label}
                </button>
              ))}
              <button
                onClick={addItem}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors ml-2"
              >
                <Plus className="w-3.5 h-3.5" />
                添加明细
              </button>
              <button
                onClick={() => setShowRecognize(true)}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-violet-600 bg-violet-50 rounded-lg hover:bg-violet-100 transition-colors ml-2"
              >
                <Sparkles className="w-3.5 h-3.5" />
                模型自动识别
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gradient-to-r from-slate-50 to-slate-100/80">
                  <th className="px-4 py-3 text-center font-semibold text-slate-500 text-xs uppercase tracking-wider w-14">#</th>
                  <th className="px-3 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">数量</th>
                  <th className="px-3 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">长(cm)</th>
                  <th className="px-3 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">宽(cm)</th>
                  <th className="px-3 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">高(cm)</th>
                  <th className="px-3 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">单品重量(kg)</th>
                  <th className="px-3 py-3 text-center font-semibold text-slate-500 text-xs uppercase tracking-wider w-16"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'} group hover:bg-blue-50/50 transition-colors`}>
                    <td className="px-4 py-2.5 text-center">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-xs font-medium">{idx + 1}</span>
                    </td>
                    {(['qty', 'length', 'width', 'height', 'weight'] as const).map(field => {
                      const dk = draftKey(item.id, field);
                      return (
                        <td key={field} className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            step={field === 'weight' ? '0.01' : '1'}
                            value={inputDrafts[dk] ?? (item[field] || '')}
                            onChange={e => updateItem(item.id, field, e.target.value)}
                            onBlur={() => commitDraft(item.id, field)}
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 placeholder-slate-300 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 outline-none transition-all"
                            placeholder="0"
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => removeItem(item.id)}
                        disabled={items.length <= 1}
                        className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 包材选项 */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200/60 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-slate-700">包材选项</h3>
            <button
              onClick={openPackagingImport}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              导入耗材
            </button>
          </div>
          <div className="flex flex-wrap gap-6">
            {/* 包装物选择 */}
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">包装物（计入结算重量）</label>
              <div className="flex gap-2">
                {([
                  { value: 'carton', label: '纸箱 0.15kg' },
                  { value: 'express_bag', label: '快递袋 0.05kg' },
                ] as { value: PackagingType; label: string }[]).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setPackagingType(opt.value)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      packagingType === opt.value
                        ? 'bg-blue-50 border-blue-400 text-blue-700 font-medium'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 特殊包材 */}
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">特殊包材</label>
              <div className="flex items-center gap-2">
                <div className="flex gap-2">
                  {([
                    { value: 'none', label: '无' },
                    { value: 'round', label: '圆形套头' },
                    { value: 'square', label: '方形套头' },
                  ] as { value: SleeveType; label: string }[]).map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setSleeveType(opt.value)}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                        sleeveType === opt.value
                          ? 'bg-blue-50 border-blue-400 text-blue-700 font-medium'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {sleeveType !== 'none' && (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-slate-500">数量</span>
                    <input
                      type="number"
                      min="1"
                      value={sleeveQty || ''}
                      onChange={e => setSleeveQty(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-16 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                      placeholder="1"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* 气泡膜 */}
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">气泡膜</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setUseBubbleWrap(false)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    !useBubbleWrap
                      ? 'bg-blue-50 border-blue-400 text-blue-700 font-medium'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  无
                </button>
                <button
                  onClick={() => setUseBubbleWrap(true)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    useBubbleWrap
                      ? 'bg-blue-50 border-blue-400 text-blue-700 font-medium'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  需要
                </button>
              </div>
            </div>

            {/* 快递类型 */}
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">快递类型</label>
              <select
                value={expressType}
                onChange={e => setExpressType(e.target.value)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                {EXPRESS_OPTIONS.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
          </>
        )}

        {mainTab === 'query' && (
          <>
            {/* 搜索栏 */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200/60 p-4">
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={planSearchInput}
                    onChange={e => setPlanSearchInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handlePlanSearch()}
                    placeholder="搜索货号、商品名或包材..."
                    className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
                <button
                  onClick={handlePlanSearch}
                  className="px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-1.5"
                >
                  <Search className="w-4 h-4" />
                  搜索
                </button>
              </div>
            </div>

            {/* 子Tab切换 */}
            <div className="flex gap-2">
              <button
                onClick={() => handlePlanTabChange('single')}
                className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                  planTab === 'single'
                    ? 'bg-blue-600 text-white font-medium'
                    : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'
                }`}
              >
                单SKU打包方案
              </button>
              <button
                onClick={() => handlePlanTabChange('multi')}
                className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                  planTab === 'multi'
                    ? 'bg-blue-600 text-white font-medium'
                    : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'
                }`}
              >
                多品打包方案
              </button>
            </div>

            {/* 数据表格 */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200/60 overflow-hidden">
              {planLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="flex items-center gap-2 text-slate-500">
                    <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-sm">加载中...</span>
                  </div>
                </div>
              ) : planTab === 'single' ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-slate-600">货号</th>
                        <th className="px-4 py-3 text-left font-medium text-slate-600">商品名称</th>
                        <th className="px-4 py-3 text-left font-medium text-slate-600">重量(kg)</th>
                        <th className="px-4 py-3 text-left font-medium text-slate-600">包装方案</th>
                        <th className="px-4 py-3 text-left font-medium text-slate-600">包材</th>
                        <th className="px-4 py-3 text-left font-medium text-slate-600">总费用</th>
                      </tr>
                    </thead>
                    <tbody>
                      {singlePlans.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                            暂无数据
                          </td>
                        </tr>
                      ) : (
                        singlePlans.flatMap((plan) => {
                          const isExpanded = expandedPlanId === plan.id;
                          const costVal = Number(plan.total_cost);
                          const costDisplay = costVal === 0
                            ? <span className="text-slate-400">暂无报价</span>
                            : <span className="text-blue-600 font-medium">¥{costVal.toFixed(2)}</span>;
                          const rows = [
                            <tr
                              key={plan.id}
                              onClick={() => setExpandedPlanId(isExpanded ? null : plan.id)}
                              className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors cursor-pointer"
                            >
                              <td className="px-4 py-3 text-slate-700 font-mono text-xs">{plan.product_code}</td>
                              <td className="px-4 py-3 text-slate-700 max-w-xs truncate" title={plan.product_name}>
                                {plan.product_name}
                              </td>
                              <td className="px-4 py-3 text-slate-600">{Number(plan.weight).toFixed(3)}</td>
                              <td className="px-4 py-3 text-slate-600 max-w-xs whitespace-normal break-all">
                                {plan.packaging_plan}
                              </td>
                              <td className="px-4 py-3 text-slate-600">{plan.packaging_material}</td>
                              <td className="px-4 py-3">{costDisplay}</td>
                            </tr>,
                          ];
                          if (isExpanded) {
                            rows.push(
                              <tr key={`${plan.id}-detail`} className="bg-slate-50/80">
                                <td colSpan={6} className="px-4 py-3">
                                  <div className="grid grid-cols-4 gap-x-6 gap-y-2 text-xs">
                                    <div><span className="text-slate-400">货号数量：</span><span className="text-slate-700">{plan.code_qty || '-'}</span></div>
                                    <div><span className="text-slate-400">体积(m³)：</span><span className="text-slate-700">{Number(plan.volume).toFixed(6)}</span></div>
                                    <div><span className="text-slate-400">属性：</span><span className="text-slate-700">{plan.attribute || '-'}</span></div>
                                    <div><span className="text-slate-400">耗材编码：</span><span className="text-slate-700">{plan.material_code || '-'}</span></div>
                                    <div><span className="text-slate-400">套头：</span><span className="text-slate-700">{plan.sleeve || '-'}</span></div>
                                    <div><span className="text-slate-400">裹膜：</span><span className="text-slate-700">{plan.wrap_film || '-'}</span></div>
                                    <div><span className="text-slate-400">快递费：</span><span className="text-slate-700">¥{Number(plan.express_cost).toFixed(2)}</span></div>
                                    <div><span className="text-slate-400">包材费-箱/袋：</span><span className="text-slate-700">¥{Number(plan.material_cost_box).toFixed(4)}</span></div>
                                    <div><span className="text-slate-400">包材费-套头：</span><span className="text-slate-700">¥{Number(plan.material_cost_sleeve).toFixed(4)}</span></div>
                                    <div><span className="text-slate-400">包材费-裹膜：</span><span className="text-slate-700">¥{Number(plan.material_cost_wrap).toFixed(4)}</span></div>
                                    <div><span className="text-slate-400">额外打包费：</span><span className="text-slate-700">¥{Number(plan.extra_packing_fee).toFixed(4)}</span></div>
                                    <div><span className="text-slate-400">装卸费：</span><span className="text-slate-700">¥{Number(plan.loading_fee).toFixed(4)}</span></div>
                                  </div>
                                </td>
                              </tr>
                            );
                          }
                          return rows;
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-slate-600">货号组合</th>
                        <th className="px-4 py-3 text-left font-medium text-slate-600">商品名称</th>
                        <th className="px-4 py-3 text-left font-medium text-slate-600">重量(kg)</th>
                        <th className="px-4 py-3 text-left font-medium text-slate-600">包装方案</th>
                        <th className="px-4 py-3 text-left font-medium text-slate-600">包材</th>
                        <th className="px-4 py-3 text-left font-medium text-slate-600">总费用</th>
                      </tr>
                    </thead>
                    <tbody>
                      {multiPlans.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                            暂无数据
                          </td>
                        </tr>
                      ) : (
                        multiPlans.flatMap((plan) => {
                          const isExpanded = expandedPlanId === plan.id;
                          const costVal = Number(plan.total_cost);
                          const costDisplay = costVal === 0
                            ? <span className="text-slate-400">暂无报价</span>
                            : <span className="text-blue-600 font-medium">¥{costVal.toFixed(2)}</span>;
                          const rows = [
                            <tr
                              key={plan.id}
                              onClick={() => setExpandedPlanId(isExpanded ? null : plan.id)}
                              className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors cursor-pointer"
                            >
                              <td className="px-4 py-3 text-slate-700 font-mono text-xs">{plan.product_codes}</td>
                              <td className="px-4 py-3 text-slate-700 max-w-xs truncate" title={plan.product_name}>
                                {plan.product_name}
                              </td>
                              <td className="px-4 py-3 text-slate-600">{Number(plan.weight).toFixed(3)}</td>
                              <td className="px-4 py-3 text-slate-600 max-w-xs whitespace-normal break-all">
                                {plan.packaging_plan}
                              </td>
                              <td className="px-4 py-3 text-slate-600">{plan.packaging_material}</td>
                              <td className="px-4 py-3">{costDisplay}</td>
                            </tr>,
                          ];
                          if (isExpanded) {
                            rows.push(
                              <tr key={`${plan.id}-detail`} className="bg-slate-50/80">
                                <td colSpan={6} className="px-4 py-3">
                                  <div className="grid grid-cols-4 gap-x-6 gap-y-2 text-xs">
                                    <div><span className="text-slate-400">耗材编码：</span><span className="text-slate-700">{plan.material_code || '-'}</span></div>
                                    <div><span className="text-slate-400">套头：</span><span className="text-slate-700">{plan.sleeve || '-'}</span></div>
                                    <div><span className="text-slate-400">裹膜：</span><span className="text-slate-700">{plan.wrap_film || '-'}</span></div>
                                    <div><span className="text-slate-400">快递费：</span><span className="text-slate-700">¥{Number(plan.express_cost).toFixed(2)}</span></div>
                                    <div><span className="text-slate-400">包材费-箱/袋：</span><span className="text-slate-700">¥{Number(plan.material_cost_box).toFixed(4)}</span></div>
                                    <div><span className="text-slate-400">包材费-套头：</span><span className="text-slate-700">¥{Number(plan.material_cost_sleeve).toFixed(4)}</span></div>
                                    <div><span className="text-slate-400">包材费-裹膜：</span><span className="text-slate-700">¥{Number(plan.material_cost_wrap).toFixed(4)}</span></div>
                                  </div>
                                </td>
                              </tr>
                            );
                          }
                          return rows;
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* 分页控件 */}
              {planTotal > 0 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50/50">
                  <div className="text-sm text-slate-600">
                    共 <span className="font-medium text-slate-800">{planTotal}</span> 条记录，
                    第 <span className="font-medium text-slate-800">{planPage}</span> / <span className="font-medium text-slate-800">{planTotalPages}</span> 页
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPlanPage(Math.max(1, planPage - 1))}
                      disabled={planPage === 1}
                      className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setPlanPage(Math.min(planTotalPages, planPage + 1))}
                      disabled={planPage === planTotalPages}
                      className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

      </div>

      {/* ── 模型自动识别弹窗 ── */}
      {showRecognize && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => { if (!recognizing) closeRecognize(); }}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-lg"
            onClick={e => e.stopPropagation()}
          >
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-500" />
                模型自动识别
              </h3>
              <button
                onClick={closeRecognize}
                disabled={recognizing}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 弹窗内容 */}
            <div className="px-5 py-4 space-y-4">
              {/* 图片上传 */}
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">
                  商品图片（最多 {RECOGNIZE_MAX_IMAGES} 张）
                </label>
                <input
                  id="recognize-file-input"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleRecognizeFileSelect}
                  disabled={recognizing}
                  className="hidden"
                />
                <div className="flex flex-wrap gap-2">
                  {recognizeFiles.map((f, idx) => (
                    <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden border border-slate-200 group">
                      <img src={f.preview} alt={`预览${idx + 1}`} className="w-full h-full object-cover" />
                      <button
                        onClick={() => removeRecognizeFile(idx)}
                        disabled={recognizing}
                        className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-black/70 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {recognizeFiles.length < RECOGNIZE_MAX_IMAGES && (
                    <label
                      htmlFor="recognize-file-input"
                      className="flex flex-col items-center justify-center gap-1 w-20 h-20 rounded-lg border-2 border-dashed border-slate-300 text-slate-400 hover:border-violet-400 hover:text-violet-500 cursor-pointer transition-colors"
                    >
                      <ImagePlus className="w-5 h-5" />
                      <span className="text-[10px]">上传图片</span>
                    </label>
                  )}
                </div>
              </div>

              {/* 文字补充 */}
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">文字说明（与图片二选一）</label>
                <textarea
                  value={recognizeText}
                  onChange={e => setRecognizeText(e.target.value)}
                  disabled={recognizing}
                  rows={3}
                  placeholder="例如：识别图中商品的名称、数量、尺寸和重量信息"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder-slate-300 focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 outline-none transition-all resize-none"
                />
              </div>

              {recognizeError && (
                <div className="px-3 py-2 text-xs text-red-600 bg-red-50 rounded-lg">
                  {recognizeError}
                </div>
              )}
            </div>

            {/* 弹窗底部 */}
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <button
                onClick={closeRecognize}
                disabled={recognizing}
                className="px-4 py-2 text-sm text-slate-600 rounded-lg hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                取消
              </button>
              <button
                onClick={submitRecognize}
                disabled={recognizing || (recognizeFiles.length === 0 && !recognizeText.trim())}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-violet-500 to-indigo-500 rounded-lg hover:from-violet-600 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {recognizing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    识别中...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    开始识别
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── 耗材表格导入弹窗 ── */}
      {showPackagingImport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => { if (!importingPackaging) closePackagingImport(); }}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-md"
            onClick={e => e.stopPropagation()}
          >
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Upload className="w-4 h-4 text-blue-500" />
                导入耗材
              </h3>
              <button
                onClick={closePackagingImport}
                disabled={importingPackaging}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 弹窗内容 */}
            <div className="px-5 py-4 space-y-4">
              <div className="px-3 py-2 text-xs text-amber-700 bg-amber-50 rounded-lg">
                导入前会清空现有耗材数据，并以表格中的数据全量替换。
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">表格文件（.xlsx）</label>
                <input
                  id="packaging-import-file"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handlePackagingFileChange}
                  disabled={importingPackaging}
                  className="hidden"
                />
                <div className="flex items-center gap-3 px-3 py-2 border border-slate-200 rounded-lg">
                  <label
                    htmlFor="packaging-import-file"
                    className={`shrink-0 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-md transition-colors ${importingPackaging ? 'opacity-50 pointer-events-none' : 'hover:bg-blue-100 cursor-pointer'}`}
                  >
                    选择文件
                  </label>
                  <span className="text-sm text-slate-600 truncate">
                    {packagingFile ? packagingFile.name : '未选择任何文件'}
                  </span>
                </div>
              </div>

              {packagingImportMsg && (
                <div className="px-3 py-2 text-xs text-green-700 bg-green-50 rounded-lg">
                  {packagingImportMsg}
                </div>
              )}
              {packagingImportError && (
                <div className="px-3 py-2 text-xs text-red-600 bg-red-50 rounded-lg">
                  {packagingImportError}
                </div>
              )}
            </div>

            {/* 弹窗底部 */}
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <button
                onClick={closePackagingImport}
                disabled={importingPackaging}
                className="px-4 py-2 text-sm text-slate-600 rounded-lg hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {packagingImportMsg ? '关闭' : '取消'}
              </button>
              <button
                onClick={submitPackagingImport}
                disabled={importingPackaging || !packagingFile}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {importingPackaging ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    导入中...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    开始导入
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
