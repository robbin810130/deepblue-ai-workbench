/**
 * 任务中心 —— 详情页
 *
 * 依据：05_任务中心详细PRD §5 任务详情 + §6 状态-操作矩阵
 *   - Header：标题/编号/状态 + 七操作（按状态机动态显隐）
 *   - 结果区（含待确认确认/驳回）、输入区、产物下载（签名 URL）
 *   - 事件时间线（可审计）+ Run 记录（重试不覆盖旧 Run）
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Archive,
  CheckCircle2,
  Download,
  Play,
  RotateCcw,
  Undo2,
  XCircle,
  X,
} from 'lucide-react';
import { cn } from '../../components/ui/cn';
import {
  api,
  ApiError,
  type TaskDetail,
  type ApiArtifact,
} from '../../api/client';
import { TASK_STATUS_META, type TaskStatus } from '../../types/domain';

type ActionKind = 'execute' | 'cancel' | 'confirm' | 'reject' | 'retry' | 'rerun' | 'archive';

/** 每状态可用操作（与后端 states.js 的 allowed actions 对齐） */
const ACTIONS_BY_STATUS: Record<TaskStatus, Array<{ kind: ActionKind; label: string; tone: 'primary' | 'danger' | 'ghost' }>> = {
  draft: [
    { kind: 'execute', label: '执行', tone: 'primary' },
    { kind: 'cancel', label: '取消', tone: 'ghost' },
  ],
  queued: [{ kind: 'cancel', label: '取消', tone: 'danger' }],
  running: [{ kind: 'cancel', label: '取消', tone: 'danger' }],
  waiting_confirmation: [
    { kind: 'confirm', label: '确认结果', tone: 'primary' },
    { kind: 'reject', label: '驳回', tone: 'danger' },
  ],
  succeeded: [
    { kind: 'rerun', label: '再次执行', tone: 'primary' },
    { kind: 'archive', label: '归档', tone: 'ghost' },
  ],
  failed: [
    { kind: 'retry', label: '重试', tone: 'primary' },
    { kind: 'archive', label: '归档', tone: 'ghost' },
  ],
  cancelled: [
    { kind: 'retry', label: '重试', tone: 'primary' },
    { kind: 'archive', label: 'ghost' as unknown as 'ghost', tone: 'ghost' },
  ],
  archived: [],
};

const EVENT_LABEL: Record<string, string> = {
  task_created: '创建任务',
  task_created_and_submitted: '创建并直接执行',
  task_updated: '编辑任务',
  task_executed: '提交执行',
  task_queued: '进入排队',
  task_started: '开始执行',
  task_succeeded: '执行成功',
  task_failed: '执行失败',
  task_cancelled: '任务取消',
  task_confirmed: '结果确认',
  task_rejected: '结果驳回',
  task_retried: '重试',
  task_rerun: '再次执行（克隆新任务）',
  task_archived: '归档',
  status_changed: '状态变更',
};

const ACTION_ICON: Record<ActionKind, typeof Play> = {
  execute: Play,
  cancel: XCircle,
  confirm: CheckCircle2,
  reject: Undo2,
  retry: RotateCcw,
  rerun: RotateCcw,
  archive: Archive,
};

function fmt(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const nav = useNavigate();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(() => {
    if (!taskId) return;
    api
      .getTask(taskId)
      .then(setDetail)
      .catch((e) => setError(e instanceof ApiError ? `${e.code}: ${e.message}` : e.message));
  }, [taskId]);

  useEffect(load, [load]);

  const run = async (kind: ActionKind, body?: Record<string, unknown>) => {
    if (!taskId || busy) return;
    setBusy(true);
    setBanner(null);
    try {
      await api.taskAction(taskId, kind, body);
      setBanner({ tone: 'ok', text: `操作成功：${kind}` });
      setRejectOpen(false);
      setRejectReason('');
      load();
    } catch (e) {
      setBanner({ tone: 'err', text: e instanceof ApiError ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const download = async (a: ApiArtifact) => {
    if (!taskId) return;
    try {
      const { url } = await api.getDownloadUrl('artifact', a.id);
      window.open(url, '_blank');
    } catch (e) {
      setBanner({ tone: 'err', text: e instanceof ApiError ? e.message : '获取下载链接失败' });
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-[860px] px-8 py-16 text-center">
        <p className="text-lead text-danger">{error}</p>
        <button onClick={() => nav('/tasks')} className="mt-4 text-caption text-primary-600 hover:underline">
          返回任务列表
        </button>
      </div>
    );
  }
  if (!detail) {
    return <p className="px-8 py-16 text-center text-caption text-ink-faint">加载中…</p>;
  }

  const t = detail.task;
  const meta = TASK_STATUS_META[t.status as TaskStatus];
  const actions = ACTIONS_BY_STATUS[t.status as TaskStatus] || [];
  const inputs = (t.input?.inputs || {}) as Record<string, unknown>;

  return (
    <div className="mx-auto w-full max-w-[920px] px-8 py-7">
      <button
        onClick={() => nav('/tasks')}
        className="inline-flex items-center gap-1 text-caption text-ink-soft transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} /> 任务中心
      </button>

      {/* Header */}
      <div className="mt-4 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-title font-semibold text-ink">{t.title}</h1>
          <p className="mt-1.5 flex items-center gap-2 text-caption text-ink-faint">
            <span>{t.task_no}</span>
            <span>·</span>
            <span>{t.skill_key}</span>
            <span>·</span>
            <span>已执行 {t.run_count} 次</span>
            <span>·</span>
            <span>创建于 {fmt(t.created_at)}</span>
          </p>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-caption font-semibold',
            meta?.tone || 'bg-surface-sunken text-ink-soft',
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', meta?.dot || 'bg-ink-faint')} />
          {meta?.label || t.status}
        </span>
      </div>

      {/* 操作条 */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {actions.map((a) => {
          const Icon = ACTION_ICON[a.kind];
          return (
            <button
              key={a.kind}
              type="button"
              disabled={busy}
              onClick={() => (a.kind === 'reject' ? setRejectOpen(true) : run(a.kind))}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3.5 text-lead font-medium transition-colors disabled:opacity-50',
                a.tone === 'primary' && 'bg-primary-600 text-white hover:bg-primary-700',
                a.tone === 'danger' && 'bg-danger-soft text-danger hover:bg-danger/15',
                a.tone === 'ghost' && 'bg-surface-sunken text-ink-soft hover:text-ink',
              )}
            >
              <Icon size={14} /> {a.label}
            </button>
          );
        })}
        {t.status === 'draft' && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!taskId) return;
              setBusy(true);
              try {
                await api.deleteTask(taskId);
                nav('/tasks');
              } catch (e) {
                setBanner({ tone: 'err', text: e instanceof ApiError ? e.message : '删除失败' });
                setBusy(false);
              }
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-surface-sunken px-3.5 text-lead font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
          >
            <X size={14} /> 删除草稿
          </button>
        )}
      </div>

      {/* 驳回原因输入 */}
      {rejectOpen && (
        <div className="mt-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3">
          <label className="text-caption font-medium text-ink" htmlFor="reject-reason">
            驳回原因（必填，将记入事件流）
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="例如：风险项太多退回重审"
              className="h-9 flex-1 rounded-lg border border-line bg-surface px-3 text-lead text-ink focus:border-primary-300 focus:outline-none"
            />
            <button
              type="button"
              disabled={!rejectReason.trim() || busy}
              onClick={() => run('reject', { reason: rejectReason.trim() })}
              className="h-9 rounded-lg bg-danger px-4 text-lead font-medium text-white disabled:opacity-40"
            >
              确认驳回
            </button>
            <button
              type="button"
              onClick={() => setRejectOpen(false)}
              className="h-9 rounded-lg px-3 text-caption text-ink-soft hover:text-ink"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {banner && (
        <p
          className={cn(
            'mt-3 rounded-lg px-4 py-2.5 text-caption',
            banner.tone === 'ok' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
          )}
        >
          {banner.text}
        </p>
      )}

      {/* 结果 / 错误 */}
      {t.status === 'waiting_confirmation' && (
        <section className="mt-5 rounded-xl border border-warning/40 bg-warning-soft px-5 py-4">
          <h2 className="text-lead font-semibold text-ink">执行完成，等待人工确认</h2>
          {t.summary && <p className="mt-1.5 text-lead text-ink-soft">{t.summary}</p>}
          {t.result != null && (
            <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-surface px-3 py-2 text-[12px] leading-relaxed text-ink">
              {JSON.stringify(t.result, null, 2)}
            </pre>
          )}
        </section>
      )}
      {t.status === 'failed' && (
        <section className="mt-5 rounded-xl border border-danger/30 bg-danger-soft px-5 py-4">
          <h2 className="text-lead font-semibold text-danger">执行失败</h2>
          <p className="mt-1 text-lead text-ink-soft">
            <span className="font-mono text-caption">{t.error_code}</span> — {t.error_message}
          </p>
        </section>
      )}
      {t.status === 'succeeded' && t.summary && (
        <section className="mt-5 rounded-xl border border-success/30 bg-success-soft px-5 py-4">
          <h2 className="text-lead font-semibold text-success">执行结果</h2>
          <p className="mt-1 text-lead text-ink-soft">{t.summary}</p>
          {t.result != null && (
            <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-surface px-3 py-2 text-[12px] leading-relaxed text-ink">
              {JSON.stringify(t.result, null, 2)}
            </pre>
          )}
        </section>
      )}

      {/* 产物 */}
      {detail.artifacts.length > 0 && (
        <section className="mt-5 rounded-xl border border-line bg-surface px-5 py-4">
          <h2 className="text-lead font-semibold text-ink">产物（{detail.artifacts.length}）</h2>
          <ul className="mt-2 space-y-1.5">
            {detail.artifacts.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3">
                <span className="truncate text-lead text-ink">
                  {a.name || a.id}
                  <span className="ml-2 text-[11px] text-ink-faint">
                    {a.kind} · {a.mime_type || '—'}
                    {a.size_bytes ? ` · ${(a.size_bytes / 1024).toFixed(1)} KB` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => download(a)}
                  className="inline-flex h-8 items-center gap-1 rounded-lg bg-page px-2.5 text-caption text-primary-600 hover:bg-surface-sunken"
                >
                  <Download size={13} /> 下载
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 输入 */}
      <section className="mt-5 rounded-xl border border-line bg-surface px-5 py-4">
        <h2 className="text-lead font-semibold text-ink">输入</h2>
        {Object.keys(inputs).length > 0 ? (
          <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-page px-3 py-2 text-[12px] leading-relaxed text-ink">
            {JSON.stringify(inputs, null, 2)}
          </pre>
        ) : (
          <p className="mt-1.5 text-caption text-ink-faint">无额外输入</p>
        )}
        {t.trace_id && <p className="mt-2 font-mono text-[11px] text-ink-faint">trace_id: {t.trace_id}</p>}
      </section>

      {/* Run 记录 */}
      <section className="mt-5 rounded-xl border border-line bg-surface px-5 py-4">
        <h2 className="text-lead font-semibold text-ink">执行记录（Run）</h2>
        <ul className="mt-2 space-y-2">
          {detail.runs.map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded-lg bg-page px-3 py-2">
              <span className="text-lead text-ink">
                #{r.run_no}
                <span
                  className={cn(
                    'ml-2 rounded px-1.5 py-0.5 text-[11px]',
                    r.status === 'succeeded' && 'bg-success-soft text-success',
                    r.status === 'failed' && 'bg-danger-soft text-danger',
                    r.status !== 'succeeded' && r.status !== 'failed' && 'bg-surface-sunken text-ink-soft',
                  )}
                >
                  {r.status}
                </span>
                {r.error?.code && (
                  <span className="ml-2 font-mono text-[11px] text-danger" title={r.error.message}>
                    {r.error.code}
                  </span>
                )}
              </span>
              <span className="text-[11px] text-ink-faint">
                {r.provider || '—'} · {fmt(r.started_at)}
                {r.duration_ms ? ` · ${(r.duration_ms / 1000).toFixed(1)}s` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* 事件时间线 */}
      <section className="mt-5 rounded-xl border border-line bg-surface px-5 py-4">
        <h2 className="text-lead font-semibold text-ink">事件时间线</h2>
        <ol className="mt-3 space-y-0">
          {[...detail.events].reverse().map((ev, i, arr) => (
            <li key={ev.id} className="relative flex gap-3 pb-4 last:pb-0">
              {i < arr.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-line" aria-hidden />}
              <span className="relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-primary-300 bg-surface" />
              <div className="min-w-0">
                <p className="text-lead text-ink">
                  {EVENT_LABEL[ev.event_type] || ev.event_type}
                  {ev.from_status && ev.to_status && (
                    <span className="ml-2 text-caption text-ink-faint">
                      {TASK_STATUS_META[ev.from_status as TaskStatus]?.label || ev.from_status} →{' '}
                      {TASK_STATUS_META[ev.to_status as TaskStatus]?.label || ev.to_status}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-faint">
                  {fmt(ev.created_at)}
                  {ev.actor ? ` · ${ev.actor}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <p className="mt-6 text-center text-caption text-ink-faint">
        技能详情见{' '}
        <Link to={`/skills/${t.skill_key}`} className="text-primary-600 hover:underline">
          {t.skill_key}
        </Link>
      </p>
    </div>
  );
}
