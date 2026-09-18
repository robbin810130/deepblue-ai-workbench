import React, { useState, useEffect } from 'react';
import { 
  ClipboardList, Search, RefreshCw, User, Box, 
  Clock, ShieldAlert, ChevronLeft, ChevronRight, Eye
} from 'lucide-react';
import { fetchWithAuth } from '../utils/authFetch';

interface AuditLog {
  id: number;
  user_id: number;
  username: string;
  module: string;
  action: string;
  target_data: string;
  details: string;
  status: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
}

// 模块中文映射表
const MODULE_MAP: Record<string, string> = {
  'AUTH': '账号认证',
  'USER_MANAGE': '用户管理',
  'ROLE_MANAGE': '角色管理',
  'PROFILE': '个人中心',
  'MARKET_INSIGHT': '市场洞察',
  'PREDICTION': '营销预测',
  'CUSTOMER_ANALYSIS': '客户分析',
  'AI_IMAGE': '电商生图',
  'RULES_ASSISTANT': '知识库',
  'DAILY_NEWS': '每日推送',
  'LAYOUT_COMPARE': '版式对比',
  'CONTRACT_AUDIT': '合同审核',
  'SEA_MARKETING': '出海营销',
  'BEAUTY_RND': '美妆配方',
  'ORDER_RECOGNITION': '订单识别',
  'RISK_DETECTION': '风险检测',
  'SYSTEM_CONFIG': '系统配置',
  'FILE_MANAGE': '文件管理',
  'QUALIFICATION': '资质审核'
};

// 行为中文映射表
const ACTION_MAP: Record<string, string> = {
  'LOGIN_SUCCESS': '登录成功',
  'LOGIN_FAIL': '登录失败',
  'LOGOUT': '退出登录',
  'CREATE_USER': '创建用户',
  'UPDATE_USER': '更新用户',
  'DELETE_USER': '删除用户',
  'RUN_ANALYSIS': '运行智能分析',
  'RUN_CHATFLOW': '运行对话流',
  'RUN_SUGGESTION': '生成建议',
  'GENERATE_REPORT': '生成研发报告',
  'GENERATE_CONTENT': '生成营销内容',
  'RUN_ECOM_RISK': '运行电商风险检测',
  'ECOM_UPLOAD_FILE': '上传电商检测文件',
  'RUN_RND_RISK': '运行研发风险检测',
  'RND_UPLOAD_FILE': '上传研发检测文件',
  'RUN_AUDIT': '运行合同审核',
  'UPLOAD_FILE': '上传文件',
  'DOWNLOAD_FILE': '下载文件',
  'UPDATE_CONFIG': '更新系统配置',
  'REFRESH_TOKEN': '刷新令牌',
  'DELETE_KEYWORD': '删除关键词',
  'ADD_KEYWORD': '添加关键词',
  'RUN_PREDICTION': '运行销量预测',
  'RUN_LAYOUT': '运行版式对比',
  'RUN_COMPARE': '运行版式对比',
  'RUN_INQUIRY': '运行物料询价',
  'FETCH_NEWS': '获取行业资讯',
  'GENERATE_FORECAST': '生成营销预测',
  'UPDATE_DATA': '更新同步数据',
  'GENERATE': 'AI 智能生成',
  'ANALYZE': '行业深度解析',
  'GENERATE_BASELINE': '生成预测基准',
  'TRACK_DEVIATION': '追踪预测偏差',
  'CHAT': '知识库智能问答',
  'SMART_MATCH': '研发智能匹配',
  'UPDATE_AI_FIELD': '修改 AI 配置项',
  'RUN_EXTRACT': '运行资质提取'
};

const AuditLogModule: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  
  // 筛选条件
  const [username, setUsername] = useState('');
  const [users, setUsers] = useState<{username: string, display_name: string}[]>([]);
  const [module, setModule] = useState('');
  
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const fetchUsersList = async () => {
    try {
      const res = await fetchWithAuth('/api/admin/users/minimal');
      const data = await res.json();
      if (data.success) {
        setUsers(data.data);
      }
    } catch (err) {
      console.error('Fetch users failed', err);
    }
  };

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        username,
        module,
        page: page.toString(),
        pageSize: pageSize.toString()
      });
      const res = await fetchWithAuth(`/api/admin/audit-logs?${query.toString()}`);
      const data = await res.json();
      if (data.success) {
        setLogs(data.data.list);
        setTotal(data.data.total);
      }
    } catch (err) {
      console.error('Fetch audit logs failed', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsersList();
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [page, pageSize]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchLogs();
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  };

  const parseJSON = (str: string) => {
    try {
      return JSON.parse(str);
    } catch (e) {
      return str;
    }
  };

  const translate = (val: string, map: Record<string, string>) => {
    return map[val] || val;
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* 顶部标题与搜索栏 */}
      <div className="p-4 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400">
            <ClipboardList className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100">系统操作日志</h2>
            <p className="text-xs text-slate-400">记录系统关键操作行为与 AI 智能体使用情况，保障全链路可追溯性</p>
          </div>
        </div>

        <form onSubmit={handleSearch} className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 ml-1">操作账号</label>
            <div className="relative group">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
              <select 
                className="pl-9 pr-8 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-indigo-500 appearance-none min-w-[160px]"
                value={username}
                onChange={e => setUsername(e.target.value)}
              >
                <option value="">全部账号</option>
                {users.map(u => (
                  <option key={u.username} value={u.username}>
                    {u.display_name ? `${u.display_name} (@${u.username})` : u.username}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 ml-1">所属模块</label>
            <div className="relative group">
              <Box className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
              <select 
                className="pl-9 pr-8 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-indigo-500 appearance-none min-w-[140px]"
                value={module}
                onChange={e => setModule(e.target.value)}
              >
                <option value="">全部模块</option>
                <option value="AUTH">账号认证</option>
                <option value="USER_MANAGE">用户管理</option>
                <option value="ROLE_MANAGE">角色管理</option>
                <option value="PROFILE">个人中心</option>
                <option value="MARKET_INSIGHT">市场洞察</option>
                <option value="PREDICTION">营销预测</option>
                <option value="CUSTOMER_ANALYSIS">客户分析</option>
                <option value="AI_IMAGE">电商生图</option>
                <option value="RULES_ASSISTANT">知识库</option>
                <option value="DAILY_NEWS">每日推送</option>
                <option value="LAYOUT_COMPARE">版式对比</option>
                <option value="CONTRACT_AUDIT">合同审核</option>
                <option value="SEA_MARKETING">出海营销</option>
                <option value="BEAUTY_RND">美妆配方</option>
                <option value="ORDER_RECOGNITION">订单识别</option>
                <option value="RISK_DETECTION">风险检测</option>
                <option value="QUALIFICATION">资质审核</option>
              </select>
            </div>
          </div>

          <button 
            type="submit"
            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
          >
            <Search className="w-4 h-4" />
            查询
          </button>
          
          <button 
            type="button"
            onClick={fetchLogs}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </form>
      </div>

      {/* 表格区域 */}
      <div className="flex-1 overflow-auto relative custom-scrollbar">
        {loading && logs.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/50">
            <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-slate-900/80 sticky top-0 border-b border-slate-800 text-slate-400 font-medium z-10">
              <tr>
                <th className="px-4 py-3 font-semibold w-16">ID</th>
                <th className="px-4 py-3 font-semibold">账号</th>
                <th className="px-4 py-3 font-semibold">模块</th>
                <th className="px-4 py-3 font-semibold">行为</th>
                <th className="px-4 py-3 font-semibold">目标</th>
                <th className="px-4 py-3 font-semibold w-48">执行时间</th>
                <th className="px-4 py-3 font-semibold w-20">详情</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-900/40 transition-colors group">
                  <td className="px-4 py-3.5 text-slate-500 font-mono text-xs">{log.id}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-[10px] text-indigo-400 border border-slate-700">
                        {log.username.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium text-slate-200">{log.username}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded text-[10px] border border-slate-700">
                      {translate(log.module, MODULE_MAP)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`font-mono text-xs ${
                      log.action.includes('FAIL') || log.action.includes('DELETE') ? 'text-rose-400' : 
                      log.action.includes('CREATE') || log.action.includes('LOGIN_SUCCESS') ? 'text-emerald-400' : 
                      'text-indigo-400'
                    }`}>
                      {translate(log.action, ACTION_MAP)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-slate-400 font-mono text-xs truncate max-w-[150px]">
                    {log.target_data || '-'}
                  </td>
                  <td className="px-4 py-3.5 text-slate-400 text-xs">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-600" />
                      {formatDate(log.created_at)}
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <button 
                      onClick={() => setSelectedLog(log)}
                      className="p-1.5 text-slate-500 hover:text-indigo-400 bg-transparent hover:bg-indigo-500/10 rounded-md transition-all"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && logs.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-20 text-center text-slate-500 italic">
                    暂无符合条件的审计日志内容
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* 分页功能 */}
      <div className="p-3 border-t border-slate-800 bg-slate-900/50 flex items-center justify-between">
        <span className="text-xs text-slate-500">共 {total} 条记录</span>
        <div className="flex items-center gap-2">
          <button 
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
            className="p-1.5 bg-slate-800 border border-slate-700 rounded-md disabled:opacity-30 transition-all hover:bg-slate-700 active:scale-95"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-slate-300 min-w-[60px] text-center">第 {page} 页</span>
          <button 
            disabled={page * pageSize >= total}
            onClick={() => setPage(p => p + 1)}
            className="p-1.5 bg-slate-800 border border-slate-700 rounded-md disabled:opacity-30 transition-all hover:bg-slate-700 active:scale-95"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 详情弹窗 */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200 shadow-indigo-500/10">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80 sticky top-0">
              <div className="flex items-center gap-2 text-indigo-400">
                <ShieldAlert className="w-5 h-5" />
                <h3 className="font-bold text-slate-100">操作详情 #{selectedLog.id}</h3>
              </div>
              <button 
                onClick={() => setSelectedLog(null)}
                className="text-slate-500 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>
            
            <div className="p-6 overflow-auto space-y-6 custom-scrollbar">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                  <span className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1">操作账号</span>
                  <p className="text-sm text-slate-100">{selectedLog.username} (ID: {selectedLog.user_id || 'N/A'})</p>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                  <span className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1">执行状态</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${selectedLog.status === 'SUCCESS' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/20 text-rose-400 border border-rose-500/20'}`}>
                    {selectedLog.status}
                  </span>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                  <span className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1">来源 IP</span>
                  <p className="text-sm text-slate-100 font-mono">{selectedLog.ip_address || 'Unknown'}</p>
                </div>
                <div className="bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                  <span className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1">操作时间</span>
                  <p className="text-sm text-slate-100">{formatDate(selectedLog.created_at)}</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block ml-1">详细参数 (Payload)</span>
                <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 font-mono text-xs overflow-auto max-h-48 text-indigo-300">
                  <pre>{JSON.stringify(parseJSON(selectedLog.details), null, 2)}</pre>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block ml-1">浏览器 User Agent</span>
                <div className="bg-slate-800/30 p-3 rounded-lg border border-slate-700/50 text-xs text-slate-400 italic">
                  {selectedLog.user_agent}
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-900 border-t border-slate-800 text-right">
              <button 
                onClick={() => setSelectedLog(null)}
                className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-all"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditLogModule;
