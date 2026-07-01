/**
 * 合同原文渲染（P07 中栏）
 * - 段落渲染（条款号、标题、正文）
 * - 风险原文高亮（按等级颜色）
 * - 点击高亮选中对应风险
 * - 滚动定位到指定段落
 * - 字号调整、返回顶部
 */
import { forwardRef, memo, useImperativeHandle, useMemo, useRef, useState, useEffect } from 'react';
import { Button, Tooltip, Typography, Space, Empty } from 'antd';
import { ZoomIn, ZoomOut, ArrowUp, Hash } from 'lucide-react';
import { COLORS, RISK_LEVEL_MAP } from '@/constants';
import type { ContractParagraph, RiskItem } from '@/types';

const { Text, Title } = Typography;

export interface ContractTextViewHandle {
  scrollToParagraph: (paragraphId: string) => void;
  scrollToTop: () => void;
}

interface ContractTextViewProps {
  paragraphs: ContractParagraph[];
  risks: RiskItem[];
  activeRiskId?: string | null;
  onActivateRisk?: (riskId: string) => void;
}

interface RiskHighlight {
  riskId: string;
  start: number;
  end: number;
  level: RiskItem['riskLevel'];
}

interface Segment {
  text: string;
  risk?: { id: string; level: RiskItem['riskLevel'] };
}

/** 将段落按风险高亮位置切分 */
function splitSegments(text: string, highlights: RiskHighlight[]): Segment[] {
  if (highlights.length === 0) return [{ text }];
  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let cursor = 0;
  sorted.forEach((h) => {
    if (h.start > cursor) {
      segments.push({ text: text.slice(cursor, h.start) });
    }
    segments.push({ text: text.slice(h.start, h.end), risk: { id: h.riskId, level: h.level } });
    cursor = h.end;
  });
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) });
  }
  return segments;
}

const FONT_SIZES = [13, 14, 15, 16, 18] as const;

/** 单个段落渲染：提取为 memo 子组件，避免父组件状态变化时全量重算 splitSegments */
interface ParagraphItemProps {
  para: ContractParagraph;
  highlights: RiskHighlight[];
  isActive: boolean;
  activeRiskId?: string | null;
  fontSize: number;
  onActivateRisk?: (riskId: string) => void;
}

const ParagraphItem = memo(function ParagraphItem({
  para, highlights, isActive, activeRiskId, fontSize, onActivateRisk,
}: ParagraphItemProps) {
  const segments = useMemo(() => splitSegments(para.text, highlights), [para.text, highlights]);
  return (
    <div
      data-paragraph-id={para.id}
      style={{
        padding: isActive ? '12px 14px' : '4px 0',
        marginBottom: 8,
        borderRadius: 6,
        background: isActive ? '#f0f7ff' : 'transparent',
        border: isActive ? `1px solid #d6e4ff` : '1px solid transparent',
        transition: 'all 0.2s',
      }}
    >
      {para.clauseNo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <Hash size={12} color={COLORS.primary} />
          <Text strong style={{ color: COLORS.primary, fontSize: fontSize + 1 }}>
            {para.clauseNo}
          </Text>
          {para.clauseTitle && (
            <Text strong style={{ fontSize: fontSize + 1 }}>
              {para.clauseTitle}
            </Text>
          )}
        </div>
      )}
      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: COLORS.textPrimary }}>
        {segments.map((seg, i) => {
          if (!seg.risk) {
            return <span key={i}>{seg.text}</span>;
          }
          const cfg = RISK_LEVEL_MAP[seg.risk.level];
          const isActiveRisk = seg.risk.id === activeRiskId;
          return (
            <mark
              key={i}
              onClick={() => onActivateRisk?.(seg.risk!.id)}
              style={{
                background: cfg.bg,
                color: cfg.color,
                borderBottom: `2px solid ${cfg.color}`,
                fontWeight: isActiveRisk ? 700 : 500,
                padding: '1px 2px',
                borderRadius: 2,
                cursor: 'pointer',
                boxShadow: isActiveRisk ? `0 0 0 2px ${cfg.color}44` : 'none',
                transition: 'all 0.15s',
              }}
            >
              {seg.text}
            </mark>
          );
        })}
      </div>
    </div>
  );
});

const ContractTextView = forwardRef<ContractTextViewHandle, ContractTextViewProps>(
  ({ paragraphs, risks, activeRiskId, onActivateRisk }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [fontSizeIdx, setFontSizeIdx] = useState(1);

    // 段落 -> 风险高亮映射
    const paraRiskMap = useMemo(() => {
      const map = new Map<string, RiskHighlight[]>();
      risks.forEach((r) => {
        if (!map.has(r.paragraphId)) map.set(r.paragraphId, []);
        map.get(r.paragraphId)!.push({
          riskId: r.id,
          start: r.startPosition,
          end: r.endPosition,
          level: r.riskLevel,
        });
      });
      return map;
    }, [risks]);

    // 当前激活风险所在段落
    const activeParagraphId = useMemo(() => {
      if (!activeRiskId) return null;
      return risks.find((r) => r.id === activeRiskId)?.paragraphId ?? null;
    }, [activeRiskId, risks]);

    useImperativeHandle(ref, () => ({
      scrollToParagraph(paragraphId: string) {
        const el = containerRef.current?.querySelector(`[data-paragraph-id="${paragraphId}"]`);
        if (el) {
          el.scrollIntoView({ block: 'start' });
        }
      },
      scrollToTop() {
        containerRef.current?.scrollTo({ top: 0 });
      },
    }));

    // 当激活风险变化时滚动到段落
    useEffect(() => {
      if (activeParagraphId) {
        const el = containerRef.current?.querySelector(`[data-paragraph-id="${activeParagraphId}"]`);
        if (el) {
          el.scrollIntoView({ block: 'center' });
        }
      }
    }, [activeParagraphId]);

    const fontSize = FONT_SIZES[fontSizeIdx];

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* 工具栏 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 16px',
            borderBottom: `1px solid ${COLORS.border}`,
            background: '#fafbfc',
          }}
        >
          <Space size={12}>
            <Text strong style={{ fontSize: 14 }}>
              {paragraphs[0]?.text ?? '合同正文'}
            </Text>
            <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>
              共 {paragraphs.length} 段 · {risks.length} 处风险标注
            </Text>
          </Space>
          <Space size={4}>
            <Tooltip title="缩小字号">
              <Button
                type="text"
                size="small"
                icon={<ZoomOut size={14} />}
                disabled={fontSizeIdx === 0}
                onClick={() => setFontSizeIdx((i) => Math.max(0, i - 1))}
              />
            </Tooltip>
            <Tooltip title="放大字号">
              <Button
                type="text"
                size="small"
                icon={<ZoomIn size={14} />}
                disabled={fontSizeIdx === FONT_SIZES.length - 1}
                onClick={() => setFontSizeIdx((i) => Math.min(FONT_SIZES.length - 1, i + 1))}
              />
            </Tooltip>
            <Tooltip title="返回顶部">
              <Button type="text" size="small" icon={<ArrowUp size={14} />} onClick={() => containerRef.current?.scrollTo({ top: 0 })} />
            </Tooltip>
          </Space>
        </div>

        {/* 正文 */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '12px 16px',
            background: '#fff',
            lineHeight: 1.8,
            fontSize,
            wordBreak: 'break-word',
          }}
        >
          {paragraphs.map((para) => {
            const highlights = paraRiskMap.get(para.id) ?? [];
            return (
              <ParagraphItem
                key={para.id}
                para={para}
                highlights={highlights}
                isActive={para.id === activeParagraphId}
                activeRiskId={activeRiskId}
                fontSize={fontSize}
                onActivateRisk={onActivateRisk}
              />
            );
          })}

          {paragraphs.length === 0 && (
            <Empty description="暂无合同正文" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 60 }} />
          )}
        </div>
      </div>
    );
  },
);

ContractTextView.displayName = 'ContractTextView';
export default ContractTextView;
