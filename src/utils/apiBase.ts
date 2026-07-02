/**
 * 后端 API 地址推导（运行时）
 *
 * 优先级：
 * 1. 构建时环境变量 VITE_API_BASE（Render 构建时注入，非空时直接使用）
 * 2. 运行时自动推导（浏览器环境）：
 *    - 本地开发（localhost/127.0.0.1）→ http://127.0.0.1:8000
 *    - Render 公网部署（hostname 含 "frontend"）→ 替换为 "backend" 推导后端域名
 *      例：qishen-frontend.onrender.com → https://qishen-backend.onrender.com
 *    - 其他公网域名 → 返回空字符串走相对路径（适用于前后端同域部署）
 * 3. 兜底 → http://127.0.0.1:8000
 *
 * 这样即使 Render 控制台未手动设置 VITE_API_BASE，前端也能正确推导出后端地址。
 */

function deriveApiBase(): string {
  // 1. 构建时环境变量（最高优先级）
  const envBase = (import.meta.env.VITE_API_BASE ?? '').trim();
  if (envBase) return envBase;

  // 2. 运行时推导（浏览器环境）
  if (typeof window !== 'undefined' && window.location) {
    const { hostname } = window.location;

    // 本地开发：localhost / 127.0.0.1 → 指向本地后端 8000 端口
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://127.0.0.1:8000';
    }

    // Render 公网部署：根据命名规则推导后端域名
    // 前端 hostname 通常为 qishen-frontend.onrender.com
    // 后端 hostname 通常为 qishen-backend.onrender.com
    if (hostname.includes('frontend')) {
      const backendHost = hostname.replace('frontend', 'backend');
      return `https://${backendHost}`;
    }

    // 其他公网部署：返回空字符串走相对路径（适用于前后端同域反向代理）
    return '';
  }

  // 3. 兜底
  return 'http://127.0.0.1:8000';
}

/** 后端 API 基础地址（供 apiClient / dataApi / authService 共用） */
export const API_BASE = deriveApiBase();

/** 后端是否为同域相对路径模式（API_BASE 为空） */
export const isSameOriginApi = API_BASE === '';

/** 后端健康检查地址 */
export const healthUrl = isSameOriginApi ? '/health' : `${API_BASE}/health`;
