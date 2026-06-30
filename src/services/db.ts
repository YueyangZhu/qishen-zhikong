/**
 * 数据访问层：通过 dataApi 调用后端 /api/data/* 接口。
 * 所有 service 通过 db 读写，保证数据一致。
 *
 * 说明：本版本已从 localStorage 切换为后端 API（Supabase + FastAPI）。
 * - 所有方法均为 async，调用方需 await（service 文件已是 async 函数）。
 * - 种子数据由 backend/supabase/seed.py 写入 Supabase，前端不再初始化。
 * - localStorage 不再使用（仅 token 仍由 utils/token 管理）。
 */
import { calcRiskCount, getMaxRiskLevel } from '@/utils/logic';
import { now } from '@/utils/format';
import {
  apiListUsers,
  apiListTasks,
  apiGetTask,
  apiUpsertTask,
  apiDeleteTask,
  apiListRisks,
  apiUpsertRisk,
  apiBatchSaveRisks,
  apiListFields,
  apiUpsertField,
  apiBatchSaveFields,
  apiGetDocument,
  apiUpsertDocument,
  apiListReports,
  apiGetReport,
  apiUpsertReport,
  apiListRules,
  apiGetRule,
  apiUpsertRule,
  apiDeleteRule,
  apiListRuleVersions,
  apiAddRuleVersion,
  apiListAuditLogs,
  apiAddAuditLog,
  checkDbHealth,
} from './dataApi';
import type {
  User,
  ReviewTask,
  RiskItem,
  ExtractedField,
  ReviewReport,
  RiskRule,
  AuditLog,
  RiskLevel,
  ParsedDocument,
} from '@/types';

/** 规则历史版本记录：保存规则某个版本的完整快照 */
export interface RuleVersionRecord {
  id: string;
  ruleId: string;
  version: number;
  snapshot: RiskRule;
  changeNote: string; // 变更说明
  operatorName: string;
  createdAt: string;
}

/** 模拟网络延迟（保留以兼容 service 文件中 `await delay(ms)` 调用） */
export const delay = (ms = 220): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 兼容旧引用的 STORAGE_KEYS 常量。
 * 新版本不再使用 localStorage，此对象保留为空对象仅用于向后兼容。
 */
export const STORAGE_KEYS: Record<string, string> = {};

/**
 * 检查后端是否可用（供 App.tsx 启动时调用）。
 * 调用 /api/data/db-health，无需鉴权。
 */
export async function checkBackend(): Promise<boolean> {
  return checkDbHealth();
}

/**
 * 初始化数据库。
 * 新版本无需前端初始化种子数据（种子由 backend/supabase/seed.py 写入 Supabase）。
 * 这里仅做一次后端健康检查，便于在启动时发现连接问题。
 */
export async function initDB(): Promise<void> {
  await checkDbHealth();
}

/**
 * 数据迁移：旧版本报告快照补全。
 * 新版本由后端处理报告快照，前端为空操作（保留导出以兼容 App.tsx 调用）。
 */
export async function migrateReports(): Promise<void> {
  // no-op：报告快照由后端或 reportService.generate 生成
}

export const db = {
  // ===== users =====
  getUsers: async (): Promise<User[]> => apiListUsers<User>(),
  getUserById: async (id: string): Promise<User | undefined> => {
    const users = await apiListUsers<User>();
    return users.find((u) => u.id === id);
  },

  // ===== tasks =====
  getTasks: async (): Promise<ReviewTask[]> => apiListTasks<ReviewTask>(),
  getTaskById: async (id: string): Promise<ReviewTask | undefined> => {
    const task = await apiGetTask<ReviewTask>(id);
    return task ?? undefined;
  },
  saveTasks: async (tasks: ReviewTask[]): Promise<void> => {
    // 后端无 tasks 批量端点，并行 upsert
    await Promise.all(tasks.map((t) => apiUpsertTask<ReviewTask>(t)));
  },
  upsertTask: async (task: ReviewTask): Promise<ReviewTask> => {
    return apiUpsertTask<ReviewTask>(task);
  },
  removeTask: async (id: string): Promise<void> => {
    // 后端 FK ON DELETE CASCADE 自动级联删除 risks/fields/audit_logs/documents
    await apiDeleteTask(id);
  },

  // ===== risks =====
  getRisks: async (): Promise<RiskItem[]> => apiListRisks<RiskItem>(),
  getRisksByTask: async (taskId: string): Promise<RiskItem[]> =>
    apiListRisks<RiskItem>(taskId),
  getRiskById: async (id: string): Promise<RiskItem | undefined> => {
    // 后端无按 id 单查风险接口，列全量后过滤
    const all = await apiListRisks<RiskItem>();
    return all.find((r) => r.id === id);
  },
  saveRisks: async (risks: RiskItem[]): Promise<void> => {
    // 后端 batch 端点为「覆盖式：先删该 task 的所有风险再插入」。
    // 按 reviewTaskId 分组，每组调一次 batch。
    const groups = new Map<string, RiskItem[]>();
    risks.forEach((r) => {
      const arr = groups.get(r.reviewTaskId);
      if (arr) arr.push(r);
      else groups.set(r.reviewTaskId, [r]);
    });
    await Promise.all(
      Array.from(groups.values()).map((group) => apiBatchSaveRisks<RiskItem>(group)),
    );
  },
  upsertRisk: async (risk: RiskItem): Promise<RiskItem> => {
    return apiUpsertRisk<RiskItem>(risk);
  },

  // ===== documents（真实 AI 解析的合同文档，按 taskId 索引） =====
  getDocumentByTask: async (taskId: string): Promise<ParsedDocument | undefined> => {
    const doc = await apiGetDocument<ParsedDocument & { reviewTaskId: string }>(taskId);
    return doc ?? undefined;
  },
  upsertDocument: async (taskId: string, doc: ParsedDocument): Promise<void> => {
    // 后端 documents 表以 review_task_id 为主键，注入 taskId
    await apiUpsertDocument<ParsedDocument & { reviewTaskId: string }>({
      ...doc,
      reviewTaskId: taskId,
    });
  },

  // ===== fields =====
  getFields: async (): Promise<ExtractedField[]> => apiListFields<ExtractedField>(),
  getFieldsByTask: async (taskId: string): Promise<ExtractedField[]> =>
    apiListFields<ExtractedField>(taskId),
  saveFields: async (fields: ExtractedField[]): Promise<void> => {
    // 后端 batch 端点为「覆盖式：先删该 task 的所有字段再插入」。
    const groups = new Map<string, ExtractedField[]>();
    fields.forEach((f) => {
      const arr = groups.get(f.reviewTaskId);
      if (arr) arr.push(f);
      else groups.set(f.reviewTaskId, [f]);
    });
    await Promise.all(
      Array.from(groups.values()).map((group) => apiBatchSaveFields<ExtractedField>(group)),
    );
  },
  upsertField: async (field: ExtractedField): Promise<ExtractedField> => {
    return apiUpsertField<ExtractedField>(field);
  },

  // ===== reports =====
  getReports: async (): Promise<ReviewReport[]> => apiListReports<ReviewReport>(),
  getReportById: async (id: string): Promise<ReviewReport | undefined> => {
    const r = await apiGetReport<ReviewReport>(id);
    return r ?? undefined;
  },
  getReportByTask: async (taskId: string): Promise<ReviewReport | undefined> => {
    // 后端无按 task_id 单查接口，列全量后过滤
    const all = await apiListReports<ReviewReport>();
    return all.find((r) => r.reviewTaskId === taskId);
  },
  saveReports: async (reports: ReviewReport[]): Promise<void> => {
    // 后端无 reports 批量端点，并行 upsert
    await Promise.all(reports.map((r) => apiUpsertReport<ReviewReport>(r)));
  },
  upsertReport: async (report: ReviewReport): Promise<ReviewReport> => {
    return apiUpsertReport<ReviewReport>(report);
  },

  // ===== rules =====
  getRules: async (): Promise<RiskRule[]> => apiListRules<RiskRule>(),
  getRuleById: async (id: string): Promise<RiskRule | undefined> => {
    const r = await apiGetRule<RiskRule>(id);
    return r ?? undefined;
  },
  saveRules: async (rules: RiskRule[]): Promise<void> => {
    // 后端无 rules 批量端点，并行 upsert
    await Promise.all(rules.map((r) => apiUpsertRule<RiskRule>(r)));
  },
  upsertRule: async (rule: RiskRule): Promise<RiskRule> => {
    return apiUpsertRule<RiskRule>(rule);
  },
  removeRule: async (id: string): Promise<void> => {
    // 后端 FK ON DELETE CASCADE 自动级联删除 rule_versions
    await apiDeleteRule(id);
  },

  // ===== rule versions（历史版本记录） =====
  getRuleVersions: async (ruleId: string): Promise<RuleVersionRecord[]> =>
    apiListRuleVersions<RuleVersionRecord>(ruleId),
  addRuleVersion: async (record: RuleVersionRecord): Promise<RuleVersionRecord> => {
    return apiAddRuleVersion<RuleVersionRecord>(record);
  },

  // ===== audit logs =====
  getAuditLogs: async (): Promise<AuditLog[]> => apiListAuditLogs<AuditLog>(),
  getAuditLogsByTask: async (taskId: string): Promise<AuditLog[]> =>
    apiListAuditLogs<AuditLog>(taskId),
  addAuditLog: async (log: Omit<AuditLog, 'id' | 'createdAt'>): Promise<AuditLog> => {
    // 后端自动生成 id（UUID）与 created_at；将 log 强制转换为完整 AuditLog 形状以匹配 api 类型签名。
    // 实际请求体仅包含 log 字段（id/createdAt 在运行时不存在），后端插入时自动填充。
    return apiAddAuditLog<AuditLog>(log as AuditLog);
  },

  // ===== 重新计算任务风险统计 =====
  recalcTaskStats: async (taskId: string): Promise<ReviewTask | undefined> => {
    const task = await db.getTaskById(taskId);
    if (!task) return;
    const risks = await db.getRisksByTask(taskId);
    const riskCount = calcRiskCount(risks);
    const riskLevelMax: RiskLevel | null = getMaxRiskLevel(risks);
    const updated: ReviewTask = {
      ...task,
      riskCount,
      riskLevelMax,
      updatedAt: now(),
    };
    await db.upsertTask(updated);
    return updated;
  },
};
