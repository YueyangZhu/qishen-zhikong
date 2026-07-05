/**
 * 合同原文渲染（中栏）
 * - 统一为原文格式展示（DOCX 用 docx-preview，PDF 用 pdf.js）
 * - 风险标注通过文本匹配叠加在原文 DOM 上（overlayRisks）
 * - 原文渲染失败时降级到结构化视图
 * - 滚动定位到指定段落、缩放、返回顶部
 */
import { forwardRef, memo, useImperativeHandle, useMemo, useRef, useState, useEffect } from 'react';
import { Button, Tooltip, Typography, Space, Empty, Spin, message } from 'antd';
import { ZoomIn, ZoomOut, ArrowUp, Hash, Download, FileWarning } from 'lucide-react';
import { renderAsync } from 'docx-preview';
import * as pdfjs from 'pdfjs-dist';
import { COLORS, RISK_LEVEL_MAP } from '@/constants';
import { inferParagraphType } from '@/utils/logic';
import { generateDocxFromParagraphs } from '@/utils/docxGenerator';
import type { ContractParagraph, ParagraphType, RiskItem } from '@/types';

const { Text } = Typography;

// pdf.js worker：使用 Vite URL 导入，构建时会自动处理为可访问的 worker 文件
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href;

export interface ContractTextViewHandle {
  scrollToParagraph: (paragraphId: string) => void;
  scrollToRisk: (riskId: string) => void;
  scrollToTop: () => void;
}

interface ContractTextViewProps {
  paragraphs: ContractParagraph[];
  risks: RiskItem[];
  activeRiskId?: string | null;
  onActivateRisk?: (riskId: string) => void;
  fileName?: string;
  taskId?: string;
  htmlContent?: string | null;
  sampleId?: string | null;
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

/** 原文格式视图的渲染状态 */
type OriginalState =
  | { mode: 'idle' }
  | { mode: 'loading' }
  | { mode: 'docx' }
  | { mode: 'pdf' }
  | { mode: 'error'; message: string };

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

/** 对段落内高亮做去重：重叠/包含时只保留风险等级最高的一个，避免颜色叠加 */
function dedupHighlights(highlights: RiskHighlight[]): RiskHighlight[] {
  if (highlights.length <= 1) return highlights;
  const levelOrder: Record<RiskItem['riskLevel'], number> = { high: 0, medium: 1, low: 2, notice: 3 };
  const sorted = [...highlights].sort((a, b) => {
    const o = levelOrder[a.level] - levelOrder[b.level];
    if (o !== 0) return o;
    return (b.end - b.start) - (a.end - a.start);
  });
  const selected: RiskHighlight[] = [];
  for (const h of sorted) {
    let skip = false;
    for (const s of selected) {
      // 完全包含
      if (h.start >= s.start && h.end <= s.end) {
        skip = true;
        break;
      }
      // 重叠比例超过阈值
      const oStart = Math.max(h.start, s.start);
      const oEnd = Math.min(h.end, s.end);
      if (oEnd > oStart) {
        const minLen = Math.min(h.end - h.start, s.end - s.start);
        if (minLen > 0 && (oEnd - oStart) / minLen > 0.35) {
          skip = true;
          break;
        }
      }
    }
    if (!skip) selected.push(h);
  }
  // 保持传入的相对顺序
  const selectedIds = new Set(selected.map((h) => h.riskId));
  return highlights.filter((h) => selectedIds.has(h.riskId));
}

const FONT_SIZES = [13, 14, 15, 16, 18] as const;

/** 单个段落渲染：提取为 memo 子组件，按 type 差异化样式 */
interface ParagraphItemProps {
  para: ContractParagraph;
  /** 段落索引（从1开始），用于兜底识别 type */
  index: number;
  highlights: RiskHighlight[];
  isActive: boolean;
  activeRiskId?: string | null;
  fontSize: number;
  onActivateRisk?: (riskId: string) => void;
}

const ParagraphItem = memo(function ParagraphItem({
  para, index, highlights, isActive, activeRiskId, fontSize, onActivateRisk,
}: ParagraphItemProps) {
  // 段落类型：优先用 para.type，无则前端兜底识别（与后端规则一致）
  const paraType: ParagraphType = para.type ?? inferParagraphType(para, index);

  // 正文条款：段落文本通常以「第一条 标题」开头，与上方单独渲染的 clauseNo/clauseTitle 重复，
  // 因此去除该前缀后再渲染正文，避免同一小标题出现两次。
  // 兼容：多个空格、全角空格、标题后冒号/顿号、标题重复等情况。
  // 同时把落在被去除标题区域内的风险高亮单独抽出来，用于给章节标题本身上色。
  let prefixLen = 0;
  let displayText = para.text;
  let titleHighlights: RiskHighlight[] = [];
  let bodyHighlights: RiskHighlight[] = highlights;
  if (paraType === 'body' && para.clauseNo) {
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const titlePattern = para.clauseTitle
      ? `${escapeRegExp(para.clauseNo)}[\\s\\u3000]+${escapeRegExp(para.clauseTitle)}[\\s\\u3000]*[:：、，,]?[\\s\\u3000]*`
      : `${escapeRegExp(para.clauseNo)}[\\s\\u3000]*[:：、，,]?[\\s\\u3000]*`;
    const pattern = new RegExp(`^${titlePattern}`);

    while (true) {
      const rest = displayText.slice(prefixLen);
      const match = rest.match(pattern);
      if (!match) break;
      prefixLen += match[0].length;
    }

    if (prefixLen > 0) {
      displayText = displayText.slice(prefixLen);
      titleHighlights = highlights.filter((h) => h.start < prefixLen);
      bodyHighlights = highlights
        .filter((h) => h.start >= prefixLen)
        .map((h) => ({ ...h, start: h.start - prefixLen, end: h.end - prefixLen }));
    }
  }

  const segments = useMemo(() => splitSegments(displayText, bodyHighlights), [displayText, bodyHighlights]);

  // 标题上实际存在的风险：取标题区域内最高等级作为标题样式
  const titleRiskHighlight = useMemo(() => {
    if (titleHighlights.length === 0) return null;
    return titleHighlights.reduce((max, h) =>
      RISK_LEVEL_MAP[h.level].rank > RISK_LEVEL_MAP[max.level].rank ? h : max
    );
  }, [titleHighlights]);

  // === 标题段：大字号、居中、加粗 ===
  if (paraType === 'title') {
    return (
      <div
        data-paragraph-id={para.id}
        style={{
          textAlign: 'center',
          fontSize: fontSize + 5,
          fontWeight: 700,
          margin: '20px 0 16px',
          color: COLORS.textPrimary,
          lineHeight: 1.5,
        }}
      >
        {para.text}
      </div>
    );
  }

  // === 首部段（甲乙方信息）：小字号、灰色背景 ===
  if (paraType === 'header') {
    return (
      <div
        data-paragraph-id={para.id}
        style={{
          fontSize: fontSize - 1,
          color: COLORS.textPrimary,
          background: '#fafbfc',
          padding: '8px 12px',
          borderRadius: 4,
          marginBottom: 6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: 1.7,
          borderLeft: `3px solid ${COLORS.border}`,
        }}
      >
        {para.text}
      </div>
    );
  }

  // === 图片段：渲染 base64 图片 ===
  if (paraType === 'image' && para.imageData) {
    const riskBadges = highlights.length > 0 ? (
      <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
        {Array.from(new Map(highlights.map((h) => [h.riskId, h])).values()).map((h) => {
          const cfg = RISK_LEVEL_MAP[h.level];
          return (
            <span
              key={h.riskId}
              onClick={() => onActivateRisk?.(h.riskId)}
              style={{
                fontSize: 11,
                color: cfg.color,
                background: cfg.bg,
                border: `1px solid ${cfg.color}`,
                borderRadius: 4,
                padding: '1px 5px',
                cursor: 'pointer',
              }}
            >
              {cfg.label}
            </span>
          );
        })}
      </div>
    ) : null;
    return (
      <div
        data-paragraph-id={para.id}
        style={{ margin: '8px 0', textAlign: 'center' }}
      >
        {riskBadges}
        <img
          src={`data:image/${para.imageFormat || 'png'};base64,${para.imageData}`}
          style={{
            maxWidth: '100%',
            borderRadius: 4,
            border: `1px solid ${COLORS.border}`,
            verticalAlign: 'middle',
          }}
          alt="合同图片"
        />
      </div>
    );
  }

  // === 签署段：小字号、灰色背景、顶部留白 ===
  if (paraType === 'signature') {
    return (
      <div
        data-paragraph-id={para.id}
        style={{
          fontSize: fontSize - 1,
          color: COLORS.textSecondary,
          background: '#fafbfc',
          padding: '10px 12px',
          borderRadius: 4,
          marginTop: 16,
          marginBottom: 8,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: 1.7,
          borderLeft: `3px solid ${COLORS.border}`,
        }}
      >
        {para.text}
      </div>
    );
  }

  // === body 段（正文条款）：保留原有渲染逻辑（clauseNo + 高亮）===
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          <Hash size={12} color={COLORS.primary} />
          <span
            onClick={() => titleRiskHighlight && onActivateRisk?.(titleRiskHighlight.riskId)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: titleRiskHighlight ? 'pointer' : 'default',
              ...(titleRiskHighlight
                ? {
                    background: RISK_LEVEL_MAP[titleRiskHighlight.level].bg,
                    color: RISK_LEVEL_MAP[titleRiskHighlight.level].color,
                    borderBottom: `2px solid ${RISK_LEVEL_MAP[titleRiskHighlight.level].color}`,
                    padding: '1px 3px',
                    borderRadius: 2,
                    boxShadow: titleRiskHighlight.riskId === activeRiskId ? `0 0 0 2px ${RISK_LEVEL_MAP[titleRiskHighlight.level].color}44` : 'none',
                    transition: 'all 0.15s',
                  }
                : {}),
            }}
          >
            <Text strong style={{ color: titleRiskHighlight ? 'inherit' : COLORS.primary, fontSize: fontSize + 1 }}>
              {para.clauseNo}
            </Text>
            {para.clauseTitle && (
              <Text strong style={{ color: titleRiskHighlight ? 'inherit' : COLORS.textPrimary, fontSize: fontSize + 1 }}>
                {para.clauseTitle}
              </Text>
            )}
          </span>
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
              data-risk-id={seg.risk.id}
              data-risk-level={seg.risk.level}
              onClick={() => onActivateRisk?.(seg.risk!.id)}
              className={`risk-highlight ${isActiveRisk ? 'active' : ''}`}
              style={{
                background: cfg.bg,
                color: cfg.color,
                // 使用内阴影实现下划线效果，不占用额外高度，避免遮挡相邻行文字
                boxShadow: isActiveRisk
                  ? `inset 0 -2px 0 0 ${cfg.color}, 0 0 0 2px ${hexToRgba(cfg.color, 0.35)}`
                  : `inset 0 -2px 0 0 ${cfg.color}`,
                fontWeight: isActiveRisk ? 700 : 500,
                padding: '0 2px',
                borderRadius: 2,
                cursor: 'pointer',
                transition: 'all 0.15s',
                lineHeight: 'inherit',
                verticalAlign: 'baseline',
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

// ===== 原文渲染完成后的风险叠加 =====

interface RiskOverlayItem {
  riskId: string;
  level: RiskItem['riskLevel'];
  originalText: string;
  paragraphId: string;
}

/**
 * 在原文渲染容器内，通过文本匹配找到风险原文并用 <mark> 包裹叠加高亮。
 * 使用 TreeWalker 遍历 DOM 文本节点，拼接成全文后做位置匹配，再用 Range API 包裹。
 * 仅处理正文段落，table 段落的风险由 applyTableRiskOverlays 独立处理（非侵入式覆盖层）。
 */
function overlayRisks(
  container: HTMLElement,
  risks: RiskOverlayItem[],
  paragraphs: ContractParagraph[],
  onActivateRisk?: (riskId: string) => void,
): number {
  // 清除旧的高亮 mark（table 风险覆盖层由 applyTableRiskOverlays 独立清除）
  container.querySelectorAll('mark.risk-highlight').forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  });

  // 收集所有文本节点和全文
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const v = node.nodeValue;
      if (!v || !v.trim()) return NodeFilter.FILTER_REJECT;
      // 跳过 script/style
      const parent = node.parentElement;
      if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  type TextNodeInfo = { node: Text; start: number };
  const textNodes: TextNodeInfo[] = [];
  let fullText = '';
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    textNodes.push({ node, start: fullText.length });
    fullText += node.nodeValue || '';
  }

  if (!fullText || textNodes.length === 0) return 0;

  // 构建段落区间表：用 paragraphs[].text 前 20 字符在 fullText 中顺序匹配
  // 用于按 paragraphId 限定风险原文的搜索范围，避免短原文（如"甲方"）误匹配到首次出现位置
  const paraRanges = new Map<string, { start: number; end: number }>();
  {
    let searchFrom = 0;
    for (const para of paragraphs) {
      const paraText = para.text || '';
      const prefix = paraText.slice(0, 20).trim();
      if (!prefix) continue;
      const idx = fullText.indexOf(prefix, searchFrom);
      if (idx === -1) continue;
      const paraEnd = idx + paraText.length;
      paraRanges.set(para.id, { start: idx, end: Math.min(paraEnd, fullText.length) });
      searchFrom = paraEnd;
    }
  }

  // 在指定区间内查找风险原文：先精确匹配，再归一化空白匹配
  // 返回 { start, end }，end 为匹配文本最后一个字符的下一个位置，已考虑 DOM 中空白字符差异
  const findInSegment = (search: string, segStart: number, segEnd: number): { start: number; end: number } | null => {
    const segment = fullText.slice(segStart, segEnd);
    const localIdx = segment.indexOf(search);
    if (localIdx !== -1) {
      const start = segStart + localIdx;
      return { start, end: start + search.length };
    }
    const normSeg = segment.replace(/\s+/g, '');
    const normSearch = search.replace(/\s+/g, '');
    const normIdx = normSeg.indexOf(normSearch);
    if (normIdx === -1) return null;
    // 将归一化位置映射回原文位置
    let origIdx = 0;
    let ni = 0;
    while (ni < normIdx) {
      if (!/\s/.test(segment[origIdx])) ni++;
      origIdx++;
    }
    const candidateStart = segStart + origIdx;
    // 验证后续字符匹配，并计算原始文本中的真实结束位置
    let ok = true;
    let oi = candidateStart;
    for (let i = 0; i < normSearch.length; i++) {
      while (oi < fullText.length && /\s/.test(fullText[oi])) oi++;
      if (oi >= fullText.length || fullText[oi] !== normSearch[i]) { ok = false; break; }
      oi++;
    }
    return ok ? { start: candidateStart, end: oi } : null;
  };

  let overlaid = 0;

  // 先对所有风险做匹配定位，再按等级+覆盖长度排序，剔除与高风险大幅重叠的低风险，
  // 避免同一段文字出现中/低风险叠加、颜色浑浊的问题。
  const levelOrder: Record<RiskItem['riskLevel'], number> = { high: 0, medium: 1, low: 2, notice: 3 };
  const candidates: {
    risk: RiskOverlayItem;
    normSearch: string;
    matchStart: number;
    matchEnd: number;
    matchLen: number;
  }[] = [];

  for (const risk of risks) {
    const search = risk.originalText?.trim();
    if (!search || search.length < 2) continue;

    // table 段落跳过：table 风险由 applyTableRiskOverlays 独立处理（非侵入式覆盖层）
    const para = paragraphs.find((p) => p.id === risk.paragraphId);
    if (para?.type === 'table') continue;

    // 优先在 paragraphId 对应区间内查找，避免短原文误匹配到全文首次出现位置
    const paraRange = paraRanges.get(risk.paragraphId);
    let match: { start: number; end: number } | null = null;
    if (paraRange) {
      match = findInSegment(search, paraRange.start, paraRange.end);
    }
    // 区间内未找到 → 回退到全文查找（保持原有兼容行为）
    if (!match) {
      match = findInSegment(search, 0, fullText.length);
    }
    if (!match) continue;

    candidates.push({
      risk,
      normSearch: normalizeSearchText(search),
      matchStart: match.start,
      matchEnd: match.end,
      matchLen: match.end - match.start,
    });
  }

  candidates.sort((a, b) => {
    const o = levelOrder[a.risk.level] - levelOrder[b.risk.level];
    if (o !== 0) return o;
    return b.matchLen - a.matchLen;
  });

  const selected: typeof candidates = [];
  const seenNormTexts = new Set<string>();
  const coveredRanges: { start: number; end: number; len: number; normSearch: string }[] = [];
  const OVERLAP_THRESHOLD = 0.35;

  for (const c of candidates) {
    // 归一化原文完全相同的只保留最高等级（排序后已在前面）
    if (seenNormTexts.has(c.normSearch)) continue;
    seenNormTexts.add(c.normSearch);

    let skip = false;
    for (const r of coveredRanges) {
      // 1. 子串包含：当前原文是已保留原文的子串，或已保留原文是当前原文的子串
      if (c.normSearch.includes(r.normSearch) || r.normSearch.includes(c.normSearch)) {
        skip = true;
        break;
      }
      // 2. 区间重叠比例超过阈值（相对于较短区间），跳过该低等级风险
      const oStart = Math.max(c.matchStart, r.start);
      const oEnd = Math.min(c.matchEnd, r.end);
      if (oEnd <= oStart) continue;
      const minLen = Math.min(c.matchLen, r.len);
      if (minLen > 0 && (oEnd - oStart) / minLen > OVERLAP_THRESHOLD) {
        skip = true;
        break;
      }
    }
    if (skip) continue;

    coveredRanges.push({ start: c.matchStart, end: c.matchEnd, len: c.matchLen, normSearch: c.normSearch });
    selected.push(c);
  }

  for (const { risk, matchStart, matchEnd } of selected) {
    // 找到匹配范围对应的文本节点
    let startNode: Text | null = null;
    let startOffset = 0;
    let endNode: Text | null = null;
    let endOffset = 0;

    for (const { node, start } of textNodes) {
      const nodeEnd = start + (node.nodeValue?.length || 0);
      if (!startNode && start <= matchStart && nodeEnd > matchStart) {
        startNode = node;
        startOffset = matchStart - start;
      }
      if (start <= matchEnd && nodeEnd >= matchEnd) {
        endNode = node;
        endOffset = matchEnd - start;
        break;
      }
    }

    if (!startNode || !endNode) continue;

    // 创建高亮 mark
    const cfg = RISK_LEVEL_MAP[risk.level];
    const mark = document.createElement('mark');
    mark.className = 'risk-highlight';
    mark.setAttribute('data-risk-id', risk.riskId);
    mark.setAttribute('data-risk-level', risk.level);
    mark.style.cssText = [
      `background:${cfg.bg}`,
      `color:${cfg.color}`,
      `border-bottom:2px solid ${cfg.color}`,
      'padding:1px 3px',
      'border-radius:2px',
      'cursor:pointer',
      'font-weight:500',
      'transition:all 0.15s',
    ].join(';');
    mark.addEventListener('click', () => onActivateRisk?.(risk.riskId));

    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);

    try {
      // surroundContents 在跨节点时会抛异常，用 extractContents + insertNode 兜底
      const contents = range.extractContents();
      mark.appendChild(contents);
      range.insertNode(mark);
      overlaid++;
    } catch (e) {
      console.warn('[overlayRisks] wrap failed for risk', risk.riskId, e);
    }
  }

  return overlaid;
}

/**
 * 非侵入式表格风险覆盖层：在表格上方叠加透明层，通过 getBoundingClientRect
 * 在对应单元格位置绘制彩色标记。表格 DOM 完全不受影响，避免触发浏览器重排导致列宽错乱。
 */
function applyTableRiskOverlays(
  container: HTMLElement,
  risks: RiskOverlayItem[],
  paragraphs: ContractParagraph[],
  onActivateRisk?: (riskId: string) => void,
): void {
  // 清除旧的覆盖层 + 恢复 td 原始样式
  // 1. 先恢复所有被标记 td 的原始样式（td 同时有 data-risk-orig-bg 和 data-risk-orig-color）
  container.querySelectorAll('[data-risk-orig-bg]').forEach((el) => {
    const td = el as HTMLTableCellElement;
    td.style.backgroundColor = td.dataset.riskOrigBg || '';
    td.style.color = td.dataset.riskOrigColor || '';
    td.style.cursor = '';
    delete td.dataset.riskOrigBg;
    delete td.dataset.riskOrigColor;
    delete td.dataset.riskId;
    delete td.dataset.riskBound;
  });
  // 2. 恢复 span 的原始 color（排除已被上面 td 逻辑处理过的）
  container.querySelectorAll('[data-risk-orig-color]').forEach((el) => {
    if (el.tagName === 'SPAN') {
      const span = el as HTMLElement;
      span.style.color = span.dataset.riskOrigColor || '';
      delete span.dataset.riskOrigColor;
    }
  });
  // 3. 再移除 wrapper（把 table 从 wrapper 里移出去恢复原 DOM 结构）
  container.querySelectorAll('.table-risk-overlay-wrapper').forEach((el) => {
    const wrapper = el as HTMLElement;
    const table = wrapper.querySelector('table');
    if (table) {
      wrapper.parentNode?.insertBefore(table, wrapper);
    }
    wrapper.remove();
  });

  // 按 paragraphId 分组 table 风险
  const riskByTable = new Map<string, RiskOverlayItem[]>();
  for (const risk of risks) {
    const para = paragraphs.find((p) => p.id === risk.paragraphId);
    if (para?.type !== 'table') continue;
    const list = riskByTable.get(risk.paragraphId) || [];
    list.push(risk);
    riskByTable.set(risk.paragraphId, list);
  }

  if (riskByTable.size === 0) return;

  // 对每个表格创建覆盖层
  riskByTable.forEach((tableRisks, paraId) => {
    const table = container.querySelector(`table[data-paragraph-id="${paraId}"]`) as HTMLTableElement;
    if (!table) return;

    // 为表格创建包裹层，用于定位覆盖层（position:relative）
    const wrapper = document.createElement('div');
    wrapper.className = 'table-risk-overlay-wrapper';
    wrapper.style.cssText = 'position:relative;width:100%;';

    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);

    // 创建覆盖层（透明，不拦截事件，仅用于承载标记）
    const overlay = document.createElement('div');
    overlay.className = 'table-risk-overlay';
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;';
    wrapper.appendChild(overlay);

    // 为每个风险给对应单元格/行加底色 + 字体颜色（保留 hitArea 透明点击层用于交互）
    // 先按风险等级排序，同一段表格内容只显示最高等级，避免颜色叠加
    const levelOrder: Record<RiskItem['riskLevel'], number> = { high: 0, medium: 1, low: 2, notice: 3 };
    const sortedTableRisks = [...tableRisks].sort((a, b) => levelOrder[a.level] - levelOrder[b.level]);
    const coloredCells = new Set<HTMLTableCellElement>();
    const coloredRows = new Set<HTMLTableRowElement>();

    for (const risk of sortedTableRisks) {
      const target = findTableTarget(table, risk.originalText);
      if (!target) continue;

      // 若单元格/行已被更高等级风险着色，跳过，避免同一单元格多色叠加
      const parentRow = target.closest('tr') as HTMLTableRowElement | null;
      if (target.tagName === 'TD' || target.tagName === 'TH') {
        const cell = target as HTMLTableCellElement;
        if (coloredCells.has(cell)) continue;
        if (parentRow && coloredRows.has(parentRow)) continue;
      } else if (target.tagName === 'TR') {
        const row = target as HTMLTableRowElement;
        if (coloredRows.has(row)) continue;
        const cells = Array.from(row.querySelectorAll('td, th')) as HTMLTableCellElement[];
        if (cells.some((c) => coloredCells.has(c))) continue;
      }

      const cfg = RISK_LEVEL_MAP[risk.level];

      // 确定要加样式的 td 列表：单单元格匹配 → [td]；行级匹配 → tr 内所有 td
      let tds: HTMLTableCellElement[] = [];
      if (target.tagName === 'TD' || target.tagName === 'TH') {
        tds = [target as HTMLTableCellElement];
      } else if (target.tagName === 'TR') {
        tds = Array.from(target.querySelectorAll('td, th')) as HTMLTableCellElement[];
      }
      if (tds.length === 0) continue;

      // 给每个 td 加底色 + 字体颜色（保存原值便于清除）
      // background-color 和 color 只触发 repaint 不触发 reflow，不会导致列宽错乱
      for (const td of tds) {
        td.dataset.riskOrigBg = td.style.backgroundColor || '';
        td.dataset.riskOrigColor = td.style.color || '';
        td.dataset.riskId = risk.riskId;
        td.style.backgroundColor = cfg.bg;
        td.style.color = cfg.color;
        td.style.cursor = 'pointer';

        // td 内所有 span 也设 color（覆盖 docx-preview 的 span color）
        td.querySelectorAll('span').forEach((span) => {
          const s = span as HTMLElement;
          s.dataset.riskOrigColor = s.style.color || '';
          s.style.color = cfg.color;
        });

        // 给 td 绑定 click 事件触发风险激活（不拦截文本选择，用户可正常复制内容）
        // 用 mousedown + 阈值判断：拖动选择文本时不触发 click
        // 用 dataset.riskBound 标记避免重复绑定
        if (!td.dataset.riskBound) {
          td.dataset.riskBound = '1';
          let mouseDownX = 0;
          let mouseDownY = 0;
          td.addEventListener('mousedown', (e) => {
            mouseDownX = e.clientX;
            mouseDownY = e.clientY;
          });
          td.addEventListener('click', (e) => {
            // 拖动距离超过 5px 视为文本选择，不触发 click
            const dx = Math.abs(e.clientX - mouseDownX);
            const dy = Math.abs(e.clientY - mouseDownY);
            if (dx > 5 || dy > 5) return;
            // 从 dataset 读取当前绑定的 riskId（清除时会被删除，重新绑定时会更新）
            const currentRiskId = td.dataset.riskId;
            if (!currentRiskId) return;
            e.stopPropagation();
            onActivateRisk?.(currentRiskId);
          });
        }

        coloredCells.add(td);
      }

      if (target.tagName === 'TR') {
        coloredRows.add(target as HTMLTableRowElement);
      }
    }
  });
}

/**
 * 在表格中找到包含指定文本的目标（单元格或整行）
 * 策略：
 * 1. 优先单单元格匹配（originalText 可能是单个单元格内容）
 * 2. fallback 到行级匹配（originalText 是整行单元格空格拼接的文本）
 * 3. 行级匹配成功时返回整行 tr，overlay 会覆盖整行
 */
function findTableTarget(table: HTMLTableElement, search: string): HTMLElement | null {
  const normSearch = search.replace(/\s+/g, '');
  if (!normSearch) return null;

  // 策略 1：单单元格匹配（归一化空白后做子串匹配，优先内容最短的单元格）
  const cells = Array.from(table.querySelectorAll('td, th')) as HTMLTableCellElement[];
  const cellMatches = cells
    .map((c) => {
      const text = (c.textContent || '').replace(/\s+/g, '');
      const idx = text.indexOf(normSearch);
      return idx !== -1 ? { cell: c, length: text.length } : null;
    })
    .filter(Boolean) as { cell: HTMLTableCellElement; length: number }[];

  if (cellMatches.length > 0) {
    cellMatches.sort((a, b) => a.length - b.length);
    return cellMatches[0].cell;
  }

  // 策略 2：行级匹配（originalText 是整行单元格空格拼接的文本）
  // 归一化后：整行所有单元格文本拼接，做子串匹配
  const rows = Array.from(table.querySelectorAll('tr')) as HTMLTableRowElement[];
  for (const row of rows) {
    const rowCells = Array.from(row.querySelectorAll('td, th')) as HTMLTableCellElement[];
    if (rowCells.length === 0) continue;
    const rowText = rowCells.map((c) => c.textContent || '').join('').replace(/\s+/g, '');
    if (rowText.includes(normSearch)) {
      return row;
    }
  }

  return null;
}

/**
 * 将十六进制颜色转换为 rgba。
 */
function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.substring(0, 2), 16);
  const g = parseInt(normalized.substring(2, 4), 16);
  const b = parseInt(normalized.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * PDF textLayer 风险背景色透明度。
 * 使用半透明 rgba，既保留淡淡底色，又不遮挡 PDF 原有黑色文字。
 */
const PDF_BG_ALPHA: Record<RiskItem['riskLevel'], number> = {
  high: 0.45,
  medium: 0.52,
  low: 0.55,
  notice: 0.48,
};

/**
 * 统一应用当前激活风险的高亮加深样式。
 * 在 activeRiskId 变化、DOCX/PDF 渲染完成时调用，确保首次进入页面默认选中的风险也能正确高亮。
 */
function applyActiveRiskHighlight(container: HTMLElement, activeRiskId: string | null | undefined): void {
  if (!activeRiskId || !container) return;

  // 重置 PDF overlay 激活态
  container.querySelectorAll('.pdf-risk-overlay').forEach((o) => {
    const div = o as HTMLElement;
    const level = div.dataset.riskLevel as RiskItem['riskLevel'] | undefined;
    const cfg = level ? RISK_LEVEL_MAP[level] : null;
    div.style.setProperty('background-color', div.dataset.pdfRiskOrigBg || (level && hexToRgba(RISK_LEVEL_MAP[level].bg, PDF_BG_ALPHA[level])) || '', 'important');
    div.style.setProperty('box-shadow', `inset 0 -2px 0 0 ${cfg?.color || ''}`, 'important');
    div.dataset.pdfRiskActive = '';
  });
  // 重置 DOCX mark 激活态
  container.querySelectorAll('mark.risk-highlight.active').forEach((m) => {
    const el = m as HTMLElement;
    el.style.setProperty('background-color', el.dataset.riskOrigBg || '', 'important');
    el.style.setProperty('color', el.dataset.riskOrigColor || '', 'important');
    el.style.setProperty('box-shadow', 'none', 'important');
    el.style.setProperty('outline', 'none', 'important');
    el.style.setProperty('font-weight', '500', 'important');
    el.classList.remove('active');
  });

  // DOCX：给对应 mark 加深高亮
  const mark = container.querySelector(`mark.risk-highlight[data-risk-id="${activeRiskId}"]`) as HTMLElement | null;
  if (mark) {
    const level = mark.dataset.riskLevel as RiskItem['riskLevel'];
    const cfg = level ? RISK_LEVEL_MAP[level] : null;
    if (cfg) {
      if (!mark.dataset.riskOrigBg) {
        mark.dataset.riskOrigBg = mark.style.backgroundColor || cfg.bg;
      }
      if (!mark.dataset.riskOrigColor) {
        mark.dataset.riskOrigColor = mark.style.color || cfg.color;
      }
      mark.style.setProperty('background-color', hexToRgba(cfg.color, 0.65), 'important');
      mark.style.setProperty('color', '#fff', 'important');
      // 外部 glow 缩小为 2px，outline 改为内描边，避免 mark 尺寸向外扩展遮挡相邻行
      mark.style.setProperty('box-shadow', `inset 0 0 0 2px ${cfg.color}, 0 0 0 2px ${hexToRgba(cfg.color, 0.35)}`, 'important');
      mark.style.setProperty('outline', 'none', 'important');
      mark.style.setProperty('font-weight', '700', 'important');
      mark.style.borderRadius = '3px';
    }
    mark.classList.add('active');
    return;
  }

  // PDF：给对应 overlay 加深高亮
  const overlays = container.querySelectorAll(`.pdf-risk-overlay[data-risk-id="${activeRiskId}"]`);
  if (overlays.length > 0) {
    const first = overlays[0] as HTMLElement;
    const level = first.dataset.riskLevel as RiskItem['riskLevel'];
    const cfg = level ? RISK_LEVEL_MAP[level] : null;
    if (cfg) {
      overlays.forEach((o) => {
        const div = o as HTMLElement;
        if (!div.dataset.pdfRiskOrigBg) {
          div.dataset.pdfRiskOrigBg = div.style.backgroundColor;
        }
        div.style.setProperty('background-color', hexToRgba(cfg.color, 0.55), 'important');
        // PDF 激活态与 Word 保持一致：内描边 + 外发光，不使用 outline 避免尺寸外扩
        div.style.setProperty('box-shadow', `inset 0 0 0 2px ${cfg.color}, 0 0 0 2px ${hexToRgba(cfg.color, 0.35)}`, 'important');
        div.dataset.pdfRiskActive = '1';
      });
    }
  }
}

/**
 * 在 PDF text layer 上叠加风险高亮层。
 *
 * 不直接修改 textLayer span 的样式，而是为每个匹配到的风险范围创建绝对定位的 overlay div：
 * 1. 同一风险使用统一颜色，避免"同一段文字底色深浅不一"。
 * 2. 同一行内相邻 span 合并为一个 overlay div，下划线连续不断裂。
 * 3. overlay div 设置 pointer-events:none，不干扰 PDF 文字选择和搜索。
 */
function highlightPdfRisks(
  container: HTMLElement,
  risks: RiskOverlayItem[],
  paragraphs: ContractParagraph[],
  onActivateRisk?: (riskId: string) => void,
): void {
  // 清除旧 overlay
  container.querySelectorAll('.pdf-risk-overlay').forEach((el) => el.remove());

  // 清除旧版在 span 上设置的高亮样式（兼容旧数据刷新后残留）
  container.querySelectorAll('[data-pdf-risk-highlight]').forEach((el) => {
    const span = el as HTMLElement;
    span.style.backgroundColor = span.dataset.pdfRiskOrigBg || '';
    span.style.color = span.dataset.pdfRiskOrigColor || '';
    span.style.borderBottom = span.dataset.pdfRiskOrigBorderBottom || '';
    span.style.fontWeight = span.dataset.pdfRiskOrigFontWeight || '';
    span.style.cursor = '';
    span.style.boxShadow = '';
    delete span.dataset.pdfRiskHighlight;
    delete span.dataset.pdfRiskOrigBg;
    delete span.dataset.pdfRiskOrigColor;
    delete span.dataset.pdfRiskOrigBorderBottom;
    delete span.dataset.pdfRiskOrigFontWeight;
    delete span.dataset.riskId;
    delete span.dataset.riskLevel;
    delete span.dataset.pdfRiskClickBound;
  });

  const spans = Array.from(container.querySelectorAll('.textLayer span')) as HTMLElement[];
  if (spans.length === 0) return;

  // 建立 span 归一化文本索引
  let normFullText = '';
  const spanInfos = spans.map((span) => {
    const text = span.textContent || '';
    const normText = normalizeSearchText(text);
    const start = normFullText.length;
    normFullText += normText;
    return { span, text, normText, start, end: normFullText.length };
  });

  // 构建段落范围索引，严格限定每个风险的搜索范围，避免跨段落误匹配
  const paragraphRanges = new Map<string, { start: number; end: number }>();
  paragraphs.forEach((p) => {
    const paraText = p.text || '';
    if (!paraText.trim()) return;

    const normParaText = normalizeSearchText(paraText);
    let start = normFullText.indexOf(normParaText);
    let end = -1;

    if (start !== -1) {
      end = start + normParaText.length;
    } else {
      // 完整段落匹配失败时，用前 30 字符 prefix 定位段落起点
      const normPrefix = normalizeSearchText(paraText.slice(0, 30));
      start = normPrefix ? normFullText.indexOf(normPrefix) : -1;
      if (start !== -1) {
        // 段落终点估计：优先用下一个段落起点，否则用 prefix 长度估算
        const sortedParas = [...paragraphs]
          .filter((q) => (q.index ?? 0) > (p.index ?? 0) && q.text?.trim())
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        const nextPara = sortedParas[0];
        if (nextPara) {
          const normNextPrefix = normalizeSearchText((nextPara.text || '').slice(0, 30));
          const nextStart = normNextPrefix
            ? normFullText.indexOf(normNextPrefix, start + 1)
            : -1;
          end = nextStart !== -1 ? nextStart : start + normPrefix.length;
        } else {
          end = start + normPrefix.length;
        }
      }
    }

    if (start !== -1 && end !== -1 && end > start) {
      paragraphRanges.set(p.id, { start, end });
    }
  });

  // 高风险优先匹配，同等级优先覆盖更长的原文，避免同一段文字被多个风险叠加
  const levelOrder = { high: 0, medium: 1, low: 2, notice: 3 };
  const sortedRisks = [...risks].sort((a, b) => {
    const o = levelOrder[a.level] - levelOrder[b.level];
    if (o !== 0) return o;
    return normalizeSearchText(b.originalText || '').length - normalizeSearchText(a.originalText || '').length;
  });

  // 归一化原文去重：完全相同的文案只保留最高等级
  const seenNormTexts = new Set<string>();
  // 已覆盖的文本区间，用于跳过与高风险大幅重叠的低风险
  const coveredRanges: { start: number; end: number; normSearch: string }[] = [];

  for (const risk of sortedRisks) {
    const search = risk.originalText?.trim();
    if (!search || search.length < 2) continue;
    const normSearch = normalizeSearchText(search);
    if (!normSearch) continue;

    const range = paragraphRanges.get(risk.paragraphId);
    if (!range) continue;

    // 完全相同的归一化原文只保留最高等级
    if (seenNormTexts.has(normSearch)) continue;
    seenNormTexts.add(normSearch);

    // 收集匹配区间：先尝试完整匹配 originalText；失败时按自然子句拆分后分别匹配
    const matches: { start: number; end: number; normSearch: string }[] = [];
    const fullMatchStart = normFullText.indexOf(normSearch, range.start);
    if (fullMatchStart !== -1 && fullMatchStart < range.end) {
      matches.push({ start: fullMatchStart, end: fullMatchStart + normSearch.length, normSearch });
    } else {
      const parts = splitRiskSearchText(search);
      for (const part of parts) {
        const normPart = normalizeSearchText(part);
        if (!normPart || seenNormTexts.has(normPart)) continue;
        let partStart = normFullText.indexOf(normPart, range.start);
        let partLen = normPart.length;
        if (partStart === -1 || partStart >= range.end) {
          // 前缀模糊匹配：从长到短尝试子句前缀
          for (let len = normPart.length; len >= Math.max(6, Math.floor(normPart.length * 0.5)); len--) {
            const sub = normPart.substring(0, len);
            const idx = normFullText.indexOf(sub, range.start);
            if (idx !== -1 && idx < range.end) {
              partStart = idx;
              partLen = len;
              break;
            }
          }
        }
        if (partStart === -1 || partLen <= 0) continue;
        matches.push({ start: partStart, end: partStart + partLen, normSearch: normPart });
        seenNormTexts.add(normPart);
      }
    }
    if (matches.length === 0) continue;

    const cfg = RISK_LEVEL_MAP[risk.level];
    const alpha = PDF_BG_ALPHA[risk.level];
    const overlapThreshold = 0.35;

    // 逐个匹配区间处理：去重、高亮
    for (const match of matches) {
      const { start: matchStart, end: matchEnd, normSearch: matchNorm } = match;

      // 重叠检测：若当前匹配区间与已覆盖区间重叠比例过高，或存在子串包含关系，跳过该低等级风险
      let skip = false;
      for (const r of coveredRanges) {
        if (matchNorm.includes(r.normSearch) || r.normSearch.includes(matchNorm)) {
          skip = true;
          break;
        }
        const oStart = Math.max(matchStart, r.start);
        const oEnd = Math.min(matchEnd, r.end);
        if (oEnd <= oStart) continue;
        const rLen = r.end - r.start;
        const minLen = Math.min(matchEnd - matchStart, rLen);
        if (minLen > 0 && (oEnd - oStart) / minLen > overlapThreshold) {
          skip = true;
          break;
        }
      }
      if (skip) continue;

      coveredRanges.push(match);

      const matched = spanInfos.filter((info) => info.start < matchEnd && info.end > matchStart);
      if (matched.length === 0) continue;

      // 按 textLayerDiv 分组（不再用 occupiedSpans 截断，确保当前风险完整覆盖匹配到的所有 span）
      const layerMap = new Map<HTMLElement, HTMLElement[]>();
      matched.forEach(({ span }) => {
        const layer = span.closest('.textLayer') as HTMLElement;
        if (!layer) return;
        if (!layerMap.has(layer)) layerMap.set(layer, []);
        layerMap.get(layer)!.push(span);
      });

      layerMap.forEach((layerSpans, layer) => {
        if (layerSpans.length === 0) return;
        const layerRect = layer.getBoundingClientRect();

        // 按行分组：top 坐标接近的 span 视为同一行
        const rows: { top: number; spans: HTMLElement[] }[] = [];
        layerSpans.forEach((span) => {
          const rect = span.getBoundingClientRect();
          const row = rows.find((r) => Math.abs(r.top - rect.top) < 2);
          if (row) {
            row.spans.push(span);
          } else {
            rows.push({ top: rect.top, spans: [span] });
          }
        });

        rows.forEach((row) => {
          const rects = row.spans.map((s) => s.getBoundingClientRect());
          const left = Math.min(...rects.map((r) => r.left));
          const top = Math.min(...rects.map((r) => r.top));
          const right = Math.max(...rects.map((r) => r.right));
          const bottom = Math.max(...rects.map((r) => r.bottom));

          const div = document.createElement('div');
          div.className = 'pdf-risk-overlay';
          div.style.position = 'absolute';
          div.style.left = `${left - layerRect.left}px`;
          div.style.top = `${top - layerRect.top}px`;
          div.style.width = `${right - left}px`;
          div.style.height = `${bottom - top}px`;
          div.style.backgroundColor = hexToRgba(cfg.bg, alpha);
          // 下划线使用内阴影，不占用额外高度；增加微圆角使高亮更柔和
          div.style.boxShadow = `inset 0 -2px 0 0 ${cfg.color}`;
          div.style.borderRadius = '2px';
          div.style.pointerEvents = 'none';
          div.style.zIndex = '10';
          // 覆盖 pdf_viewer.css 中 .textLayer > :not(.markedContent) 的 transform/font-size
          // 避免 overlay 被 pdf.js 的 textLayer 样式影响位置和渲染
          div.style.transform = 'none';
          div.style.fontSize = '0';
          div.dataset.riskId = risk.riskId;
          div.dataset.riskLevel = risk.level;
          layer.appendChild(div);
        });
      });

      // 绑定点击事件到匹配 span（同一 span 若已绑定则复用，避免重复监听）
      matched.forEach(({ span }) => {
        span.dataset.riskId = risk.riskId;
        span.dataset.riskLevel = risk.level;
        span.style.cursor = 'pointer';
        if (!span.dataset.pdfRiskClickBound) {
          span.dataset.pdfRiskClickBound = '1';
          span.addEventListener('click', (e) => {
            e.stopPropagation();
            onActivateRisk?.(risk.riskId);
          });
        }
      });
    }
  }
}

/**
 * 将风险原文按自然子句拆分（换行、句号、分号），用于多行风险原文的逐行匹配。
 * 例如 R1 的乙方四行信息，按换行拆成 4 个子句后分别匹配，避免整串匹配时行尾漏标。
 */
function splitRiskSearchText(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\n。；;]/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 3),
    ),
  );
}

/**
 * 对搜索文本做归一化：去除空白、千分位逗号、全角数字/标点转半角，提高 PDF textLayer 匹配成功率。
 */
function normalizeSearchText(text: string): string {
  return text
    .replace(/\s+/g, '')
    // 去除千分位逗号，避免 "580,000" 与 "580000" 无法匹配
    .replace(/,/g, '')
    .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

const ContractTextView = forwardRef<ContractTextViewHandle, ContractTextViewProps>(
  ({ paragraphs, risks, activeRiskId, onActivateRisk, fileName, taskId, sampleId }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const originalScrollRef = useRef<HTMLDivElement>(null);
    const docxContainerRef = useRef<HTMLDivElement>(null);
    const pdfContainerRef = useRef<HTMLDivElement>(null);
    const docxBlobRef = useRef<Blob | null>(null);
    const pdfBlobRef = useRef<Blob | null>(null);
    const autoZoomAppliedRef = useRef(false);
    const [fontSizeIdx, setFontSizeIdx] = useState(1);
    const [zoom, setZoom] = useState(1);

    // 原文渲染状态
    const [originalState, setOriginalState] = useState<OriginalState>({ mode: 'idle' });
    // 是否降级到结构化视图
    const [useFallback, setUseFallback] = useState(false);

    const fileExt = fileName?.toLowerCase().match(/\.(\w+)$/)?.[1] || '';

    const handleDownload = async () => {
      if (taskId) {
        try {
          const { API_BASE } = await import('@/utils/apiBase');
          const token = localStorage.getItem('qszk:auth:accessToken');
          const resp = await fetch(`${API_BASE}/api/data/documents/${taskId}/download`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!resp.ok) {
            const detail = await resp.text().catch(() => '未知错误');
            message.warning(`文件下载失败：${detail}`);
            return;
          }
          const blob = await resp.blob();
          const disposition = resp.headers.get('Content-Disposition') || '';
          const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/);
          const name = match ? decodeURIComponent(match[1]) : (fileName || '合同文件');
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = name;
          a.click();
          URL.revokeObjectURL(url);
        } catch {
          message.warning('文件下载失败，请稍后重试');
        }
        return;
      }
      const text = paragraphs.map((p) => p.text).join('\n');
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (fileName?.replace(/\.[^.]+$/, '') || '合同原文') + '.txt';
      a.click();
      URL.revokeObjectURL(url);
    };

    // 段落 -> 风险高亮映射（用于结构化兜底视图），同一段落内重叠高亮只保留最高等级
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
      for (const [paraId, list] of map.entries()) {
        map.set(paraId, dedupHighlights(list));
      }
      return map;
    }, [risks]);

    const activeParagraphId = useMemo(() => {
      if (!activeRiskId) return null;
      return risks.find((r) => r.id === activeRiskId)?.paragraphId ?? null;
    }, [activeRiskId, risks]);

    // 风险列表（用于原文叠加）
    const overlayRiskItems: RiskOverlayItem[] = useMemo(() => {
      return risks
        .filter((r) => r.originalText && r.originalText.length >= 2)
        .map((r) => ({
          riskId: r.id,
          level: r.riskLevel,
          originalText: r.originalText,
          paragraphId: r.paragraphId,
        }));
    }, [risks]);

    useImperativeHandle(ref, () => ({
      scrollToParagraph(paragraphId: string) {
        const para = paragraphs.find((p) => p.id === paragraphId);
        if (!para) return;

        if (!useFallback && originalScrollRef.current) {
          // PDF 模式：在 textLayer span 中定位段落文本前 50 字符
          if (originalState.mode === 'pdf') {
            const spans = Array.from(originalScrollRef.current.querySelectorAll('.textLayer span')) as HTMLElement[];
            if (spans.length > 0) {
              let normFullText = '';
              const spanInfos = spans.map((span) => {
                const normText = normalizeSearchText(span.textContent || '');
                const start = normFullText.length;
                normFullText += normText;
                return { span, start, end: normFullText.length };
              });
              const normPrefix = normalizeSearchText(para.text.slice(0, 50));
              const idx = normPrefix ? normFullText.indexOf(normPrefix) : -1;
              if (idx !== -1) {
                const matched = spanInfos.find((info) => info.start <= idx && info.end > idx);
                if (matched) {
                  matched.span.scrollIntoView({ block: 'start' });
                  return;
                }
              }
            }
          }

          // DOCX 模式：通过 TreeWalker 文本匹配定位
          const walker = document.createTreeWalker(originalScrollRef.current, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode as Text;
            if (node.nodeValue && node.nodeValue.includes(para.text.slice(0, 20))) {
              node.parentElement?.scrollIntoView({ block: 'start' });
              return;
            }
          }
        }

        // 结构化兜底视图
        const el = containerRef.current?.querySelector(`[data-paragraph-id="${paragraphId}"]`);
        if (el) el.scrollIntoView({ block: 'start' });
      },
      scrollToRisk(riskId: string) {
        if (!originalScrollRef.current) return;
        // DOCX：查找 mark
        const mark = originalScrollRef.current.querySelector(`mark.risk-highlight[data-risk-id="${riskId}"]`);
        if (mark) {
          mark.scrollIntoView({ block: 'center' });
          return;
        }
        // PDF：查找风险 overlay div
        const overlays = originalScrollRef.current.querySelectorAll(`.pdf-risk-overlay[data-risk-id="${riskId}"]`);
        if (overlays.length > 0) {
          overlays[0].scrollIntoView({ block: 'center' });
          return;
        }
        // 兜底：按段落定位
        const risk = risks.find((r) => r.id === riskId);
        if (risk) {
          const el = containerRef.current?.querySelector(`[data-paragraph-id="${risk.paragraphId}"]`);
          if (el) el.scrollIntoView({ block: 'center' });
        }
      },
      scrollToTop() {
        containerRef.current?.scrollTo({ top: 0 });
        originalScrollRef.current?.scrollTo({ top: 0 });
      },
    }));

    // 当激活风险变化时滚动到高亮位置，并更新 active 加深样式
    useEffect(() => {
      if (!originalScrollRef.current) return;

      applyActiveRiskHighlight(originalScrollRef.current, activeRiskId);

      if (!activeRiskId) return;

      if (!useFallback) {
        // DOCX：滚动到对应 mark
        const mark = originalScrollRef.current.querySelector(`mark.risk-highlight[data-risk-id="${activeRiskId}"]`);
        if (mark) {
          mark.scrollIntoView({ block: 'center' });
          return;
        }

        // PDF：滚动到对应 overlay div
        const overlays = originalScrollRef.current.querySelectorAll(`.pdf-risk-overlay[data-risk-id="${activeRiskId}"]`);
        if (overlays.length > 0) {
          overlays[0].scrollIntoView({ block: 'center' });
          return;
        }
      }

      // 结构化兜底
      if (activeParagraphId) {
        const el = containerRef.current?.querySelector(`[data-paragraph-id="${activeParagraphId}"]`);
        if (el) el.scrollIntoView({ block: 'center' });
      }
    }, [activeRiskId, useFallback, activeParagraphId, overlayRiskItems]);

    // Effect: 组件加载时，加载原文内容
    useEffect(() => {
      let cancelled = false;
      setOriginalState({ mode: 'loading' });
      docxBlobRef.current = null;
      pdfBlobRef.current = null;
      autoZoomAppliedRef.current = false;
      setZoom(1);

      async function loadOriginal() {
        try {
          // 优先级 1：样例合同（前端动态生成 DOCX）
          if (sampleId) {
            const { SAMPLE_CONTRACTS } = await import('@/mock/sampleContracts');
            const sample = SAMPLE_CONTRACTS.find((s) => s.id === sampleId);
            if (!sample) throw new Error('样例合同数据不存在');
            const blob = await generateDocxFromParagraphs(sample.paragraphs, sample.fileTitle);
            if (cancelled) return;
            docxBlobRef.current = blob;
            setOriginalState({ mode: 'docx' });
            return;
          }

          // 优先级 2：用户上传/seed 任务（从后端下载原文件）
          if (fileName && taskId) {
            try {
              const { API_BASE } = await import('@/utils/apiBase');
              const token = localStorage.getItem('qszk:auth:accessToken');
              const resp = await fetch(`${API_BASE}/api/data/documents/${taskId}/download`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
              });
              if (!resp.ok) throw new Error(`文件下载失败（${resp.status}）`);
              const blob = await resp.blob();
              if (cancelled) return;

              if (fileExt === 'pdf') {
                // PDF：用 pdf.js 渲染
                pdfBlobRef.current = blob;
                setOriginalState({ mode: 'pdf' });
              } else if (fileExt === 'docx' || fileExt === 'doc') {
                // DOCX：用 docx-preview 渲染
                docxBlobRef.current = blob;
                setOriginalState({ mode: 'docx' });
              } else {
                // 其他格式：尝试当 PDF 渲染
                pdfBlobRef.current = blob;
                setOriginalState({ mode: 'pdf' });
              }
              return;
            } catch {
              // 后端文件不存在，fallback 到 paragraphs 生成 DOCX
              if (paragraphs.length > 0) {
                const blob = await generateDocxFromParagraphs(paragraphs);
                if (cancelled) return;
                docxBlobRef.current = blob;
                setOriginalState({ mode: 'docx' });
                return;
              }
            }
          }

          // 优先级 3：用 paragraphs 生成 DOCX（最后兜底）
          if (paragraphs.length > 0) {
            const blob = await generateDocxFromParagraphs(paragraphs);
            if (cancelled) return;
            docxBlobRef.current = blob;
            setOriginalState({ mode: 'docx' });
            return;
          }

          throw new Error('无可预览的原文文件');
        } catch (e) {
          if (!cancelled) {
            setOriginalState({ mode: 'error', message: e instanceof Error ? e.message : '加载失败' });
          }
        }
      }

      loadOriginal();

      return () => {
        cancelled = true;
      };
    }, [sampleId, fileName, taskId, fileExt, paragraphs]);

    // Effect: DOCX 渲染
    useEffect(() => {
      if (originalState.mode !== 'docx') return;
      if (!docxContainerRef.current || !docxBlobRef.current) return;

      const container = docxContainerRef.current;
      container.innerHTML = '';
      renderAsync(docxBlobRef.current, container, undefined, {
        className: 'docx-preview',
        inWrapper: false,
        ignoreWidth: false,
        ignoreHeight: false,
        breakPages: false,
      })
        .then(() => {
          // 非侵入式后处理：仅给 table 标记段落 ID（用于风险定位）+ 注入 writing-mode CSS
          // 完全不修改 table DOM 和样式，避免触发浏览器重排导致列宽错乱
          const tableParas = paragraphs.filter((p) => p.type === 'table');
          const renderedTables = Array.from(container.querySelectorAll('table'));
          renderedTables.forEach((tableEl, idx) => {
            const para = tableParas[idx];
            if (!para) return;
            tableEl.setAttribute('data-paragraph-id', para.id);
          });

          // 仅注入 writing-mode CSS 修复竖排问题，不做任何布局相关修改
          const style = document.createElement('style');
          style.textContent = `
            .docx-preview table,
            .docx-preview table td,
            .docx-preview table th {
              writing-mode: horizontal-tb !important;
              text-orientation: mixed !important;
            }
          `;
          container.appendChild(style);

          // 渲染完成后叠加风险高亮：正文段落用 overlayRisks（mark 包裹），表格用非侵入式覆盖层
          if (originalScrollRef.current) {
            overlayRisks(originalScrollRef.current, overlayRiskItems, paragraphs, onActivateRisk);
            applyTableRiskOverlays(originalScrollRef.current, overlayRiskItems, paragraphs, onActivateRisk);
            // 若当前已有默认激活风险，同步应用 active 加深样式
            applyActiveRiskHighlight(originalScrollRef.current, activeRiskId);
          }

          // 自动缩放适配容器宽度：若文档实际宽度超出可视区域，按比例缩小，避免横向滚动覆盖内容
          if (!autoZoomAppliedRef.current) {
            autoZoomAppliedRef.current = true;
            // 延迟到 setZoom(1) 等状态更新完成后再测量，避免被覆盖
            setTimeout(() => {
              requestAnimationFrame(() => {
                if (!originalScrollRef.current || !docxContainerRef.current) return;
                const contentW = docxContainerRef.current.scrollWidth;
                const clientW = originalScrollRef.current.clientWidth;
                if (contentW > clientW && clientW > 0) {
                  const nextZoom = Math.max(0.5, Math.min(1, (clientW - 24) / contentW));
                  setZoom(nextZoom);
                }
              });
            }, 80);
          }
        })
        .catch((e) => {
          console.error('[ContractTextView] docx-preview 渲染失败:', e);
          setOriginalState({ mode: 'error', message: 'DOCX 渲染失败' });
          setUseFallback(true);
        });
    }, [originalState.mode, overlayRiskItems, paragraphs, onActivateRisk]);

    // Effect: PDF 渲染 — 使用 pdf.js 渲染原始 PDF 页面 + textLayer
    useEffect(() => {
      if (originalState.mode !== 'pdf') return;
      if (!pdfContainerRef.current || !pdfBlobRef.current) return;

      const container = pdfContainerRef.current;
      container.innerHTML = '';
      setUseFallback(false);

      let cancelled = false;

      async function renderPdf() {
        try {
          const arrayBuffer = await pdfBlobRef.current!.arrayBuffer();
          if (cancelled) return;

          const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
          if (cancelled) return;

          const scale = 1.5;

          for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            if (cancelled) return;
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale });

            const pageDiv = document.createElement('div');
            pageDiv.style.position = 'relative';
            pageDiv.style.margin = '0 auto 16px';
            pageDiv.style.width = `${viewport.width}px`;
            pageDiv.style.height = `${viewport.height}px`;
            pageDiv.style.background = '#fff';
            pageDiv.dataset.pageIndex = String(pageNum - 1);

            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.display = 'block';

            await page.render({ canvas, viewport }).promise;
            if (cancelled) return;

            const textLayerDiv = document.createElement('div');
            textLayerDiv.className = 'textLayer';
            // 基础定位与尺寸由 pdf_viewer.css 负责，此处无需重复内联样式

            const textContent = await page.getTextContent();
            if (cancelled) return;

            const textLayer = new pdfjs.TextLayer({
              textContentSource: textContent,
              container: textLayerDiv,
              viewport,
            });
            await textLayer.render();

            pageDiv.appendChild(canvas);
            pageDiv.appendChild(textLayerDiv);
            container.appendChild(pageDiv);
          }

          if (!cancelled) {
            highlightPdfRisks(container, overlayRiskItems, paragraphs, onActivateRisk);
            // 若当前已有默认激活风险，同步应用 active 加深样式
            if (originalScrollRef.current) {
              applyActiveRiskHighlight(originalScrollRef.current, activeRiskId);
            }
          }
        } catch (e) {
          console.error('[ContractTextView] PDF 渲染失败:', e);
          if (!cancelled) {
            message.warning('PDF 原格式加载失败，已自动切换为文本段落视图');
            setOriginalState({ mode: 'error', message: 'PDF 原格式加载失败' });
            setUseFallback(true);
          }
        }
      }

      renderPdf();

      return () => {
        cancelled = true;
      };
    }, [originalState.mode]);

    // Effect: PDF 风险高亮重新应用（risks 变化时无需重新渲染整个 PDF）
    useEffect(() => {
      if (originalState.mode !== 'pdf' || useFallback) return;
      if (!pdfContainerRef.current) return;
      if (pdfContainerRef.current.querySelectorAll('.textLayer').length === 0) return;
      highlightPdfRisks(pdfContainerRef.current, overlayRiskItems, paragraphs, onActivateRisk);
      if (originalScrollRef.current) {
        applyActiveRiskHighlight(originalScrollRef.current, activeRiskId);
      }
    }, [originalState.mode, useFallback, overlayRiskItems, paragraphs, onActivateRisk, activeRiskId]);

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
            <Text strong style={{ fontSize: 14 }}>合同正文</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>
              共 {paragraphs.length} 段 · {risks.length} 处风险标注
            </Text>
          </Space>
          <Space size={4}>
            <Tooltip title="下载原文">
              <Button type="text" size="small" icon={<Download size={14} />} onClick={handleDownload} />
            </Tooltip>
            <Tooltip title="缩小">
              <Button
                type="text"
                size="small"
                icon={<ZoomOut size={14} />}
                disabled={zoom <= 0.5}
                onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1)))}
              />
            </Tooltip>
            <Tooltip title="放大">
              <Button
                type="text"
                size="small"
                icon={<ZoomIn size={14} />}
                disabled={zoom >= 2}
                onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(1)))}
              />
            </Tooltip>
            <Tooltip title="返回顶部">
              <Button
                type="text"
                size="small"
                icon={<ArrowUp size={14} />}
                onClick={() => {
                  originalScrollRef.current?.scrollTo({ top: 0 });
                  containerRef.current?.scrollTo({ top: 0 });
                }}
              />
            </Tooltip>
          </Space>
        </div>

        {/* 正文内容区 */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 0,
            background: '#fff',
            lineHeight: 1.8,
            wordBreak: 'break-word',
          }}
        >
          {/* 原文渲染失败 → 降级到结构化视图 */}
          {useFallback || originalState.mode === 'error' ? (
            <div style={{ padding: '12px 16px', fontSize }}>
              {originalState.mode === 'error' && (
                <div style={{ textAlign: 'center', padding: '40px 0', color: COLORS.textSecondary }}>
                  <FileWarning size={32} style={{ marginBottom: 8 }} />
                  <div style={{ fontSize: 13 }}>{originalState.message || '原文加载失败，已切换到结构化视图'}</div>
                </div>
              )}
              {paragraphs.map((para, i) => {
                const highlights = paraRiskMap.get(para.id) ?? [];
                return (
                  <ParagraphItem
                    key={para.id}
                    para={para}
                    index={i + 1}
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
          ) : originalState.mode === 'loading' ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: 300 }}>
              <Spin tip="正在加载原文..." size="large" />
            </div>
          ) : originalState.mode === 'docx' ? (
            <div
              ref={originalScrollRef}
              style={{ width: '100%', height: '100%', overflowY: 'auto', overflowX: 'hidden', padding: '24px 32px', background: '#f5f5f5' }}
            >
              <div style={{ width: '100%', minHeight: '100%', overflow: 'hidden' }}>
                <div
                  ref={docxContainerRef}
                  style={{
                    transform: `scale(${zoom})`,
                    transformOrigin: 'top left',
                    width: `${100 / zoom}%`,
                    minHeight: '100%',
                    background: '#fff',
                    padding: '32px 40px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                  }}
                />
              </div>
            </div>
          ) : originalState.mode === 'pdf' ? (
            <div
              ref={originalScrollRef}
              style={{ width: '100%', height: '100%', overflow: 'auto', padding: '16px 0', background: '#525659' }}
            >
              <div ref={pdfContainerRef} style={{ margin: '0 auto', padding: '0 8px' }} />
            </div>
          ) : null}
        </div>
      </div>
    );
  },
);

ContractTextView.displayName = 'ContractTextView';
export default ContractTextView;
