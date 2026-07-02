/**
 * 真实 AI 审核状态（Zustand + IndexedDB 持久化）
 * 暂存上传文件的 File 对象和审核参数，供进度页取用。
 *
 * 持久化策略：
 * - File 对象通过 IndexedDB 持久化（localStorage 存不了二进制）
 * - 草稿编辑页可从 IndexedDB 恢复 File，无需重新上传
 * - 任务完成或失败后清理
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
  /** 设置真实 AI 审核上下文（同时持久化到 IndexedDB） */
  set: (file: File, options: RealAIOptions, taskId: string) => void;
  /** 标记开始执行 */
  markRunning: () => void;
  /** 清理（完成后调用，同时清 IndexedDB） */
  clear: () => void;
  /** 从 IndexedDB 恢复 File（草稿编辑页用） */
  restore: (taskId: string) => Promise<File | null>;
}

// ===== IndexedDB 文件持久化 =====
const DB_NAME = 'qszk_realai';
const STORE_NAME = 'files';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(taskId: string, file: File): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(file, taskId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('[useRealAIStore] IndexedDB 写入失败:', e);
  }
}

async function idbGet(taskId: string): Promise<File | null> {
  try {
    const db = await openDB();
    const file = await new Promise<File | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(taskId);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return file;
  } catch (e) {
    console.warn('[useRealAIStore] IndexedDB 读取失败:', e);
    return null;
  }
}

async function idbDelete(taskId: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(taskId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn('[useRealAIStore] IndexedDB 删除失败:', e);
  }
}

export const useRealAIStore = create<RealAIState>((set, get) => ({
  file: null,
  options: null,
  taskId: null,
  running: false,
  set: (file, options, taskId) => {
    set({ file, options, taskId, running: false });
    // 异步持久化到 IndexedDB，供草稿编辑页恢复
    idbPut(taskId, file);
  },
  markRunning: () => set({ running: true }),
  clear: () => {
    const { taskId } = get();
    if (taskId) idbDelete(taskId);
    set({ file: null, options: null, taskId: null, running: false });
  },
  restore: async (taskId: string) => {
    const file = await idbGet(taskId);
    if (file) {
      set({ file, taskId, options: get().options });
    }
    return file;
  },
}));
