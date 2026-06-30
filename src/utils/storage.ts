/**
 * localStorage 轻量持久化封装
 * 统一命名空间 qszk:*，支持 JSON 序列化与异常兜底。
 */
const PREFIX = 'qszk';

export function storageKey(name: string): string {
  return `${PREFIX}:${name}`;
}

export function loadStorage<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(storageKey(name));
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveStorage<T>(name: string, value: T): boolean {
  try {
    localStorage.setItem(storageKey(name), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(name: string): void {
  try {
    localStorage.removeItem(storageKey(name));
  } catch {
    /* ignore */
  }
}

/** 清空本系统所有持久化数据（仅用于演示重置，需二次确认） */
export function clearAllStorage(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`${PREFIX}:`)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/** 重置演示数据快捷方法 */
export function resetDemoData(): void {
  clearAllStorage();
}
