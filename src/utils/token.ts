/**
 * Auth Token 管理：存储/读取 Supabase JWT access_token
 * 所有需要鉴权的 API 请求都从这里读取 token 放入 Authorization 头
 */
const TOKEN_KEY = 'auth:accessToken';
const REFRESH_TOKEN_KEY = 'auth:refreshToken';

export function getAccessToken(): string | null {
  return localStorage.getItem(`qszk:${TOKEN_KEY}`);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(`qszk:${REFRESH_TOKEN_KEY}`);
}

export function setTokens(accessToken: string, refreshToken?: string): void {
  localStorage.setItem(`qszk:${TOKEN_KEY}`, accessToken);
  if (refreshToken) {
    localStorage.setItem(`qszk:${REFRESH_TOKEN_KEY}`, refreshToken);
  }
}

export function clearTokens(): void {
  localStorage.removeItem(`qszk:${TOKEN_KEY}`);
  localStorage.removeItem(`qszk:${REFRESH_TOKEN_KEY}`);
}

/** 构造鉴权请求头 */
export function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
