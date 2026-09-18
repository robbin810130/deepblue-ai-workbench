import React, { useState, useRef, useEffect } from 'react';
import {
  Scan, Activity, Upload,
  Camera, X, RefreshCw, Download, FileText, Share2, Trash2, Maximize2,
  AlertTriangle, CheckCircle, Clock, List, BrainCircuit, ChevronLeft, ChevronRight
} from 'lucide-react';
import { fetchWithAuth } from '../utils/authFetch';

// ─── 检测结果类型 ─────────────────────────────────────────────────────────────
interface DetectionLocation {
  left: number; top: number; width: number; height: number; score: number;
}
interface DetectionResult {
  id: number;
  location: DetectionLocation;
  status: 'safe' | 'danger' | 'warning' | 'unknown';
  label: string;
  confidence: number;
  attrs: Record<string, { name: string; score: number }>;
}
interface DetectionStats { total: number; safe: number; danger: number; }

interface BatchResultItem {
  image: string;
  results: DetectionResult[];
  stats: DetectionStats;
  difyResult: any;
  originalSizeStr?: string;
  compressedSizeStr?: string;
}

interface HistoryItem {
  id: string;
  timestamp: string;
  mode: 'COMPREHENSIVE' | 'SPECIALIZED';
  detectionType?: 'helmet' | 'mask' | 'phone';
  // Legacy single item fields
  image?: string;
  results?: DetectionResult[];
  stats?: DetectionStats;
  difyResult?: any;
  // Batch mode fields
  batch?: BatchResultItem[];
}

// ─── 图像自动压缩辅助函数 ──────────────────────────────────────────────────────
const compressImage = (base64Str: string, maxW = 1920, maxH = 1920): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let width = img.naturalWidth;
      let height = img.naturalHeight;
      // 如果尺寸已经小于等于限制，则无需进行压缩重绘，直接返回原图
      if (width <= maxW && height <= maxH) {
        resolve(base64Str);
        return;
      }
      if (width > height) {
        height = Math.round((height * maxW) / width);
        width = maxW;
      } else {
        width = Math.round((width * maxH) / height);
        height = maxH;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        // 使用 jpeg 格式进行 0.85 质量的有损压缩以控制文件大小
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } else {
        resolve(base64Str);
      }
    };
    img.onerror = () => resolve(base64Str);
    img.src = base64Str;
  });
};

export const HazardDetectionModule: React.FC = () => {
  // --- States ---
  const [activeMode, setActiveMode] = useState<'SPECIALIZED' | 'COMPREHENSIVE'>('COMPREHENSIVE');
  const [difyResult, setDifyResult] = useState<any>(null);

  const [detectionType, setDetectionType] = useState<'helmet' | 'mask' | 'phone'>('helmet');
  const [threshold, setThreshold] = useState<number>(0.7);

  // Advanced Settings
  const [advSettings, setAdvSettings] = useState({
    compress: true,
    showBox: true,
    showLabel: true,
    autoSave: true
  });

  // Image & Detection State
  const [image, setImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [hasResult, setHasResult] = useState(false);
  const [detectionResults, setDetectionResults] = useState<DetectionResult[]>([]);
  const [detectionStats, setDetectionStats] = useState<DetectionStats>({ total: 0, safe: 0, danger: 0 });
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ w: number; h: number } | null>(null);

  // 新增：自动压缩状态展示与检测历史记录
  const [imageSizeInfo, setImageSizeInfo] = useState<{ original: string; compressed?: string } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const [batchItems, setBatchItems] = useState<BatchResultItem[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (batchItems && batchItems.length > 0) {
      const active = batchItems[activeIndex];
      if (!active) return;
      setImage(active.image);
      setDetectionResults(active.results);
      setDetectionStats(active.stats);
      setDifyResult(active.difyResult);
      setImageSizeInfo({
        original: active.originalSizeStr || '',
        compressed: active.compressedSizeStr || ''
      });
      const img = new Image();
      img.onload = () => setImageDimensions({ w: img.naturalWidth, h: img.naturalHeight });
      img.src = active.image;
    }
  }, [batchItems, activeIndex]);

  // 新增：全屏高精排查模式状态及 Ref
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenImageDimensions, setFullscreenImageDimensions] = useState<{ w: number; h: number } | null>(null);
  const fullscreenImageRef = useRef<HTMLImageElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // 初始化时加载历史记录
  useEffect(() => {
    const saved = localStorage.getItem('hazard_detection_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error('加载历史记录失败', e);
      }
    }
  }, []);

  // --- Handlers ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isDetecting) return;
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    simulateUploadAndDetect(files);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (isDetecting) return;
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    simulateUploadAndDetect(files);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (isDetecting) return;
    const items = e.clipboardData.items;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) simulateUploadAndDetect(files);
  };

  // 保存记录至本地 localStorage
  const saveBatchToHistory = (newItem: HistoryItem) => {
    if (!advSettings.autoSave) return;

    setHistory(prev => {
      const combined = [newItem, ...prev];
      // 按检测类型分类保留，每种类型最多只保留 5 条记录
      const aiComprehensive = combined.filter(x => x.mode === 'COMPREHENSIVE').slice(0, 5);
      const helmets = combined.filter(x => x.mode === 'SPECIALIZED' && (x.detectionType === 'helmet' || !x.detectionType)).slice(0, 5);
      const masks = combined.filter(x => x.mode === 'SPECIALIZED' && x.detectionType === 'mask').slice(0, 5);
      const phones = combined.filter(x => x.mode === 'SPECIALIZED' && x.detectionType === 'phone').slice(0, 5);
      const updated = [...aiComprehensive, ...helmets, ...masks, ...phones];

      try {
        localStorage.setItem('hazard_detection_history', JSON.stringify(updated));
      } catch (e) {
        console.warn('LocalStorage 已满，尝试清理老数据', e);
        const restricted = [
          ...aiComprehensive.slice(0, 2),
          ...helmets.slice(0, 2),
          ...masks.slice(0, 2),
          ...phones.slice(0, 2)
        ];
        try {
          localStorage.setItem('hazard_detection_history', JSON.stringify(restricted));
        } catch (err) {
          localStorage.removeItem('hazard_detection_history');
        }
      }
      return updated;
    });
  };

  // 加载历史检测记录
  const loadHistoryItem = (item: HistoryItem) => {
    if (isDetecting) return;
    if (item.batch && item.batch.length > 0) {
      setBatchItems(item.batch);
      setActiveIndex(0);
    } else {
      // Legacy fallback
      setBatchItems([{
        image: item.image || '',
        results: item.results || [],
        stats: item.stats || { total: 0, safe: 0, danger: 0 },
        difyResult: item.difyResult,
        originalSizeStr: `${Math.round(((item.image || '').length * 0.75) / 1024)} KB`,
        compressedSizeStr: '已从历史加载'
      }]);
      setActiveIndex(0);
    }
    setDetectionType(item.detectionType || 'helmet');
    setHasResult(true);
    setDetectionError(null);
    setActiveMode(item.mode || 'COMPREHENSIVE');
  };

  // 重新检测现有图像
  const handleReDetect = async () => {
    if (!image) return;
    setIsDetecting(true);
    setDetectionError(null);
    try {
      const b64 = image.replace(/^data:image\/\w+;base64,/, '');
      const response = await fetchWithAuth('/api/hazard-detection/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: b64,
          detectionType,
          threshold
        })
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || '检测失败，请重试');
      }

      setDetectionResults(data.results || []);
      setDetectionStats(data.stats || { total: 0, safe: 0, danger: 0 });
      setHasResult(true);

      // 更新历史记录
      if (batchItems) {
        const newBatch = [...batchItems];
        newBatch[activeIndex] = {
          ...newBatch[activeIndex],
          results: data.results || [],
          stats: data.stats || { total: 0, safe: 0, danger: 0 }
        };
        setBatchItems(newBatch);
        if (advSettings.autoSave) {
          saveBatchToHistory({
            id: Date.now().toString(),
            timestamp: new Date().toLocaleTimeString(),
            mode: activeMode,
            detectionType,
            batch: newBatch
          });
        }
      }
    } catch (err: any) {
      setDetectionError(err.message || '重新检测服务异常');
    } finally {
      setIsDetecting(false);
    }
  };

  // 下载当前渲染了边界框的结果图片 (支持批量)
  const handleDownloadResult = () => {
    if (isDetecting || !hasResult) return;
    const itemsToDownload: BatchResultItem[] = (batchItems && batchItems.length > 0) ? batchItems : [{ image: image || '', results: detectionResults, stats: detectionStats, difyResult }];

    itemsToDownload.forEach((item: any, index: number) => {
      if (!item.image) return;
      const img = new Image();
      img.onload = () => {
        const padding = 20;
        const fontSize = Math.max(16, Math.round(img.naturalWidth / 40));
        const lineHeight = fontSize * 1.5;
        let extraHeight = 0;

        let difyFindings: any[] = [];
        if (activeMode === 'COMPREHENSIVE' && item.difyResult && item.difyResult.findings && item.difyResult.findings.length > 0) {
          difyFindings = item.difyResult.findings;
        }

        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let wrappedFindings: { lines: string[], color: string }[] = [];
        if (difyFindings.length > 0) {
          ctx.font = `${fontSize}px sans-serif`;
          const maxW = canvas.width - padding * 2;

          difyFindings.forEach((finding: any, idx: number) => {
            const text = `${idx + 1}. [${finding.severity} Risk] ${finding.category} - ${finding.description}`;
            let line = '';
            const lines = [];
            for (let n = 0; n < text.length; n++) {
              const testLine = line + text[n];
              const testWidth = ctx.measureText(testLine).width;
              if (testWidth > maxW && n > 0) {
                lines.push(line);
                line = text[n];
              } else {
                line = testLine;
              }
            }
            lines.push(line);
            const color = finding.severity === 'High' ? '#ef4444' : finding.severity === 'Medium' ? '#f97316' : '#eab308';
            wrappedFindings.push({ lines, color });
          });

          const totalLines = wrappedFindings.reduce((sum, w) => sum + w.lines.length, 0);
          extraHeight = padding * 2 + (fontSize + 10) + totalLines * lineHeight;
        }

        canvas.height = img.naturalHeight + extraHeight;

        // 重新获取 ctx，因为修改 canvas 尺寸后状态会重置
        const ctx2 = canvas.getContext('2d');
        if (!ctx2) return;

        // 填充白色背景
        ctx2.fillStyle = '#ffffff';
        ctx2.fillRect(0, 0, canvas.width, canvas.height);

        // 1. 绘制原图 (在顶部)
        ctx2.drawImage(img, 0, 0);

        // 2. 绘制边界框与标签 (专项模式)
        if (advSettings.showBox && item.results && item.results.length > 0) {
          item.results.forEach((r: any) => {
            const l = r.location;
            const boxLeft = l.left;
            const boxTop = l.top;
            const boxW = l.width;
            const boxH = l.height;

            const isDanger = r.status === 'danger';
            const isSafe = r.status === 'safe';
            const isWarning = r.status === 'warning';
            const color = isDanger ? 'rgb(239,68,68)' : isSafe ? 'rgb(34,197,94)' : isWarning ? 'rgb(249,115,22)' : 'rgb(234,179,8)';

            ctx2.strokeStyle = color;
            ctx2.lineWidth = Math.max(4, Math.round(canvas.width / 400));
            ctx2.strokeRect(boxLeft, boxTop, boxW, boxH);

            if (advSettings.showLabel) {
              const labelFontSize = Math.max(14, Math.round(canvas.width / 80));
              ctx2.font = `bold ${labelFontSize}px sans-serif`;
              const text = `${r.label} ${Math.round(r.confidence * 100)}%`;
              const textWidth = ctx2.measureText(text).width;
              const labelPadding = Math.max(6, Math.round(labelFontSize / 3));
              const labelHeight = labelFontSize + labelPadding * 2;
              ctx2.fillStyle = color;
              const drawTop = boxTop - labelHeight >= 0 ? boxTop - labelHeight : boxTop;
              ctx2.fillRect(boxLeft, drawTop, textWidth + labelPadding * 2, labelHeight);
              ctx2.fillStyle = '#ffffff';
              ctx2.textBaseline = 'middle';
              ctx2.fillText(text, boxLeft + labelPadding, drawTop + labelHeight / 2);
            }
          });
        }

        // 3. 绘制综合文字结果 (综合模式)
        if (difyFindings.length > 0) {
          const startY = img.naturalHeight;

          ctx2.fillStyle = '#1e293b'; // 深蓝色底边
          ctx2.fillRect(0, startY, canvas.width, extraHeight);

          ctx2.fillStyle = '#ffffff';
          ctx2.textBaseline = 'top';
          ctx2.font = `bold ${fontSize + 4}px sans-serif`;
          ctx2.fillText(`AI 综合隐患检测发现 ${difyFindings.length} 项风险：`, padding, startY + padding);

          ctx2.font = `${fontSize}px sans-serif`;
          let currentLineY = startY + padding + fontSize + 10;

          wrappedFindings.forEach((wf) => {
            ctx2.fillStyle = wf.color;
            wf.lines.forEach((lineText) => {
              ctx2.fillText(lineText, padding, currentLineY);
              currentLineY += lineHeight;
            });
          });
        }

        // 4. 触发客户端下载
        const link = document.createElement('a');
        link.download = `hazard_detection_${detectionType}_${Date.now()}_${index + 1}.jpg`;
        link.href = canvas.toDataURL('image/jpeg', 0.9);
        link.click();
      };
      img.src = item.image;
    });
  };

  // 导出高保真 HTML 格式的可视化检测合规报告（包含高亮标注红框图）
  const handleExportReport = async () => {
    if (isDetecting || !image || !hasResult) return;
    const items = (batchItems && batchItems.length > 0) ? batchItems : [{
      image,
      results: detectionResults,
      stats: detectionStats,
      difyResult
    }];

    const renderItemHTML = async (item: BatchResultItem | any, index: number) => {
      return new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(''); return; }
          ctx.drawImage(img, 0, 0);

          if (advSettings.showBox && item.results) {
            item.results.forEach((r: any) => {
              const l = r.location;
              const boxLeft = l.left;
              const boxTop = l.top;
              const boxW = l.width;
              const boxH = l.height;
              const isDanger = r.status === 'danger';
              const isSafe = r.status === 'safe';
              const isWarning = r.status === 'warning';
              const color = isDanger ? 'rgb(239,68,68)' : isSafe ? 'rgb(34,197,94)' : isWarning ? 'rgb(249,115,22)' : 'rgb(234,179,8)';
              ctx.strokeStyle = color;
              ctx.lineWidth = Math.max(4, Math.round(canvas.width / 400));
              ctx.strokeRect(boxLeft, boxTop, boxW, boxH);

              if (advSettings.showLabel) {
                const fontSize = Math.max(14, Math.round(canvas.width / 80));
                ctx.font = `bold ${fontSize}px sans-serif`;
                const text = `${r.label} ${Math.round(r.confidence * 100)}%`;
                const textWidth = ctx.measureText(text).width;
                const padding = Math.max(6, Math.round(fontSize / 3));
                const labelHeight = fontSize + padding * 2;
                ctx.fillStyle = color;
                const drawTop = boxTop - labelHeight >= 0 ? boxTop - labelHeight : boxTop;
                ctx.fillRect(boxLeft, drawTop, textWidth + padding * 2, labelHeight);
                ctx.fillStyle = '#ffffff';
                ctx.textBaseline = 'middle';
                ctx.fillText(text, boxLeft + padding, drawTop + labelHeight / 2);
              }
            });
          }

          const renderedImage = canvas.toDataURL('image/jpeg', 0.9);

          let difyHtml = '';
          if (activeMode === 'COMPREHENSIVE' && item.difyResult) {
            const d = item.difyResult;
            const findingsHtml = (d.findings || []).map((f: any) => `
              <li class="mb-3 bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
                <div class="font-bold text-slate-800 flex items-center gap-2 mb-1">
                  <span>${f.category || '隐患'}</span>
                  <span class="px-2 py-0.5 rounded text-[10px] uppercase font-black ${f.severity === 'High' ? 'bg-red-100 text-red-700' : f.severity === 'Medium' ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-700'}">${f.severity || '未知'} Risk</span>
                </div>
                <div class="text-slate-600 mb-1"><strong>描述:</strong> ${f.description || '无详细描述'}</div>
                <div class="text-slate-600"><strong>建议:</strong> ${f.recommended_action || '无建议'}</div>
              </li>
            `).join('');

            difyHtml = `
              <div class="mt-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <h3 class="font-bold text-sm text-slate-700 mb-2">综合分析总结 (环境上下文)：</h3>
                <p class="text-sm text-slate-600 mb-4">${d.environment_context || '未提供环境分析'}</p>
                <div class="grid grid-cols-1 gap-4">
                  <div>
                    <h4 class="font-bold text-xs text-red-600 mb-2">隐患发现与建议</h4>
                    <ul class="text-xs">
                      ${findingsHtml || '<li class="text-slate-400">未检测到具体隐患</li>'}
                    </ul>
                  </div>
                </div>
              </div>
            `;
          }

          const targetRows = (item.results || []).map((r: any) => `
            <tr class="border-b border-gray-100 hover:bg-slate-50/50 transition-colors">
              <td class="px-6 py-4 text-sm font-bold ${r.status === 'danger' ? 'text-red-600' : 'text-green-600'}">${r.label}</td>
              <td class="px-6 py-4 text-sm text-gray-600">${Math.round(r.confidence * 100)}%</td>
              <td class="px-6 py-4 text-sm"><span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${r.status === 'danger' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}">${r.status === 'danger' ? '违规隐患' : '合规安全'}</span></td>
            </tr>
          `).join('');

          resolve(`
            <div class="mb-12 border-b border-slate-200 pb-8">
              <h2 class="text-lg font-black text-slate-800 mb-4">图像检测记录 #${index + 1}</h2>
              <div class="grid grid-cols-3 gap-6 mb-6">
                <div class="bg-slate-50 rounded-2xl p-5 border border-slate-200/50">
                  <div class="text-[11px] text-slate-400 font-bold uppercase tracking-wider mb-1">目标数</div>
                  <div class="text-2xl font-black text-slate-800">${item.stats?.total || 0}</div>
                </div>
                <div class="bg-green-50/20 rounded-2xl p-5 border border-green-100/40">
                  <div class="text-[11px] text-green-600 font-bold uppercase tracking-wider mb-1">合规安全</div>
                  <div class="text-2xl font-black text-green-700">${item.stats?.safe || 0}</div>
                </div>
                <div class="bg-red-50/20 rounded-2xl p-5 border border-red-100/40">
                  <div class="text-[11px] text-red-600 font-bold uppercase tracking-wider mb-1">违规隐患</div>
                  <div class="text-2xl font-black text-red-700">${item.stats?.danger || 0}</div>
                </div>
              </div>
              
              <div class="mb-6">
                <div class="rounded-2xl overflow-hidden border border-slate-200 bg-slate-950 flex justify-center max-h-[420px] shadow-inner">
                  <img src="${renderedImage}" class="max-w-full max-h-full object-contain" />
                </div>
              </div>
              
              ${difyHtml}

              ${item.results && item.results.length > 0 ? `
              <div class="overflow-hidden border border-slate-100 rounded-2xl mt-6">
                <table class="min-w-full divide-y divide-slate-100">
                  <thead class="bg-slate-50">
                    <tr>
                      <th class="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">识别主体</th>
                      <th class="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">置信度</th>
                      <th class="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">状态</th>
                    </tr>
                  </thead>
                  <tbody class="bg-white divide-y divide-slate-100">
                    ${targetRows}
                  </tbody>
                </table>
              </div>
              ` : ''}
            </div>
          `);
        };
        img.src = item.image;
      });
    };

    const typeName = detectionType === 'helmet' ? '安全帽佩戴识别' : detectionType === 'mask' ? '口罩佩戴识别' : '手机使用违规识别';
    const reportSegments = await Promise.all(items.map((item, idx) => renderItemHTML(item, idx)));

    const htmlContent = `
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <title>智能 AI 现场合规分析报告</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @media print {
      .no-print { display: none; }
      body { background: white; padding: 0; }
      .shadow-xl { box-shadow: none; border: none; }
    }
  </style>
</head>
<body class="bg-slate-50 text-slate-800 p-8 min-h-screen font-sans">
  <div class="max-w-4xl mx-auto bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-100 p-8">
    <div class="flex justify-between items-start border-b border-slate-100 pb-6 mb-8">
      <div>
        <h1 class="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">🛡️ AI 智能隐患排查研判报告</h1>
        <p class="text-xs text-slate-400 font-medium mt-1">报告生成时间: ${new Date().toLocaleString()} | 系统研判编号: HD-${Date.now()}</p>
        <p class="text-xs text-slate-400 font-medium mt-1">业务类型: ${activeMode === 'COMPREHENSIVE' ? '大模型综合检测' : typeName} | 检测总计: ${items.length} 张图片</p>
      </div>
      <button onclick="window.print()" class="no-print bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-md">
        打印报告 / 保存为 PDF
      </button>
    </div>
    
    ${reportSegments.join('\\n')}

    <div class="border-t border-slate-100 mt-8 pt-6 flex justify-between items-center text-[10px] text-slate-400 font-medium">
      <div>服务商：AI 安全大脑排查控制端</div>
      <div>注：本报告通过机器视觉及大模型算法生成，仅供参考。</div>
    </div>
  </div>
</body>
</html>
    `;

    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `hazard_report_${Date.now()}.html`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  const simulateUploadAndDetect = async (files: File[]) => {
    let filesToProcess = files;
    if (activeMode === 'COMPREHENSIVE' && files.length > 100) {
      alert('最多只能同时上传100张图片，已截取前100张进行检测。');
      filesToProcess = files.slice(0, 100);
    } else if (activeMode !== 'COMPREHENSIVE' && files.length > 1) {
      alert('专业模式当前仅支持单张图片检测，将仅处理第一张。');
      filesToProcess = [files[0]];
    }

    setIsUploading(true);
    setHasResult(false);
    setDetectionError(null);
    setDetectionResults([]);
    setImageSizeInfo(null);
    setBatchItems(null);
    setActiveIndex(0);

    if (filesToProcess.length > 0) {
      setImage(URL.createObjectURL(filesToProcess[0]));
    }

    setIsUploading(false);
    setIsDetecting(true);

    try {
      let finalBatchItems: BatchResultItem[] = [];

      // Helper for processing files to base64
      const getFileData = (file: File) => new Promise<{ dataUrl: string, base64: string, originalSizeStr: string, compressedSizeStr?: string }>((resolve, reject) => {
        const originalSizeStr = (file.size / 1024 / 1024).toFixed(2) + ' MB';
        const reader = new FileReader();
        reader.onload = async (ev) => {
          let dataUrl = ev.target?.result as string;
          let compressedSizeStr = undefined;
          if (advSettings.compress) {
            dataUrl = await compressImage(dataUrl);
            compressedSizeStr = ((dataUrl.length * 0.75) / 1024).toFixed(1) + ' KB';
          }
          const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
          resolve({ dataUrl, base64, originalSizeStr, compressedSizeStr });
        };
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsDataURL(file);
      });

      if (activeMode === 'COMPREHENSIVE') {
        const CHUNK_SIZE = 10;
        const chunks: File[][] = [];
        for (let i = 0; i < filesToProcess.length; i += CHUNK_SIZE) {
          chunks.push(filesToProcess.slice(i, i + CHUNK_SIZE));
        }

        const processChunk = async (chunkFiles: File[]): Promise<BatchResultItem[]> => {
          const fileDataList = await Promise.all(chunkFiles.map(getFileData));
          const response = await fetchWithAuth('/api/hazard-detection/dify-detect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ images: fileDataList.map(f => f.base64) }),
          });
          const data = await response.json();
          if (!data.success) throw new Error(data.message || '大模型检测失败，请重试');

          return fileDataList.map((f, idx) => {
            const difyRes = data.data[idx] || { total_hazards_detected: 0, overall_risk_level: 'Unknown', findings: [] };
            const mockStats = { total: difyRes.total_hazards_detected || 0, safe: 0, danger: difyRes.total_hazards_detected || 0 };
            return {
              image: f.dataUrl,
              results: [],
              stats: mockStats,
              difyResult: difyRes,
              originalSizeStr: f.originalSizeStr,
              compressedSizeStr: f.compressedSizeStr
            };
          });
        };

        const chunkResults = await Promise.all(chunks.map(processChunk));
        finalBatchItems = chunkResults.flat();
      } else {
        const processSingle = async (file: File): Promise<BatchResultItem> => {
          const fData = await getFileData(file);
          const response = await fetchWithAuth('/api/hazard-detection/detect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: fData.base64,
              detectionType,
              threshold,
            }),
          });
          const data = await response.json();
          if (!data.success) throw new Error(data.message || '检测失败，请重试');

          return {
            image: fData.dataUrl,
            results: data.results || [],
            stats: data.stats || { total: 0, safe: 0, danger: 0 },
            difyResult: null,
            originalSizeStr: fData.originalSizeStr,
            compressedSizeStr: fData.compressedSizeStr
          };
        };
        finalBatchItems = await Promise.all(filesToProcess.map(processSingle));
      }

      setBatchItems(finalBatchItems);
      setActiveIndex(0);
      setHasResult(true);

      if (advSettings.autoSave) {
        const newItem: HistoryItem = {
          id: Date.now().toString(),
          timestamp: new Date().toLocaleTimeString(),
          mode: activeMode,
          detectionType,
          batch: finalBatchItems
        };
        saveBatchToHistory(newItem);
      }
    } catch (err: any) {
      setDetectionError(err.message || '批量检测服务异常');
      setHasResult(false);
    } finally {
      setIsDetecting(false);
    }
  };

  const handleClear = () => {
    if (isDetecting) return;
    setImage(null);
    setBatchItems(null);
    setActiveIndex(0);
    setHasResult(false);
    setDetectionResults([]);
    setDifyResult(null);
    setIsUploading(false);
    setIsDetecting(false);
    setImageSizeInfo(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // --- Render Helpers ---
  const renderTopNav = () => (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 shadow-sm z-10 relative">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-600 shadow-md flex items-center justify-center">
          <Scan className="w-4 h-4 text-white" />
        </div>
        <h1 className="text-[15px] font-bold text-slate-800 tracking-tight">隐患图像识别演示</h1>
        <div className="w-px h-4 bg-slate-300 mx-2" />
        <div className="text-xs font-medium text-slate-500">智能体集成平台 / 隐患检测</div>
      </div>



    </header>
  );

  const renderLeftSidebar = () => (
    <aside className="w-[240px] bg-[#F8FAFC] border-r border-slate-200 flex flex-col shrink-0 custom-scrollbar overflow-y-auto relative z-0">

      <div className="p-4 flex-1">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">分析模式</h3>
        <div className="space-y-1.5 mb-8">
          <button
            onClick={() => { if (!isDetecting) { setActiveMode('COMPREHENSIVE'); handleClear(); } }}
            disabled={isDetecting}
            className={`w-full text-left px-3 py-2.5 rounded-xl font-bold text-[13px] flex items-center gap-2 transition-colors ${activeMode === 'COMPREHENSIVE' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'text-slate-600 hover:bg-slate-200/50'} ${isDetecting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <BrainCircuit className="w-4 h-4" /> AI 综合研判
          </button>
          <button
            onClick={() => { if (!isDetecting) { setActiveMode('SPECIALIZED'); handleClear(); } }}
            disabled={isDetecting}
            className={`w-full text-left px-3 py-2.5 rounded-xl font-bold text-[13px] flex items-center gap-2 transition-colors ${activeMode === 'SPECIALIZED' ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'text-slate-600 hover:bg-slate-200/50'} ${isDetecting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <List className="w-4 h-4" /> 专项特征检测
          </button>
        </div>

        {activeMode === 'SPECIALIZED' && (
          <>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">专项模型配置</h3>
            <div className="space-y-5">
              <div>
                <label className="block text-[13px] font-bold text-slate-700 mb-2">检测类型选择</label>
                <select
                  value={detectionType}
                  disabled={isDetecting}
                  onChange={e => {
                    if (isDetecting) return;
                    const newType = e.target.value as any;
                    if (newType !== detectionType) {
                      setDetectionType(newType);
                      handleClear();
                    }
                  }}
                  className={`w-full bg-white border border-slate-300 text-slate-700 text-[13px] rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-medium ${isDetecting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <option value="helmet">安全帽检测</option>
                  <option value="mask">口罩检测</option>
                  <option value="phone">手机检测</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between text-[13px] font-bold text-slate-700 mb-2">
                  <label>检测阈值 (Confidence)</label>
                  <span className="text-blue-600">{threshold.toFixed(2)}</span>
                </div>
                <input
                  type="range" min="0.1" max="1.0" step="0.05"
                  value={threshold}
                  disabled={isDetecting}
                  onChange={e => { if (!isDetecting) setThreshold(parseFloat(e.target.value)) }}
                  className={`w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 ${isDetecting ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm mt-4">
                <div className="bg-slate-50 px-3 py-2.5 border-b border-slate-200 flex items-center justify-between cursor-pointer">
                  <span className="text-[13px] font-bold text-slate-700">高级设置</span>
                </div>
                <div className="p-3 space-y-3">
                  {[
                    { key: 'compress', label: '图像自动压缩 (Max 1920px)' },
                    { key: 'showBox', label: '渲染边界框 (Bounding Box)' },
                    { key: 'showLabel', label: '显示置信度标签 (Label)' },
                    { key: 'autoSave', label: '自动保存检测结果' },
                  ].map(item => (
                    <label key={item.key} className="flex items-center justify-between cursor-pointer group">
                      <span className="text-[12px] font-semibold text-slate-600 group-hover:text-slate-900 transition-colors">{item.label}</span>
                      <div className={`w-8 h-4.5 rounded-full transition-colors relative ${advSettings[item.key as keyof typeof advSettings] ? 'bg-blue-600' : 'bg-slate-300'}`}
                        onClick={() => setAdvSettings(p => ({ ...p, [item.key]: !p[item.key as keyof typeof advSettings] }))}
                      >
                        <div className={`absolute top-0.5 left-0.5 bg-white w-3.5 h-3.5 rounded-full transition-transform ${advSettings[item.key as keyof typeof advSettings] ? 'translate-x-3.5' : 'translate-x-0'}`} />
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );

  const renderRightSidebar = () => (
    <aside className={`bg-white border-l border-slate-200 flex flex-col shrink-0 custom-scrollbar shadow-[inset_1px_0_0_rgba(0,0,0,0.02)] relative z-0 transition-all duration-300 ${activeMode === 'COMPREHENSIVE' ? 'w-[500px] xl:w-[600px] 2xl:w-[750px]' : 'w-[300px] xl:w-[360px]'}`}>
      <div className="p-5 border-b border-slate-100 shrink-0">
        <h2 className="text-lg font-black text-slate-800 tracking-tight flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-600" /> 分析与统计
        </h2>
      </div>

      <div className="p-5 flex-1 flex flex-col min-h-0">
        {/* Upper Part: Detection Results (Scrollable) */}
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-6 min-h-0">
          {hasResult ? (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">

              {activeMode === 'COMPREHENSIVE' && difyResult ? (
                <>
                  <div className="bg-indigo-50/50 border border-indigo-100 rounded-2xl p-4 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-bl-full -mr-4 -mt-4" />
                    <div className="flex justify-between items-center mb-4 text-xs font-bold text-indigo-500">
                      <span className="flex items-center gap-1"><BrainCircuit className="w-4 h-4" /> AI 综合风险研判</span>
                      <span className="bg-white px-2 py-1 rounded-md border border-indigo-100 shadow-sm">{new Date().toLocaleTimeString()}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-white rounded-xl p-3 border border-indigo-50 shadow-sm">
                        <div className="text-[11px] text-slate-400 font-bold mb-1">发现隐患总数</div>
                        <div className="text-xl font-black text-slate-800">{difyResult.total_hazards_detected}</div>
                      </div>
                      <div className="bg-white rounded-xl p-3 border border-indigo-50 shadow-sm">
                        <div className="text-[11px] text-slate-400 font-bold mb-1">整体风险评级</div>
                        <div className={`text-xl font-black ${difyResult.overall_risk_level === 'High' ? 'text-red-500' : difyResult.overall_risk_level === 'Medium' ? 'text-orange-500' : 'text-green-500'}`}>
                          {difyResult.overall_risk_level === 'High' ? '高风险' : difyResult.overall_risk_level === 'Medium' ? '中风险' : '低风险'}
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl p-3 border border-indigo-50 shadow-sm">
                      <div className="text-[11px] font-bold text-slate-500 mb-1">现场环境感知</div>
                      <p className="text-[11px] text-slate-700 leading-relaxed font-medium">
                        {difyResult.environment_context}
                      </p>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center justify-between">
                      <span>隐患识别明细</span>
                      <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{difyResult.findings?.length || 0} 项</span>
                    </h3>
                    <div className="space-y-3">
                      {difyResult.findings && difyResult.findings.length > 0 ? difyResult.findings.map((item: any) => (
                        <div key={item.id} className="border border-slate-200 bg-white rounded-xl p-4 shadow-sm hover:border-indigo-300 transition-colors">
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${item.severity === 'High' ? 'bg-red-500' : item.severity === 'Medium' ? 'bg-orange-500' : 'bg-yellow-500'}`} />
                              <span className="text-[13px] font-bold text-slate-800">{item.category}</span>
                            </div>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${item.severity === 'High' ? 'bg-red-50 text-red-600 border-red-100' : item.severity === 'Medium' ? 'bg-orange-50 text-orange-600 border-orange-100' : 'bg-yellow-50 text-yellow-600 border-yellow-100'}`}>
                              {item.severity === 'High' ? '高风险' : item.severity === 'Medium' ? '中风险' : '低风险'}
                            </span>
                          </div>
                          <p className="text-[12px] text-slate-700 font-bold mb-1">{item.description}</p>
                          <p className="text-[11px] text-slate-500 mb-2">证据: {item.visual_evidence}</p>

                          <div className="bg-slate-50 rounded-lg p-2.5 mt-2 space-y-1.5 border border-slate-100">
                            <div className="text-[10px] flex items-start gap-1">
                              <span className="text-red-500 font-bold shrink-0">风险:</span>
                              <span className="text-slate-600">{item.potential_consequence}</span>
                            </div>
                            <div className="text-[10px] flex items-start gap-1">
                              <span className="text-green-600 font-bold shrink-0">建议:</span>
                              <span className="text-slate-600">{item.recommended_action}</span>
                            </div>
                          </div>
                        </div>
                      )) : (
                        <div className="text-xs text-slate-400 text-center py-4">未检测到隐患</div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Overview Card for SPECIALIZED Mode */}
                  <div className="bg-[#F8FAFC] border border-slate-200 rounded-2xl p-4 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-bl-full -mr-4 -mt-4" />
                    <div className="flex justify-between items-center mb-4 text-xs font-bold text-slate-500">
                      <span>检测概览</span>
                      <span className="bg-white px-2 py-1 rounded-md border border-slate-200 shadow-sm">{new Date().toLocaleTimeString()}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                        <div className="text-[11px] text-slate-400 font-bold mb-1">总检测目标</div>
                        <div className="text-xl font-black text-slate-800">{detectionStats.total}</div>
                      </div>
                      <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                        <div className="text-[11px] text-slate-400 font-bold mb-1">风险目标</div>
                        <div className="text-xl font-black text-red-500">{detectionStats.danger}</div>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                      <div className="flex justify-between text-[11px] font-bold mb-2">
                        <span className="text-slate-500">合规率 (安全/总数)</span>
                        <span className={detectionStats.total > 0 && detectionStats.danger === 0 ? 'text-green-500' : 'text-amber-500'}>
                          {detectionStats.total > 0 ? Math.round((detectionStats.safe / detectionStats.total) * 100) : 0}%
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-500"
                          style={{ width: `${detectionStats.total > 0 ? (detectionStats.safe / detectionStats.total) * 100 : 0}%` }} />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-2 font-medium">
                        {detectionStats.danger > 0
                          ? `发现 ${detectionStats.danger} 处安全隐患，请及时处理。`
                          : detectionStats.total > 0
                            ? '未发现安全隐患，现场合规。'
                            : '暂无检测数据。'}
                      </p>
                    </div>
                  </div>

                  {/* Target List for SPECIALIZED Mode */}
                  <div>
                    <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center justify-between">
                      <span>目标详情</span>
                      <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{detectionResults.length} 项</span>
                    </h3>
                    <div className="space-y-2">
                      {detectionResults.length > 0 ? detectionResults.map(item => (
                        <div key={item.id} className="group border border-slate-100 hover:border-blue-200 bg-white hover:bg-blue-50/30 rounded-xl p-3 flex items-center gap-3 transition-colors cursor-pointer shadow-sm">
                          <div className={`w-10 h-10 rounded-lg shrink-0 flex items-center justify-center ${item.status === 'danger' ? 'bg-red-50' : item.status === 'warning' ? 'bg-orange-50' : 'bg-green-50'}`}>
                            {item.status === 'danger' ? <AlertTriangle className="w-5 h-5 text-red-500" /> : item.status === 'warning' ? <AlertTriangle className="w-5 h-5 text-orange-500" /> : <CheckCircle className="w-5 h-5 text-green-500" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-center mb-0.5">
                              <span className={`text-[13px] font-bold ${item.status === 'danger' ? 'text-red-600' : item.status === 'warning' ? 'text-orange-600' : 'text-green-600'}`}>{item.label}</span>
                              <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-1.5 rounded">{Math.round(item.confidence * 100)}%</span>
                            </div>
                            <div className="text-[10px] text-slate-400 truncate font-mono">
                              Box: [{item.location.left}, {item.location.top}, {item.location.left + item.location.width}, {item.location.top + item.location.height}]
                            </div>
                          </div>
                        </div>
                      )) : (
                        <div className="text-xs text-slate-400 text-center py-4">未检测到符合条件的目标</div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 py-10">
              <Scan className="w-16 h-16 mb-4 opacity-20" />
              <p className="text-sm font-bold">暂无当前检测数据</p>
              <p className="text-xs font-medium mt-1">请上传图片或双击历史记录查看</p>
            </div>
          )}
        </div>

        {/* Lower Part: History Records (Always at the bottom) */}
        {advSettings.autoSave && history.filter(item => item.mode === activeMode && (activeMode === 'SPECIALIZED' ? item.detectionType === detectionType : true)).length > 0 && (
          <div className="border-t border-slate-200 pt-4 mt-4 shrink-0 bg-white">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center justify-between">
              <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-blue-500" /> 最近检测历史</span>
              <button
                onClick={() => {
                  setHistory(prev => {
                    const updated = prev.filter(item => !(item.mode === activeMode && (activeMode === 'SPECIALIZED' ? item.detectionType === detectionType : true)));
                    try {
                      localStorage.setItem('hazard_detection_history', JSON.stringify(updated));
                    } catch (e) {
                      console.warn(e);
                    }
                    return updated;
                  });
                }}
                className="text-[10px] text-red-500 hover:text-red-600 hover:underline transition-colors font-bold"
              >
                清空历史
              </button>
            </h3>
            <div className="space-y-2 max-h-[190px] overflow-y-auto custom-scrollbar pr-1">
              {history.filter(item => item.mode === activeMode && (activeMode === 'SPECIALIZED' ? item.detectionType === detectionType : true)).map(item => {
                const displayData = (() => {
                  if (item.batch && item.batch.length > 0) {
                    const first = item.batch[0];
                    const totalSafe = item.batch.reduce((sum, b) => sum + (b.stats?.safe || 0), 0);
                    const totalDanger = item.batch.reduce((sum, b) => sum + (b.stats?.danger || 0), 0);
                    const totalAll = item.batch.reduce((sum, b) => sum + (b.stats?.total || 0), 0);
                    return {
                      image: first.image,
                      total: totalAll,
                      safe: totalSafe,
                      danger: totalDanger,
                      isBatch: item.batch.length > 1,
                      batchCount: item.batch.length
                    };
                  }
                  return {
                    image: item.image || '',
                    total: item.stats?.total || 0,
                    safe: item.stats?.safe || 0,
                    danger: item.stats?.danger || 0,
                    isBatch: false,
                    batchCount: 1
                  };
                })();

                return (
                  <div
                    key={item.id}
                    onClick={() => { if (!isDetecting) loadHistoryItem(item); }}
                    className={`flex items-center gap-3 p-2 bg-slate-50 border rounded-xl transition-all shadow-sm ${isDetecting ? 'opacity-50 cursor-not-allowed border-slate-100' : 'hover:bg-blue-50/50 border-slate-100 hover:border-blue-200 cursor-pointer'}`}
                  >
                    <div className="w-10 h-10 rounded-lg bg-slate-900 overflow-hidden shrink-0 relative border border-slate-200">
                      <img src={displayData.image} className="w-full h-full object-cover" />
                      <span className="absolute bottom-0 right-0 bg-black/60 text-white text-[7px] px-1 font-mono rounded-tl">
                        {displayData.total}人
                      </span>
                      {displayData.isBatch && (
                        <span className="absolute top-0 right-0 bg-blue-600/80 text-white text-[7px] px-1 font-mono rounded-bl">
                          {displayData.batchCount}图
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center mb-0.5">
                        <span className="text-[11px] font-bold text-slate-700">
                          {item.mode === 'COMPREHENSIVE' ? 'AI 综合研判' : item.detectionType === 'helmet' ? '安全帽检测' : item.detectionType === 'mask' ? '口罩检测' : '手机检测'}
                        </span>
                        <span className="text-[9px] text-slate-400 font-bold font-mono">{item.timestamp}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 flex gap-2 font-medium">
                        <span className="text-green-600 flex items-center gap-0.5">安全:{displayData.safe}</span>
                        <span className="text-red-500 flex items-center gap-0.5">风险:{displayData.danger}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );

  return (
    <div className="flex flex-col h-full w-full bg-slate-50 font-sans text-slate-800 overflow-hidden">
      {renderTopNav()}

      <div className="flex-1 flex overflow-hidden">
        {renderLeftSidebar()}

        {/* Main Center Area */}
        <main
          className="flex-1 flex flex-col min-w-0 relative"
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
          onPaste={handlePaste}
        >
          {/* Main Workspace (Unified View) */}
          <div className="flex-1 p-6 flex flex-col relative z-10 min-h-0">
            <h2 className="text-[14px] font-bold text-slate-700 mb-3 flex items-center justify-between">
              <span className="flex items-center gap-2"><Camera className="w-4 h-4 text-blue-500" /> 智能检测视窗</span>
              {image && (
                <span className="text-[11px] text-slate-400 font-normal flex items-center gap-3">
                  {imageSizeInfo && (
                    <span className="bg-slate-100 text-[10px] text-slate-600 px-2 py-0.5 rounded border border-slate-200">
                      文件大小: <strong className="text-slate-700">{imageSizeInfo.original}</strong>
                      {imageSizeInfo.compressed && (
                        <> ➜ <strong className="text-green-600">{imageSizeInfo.compressed}</strong> (自动压缩优化)</>
                      )}
                    </span>
                  )}
                  <span>(提示：可通过左侧控制栏切换“显示边界框”来对比原图)</span>
                </span>
              )}
            </h2>

            <div className={`flex-1 rounded-2xl overflow-hidden relative flex flex-col transition-all
              ${image ? 'bg-slate-900 border border-slate-800 shadow-xl' : 'bg-white border-2 border-dashed border-blue-200 hover:border-blue-400 hover:bg-blue-50/50 cursor-pointer'}
            `}>
              {!image && (
                <>
                  <input type="file" accept="image/*" multiple className="absolute inset-0 opacity-0 cursor-pointer z-10" onChange={handleFileUpload} ref={fileInputRef} />
                  <div className="flex-1 flex flex-col items-center justify-center">
                    <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                      <Upload className="w-10 h-10" />
                    </div>
                    <div className="text-[18px] font-black text-slate-700 mb-3">拖拽图片到此处或点击上传</div>
                    <div className="text-sm text-slate-400 font-medium">支持 JPG、PNG、BMP，单张最大 10MB，支持 Ctrl+V 粘贴</div>
                  </div>
                </>
              )}

              {image && (
                <div className="absolute inset-0 flex items-center justify-center group">
                  <img
                    ref={imageRef}
                    src={image}
                    alt="Workspace"
                    className="max-w-full max-h-full object-contain transition-opacity duration-300"
                    onLoad={(e) => {
                      const el = e.currentTarget;
                      setImageDimensions({ w: el.naturalWidth, h: el.naturalHeight });
                    }}
                  />

                  {/* Batch Navigation */}
                  {batchItems && batchItems.length > 1 && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); setActiveIndex(prev => prev > 0 ? prev - 1 : batchItems.length - 1); }}
                        className="absolute left-4 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 backdrop-blur-sm transition-all z-20"
                      >
                        <ChevronLeft className="w-6 h-6" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setActiveIndex(prev => prev < batchItems.length - 1 ? prev + 1 : 0); }}
                        className="absolute right-4 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 backdrop-blur-sm transition-all z-20"
                      >
                        <ChevronRight className="w-6 h-6" />
                      </button>

                      {/* Indicators */}
                      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-20 bg-black/30 px-3 py-2 rounded-full backdrop-blur-sm">
                        {batchItems.map((_, idx) => (
                          <div
                            key={idx}
                            onClick={(e) => { e.stopPropagation(); setActiveIndex(idx); }}
                            className={`w-2 h-2 rounded-full cursor-pointer transition-all ${idx === activeIndex ? 'bg-white w-4' : 'bg-white/50 hover:bg-white/80'}`}
                          />
                        ))}
                      </div>
                    </>
                  )}

                  {/* 真实检测框 (仅专项模式) */}
                  {activeMode === 'SPECIALIZED' && hasResult && advSettings.showBox && detectionResults.length > 0 && imageDimensions && imageRef.current && (() => {
                    const imgEl = imageRef.current;
                    const displayW = imgEl.clientWidth;
                    const displayH = imgEl.clientHeight;
                    const scaleX = displayW / imageDimensions.w;
                    const scaleY = displayH / imageDimensions.h;
                    const container = imgEl.parentElement!;
                    const offsetX = (container.clientWidth - displayW) / 2;
                    const offsetY = (container.clientHeight - displayH) / 2;

                    return (
                      <div className="absolute inset-0 pointer-events-none">
                        {detectionResults.map((r) => {
                          const l = r.location;
                          const boxLeft = offsetX + l.left * scaleX;
                          const boxTop = offsetY + l.top * scaleY;
                          const boxW = l.width * scaleX;
                          const boxH = l.height * scaleY;
                          const isDanger = r.status === 'danger';
                          const isSafe = r.status === 'safe';
                          const isWarning = r.status === 'warning';
                          const color = isDanger ? 'rgb(239,68,68)' : isSafe ? 'rgb(34,197,94)' : isWarning ? 'rgb(249,115,22)' : 'rgb(234,179,8)';
                          const glowColor = isDanger ? 'rgba(239,68,68,0.5)' : isSafe ? 'rgba(34,197,94,0.3)' : isWarning ? 'rgba(249,115,22,0.3)' : 'rgba(234,179,8,0.3)';
                          const bgColor = isDanger ? 'rgba(239,68,68,0.08)' : isSafe ? 'rgba(34,197,94,0.08)' : isWarning ? 'rgba(249,115,22,0.08)' : 'rgba(234,179,8,0.08)';
                          return (
                            <div key={r.id} className="absolute" style={{
                              left: boxLeft, top: boxTop, width: boxW, height: boxH,
                              border: `2px solid ${color}`,
                              backgroundColor: bgColor,
                              boxShadow: `0 0 15px ${glowColor}`,
                            }}>
                              {advSettings.showLabel && (
                                <div className="absolute -top-7 left-0 text-white text-[12px] font-bold px-2 py-1 whitespace-nowrap shadow-md rounded-t-md" style={{ backgroundColor: color }}>
                                  {r.label} {Math.round(r.confidence * 100)}%
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* 检测中遮罩 */}
                  {isDetecting && (
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex flex-col items-center justify-center z-20">
                      <Scan className="w-16 h-16 text-blue-500 animate-pulse mb-4" />
                      <div className="text-xl font-black text-white tracking-widest">AI 正在深度解析图像...</div>
                      <div className="text-sm text-blue-200 font-medium mt-2">
                        {activeMode === 'COMPREHENSIVE' ? '正在调用大模型进行多维度特征推理' : '正在提取特征点并与安全模型比对'}
                      </div>

                      {/* 上传进度条（如果是在上传阶段） */}
                      {isUploading && (
                        <div className="w-64 h-2 bg-slate-700 rounded-full overflow-hidden mt-6">
                          <div className="h-full bg-blue-500 w-2/3 animate-pulse" />
                        </div>
                      )}
                    </div>
                  )}

                  {/* 错误提示 */}
                  {detectionError && (
                    <div className="absolute inset-0 bg-red-900/40 backdrop-blur-md flex flex-col items-center justify-center z-20 text-white">
                      <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />
                      <div className="text-lg font-bold text-center px-6">{detectionError}</div>
                      <button onClick={() => setDetectionError(null)} className="mt-4 px-6 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-bold transition-colors">知道了</button>
                    </div>
                  )}

                  {/* 图片控制悬浮条 */}
                  <div className="absolute top-4 right-4 flex gap-2 z-30 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={handleClear} className="bg-black/50 hover:bg-red-500 text-white p-2.5 rounded-lg backdrop-blur-sm transition-colors tooltip" title="清除图片">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="absolute bottom-4 right-4 flex gap-2 z-30 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setIsFullscreen(true)} className="bg-black/60 hover:bg-black text-white p-2.5 rounded-lg backdrop-blur-md transition-colors tooltip" title="全屏高精排查模式">
                      <Maximize2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Action Toolbar */}
            <div className="h-16 bg-white border-t border-slate-200 shrink-0 px-6 flex items-center justify-between">
              <div className="flex gap-3">
                <button
                  disabled={!hasResult}
                  onClick={handleReDetect}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${hasResult ? 'bg-blue-50 text-blue-600 hover:bg-blue-100' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                >
                  <RefreshCw className={`w-4 h-4 ${isDetecting ? 'animate-spin' : ''}`} /> 重新检测
                </button>
                <button
                  disabled={!hasResult}
                  onClick={handleDownloadResult}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${hasResult ? 'border border-slate-200 text-slate-700 hover:bg-slate-50' : 'border border-slate-100 text-slate-300 cursor-not-allowed'}`}
                >
                  <Download className="w-4 h-4" /> 下载结果
                </button>
                <button
                  disabled={!hasResult}
                  onClick={handleExportReport}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${hasResult ? 'border border-slate-200 text-slate-700 hover:bg-slate-50' : 'border border-slate-100 text-slate-300 cursor-not-allowed'}`}
                >
                  <FileText className="w-4 h-4" /> 导出报告
                </button>
              </div>

              <div className="flex gap-3">
                <button disabled={!hasResult} className={`p-2 rounded-xl transition-all ${hasResult ? 'text-slate-500 hover:bg-slate-100' : 'text-slate-300 cursor-not-allowed'}`}>
                  <Share2 className="w-5 h-5" />
                </button>
                <button disabled={!image} onClick={handleClear} className={`p-2 rounded-xl transition-all ${image ? 'text-red-500 hover:bg-red-50' : 'text-slate-300 cursor-not-allowed'}`}>
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </main>

        {renderRightSidebar()}
      </div>

      {/* Fullscreen Modal: 高精度全屏排查模式 */}
      {isFullscreen && image && (
        <div className="fixed inset-0 bg-slate-950 z-[9999] flex flex-col p-6 animate-in fade-in duration-200">
          <div className="flex justify-between items-center text-white mb-4 shrink-0">
            <div>
              <h3 className="text-base font-bold flex items-center gap-2">
                <Camera className="w-5 h-5 text-blue-500" /> 全屏高精识别视窗
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">高精度图像特征细节排查模式</p>
            </div>
            <button
              onClick={() => setIsFullscreen(false)}
              className="bg-white/10 hover:bg-white/20 p-2.5 rounded-xl transition-all text-white active:scale-95 flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 relative bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden flex items-center justify-center">
            <img
              ref={fullscreenImageRef}
              src={image}
              alt="Fullscreen Inspection"
              className="max-w-full max-h-full object-contain"
              onLoad={(e) => {
                const el = e.currentTarget;
                setFullscreenImageDimensions({ w: el.naturalWidth, h: el.naturalHeight });
              }}
            />

            {/* Fullscreen Bounding Boxes */}
            {activeMode === 'SPECIALIZED' && hasResult && advSettings.showBox && detectionResults.length > 0 && fullscreenImageDimensions && fullscreenImageRef.current && (() => {
              const imgEl = fullscreenImageRef.current;
              const displayW = imgEl.clientWidth;
              const displayH = imgEl.clientHeight;
              const scaleX = displayW / fullscreenImageDimensions.w;
              const scaleY = displayH / fullscreenImageDimensions.h;
              const container = imgEl.parentElement!;
              const offsetX = (container.clientWidth - displayW) / 2;
              const offsetY = (container.clientHeight - displayH) / 2;

              return (
                <div className="absolute inset-0 pointer-events-none">
                  {detectionResults.map((r) => {
                    const l = r.location;
                    const boxLeft = offsetX + l.left * scaleX;
                    const boxTop = offsetY + l.top * scaleY;
                    const boxW = l.width * scaleX;
                    const boxH = l.height * scaleY;

                    const isDanger = r.status === 'danger';
                    const isSafe = r.status === 'safe';
                    const isWarning = r.status === 'warning';
                    const color = isDanger ? 'rgb(239,68,68)' : isSafe ? 'rgb(34,197,94)' : isWarning ? 'rgb(249,115,22)' : 'rgb(234,179,8)';
                    const glowColor = isDanger ? 'rgba(239,68,68,0.5)' : isSafe ? 'rgba(34,197,94,0.3)' : isWarning ? 'rgba(249,115,22,0.3)' : 'rgba(234,179,8,0.3)';
                    const bgColor = isDanger ? 'rgba(239,68,68,0.08)' : isSafe ? 'rgba(34,197,94,0.08)' : isWarning ? 'rgba(249,115,22,0.08)' : 'rgba(234,179,8,0.08)';
                    return (
                      <div key={r.id} className="absolute" style={{
                        left: boxLeft, top: boxTop, width: boxW, height: boxH,
                        border: `3px solid ${color}`,
                        backgroundColor: bgColor,
                        boxShadow: `0 0 20px ${glowColor}`,
                      }}>
                        {advSettings.showLabel && (
                          <div className="absolute -top-8 left-0 text-white text-[13px] font-bold px-2 py-1.5 whitespace-nowrap shadow-md rounded-t-md" style={{ backgroundColor: color }}>
                            {r.label} {Math.round(r.confidence * 100)}%
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};

export default HazardDetectionModule;
