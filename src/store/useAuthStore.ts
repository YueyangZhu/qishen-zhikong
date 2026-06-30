/**
 * 认证状态（Zustand）
 * 全局唯一会话状态：currentUser、loading、登录/退出/切换角色
 *
 * 接入 Supabase Auth 后，switchRole 变为异步（重新登录）
 */
import { create } from 'zustand';
import { authService } from '@/services/authService';
import type { User, Role } from '@/types';

interface AuthState {
  currentUser: User | null;
  initialized: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  switchRole: (role: Role) => Promise<void>;
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  currentUser: null,
  initialized: false,
  loading: false,

  /** 启动时从 localStorage 恢复（token 也在 localStorage，自动恢复） */
  hydrate() {
    const user = authService.getCurrentUser();
    set({ currentUser: user, initialized: true });
  },

  async login(email, password) {
    set({ loading: true });
    try {
      const user = await authService.login(email, password);
      set({ currentUser: user, loading: false });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  async logout() {
    set({ loading: true });
    await authService.logout();
    set({ currentUser: null, loading: false });
  },

  /** 切换演示角色（重新登录该角色） */
  async switchRole(role) {
    set({ loading: true });
    try {
      const user = await authService.switchRole(role);
      if (user) {
        set({ currentUser: user, loading: false });
      } else {
        set({ loading: false });
      }
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },
}));
