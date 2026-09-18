/**
 * /api/v1 API 客户端 —— 新版前端访问后端的唯一出口
 *
 * 约定：
 *   - JWT 取旧系统同一存储键 blue_os_token（登录入口不重复做，复用旧登录页）
 *   - 响应统一解包 { success, data }；失败抛 ApiError（code/message 来自后端错误模型）
 *   - 401 → 清 token 回旧登录页
 */

const TOKEN_KEY = 'blue_os_token';

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
    window.location.href = '/'; // 回旧登录页
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
  createTask: (p: { skill_key: string; title?: string; inputs?: Record<string, unknown>; execute_now?: boolean }) =>
    request<ApiTask>('/api/v1/tasks', { method: 'POST', body: json(p) }),
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
  listNotifications: (params: { unread_only?: boolean; todos_only?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.unread_only) qs.set('unread_only', 'true');
    if (params.todos_only) qs.set('todos_only', 'true');
    return request<ApiNotification[]>(`/api/v1/notifications?${qs.toString()}`);
  },
  unreadCount: () => request<{ unread: number }>('/api/v1/notifications/unread-count'),
  markRead: (id: number) => request<{ done: boolean }>(`/api/v1/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => request<{ done: boolean }>('/api/v1/notifications/read-all', { method: 'POST' }),
  completeTodo: (id: number) => request<{ done: boolean }>(`/api/v1/notifications/${id}/complete-todo`, { method: 'POST' }),
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
