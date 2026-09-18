import React, { useState, useEffect } from 'react';
import {
  FileText, Copy, FileDown, Loader2, Sparkles, Clock, Trash2, CheckCircle2, AlertCircle, RefreshCw
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { sysAlert } from '../utils/dialog';

const DOC_CATEGORIES = [
  {
    name: '行政与常规文书',
    focus: '侧重：标准格式、正式行文、排版',
    coverage: '涵盖范围：公文、会议纪要、总结、汇报、方案。',
    placeholder: "支持粘贴语音转写或群聊记录。例如：'今天上午张总拉了个会，主要是说仓库系统太卡了。前端小李说今晚加班加个索引，明天发个补丁看看...'"
  },
  {
    name: '生产与安全分析报告',
    focus: '侧重：数据总结、逻辑推理、趋势分析',
    coverage: '涵盖范围：生产日报/周报/月报、安全分析报告、整改报告。',
    placeholder: "请直接描述现场情况或异常经过。例如：'1号冲压机下午两点突然报E02故障停机了，废了七八十个料，机修工说定位销断了，最快下午三点修好...'"
  },
  {
    name: '结构化台账与表单记录',
    focus: '侧重：信息抽取、结构化输出、严谨不遗漏',
    coverage: '涵盖范围：通用台账、检查记录、车辆台账、维保记录、里程油耗、安全检查记录、调度日志。',
    placeholder: "一句话录入台账，不用管格式。例如：'小陈今天早上开苏B88998去无锡送货，出发里程12万5，回来跑了160公里，加了400块钱油...'"
  },
  {
    name: '业务SOP与流程指引',
    focus: '侧重：步骤清晰、逻辑分支、交互式引导',
    coverage: '涵盖范围：审批、报销、采购、检修、培训等一步一指引。',
    placeholder: "请描述业务规则或审批条件。例如：'以后车间买配件，500块以内的自己垫钱找班长签字；超过500的必须在系统提单找主任批...'"
  },
  {
    name: '智能核算引擎',
    focus: '侧重：数学计算、规则匹配、公式应用',
    coverage: '涵盖范围：考勤、薪酬、产量、隐患整改率自动核算。',
    placeholder: "请输入需要核算的数据或报数记录。例如：'算下张三今天的工资，他装了200个齿轮（1块5一个），但是有10个不合格要扣5块，另外今天迟到扣20...'"
  }
];

const DOC_TYPES = DOC_CATEGORIES.map(c => c.name);

interface HistoryItem {
  id: string;
  name: string;
  time: string;
  type: string;
  content: string;
  query?: string;
}

export const DocDrafting: React.FC = () => {
  const [selectedType, setSelectedType] = useState<string>(DOC_TYPES[0]);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // 存放当前生成的结果
  const [currentResult, setCurrentResult] = useState<string>('');

  // 右侧历史展示状态
  const [historyList, setHistoryList] = useState<HistoryItem[]>([]);

  // 1. 初次加载拉取历史
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const token = localStorage.getItem('blue_os_token')?.trim().replace(/^["']|["']$/g, '');
        const res = await fetch('/api/doc-drafting/history', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
          setHistoryList(data.history);
        }
      } catch (err) {
        console.error('获取文档历史失败', err);
      }
    };
    fetchHistory();
  }, []);

  const handleClear = () => {
    setInputText('');
    setCurrentResult('');
  };

  const handleGenerate = async () => {
    if (!inputText.trim()) {
      sysAlert('请先填写文档基本信息！');
      return;
    }

    setIsGenerating(true);
    setCurrentResult('');

    try {
      const token = localStorage.getItem('blue_os_token')?.trim().replace(/^["']|["']$/g, '');
      const res = await fetch('/api/doc-drafting/generate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: inputText,
          doc_type: selectedType
        })
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.message || data.error || 'Dify 接口调用失败');
      }

      setCurrentResult(data.result);

      // 保存至数据库并更新列表
      try {
        const saveRes = await fetch('/api/doc-drafting/history/save', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: `${selectedType} - 草案`,
            doc_type: selectedType,
            query: inputText,
            content: data.result
          })
        });
        const saveData = await saveRes.json();
        if (saveData.success) {
          setHistoryList(prev => [saveData.item, ...prev]);
        } else {
          console.error('保存历史失败: ', saveData.error || saveData.message);
          sysAlert('文档生成完成，但在保存历史记录时出错了。您刚才重启过后端服务了吗？');
        }
      } catch (err) {
        console.error('保存历史异常', err);
        sysAlert('保存历史记录时发生异常，请检查后端状态。');
      }

      sysAlert('文档生成成功');
      window.dispatchEvent(new CustomEvent('app-task-done', { detail: { appId: 'doccopywriting' } }));
    } catch (err: any) {
      console.error('[Generate Error]', err);
      sysAlert(`生成失败: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
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
    // Avoid scrolling to bottom
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

  const handleExport = async () => {
    if (!currentResult || isExporting) return;

    setIsExporting(true);
    try {
      const token = localStorage.getItem('blue_os_token')?.trim().replace(/^["']|["']$/g, '');
      const res = await fetch('/api/meeting-minutes/export', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          minutes: currentResult,
          filename: `${selectedType}.docx`
        })
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.message || '导出失败');
      }

      // 触发下载
      const downloadName = data.filename || `${selectedType}.docx`;
      const proxyUrl = `/api/meeting-minutes/download-proxy?url=${encodeURIComponent(data.downloadUrl)}&filename=${encodeURIComponent(downloadName)}`;

      const downloadRes = await fetch(proxyUrl, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!downloadRes.ok) throw new Error('下载文件失败，请重试');

      const blob = await downloadRes.blob();
      const blobUrl = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

      sysAlert('导出成功，请在浏览器下载栏查看');
    } catch (err: any) {
      console.error('[Export Error]', err);
      sysAlert(`导出失败: ${err.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeleteHistory = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const token = localStorage.getItem('blue_os_token')?.trim().replace(/^["']|["']$/g, '');
      const res = await fetch(`/api/doc-drafting/history/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setHistoryList(prev => prev.filter(item => item.id !== id));
      } else {
        sysAlert('删除失败');

      }
    } catch (err) {
      console.error('删除历史记录失败', err);
    }
  };

  const handleTestCase = () => {
    switch (selectedType) {
      case '行政与常规文书':
        setInputText(`张总：喂喂，能听到吧？那个...今天赶紧过一下，就是库房那边一直吐槽说咱们这WMS系统出库太慢了，怎么回事啊？\n李产品：张总，是这样，扫码枪那个硬件老是掉线，加上网络有延迟，所以他们感觉慢。\n王开发：我插一句啊，其实也不全是硬件问题。之前出库那个接口，查数据库的时候没加索引，并发一高就卡死了。\n张总：哎哟那你们这设计太坑了！赶紧弄啊！这周能不能搞定？\n王开发：我今晚加班把索引加上，明天先发个热更看看。\n张总：行，王工你明天务必弄好。硬件那边，李产品你去找采购再去买两把新的测试一下。散会散会！`);
        break;
      case '生产与安全分析报告':
        setInputText(`操作工老赵 (10:05): 班长，那个...冲压机停了啊，一直亮红灯报E02。\n刘班长 (10:07): 啥情况？废了多少料？\n操作工老赵 (10:08): 废了得有七八十个吧，边上全变形了。本来要打三千的，现在才干了一千五。\n机修工小孙 (10:20): 我刚去看过了，里面那个定位销断了，卡在模具里了。\n刘班长 (10:22): 多久能修好？耽误交期要扣钱的！\n机修工小孙 (10:25): 库房没这个型号的销子了，得让采购去买，最快也得下午三点了。\n刘班长 (10:26): 哎，那下午三点前这机器只能放着了，老赵你去三号机帮忙吧。晚上我再写个单子让采购多备点销子。`);
        break;
      case '结构化台账与表单记录':
        setInputText(`呃，队长，我是小陈啊。我今天早上八点开那个苏B88998的厢货出门了，去那个...对，去无锡的厂区送了点模具。出门的时候我看表是十二万五千公里整。回来刚停好车，现在表上是十二万五千一百六十。呃，路上加油花了四百，发票拿了，没过路费，走的地道。这车左边后视镜有点松了，明天找人修修。`);
        break;
      case '业务SOP与流程指引':
        setInputText(`大家注意一下啊，以后买东西别瞎买。买车间用的东西，比如手套啊机油啥的，只要五百块钱以内的，你们自己垫钱买了，拿小票找班长签个字就行，月底统一报销。但是啊，要是超过五百块，不管买啥，必须先在钉钉上提个“采购申请单”，选我审批。要是那种修机器的大件，超过五千块的，光我批还不行，我还得转给王厂长批，批下来了才能让采购部去买。记住了没？`);
        break;
      case '智能核算引擎':
        setInputText(`那个算一下张三今天的工资哈。张三今天装了200个那个齿轮，这个是一块五一个的。另外还搞了50个轴承，轴承贵点，算三块钱一个。但是质检刚才跟我说，张三装的齿轮里头有10个是不合格的，按规矩，一个不合格得扣五块钱。哦对了，他中午饭卡没带，我拿车间备用金帮他充了30块钱，这个得从他今天工资里扣掉哈。`);
        break;
      default:
        break;
    }
  };

  return (
    <div className="flex flex-row h-full w-full gap-4 p-4 bg-slate-50/50 overflow-hidden font-sans">

      {/* ===================== 左侧：文档类型选择区 ===================== */}
      <div className="flex-[1.2] min-w-[220px] max-w-[280px] h-full flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4 text-blue-500" />
          </div>
          <h3 className="text-base font-bold text-slate-800">文档类型选择</h3>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {DOC_CATEGORIES.map(category => {
            const type = category.name;
            const isSelected = selectedType === type;
            return (
              <div
                key={type}
                onClick={() => {
                  setSelectedType(type);
                  handleClear();
                }}
                className={`flex flex-col gap-2 p-4 rounded-xl border-2 transition-all cursor-pointer ${isSelected ? 'border-blue-500 bg-blue-50/50 shadow-sm' : 'border-transparent bg-slate-50 hover:bg-slate-100 hover:border-slate-200'
                  }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'border-blue-500' : 'border-slate-300'
                    }`}>
                    {isSelected && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                  </div>
                  <span className={`text-sm font-medium ${isSelected ? 'text-blue-700 font-bold' : 'text-slate-600'}`}>
                    {type}
                  </span>
                </div>
                {isSelected && (
                  <div className="ml-7 text-[11px] leading-relaxed text-slate-500 animate-in fade-in slide-in-from-top-1">
                    <div className="text-blue-600/80 mb-1">{category.focus}</div>
                    <div className="opacity-80">{category.coverage}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ===================== 中间：信息输入 + 生成预览区 ===================== */}
      <div className="flex-[3] min-w-[400px] h-full flex flex-col gap-4 overflow-hidden">

        {/* 上方：信息输入区 */}
        <div className="flex-none bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-500" />
              请填写文档基本信息
            </h3>
          </div>
          <div className="p-5">
            <textarea
              className="w-full min-h-[160px] max-h-[300px] p-4 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all text-sm text-slate-700 resize-y leading-relaxed"
              placeholder={DOC_CATEGORIES.find(c => c.name === selectedType)?.placeholder || '请输入内容...'}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />
          </div>

          <div className="p-4 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between shrink-0 rounded-b-2xl">
            <button
              onClick={handleTestCase}
              className="px-4 py-1.5 text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              测试用例
            </button>
            <div className="flex gap-3">
              <button
                onClick={handleClear}
                className="px-5 py-2 text-sm font-bold text-slate-500 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:text-slate-700 shadow-sm transition-all"
              >
                清空内容
              </button>
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="px-6 py-2 bg-blue-500 text-white text-sm font-bold rounded-xl hover:bg-blue-600 shadow-md shadow-blue-500/20 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> 生成中...</>
                ) : (
                  "生成文档"
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 下方：结果展示区 */}
        <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              生成结果预览
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleCopy(currentResult)}
                disabled={!currentResult || isGenerating}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 rounded-lg text-xs font-bold text-slate-600 border border-slate-200 shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-40"
              >
                <Copy className="w-3.5 h-3.5" /> 复制全文
              </button>
              <button
                onClick={handleExport}
                disabled={!currentResult || isGenerating || isExporting}
                className="px-3 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-bold shadow-sm hover:bg-slate-900 transition-colors flex items-center gap-1.5 disabled:opacity-40"
              >
                {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                {isExporting ? '处理中...' : '导出 docx'}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-8 bg-slate-50/30">
            {isGenerating ? (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-400">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                <p className="font-medium animate-pulse">正在连接AI模型撰写文档...</p>
              </div>
            ) : currentResult ? (
              <div className="prose prose-slate prose-sm max-w-none prose-headings:text-slate-800 prose-headings:font-black prose-p:text-slate-600 prose-strong:text-blue-600 prose-table:border prose-table:rounded-xl overflow-hidden bg-white p-6 shadow-sm border border-slate-100 rounded-2xl">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {currentResult}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-4 opacity-70">
                <AlertCircle className="w-12 h-12 stroke-1" />
                <p className="text-sm font-medium">请在上文输入信息并点击生成</p>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* ===================== 右侧：历史记录区 ===================== */}
      <div className="flex-[1.2] min-w-[200px] max-w-[280px] h-full flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-500" />
            历史文档
          </h3>
          <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-bold">
            {historyList.filter(item => item.type === selectedType).length}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {historyList.filter(item => item.type === selectedType).map(item => (
            <div
              key={item.id}
              onClick={() => {
                setCurrentResult(item.content);
                setSelectedType(item.type);
                setInputText(item.query || '未记录原始输入');
              }}
              className="p-4 rounded-xl border border-slate-100 bg-slate-50 hover:bg-white hover:border-blue-200 hover:shadow-sm transition-all cursor-pointer group flex flex-col gap-2"
            >
              <div className="flex justify-between items-start">
                <span className="text-[10px] font-bold text-blue-600 bg-blue-100/50 px-2 py-0.5 rounded-md border border-blue-200/50">
                  {item.type}
                </span>
                <button
                  onClick={(e) => handleDeleteHistory(e, item.id)}
                  className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <h4 className="text-sm font-bold text-slate-700 leading-snug line-clamp-2 group-hover:text-blue-700 transition-colors">
                {item.name}
              </h4>
              {item.query && (
                <p className="text-xs text-slate-500 line-clamp-2 bg-slate-100/50 p-2 rounded-lg border border-slate-100">
                  {item.query}
                </p>
              )}
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-medium mt-1">
                <Clock className="w-3 h-3" /> {item.time}
              </div>
            </div>
          ))}

          {historyList.filter(item => item.type === selectedType).length === 0 && (
            <div className="h-full flex flex-col items-center justify-center py-20 opacity-40">
              <FileText className="w-10 h-10 mb-3" />
              <p className="text-xs font-bold text-slate-400">暂无历史记录</p>
            </div>
          )}
        </div>

      </div>

    </div>
  );
};
