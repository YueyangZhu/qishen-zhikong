/**
 * 路由表与登录守卫
 * 数据持久化后刷新可访问；未登录跳转 /login
 * 角色不符跳转 /403
 */
import React, { Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Skeleton, Result, Button } from 'antd';
import { useAuthStore } from '@/store/useAuthStore';
import type { Role } from '@/types';
import MainLayout from '@/layouts/MainLayout';
import BackendWakeGuard from '@/components/BackendWakeGuard';

// 路由懒加载：拆分首屏与按需加载
const LoginPage = React.lazy(() => import('@/pages/LoginPage'));
const DashboardPage = React.lazy(() => import('@/pages/DashboardPage'));
const ReviewListPage = React.lazy(() => import('@/pages/ReviewListPage'));
const ReviewNewPage = React.lazy(() => import('@/pages/ReviewNewPage'));
const ReviewProgressPage = React.lazy(() => import('@/pages/ReviewProgressPage'));
const ReviewDetailPage = React.lazy(() => import('@/pages/ReviewDetailPage'));
const FieldsConfirmPage = React.lazy(() => import('@/pages/FieldsConfirmPage'));
const LegalReviewPage = React.lazy(() => import('@/pages/LegalReviewPage'));
const ReportListPage = React.lazy(() => import('@/pages/ReportListPage'));
const ReportDetailPage = React.lazy(() => import('@/pages/ReportDetailPage'));
const ReviewHistoryPage = React.lazy(() => import('@/pages/ReviewHistoryPage'));
const RuleListPage = React.lazy(() => import('@/pages/RuleListPage'));
const NotFoundPage = React.lazy(() => import('@/pages/NotFoundPage'));

/** 路由级加载骨架屏（与页面内 Skeleton 风格一致） */
function Loading() {
  return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { currentUser, initialized } = useAuthStore();
  if (!initialized) return <Loading />;
  if (!currentUser) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { currentUser, initialized } = useAuthStore();
  if (!initialized) return <Loading />;
  if (currentUser) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/** 角色守卫：当前用户角色不在 allowed 内时显示 403 */
function RequireRole({ children, allowed }: { children: React.ReactNode; allowed: Role[] }) {
  const { currentUser } = useAuthStore();
  if (!currentUser) return <Navigate to="/login" replace />;
  if (!allowed.includes(currentUser.role)) {
    return (
      <Result
        status="403"
        title="无访问权限"
        subTitle="当前角色无权访问该页面"
        extra={<Button type="primary" onClick={() => window.history.back()}>返回上一页</Button>}
      />
    );
  }
  return <>{children}</>;
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <PublicOnly>
        <Suspense fallback={<Loading />}>
          <LoginPage />
        </Suspense>
      </PublicOnly>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <BackendWakeGuard>
          <MainLayout />
        </BackendWakeGuard>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      {
        path: 'dashboard',
        element: (
          <Suspense fallback={<Loading />}>
            <DashboardPage />
          </Suspense>
        ),
      },
      {
        path: 'reviews',
        element: (
          <Suspense fallback={<Loading />}>
            <ReviewListPage />
          </Suspense>
        ),
      },
      {
        path: 'reviews/new',
        element: (
          <RequireRole allowed={['purchaser']}>
            <Suspense fallback={<Loading />}>
              <ReviewNewPage />
            </Suspense>
          </RequireRole>
        ),
      },
      {
        path: 'reviews/:id/progress',
        element: (
          <Suspense fallback={<Loading />}>
            <ReviewProgressPage />
          </Suspense>
        ),
      },
      {
        path: 'reviews/:id/fields',
        element: (
          <Suspense fallback={<Loading />}>
            <FieldsConfirmPage />
          </Suspense>
        ),
      },
      {
        path: 'reviews/:id',
        element: (
          <Suspense fallback={<Loading />}>
            <ReviewDetailPage />
          </Suspense>
        ),
      },
      {
        path: 'reviews/:id/history',
        element: (
          <Suspense fallback={<Loading />}>
            <ReviewHistoryPage />
          </Suspense>
        ),
      },
      {
        path: 'legal-reviews/:id',
        element: (
          <RequireRole allowed={['legal', 'admin']}>
            <Suspense fallback={<Loading />}>
              <LegalReviewPage />
            </Suspense>
          </RequireRole>
        ),
      },
      {
        path: 'reports',
        element: (
          <Suspense fallback={<Loading />}>
            <ReportListPage />
          </Suspense>
        ),
      },
      {
        path: 'reports/:id',
        element: (
          <Suspense fallback={<Loading />}>
            <ReportDetailPage />
          </Suspense>
        ),
      },
      {
        path: 'rules',
        element: (
          <Suspense fallback={<Loading />}>
            <RuleListPage />
          </Suspense>
        ),
      },
      { path: '404', element: <NotFoundPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/404" replace /> },
]);
