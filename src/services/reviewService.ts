/**
 * 审核任务服务：创建、列表、进度模拟、提交复核、法务审核
 * 进度基于时间计算，刷新可恢复。
 */
import { db, delay } from './db';
import { buildRisksForTask } from '@/mock/seedData';
import { DEMO_PARAGRAPHS, DEMO_EXTRACTED_FIELDS, DEMO_PARSED_DOCUMENT } from '@/mock/contractText';
import { SAMPLE_CONTRACTS, type SampleContract } from '@/mock/sampleContracts';
import { calcProgress, checkCanSubmitForLegalReview, buildSectionsFromParagraphs, inferParagraphType } from '@/utils/logic';
import { genId, now } from '@/utils/format';
import { loadStorage, saveStorage } from '@/utils/storage';
import { REVIEW_STATUS_MAP } from '@/constants';
import type {
  ReviewTask,
  ReviewStatus,
  User,
  ProgressStage,
  LegalConclusion,
  ParsedDocument,
  RiskLevel,
  RiskCategory,
  RiskItem,
  ExtractedField,
} from '@/types';

const START_KEY = 'data:reviewStarts';

/** 阶段配置（duration 单位毫秒） */
const STAGE_CONFIG = [
  { key: 'upload', label: '上传文件', desc: '安全校验与文件预处理', duration: 600 },
  { key: 'parse', label: '解析文档', desc: '解析合同文本与结构', duration: 1800 },
  { key: 'structure', label: '识别合同结构', desc: '识别章节、条款与段落', duration: 1400 },
  { key: 'extract', label: '抽取关键字段', desc: '提取金额、主体、期限等', duration: 1400 },
  { key: 'rule', label: '执行风险规则', desc: '运行规则引擎检查', duration: 1400 },
  { key: 'ai', label: 'AI语义审核', desc: '大模型语义分析与风险识别', duration: 1800 },
  { key: 'result', label: '生成审核结果', desc: '去重、合并与风险编排', duration: 900 },
];

const TOTAL_DURATION = STAGE_CONFIG.reduce((s, st) => s + st.duration, 0);

function getStartMap(): Record<string, number> {
  return loadStorage<Record<string, number>>(START_KEY, {});
}
function setStart(taskId: string, ts: number) {
  const map = getStartMap();
  map[taskId] = ts;
  saveStorage(START_KEY, map);
}
function clearStart(taskId: string) {
  const map = getStartMap();
  delete map[taskId];
  saveStorage(START_KEY, map);
}

export interface CreateTaskInput {
  contractName: string;
  contractType: string;
  myRole: 'buyer' | 'seller';
  counterparty: string;
  department: string;
  amount: number;
  reviewFocus: string[];
  reviewNote: string;
  fileName: string;
  fileSize: number;
  /** 样例合同 ID（用于决定生成对应的解析结果；为空则使用默认演示合同） */
  sampleId?: string;
}

export interface TaskFilter {
  keyword?: string;
  status?: string[];
  riskLevel?: string[];
  contractType?: string;
  dateRange?: [string, string] | null;
  /** 创建者 ID（业务人员只看自己创建的任务） */
  creatorId?: string;
}

export interface ProgressResult {
  task: ReviewTask;
  stages: ProgressStage[];
  progress: number;
  done: boolean;
  failed: boolean;
}

export const reviewService = {
  async listTasks(filter: TaskFilter = {}): Promise<ReviewTask[]> {
    let tasks = await db.getTasks();
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase();
      // 全字段搜索：合同名称、合同编号、相对方、合同类型、发起人姓名、备注
      tasks = tasks.filter(
        (t) =>
          t.contractName.toLowerCase().includes(kw) ||
          (t.contractNo || '').toLowerCase().includes(kw) ||
          (t.counterparty || '').toLowerCase().includes(kw) ||
          (t.contractType || '').toLowerCase().includes(kw) ||
          (t.creatorName || '').toLowerCase().includes(kw) ||
          (t.department || '').toLowerCase().includes(kw) ||
          (t.reviewNote || '').toLowerCase().includes(kw),
      );
    }
    if (filter.status?.length) tasks = tasks.filter((t) => filter.status!.includes(t.status));
    if (filter.riskLevel?.length)
      tasks = tasks.filter((t) => t.riskLevelMax && filter.riskLevel!.includes(t.riskLevelMax));
    if (filter.contractType) tasks = tasks.filter((t) => t.contractType === filter.contractType);
    if (filter.creatorId) tasks = tasks.filter((t) => t.creatorId === filter.creatorId);
    if (filter.dateRange?.[0] && filter.dateRange?.[1]) {
      // 结束日期追加 T23:59:59，避免漏掉当天数据（dateRange 为 YYYY-MM-DD 格式）
      const start = filter.dateRange![0];
      const end = filter.dateRange![1] + 'T23:59:59';
      tasks = tasks.filter((t) => t.createdAt >= start && t.createdAt <= end);
    }
    return [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async getTask(id: string): Promise<ReviewTask | undefined> {
    return db.getTaskById(id);
  },

  async createTask(input: CreateTaskInput, user: User): Promise<ReviewTask> {
    const id = genId('RVT');
    const task: ReviewTask = {
      id,
      contractId: genId('C'),
      contractName: input.contractName,
      contractNo: `HT-CG-${new Date().getFullYear()}-${String(Date.now()).slice(-3)}`,
      counterparty: input.counterparty,
      amount: input.amount,
      currency: 'CNY',
      contractType: input.contractType,
      myRole: input.myRole,
      department: input.department,
      reviewFocus: input.reviewFocus,
      reviewNote: input.reviewNote,
      fileName: input.fileName,
      fileSize: input.fileSize,
      sampleId: input.sampleId ?? null,
      creatorId: user.id,
      creatorName: user.name,
      status: 'draft',
      riskLevelMax: null,
      riskCount: { high: 0, medium: 0, low: 0, notice: 0 },
      progress: 0,
      currentStage: 'upload',
      errorCode: null,
      errorMsg: null,
      fieldsConfirmed: false,
      legalOpinion: null,
      legalConclusion: null,
      legalReviewerId: null,
      legalReviewerName: null,
      submittedAt: null,
      completedAt: null,
      createdAt: now(),
      updatedAt: now(),
    };
    await db.upsertTask(task);
    await db.addAuditLog({
      reviewTaskId: id,
      objectType: 'task',
      objectId: id,
      action: '创建审核任务',
      operatorId: user.id,
      operatorName: user.name,
      beforeState: null,
      afterState: '草稿',
      remark: [
        `合同名称：${input.contractName}`,
        `相对方：${input.counterparty}`,
        `合同金额：${input.amount} 元`,
        `所属部门：${input.department}`,
        `审核重点：${input.reviewFocus.length} 项`,
        `样例合同：${input.sampleId ?? '默认演示合同'}`,
      ].join('\n'),
    });
    return task;
  },

  /**
   * 真实 AI 审核完成后的创建任务
   * 直接生成 pending_business 状态的任务，附带已解析的文档、字段、风险
   * @param existingTaskId 可选，传入则复用该草稿 ID（用于编辑草稿后发起真实 AI 审核）
   */
  async createTaskWithAIResult(
    input: CreateTaskInput,
    user: User,
    aiResult: {
      parsedDocument: import('@/services/apiClient').ParsedDocumentResult;
      fields: import('@/services/apiClient').AIExtractedField[];
      risks: import('@/services/apiClient').AIRiskItem[];
      aiSummary: string;
    },
    existingTaskId?: string,
  ): Promise<ReviewTask> {
    const id = existingTaskId ?? genId('RVT');
    const ts = now();
    const existing = existingTaskId ? await db.getTaskById(existingTaskId) : undefined;

    // 计算风险统计
    const riskCount = { high: 0, medium: 0, low: 0, notice: 0 };
    aiResult.risks.forEach((r) => {
      riskCount[r.riskLevel] = (riskCount[r.riskLevel] ?? 0) + 1;
    });
    // 计算最高风险等级（覆盖 high/medium/low/notice 全部等级）
    const riskLevelMax: RiskLevel | null = aiResult.risks.length === 0
      ? null
      : (['high', 'medium', 'low', 'notice'] as RiskLevel[]).find((lvl) => riskCount[lvl] > 0) ?? null;

    // 创建任务（直接 pending_business 状态；复用草稿 ID 时保留原 contractId 与 createdAt）
    const task: ReviewTask = {
      id,
      contractId: existing?.contractId ?? genId('C'),
      contractName: input.contractName,
      contractNo: existing?.contractNo ?? `HT-CG-${new Date().getFullYear()}-${String(Date.now()).slice(-3)}`,
      counterparty: input.counterparty,
      amount: input.amount,
      currency: 'CNY',
      contractType: input.contractType,
      myRole: input.myRole,
      department: input.department,
      reviewFocus: input.reviewFocus,
      reviewNote: input.reviewNote,
      fileName: input.fileName,
      fileSize: input.fileSize,
      sampleId: null, // 真实上传文件无 sampleId
      creatorId: user.id,
      creatorName: user.name,
      status: 'pending_business',
      riskLevelMax: riskLevelMax as RiskLevel | null,
      riskCount,
      progress: 100,
      currentStage: 'result',
      errorCode: null,
      errorMsg: null,
      fieldsConfirmed: false,
      legalOpinion: null,
      legalConclusion: null,
      legalReviewerId: null,
      legalReviewerName: null,
      submittedAt: null,
      completedAt: null,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    };

    // 先保存文档/字段/风险，最后才 upsertTask（设为 pending_business）
    // 这样如果中间任何一步失败，任务状态不会变成完成态，进度页不会误触发自动跳转

    // 存储解析文档
    await db.upsertDocument(id, {
      title: aiResult.parsedDocument.title,
      sections: aiResult.parsedDocument.sections,
      paragraphs: aiResult.parsedDocument.paragraphs,
      fullText: aiResult.parsedDocument.fullText,
    });

    // 存储字段（覆盖式批量保存：自动清除该 task 的旧字段，避免复用草稿 ID 时残留）
    const newFields: ExtractedField[] = aiResult.fields.map((f) => ({
      id: `EF-${id}-${f.fieldKey}`,
      reviewTaskId: id,
      fieldKey: f.fieldKey,
      fieldLabel: f.fieldLabel,
      fieldValue: f.fieldValue,
      confidence: f.confidence,
      confirmedValue: null,
      lowConfidence: f.lowConfidence,
      sourceText: f.sourceText,
      confirmed: false,
    }));
    await db.saveFields(newFields);

    // 存储风险（覆盖式批量保存：自动清除该 task 的旧风险，避免复用草稿 ID 时残留）
    // 枚举值校验：数据库 risk_category/risk_level/risk_source 是枚举类型，
    // AI 可能返回不在枚举范围内的值（如 compliance/general/critical），导致 insert 约束违反。
    // 这里在前端做兜底校验，保证写入的值一定合法。
    const VALID_RISK_TYPES = ['subject', 'amount', 'payment', 'delivery', 'acceptance', 'warranty', 'breach', 'termination', 'ip', 'confidentiality', 'data_security', 'dispute', 'term'];
    const VALID_RISK_LEVELS = ['high', 'medium', 'low', 'notice'];
    const VALID_SOURCE_TYPES = ['rule', 'ai', 'manual'];
    const sanitizeRiskType = (v: string): RiskCategory =>
      (VALID_RISK_TYPES.includes(v) ? v : 'breach') as RiskCategory;
    const sanitizeRiskLevel = (v: string): RiskLevel =>
      (VALID_RISK_LEVELS.includes(v) ? v : 'medium') as RiskLevel;
    const sanitizeSourceType = (v: string): 'ai' | 'rule' | 'manual' =>
      (VALID_SOURCE_TYPES.includes(v) ? v : 'ai') as 'ai' | 'rule' | 'manual';
    const sanitizeConfidence = (v: number): number =>
      Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.7;

    const newRisks: RiskItem[] = aiResult.risks.map((r) => {
      const safeType = sanitizeRiskType(r.riskType);
      return {
        id: `${safeType}-${id}-${Math.random().toString(36).slice(2, 8)}`,
        reviewTaskId: id,
        title: r.title || '未命名风险',
        riskType: safeType,
        riskLevel: sanitizeRiskLevel(r.riskLevel),
        clauseNumber: r.clauseNumber || '',
        clauseTitle: r.clauseTitle || '',
        originalText: r.originalText || '',
        paragraphId: r.paragraphId || '',
        startPosition: r.startPosition || 0,
        endPosition: r.endPosition || 0,
        riskReason: r.riskReason || '',
        reviewBasis: r.reviewBasis || '',
        suggestion: r.suggestion || '',
        editedSuggestion: null,
        confidence: sanitizeConfidence(r.confidence),
        sourceType: sanitizeSourceType(r.sourceType),
        ruleId: r.matchedRuleId ?? null,
        status: 'pending',
        handler: null,
        handleComment: null,
        ignoreReason: null,
        version: 1,
        createdAt: ts,
        updatedAt: ts,
      };
    });
    await db.saveRisks(newRisks);

    // 文档/字段/风险全部保存成功后，才更新任务状态为 pending_business
    await db.upsertTask(task);

    // 审计日志（复用草稿 ID 时不重复写"创建审核任务"，避免审计记录重复）
    if (!existingTaskId) {
      // 非复用路径：新建任务后直接进入 AI 审核，任务实际经历了 创建→AI审核中→待人工确认
      await db.addAuditLog({
        reviewTaskId: id,
        objectType: 'task',
        objectId: id,
        action: '创建审核任务',
        operatorId: user.id,
        operatorName: user.name,
        beforeState: null,
        afterState: '草稿',
        remark: [
          `合同名称：${input.contractName}`,
          `相对方：${input.counterparty}`,
          `合同金额：${input.amount} 元`,
          '审核模式：真实 AI（DeepSeek）',
        ].join('\n'),
      });
      await db.addAuditLog({
        reviewTaskId: id,
        objectType: 'task',
        objectId: id,
        action: '发起AI审核',
        operatorId: user.id,
        operatorName: user.name,
        beforeState: '草稿',
        afterState: 'AI审核中',
        remark: '审核模式：真实 AI（DeepSeek）',
      });
    } else {
      // 复用草稿：记录从草稿发起真实 AI 审核的操作
      await db.addAuditLog({
        reviewTaskId: id,
        objectType: 'task',
        objectId: id,
        action: '发起AI审核',
        operatorId: user.id,
        operatorName: user.name,
        beforeState: '草稿',
        afterState: 'AI审核中',
        remark: [
          '从草稿发起真实 AI 审核',
          '审核模式：真实 AI（DeepSeek）',
          `解析段落数：${aiResult.parsedDocument.paragraphs.length}`,
          `抽取字段数：${aiResult.fields.length}`,
        ].join('\n'),
      });
    }
    await db.addAuditLog({
      reviewTaskId: id,
      objectType: 'task',
      objectId: id,
      action: 'AI审核完成',
      operatorId: 'system',
      operatorName: 'AI 系统（DeepSeek）',
      beforeState: 'AI审核中',
      afterState: '待人工确认',
      remark: [
        aiResult.aiSummary,
        `解析段落数：${aiResult.parsedDocument.paragraphs.length}`,
        `抽取字段数：${aiResult.fields.length}`,
        `识别风险数：${aiResult.risks.length} 项（高 ${riskCount.high} / 中 ${riskCount.medium} / 低 ${riskCount.low} / 提示 ${riskCount.notice}）`,
      ].join('\n'),
    });

    return task;
  },

  /** 更新草稿任务（用于编辑已保存的草稿） */
  async updateTask(id: string, input: CreateTaskInput, user: User): Promise<ReviewTask> {
    const task = await db.getTaskById(id);
    if (!task) throw new Error('任务不存在');
    if (task.status !== 'draft') throw new Error('仅草稿状态任务可编辑');
    const beforeSummary = `合同：${task.contractName} / 相对方：${task.counterparty} / 金额：${task.amount}`;
    const updated: ReviewTask = {
      ...task,
      contractName: input.contractName,
      counterparty: input.counterparty,
      amount: input.amount,
      contractType: input.contractType,
      myRole: input.myRole,
      department: input.department,
      reviewFocus: input.reviewFocus,
      reviewNote: input.reviewNote,
      fileName: input.fileName,
      fileSize: input.fileSize,
      sampleId: input.sampleId ?? null,
      updatedAt: now(),
    };
    await db.upsertTask(updated);
    const afterSummary = `合同：${updated.contractName} / 相对方：${updated.counterparty} / 金额：${updated.amount}`;
    await db.addAuditLog({
      reviewTaskId: id,
      objectType: 'task',
      objectId: id,
      action: '编辑草稿',
      operatorId: user.id,
      operatorName: user.name,
      beforeState: '草稿',
      afterState: '草稿',
      remark: [
        '操作详情：',
        `• 编辑前：${beforeSummary}`,
        `• 编辑后：${afterSummary}`,
        `• 审核重点：${input.reviewFocus.length} 项`,
        `• 样例合同：${input.sampleId ?? '默认演示合同'}`,
      ].join('\n'),
    });
    return updated;
  },

  /** 启动 AI 审核：draft -> parsing */
  async startReview(id: string, user: User): Promise<ReviewTask> {
    const task = await db.getTaskById(id);
    if (!task) throw new Error('任务不存在');
    if (task.status !== 'draft' && task.status !== 'failed') {
      throw new Error('当前任务状态无法启动审核');
    }
    setStart(id, Date.now());
    const updated: ReviewTask = {
      ...task,
      status: 'parsing',
      progress: 5,
      currentStage: 'parse',
      errorCode: null,
      errorMsg: null,
      updatedAt: now(),
    };
    await db.upsertTask(updated);
    await db.addAuditLog({
      reviewTaskId: id,
      objectType: 'task',
      objectId: id,
      action: '开始AI审核',
      operatorId: user.id,
      operatorName: user.name,
      beforeState: REVIEW_STATUS_MAP[task.status]?.label ?? task.status,
      afterState: '解析中',
      remark: '启动文档解析与AI审核流程',
    });
    return updated;
  },

  /**
   * 启动真实 AI 审核（上传文件触发）
   * 复用 startReview 设置任务为 parsing，标记 realAI=true，并把 File 存入内存 store。
   * 进度页检测到 realAI 后从 store 取 File 调用 runFullAIReview。
   */
  async startRealAIReview(
    id: string,
    user: User,
    file: File,
    options: import('@/store/useRealAIStore').RealAIOptions,
  ): Promise<ReviewTask> {
    // 先走标准 startReview 流程（设置 parsing 状态 + 审计日志）
    const task = await this.startReview(id, user);
    // 标记为真实 AI 审核
    const updated = { ...task, realAI: true, updatedAt: now() };
    await db.upsertTask(updated);
    // 暂存 File 和参数到内存 store（不持久化，刷新丢失）
    const { useRealAIStore } = await import('@/store/useRealAIStore');
    useRealAIStore.getState().set(file, options, id);
    return updated;
  },

  /** 更新真实 AI 审核阶段（供进度页 onProgress 回调用） */
  async updateRealAIStage(id: string, stage: string, progress: number): Promise<void> {
    const task = await db.getTaskById(id);
    if (!task) return;
    // 阶段到任务状态的映射
    const statusMap: Record<string, ReviewStatus> = {
      upload: 'parsing', parse: 'parsing', structure: 'parsing',
      extract: 'ai_reviewing', rule: 'ai_reviewing', ai: 'ai_reviewing', result: 'pending_business',
    };
    const newStatus = statusMap[stage] ?? task.status;
    await db.upsertTask({
      ...task,
      currentStage: stage,
      progress: Math.min(99, progress),
      status: newStatus,
      updatedAt: now(),
    });
  },

  /** 真实 AI 审核完成：用 AI 结果填充任务（复用 createTaskWithAIResult） */
  async completeRealAIReview(
    id: string,
    user: User,
    aiResult: {
      parsedDocument: import('@/services/apiClient').ParsedDocumentResult;
      fields: import('@/services/apiClient').AIExtractedField[];
      risks: import('@/services/apiClient').AIRiskItem[];
      aiSummary: string;
    },
  ): Promise<ReviewTask> {
    const task = await db.getTaskById(id);
    if (!task) throw new Error('任务不存在');
    // 从任务中提取 input（createTaskWithAIResult 需要）
    const input: CreateTaskInput = {
      contractName: task.contractName,
      contractType: task.contractType,
      myRole: task.myRole,
      counterparty: task.counterparty,
      department: task.department,
      amount: task.amount,
      reviewFocus: task.reviewFocus,
      reviewNote: task.reviewNote,
      fileName: task.fileName,
      fileSize: task.fileSize,
      sampleId: undefined,
    };
    // 复用 createTaskWithAIResult 填充文档/字段/风险 + 审计日志
    const result = await this.createTaskWithAIResult(input, user, aiResult, id);
    // 清理内存 store
    const { useRealAIStore } = await import('@/store/useRealAIStore');
    useRealAIStore.getState().clear();
    return result;
  },

  /** 标记真实 AI 审核失败 */
  async failRealAIReview(id: string, errorMsg: string, user: User): Promise<void> {
    const task = await db.getTaskById(id);
    if (!task) return;
    await db.upsertTask({
      ...task,
      status: 'failed',
      currentStage: 'parse',
      progress: 0,
      errorCode: 'AI_REVIEW_FAILED',
      errorMsg,
      updatedAt: now(),
    });
    await db.addAuditLog({
      reviewTaskId: id,
      objectType: 'task',
      objectId: id,
      action: 'AI审核失败',
      operatorId: 'system',
      operatorName: 'AI 系统',
      beforeState: 'AI审核中',
      afterState: '失败',
      remark: `失败原因：${errorMsg}`,
    });
    const { useRealAIStore } = await import('@/store/useRealAIStore');
    useRealAIStore.getState().clear();
  },

  /** 查询进度（基于时间推进，刷新可恢复） */
  async getProgress(id: string): Promise<ProgressResult> {
    const task = await db.getTaskById(id);
    if (!task) throw new Error('任务不存在');

    // 已完成或失败
    if (task.status === 'failed') {
      return { task, stages: buildStages(task.currentStage, 'failed'), progress: task.progress, done: false, failed: true };
    }
    if (task.status === 'pending_business' || task.status === 'pending_legal' || task.status === 'completed') {
      return { task, stages: buildStages('result', 'success'), progress: 100, done: true, failed: false };
    }
    // 草稿状态：尚未发起审核，不自动推进（防御性判断，避免误进入进度页被自动 finishReview）
    if (task.status === 'draft') {
      return { task, stages: buildStages('upload', 'wait'), progress: 0, done: false, failed: false };
    }

    // 真实 AI 任务（上传文件，非样例合同）：不走时间模拟，直接返回当前任务状态
    // 进度由 ReviewProgressPage 的 onProgress 回调更新
    if (!task.sampleId) {
      return {
        task,
        stages: buildStages(task.currentStage, 'processing'),
        progress: task.progress,
        done: false,
        failed: false,
      };
    }

    // 推进中：基于已用时间计算
    const startMap = getStartMap();
    const start = startMap[id];
    if (!start) {
      // 无启动记录但处于处理中状态（异常恢复），直接完成
      await finishReview(id);
      const fresh = (await db.getTaskById(id))!;
      return { task: fresh, stages: buildStages('result', 'success'), progress: 100, done: true, failed: false };
    }

    const elapsed = Date.now() - start;
    if (elapsed >= TOTAL_DURATION) {
      // 完成
      await finishReview(id);
      const fresh = (await db.getTaskById(id))!;
      return { task: fresh, stages: buildStages('result', 'success'), progress: 100, done: true, failed: false };
    }

    // 计算当前阶段
    let acc = 0;
    let currentIdx = 0;
    for (let i = 0; i < STAGE_CONFIG.length; i++) {
      if (elapsed < acc + STAGE_CONFIG[i].duration) {
        currentIdx = i;
        break;
      }
      acc += STAGE_CONFIG[i].duration;
      currentIdx = i + 1;
    }
    if (currentIdx >= STAGE_CONFIG.length) currentIdx = STAGE_CONFIG.length - 1;

    const currentStageKey = STAGE_CONFIG[currentIdx].key;
    const progress = Math.min(99, Math.floor((elapsed / TOTAL_DURATION) * 100));
    const status = currentIdx <= 1 ? 'parsing' : 'ai_reviewing';

    // 更新任务状态（幂等）
    if (task.status !== status || task.currentStage !== currentStageKey) {
      await db.upsertTask({ ...task, status, currentStage: currentStageKey, progress, updatedAt: now() });
    }
    const fresh = (await db.getTaskById(id))!;
    return {
      task: fresh,
      stages: buildStages(currentStageKey, 'processing'),
      progress,
      done: false,
      failed: false,
    };
  },

  /** 模拟解析失败（演示用） */
  async simulateFail(id: string, user: User): Promise<ReviewTask> {
    const task = await db.getTaskById(id);
    if (!task) throw new Error('任务不存在');
    clearStart(id);
    const updated: ReviewTask = {
      ...task,
      status: 'failed',
      errorCode: 'PARSE_FAILED',
      errorMsg: '文档解析失败：未能识别合同结构，请检查文件或重新上传。',
      progress: task.progress,
      updatedAt: now(),
    };
    await db.upsertTask(updated);
    await db.addAuditLog({
      reviewTaskId: id,
      objectType: 'task',
      objectId: id,
      action: '审核失败',
      operatorId: user.id,
      operatorName: user.name,
      beforeState: REVIEW_STATUS_MAP[task.status]?.label ?? task.status,
      afterState: '失败',
      remark: updated.errorMsg ?? '解析失败',
    });
    return updated;
  },

  /** 提交法务复核 */
  async submitForLegalReview(
    id: string,
    user: User,
  ): Promise<{ success: boolean; task?: ReviewTask; reasons?: string[] }> {
    const task = await db.getTaskById(id);
    if (!task) throw new Error('任务不存在');
    const risks = await db.getRisksByTask(id);
    const check = checkCanSubmitForLegalReview(task, risks, false);
    if (!check.canSubmit) return { success: false, reasons: check.reasons };

    // 统计提交时的风险处理情况
    const statusCount = {
      accepted: risks.filter((r) => r.status === 'accepted').length,
      edited: risks.filter((r) => r.status === 'edited').length,
      ignored: risks.filter((r) => r.status === 'ignored').length,
      manual_review: risks.filter((r) => r.status === 'manual_review').length,
      pending: risks.filter((r) => r.status === 'pending').length,
    };
    // 查询历史提交次数
    const logs = await db.getAuditLogsByTask(id);
    const submitCount = logs.filter((l) => l.action === '提交法务复核').length + 1;

    const updated: ReviewTask = {
      ...task,
      status: 'pending_legal',
      submittedAt: now(),
      updatedAt: now(),
    };
    await db.upsertTask(updated);
    await db.addAuditLog({
      reviewTaskId: id,
      objectType: 'task',
      objectId: id,
      action: '提交法务复核',
      operatorId: user.id,
      operatorName: user.name,
      beforeState: '待人工确认',
      afterState: '待法务复核',
      remark: [
        `第 ${submitCount} 次提交法务复核`,
        `风险总数：${risks.length} 项`,
        `已接受：${statusCount.accepted} 项`,
        `已编辑：${statusCount.edited} 项`,
        `已忽略：${statusCount.ignored} 项`,
        `转人工：${statusCount.manual_review} 项`,
        `未处理：${statusCount.pending} 项`,
      ].join('\n'),
    });
    return { success: true, task: updated };
  },

  /** 法务审核：通过 / 退回 */
  async legalReview(
    id: string,
    user: User,
    payload: { action: 'approve' | 'reject'; opinion: string; conclusion?: LegalConclusion },
  ): Promise<ReviewTask> {
    const task = await db.getTaskById(id);
    if (!task) throw new Error('任务不存在');
    if (task.status !== 'pending_legal') throw new Error('任务非待法务复核状态');

    const risks = await db.getRisksByTask(id);
    const CONCLUSION_LABEL: Record<LegalConclusion, string> = {
      sign: '建议签署',
      sign_after_modify: '建议修改后签署',
      defer: '建议暂缓签署',
      not_sign: '不建议签署',
    };

    if (payload.action === 'approve') {
      // 校验：所有 high 风险必须已处理（与提交法务复核的前置校验保持一致）
      const unhandledHigh = risks.filter((r) => r.riskLevel === 'high' && r.status === 'pending');
      if (unhandledHigh.length > 0) {
        throw new Error(`存在 ${unhandledHigh.length} 项未处理的高风险，无法通过审核。请先确认或处理这些风险。`);
      }
      // 重新计算任务统计，确保报告快照基于最新数据
      await db.recalcTaskStats(id);
      const updated: ReviewTask = {
        ...task,
        status: 'completed',
        completedAt: now(),
        legalOpinion: payload.opinion,
        legalConclusion: payload.conclusion ?? 'sign_after_modify',
        legalReviewerId: user.id,
        legalReviewerName: user.name,
        updatedAt: now(),
      };
      await db.upsertTask(updated);
      await db.addAuditLog({
        reviewTaskId: id,
        objectType: 'task',
        objectId: id,
        action: '法务审核通过',
        operatorId: user.id,
        operatorName: user.name,
        beforeState: '待法务复核',
        afterState: '已完成',
        remark: [
          `审核结论：${CONCLUSION_LABEL[payload.conclusion ?? 'sign_after_modify']}`,
          `法务意见：${payload.opinion}`,
          `法务审核人：${user.name}（${user.department}）`,
          `风险处理汇总：共 ${risks.length} 项，已确认 ${risks.filter((r) => r.status === 'confirmed').length} 项`,
        ].join('\n'),
      });
      return updated;
    } else {
      // 法务退回：记录完整路径，记录审核人信息并重置 legal 结论
      const updated: ReviewTask = {
        ...task,
        status: 'pending_business',
        legalOpinion: payload.opinion,
        legalConclusion: null, // 重置结论，待业务人员重新提交后再次审核
        legalReviewerId: user.id,
        legalReviewerName: user.name,
        updatedAt: now(),
      };
      await db.upsertTask(updated);
      await db.addAuditLog({
        reviewTaskId: id,
        objectType: 'task',
        objectId: id,
        action: '法务退回',
        operatorId: user.id,
        operatorName: user.name,
        beforeState: '待法务复核',
        afterState: '待人工确认',
        remark: [
          `退回至：业务人员（${task.creatorName}）重新处理`,
          `退回原因：${payload.opinion}`,
          `法务审核人：${user.name}（${user.department}）`,
          `退回时风险状态：共 ${risks.length} 项`,
          `  - 已确认：${risks.filter((r) => r.status === 'confirmed').length} 项`,
          `  - 已接受：${risks.filter((r) => r.status === 'accepted').length} 项`,
          `  - 已编辑：${risks.filter((r) => r.status === 'edited').length} 项`,
          `  - 已忽略：${risks.filter((r) => r.status === 'ignored').length} 项`,
          `  - 转人工：${risks.filter((r) => r.status === 'manual_review').length} 项`,
          `  - 待处理：${risks.filter((r) => r.status === 'pending').length} 项`,
          `下一步：业务人员修改后需重新提交法务复核`,
        ].join('\n'),
      });
      return updated;
    }
  },

  async getDocument(id: string): Promise<ParsedDocument> {
    const task = await db.getTaskById(id);
    // 优先从真实 AI 解析结果读取（网络失败时降级到样例/演示数据，避免阻断详情页）
    // 注意：401 错误不能吞掉，因为 authFetch 遇到 401 会调 triggerForceLogout 清空 token，
    // 如果这里吞掉错误，并行的 listByTask 会因为 token 已被清空而 401
    let realDoc: ParsedDocument | undefined;
    try {
      realDoc = await db.getDocumentByTask(id);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes('登录已过期') || errMsg.includes('重新登录')) {
        // 401 错误向上抛，不降级
        throw e;
      }
      console.warn('[reviewService.getDocument] 加载真实文档失败，降级到样例/演示数据:', e);
    }
    if (realDoc) return realDoc;
    // 样例合同
    const sample = task?.sampleId ? getSample(task.sampleId) : null;
    if (sample) {
      // 基于 paragraphs 自动生成 sections + type，保证左栏章节目录完整
      const paragraphs = sample.paragraphs.map((p, i) => ({
        ...p,
        type: inferParagraphType(p, i + 1),
      }));
      return {
        title: sample.fileTitle,
        sections: buildSectionsFromParagraphs(paragraphs),
        paragraphs,
        fullText: sample.paragraphs.map((p) => p.text).join('\n\n'),
      };
    }
    return DEMO_PARSED_DOCUMENT;
  },

  async deleteTask(id: string, user: User): Promise<void> {
    const task = await db.getTaskById(id);
    if (!task) return;
    if (task.status !== 'draft' && task.status !== 'failed') {
      throw new Error('仅草稿与失败任务可删除，其他任务请归档');
    }
    await db.removeTask(id);
    clearStart(id);
    await db.addAuditLog({
      reviewTaskId: id,
      objectType: 'task',
      objectId: id,
      action: '删除审核任务',
      operatorId: user.id,
      operatorName: user.name,
      beforeState: REVIEW_STATUS_MAP[task.status]?.label ?? task.status,
      afterState: '已删除',
      remark: `合同：${task.contractName}`,
    });
  },
};

/** 根据 sampleId 获取样例合同 */
function getSample(sampleId: string): SampleContract | undefined {
  return SAMPLE_CONTRACTS.find((s) => s.id === sampleId);
}

/** 完成审核：生成风险与字段（首次），置为待人工确认 */
async function finishReview(id: string): Promise<void> {
  const task = await db.getTaskById(id);
  if (!task) return;
  const sample = task.sampleId ? getSample(task.sampleId) : null;
  // 生成风险（若不存在）
  let risks = await db.getRisksByTask(id);
  if (risks.length === 0) {
    if (sample) {
      // 使用样例合同的风险
      const newRisks: RiskItem[] = sample.risks.map((r) => ({
        ...r,
        id: `${r.riskType}-${id}-${Math.random().toString(36).slice(2, 8)}`,
        reviewTaskId: id,
        handler: null,
        handleComment: null,
        ignoreReason: null,
        // 保留 sample 中的 editedSuggestion 和 ruleId（如有）
        editedSuggestion: (r as Partial<RiskItem>).editedSuggestion ?? null,
        ruleId: (r as Partial<RiskItem>).ruleId ?? null,
        version: 1,
        createdAt: now(),
        updatedAt: now(),
      }));
      await db.saveRisks(newRisks);
      risks = newRisks;
    } else {
      // 使用默认演示合同的风险
      const newRisks = buildRisksForTask(id, () => 'pending', now());
      newRisks.forEach((r) => {
        const para = DEMO_PARAGRAPHS.find((p) => p.id === r.paragraphId);
        if (para) {
          const start = para.text.indexOf(r.originalText);
          if (start >= 0) {
            r.startPosition = start;
            r.endPosition = start + r.originalText.length;
          }
        }
      });
      await db.saveRisks(newRisks);
      risks = newRisks;
    }
  }
  // 生成字段（若不存在）
  let fields = await db.getFieldsByTask(id);
  if (fields.length === 0) {
    const sourceFields = sample ? sample.fields : DEMO_EXTRACTED_FIELDS;
    const newFields: ExtractedField[] = sourceFields.map((f) => ({
      id: `EF-${id}-${f.fieldKey}`,
      reviewTaskId: id,
      fieldKey: f.fieldKey,
      fieldLabel: f.fieldLabel,
      fieldValue: f.fieldValue,
      confidence: f.confidence,
      confirmedValue: null,
      lowConfidence: f.lowConfidence,
      sourceText: f.sourceText,
      confirmed: false,
    }));
    await db.saveFields(newFields);
    fields = newFields;
  }
  const updated: ReviewTask = {
    ...task,
    status: 'pending_business',
    progress: 100,
    currentStage: 'result',
    updatedAt: now(),
  };
  await db.upsertTask(updated);
  await db.recalcTaskStats(id);
  await db.addAuditLog({
    reviewTaskId: id,
    objectType: 'task',
    objectId: id,
    action: 'AI审核完成',
    operatorId: 'system',
    operatorName: '系统',
    beforeState: 'AI审核中',
    afterState: '待人工确认',
    remark: [
      `共识别 ${risks.length} 项风险`,
      `抽取字段 ${fields.length === 0 ? (sample?.fields.length ?? DEMO_EXTRACTED_FIELDS.length) : fields.length} 个`,
      sample ? `合同类型：${sample.contractType}` : '合同类型：采购合同',
    ].join('\n'),
  });
  clearStart(id);
}

/** 构建阶段列表 */
function buildStages(currentKey: string, overall: 'processing' | 'success' | 'failed' | 'wait'): ProgressStage[] {
  const currentIdx = STAGE_CONFIG.findIndex((s) => s.key === currentKey);
  return STAGE_CONFIG.map((s, i) => {
    let status: ProgressStage['status'] = 'waiting';
    if (overall === 'wait') {
      status = 'waiting';
    } else if (overall === 'success') {
      status = 'success';
    } else if (overall === 'failed' && i === currentIdx) {
      status = 'failed';
    } else if (overall === 'failed' && i < currentIdx) {
      status = 'success';
    } else {
      if (i < currentIdx) status = 'success';
      else if (i === currentIdx) status = 'processing';
      else status = 'waiting';
    }
    return { key: s.key, label: s.label, status, description: s.desc };
  });
}

export { STAGE_CONFIG, calcProgress };
