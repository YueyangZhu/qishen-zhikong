/**
 * 核心业务纯函数（可测试）
 * 对应 docs/测试清单.md 第三节：状态转移、提交校验、统计、报告快照。
 */
import type {
  ReviewStatus,
  RiskStatus,
  RiskItem,
  RiskLevel,
  RiskCount,
  ReviewTask,
  ExtractedField,
  ReportSnapshot,
  LegalConclusion,
  ContractParagraph,
  ContractSection,
  ParagraphType,
} from '@/types';
import { DISCLAIMER, RISK_LEVEL_MAP } from '@/constants';

// ===== 合同段落类型识别（与后端 pdf_service._detect_type 规则一致）=====

/** 首部段（甲乙方信息）识别正则 */
const HEADER_PATTERN = /^(甲方|乙方|供方|需方|发包方|承包方|委托方|受托方|出租方|承租方|买方|卖方|定作方|承揽方|采购方|供应方|卖受人|买受人|出让人|受让人|招标方|投标方|发包人|承包人|委托人|受托人|出租人|承租人|订立人|协议方)[（(：: 　]/;
/** 签署段开头识别正则 */
const SIGNATURE_PATTERN = /^(签署|签字|盖章|签订日期|签订地点|签约地点|签约日期|本合同一式|双方签字|双方盖章|甲方签章|乙方签章|甲方（签章|乙方（签章|甲方盖章|乙方盖章)/;
/** 签署段末尾特征正则 */
const SIGNATURE_TAIL_PATTERN = /签字（盖章）|（签字盖章）|（盖章）|签字日期|盖章日期/;

/**
 * 推导段落类型（前端兜底识别，与后端 _detect_type 规则一致）
 * 用于旧数据（无 type 字段）的运行时识别。
 */
export function inferParagraphType(para: ContractParagraph, idx: number): ParagraphType {
  // 已有 type 字段直接返回
  if (para.type) return para.type;
  const firstLine = para.text.split('\n', 1)[0].trim();
  // 签署段优先识别
  if (SIGNATURE_PATTERN.test(firstLine) || SIGNATURE_TAIL_PATTERN.test(para.text)) return 'signature';
  // 首部段（甲乙方信息）
  if (HEADER_PATTERN.test(firstLine)) return 'header';
  // 标题段：第一段、无条款号、文本简短
  if (idx === 1 && !para.clauseNo && firstLine.length <= 30) return 'title';
  return 'body';
}

/**
 * 基于 paragraphs 自动生成 sections（用于样例合同回退路径）
 * 规则与后端 _split_paragraphs 的章节边界判定一致。
 */
export function buildSectionsFromParagraphs(paras: ContractParagraph[]): ContractSection[] {
  const sections: ContractSection[] = [];
  let currentParas: string[] = [];
  let currentTitle = '合同首部';
  let currentNo = '首部';

  const flush = () => {
    if (currentParas.length > 0) {
      sections.push({
        id: `s${sections.length + 1}`,
        title: currentTitle,
        clauseNo: currentNo,
        paragraphIds: currentParas.slice(),
      });
      currentParas = [];
    }
  };

  paras.forEach((p, i) => {
    const type = inferParagraphType(p, i + 1);
    if (type === 'title') {
      flush();
      currentTitle = p.text.slice(0, 30);
      currentNo = '标题';
    } else if (type === 'header') {
      if (currentNo !== '首部' && currentNo !== '标题') {
        flush();
        currentTitle = '合同主体';
        currentNo = '首部';
      }
    } else if (type === 'signature') {
      flush();
      currentTitle = p.clauseTitle || '签署落款';
      currentNo = '签署';
    } else {
      // body：条款编号变化则切节
      if (p.clauseNo && p.clauseNo !== currentNo) {
        flush();
        currentNo = p.clauseNo;
        currentTitle = p.clauseTitle || p.clauseNo;
      }
    }
    currentParas.push(p.id);
  });
  flush();

  return sections;
}

/** 审核任务状态转移规则（PRD 8.2）
 *
 * 说明：
 * - draft → pending_business：真实 AI 审核快速通道（createTaskWithAIResult 直接生成结果）
 * - parsing → pending_business：异常恢复路径（getProgress 检测到已完成但状态卡住时直接 finishReview）
 * - failed → pending_business：真实 AI 失败后用 Mock 数据补全继续审核
 */
const REVIEW_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  draft: ['parsing', 'pending_business'],
  parsing: ['ai_reviewing', 'failed', 'pending_business'],
  ai_reviewing: ['pending_business', 'failed'],
  pending_business: ['pending_legal'],
  pending_legal: ['pending_business', 'completed'],
  completed: [],
  failed: ['parsing', 'pending_business'],
};

/** 校验审核任务状态转移是否合法 */
export function canTransitionReviewStatus(from: ReviewStatus, to: ReviewStatus): boolean {
  return REVIEW_TRANSITIONS[from]?.includes(to) ?? false;
}

/** 风险状态转移规则（PRD 8.3） */
const RISK_TRANSITIONS: Record<RiskStatus, RiskStatus[]> = {
  // pending 允许转 confirmed：法务可直接确认未处理风险
  pending: ['accepted', 'edited', 'ignored', 'manual_review', 'confirmed'],
  accepted: ['pending', 'confirmed', 'edited'],
  edited: ['pending', 'confirmed', 'edited'],
  // ignored 允许转 edited：法务审核阶段可对已忽略风险给出最终修改建议
  ignored: ['pending', 'confirmed', 'edited'],
  manual_review: ['confirmed', 'edited', 'ignored', 'pending'],
  // confirmed 允许转 edited：法务可修改已确认风险的建议
  confirmed: ['pending', 'edited'],
};

/** 校验风险状态转移是否合法 */
export function canTransitionRiskStatus(from: RiskStatus, to: RiskStatus): boolean {
  return RISK_TRANSITIONS[from]?.includes(to) ?? false;
}

/** 已处理状态集合（不再阻断提交） */
export const PROCESSED_RISK_STATUSES: RiskStatus[] = [
  'accepted',
  'edited',
  'ignored',
  'manual_review',
  'confirmed',
];

/** 是否已处理 */
export function isRiskProcessed(status: RiskStatus): boolean {
  return PROCESSED_RISK_STATUSES.includes(status);
}

/** 计算风险数量统计 */
export function calcRiskCount(risks: RiskItem[]): RiskCount {
  const count: RiskCount = { high: 0, medium: 0, low: 0, notice: 0 };
  risks.forEach((r) => {
    count[r.riskLevel] += 1;
  });
  return count;
}

/** 计算最高风险等级 */
export function getMaxRiskLevel(risks: RiskItem[]): RiskLevel | null {
  if (risks.length === 0) return null;
  let max: RiskLevel | null = null;
  let maxRank = 0;
  risks.forEach((r) => {
    const rank = RISK_LEVEL_MAP[r.riskLevel].rank;
    if (rank > maxRank) {
      maxRank = rank;
      max = r.riskLevel;
    }
  });
  return max;
}

/** 风险评分（0-100，越高风险越大）
 * high=25, medium=12, low=4, notice=1，最高 100 */
export function calcRiskScore(risks: RiskItem[]): number {
  let score = 0;
  risks.forEach((r) => {
    if (r.riskLevel === 'high') score += 25;
    else if (r.riskLevel === 'medium') score += 12;
    else if (r.riskLevel === 'low') score += 4;
    else if (r.riskLevel === 'notice') score += 1;
  });
  return Math.min(score, 100);
}

/** 已处理/未处理数量 */
export function getProcessedStats(risks: RiskItem[]): {
  total: number;
  processed: number;
  pending: number;
} {
  const total = risks.length;
  const processed = risks.filter((r) => isRiskProcessed(r.status)).length;
  return { total, processed, pending: total - processed };
}

/** 置信度等级 */
export function getConfidenceLevel(confidence: number): {
  level: 'high' | 'medium' | 'low';
  label: string;
  needReview: boolean;
} {
  if (confidence >= 0.85) return { level: 'high', label: '高置信度', needReview: false };
  if (confidence >= 0.6) return { level: 'medium', label: '建议复核', needReview: true };
  return { level: 'low', label: '低置信度', needReview: true };
}

/** 提交法务复核前置校验（PRD P07/P08） */
export interface SubmitCheckResult {
  canSubmit: boolean;
  reasons: string[];
}

export function checkCanSubmitForLegalReview(
  task: ReviewTask,
  risks: RiskItem[],
  hasUnsavedEdit: boolean,
): SubmitCheckResult {
  const reasons: string[] = [];

  // 1. 所有高风险已处理
  const unprocessedHigh = risks.filter(
    (r) => r.riskLevel === 'high' && !isRiskProcessed(r.status),
  );
  if (unprocessedHigh.length > 0) {
    reasons.push(`存在 ${unprocessedHigh.length} 条未处理的高风险，必须先处理`);
  }

  // 2. 无未保存编辑
  if (hasUnsavedEdit) {
    reasons.push('存在未保存的修改建议，请先保存');
  }

  // 3. 合同基本信息已确认
  if (!task.fieldsConfirmed) {
    reasons.push('合同抽取字段尚未确认，请先确认合同信息');
  }

  // 4. 任务状态必须为待人工确认
  if (task.status !== 'pending_business') {
    reasons.push(`当前任务状态为「${task.status}」，无法提交`);
  }

  return { canSubmit: reasons.length === 0, reasons };
}

/** 重大风险 = 最终确认/接受/编辑 的高风险（已忽略不进重大风险） */
export function getMajorRisks(risks: RiskItem[]): RiskItem[] {
  return risks.filter(
    (r) => r.riskLevel === 'high' && ['confirmed', 'accepted', 'edited', 'manual_review'].includes(r.status),
  );
}

/** 报告快照生成（基于提交时的风险处理结果） */
export function generateReportSnapshot(
  task: ReviewTask,
  fields: ExtractedField[],
  risks: RiskItem[],
  aiSummary: string,
  legalOpinion: string,
  legalConclusion: LegalConclusion,
): ReportSnapshot {
  const riskCount = calcRiskCount(risks);
  const riskScore = calcRiskScore(risks);
  const overallRiskLevel = getMaxRiskLevel(risks) ?? 'low';
  const majorRisks = getMajorRisks(risks);
  return {
    contractName: task.contractName,
    contractNo: task.contractNo,
    counterparty: task.counterparty,
    amount: task.amount,
    currency: task.currency,
    contractType: task.contractType,
    reviewFocus: task.reviewFocus,
    fields,
    risks,
    riskCount,
    riskScore,
    overallRiskLevel,
    aiSummary,
    legalOpinion,
    legalConclusion,
    majorRisks,
    disclaimer: DISCLAIMER,
    generatedAt: new Date().toISOString(),
  };
}

/** 进度阶段定义 */
export const PROGRESS_STAGES = [
  { key: 'upload', label: '上传文件', weight: 10 },
  { key: 'parse', label: '解析文档', weight: 20 },
  { key: 'structure', label: '识别合同结构', weight: 15 },
  { key: 'extract', label: '抽取关键字段', weight: 15 },
  { key: 'rule', label: '执行风险规则', weight: 15 },
  { key: 'ai', label: 'AI语义审核', weight: 15 },
  { key: 'result', label: '生成审核结果', weight: 10 },
] as const;

/** 按完成阶段数计算整体进度 */
export function calcProgress(completedStages: number): number {
  let progress = 0;
  for (let i = 0; i < completedStages && i < PROGRESS_STAGES.length; i++) {
    progress += PROGRESS_STAGES[i].weight;
  }
  return Math.min(progress, 100);
}
