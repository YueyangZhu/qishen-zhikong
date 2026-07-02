/**
 * 全局类型定义
 * 对应 docs/数据模型.md，字段与真实后端表结构对齐，便于后续迁移 Supabase。
 */

// ===== 枚举 =====
export type Role = 'purchaser' | 'legal' | 'admin';
export type MyRole = 'buyer' | 'seller';

/** 风险等级（全局唯一） */
export type RiskLevel = 'high' | 'medium' | 'low' | 'notice';

/** 风险处理状态（全局唯一） */
export type RiskStatus = 'pending' | 'accepted' | 'edited' | 'ignored' | 'manual_review' | 'confirmed';

/** 审核任务状态（全局唯一） */
export type ReviewStatus =
  | 'draft'
  | 'parsing'
  | 'ai_reviewing'
  | 'pending_business'
  | 'pending_legal'
  | 'completed'
  | 'failed';

/** 风险类型分类 */
export type RiskCategory =
  | 'subject'
  | 'amount'
  | 'payment'
  | 'delivery'
  | 'acceptance'
  | 'warranty'
  | 'breach'
  | 'termination'
  | 'ip'
  | 'confidentiality'
  | 'data_security'
  | 'dispute'
  | 'term';

/** 风险来源 */
export type RiskSource = 'rule' | 'ai' | 'manual';

/** 报告状态 */
export type ReportStatus = 'generating' | 'generated' | 'failed';

/** 法务最终结论 */
export type LegalConclusion = 'sign' | 'sign_after_modify' | 'defer' | 'not_sign';

/** 规则检测方式 */
export type RuleMethod = 'field' | 'keyword' | 'ai';

/** 规则状态 */
export type RuleStatus = 'enabled' | 'disabled' | 'draft';

// ===== 用户 =====
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  department: string;
  position: string;
  avatarColor: string;
}

// ===== 合同与版本 =====
/** 合同段落类型
 * - title: 合同标题
 * - header: 首部甲乙方信息
 * - body: 正文条款
 * - signature: 签署落款
 * - table: 表格（tableData 存二维数组）
 * - image: 图片（imageData 存 base64）
 */
export type ParagraphType = 'title' | 'header' | 'body' | 'signature' | 'table' | 'image';

export interface ContractParagraph {
  id: string; // 段落ID，用于风险定位
  index: number;
  text: string;
  clauseNo?: string; // 条款号
  clauseTitle?: string; // 条款标题
  type?: ParagraphType; // 段落类型（可选，旧数据无此字段时由前端兜底识别）
  tableData?: string[][]; // 表格数据（仅 type=table 时有值）
  imageData?: string; // 图片 base64 数据（仅 type=image 时有值）
  imageFormat?: string; // 图片格式 png/jpeg（仅 type=image 时有值）
}

export interface ContractSection {
  id: string;
  title: string;
  clauseNo: string;
  paragraphIds: string[];
  riskCount?: number;
}

export interface ParsedDocument {
  title: string;
  sections: ContractSection[];
  paragraphs: ContractParagraph[];
  fullText: string;
}

// ===== 抽取字段 =====
export interface ExtractedField {
  id: string;
  reviewTaskId: string;
  fieldKey: string; // contractName/buyer/seller/...
  fieldLabel: string;
  fieldValue: string;
  confidence: number;
  confirmedValue: string | null;
  lowConfidence: boolean;
  sourceText: string;
  confirmed: boolean;
}

// ===== 风险项 =====
export interface RiskItem {
  id: string;
  reviewTaskId: string;
  title: string;
  riskType: RiskCategory;
  riskLevel: RiskLevel;
  clauseNumber: string;
  clauseTitle: string;
  originalText: string;
  paragraphId: string;
  startPosition: number;
  endPosition: number;
  riskReason: string;
  reviewBasis: string;
  suggestion: string;
  editedSuggestion: string | null;
  confidence: number;
  sourceType: RiskSource;
  ruleId: string | null;
  status: RiskStatus;
  handler: string | null;
  handleComment: string | null;
  ignoreReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ===== 风险处理记录 =====
export interface RiskAction {
  id: string;
  riskId: string;
  reviewTaskId: string;
  action: string;
  beforeStatus: RiskStatus | null;
  afterStatus: RiskStatus;
  beforeSuggestion: string | null;
  afterSuggestion: string | null;
  operatorId: string;
  operatorName: string;
  comment: string;
  createdAt: string;
}

// ===== 审核任务 =====
export interface RiskCount {
  high: number;
  medium: number;
  low: number;
  notice: number;
}

export interface ReviewTask {
  id: string;
  contractId: string;
  contractName: string;
  contractNo: string;
  counterparty: string;
  amount: number;
  currency: string;
  contractType: string;
  myRole: MyRole;
  department: string;
  reviewFocus: string[];
  reviewNote: string;
  fileName: string;
  fileSize: number;
  /** 样例合同 ID（用于决定生成对应的解析结果；为空表示默认演示合同） */
  sampleId: string | null;
  /** 是否为真实 AI 审核（上传文件触发；样例合同为 false 走时间模拟） */
  realAI?: boolean;
  creatorId: string;
  creatorName: string;
  status: ReviewStatus;
  riskLevelMax: RiskLevel | null;
  riskCount: RiskCount;
  progress: number;
  currentStage: string;
  errorCode: string | null;
  errorMsg: string | null;
  fieldsConfirmed: boolean;
  legalOpinion: string | null;
  legalConclusion: LegalConclusion | null;
  legalReviewerId: string | null;
  legalReviewerName: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ===== 审核报告 =====
export interface ReportSnapshot {
  contractName: string;
  contractNo: string;
  counterparty: string;
  amount: number;
  currency: string;
  contractType: string;
  reviewFocus: string[];
  fields: ExtractedField[];
  risks: RiskItem[];
  riskCount: RiskCount;
  riskScore: number;
  overallRiskLevel: RiskLevel;
  aiSummary: string;
  legalOpinion: string;
  legalConclusion: LegalConclusion;
  majorRisks: RiskItem[];
  disclaimer: string;
  generatedAt: string;
}

export interface ReviewReport {
  id: string;
  reviewTaskId: string;
  reportNo: string;
  versionNo: number;
  snapshot: ReportSnapshot | null;
  status: ReportStatus;
  errorMsg: string | null;
  createdAt: string;
}

// ===== 风险规则 =====
export interface RiskRule {
  id: string;
  code: string;
  name: string;
  contractType: string;
  riskType: RiskCategory;
  riskLevel: RiskLevel;
  method: RuleMethod;
  triggerCondition: string;
  reasonTemplate: string;
  suggestionTemplate: string;
  status: RuleStatus;
  version: number;
  description: string;
  updatedAt: string;
}

// ===== 审计日志 =====
export interface AuditLog {
  id: string;
  reviewTaskId: string;
  objectType: 'task' | 'risk' | 'field' | 'report' | 'rule';
  objectId: string;
  action: string;
  operatorId: string;
  operatorName: string;
  beforeState: string | null;
  afterState: string | null;
  remark: string;
  createdAt: string;
}

// ===== 进度阶段 =====
export interface ProgressStage {
  key: string;
  label: string;
  status: 'waiting' | 'processing' | 'success' | 'failed';
  description: string;
  startedAt?: string;
  finishedAt?: string;
}
