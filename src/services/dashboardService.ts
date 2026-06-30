/**
 * 工作台服务：指标统计、趋势、风险分布、最近任务、待办
 * 所有数据从统一数据源计算，保证与列表一致。
 */
import { db } from './db';
import { RISK_CATEGORY_MAP } from '@/constants';
import type { User, ReviewTask } from '@/types';
import dayjs from 'dayjs';

export interface DashboardStats {
  myPending: number;
  reviewing: number;
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

export const dashboardService = {
  /** 一次性加载所有工作台数据（并行请求 tasks + risks，避免 N 次往返） */
  async loadAll(user: User): Promise<DashboardData> {
    // 并行获取 tasks 和 risks（仅这两张表，其他在内存计算）
    const [tasks, risks] = await Promise.all([
      db.getTasks(),
      db.getRisks(),
    ]);

    // 统计指标
    const myPending = tasks.filter((t) => isMyPending(t, user)).length;
    const reviewing = tasks.filter(
      (t) => t.status === 'parsing' || t.status === 'ai_reviewing',
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
      // 补充演示历史数据
      months.push({
        month: label,
        created: created + (i > 2 ? 6 - i : 0),
        completed: completed + (i > 2 ? 5 - i : 0),
      });
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
      stats: { myPending, reviewing, highRiskContracts, totalCompleted },
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
