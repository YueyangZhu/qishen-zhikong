/**
 * 风险规则库服务
 */
import { db, delay, type RuleVersionRecord } from './db';
import { genId, now } from '@/utils/format';
import type { RiskRule, RuleStatus } from '@/types';

export interface RuleFilter {
  keyword?: string;
  riskType?: string;
  riskLevel?: string;
  status?: string;
}

export const ruleService = {
  async list(filter: RuleFilter = {}): Promise<RiskRule[]> {
    let rules = await db.getRules();
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase();
      // 全字段搜索：ID、编码、名称、合同类型、触发条件、风险说明模板、修改建议模板、规则说明
      rules = rules.filter(
        (r) =>
          r.id.toLowerCase().includes(kw) ||
          r.code.toLowerCase().includes(kw) ||
          r.name.toLowerCase().includes(kw) ||
          (r.contractType || '').toLowerCase().includes(kw) ||
          (r.triggerCondition || '').toLowerCase().includes(kw) ||
          (r.reasonTemplate || '').toLowerCase().includes(kw) ||
          (r.suggestionTemplate || '').toLowerCase().includes(kw) ||
          (r.description || '').toLowerCase().includes(kw),
      );
    }
    if (filter.riskType) rules = rules.filter((r) => r.riskType === filter.riskType);
    if (filter.riskLevel) rules = rules.filter((r) => r.riskLevel === filter.riskLevel);
    if (filter.status) rules = rules.filter((r) => r.status === filter.status);
    return [...rules].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async get(id: string): Promise<RiskRule | undefined> {
    return db.getRuleById(id);
  },

  async create(data: Omit<RiskRule, 'id' | 'version' | 'updatedAt'>): Promise<RiskRule> {
    const rule: RiskRule = {
      ...data,
      id: genId('RR'),
      version: 1,
      status: data.status || 'draft',
      updatedAt: now(),
    };
    await db.upsertRule(rule);
    // 记录初始版本
    await db.addRuleVersion({
      id: genId('RV'),
      ruleId: rule.id,
      version: 1,
      snapshot: { ...rule },
      changeNote: '新建规则',
      operatorName: '当前用户',
      createdAt: now(),
    });
    return rule;
  },

  /** 编辑启用规则时自动生成新版本，并记录历史版本快照 */
  async update(id: string, patch: Partial<RiskRule>): Promise<RiskRule> {
    const rule = await db.getRuleById(id);
    if (!rule) throw new Error('规则不存在');
    const wasEnabled = rule.status === 'enabled';
    const versionBump = wasEnabled && patch.status !== 'disabled';
    const updated: RiskRule = {
      ...rule,
      ...patch,
      version: versionBump ? rule.version + 1 : rule.version,
      updatedAt: now(),
    };
    await db.upsertRule(updated);
    // 启用态被修改时记录新版本快照
    if (versionBump) {
      await db.addRuleVersion({
        id: genId('RV'),
        ruleId: id,
        version: updated.version,
        snapshot: { ...updated },
        changeNote: buildChangeNote(rule, updated),
        operatorName: '当前用户',
        createdAt: now(),
      });
    }
    return updated;
  },

  async toggle(id: string): Promise<RiskRule> {
    const rule = await db.getRuleById(id);
    if (!rule) throw new Error('规则不存在');
    const next: RuleStatus = rule.status === 'enabled' ? 'disabled' : 'enabled';
    return ruleService.update(id, { status: next });
  },

  async remove(id: string): Promise<void> {
    await db.removeRule(id);
  },

  /** 获取规则所有历史版本（按版本号倒序） */
  async getVersions(id: string): Promise<RuleVersionRecord[]> {
    return db.getRuleVersions(id);
  },
};

/** 生成版本变更说明：对比前后字段差异 */
function buildChangeNote(before: RiskRule, after: RiskRule): string {
  const changes: string[] = [];
  if (before.name !== after.name) changes.push(`规则名称：${before.name} → ${after.name}`);
  if (before.riskLevel !== after.riskLevel) changes.push(`风险等级：${before.riskLevel} → ${after.riskLevel}`);
  if (before.riskType !== after.riskType) changes.push(`风险类型：${before.riskType} → ${after.riskType}`);
  if (before.triggerCondition !== after.triggerCondition) changes.push('触发条件已修改');
  if (before.reasonTemplate !== after.reasonTemplate) changes.push('风险说明模板已修改');
  if (before.suggestionTemplate !== after.suggestionTemplate) changes.push('修改建议模板已修改');
  if (before.status !== after.status) changes.push(`状态：${before.status} → ${after.status}`);
  return changes.length > 0 ? changes.join('；') : '规则内容已更新';
}
