/**
 * 审计与历史服务：组装审核记录时间轴
 */
import { db, delay } from './db';
import type { AuditLog } from '@/types';

export interface HistoryEntry {
  log: AuditLog;
  icon: string;
  color: string;
}

export const auditService = {
  async listByTask(taskId: string): Promise<AuditLog[]> {
    return (await db.getAuditLogsByTask(taskId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  /** 组装时间轴（含图标与颜色映射） */
  async getTimeline(taskId: string): Promise<HistoryEntry[]> {
    const logs = (await db.getAuditLogsByTask(taskId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return logs.map((log) => {
      const { icon, color } = mapAction(log.action);
      return { log, icon, color };
    });
  },
};

function mapAction(action: string): { icon: string; color: string } {
  if (action.includes('创建') || action.includes('上传')) return { icon: 'PlusCircle', color: '#1677ff' };
  if (action.includes('解析') || action.includes('审核')) return { icon: 'RefreshCw', color: '#13c2c2' };
  if (action.includes('接受')) return { icon: 'CheckCircle', color: '#52c41a' };
  if (action.includes('编辑')) return { icon: 'Edit3', color: '#1677ff' };
  if (action.includes('忽略')) return { icon: 'Ban', color: '#8c8c8c' };
  if (action.includes('转人工') || action.includes('复核')) return { icon: 'ClipboardCheck', color: '#fa8c16' };
  if (action.includes('提交')) return { icon: 'Send', color: '#722ed1' };
  if (action.includes('确认')) return { icon: 'ShieldCheck', color: '#52c41a' };
  if (action.includes('退回')) return { icon: 'Undo2', color: '#f5222d' };
  if (action.includes('报告') || action.includes('生成')) return { icon: 'FileText', color: '#1677ff' };
  return { icon: 'Clock', color: '#8c8c8c' };
}
