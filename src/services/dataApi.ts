/**
 * 数据 API 客户端：封装所有 /api/data/* 接口
 * 供 db.ts 调用，替代直接读写 localStorage
 *
 * 所有接口自动携带 Authorization: Bearer <token>
 * 401 时自动用 refresh_token 刷新 access_token 并重试一次
 */
import { authHeaders, getRefreshToken, setTokens, clearTokens } from '@/utils/token';
import { removeStorage } from '@/utils/storage';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000';
const DEFAULT_TIMEOUT = 30_000;
const CURRENT_USER_KEY = 'auth:currentUser';

/** 统一响应格式 */
interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  message: string | null;
  error: string | null;
}

/** 刷新中标记，避免并发刷新 */
let refreshing: Promise<boolean> | null = null;

/** 用 refresh_token 刷新 access_token，返回是否刷新成功 */
async function refreshAccessToken(): Promise<boolean> {
  if (refreshing) return refreshing;
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  refreshing = (async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!resp.ok) return false;
      const data = await resp.json();
      setTokens(data.access_token, data.refresh_token);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** 触发全局登出（避免循环依赖 authService，用自定义事件）
 *  必须同步清除 token + currentUser，否则 hydrate 会从 localStorage
 *  恢复旧用户，导致 /login → /dashboard 反复跳转（页面闪烁） */
function triggerForceLogout(): void {
  clearTokens();
  removeStorage(CURRENT_USER_KEY);
  window.dispatchEvent(new CustomEvent('auth:force-logout'));
}

/** 带超时和鉴权的 fetch 封装 */
async function authFetch<T>(
  path: string,
  options: RequestInit = {},
  timeout = DEFAULT_TIMEOUT,
): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });
    } catch (e) {
      // 把晦涩的底层网络错误转成友好中文提示，页面层 message.error(e.message) 直接可用
      if (e instanceof Error) {
        if (e.name === 'AbortError' || e.message.includes('aborted')) {
          throw new Error('请求超时，请检查网络后重试');
        }
        if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
          throw new Error('网络连接失败，请检查网络后重试');
        }
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };

  let resp = await doFetch();

  // 401：尝试用 refresh_token 刷新后重试一次
  if (resp.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      // 刷新成功，用新 token 重试原请求
      resp = await doFetch();
    }
    if (resp.status === 401) {
      // 刷新失败或重试仍 401，强制登出
      triggerForceLogout();
      throw new Error('登录已过期，请重新登录');
    }
  }

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }
  const result = (await resp.json()) as ApiResponse<T>;
  if (!result.success) {
    throw new Error(result.error || result.message || '请求失败');
  }
  return result.data as T;
}

/** 后端返回的 snake_case 数据转为前端 camelCase */
function toCamel(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(toCamel);
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const camelKey = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      result[camelKey] = toCamel(v);
    }
    return result;
  }
  return obj;
}

// ===== Users =====
export async function apiListUsers<T>(): Promise<T[]> {
  return toCamel(await authFetch<T[]>('/api/data/users')) as T[];
}

// ===== Tasks =====
export async function apiListTasks<T>(): Promise<T[]> {
  return toCamel(await authFetch<T[]>('/api/data/tasks')) as T[];
}

export async function apiGetTask<T>(id: string): Promise<T | null> {
  return toCamel(await authFetch<T | null>(`/api/data/tasks/${id}`)) as T | null;
}

export async function apiUpsertTask<T>(task: T): Promise<T> {
  return toCamel(await authFetch<T>('/api/data/tasks', {
    method: 'POST',
    body: JSON.stringify({ data: task }),
  })) as T;
}

export async function apiDeleteTask(id: string): Promise<void> {
  await authFetch<{ success: boolean }>(`/api/data/tasks/${id}`, { method: 'DELETE' });
}

// ===== Risks =====
export async function apiListRisks<T>(taskId?: string): Promise<T[]> {
  const query = taskId ? `?task_id=${encodeURIComponent(taskId)}` : '';
  return toCamel(await authFetch<T[]>(`/api/data/risks${query}`)) as T[];
}

export async function apiUpsertRisk<T>(risk: T): Promise<T> {
  return toCamel(await authFetch<T>('/api/data/risks', {
    method: 'POST',
    body: JSON.stringify({ data: risk }),
  })) as T;
}

export async function apiBatchSaveRisks<T>(risks: T[]): Promise<T[]> {
  return toCamel(await authFetch<T[]>('/api/data/risks/batch', {
    method: 'POST',
    body: JSON.stringify({ items: risks }),
  })) as T[];
}

// ===== Fields =====
export async function apiListFields<T>(taskId?: string): Promise<T[]> {
  const query = taskId ? `?task_id=${encodeURIComponent(taskId)}` : '';
  return toCamel(await authFetch<T[]>(`/api/data/fields${query}`)) as T[];
}

export async function apiUpsertField<T>(field: T): Promise<T> {
  return toCamel(await authFetch<T>('/api/data/fields', {
    method: 'POST',
    body: JSON.stringify({ data: field }),
  })) as T;
}

export async function apiBatchSaveFields<T>(fields: T[]): Promise<T[]> {
  return toCamel(await authFetch<T[]>('/api/data/fields/batch', {
    method: 'POST',
    body: JSON.stringify({ items: fields }),
  })) as T[];
}

// ===== Documents =====
export async function apiGetDocument<T>(taskId: string): Promise<T | null> {
  return toCamel(await authFetch<T | null>(`/api/data/documents/${taskId}`)) as T | null;
}

export async function apiUpsertDocument<T>(doc: T): Promise<T> {
  return toCamel(await authFetch<T>('/api/data/documents', {
    method: 'POST',
    body: JSON.stringify({ data: doc }),
  })) as T;
}

// ===== Reports =====
export async function apiListReports<T>(): Promise<T[]> {
  return toCamel(await authFetch<T[]>('/api/data/reports')) as T[];
}

export async function apiGetReport<T>(id: string): Promise<T | null> {
  return toCamel(await authFetch<T | null>(`/api/data/reports/${id}`)) as T | null;
}

export async function apiUpsertReport<T>(report: T): Promise<T> {
  return toCamel(await authFetch<T>('/api/data/reports', {
    method: 'POST',
    body: JSON.stringify({ data: report }),
  })) as T;
}

// ===== Rules =====
export async function apiListRules<T>(): Promise<T[]> {
  return toCamel(await authFetch<T[]>('/api/data/rules')) as T[];
}

export async function apiGetRule<T>(id: string): Promise<T | null> {
  return toCamel(await authFetch<T | null>(`/api/data/rules/${id}`)) as T | null;
}

export async function apiUpsertRule<T>(rule: T): Promise<T> {
  return toCamel(await authFetch<T>('/api/data/rules', {
    method: 'POST',
    body: JSON.stringify({ data: rule }),
  })) as T;
}

export async function apiDeleteRule(id: string): Promise<void> {
  await authFetch<{ success: boolean }>(`/api/data/rules/${id}`, { method: 'DELETE' });
}

// ===== Rule Versions =====
export async function apiListRuleVersions<T>(ruleId: string): Promise<T[]> {
  return toCamel(await authFetch<T[]>(`/api/data/rule-versions?rule_id=${encodeURIComponent(ruleId)}`)) as T[];
}

export async function apiAddRuleVersion<T>(record: T): Promise<T> {
  return toCamel(await authFetch<T>('/api/data/rule-versions', {
    method: 'POST',
    body: JSON.stringify({ data: record }),
  })) as T;
}

// ===== Audit Logs =====
export async function apiListAuditLogs<T>(taskId?: string): Promise<T[]> {
  const query = taskId ? `?task_id=${encodeURIComponent(taskId)}` : '';
  return toCamel(await authFetch<T[]>(`/api/data/audit-logs${query}`)) as T[];
}

export async function apiAddAuditLog<T>(log: T): Promise<T> {
  return toCamel(await authFetch<T>('/api/data/audit-logs', {
    method: 'POST',
    body: JSON.stringify({ data: log }),
  })) as T;
}

// ===== 数据库健康检查 =====
export async function checkDbHealth(): Promise<boolean> {
  try {
    const resp = await fetch(`${API_BASE}/api/data/db-health`, { method: 'GET' });
    const data = await resp.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}
