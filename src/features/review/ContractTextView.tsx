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
import { COLORS, RISK_LEVEL_MAP } from '@/constants';
import { inferParagraphType } from '@/utils/logic';
import { generateDocxFromParagraphs } from '@/utils/docxGenerator';
import type { ContractParagraph, ParagraphType, RiskItem } from '@/types';

const { Text } = Typography;

export interface ContractTextViewHandle {
  scrollToParagraph: (paragraphId: string) => void;
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
              onClick={() => onActivateRisk?.(seg.risk!.id)}
              style={{
                background: cfg.bg,
                color: cfg.color,
                borderBottom: `2px solid ${cfg.color}`,
                fontWeight: isActiveRisk ? 700 : 500,
                padding: '1px 3px',
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
  const findInSegment = (search: string, segStart: number, segEnd: number): number => {
    const segment = fullText.slice(segStart, segEnd);
    const localIdx = segment.indexOf(search);
    if (localIdx !== -1) return segStart + localIdx;
    const normSeg = segment.replace(/\s+/g, '');
    const normSearch = search.replace(/\s+/g, '');
    const normIdx = normSeg.indexOf(normSearch);
    if (normIdx === -1) return -1;
    // 将归一化位置映射回原文位置
    let origIdx = 0;
    let ni = 0;
    while (ni < normIdx) {
      if (!/\s/.test(segment[origIdx])) ni++;
      origIdx++;
    }
    const candidateStart = segStart + origIdx;
    // 验证后续字符匹配
    let ok = true;
    let oi = candidateStart;
    for (let i = 0; i < normSearch.length; i++) {
      while (oi < fullText.length && /\s/.test(fullText[oi])) oi++;
      if (oi >= fullText.length || fullText[oi] !== normSearch[i]) { ok = false; break; }
      oi++;
    }
    return ok ? candidateStart : -1;
  };

  let overlaid = 0;

  for (const risk of risks) {
    const search = risk.originalText?.trim();
    if (!search || search.length < 2) continue;

    // table 段落跳过：table 风险由 applyTableRiskOverlays 独立处理（非侵入式覆盖层）
    const para = paragraphs.find((p) => p.id === risk.paragraphId);
    if (para?.type === 'table') continue;

    // 优先在 paragraphId 对应区间内查找，避免短原文误匹配到全文首次出现位置
    const paraRange = paraRanges.get(risk.paragraphId);
    let matchStart = -1;
    if (paraRange) {
      matchStart = findInSegment(search, paraRange.start, paraRange.end);
    }
    // 区间内未找到 → 回退到全文查找（保持原有兼容行为）
    if (matchStart === -1) {
      matchStart = findInSegment(search, 0, fullText.length);
    }
    if (matchStart === -1) continue;

    const matchEnd = matchStart + search.length;

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

  // 修复：extractContents 可能打乱了 textNodes，但不影响已添加的 mark
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
  // 清除旧的覆盖层（包括之前包裹的 wrapper）
  container.querySelectorAll('.table-risk-overlay-wrapper').forEach((el) => {
    const wrapper = el as HTMLElement;
    // 把 table 从 wrapper 里移出去，恢复原 DOM 结构
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

    // 为每个风险在对应单元格位置放置彩色标记
    for (const risk of tableRisks) {
      const cell = findTableCell(table, risk.originalText);
      if (!cell) continue;

      const rect = cell.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      const cfg = RISK_LEVEL_MAP[risk.level];

      // 标记覆盖整个单元格，左侧彩色竖条标识风险等级
      const marker = document.createElement('div');
      marker.className = 'table-risk-marker';
      marker.setAttribute('data-risk-id', risk.riskId);
      marker.style.cssText = [
        'position:absolute',
        `top:${rect.top - wrapperRect.top}px`,
        `left:${rect.left - wrapperRect.left}px`,
        `width:${rect.width}px`,
        `height:${rect.height}px`,
        `background:${cfg.bg}`,
        `border-left:3px solid ${cfg.color}`,
        'border-radius:2px',
        'pointer-events:auto',
        'cursor:pointer',
        'z-index:11',
      ].join(';');
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        onActivateRisk?.(risk.riskId);
      });
      overlay.appendChild(marker);
    }
  });
}

/**
 * 在表格中找到包含指定文本的单元格
 * 策略：归一化空白后做子串匹配，优先返回内容最短的单元格（更精准）
 */
function findTableCell(table: HTMLTableElement, search: string): HTMLTableCellElement | null {
  const normSearch = search.replace(/\s+/g, '');
  if (!normSearch) return null;
  const cells = Array.from(table.querySelectorAll('td, th')) as HTMLTableCellElement[];

  // 按行优先遍历，收集所有匹配的单元格
  const matched = cells
    .map((c) => {
      const text = (c.textContent || '').replace(/\s+/g, '');
      const idx = text.indexOf(normSearch);
      return idx !== -1 ? { cell: c, length: text.length } : null;
    })
    .filter(Boolean) as { cell: HTMLTableCellElement; length: number }[];

  if (matched.length === 0) return null;

  // 优先返回内容最短的单元格（更精准，避免匹配到过大的容器单元格）
  matched.sort((a, b) => a.length - b.length);
  return matched[0].cell;
}

/**
 * 用 pdf.js 渲染 PDF：每页渲染为 canvas + 透明文本层（可被 TreeWalker 遍历）
 */
async function renderPdfWithPdfJs(
  container: HTMLElement,
  blob: Blob,
  zoom: number,
): Promise<void> {
  const pdfjs: any = await import('pdfjs-dist');
  // 配置 worker
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const arrayBuffer = await blob.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;

  container.innerHTML = '';

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const scale = zoom * 1.5;
    const viewport = page.getViewport({ scale });

    // 页面容器
    const pageDiv = document.createElement('div');
    pageDiv.style.position = 'relative';
    pageDiv.style.width = viewport.width + 'px';
    pageDiv.style.margin = '0 auto 8px';
    pageDiv.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';

    // Canvas 渲染
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.display = 'block';
    pageDiv.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      await page.render({ canvasContext: ctx, viewport }).promise;
    }

    // 文本层（透明文字，可被 TreeWalker 遍历，用于风险叠加）
    const textContent = await page.getTextContent();
    const textLayerDiv = document.createElement('div');
    textLayerDiv.style.position = 'absolute';
    textLayerDiv.style.left = '0';
    textLayerDiv.style.top = '0';
    textLayerDiv.style.width = viewport.width + 'px';
    textLayerDiv.style.height = viewport.height + 'px';
    textLayerDiv.style.overflow = 'hidden';
    textLayerDiv.style.lineHeight = '1';

    textContent.items.forEach((item: any) => {
      if (!item.str) return;
      const span = document.createElement('span');
      span.textContent = item.str;
      const tx = item.transform;
      span.style.position = 'absolute';
      span.style.left = tx[4] + 'px';
      span.style.top = (viewport.height - tx[5]) + 'px';
      span.style.fontSize = item.height + 'px';
      span.style.fontFamily = 'sans-serif';
      span.style.color = 'transparent';
      span.style.whiteSpace = 'pre';
      textLayerDiv.appendChild(span);
    });

    pageDiv.appendChild(textLayerDiv);
    container.appendChild(pageDiv);
  }
}

const ContractTextView = forwardRef<ContractTextViewHandle, ContractTextViewProps>(
  ({ paragraphs, risks, activeRiskId, onActivateRisk, fileName, taskId, sampleId }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const originalScrollRef = useRef<HTMLDivElement>(null);
    const docxContainerRef = useRef<HTMLDivElement>(null);
    const pdfContainerRef = useRef<HTMLDivElement>(null);
    const docxBlobRef = useRef<Blob | null>(null);
    const pdfBlobRef = useRef<Blob | null>(null);
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

    // 段落 -> 风险高亮映射（用于结构化兜底视图）
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
        // 原文视图：通过段落文本匹配定位
        if (!useFallback) {
          const para = paragraphs.find((p) => p.id === paragraphId);
          if (para && originalScrollRef.current) {
            const walker = document.createTreeWalker(originalScrollRef.current, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const node = walker.currentNode as Text;
              if (node.nodeValue && node.nodeValue.includes(para.text.slice(0, 20))) {
                node.parentElement?.scrollIntoView({ block: 'start' });
                return;
              }
            }
          }
        }
        // 结构化兜底视图
        const el = containerRef.current?.querySelector(`[data-paragraph-id="${paragraphId}"]`);
        if (el) el.scrollIntoView({ block: 'start' });
      },
      scrollToTop() {
        containerRef.current?.scrollTo({ top: 0 });
        originalScrollRef.current?.scrollTo({ top: 0 });
      },
    }));

    // 当激活风险变化时滚动到高亮位置
    useEffect(() => {
      if (!activeRiskId) return;
      // 原文视图：滚动到 mark[data-risk-id]
      if (!useFallback && originalScrollRef.current) {
        const mark = originalScrollRef.current.querySelector(`mark.risk-highlight[data-risk-id="${activeRiskId}"]`);
        if (mark) {
          mark.scrollIntoView({ block: 'center' });
          // 添加 active 样式
          originalScrollRef.current.querySelectorAll('mark.risk-highlight.active').forEach((m) => m.classList.remove('active'));
          mark.classList.add('active');
          return;
        }
      }
      // 结构化兜底
      if (activeParagraphId) {
        const el = containerRef.current?.querySelector(`[data-paragraph-id="${activeParagraphId}"]`);
        if (el) el.scrollIntoView({ block: 'center' });
      }
    }, [activeRiskId, useFallback, activeParagraphId]);

    // Effect: 组件加载时，加载原文内容
    useEffect(() => {
      let cancelled = false;
      setOriginalState({ mode: 'loading' });
      docxBlobRef.current = null;
      pdfBlobRef.current = null;

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
          }
        })
        .catch((e) => {
          console.error('[ContractTextView] docx-preview 渲染失败:', e);
          setOriginalState({ mode: 'error', message: 'DOCX 渲染失败' });
          setUseFallback(true);
        });
    }, [originalState.mode, overlayRiskItems, paragraphs, onActivateRisk]);

    // Effect: PDF 渲染（pdf.js）
    useEffect(() => {
      if (originalState.mode !== 'pdf') return;
      if (!pdfContainerRef.current || !pdfBlobRef.current) return;

      const container = pdfContainerRef.current;
      let cancelled = false;

      renderPdfWithPdfJs(container, pdfBlobRef.current, zoom)
        .then(() => {
          if (cancelled) return;
          // 渲染完成后叠加风险高亮（PDF 一般无 table 元素，applyTableRiskOverlays 会自动跳过）
          overlayRisks(container, overlayRiskItems, paragraphs, onActivateRisk);
          applyTableRiskOverlays(container, overlayRiskItems, paragraphs, onActivateRisk);
        })
        .catch((e) => {
          console.error('[ContractTextView] pdf.js 渲染失败:', e);
          if (!cancelled) {
            setOriginalState({ mode: 'error', message: 'PDF 渲染失败' });
            setUseFallback(true);
          }
        });

      return () => { cancelled = true; };
    }, [originalState.mode, zoom, overlayRiskItems, paragraphs, onActivateRisk]);

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
            {useFallback && (
              <Button size="small" type="link" onClick={() => { setUseFallback(false); setOriginalState({ mode: 'loading' }); }}>
                重试加载原文
              </Button>
            )}
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
              style={{ width: '100%', height: '100%', overflow: 'auto', padding: '24px 32px', background: '#f5f5f5' }}
            >
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
