/**
 * 真实 AI 审核内存状态（Zustand）
 * 暂存上传文件的 File 对象和审核参数，供进度页取用。
 * 不持久化：刷新页面后丢失，真实 AI 任务刷新后无法恢复。
 */
import { create } from 'zustand';

export interface RealAIOptions {
  contractType?: string;
  myRole?: 'buyer' | 'seller';
  reviewFocus?: string[];
  reviewNote?: string;
}

interface RealAIState {
  /** 上传的文件对象（跳转后进度页取用） */
  file: File | null;
  /** 审核参数 */
  options: RealAIOptions | null;
  /** 对应任务 ID */
  taskId: string | null;
  /** 防止重复执行 */
  running: boolean;
  /** 设置真实 AI 审核上下文 */
  set: (file: File, options: RealAIOptions, taskId: string) => void;
  /** 标记开始执行 */
  markRunning: () => void;
  /** 清理（完成后调用） */
  clear: () => void;
}

export const useRealAIStore = create<RealAIState>((set) => ({
  file: null,
  options: null,
  taskId: null,
  running: false,
  set: (file, options, taskId) => set({ file, options, taskId, running: false }),
  markRunning: () => set({ running: true }),
  clear: () => set({ file: null, options: null, taskId: null, running: false }),
}));
