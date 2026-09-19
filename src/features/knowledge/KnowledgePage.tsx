/**
 * 知识库 —— /knowledge
 *
 * 依据：06_前端页面详细PRD §7
 *   知识空间（数据集 + 权限） / 文档列表（上传、状态、更新时间、解析状态） /
 *   知识问答（选知识范围后问答，回答需显示来源引用）
 *
 * 数据源（全部为已上线的存量接口，不新增绕过路径）：
 *   GET    /api/knowledge/datasets          知识空间清单
 *   GET    /api/knowledge/list              文档列表（x-dataset-id）
 *   POST   /api/knowledge/upload            上传（multipart）
 *   GET    /api/knowledge/status/:id        解析状态轮询
 *   DELETE /api/knowledge/:id               删除
 *   GET    /api/knowledge/users             可授权用户
 *   POST   /api/knowledge/qa                知识问答（检索片段 + 出处引用）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, RefreshCw, Search, Send, Trash2, Upload } from 'lucide-react';
import { cn } from '../../components/ui/cn';
import {
  api,
  ApiError,
  type KnowledgeAnswer,
  type KnowledgeDataset,
  type KnowledgeDocument,
  type KnowledgeUser,
} from '../../api/client';

type TabKey = 'docs' | 'qa';

const PARSE_META: Record<string, { label: string; className: string; dot: string }> = {
  PENDING: { label: '待提交', className: 'bg-warning-soft text-warning', dot: 'bg-warning' },
  INDEXING: { label: '解析中', className: 'bg-primary-50 text-primary-600', dot: 'bg-primary-500' },
  COMPLETED: { label: '已就绪', className: 'bg-success-soft text-success', dot: 'bg-success' },
  FAILED: { label: '解析失败', className: 'bg-danger-soft text-danger', dot: 'bg-danger' },
};

function metaOf(status: string) {
  return PARSE_META[status] || { label: status || '未知', className: 'bg-surface-sunken text-ink-soft', dot: 'bg-ink-faint' };
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function errText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : '请求失败';
}

export function KnowledgePage() {
  const [datasets, setDatasets] = useState<KnowledgeDataset[] | null>(null);
  const [activeKey, setActiveKey] = useState('');
  const [tab, setTab] = useState<TabKey>('docs');

  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [users, setUsers] = useState<KnowledgeUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');

  const [uploading, setUploading] = useState(false);
  const [visibility, setVisibility] = useState<'PRIVATE' | 'PUBLIC'>('PRIVATE');
  const [granted, setGranted] = useState<string[]>([]);
  const [showGrant, setShowGrant] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<KnowledgeAnswer | null>(null);

  /* ── 知识空间 ── */
  useEffect(() => {
    api.knowledge
      .datasets()
      .then((list) => {
        setDatasets(list);
        if (list.length > 0) setActiveKey((prev) => prev || list[0].dataset_key);
      })
      .catch((e) => {
        setDatasets([]);
        setError(errText(e));
      });
  }, []);

  /* ── 文档列表 ── */
  const loadDocs = useCallback(
    (silent = false) => {
      if (!activeKey) return;
      if (!silent) setLoading(true);
      api.knowledge
        .documents(activeKey, q)
        .then(setDocs)
        .catch((e) => {
          setDocs([]);
          if (!silent) setError(errText(e));
        })
        .finally(() => setLoading(false));
    },
    [activeKey, q],
  );

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  useEffect(() => {
    api.knowledge
      .users()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  /* 有文档在解析中时自动轮询状态，避免用户手动刷 */
  useEffect(() => {
    const parsing = docs.filter((d) => d.parse_status === 'PENDING' || d.parse_status === 'INDEXING');
    if (parsing.length === 0) return;
    const timer = window.setInterval(async () => {
      const results = await Promise.all(
        parsing.map((d) =>
          api.knowledge
            .status(activeKey, d.id)
            .then((fresh) => ({ id: d.id, parse_status: fresh.parse_status }))
            .catch(() => null),
        ),
      );
      setDocs((prev) =>
        prev.map((d) => {
          const hit = results.find((r) => r && r.id === d.id);
          return hit ? { ...d, parse_status: hit.parse_status } : d;
        }),
      );
    }, 8000);
    return () => window.clearInterval(timer);
  }, [docs, activeKey]);

  const activeDataset = datasets?.find((d) => d.dataset_key === activeKey) || null;

  const doUpload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      for (const f of Array.from(list)) {
        await api.knowledge.upload(activeKey, f, visibility, visibility === 'PRIVATE' ? granted : []);
      }
      setNotice(`已上传 ${list.length} 个文件，正在解析索引（状态会自动刷新）。`);
      setGranted([]);
      loadDocs(true);
    } catch (e) {
      setError(errText(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const doDelete = async (id: string) => {
    setError(null);
    setNotice(null);
    try {
      await api.knowledge.remove(activeKey, id);
      setPendingDelete(null);
      setNotice('文档已删除。');
      loadDocs(true);
    } catch (e) {
      setError(errText(e));
    }
  };

  const ask = async () => {
    const questionText = question.trim();
    if (!questionText || asking) return;
    setAsking(true);
    setError(null);
    try {
      setAnswer(await api.knowledge.qa({ question: questionText, dataset_key: activeKey, top_k: 4 }));
    } catch (e) {
      setAnswer(null);
      setError(errText(e));
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1120px] px-8 py-7">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-title font-semibold text-ink">知识库</h1>
          <p className="mt-1 text-caption text-ink-soft">
            按知识空间组织企业资料，上传即索引；知识与技能共用同一份来源。
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadDocs()}
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-surface px-3.5 text-lead font-medium text-ink-soft transition-colors hover:text-ink"
        >
          <RefreshCw size={14} /> 刷新
        </button>
      </header>

      {/* 知识空间 */}
      <div className="mt-5 flex flex-wrap gap-2.5">
        {(datasets || []).map((d) => (
          <button
            key={d.dataset_key}
            type="button"
            onClick={() => setActiveKey(d.dataset_key)}
            className={cn(
              'flex min-w-[220px] flex-1 items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
              activeKey === d.dataset_key
                ? 'border-primary-300 bg-primary-50/60'
                : 'border-line bg-surface hover:border-primary-200',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                activeKey === d.dataset_key ? 'bg-primary-100 text-primary-600' : 'bg-surface-sunken text-ink-soft',
              )}
            >
              <BookOpen size={16} />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="truncate text-lead font-medium text-ink">{d.name}</span>
                <span className="shrink-0 text-[11px] text-ink-faint">{d.document_count} 篇</span>
              </span>
              {d.description && (
                <span className="mt-0.5 line-clamp-2 block text-caption leading-relaxed text-ink-soft">
                  {d.description}
                </span>
              )}
            </span>
          </button>
        ))}
        {datasets && datasets.length === 0 && (
          <p className="rounded-xl border border-dashed border-line bg-surface px-4 py-3 text-caption text-ink-soft">
            暂无知识空间。
          </p>
        )}
        {!datasets && <div className="h-[62px] flex-1 animate-pulse rounded-xl bg-surface-sunken" />}
      </div>

      {/* 二级页签 */}
      <div className="mt-5 flex items-center gap-1 border-b border-line">
        {([
          { key: 'docs' as TabKey, label: `文档列表${docs.length ? `（${docs.length}）` : ''}` },
          { key: 'qa' as TabKey, label: '知识问答' },
        ]).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-selected={tab === t.key}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-body font-medium transition-colors',
              tab === t.key
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-ink-soft hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-danger-soft px-4 py-2.5 text-caption text-danger">{error}</p>
      )}
      {notice && (
        <p className="mt-3 rounded-lg bg-success-soft px-4 py-2.5 text-caption text-success">{notice}</p>
      )}

      {/* ── 文档列表 ── */}
      {tab === 'docs' && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && setQ(qInput.trim())}
                onBlur={() => setQ(qInput.trim())}
                placeholder="搜索文件名…"
                aria-label="搜索文档"
                className="h-8 w-56 rounded-lg border border-line bg-surface pl-8 pr-2 text-caption text-ink placeholder:text-ink-faint focus:border-primary-300 focus:outline-none"
              />
            </div>

            <div className="ml-auto flex items-center gap-2">
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as 'PRIVATE' | 'PUBLIC')}
                aria-label="文档可见性"
                className="h-8 rounded-lg border border-line bg-surface px-2 text-caption text-ink-soft focus:border-primary-300 focus:outline-none"
              >
                <option value="PRIVATE">仅授权可见</option>
                <option value="PUBLIC">全员可见</option>
              </select>
              {visibility === 'PRIVATE' && (
                <button
                  type="button"
                  onClick={() => setShowGrant((v) => !v)}
                  className={cn(
                    'h-8 rounded-lg px-3 text-caption font-medium transition-colors',
                    granted.length > 0 ? 'bg-primary-50 text-primary-600' : 'bg-surface text-ink-soft hover:text-ink',
                  )}
                >
                  授权 {granted.length > 0 ? `(${granted.length})` : ''}
                </button>
              )}
              <button
                type="button"
                disabled={uploading || !activeKey}
                onClick={() => fileRef.current?.click()}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-caption font-medium transition-colors',
                  uploading || !activeKey
                    ? 'cursor-not-allowed bg-surface-sunken text-ink-faint'
                    : 'bg-primary-600 text-white hover:bg-primary-700',
                )}
              >
                <Upload size={13} /> {uploading ? '上传中…' : '上传文档'}
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => doUpload(e.target.files)}
              />
            </div>
          </div>

          {showGrant && (
            <div className="mt-3 rounded-xl border border-line bg-surface px-4 py-3">
              <p className="text-caption font-medium text-ink">
                授权给以下账号（不选则仅自己可见）
              </p>
              <div className="mt-2 flex max-h-[132px] flex-wrap gap-1.5 overflow-y-auto">
                {users.map((u) => {
                  const on = granted.includes(u.username);
                  return (
                    <button
                      key={u.username}
                      type="button"
                      onClick={() =>
                        setGranted((prev) => (on ? prev.filter((x) => x !== u.username) : [...prev, u.username]))
                      }
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-caption transition-colors',
                        on
                          ? 'border-primary-300 bg-primary-50 text-primary-600'
                          : 'border-line bg-page text-ink-soft hover:border-primary-200',
                      )}
                    >
                      {u.display_name || u.username}
                      {u.role_display_name && <span className="ml-1 text-ink-faint">{u.role_display_name}</span>}
                    </button>
                  );
                })}
                {users.length === 0 && <span className="text-caption text-ink-faint">暂无可授权账号。</span>}
              </div>
            </div>
          )}

          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-surface">
            {loading && <p className="px-5 py-10 text-center text-caption text-ink-faint">加载中…</p>}
            {!loading && docs.length === 0 && (
              <div className="px-5 py-12 text-center">
                <p className="text-lead text-ink-soft">这个知识空间还没有文档</p>
                <p className="mt-1 text-caption text-ink-faint">上传 PDF / Word / 文本，系统会自动切片并建立索引。</p>
              </div>
            )}
            {!loading && docs.length > 0 && (
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line text-caption text-ink-faint">
                    <th className="px-5 py-2.5 font-medium">文档</th>
                    <th className="px-3 py-2.5 font-medium">可见性</th>
                    <th className="px-3 py-2.5 font-medium">解析状态</th>
                    <th className="px-3 py-2.5 font-medium">更新时间</th>
                    <th className="px-5 py-2.5 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => {
                    const meta = metaOf(d.parse_status);
                    return (
                      <tr key={d.id} className="border-b border-line/50 last:border-b-0 hover:bg-page">
                        <td className="px-5 py-3">
                          <p className="max-w-[380px] truncate text-lead text-ink">{d.file_name}</p>
                          <p className="mt-0.5 text-[11px] text-ink-faint">
                            {d.dify_document_id ? `Dify ${d.dify_document_id.slice(0, 8)}` : '本地登记（未同步）'}
                          </p>
                        </td>
                        <td className="px-3 py-3 text-caption text-ink-soft">
                          {d.visibility === 'PUBLIC' ? '全员可见' : '仅授权可见'}
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-caption font-medium',
                              meta.className,
                            )}
                          >
                            <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-caption text-ink-faint">{fmtTime(d.updated_at)}</td>
                        <td className="px-5 py-3 text-right">
                          {pendingDelete === d.id ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="text-[11px] text-danger">删除后不可恢复，确认？</span>
                              <button
                                type="button"
                                onClick={() => doDelete(d.id)}
                                className="text-caption font-medium text-danger hover:underline"
                              >
                                确认删除
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDelete(null)}
                                className="text-caption text-ink-faint hover:text-ink"
                              >
                                取消
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setPendingDelete(d.id)}
                              className="inline-flex items-center gap-1 text-caption text-ink-faint transition-colors hover:text-danger"
                            >
                              <Trash2 size={13} /> 删除
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── 知识问答 ── */}
      {tab === 'qa' && (
        <div className="mt-4">
          <div className="rounded-xl border border-line bg-surface px-5 py-4">
            <p className="text-caption text-ink-soft">
              当前知识范围：<span className="font-medium text-ink">{activeDataset?.name || '—'}</span>
              {activeDataset ? `（${activeDataset.document_count} 篇）` : ''}
            </p>
            <div className="mt-3 flex items-end gap-2.5">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    ask();
                  }
                }}
                rows={3}
                placeholder="例如：出差住宿的报销标准是多少？（Enter 提问，Shift+Enter 换行）"
                aria-label="知识问答输入"
                className="min-h-[76px] flex-1 resize-y rounded-lg border border-line bg-page px-3 py-2 text-lead leading-relaxed text-ink placeholder:text-ink-faint focus:border-primary-300 focus:outline-none"
              />
              <button
                type="button"
                disabled={asking || !question.trim()}
                onClick={ask}
                className={cn(
                  'inline-flex h-10 items-center gap-1.5 rounded-[10px] px-4 text-lead font-semibold transition-colors',
                  asking || !question.trim()
                    ? 'cursor-not-allowed bg-surface-sunken text-ink-faint'
                    : 'bg-primary-600 text-white hover:bg-primary-700',
                )}
              >
                <Send size={14} /> {asking ? '检索中…' : '提问'}
              </button>
            </div>
          </div>

          {answer && (
            <div className="mt-4 rounded-xl border border-line bg-surface px-5 py-5">
              <h3 className="text-body font-medium text-ink">回答</h3>
              {answer.answer ? (
                <p className="mt-2 whitespace-pre-wrap text-lead leading-relaxed text-ink">{answer.answer}</p>
              ) : (
                <p className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-caption text-warning">
                  {answer.note || '当前环境未生成综合回答。'}
                </p>
              )}

              <h3 className="mt-5 text-body font-medium text-ink">
                来源引用（{answer.references.length}）
              </h3>
              {answer.references.length === 0 ? (
                <p className="mt-2 text-caption text-ink-faint">
                  本次没有召回片段{answer.note ? `：${answer.note}` : '，换一种问法或补充文档后再试。'}
                </p>
              ) : (
                <ul className="mt-2 space-y-2.5">
                  {answer.references.map((r, i) => (
                    <li key={`${r.document_name}-${i}`} className="rounded-lg bg-page px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-caption font-medium text-ink">{r.document_name}</span>
                        {r.score !== null && (
                          <span className="shrink-0 text-[11px] text-ink-faint">匹配度 {r.score.toFixed(3)}</span>
                        )}
                      </div>
                      <p className="mt-1.5 line-clamp-4 text-caption leading-relaxed text-ink-soft">{r.segment}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
