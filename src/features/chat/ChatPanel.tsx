/**
 * ChatPanel —— 通用对话式技能面板（对话式改造 P0 + P1）
 *
 * 两种会话模式共用一个界面（由技能的 interaction_mode 决定）：
 *
 *   mode='chat'（chatflow 技能）：直连 Dify 多轮对话，SSE 流式。
 *   mode='slot'（workflow 技能，P1）：把技能的 input_schema 变成对话里的槽位 ——
 *     进入即列出需要的信息 → 用户自然语言描述 → AI 提取 + 追问
 *     → 参数齐了给「开始执行」→ 执行结果以卡片回到对话。
 *
 * 交互约定：
 *   - Enter 发送，Shift+Enter 换行；发送中可点「停止」中止
 *   - 附件先走 /api/v1/files/upload 暂存，随消息提交（chip 可移除）
 *   - slot 模式额外提供「一次填完」表单卡（参数多时比一问一答快）
 *   - 执行是异步的：提交后轮询结果，任务跑完自动把结果消息追加进来
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  ListChecks,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  Play,
  Send,
  Square,
  Trash2,
  User,
  Wand2,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { cn } from '../../components/ui/cn';
import {
  api,
  ApiError,
  streamChatMessage,
  type ApiChatSession,
  type ApiHumanInputCard,
  type ApiMessageMeta,
  type ApiSlotCard,
  type ApiSlotItem,
} from '../../api/client';

interface ChatMsg {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  files?: Array<{ file_id: string; name?: string }> | null;
  meta?: ApiMessageMeta;
  pending?: boolean;
  error?: boolean;
}

interface Attachment {
  file_id: string;
  name: string;
}

interface Props {
  skillKey: string;
  skillName: string;
  supportedFiles?: string[];
  /** chat = 直连对话；slot = 对话收集参数后执行 workflow */
  interactionMode?: 'chat' | 'slot';
}

/** 执行轮询的终止状态 */
const EXEC_TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'none', 'unknown']);
const POLL_INTERVAL_MS = 2500;

export function ChatPanel({ skillKey, skillName, supportedFiles, interactionMode = 'chat' }: Props) {
  const isSlot = interactionMode === 'slot';

  const [sessions, setSessions] = useState<ApiChatSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);

  // ── slot 模式状态 ─────────────────────────────────────────
  const [slotCard, setSlotCard] = useState<ApiSlotCard | null>(null);
  const [executing, setExecuting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [formFiles, setFormFiles] = useState<Record<string, Attachment[]>>({});
  const [formSubmitting, setFormSubmitting] = useState(false);

  // ── chat 模式：人工介入（chatflow 暂停等用户点按钮）──────────
  /** 正在提交的动作 id（禁用按钮 + 转圈）；null 表示空闲 */
  const [humanBusy, setHumanBusy] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pollRef = useRef<number | null>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /** 加载某会话的历史消息（slot 模式顺带恢复槽位状态） */
  const loadMessages = useCallback(
    async (sessionId: number) => {
      setLoadingMessages(true);
      try {
        const r = await api.chat.getMessages(sessionId);
        setMessages(r.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, files: m.files, meta: m.meta })));
        if (isSlot) {
          // 取最后一条带 slot 卡片的助手消息作为当前进度
          const withCard = [...r.messages].reverse().find((m) => (m.meta as ApiSlotCard | null)?.kind === 'slot');
          setSlotCard((withCard?.meta as ApiSlotCard) ?? null);
        }
        scrollToBottom();
      } catch (e) {
        setPanelError(e instanceof ApiError ? e.message : '消息加载失败');
      } finally {
        setLoadingMessages(false);
      }
    },
    [isSlot, scrollToBottom],
  );

  // 会话列表
  const refreshSessions = useCallback(async (selectLatest = false) => {
    try {
      const list = await api.chat.listSessions(skillKey);
      setSessions(list);
      if (selectLatest) setActiveId((cur) => cur ?? list[0]?.id ?? null);
    } catch (e) {
      setPanelError(e instanceof ApiError ? e.message : '会话列表加载失败');
    }
  }, [skillKey]);

  useEffect(() => {
    setSessions([]);
    setActiveId(null);
    setMessages([]);
    setSlotCard(null);
    setPanelError(null);
    stopPolling();
    refreshSessions(true);
  }, [refreshSessions, stopPolling]);

  // ── 执行结果轮询 ──────────────────────────────────────────
  const startPollingInternal = useCallback(
    (sessionId: number) => {
      stopPolling();
      const tick = async () => {
        try {
          const r = await api.chat.getExecution(sessionId);
          if (EXEC_TERMINAL.has(r.status)) {
            setExecuting(false);
            pollRef.current = null;
            await loadMessages(sessionId);
            refreshSessions();
            return;
          }
        } catch {
          /* 网络抖动：继续轮询 */
        }
        pollRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
      };
      pollRef.current = window.setTimeout(tick, 1500);
    },
    [loadMessages, refreshSessions, stopPolling],
  );

  // 历史消息 + 会话模式识别
  useEffect(() => {
    if (activeId === null) {
      setMessages([]);
      setSlotCard(null);
      return;
    }
    loadMessages(activeId).catch(() => void 0);
    // 若该会话上次处于执行中（例如刷新页面），恢复轮询
    if (isSlot) {
      const s = sessions.find((x) => x.id === activeId);
      if (s?.status === 'executing') {
        setExecuting(true);
        startPollingInternal(activeId);
      }
    }
    // sessions 只用于判断恢复轮询，不参与依赖以免每次列表刷新都重载消息
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, loadMessages, isSlot, startPollingInternal]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const newSession = async () => {
    try {
      const s = await api.chat.createSession({ skill_key: skillKey });
      setSessions((prev) => [s, ...prev]);
      setActiveId(s.id);
      setMessages([]);
      setSlotCard(null);
      if (isSlot) await loadMessages(s.id); // slot 模式：立刻呈现开场引导
      textareaRef.current?.focus();
    } catch (e) {
      setPanelError(e instanceof ApiError ? e.message : '新建会话失败');
    }
  };

  const renameSession = async (s: ApiChatSession) => {
    const title = window.prompt('重命名会话', s.title);
    if (!title || !title.trim() || title.trim() === s.title) return;
    try {
      const updated = await api.chat.renameSession(s.id, title.trim());
      setSessions((prev) => prev.map((x) => (x.id === s.id ? updated : x)));
    } catch (e) {
      setPanelError(e instanceof ApiError ? e.message : '重命名失败');
    }
  };

  const removeSession = async (s: ApiChatSession) => {
    if (!window.confirm(`删除会话「${s.title}」？该操作不可恢复。`)) return;
    try {
      await api.chat.deleteSession(s.id);
      setSessions((prev) => prev.filter((x) => x.id !== s.id));
      if (activeId === s.id) {
        setActiveId(null);
        setMessages([]);
        setSlotCard(null);
      }
    } catch (e) {
      setPanelError(e instanceof ApiError ? e.message : '删除失败');
    }
  };

  const attach = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setUploading(true);
    setPanelError(null);
    try {
      for (const f of Array.from(list)) {
        const r = await api.uploadFile(f);
        setAttachments((prev) => [...prev, { file_id: r.file_id, name: r.name || f.name }]);
      }
    } catch (e) {
      setPanelError(e instanceof ApiError ? e.message : '文件上传失败');
    } finally {
      setUploading(false);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
    setMessages((prev) => prev.map((m) => (m.pending ? { ...m, pending: false } : m)));
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || sending || uploading) return;
    setPanelError(null);
    setSending(true);

    try {
      // 惰性建会话：从未选过会话时第一条消息自动建
      let sessionId = activeId;
      if (sessionId === null) {
        const s = await api.chat.createSession({ skill_key: skillKey });
        setSessions((prev) => [s, ...prev]);
        setActiveId(s.id);
        sessionId = s.id;
        // slot 模式：新会话自带开场引导消息，先拉回来再继续
        if (isSlot) {
          await loadMessages(sessionId).catch(() => void 0);
        }
      }

      const sentFiles = attachments.map((a) => ({ file_id: a.file_id, name: a.name }));
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: text || '（发送了附件）', files: sentFiles.length ? sentFiles : null },
        { role: 'assistant', content: '', pending: true },
      ]);
      setInput('');
      setAttachments([]);
      scrollToBottom();

      const controller = new AbortController();
      abortRef.current = controller;

      await streamChatMessage(
        sessionId,
        { query: text || undefined, files: sentFiles.length ? sentFiles : undefined },
        {
          onDelta: (delta) => {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + delta };
              return next;
            });
            scrollToBottom();
          },
          onSlot: (card) => setSlotCard(card),
          onHumanInput: (card) => {
            // chatflow 暂停（人工介入）：先即时把气泡换成卡片，稍后 done 里以后端落库为准
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === 'assistant' && last.pending) {
                next[next.length - 1] = {
                  ...last,
                  content: card.form_content || card.node_title || '工作流需要你确认后才能继续。',
                  meta: card,
                };
              }
              return next;
            });
            scrollToBottom();
          },
          onDone: async (d) => {
            if (d.card && d.card.kind === 'slot') setSlotCard(d.card);
            setMessages((prev) =>
              prev.map((m) =>
                m.pending
                  ? {
                      ...m,
                      pending: false,
                      meta:
                        d.card && d.card.kind === 'slot'
                          ? ({ ...d.card, extractor: d.extractor, degraded: d.degraded } as ApiMessageMeta)
                          : ((d.card as ApiMessageMeta | undefined) ?? m.meta),
                    }
                  : m,
              ),
            );
            // 以「暂停等人工介入」收尾：改以后端落库的消息为准（带 submitted 状态），
            // 保证刷新 / 换设备后按钮依然可点
            if (d.pending) await loadMessages(sessionId).catch(() => void 0);
            refreshSessions(); // 首轮自动标题 / updated_at 刷新
          },
          onError: (message) => {
            setMessages((prev) =>
              prev.map((m) => (m.pending ? { ...m, pending: false, error: true, content: m.content || `⚠️ ${message}` } : m)),
            );
          },
        },
        controller.signal,
      );
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        const msg = e instanceof ApiError ? e.message : '发送失败';
        setMessages((prev) =>
          prev.map((m) => (m.pending ? { ...m, pending: false, error: true, content: m.content || `⚠️ ${msg}` } : m)),
        );
      }
    } finally {
      abortRef.current = null;
      setSending(false);
      setMessages((prev) => prev.map((m) => (m.pending ? { ...m, pending: false } : m)));
      textareaRef.current?.focus();
    }
  };

  // ── slot 模式：一次填完表单 ───────────────────────────────
  const openForm = () => {
    const v: Record<string, string> = {};
    const f: Record<string, Attachment[]> = {};
    for (const s of slotCard?.all_slots || []) {
      const filled = slotCard?.filled?.find((x) => x.key === s.key);
      if (s.is_file) {
        const arr = Array.isArray(filled?.value) ? (filled?.value as Attachment[]) : [];
        f[s.key] = arr;
      } else if (filled?.value !== undefined && filled?.value !== null) {
        v[s.key] = Array.isArray(filled.value) ? filled.value.join('、') : String(filled.value);
      } else {
        v[s.key] = '';
      }
    }
    setFormValues(v);
    setFormFiles(f);
    setFormOpen(true);
  };

  const submitForm = async () => {
    if (activeId === null) return;
    setFormSubmitting(true);
    setPanelError(null);
    try {
      const inputs: Record<string, unknown> = {};
      for (const s of slotCard?.all_slots || []) {
        if (s.is_file) {
          if (formFiles[s.key]?.length) inputs[s.key] = formFiles[s.key];
          continue;
        }
        const raw = (formValues[s.key] ?? '').trim();
        if (!raw) continue;
        if (s.type === 'array') inputs[s.key] = raw.split(/[、,，;；]/).map((x) => x.trim()).filter(Boolean);
        else if (s.type === 'integer' || s.type === 'number') inputs[s.key] = Number(raw);
        else inputs[s.key] = raw;
      }
      const r = await api.chat.updateSlots(activeId, inputs);
      setSlotCard(r.card);
      setFormOpen(false);
      await loadMessages(activeId);
      refreshSessions();
    } catch (e) {
      setPanelError(e instanceof ApiError ? e.message : '参数保存失败');
    } finally {
      setFormSubmitting(false);
    }
  };

  const uploadFormFile = async (slotKey: string, list: FileList | null) => {
    if (!list || list.length === 0) return;
    setUploading(true);
    try {
      const added: Attachment[] = [];
      for (const f of Array.from(list)) {
        const r = await api.uploadFile(f);
        added.push({ file_id: r.file_id, name: r.name || f.name });
      }
      setFormFiles((prev) => ({ ...prev, [slotKey]: [...(prev[slotKey] || []), ...added] }));
    } catch (e) {
      setPanelError(e instanceof ApiError ? e.message : '文件上传失败');
    } finally {
      setUploading(false);
    }
  };

  // ── slot 模式：提交执行 ───────────────────────────────────
  const execute = async () => {
    if (activeId === null || executing) return;
    setPanelError(null);
    setExecuting(true);
    try {
      await api.chat.execute(activeId);
      await loadMessages(activeId);
      refreshSessions();
      startPollingInternal(activeId);
    } catch (e) {
      setExecuting(false);
      setPanelError(e instanceof ApiError ? e.message : '提交执行失败');
    }
  };

  // ── chat 模式：人工介入（点 Dify 表单上的按钮）──────────────
  /**
   * 提交一个人工介入动作 → 后端转交 Dify 并轮询续跑结果
   * （下一张表单 / 最终回复），然后重取会话消息刷新界面。
   */
  const submitHumanAction = async (action: string) => {
    if (activeId === null || humanBusy) return;
    setHumanBusy(action);
    setPanelError(null);
    try {
      const r = await api.chat.submitHumanInput(activeId, action);
      await loadMessages(activeId);
      refreshSessions();
      if (r.status === 'running') {
        setPanelError('操作已提交，工作流仍在执行中 —— 稍后点会话右上角的刷新查看结果。');
      }
    } catch (e) {
      setPanelError(e instanceof ApiError ? e.message : '提交失败');
      // 失败也要重取，避免界面停在「按钮可点」的假状态
      await loadMessages(activeId).catch(() => void 0);
    } finally {
      setHumanBusy(null);
    }
  };

  const canSend = (input.trim().length > 0 || attachments.length > 0) && !sending && !uploading;
  const slotReady = !!slotCard?.ready;

  return (
    <div className="flex h-full overflow-hidden rounded-xl border border-line bg-surface">
      {/* 会话列表 */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-page">
        <button
          type="button"
          onClick={newSession}
          className="m-2.5 inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] bg-primary-600 text-caption font-medium text-white transition-colors hover:bg-primary-700"
        >
          <MessageSquarePlus size={14} /> 新会话
        </button>
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {sessions.length === 0 && <p className="px-2 py-3 text-[11px] text-ink-faint">还没有会话，直接开聊吧</p>}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={cn(
                'group flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-2 text-caption transition-colors',
                activeId === s.id ? 'bg-surface font-medium text-ink shadow-sm' : 'text-ink-soft hover:bg-surface-sunken',
              )}
              onClick={() => setActiveId(s.id)}
            >
              <span className="flex-1 truncate">{s.title}</span>
              {s.status === 'executing' && <Loader2 size={11} className="shrink-0 animate-spin text-primary-600" />}
              <button
                type="button"
                aria-label="重命名"
                className="hidden shrink-0 text-ink-faint hover:text-ink group-hover:block"
                onClick={(e) => {
                  e.stopPropagation();
                  renameSession(s);
                }}
              >
                <Pencil size={12} />
              </button>
              <button
                type="button"
                aria-label="删除"
                className="hidden shrink-0 text-ink-faint hover:text-danger group-hover:block"
                onClick={(e) => {
                  e.stopPropagation();
                  removeSession(s);
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* 消息区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* slot 模式：信息收集进度条 */}
        {isSlot && slotCard && (
          <div className="flex items-center gap-2 border-b border-line bg-page px-4 py-2">
            <ListChecks size={14} className={cn(slotReady ? 'text-success' : 'text-ink-faint')} />
            <span className="text-caption text-ink-soft">
              信息收集 <span className="font-medium text-ink">{slotCard.filled_count}</span>/{slotCard.total_count}
            </span>
            {slotReady ? (
              <span className="inline-flex items-center gap-1 text-caption text-success">
                <CheckCircle2 size={12} /> 必填项已齐
              </span>
            ) : (
              <span className="truncate text-caption text-ink-faint">
                还差：{slotCard.missing.map((m) => m.title).join('、')}
              </span>
            )}
            <button
              type="button"
              onClick={openForm}
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-ink-soft transition-colors hover:text-ink"
            >
              <Wand2 size={11} /> 一次填完
            </button>
          </div>
        )}

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {loadingMessages && messages.length === 0 && (
            <p className="py-10 text-center text-caption text-ink-faint">加载历史消息…</p>
          )}
          {!loadingMessages && messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <Bot size={28} className="text-ink-faint" />
              <p className="text-lead text-ink-soft">
                {isSlot ? `我是「${skillName}」，直接告诉我要做什么就行` : `我是「${skillName}」，有什么可以帮你？`}
              </p>
              <p className="text-caption text-ink-faint">
                {isSlot
                  ? '我会边聊边帮你把参数整理好，确认后再执行'
                  : `支持多轮对话${supportedFiles?.length ? `与附件（${supportedFiles.join(' / ')}）` : ''}`}
              </p>
            </div>
          )}
          {messages.map((m, i) => {
            const meta = m.meta as ApiMessageMeta;
            const isLast = i === messages.length - 1;
            const slotMeta = meta && meta.kind === 'slot' ? meta : null;
            const humanMeta = meta && meta.kind === 'human_input' ? (meta as ApiHumanInputCard) : null;
            return (
              <div key={m.id ?? i} className={cn('flex gap-2.5', m.role === 'user' && 'flex-row-reverse')}>
                <span
                  className={cn(
                    'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                    m.role === 'user' ? 'bg-primary-600 text-white' : 'bg-surface-sunken text-ink-soft',
                  )}
                >
                  {m.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                </span>
                <div className={cn('min-w-0 max-w-[78%]', m.role === 'user' && 'flex flex-col items-end')}>
                  <div
                    className={cn(
                      'rounded-2xl px-3.5 py-2.5 text-lead leading-relaxed',
                      m.role === 'user'
                        ? 'rounded-tr-md bg-primary-600 text-white'
                        : cn('rounded-tl-md bg-surface-sunken text-ink', m.error && 'bg-danger-soft text-danger'),
                    )}
                  >
                    {m.files && m.files.length > 0 && (
                      <div className="mb-1.5 flex flex-wrap gap-1">
                        {m.files.map((f) => (
                          <span
                            key={f.file_id}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]',
                              m.role === 'user' ? 'bg-white/20' : 'bg-page text-ink-soft',
                            )}
                          >
                            <Paperclip size={10} /> {f.name || '附件'}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.role === 'assistant' ? (
                      <div className="prose-sm max-w-none break-words [&_p]:my-1.5 [&_table]:w-full [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-line [&_th]:bg-page [&_th]:px-2 [&_th]:py-1">
                        <ReactMarkdown>{m.content}</ReactMarkdown>
                        {m.pending && <Loader2 size={14} className="mt-1 animate-spin text-ink-faint" />}
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                    )}
                  </div>

                  {/* 结果卡片脚注：任务号 / 失败提示 */}
                  {meta?.kind === 'result' && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
                      <span
                        className={cn(
                          'rounded-md px-1.5 py-0.5',
                          meta.status === 'succeeded' && 'bg-success-soft text-success',
                          ['failed', 'cancelled'].includes(meta.status) && 'bg-danger-soft text-danger',
                          !['succeeded', 'failed', 'cancelled'].includes(meta.status) && 'bg-surface-sunken text-ink-soft',
                        )}
                      >
                        {meta.status === 'succeeded'
                          ? '执行完成'
                          : meta.status === 'failed'
                            ? '执行失败'
                            : meta.status === 'cancelled'
                              ? '已取消'
                              : '执行中'}
                      </span>
                      {meta.task_no && <span>任务 {meta.task_no}</span>}
                      {!['succeeded', 'failed', 'cancelled'].includes(meta.status) && (
                        <Loader2 size={10} className="animate-spin" />
                      )}
                    </div>
                  )}

                  {/* 人工介入卡片：chatflow 暂停等用户点按钮才继续 */}
                  {humanMeta && (
                    <div className="mt-2 w-full">
                      {humanMeta.node_title && (
                        <p className="mb-1.5 inline-flex items-center gap-1 rounded-md bg-warning-soft px-2 py-0.5 text-[11px] text-warning">
                          <CircleAlert size={11} /> {humanMeta.node_title}
                        </p>
                      )}
                      {!humanMeta.submitted && isLast ? (
                        <div className="flex flex-wrap gap-2">
                          {humanMeta.actions.map((a) => {
                            const primary = a.button_style === 'primary';
                            const busy = humanBusy === a.id;
                            return (
                              <button
                                key={a.id}
                                type="button"
                                disabled={humanBusy !== null}
                                onClick={() => submitHumanAction(a.id)}
                                className={cn(
                                  'inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-caption font-medium transition-colors',
                                  primary
                                    ? 'bg-primary-600 text-white hover:bg-primary-700'
                                    : 'border border-line bg-surface text-ink hover:bg-surface-sunken',
                                  humanBusy !== null && 'pointer-events-none opacity-50',
                                )}
                              >
                                {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                                {a.title || a.id}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-[11px] text-ink-faint">该确认已处理</p>
                      )}
                      {humanBusy !== null && (
                        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-ink-soft">
                          <Loader2 size={11} className="animate-spin" /> 正在执行后续步骤，可能需要一会儿…
                        </p>
                      )}
                    </div>
                  )}

                  {/* 槽位追问脚注：降级提示（不静默） */}
                  {slotMeta?.degraded && isLast && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-warning">
                      <CircleAlert size={11} /> 智能提取暂不可用，已用规则匹配帮你填 —— 请核对后再执行
                    </p>
                  )}

                  {/* 参数齐了：消息尾部给执行入口 */}
                  {isSlot && slotMeta?.ready && isLast && !executing && (
                    <button
                      type="button"
                      onClick={execute}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-[10px] bg-primary-600 px-3 py-1.5 text-caption font-medium text-white transition-colors hover:bg-primary-700"
                    >
                      <Play size={12} /> 开始执行
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {panelError && <p className="mx-5 mb-2 rounded-lg bg-danger-soft px-3 py-2 text-caption text-danger">{panelError}</p>}

        {/* slot 模式：执行状态条 */}
        {isSlot && executing && (
          <div className="flex items-center gap-2 border-t border-line bg-page px-4 py-2 text-caption text-ink-soft">
            <Loader2 size={13} className="animate-spin text-primary-600" />
            任务执行中，完成后结果会自动出现在对话里…
          </div>
        )}
        {isSlot && !executing && slotReady && !sending && (
          <div className="flex items-center gap-2 border-t border-line bg-page px-4 py-2">
            <span className="text-caption text-success">参数已齐，可以执行了</span>
            <button
              type="button"
              onClick={execute}
              className="ml-auto inline-flex items-center gap-1 rounded-[10px] bg-primary-600 px-3 py-1.5 text-caption font-medium text-white transition-colors hover:bg-primary-700"
            >
              <Play size={12} /> 开始执行
            </button>
          </div>
        )}

        {/* 输入区 */}
        <div className="border-t border-line px-4 py-3">
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((a) => (
                <span key={a.file_id} className="inline-flex items-center gap-1 rounded-md bg-surface-sunken px-2 py-1 text-[11px] text-ink-soft">
                  <Paperclip size={10} /> {a.name}
                  <button
                    type="button"
                    aria-label={`移除 ${a.name}`}
                    className="text-ink-faint hover:text-danger"
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.file_id !== a.file_id))}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <label
              className={cn(
                'flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink',
                (uploading || sending) && 'pointer-events-none opacity-40',
              )}
              title="上传附件"
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
              <input
                type="file"
                multiple
                className="hidden"
                accept={supportedFiles?.length ? supportedFiles.join(',') : undefined}
                onChange={(e) => {
                  attach(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              placeholder={
                isSlot ? `描述你的需求，我来帮你补全参数…（Enter 发送）` : `向「${skillName}」提问…（Enter 发送，Shift+Enter 换行）`
              }
              className="max-h-32 min-h-[40px] flex-1 resize-y rounded-[10px] border border-line bg-page px-3 py-2 text-lead text-ink focus:border-primary-300 focus:outline-none"
            />
            {sending ? (
              <button
                type="button"
                onClick={stop}
                className="inline-flex h-9 shrink-0 items-center gap-1 rounded-[10px] bg-surface-sunken px-3 text-caption font-medium text-ink-soft transition-colors hover:text-ink"
              >
                <Square size={13} /> 停止
              </button>
            ) : (
              <button
                type="button"
                onClick={send}
                disabled={!canSend}
                className={cn(
                  'inline-flex h-9 shrink-0 items-center gap-1 rounded-[10px] px-4 text-caption font-medium transition-colors',
                  canSend ? 'bg-primary-600 text-white hover:bg-primary-700' : 'cursor-not-allowed bg-surface-sunken text-ink-faint',
                )}
              >
                <Send size={13} /> 发送
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 「一次填完」表单卡（抽屉） */}
      {formOpen && slotCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onClick={() => setFormOpen(false)}>
          <div
            className="flex max-h-[80vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <Wand2 size={15} className="text-primary-600" />
              <h3 className="text-lead font-semibold text-ink">一次填完参数</h3>
              <button type="button" className="ml-auto text-ink-faint hover:text-ink" onClick={() => setFormOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {slotCard.all_slots.map((s: ApiSlotItem) => (
                <label key={s.key} className="block">
                  <span className="mb-1 flex items-center gap-1.5 text-caption font-medium text-ink">
                    {s.title}
                    {s.required && <span className="text-danger">*</span>}
                    <span className="font-normal text-ink-faint">
                      {s.is_file ? '（文件）' : s.type === 'array' ? '（多个用、分隔）' : ''}
                    </span>
                  </span>
                  {s.is_file ? (
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap gap-1.5">
                        {(formFiles[s.key] || []).map((f) => (
                          <span
                            key={f.file_id}
                            className="inline-flex items-center gap-1 rounded-md bg-surface-sunken px-2 py-1 text-[11px] text-ink-soft"
                          >
                            <Paperclip size={10} /> {f.name}
                            <button
                              type="button"
                              className="text-ink-faint hover:text-danger"
                              onClick={() =>
                                setFormFiles((prev) => ({
                                  ...prev,
                                  [s.key]: (prev[s.key] || []).filter((x) => x.file_id !== f.file_id),
                                }))
                              }
                            >
                              <X size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-line px-2.5 py-1.5 text-[11px] text-ink-soft hover:text-ink">
                        <Paperclip size={11} /> 选择文件
                        <input
                          type="file"
                          className="hidden"
                          onChange={(e) => {
                            uploadFormFile(s.key, e.target.files);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>
                  ) : s.enum ? (
                    <select
                      value={formValues[s.key] ?? ''}
                      onChange={(e) => setFormValues((prev) => ({ ...prev, [s.key]: e.target.value }))}
                      className="w-full rounded-[10px] border border-line bg-page px-3 py-2 text-lead text-ink focus:border-primary-300 focus:outline-none"
                    >
                      <option value="">请选择</option>
                      {s.enum.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={s.type === 'number' || s.type === 'integer' ? 'number' : 'text'}
                      value={formValues[s.key] ?? ''}
                      placeholder={s.description || ''}
                      onChange={(e) => setFormValues((prev) => ({ ...prev, [s.key]: e.target.value }))}
                      className="w-full rounded-[10px] border border-line bg-page px-3 py-2 text-lead text-ink focus:border-primary-300 focus:outline-none"
                    />
                  )}
                </label>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-[10px] px-3 py-1.5 text-caption text-ink-soft transition-colors hover:bg-surface-sunken"
              >
                取消
              </button>
              <button
                type="button"
                onClick={submitForm}
                disabled={formSubmitting}
                className="inline-flex items-center gap-1.5 rounded-[10px] bg-primary-600 px-4 py-1.5 text-caption font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
              >
                {formSubmitting && <Loader2 size={12} className="animate-spin" />} 保存参数
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
