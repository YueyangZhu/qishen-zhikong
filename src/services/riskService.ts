/**
 * 风险处理服务：接受 / 编辑 / 忽略 / 转人工 / 恢复 / 法务确认
 * 所有操作校验状态机、写审计、重算任务统计。
 * 审计日志记录详细的操作内容，便于溯源。
 */
import { db, delay } from './db';
import { canTransitionRiskStatus } from '@/utils/logic';
import { genId, now } from '@/utils/format';
import { RISK_LEVEL_MAP, RISK_CATEGORY_MAP } from '@/constants';
import type { RiskItem, RiskStatus, RiskLevel, RiskCategory, User } from '@/types';

/** 截断长文本用于审计日志 */
function truncate(s: string, n = 80): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** 风险状态中文标签 */
const RISK_STATUS_LABEL: Record<RiskStatus, string> = {
  pending: '待处理',
  accepted: '已接受',
  edited: '已编辑',
  ignored: '已忽略',
  manual_review: '转人工复核',
  confirmed: '已确认',
};

/** 风险等级中文标签（high → 高风险 等） */
const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  high: RISK_LEVEL_MAP.high.label,
  medium: RISK_LEVEL_MAP.medium.label,
  low: RISK_LEVEL_MAP.low.label,
  notice: RISK_LEVEL_MAP.notice.label,
};

/** 风险类型中文标签（payment → 付款 等） */
const RISK_CATEGORY_LABEL = (k: RiskCategory | undefined | null): string => {
  if (!k) return '';
  return RISK_CATEGORY_MAP[k]?.label ?? k;
};

export const riskService = {
  async listByTask(taskId: string): Promise<RiskItem[]> {
    return (await db.getRisksByTask(taskId))
      .sort((a, b) => {
        // 按等级降序 + 创建序
        const rank: Record<string, number> = { high: 4, medium: 3, low: 2, notice: 1 };
        const diff = (rank[b.riskLevel] ?? 0) - (rank[a.riskLevel] ?? 0);
        if (diff !== 0) return diff;
        return a.createdAt.localeCompare(b.createdAt);
      });
  },

  async get(id: string): Promise<RiskItem | undefined> {
    return db.getRiskById(id);
  },

  /** 通用状态变更（校验状态机） */
  async apply(
    id: string,
    user: User,
    toStatus: RiskStatus,
    extra: Partial<RiskItem> = {},
    auditAction: string,
    remark: string,
  ): Promise<RiskItem> {
    const risk = await db.getRiskById(id);
    if (!risk) throw new Error('风险项不存在');
    if (!canTransitionRiskStatus(risk.status, toStatus)) {
      throw new Error(`当前状态「${risk.status}」无法转换到「${toStatus}」`);
    }
    const updated: RiskItem = {
      ...risk,
      ...extra,
      status: toStatus,
      handler: user.name,
      version: risk.version + 1,
      updatedAt: now(),
    };
    await db.upsertRisk(updated);
    await db.addAuditLog({
      reviewTaskId: risk.reviewTaskId,
      objectType: 'risk',
      objectId: id,
      action: auditAction,
      operatorId: user.id,
      operatorName: user.name,
      beforeState: RISK_STATUS_LABEL[risk.status],
      afterState: RISK_STATUS_LABEL[toStatus],
      remark: remark || `风险「${risk.title}」${auditAction}`,
    });
    await db.recalcTaskStats(risk.reviewTaskId);
    return updated;
  },

  async accept(id: string, user: User): Promise<RiskItem> {
    const risk = await db.getRiskById(id);
    const suggestion = risk?.editedSuggestion ?? risk?.suggestion ?? '';
    const remark = [
      `风险标题：${risk?.title ?? '未知'}`,
      `条款位置：${risk?.clauseNumber ?? ''} ${risk?.clauseTitle ?? ''}`,
      `风险等级：${risk ? RISK_LEVEL_LABEL[risk.riskLevel] : ''}`,
      `接受的修改建议：${truncate(suggestion, 120)}`,
    ].join('\n');
    return riskService.apply(id, user, 'accepted', {}, '接受建议', remark);
  },

  async edit(id: string, user: User, newSuggestion: string): Promise<RiskItem> {
    if (!newSuggestion.trim()) throw new Error('修改建议不能为空');
    const risk = await db.getRiskById(id);
    const oldSuggestion = risk?.editedSuggestion ?? risk?.suggestion ?? '';
    const remark = [
      `风险标题：${risk?.title ?? '未知'}`,
      `条款位置：${risk?.clauseNumber ?? ''} ${risk?.clauseTitle ?? ''}`,
      `原修改建议：${truncate(oldSuggestion, 100)}`,
      `新修改建议：${truncate(newSuggestion.trim(), 100)}`,
    ].join('\n');
    return riskService.apply(
      id,
      user,
      'edited',
      { editedSuggestion: newSuggestion.trim() },
      '编辑建议',
      remark,
    );
  },

  async ignore(id: string, user: User, reason: string, comment: string): Promise<RiskItem> {
    if (!reason) throw new Error('请选择忽略原因');
    if (!comment.trim()) throw new Error('请填写忽略说明');
    const risk = await db.getRiskById(id);
    const remark = [
      `风险标题：${risk?.title ?? '未知'}`,
      `条款位置：${risk?.clauseNumber ?? ''} ${risk?.clauseTitle ?? ''}`,
      `风险等级：${risk ? RISK_LEVEL_LABEL[risk.riskLevel] : ''}`,
      `忽略原因：${reason}`,
      `详细说明：${comment.trim()}`,
    ].join('\n');
    return riskService.apply(
      id,
      user,
      'ignored',
      { ignoreReason: reason, handleComment: comment.trim() },
      '忽略风险',
      remark,
    );
  },

  async transferManual(id: string, user: User, comment: string): Promise<RiskItem> {
    if (!comment.trim()) throw new Error('请填写转人工复核说明');
    const risk = await db.getRiskById(id);
    const remark = [
      `风险标题：${risk?.title ?? '未知'}`,
      `条款位置：${risk?.clauseNumber ?? ''} ${risk?.clauseTitle ?? ''}`,
      `风险等级：${risk ? RISK_LEVEL_LABEL[risk.riskLevel] : ''}`,
      `转人工说明：${comment.trim()}`,
    ].join('\n');
    return riskService.apply(
      id,
      user,
      'manual_review',
      { handleComment: comment.trim() },
      '转人工复核',
      remark,
    );
  },

  async restore(id: string, user: User): Promise<RiskItem> {
    const risk = await db.getRiskById(id);
    const remark = [
      `风险标题：${risk?.title ?? '未知'}`,
      `原状态：${risk ? RISK_STATUS_LABEL[risk.status] : ''}`,
      `恢复为：待处理`,
    ].join('\n');
    return riskService.apply(id, user, 'pending', { ignoreReason: null, handleComment: null }, '恢复处理', remark);
  },

  /** 法务确认风险 */
  async confirm(id: string, user: User, comment: string): Promise<RiskItem> {
    const risk = await db.getRiskById(id);
    const suggestion = risk?.editedSuggestion ?? risk?.suggestion ?? '';
    const remark = [
      `风险标题：${risk?.title ?? '未知'}`,
      `条款位置：${risk?.clauseNumber ?? ''} ${risk?.clauseTitle ?? ''}`,
      `最终建议：${truncate(suggestion, 100)}`,
      `法务意见：${comment.trim() || '无'}`,
    ].join('\n');
    return riskService.apply(
      id,
      user,
      'confirmed',
      { handleComment: comment.trim() || null },
      '法务确认',
      remark,
    );
  },

  /** 法务修改建议（转 edited） */
  async legalEdit(id: string, user: User, newSuggestion: string): Promise<RiskItem> {
    if (!newSuggestion.trim()) throw new Error('修改建议不能为空');
    const risk = await db.getRiskById(id);
    const oldSuggestion = risk?.editedSuggestion ?? risk?.suggestion ?? '';
    const remark = [
      `风险标题：${risk?.title ?? '未知'}`,
      `条款位置：${risk?.clauseNumber ?? ''} ${risk?.clauseTitle ?? ''}`,
      `原修改建议：${truncate(oldSuggestion, 100)}`,
      `法务新建议：${truncate(newSuggestion.trim(), 100)}`,
    ].join('\n');
    return riskService.apply(
      id,
      user,
      'edited',
      { editedSuggestion: newSuggestion.trim() },
      '法务修改建议',
      remark,
    );
  },

  /** 添加备注（不改状态） */
  async addComment(id: string, user: User, comment: string): Promise<void> {
    const risk = await db.getRiskById(id);
    if (!risk) throw new Error('风险项不存在');
    await db.addAuditLog({
      reviewTaskId: risk.reviewTaskId,
      objectType: 'risk',
      objectId: id,
      action: '添加备注',
      operatorId: user.id,
      operatorName: user.name,
      beforeState: RISK_STATUS_LABEL[risk.status],
      afterState: RISK_STATUS_LABEL[risk.status],
      remark: `风险「${risk.title}」备注：${comment}`,
    });
  },

  /** 新增人工风险（法务角色） */
  async createManual(
    taskId: string,
    user: User,
    data: {
      title: string;
      riskType: RiskItem['riskType'];
      riskLevel: RiskItem['riskLevel'];
      clauseNumber?: string;
      clauseTitle?: string;
      originalText: string;
      riskReason: string;
      suggestion: string;
      paragraphId?: string;
      reviewBasis?: string;
    },
  ): Promise<RiskItem> {
    const id = genId('RISK');
    const risk: RiskItem = {
      id: `${id}`,
      reviewTaskId: taskId,
      title: data.title,
      riskType: data.riskType,
      riskLevel: data.riskLevel,
      clauseNumber: data.clauseNumber ?? '人工标注',
      clauseTitle: data.clauseTitle ?? '法务补充',
      originalText: data.originalText,
      paragraphId: data.paragraphId ?? '',
      startPosition: 0,
      endPosition: data.originalText.length,
      riskReason: data.riskReason,
      reviewBasis: data.reviewBasis ?? '法务人工标注风险',
      suggestion: data.suggestion,
      editedSuggestion: null,
      confidence: 1,
      sourceType: 'manual',
      ruleId: null,
      status: 'pending',
      handler: user.name,
      handleComment: null,
      ignoreReason: null,
      version: 1,
      createdAt: now(),
      updatedAt: now(),
    };
    await db.upsertRisk(risk);
    await db.addAuditLog({
      reviewTaskId: taskId,
      objectType: 'risk',
      objectId: risk.id,
      action: '新增人工风险',
      operatorId: user.id,
      operatorName: user.name,
      beforeState: '无',
      afterState: '待处理',
      remark: [
        `风险标题：${data.title}`,
        `风险类型：${RISK_CATEGORY_LABEL(data.riskType)}`,
        `风险等级：${RISK_LEVEL_LABEL[data.riskLevel]}`,
        `条款位置：${data.clauseNumber ?? '人工标注'} ${data.clauseTitle ?? '法务补充'}`,
        `风险说明：${truncate(data.riskReason, 100)}`,
        `修改建议：${truncate(data.suggestion, 100)}`,
      ].join('\n'),
    });
    await db.recalcTaskStats(taskId);
    return risk;
  },
};
