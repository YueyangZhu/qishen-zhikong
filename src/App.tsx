/**
 * 应用根：初始化认证状态 + 启动数据库
 */
import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/router';
import { useAuthStore } from '@/store/useAuthStore';
import { initDB, migrateReports } from '@/services/db';

export default function App() {
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    initDB();
    migrateReports(); // 旧数据迁移：补全缺失的报告快照
    hydrate();
    // 监听强制登出事件（token 过期且 refresh 失败时触发）
    // triggerForceLogout 已同步清除 token + currentUser，
    // 这里只需同步把 store 置空并跳转，避免 hydrate 恢复旧用户导致循环闪烁
    const onForceLogout = () => {
      useAuthStore.setState({ currentUser: null, initialized: true });
      window.location.replace('/login');
    };
    window.addEventListener('auth:force-logout', onForceLogout);
    return () => window.removeEventListener('auth:force-logout', onForceLogout);
  }, [hydrate]);

  return <RouterProvider router={router} />;
}
