/**
 * /api/v1 API 客户端 —— 新版前端访问后端的唯一出口
 *
 * 约定：
 *   - JWT 取旧系统同一存储键 blue_os_token（登录入口不重复做，复用旧登录页）
 *   - 响应统一解包 { success, data }；失败抛 ApiError（code/message 来自后端错误模型）
 *   - 401 → 清 token 并把用户送到旧登录页（/legacy）；新界面自身没有登录页
 */

import { LEGACY_PREFIX, isLegacyPath } from '../app/basePath';

const TOKEN_KEY = 'blue_os_token';

/** 登录回跳参数名（LoginScreen 侧同源读取，改名需同步两处） */
export const REDIRECT_PARAM = 'redirect';

/**
 * 会话失效统一处理：清 token 并把用户送到登录页。
 *
 * 2026-09-21 入口切换后：新版工作台占据根路径，自带登录页的旧桌面系统退到 /legacy。
 * 新界面没有自己的登录页，401 时必须带着回跳地址送到 /legacy，否则用户登录后
 * 只会落在旧桌面系统 —— 表现为「新界面打不开 / 登录完还是旧系统」。
 *
 * 两处分流：
 *   新界面区（根路径等）→ 送到 /legacy?redirect=<当前地址>，登录后整页回跳；
 *   旧界面区（/legacy 下）→ 整页刷新回 /legacy，由 App.tsx 重新判定登录态。
 *
 * 防死循环：回跳地址只允许站内相对路径且不指向 /legacy 自身；刷新回 /legacy 后
 * token 已清，只会落到登录视图，不会再发 API 请求。
 */
function redirectToLogin(): void {
  const { pathname, search } = window.location;
  if (isLegacyPath(pathname)) {
    // 旧界面区（/legacy）：整页刷新回自身。token 已被清，刷新后 App.tsx 重新判定
    // 登录态并落到登录视图 —— 与改造前「非 /next 路径就回 '/'」的行为等价，
    // 避免出现「token 没了但界面还停在桌面」的僵尸态。
    window.location.href = LEGACY_PREFIX;
    return;
  }
  const back = encodeURIComponent(`${pathname}${search}`);
  window.location.href = `${LEGACY_PREFIX}?${REDIRECT_PARAM}=${back}`;
}

/**
 * 供旧版 fetchWithAuth（src/utils/authFetch.ts）复用的会话失效处理。
 *
 * 旧实现只 removeItem + dispatch('auth-unauthorized')，靠旧 App.tsx 监听事件切回登录页；
 * 但新界面（根路径）下没有这个监听者，token 被静默删除、页面既不跳转也不报错。
 * 故：新界面下直接跳登录页（带回跳），/legacy 交回旧行为。
 */
export function handleUnauthorized(): void {
  if (!isLegacyPath(window.location.pathname)) {
    redirectToLogin();
  }
}

/**
 * 读取并消费登录回跳地址（登录成功后调用，返回值非空即应整页跳转）。
 *
 * 安全：经 URL 规范化后再校验同源 + 站内路径 + 不指向 /legacy 自身，
 * 可挡掉 `//evil.com`、`https://evil.com`、`/legacy/../evil` 之类的开放重定向构造。
 */
export function consumeLoginRedirect(): string | null {
  const raw = new URLSearchParams(window.location.search).get(REDIRECT_PARAM);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  // 只回跳新界面：/legacy 自身不回跳（登录页就在那，跳过去等于原地打转）
  if (isLegacyPath(url.pathname)) return null;
  if (!url.pathname.startsWith('/')) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function getToken(): string {
  return (localStorage.getItem(TOKEN_KEY) || '').trim().replace(/^["']|["']$/g, '');
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers instanceof Headers ? Object.fromEntries(init.headers) : init?.headers),
      Authorization: `Bearer ${getToken()}`,
      ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    },
  });

  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    redirectToLogin();
    throw new ApiError('AUTH_REQUIRED', '登录已失效，请重新登录', 401);
  }

  let body: { success?: boolean; data?: T; error?: { code: string; message: string } };
  try {
    body = await res.json();
  } catch {
    throw new ApiError('INTERNAL_ERROR', `响应解析失败（HTTP ${res.status}）`, res.status);
  }
  if (!res.ok || body.success === false) {
    const err = body.error || { code: 'INTERNAL_ERROR', message: `请求失败（HTTP ${res.status}）` };
    throw new ApiError(err.code, err.message, res.status);
  }
  return body.data as T;
}

/**
 * 兼容请求 —— 用于挂载在 /api 下、沿用旧信封 { code, data } 或 { success, data } 的存量接口
 *
 * 为什么需要两个出口：
 *   - /api/v1/* 是本轮新建的严格契约（success/data + error{code,message}）
 *   - /api/knowledge|admin|dashboards|user/* 是存量接口，错误字段叫 message 而非 error.message
 *   v1 走 request()，存量走 requestCompat()，页面层拿到的都是解包后的 data。
 */
async function requestCompat<T>(
  path: string,
  init?: RequestInit,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers instanceof Headers ? Object.fromEntries(init.headers) : init?.headers),
      Authorization: `Bearer ${getToken()}`,
      ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(extraHeaders || {}),
    },
  });

  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    redirectToLogin();
    throw new ApiError('AUTH_REQUIRED', '登录已失效，请重新登录', 401);
  }

  let body: {
    success?: boolean;
    code?: number;
    data?: T;
    message?: string;
    error?: { code?: string; message?: string };
  };
  try {
    body = await res.json();
  } catch {
    throw new ApiError('INTERNAL_ERROR', `响应解析失败（HTTP ${res.status}）`, res.status);
  }

  const legacyCode = typeof body.code === 'number' ? body.code : null;
  const failed = !res.ok || body.success === false || (legacyCode !== null && legacyCode !== 0);
  if (failed) {
    const code =
      body.error?.code ||
      (legacyCode !== null && legacyCode !== 0 ? `HTTP_${legacyCode}` : `HTTP_${res.status}`);
    const message = body.error?.message || body.message || `请求失败（HTTP ${res.status}）`;
    throw new ApiError(code, message, res.status);
  }
  return body.data as T;
}

const json = (data: unknown) => JSON.stringify(data);

/* ────────────────────────── 场景与技能 ────────────────────────── */

export interface ApiScene {
  scene_key: string;
  name: string;
  summary: string;
  icon: string;
  theme_color: string;
  order: number;
  is_business: boolean;
  skill_count?: number;
}

export interface ApiSchemaField {
  type: string;
  title?: string;
  description?: string;
  enum?: string[];
  items?: { type: string };
  format?: string;
}

export interface ApiSkill {
  skill_key: string;
  name: string;
  scene: string;
  summary: string;
  icon: string;
  workflow_version: string;
  execution_mode: string;
  requires_confirmation: boolean;
  live: boolean;
  supported_files?: string[];
  input_schema: { type: string; properties: Record<string, ApiSchemaField>; required?: string[] };
  output_schema?: { properties?: Record<string, ApiSchemaField> };
  permission_status?: 'granted' | 'denied' | 'not_evaluated';
  permission_status_reason?: string;
  input_kind?: string;
  /** 绑定的执行形态（workflow/chat/none…），对话式改造 P0 新增 */
  endpoint_kind?: string | null;
  /** 是否支持对话模式（provider=dify 且 endpoint_kind=chat） */
  chat_enabled?: boolean;
  /** 是否支持「对话式参数收集」模式（endpoint_kind=workflow，P1 新增） */
  slot_enabled?: boolean;
  /** 交互模式判据：chat = 直连对话；slot = 对话收集参数后执行；view = 专属视图面板（无执行语义）；null = 仅表单 */
  interaction_mode?: 'chat' | 'slot' | 'view' | null;
  /** = interaction_mode !== null，前端据此决定默认进入对话模式 */
  interactive_enabled?: boolean;
  /** 视图型技能的面板标识（interaction_mode='view' 时非空），前端据此选渲染哪个面板 */
  view_panel?: string | null;
}

/* ────────────────────────── 对话式技能（P0） ────────────────────────── */

export interface ApiChatSession {
  id: number;
  user_id: number;
  skill_key: string;
  title: string;
  dify_conversation_id: string | null;
  /** chat = 直连 Dify 对话；slot = 本地收集参数后执行 workflow（P1） */
  mode?: 'chat' | 'slot';
  /** 槽位收集进度：{ inputs, last_ask, extractor } */
  slot_state?: { inputs?: Record<string, unknown>; last_ask?: string[]; extractor?: string | null } | null;
  /** 已提交执行的任务编号（tasks.id 是 UUID） */
  task_id?: string | null;
  /** collecting → ready → executing → done */
  status?: string;
  created_at: string;
  updated_at: string;
}

/** 参数收集卡片（meta.kind = 'slot_ask' / 'slot'） */
export interface ApiSlotItem {
  key: string;
  title: string;
  description?: string;
  type?: string;
  enum?: string[] | null;
  required?: boolean;
  is_file?: boolean;
  value?: unknown;
}

export interface ApiSlotCard {
  kind: 'slot';
  skill_key: string;
  skill_name: string;
  filled: ApiSlotItem[];
  missing: ApiSlotItem[];
  optional_missing?: ApiSlotItem[];
  ask_keys?: string[];
  all_slots: ApiSlotItem[];
  ready: boolean;
  filled_count: number;
  total_count: number;
}

/** 执行结果卡片（meta.kind = 'result'） */
export interface ApiResultCard {
  kind: 'result';
  task_id: string | null;
  task_no: string | null;
  status: string;
  summary: string | null;
  fields: Array<{ key: string; value: unknown }>;
  warnings: string[];
  can_retry: boolean;
  skill_name: string | null;
}

export type ApiMessageMeta =
  | (ApiSlotCard & { source?: string; extractor?: string; degraded?: boolean })
  | ApiResultCard
  | ApiHumanInputCard
  | ApiHumanActionMeta
  | { kind: 'human_done'; form_token?: string }
  | null;

/**
 * 人工介入卡片（meta.kind = 'human_input'）—— chatflow 在「人工介入」节点暂停，
 * 等用户点按钮才继续。`actions` 是 Dify 表单声明的按钮，点哪个由后端提交给 Dify。
 *
 * submitted=true 表示这张表单已经被处理过（刷新后按钮不再可点，只留痕迹）。
 */
export interface ApiHumanInputAction {
  id: string;
  title: string;
  button_style?: string;
}

export interface ApiHumanInputCard {
  kind: 'human_input';
  form_token: string;
  form_content: string;
  node_title: string;
  actions: ApiHumanInputAction[];
  submitted?: boolean;
}

/** 用户点击人工介入按钮留下的记录（meta.kind = 'human_action'） */
export interface ApiHumanActionMeta {
  kind: 'human_action';
  action: string;
  form_token: string;
}

export interface ApiChatMessage {
  id: number;
  session_id: number;
  role: 'user' | 'assistant';
  content: string;
  files?: Array<{ file_id: string; name?: string }> | null;
  meta?: ApiMessageMeta;
  created_at: string;
}

/**
 * 发消息（SSE 流式）。
 * 与 request() 同源的鉴权/401 处理，但响应是 text/event-stream，
 * 逐事件回调而不是整包返回。
 */
export async function streamChatMessage(
  sessionId: number,
  body: { query?: string; files?: Array<{ file_id: string; name?: string }> },
  handlers: {
    onDelta: (text: string) => void;
    /** slot 模式：参数收集状态卡（进度/缺失/是否可执行） */
    onSlot?: (card: ApiSlotCard) => void;
    /** chat 模式：chatflow 暂停，需要用户选出后续动作（人工介入） */
    onHumanInput?: (card: ApiHumanInputCard) => void;
    onDone?: (d: {
      message_id: number;
      conversation_id?: string | null;
      answer?: string;
      /** slot 模式：参数是否已收集完整 */
      ready?: boolean;
      /** slot 模式：实际生效的提取器（llm / rules） */
      extractor?: string;
      degraded?: boolean;
      card?: ApiSlotCard | ApiHumanInputCard;
      /** chat 模式：流以「暂停等人工介入」收尾，需要用户点按钮才继续 */
      pending?: boolean;
    }) => void;
    onError?: (message: string) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/v1/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    redirectToLogin();
    throw new ApiError('AUTH_REQUIRED', '登录已失效，请重新登录', 401);
  }

  // 进入 SSE 之前的失败是标准 JSON 信封
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    let message = `请求失败（HTTP ${res.status}）`;
    let code = 'INTERNAL_ERROR';
    try {
      const b = await res.json();
      code = b?.error?.code || code;
      message = b?.error?.message || message;
    } catch {
      /* 保留默认错误 */
    }
    throw new ApiError(code, message, res.status);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        const evt = JSON.parse(line.slice(5).trim());
        if (evt.event === 'delta') handlers.onDelta(evt.text || '');
        else if (evt.event === 'slot') handlers.onSlot?.(evt.card);
        else if (evt.event === 'human_input') handlers.onHumanInput?.(evt.card);
        else if (evt.event === 'done') handlers.onDone?.(evt);
        else if (evt.event === 'error') handlers.onError?.(evt.message || '对话失败');
      } catch {
        /* 跳过无法解析的事件 */
      }
    }
  }
}


export const api = {
  // 场景
  listScenes: (withSkills = false) =>
    request<ApiScene[]>(`/api/v1/scenes?with_skills=${withSkills}`),
  getScene: (sceneKey: string) => request<ApiScene & { skills: ApiSkill[] }>(`/api/v1/scenes/${sceneKey}`),

  // 技能
  listSkills: (params: { scene?: string; query?: string; live?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.scene) qs.set('scene', params.scene);
    if (params.query) qs.set('query', params.query);
    if (params.live !== undefined) qs.set('live', String(params.live));
    return request<ApiSkill[]>(`/api/v1/skills?${qs.toString()}`);
  },
  getSkill: (skillKey: string) => request<ApiSkill>(`/api/v1/skills/${skillKey}`),

  // 文件
  uploadFile: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ file_id: string; name: string; mime_type: string; size_bytes: number }>(
      '/api/v1/files/upload',
      { method: 'POST', body: form },
    );
  },
  getDownloadUrl: (kind: 'staged' | 'artifact', id: string) =>
    request<{ url: string; expires_in_seconds: number }>(`/api/v1/files/${kind}/${id}/download-url`),

  // 任务
  createTask: (p: {
    skill_key: string;
    title?: string;
    inputs?: Record<string, unknown>;
    /** 暂存文件（先走 /api/v1/files/upload 拿 file_id），后端会水合成 Dify 可用的文件 */
    files?: Array<{ file_id: string; name?: string }>;
    execute_now?: boolean;
  }) => request<ApiTask>('/api/v1/tasks', { method: 'POST', body: json(p) }),
  listTasks: (params: { status?: string; scene?: string; q?: string; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && qs.set(k, String(v)));
    return request<ApiTask[]>(`/api/v1/tasks?${qs.toString()}`);
  },
  getTask: (id: string) => request<TaskDetail>(`/api/v1/tasks/${id}`),
  taskAction: (id: string, action: 'execute' | 'cancel' | 'confirm' | 'reject' | 'retry' | 'rerun' | 'archive', body?: Record<string, unknown>) =>
    request<ApiTask>(`/api/v1/tasks/${id}/${action}`, { method: 'POST', body: json(body || {}) }),
  editTask: (id: string, p: { title?: string; inputs?: Record<string, unknown> }) =>
    request<ApiTask>(`/api/v1/tasks/${id}`, { method: 'PATCH', body: json(p) }),
  deleteTask: (id: string) => request<{ deleted: boolean }>(`/api/v1/tasks/${id}`, { method: 'DELETE' }),
  getMetrics: () => request<TaskMetrics>('/api/v1/tasks/metrics'),

  // 对话式技能（P0；发消息走上方 streamChatMessage，SSE 协议）
  chat: {
    createSession: (p: { skill_key: string; title?: string }) =>
      request<ApiChatSession>('/api/v1/chat/sessions', { method: 'POST', body: json(p) }),
    listSessions: (skillKey?: string) =>
      request<ApiChatSession[]>(
        `/api/v1/chat/sessions${skillKey ? `?skill_key=${encodeURIComponent(skillKey)}` : ''}`,
      ),
    getMessages: (sessionId: number) =>
      request<{ session: ApiChatSession; messages: ApiChatMessage[] }>(
        `/api/v1/chat/sessions/${sessionId}/messages`,
      ),
    renameSession: (sessionId: number, title: string) =>
      request<ApiChatSession>(`/api/v1/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        body: json({ title }),
      }),
    deleteSession: (sessionId: number) =>
      request<{ deleted: boolean }>(`/api/v1/chat/sessions/${sessionId}`, { method: 'DELETE' }),

    /** slot 模式：手动补充/修改参数（对话内「一次填完」卡片） */
    updateSlots: (sessionId: number, inputs: Record<string, unknown>, silent = false) =>
      request<{ inputs: Record<string, unknown>; ready: boolean; card: ApiSlotCard; message_id: number | null }>(
        `/api/v1/chat/sessions/${sessionId}/slots`,
        { method: 'PATCH', body: json({ inputs, silent }) },
      ),

    /** slot 模式：参数齐了之后提交执行（异步；结果靠 getExecution 轮询） */
    execute: (sessionId: number) =>
      request<{ task_id: string; task_no: string; status: string; message_id: number }>(
        `/api/v1/chat/sessions/${sessionId}/execute`,
        { method: 'POST' },
      ),

    /** slot 模式：轮询执行结果（任务终态时幂等落一条结果卡片消息） */
    getExecution: (sessionId: number) =>
      request<{ status: string; task_id: string | null; message_id: number | null; card: ApiResultCard | null }>(
        `/api/v1/chat/sessions/${sessionId}/execution`,
      ),

    /**
     * chat 模式：提交人工介入动作（点 Dify 表单上的按钮）。
     * 后端提交后轮询续跑结果，返回下一张表单（paused）或最终回复（finished）；
     * status='running' 表示超时仍在跑 —— 动作已生效，稍后重取会话消息即可。
     */
    submitHumanInput: (sessionId: number, action: string) =>
      request<{
        status: 'paused' | 'finished' | 'running';
        message_id: number | null;
        card?: ApiHumanInputCard;
        answer?: string;
      }>(`/api/v1/chat/sessions/${sessionId}/human-input`, {
        method: 'POST',
        body: json({ action }),
      }),
  },

  // 通知
  listNotifications: (params: { unread_only?: boolean; todos_only?: boolean; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.unread_only) qs.set('unread_only', 'true');
    if (params.todos_only) qs.set('todos_only', 'true');
    if (params.limit) qs.set('limit', String(params.limit));
    return request<ApiNotification[]>(`/api/v1/notifications?${qs.toString()}`);
  },
  unreadCount: () => request<{ unread: number }>('/api/v1/notifications/unread-count'),
  markRead: (id: number) => request<{ done: boolean }>(`/api/v1/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => request<{ done: boolean }>('/api/v1/notifications/read-all', { method: 'POST' }),
  completeTodo: (id: number) => request<{ done: boolean }>(`/api/v1/notifications/${id}/complete-todo`, { method: 'POST' }),

  /* ────────────────────────── 知识库（存量契约 {code,data}） ──────────────────────────
   * 数据集用「场景标识」而非 Dify UUID（company_rules / tender_knowledge），
   * 由后端 difyKnowledgeService 映射到真实 dataset_id —— 前端不感知 UUID。
   */

  knowledge: {
    datasets: () => requestCompat<KnowledgeDataset[]>('/api/knowledge/datasets'),

    documents: (datasetKey: string, query = '') => {
      const qs = new URLSearchParams({ _t: String(Date.now()) });
      if (query) qs.set('q', query);
      return requestCompat<KnowledgeDocument[]>(
        `/api/knowledge/list?${qs.toString()}`,
        undefined,
        { 'x-dataset-id': datasetKey },
      );
    },

    upload: (
      datasetKey: string,
      file: File,
      visibility: 'PUBLIC' | 'PRIVATE',
      authorizedUsers: string[],
    ) => {
      const form = new FormData();
      form.append('file', file);
      form.append('visibility', visibility);
      form.append('authorized_users', JSON.stringify(authorizedUsers));
      return requestCompat<{ id?: string }>(
        '/api/knowledge/upload',
        { method: 'POST', body: form },
        { 'x-dataset-id': datasetKey },
      );
    },

    remove: (datasetKey: string, id: string) =>
      requestCompat<{ message?: string }>(
        `/api/knowledge/${id}`,
        { method: 'DELETE' },
        { 'x-dataset-id': datasetKey },
      ),

    status: (datasetKey: string, id: string) =>
      requestCompat<KnowledgeDocument>(
        `/api/knowledge/status/${id}`,
        undefined,
        { 'x-dataset-id': datasetKey },
      ),

    users: () => requestCompat<KnowledgeUser[]>('/api/knowledge/users'),

    qa: (p: { question: string; dataset_key: string; top_k?: number }) =>
      requestCompat<KnowledgeAnswer>('/api/knowledge/qa', { method: 'POST', body: json(p) }),
  },

  /* ────────────────────────── 业务看板入口（存量契约） ────────────────────────── */

  dashboards: {
    list: () => requestCompat<ApiDashboard[]>('/api/dashboards'),
    adminList: () => requestCompat<ApiDashboard[]>('/api/dashboards/admin'),
    create: (p: {
      name: string;
      url: string;
      description?: string;
      category?: string;
      allowed_roles?: string[];
      sort_order?: number;
    }) => requestCompat<ApiDashboard>('/api/dashboards/admin', { method: 'POST', body: json(p) }),
    update: (id: number, p: Partial<Pick<ApiDashboard, 'name' | 'url' | 'description' | 'category' | 'allowed_roles' | 'sort_order'>>) =>
      requestCompat<ApiDashboard>(`/api/dashboards/admin/${id}`, { method: 'PUT', body: json(p) }),
    remove: (id: number) =>
      requestCompat<{ deleted?: boolean }>(`/api/dashboards/admin/${id}`, { method: 'DELETE' }),
  },

  /* ────────────────── AI 发布的业务看板（Dify 看板生成助手产物） ────────────────── */

  businessDashboard: {
    list: (p: { page?: number; page_size?: number; status?: 'published' | 'archived'; keyword?: string; domain?: string } = {}) => {
      const qs = new URLSearchParams();
      Object.entries(p).forEach(([k, v]) => v !== undefined && v !== '' && qs.set(k, String(v)));
      const q = qs.toString();
      return requestCompat<{ items: ApiBusinessDashboard[]; total: number; page: number; page_size: number }>(
        `/api/business-dashboard${q ? `?${q}` : ''}`,
      );
    },
    detail: (id: string) => requestCompat<ApiBusinessDashboard>(`/api/business-dashboard/${id}`),
    setStatus: (dashboard_ids: string[], status: 'published' | 'archived') =>
      requestCompat<{ count?: number }>('/api/business-dashboard/status', {
        method: 'PUT',
        body: json({ dashboard_ids, status }),
      }),
    setRoles: (id: string, allowed_roles: string[]) =>
      requestCompat<ApiBusinessDashboard>(`/api/business-dashboard/${id}/roles`, {
        method: 'PUT',
        body: json({ allowed_roles }),
      }),
    remove: (id: string) =>
      requestCompat<{ message?: string }>(`/api/business-dashboard/${id}`, { method: 'DELETE' }),
  },

  /* ────────────────────────── 管理后台（存量契约 {success,data}） ────────────────────────── */

  admin: {
    users: (p: { search?: string; role?: string; page?: number; pageSize?: number } = {}) => {
      const qs = new URLSearchParams();
      Object.entries(p).forEach(([k, v]) => v !== undefined && v !== '' && qs.set(k, String(v)));
      return requestCompat<PageResult<AdminUser>>(`/api/admin/users?${qs.toString()}`);
    },
    createUser: (p: { username: string; password: string; display_name?: string; email?: string; role?: string }) =>
      requestCompat<AdminUser>('/api/admin/users', { method: 'POST', body: json(p) }),
    updateUser: (id: number, p: { display_name?: string; email?: string; role?: string }) =>
      requestCompat<AdminUser>(`/api/admin/users/${id}`, { method: 'PUT', body: json(p) }),
    setUserStatus: (id: number, isActive: boolean) =>
      requestCompat<AdminUser>(`/api/admin/users/${id}/status`, {
        method: 'PUT',
        body: json({ is_active: isActive }),
      }),
    resetPassword: (id: number, newPassword: string) =>
      requestCompat<{ message?: string }>(`/api/admin/users/${id}/reset-password`, {
        method: 'POST',
        body: json({ new_password: newPassword }),
      }),
    removeUser: (id: number) =>
      requestCompat<{ message?: string }>(`/api/admin/users/${id}`, { method: 'DELETE' }),

    roles: () => requestCompat<AdminRole[]>('/api/admin/roles'),
    createRole: (p: { name: string; display_name: string; permissions?: string[] }) =>
      requestCompat<AdminRole>('/api/admin/roles', { method: 'POST', body: json(p) }),
    updateRole: (id: number, p: { display_name?: string; permissions?: string[] }) =>
      requestCompat<AdminRole>(`/api/admin/roles/${id}`, { method: 'PUT', body: json(p) }),
    removeRole: (id: number) =>
      requestCompat<{ message?: string }>(`/api/admin/roles/${id}`, { method: 'DELETE' }),

    auditLogs: (p: { username?: string; module?: string; action?: string; page?: number; pageSize?: number } = {}) => {
      const qs = new URLSearchParams();
      Object.entries(p).forEach(([k, v]) => v !== undefined && v !== '' && qs.set(k, String(v)));
      return requestCompat<PageResult<AuditLog>>(`/api/admin/audit-logs?${qs.toString()}`);
    },

    /** 数据库连通检测（成功即通；失败抛 503）—— 数据体在顶层，这里只关心成败 */
    configHealth: () => requestCompat<void>('/api/admin/config/health'),
    newsKeywords: () => requestCompat<NewsKeywordGroup[]>('/api/admin/config/news_keywords'),
    toggleNewsKeyword: (id: number) =>
      requestCompat<void>(`/api/admin/config/news_keywords/${id}/toggle`, { method: 'PATCH' }),
    marketingConfig: () => requestCompat<RefList[]>('/api/admin/config/marketing'),
    beautyRndConfig: () => requestCompat<RefList[]>('/api/admin/config/beautyrnd'),

    /** 角色 × 技能授权视图（v1 严格契约） */
    permissionRoles: () =>
      request<Array<{ name: string; display_name: string; is_builtin: boolean }>>('/api/v1/permissions/roles'),
    /** 旧版权限码清单（角色管理页勾选项，源自各技能 legacy.app_id） */
    permissionCodes: () =>
      request<Array<{ code: string; name: string }>>('/api/v1/permissions/codes'),
    permissionSkills: (role: string) =>
      request<SkillPermissionRow[]>(`/api/v1/permissions/skills?role=${encodeURIComponent(role)}`),
    grantSkill: (skillKey: string, roleName: string, granted: boolean, dataScope = 'self') =>
      request<unknown>(`/api/v1/permissions/skills/${encodeURIComponent(skillKey)}`, {
        method: 'PUT',
        body: json({ role_name: roleName, granted, data_scope: dataScope }),
      }),
    clearSkillGrant: (skillKey: string, roleName: string) =>
      request<{ removed: boolean }>(
        `/api/v1/permissions/skills/${encodeURIComponent(skillKey)}?role=${encodeURIComponent(roleName)}`,
        { method: 'DELETE' },
      ),
  },

  /* ────────────────────────── 个人中心（存量契约 {success,data}） ────────────────────────── */

  account: {
    profile: () => requestCompat<AccountProfile>('/api/user/profile'),
    updateProfile: (p: { display_name: string; department?: string; email?: string }) =>
      requestCompat<{ message?: string }>('/api/user/profile', { method: 'PUT', body: json(p) }),
    changePassword: (oldPassword: string, newPassword: string) =>
      requestCompat<{ message?: string }>('/api/user/change-password', {
        method: 'POST',
        body: json({ old_password: oldPassword, new_password: newPassword }),
      }),
    /** 头像走 base64 DataURL（后端上限 ~350KB） */
    uploadAvatar: (avatarDataUrl: string) =>
      requestCompat<{ message?: string }>('/api/user/avatar', {
        method: 'POST',
        body: json({ avatar_data: avatarDataUrl }),
      }),
    sessions: () => requestCompat<AccountSession[]>('/api/user/sessions'),
    revokeSession: (jti: string) =>
      requestCompat<{ message?: string }>(`/api/user/sessions/${encodeURIComponent(jti)}`, { method: 'DELETE' }),
    revokeAllSessions: () =>
      requestCompat<{ message?: string }>('/api/user/sessions', { method: 'DELETE' }),
  },
};

/* ────────────────────────── 后端契约类型 ────────────────────────── */

export interface ApiTask {
  id: string;
  task_no: string;
  title: string;
  skill_key: string;
  scene: string;
  status: 'draft' | 'queued' | 'running' | 'waiting_confirmation' | 'succeeded' | 'failed' | 'cancelled' | 'archived';
  input?: { inputs?: Record<string, unknown>; files?: Array<{ file_id: string; name?: string }> };
  result?: unknown;
  summary?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  trace_id?: string | null;
  run_count: number;
  created_by: number;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiRun {
  id: string;
  run_no: number;
  status: string;
  provider?: string;
  binding_key?: string;
  workflow_run_id?: string | null;
  duration_ms?: number | null;
  error?: { code?: string; message?: string } | null;
  started_at: string;
  finished_at?: string | null;
}

export interface ApiEvent {
  id: number;
  event_type: string;
  from_status?: string | null;
  to_status?: string | null;
  actor?: string;
  detail?: Record<string, unknown> | null;
  created_at: string;
}

export interface ApiArtifact {
  id: string;
  kind: string;
  name?: string;
  mime_type?: string;
  size_bytes?: number;
  created_at: string;
}

export interface TaskDetail {
  task: ApiTask;
  runs: ApiRun[];
  events: ApiEvent[];
  artifacts: ApiArtifact[];
}

export interface TaskMetrics {
  created: number;
  by_status: Record<string, number>;
  success_rate: number | null;
  failure_rate: number | null;
  confirmation_rate: number | null;
  avg_success_seconds: number | null;
  by_scene: Record<string, number>;
  by_day: Record<string, number>;
}

export interface ApiNotification {
  id: number;
  type: string;
  title: string;
  body?: string | null;
  task_id?: string | null;
  is_todo: boolean;
  todo_done: boolean;
  read_at?: string | null;
  created_at: string;
}

/* ────────────────────────── 分页信封 ────────────────────────── */

export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

/* ────────────────────────── 知识库 ────────────────────────── */

export interface KnowledgeDataset {
  dataset_key: string;
  name: string;
  description?: string;
  document_count: number;
}

export interface KnowledgeDocument {
  id: string;
  dataset_id?: string;
  dify_document_id?: string | null;
  file_name: string;
  tenant_id?: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  /** PENDING / INDEXING / COMPLETED / FAILED */
  parse_status: string;
  authorized_users?: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeUser {
  username: string;
  display_name: string;
  role: string;
  role_display_name?: string;
}

export interface KnowledgeReference {
  document_name: string;
  segment: string;
  score: number | null;
}

export interface KnowledgeAnswer {
  /** 问答模型可用时的回答；不可用时为 null，前端降级展示检索片段 */
  answer: string | null;
  answer_available: boolean;
  references: KnowledgeReference[];
  note?: string;
}

/* ────────────────────────── 业务看板 ────────────────────────── */

export interface ApiDashboard {
  id: number;
  name: string;
  url: string;
  description?: string | null;
  category?: string | null;
  allowed_roles?: string[] | string | null;
  sort_order?: number | null;
  created_at?: string;
}

/**
 * AI 发布的业务看板（business_dashboard 表，由 Dify「看板生成助手」发布）。
 *
 * `view_url` 历史数据里可能是 http://<发布那一刻的主机>:<端口>/... 的绝对地址，
 * 换机器/换端口即失效 —— 因此渲染时**优先用 html_path 按当前 origin 拼**，
 * view_url 仅作兜底。
 */
export interface ApiBusinessDashboard {
  dashboard_id: string;
  title: string;
  domain: string;
  description?: string | null;
  html_path?: string | null;
  view_url: string;
  source: string;
  allowed_roles: string[] | string | null;
  published_at: string;
  /** 磁盘产物是否存在（交付还原可能只带库表、缺 HTML 卷） */
  /**
   * 产物是否真实存在于「本后端可见的存储目录」。
   * - true/false：后端的看板存储目录存在，判定可信；
   * - null：后端根本没挂载该目录（如宿主上直接跑 dev 后端、文件在容器卷里）→ 判定未知，
   *   前端不应据此标注「产物缺失」。
   */
  file_exists?: boolean | null;

}

/**
 * 解析看板可访问地址：优先用 html_path 按**当前站点**拼，避免历史数据里
 * 写死的 `http://localhost:8081/...` 在别的端口/域名下 404。
 * 两者都没有时才回落原值。
 */
export function resolveDashboardUrl(d: Pick<ApiBusinessDashboard, 'html_path' | 'view_url'>): string {
  const path = d.html_path || '';
  if (path.startsWith('/')) return `${window.location.origin}${path}`;
  const raw = d.view_url || '';
  if (/^https?:\/\//i.test(raw)) {
    // 绝对地址：同路径不同 Host 时改指向当前站点；纯外部地址原样返回
    try {
      const u = new URL(raw);
      if (u.pathname.startsWith('/dashboard-files/')) return `${window.location.origin}${u.pathname}${u.search}`;
    } catch {
      /* ignore */
    }
    return raw;
  }
  return raw ? `${window.location.origin}${raw.startsWith('/') ? '' : '/'}${raw}` : '';
}

/* ────────────────────────── 管理后台 ────────────────────────── */

export interface AdminUser {
  id: number;
  username: string;
  display_name: string;
  email?: string | null;
  role: string;
  role_label?: string;
  is_active: boolean;
  avatar_url?: string | null;
  created_at: string;
  last_login_at?: string | null;
}

export interface AdminRole {
  id: number;
  name: string;
  display_name: string;
  is_builtin: boolean;
  permissions: string[];
  created_at?: string;
}

export interface AuditLog {
  id: number;
  user_id?: number | null;
  username?: string | null;
  module: string;
  action: string;
  target_data?: string | null;
  details?: Record<string, unknown> | null;
  status?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  created_at: string;
}

export interface SkillPermissionRow {
  skill_key: string;
  name: string;
  scene: string;
  status: 'granted' | 'denied' | 'not_evaluated';
  reason?: string;
  data_scope?: string | null;
  source?: string | null;
}

/** 系统配置：资讯关键词分组（ref_news_keywords） */
export interface NewsKeywordGroup extends Record<string, unknown> {
  id: number;
  group_name: string;
  sort_order?: number;
  is_active: boolean;
  keyword?: string[] | null;
  creator?: string | null;
}

/** 系统配置：参考数据清单（ref_* 表） */
export interface RefList {
  id: string;
  label: string;
  name: string[];
  description?: string;
}

/* ────────────────────────── 个人中心 ────────────────────────── */

export interface AccountProfile {
  id: number;
  username: string;
  display_name: string;
  email?: string | null;
  role: string;
  department?: string | null;
  role_label?: string;
  is_active: boolean;
  avatar_url?: string | null;
  created_at: string;
  last_login_at?: string | null;
}

export interface AccountSession {
  jti: string;
  device_info?: string | null;
  ip_address?: string | null;
  created_at: string;
  expires_at: string;
  revoked: boolean;
  is_current: boolean;
}
