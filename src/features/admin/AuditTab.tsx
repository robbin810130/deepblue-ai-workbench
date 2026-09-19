/**
 * 管理后台 · 审计日志页签
 *
 *   GET /api/admin/audit-logs?username=&module=&action=&page=&pageSize=
 *   （admin 或拥有 auditlog 模块权限的角色可访问）
 *
 * 展示「谁在何时做了什么」：无论成功失败都留痕，失败行以红色标注。
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../components/ui/cn';
import { api, type AuditLog } from '../../api/client';
import { Banner, Panel, SubButton, errText, fmtDateTime } from './ui';

const PAGE_SIZE = 30;

export function AuditTab() {
  const [list, setList] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [username, setUsername] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [module, setModule] = useState('');
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.admin
      .auditLogs({ username, module, action, page, pageSize: PAGE_SIZE })
      .then((r) => {
        setList(r.list || []);
        setTotal(r.total || 0);
      })
      .catch((e) => {
        setList([]);
        setError(errText(e));
      })
      .finally(() => setLoading(false));
  }, [username, module, action, page]);

  useEffect(load, [load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Panel
      title="审计日志"
      hint={`共 ${total} 条记录；所有写操作（账号、角色、权限、配置、看板）均在此留痕。`}
      actions={
        <>
          <input
            value={module}
            onChange={(e) => {
              setModule(e.target.value.trim());
              setPage(1);
            }}
            placeholder="模块，如 USER_MANAGE"
            aria-label="按模块筛选"
            className="h-8 w-44 rounded-lg border border-line bg-page px-2 text-caption text-ink placeholder:text-ink-faint focus:border-primary-300 focus:outline-none"
          />
          <input
            value={action}
            onChange={(e) => {
              setAction(e.target.value.trim());
              setPage(1);
            }}
            placeholder="动作，如 UPDATE_USER"
            aria-label="按动作筛选"
            className="h-8 w-44 rounded-lg border border-line bg-page px-2 text-caption text-ink placeholder:text-ink-faint focus:border-primary-300 focus:outline-none"
          />
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setUsername(usernameInput.trim());
                  setPage(1);
                }
              }}
              placeholder="操作人…"
              aria-label="按操作人筛选"
              className="h-8 w-36 rounded-lg border border-line bg-page pl-7 pr-2 text-caption text-ink placeholder:text-ink-faint focus:border-primary-300 focus:outline-none"
            />
          </div>
        </>
      }
    >
      {error && <Banner tone="error" onClose={() => setError(null)}>{error}</Banner>}

      {loading && <p className="py-8 text-center text-caption text-ink-faint">加载中…</p>}

      {!loading && list.length === 0 && (
        <p className="py-8 text-center text-caption text-ink-faint">没有匹配的审计记录。</p>
      )}

      {!loading && list.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line bg-page text-caption text-ink-faint">
                <th className="px-4 py-2.5 font-medium">时间</th>
                <th className="px-3 py-2.5 font-medium">操作人</th>
                <th className="px-3 py-2.5 font-medium">模块 / 动作</th>
                <th className="px-3 py-2.5 font-medium">对象</th>
                <th className="px-3 py-2.5 font-medium">IP</th>
                <th className="px-4 py-2.5 text-right font-medium">详情</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const failed = typeof r.status === 'string' && r.status.toLowerCase() !== 'success' && r.status !== '';
                return (
                  <Fragment key={r.id}>
                    <tr className={cn('border-b border-line/50 hover:bg-page', failed && 'bg-danger-soft/40')}>
                      <td className="px-4 py-2.5 whitespace-nowrap text-caption text-ink-faint">
                        {fmtDateTime(r.created_at)}
                      </td>
                      <td className="px-3 py-2.5 text-caption text-ink-soft">{r.username || '—'}</td>
                      <td className="px-3 py-2.5">
                        <span className="text-caption text-ink">{r.module}</span>
                        <span className="mx-1 text-ink-faint">/</span>
                        <span className={cn('text-caption', failed ? 'text-danger' : 'text-ink-soft')}>{r.action}</span>
                      </td>
                      <td className="px-3 py-2.5 max-w-[220px] truncate text-caption text-ink-soft">
                        {r.target_data || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-caption text-ink-faint">{r.ip_address || '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        {r.details ? (
                          <SubButton onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                            {expanded === r.id ? '收起' : '查看'}
                          </SubButton>
                        ) : (
                          <span className="text-caption text-ink-faint">—</span>
                        )}
                      </td>
                    </tr>
                    {expanded === r.id && r.details && (
                      <tr className="border-b border-line/50 bg-page">
                        <td colSpan={6} className="px-4 py-3">
                          <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
                            {JSON.stringify(r.details, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-caption text-ink-soft">
          <span>
            第 {page} / {pages} 页
          </span>
          <span className="flex items-center gap-2">
            <SubButton onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</SubButton>
            <SubButton onClick={() => setPage((p) => Math.min(pages, p + 1))}>下一页</SubButton>
          </span>
        </div>
      )}
    </Panel>
  );
}
