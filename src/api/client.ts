/**
 * /api/v1 API 客户端 —— 新版前端访问后端的唯一出口
 *
 * 约定：
 *   - JWT 取旧系统同一存储键 blue_os_token（登录入口不重复做，复用旧登录页）
 *   - 响应统一解包 { success, data }；失败抛 ApiError（code/message 来自后端错误模型）
 *   - 401 → 清 token 回旧登录页；若当前处于 /next 下则附带 ?redirect= 以便登录后回跳
 */

const TOKEN_KEY = 'blue_os_token';

/** 登录回跳参数名（LoginScreen 侧同源读取，改名需同步两处） */
export const REDIRECT_PARAM = 'redirect';

/** 新版工作台路由前缀；此前缀下的会话失效需要登录后回跳 */
const NEXT_PREFIX = '/next';

/**
 * 会话失效统一处理：清 token 并把用户送到登录页。
 *
 * 为什么不直接 `location.href = '/'`：
 *   旧系统本身就是登录页，回 `/` 就够；但 /next 是新入口，它没有自己的登录页，
 *   一旦被踢回 `/`，用户登录后只会落在旧桌面系统，永远回不到 /next —— 表现为
 *   「新界面打不开 / 登录完还是旧系统」。故 /next 下需带上回跳地址。
 *
 * 防死循环：回跳地址只允许站内相对路径且必须以 /next 开头，登录后再次 401
 * 也会重新带上 redirect，不会指向 `/?redirect=...` 自身。
 */
function redirectToLogin(): void {
  const { pathname, search } = window.location;
  if (pathname === NEXT_PREFIX || pathname.startsWith(`${NEXT_PREFIX}/`)) {
    const back = encodeURIComponent(`${pathname}${search}`);
    window.location.href = `/?${REDIRECT_PARAM}=${back}`;
    return;
  }
  window.location.href = '/';
}

/**
 * 供旧版 fetchWithAuth（src/utils/authFetch.ts）复用的会话失效处理。
 *
 * 旧实现只 removeItem + dispatch('auth-unauthorized')，靠旧 App.tsx 监听事件切回登录页；
 * 但 /next 下没有这个监听者，token 被静默删除、页面既不跳转也不报错。
 * 故：/next 下直接跳登录页（带回跳），其余路径交回旧行为。
 */
export function handleUnauthorized(): void {
  const { pathname } = window.location;
  if (pathname === NEXT_PREFIX || pathname.startsWith(`${NEXT_PREFIX}/`)) {
    redirectToLogin();
  }
}

/**
 * 读取并消费登录回跳地址（登录成功后调用，返回值非空即应整页跳转）。
 *
 * 安全：经 URL 规范化后再校验同源 + /next 前缀，可挡掉 `//evil.com`、
 * `https://evil.com`、`/next/../evil` 之类的开放重定向构造。
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
  if (url.pathname !== NEXT_PREFIX && !url.pathname.startsWith(`${NEXT_PREFIX}/`)) return null;
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
