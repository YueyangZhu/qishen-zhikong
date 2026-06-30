/**
 * 通用状态标签
 * 基于 constants 中的统一映射渲染，禁止页面各自实现
 */
import { Tag } from 'antd';
import { RISK_LEVEL_MAP, REVIEW_STATUS_MAP, RISK_STATUS_MAP } from '@/constants';
import type { RiskLevel, ReviewStatus, RiskStatus } from '@/types';

export function RiskLevelTag({ level, showDot = false }: { level: RiskLevel; showDot?: boolean }) {
  const cfg = RISK_LEVEL_MAP[level];
  return (
    <Tag
      style={{
        color: cfg.color,
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 4,
        margin: 0,
        padding: '0 8px',
        fontSize: 12,
        lineHeight: '20px',
      }}
    >
      {showDot && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: cfg.color, marginRight: 6 }} />}
      {cfg.label}
    </Tag>
  );
}

export function ReviewStatusTag({ status }: { status: ReviewStatus }) {
  const cfg = REVIEW_STATUS_MAP[status];
  return (
    <Tag color={cfg.color} style={{ borderRadius: 4, margin: 0 }}>
      {cfg.label}
    </Tag>
  );
}

export function RiskStatusTag({ status }: { status: RiskStatus }) {
  const cfg = RISK_STATUS_MAP[status];
  return (
    <Tag color={cfg.color} style={{ borderRadius: 4, margin: 0 }}>
      {cfg.label}
    </Tag>
  );
}
