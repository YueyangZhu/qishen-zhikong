/**
 * 认证服务（接入 Supabase Auth，通过后端 /api/auth/* 接口）
 *
 * 流程：
 * 1. login：调后端 /api/auth/login，后端验证 Supabase Auth，返回 access_token + 用户信息
 * 2. token 存 localStorage，后续 API 请求自动携带
 * 3. logout：调后端 /api/auth/logout 撤销 token，清除本地存储
 */
import { DEMO_ACCOUNTS } from '@/constants';
import { loadStorage, saveStorage, removeStorage } from '@/utils/storage';
import { setTokens, clearTokens, getAccessToken } from '@/utils/token';
import { API_BASE } from '@/utils/apiBase';
import type { User, Role } from '@/types';

const CURRENT_USER_KEY = 'auth:currentUser';

export const authService = {
  /** 登录：调后端验证 Supabase Auth */
  async login(email: string, password: string): Promise<User> {
    const resp = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || '登录失败，请检查账号密码');
    }
    const data = await resp.json();
    setTokens(data.access_token, data.refresh_token);
    const user = data.user as User;
    saveStorage(CURRENT_USER_KEY, user);
    return user;
  },

  /** 登出：撤销 token，清除本地存储
   *  后端调用加 5 秒超时，避免 Render 冷启动时登出卡顿 */
  async logout(): Promise<void> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch {
      // 登出失败不报错（超时或网络错误），继续清除本地
    }
    clearTokens();
    removeStorage(CURRENT_USER_KEY);
  },

  /** 获取当前登录用户（从本地存储恢复） */
  getCurrentUser(): User | null {
    return loadStorage<User | null>(CURRENT_USER_KEY, null);
  },

  /** 是否已登录（token + 用户都存在） */
  isLoggedIn(): boolean {
    return !!getAccessToken() && !!this.getCurrentUser();
  },

  /** 切换演示角色（重新登录该角色） */
  async switchRole(role: Role): Promise<User | null> {
    const account = DEMO_ACCOUNTS.find((a) => a.role === role);
    if (!account) return null;
    return await this.login(account.email, account.password);
  },

  /** 获取演示账号列表 */
  getDemoAccounts() {
    return DEMO_ACCOUNTS;
  },
};
