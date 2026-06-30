/**
 * 审核报告服务
 */
import { db, delay } from './db';
import { generateReportSnapshot, calcRiskCount, getMajorRisks } from '@/utils/logic';
import { genId, now } from '@/utils/format';
import type { ReviewReport, User, RiskItem } from '@/types';
import { DEMO_PARSED_DOCUMENT } from '@/mock/contractText';

export interface ReportFilter {
  keyword?: string;
  status?: string;
  reviewTaskId?: string;
}

export const reportService = {
  async list(filter: ReportFilter = {}): Promise<ReviewReport[]> {
    let reports = await db.getReports();
    if (filter.status) reports = reports.filter((r) => r.status === filter.status);
    if (filter.reviewTaskId) {
      reports = reports.filter((r) => r.reviewTaskId === filter.reviewTaskId);
    }
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase();
      reports = reports.filter(
        (r) =>
          r.reportNo.toLowerCase().includes(kw) ||
          (r.snapshot?.contractName.toLowerCase().includes(kw) ?? false),
      );
    }
    return [...reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async get(id: string): Promise<ReviewReport | undefined> {
    return db.getReportById(id);
  },

  /** 生成报告（基于审核快照），幂等：已生成则返回 */
  async generate(taskId: string, user: User): Promise<ReviewReport> {
    const task = await db.getTaskById(taskId);
    if (!task) throw new Error('审核任务不存在');
    if (task.status !== 'completed') {
      throw new Error('任务尚未完成法务复核，无法生成报告');
    }

    const existing = await db.getReportByTask(taskId);
    if (existing && existing.status === 'generated' && existing.snapshot) {
      return existing;
    }

    // 创建生成中报告
    const versionNo = existing ? existing.versionNo + 1 : 1;
    const report: ReviewReport = {
      id: existing?.id ?? genId('RPT'),
      reviewTaskId: taskId,
      reportNo: `QSZK-RPT-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
      versionNo,
      snapshot: null,
      status: 'generating',
      errorMsg: null,
      createdAt: now(),
    };
    await db.upsertReport(report);

    const risks = await db.getRisksByTask(taskId);
    const fields = await db.getFieldsByTask(taskId);
    const aiSummary = buildAISummary(risks);
    const legalOpinion = task.legalOpinion ?? '暂无法务意见';
    const snapshot = generateReportSnapshot(
      task,
      fields,
      risks,
      aiSummary,
      legalOpinion,
      task.legalConclusion ?? 'sign_after_modify',
    );

    const finalReport: ReviewReport = {
      ...report,
      snapshot,
      status: 'generated',
    };
    await db.upsertReport(finalReport);

    await db.addAuditLog({
      reviewTaskId: taskId,
      objectType: 'report',
      objectId: finalReport.id,
      action: '生成审核报告',
      operatorId: user.id,
      operatorName: user.name,
      beforeState: null,
      afterState: '已生成',
      remark: `报告编号 ${finalReport.reportNo}，版本 v${finalReport.versionNo}`,
    });

    return finalReport;
  },

  /** 重试失败的报告生成 */
  async retry(taskId: string, user: User): Promise<ReviewReport> {
    const existing = await db.getReportByTask(taskId);
    if (existing && existing.status === 'failed') {
      await db.upsertReport({ ...existing, status: 'generating', errorMsg: null });
    }
    return reportService.generate(taskId, user);
  },

  /** 获取任务的文档（用于报告引用） */
  getDocument() {
    return DEMO_PARSED_DOCUMENT;
  },
};

/** 生成 AI 审核摘要文本 */
function buildAISummary(risks: RiskItem[]): string {
  const count = calcRiskCount(risks);
  const major = getMajorRisks(risks);
  const types = Array.from(new Set(risks.map((r) => r.riskType)));
  const typeNames = types.slice(0, 4).join('、');
  const highCount = count.high;
  const mediumCount = count.medium;

  let summary = `本次共识别 ${risks.length} 项风险，其中高风险 ${highCount} 项、中风险 ${mediumCount} 项、低风险 ${count.low} 项、提示项 ${count.notice} 项。`;
  if (typeNames) {
    summary += `主要风险集中在 ${typeNames} 等方面。`;
  }
  if (major.length > 0) {
    summary += `建议重点关注 ${major.length} 项重大风险，并在签署前完成条款修改。`;
  } else {
    summary += `未发现重大风险，建议按常规流程处理。`;
  }
  summary += '本审核结果由AI辅助生成，仅供合同初审参考，不构成正式法律意见。';
  return summary;
}
