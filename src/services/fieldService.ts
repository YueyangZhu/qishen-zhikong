/**
 * 抽取字段服务
 */
import { db, delay } from './db';
import { now } from '@/utils/format';
import type { ExtractedField, User } from '@/types';

export const fieldService = {
  async listByTask(taskId: string): Promise<ExtractedField[]> {
    return db.getFieldsByTask(taskId);
  },

  /** 更新单个字段（人工编辑值） */
  async update(fieldId: string, value: string, user: User): Promise<ExtractedField> {
    const field = (await db.getFields()).find((f) => f.id === fieldId);
    if (!field) throw new Error('字段不存在');
    const oldValue = field.confirmedValue ?? field.fieldValue;
    const updated: ExtractedField = {
      ...field,
      confirmedValue: value,
      confirmed: true,
    };
    await db.upsertField(updated);
    await db.addAuditLog({
      reviewTaskId: field.reviewTaskId,
      objectType: 'field',
      objectId: field.id,
      action: '编辑字段',
      operatorId: user.id,
      operatorName: user.name,
      beforeState: '未确认',
      afterState: '已确认',
      remark: [
        `字段名：${field.fieldLabel}`,
        `AI 抽取值：${field.fieldValue}`,
        `原确认值：${oldValue}`,
        `新确认值：${value}`,
        `置信度：${Math.round(field.confidence * 100)}%${field.lowConfidence ? '（低置信度）' : ''}`,
      ].join('\n'),
    });
    return updated;
  },

  /** 确认单个字段 */
  async confirm(fieldId: string, user: User): Promise<ExtractedField> {
    const field = (await db.getFields()).find((f) => f.id === fieldId);
    if (!field) throw new Error('字段不存在');
    const updated: ExtractedField = {
      ...field,
      confirmed: true,
      confirmedValue: field.confirmedValue ?? field.fieldValue,
    };
    await db.upsertField(updated);
    return updated;
  },

  /** 确认全部字段（标记 task.fieldsConfirmed） */
  async confirmAll(taskId: string, user: User): Promise<void> {
    const fields = await db.getFieldsByTask(taskId);
    await Promise.all(
      fields.map((f) =>
        db.upsertField({ ...f, confirmed: true, confirmedValue: f.confirmedValue ?? f.fieldValue }),
      ),
    );
    const task = await db.getTaskById(taskId);
    if (task) {
      await db.upsertTask({ ...task, fieldsConfirmed: true, updatedAt: now() });
    }
    await db.addAuditLog({
      reviewTaskId: taskId,
      objectType: 'task',
      objectId: taskId,
      action: '确认合同信息',
      operatorId: user.id,
      operatorName: user.name,
      beforeState: '未确认',
      afterState: '已确认',
      remark: '确认全部抽取字段',
    });
  },
};
