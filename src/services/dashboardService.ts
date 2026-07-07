/**
 * 工作台服务：指标统计、趋势、风险分布、最近任务、待办
 * 所有数据从统一数据源计算，保证与列表一致。
 */
import { db } from './db';
import { RISK_CATEGORY_MAP } from '@/constants';
import type { User, ReviewTask, ReviewStatus } from '@/types';
import dayjs from 'dayjs';

export interface DashboardStats {
  myPending: number;
  reviewing: number; // 业务人员视角：parsing + ai_reviewing
  legalReviewing: number; // 法务视角：pending_legal
  adminPending: number; // 管理员视角：pending_business + pending_legal
  highRiskContracts: number;
  totalCompleted: number; // 累计完成（替代原 monthCompleted）
}

interface DashboardData {
  stats: DashboardStats;
  trends: { month: string; created: number; completed: number }[];
  riskTypes: { name: string; value: number }[];
  riskLevels: { name: string; value: number; color: string }[];
  recentTasks: ReviewTask[];
  todos: ReviewTask[];
}

/** 按角色返回可见的审核状态列表
 * - 法务：只看待法务复核、已完成
 * - 管理员：排除草稿/解析中/AI审核中（这些只有业务人员能操作）
 * - 业务人员：全部状态
 */
function getAllowedStatuses(role: string): ReviewStatus[] | null {
  if (role === 'legal') return ['pending_legal', 'completed'];
  if (role === 'admin') return ['pending_business', 'pending_legal', 'completed', 'failed'];
  return null; // purchaser 等其他角色不做限制
}

export const dashboardService = {
  /** 一次性加载所有工作台数据（并行请求 tasks + risks，避免 N 次往返） */
  async loadAll(user: User): Promise<DashboardData> {
    // 并行获取 tasks 和 risks（仅这两张表，其他在内存计算）
    const [allTasks, risks] = await Promise.all([
      db.getTasks(),
      db.getRisks(),
    ]);

    // 按角色过滤可见任务：法务/管理员不显示草稿/解析中/AI审核中
    const allowed = getAllowedStatuses(user.role);
    const tasks = allowed ? allTasks.filter((t) => allowed.includes(t.status)) : allTasks;

    // 统计指标（按角色视角）
    const myPending = tasks.filter((t) => isMyPending(t, user)).length;
    const reviewing = allTasks.filter(
      (t) => t.status === 'parsing' || t.status === 'ai_reviewing',
    ).length; // 业务人员视角：始终统计真实解析/AI审核中数量
    const legalReviewing = allTasks.filter((t) => t.status === 'pending_legal').length;
    const adminPending = allTasks.filter(
      (t) => t.status === 'pending_business' || t.status === 'pending_legal',
    ).length;
    const highRiskContracts = tasks.filter(
      (t) => t.riskLevelMax === 'high' && t.status !== 'completed' && t.status !== 'failed',
    ).length;
    const totalCompleted = tasks.filter((t) => t.status === 'completed').length;

    // 趋势（近 6 个月）
    const months: { month: string; created: number; completed: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const m = dayjs().subtract(i, 'month');
      const label = m.format('YYYY-MM');
      const created = tasks.filter((t) => dayjs(t.createdAt).isSame(m, 'month')).length;
      const completed = tasks.filter(
        (t) => t.completedAt && dayjs(t.completedAt).isSame(m, 'month'),
      ).length;
      months.push({ month: label, created, completed });
    }

    // 风险类型分布
    const typeMap = new Map<string, number>();
    risks.forEach((r) => {
      typeMap.set(r.riskType, (typeMap.get(r.riskType) ?? 0) + 1);
    });
    const riskTypes = Array.from(typeMap.entries())
      .map(([type, value]) => ({
        name: RISK_CATEGORY_MAP[type as keyof typeof RISK_CATEGORY_MAP]?.label ?? type,
        value,
      }))
      .sort((a, b) => b.value - a.value);

    // 风险等级分布（所有任务的风险项总数）
    const high = risks.filter((r) => r.riskLevel === 'high').length;
    const medium = risks.filter((r) => r.riskLevel === 'medium').length;
    const low = risks.filter((r) => r.riskLevel === 'low').length;
    const notice = risks.filter((r) => r.riskLevel === 'notice').length;
    const riskLevels = [
      { name: '高风险', value: high, color: '#f5222d' },
      { name: '中风险', value: medium, color: '#fa8c16' },
      { name: '低风险', value: low, color: '#52c41a' },
      { name: '提示项', value: notice, color: '#7c8696' },
    ];

    // 最近任务
    const recentTasks = [...tasks]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 6);

    // 待办
    const todos = tasks
      .filter((t) => isMyPending(t, user))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return {
      stats: { myPending, reviewing, legalReviewing, adminPending, highRiskContracts, totalCompleted },
      trends: months,
      riskTypes,
      riskLevels,
      recentTasks,
      todos,
    };
  },
};

function isMyPending(t: ReviewTask, user: User): boolean {
  if (user.role === 'purchaser') return t.status === 'pending_business' && t.creatorId === user.id;
  if (user.role === 'legal') return t.status === 'pending_legal';
  return t.status === 'pending_business' || t.status === 'pending_legal';
}
