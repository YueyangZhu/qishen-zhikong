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
  // 标题段：第一段、无条款号、首行较短或含合同关键词
  if (idx === 1 && !para.clauseNo) {
    if (firstLine.length <= 40) return 'title';
    if (/合同|协议|契约/.test(firstLine)) return 'title';
  }
  return 'body';
}

/**
 * 基于 paragraphs 自动生成 sections（用于样例合同回退路径）
 * 规则与后端 _split_paragraphs 的章节边界判定一致。
 *
 * 章节划分原则：只以真实条款/标题为边界，不因为甲乙方信息、签署落款等
 * 生成「合同主体」「签署落款」等虚假章节，避免左栏目录误导用户。
 */
export function buildSectionsFromParagraphs(paras: ContractParagraph[]): ContractSection[] {
  const sections: ContractSection[] = [];
  let currentParas: string[] = [];
  let currentTitle = '';
  let currentNo = '';

  // 合同首部/签署等没有条款号的段落，如果出现在第一个真实章节之前，
  // 先暂存为「前导」，等出现标题或第一条时再并入该章节，避免单独生成
  // 「合同首部」「签署落款」等误导性目录项。
  let preludeParas: string[] = [];

  const flush = () => {
    if (currentParas.length > 0) {
      sections.push({
        id: `s${sections.length + 1}`,
        title: currentTitle || '正文',
        // 标题章节显式设置 currentNo=''，需保持空字符串，避免显示「正文」等虚假章节号
        clauseNo: currentNo === '' ? '' : (currentNo || '正文'),
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
      // 合同标题不显示「标题」等虚假章节号，避免左栏目录误导
      currentNo = '';
      currentParas.push(...preludeParas, p.id);
      preludeParas = [];
      return;
    }

    if ((type === 'header' || type === 'signature') && !p.clauseNo) {
      // 无条款号的首部/签署段：并入当前章节；若尚无章节，先作为前导暂存
      if (!currentNo) {
        preludeParas.push(p.id);
      } else {
        currentParas.push(p.id);
      }
      return;
    }

    // body，以及带条款号的首部/签署段：按条款编号切节
    if (p.clauseNo) {
      if (p.clauseNo !== currentNo) {
        flush();
        currentNo = p.clauseNo;
        currentTitle = p.clauseTitle || p.clauseNo;
        currentParas.push(...preludeParas, p.id);
        preludeParas = [];
      } else {
        currentParas.push(p.id);
      }
      return;
    }

    // 无条款号的零散正文
    if (!currentNo) {
      preludeParas.push(p.id);
    } else {
      currentParas.push(p.id);
    }
  });

  flush();

  // 若全文都没有标题/条款，只有前导段落，统一归入「正文」一节
  // 避免生成「合同信息」「首部」「签署落款」等误导性目录项
  if (preludeParas.length > 0 && sections.length === 0) {
    sections.push({
      id: 's1',
      title: '正文',
      clauseNo: '正文',
      paragraphIds: preludeParas.slice(),
    });
  }

  return sections;
}

/** 中文数字 -> 阿拉伯数字（用于条款号排序） */
const CN_NUMBERS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  壹: 1, 贰: 2, 叁: 3, 肆: 4, 伍: 5, 陆: 6, 柒: 7, 捌: 8, 玖: 9, 拾: 10,
};

/**
 * 从条款号字符串中提取可排序的数值。
 * 支持：
 * - "第三条" -> 3
 * - "3." -> 3
 * - "3.2" -> 3.2
 * - "一、" -> 1
 * - 无法识别时返回 Infinity（排在最后）
 */
export function extractClauseOrder(clauseNo: string | undefined | null): number {
  if (!clauseNo) return Infinity;
  const s = clauseNo.trim();
  if (!s) return Infinity;

  // 阿拉伯数字："3." / "3.2" / "(3)"
  const arabicMatch = s.match(/^(\d+(?:\.\d+)?)/);
  if (arabicMatch) {
    const val = parseFloat(arabicMatch[1]);
    return Number.isNaN(val) ? Infinity : val;
  }

  // 中文数字："第三条" / "一、" / "（一）"
  const cnMatch = s.match(/^[第]?([一二三四五六七八九十壹贰叁肆伍陆柒捌玖拾]+)/);
  if (cnMatch) {
    const cn = cnMatch[1];
    let val = 0;
    for (const ch of cn) {
      const n = CN_NUMBERS[ch];
      if (n === undefined) continue;
      if (n === 10) {
        // 处理 "十"、"二十"、"十三" 等情况
        if (val === 0) val = 10;
        else val *= 10;
      } else {
        val += n;
      }
    }
    return val || Infinity;
  }

  return Infinity;
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
 *
 * 加权：high=25, medium=12, low=4, notice=1
 * 渐进饱和公式：score = weightedSum / (weightedSum + 50) * 100
 * 少数几项风险不会轻易到 100，风险越多越接近但不超过 100 */
export function calcRiskScore(risks: RiskItem[]): number {
  let weightedSum = 0;
  risks.forEach((r) => {
    if (r.riskLevel === 'high') weightedSum += 25;
    else if (r.riskLevel === 'medium') weightedSum += 12;
    else if (r.riskLevel === 'low') weightedSum += 4;
    else if (r.riskLevel === 'notice') weightedSum += 1;
  });
  return Math.round((weightedSum / (weightedSum + 50)) * 100);
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
