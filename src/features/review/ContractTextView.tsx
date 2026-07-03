/**
 * 合同原文渲染（P07 中栏）
 * - 段落渲染：按类型差异化（title/header/body/signature）
 * - 风险原文高亮（按等级颜色）
 * - 点击高亮选中对应风险
 * - 滚动定位到指定段落
 * - 字号调整、返回顶部
 * - 原文格式视图：DOCX 用 docx-preview 渲染，PDF 用 iframe 预览
 */
import { forwardRef, memo, useImperativeHandle, useMemo, useRef, useState, useEffect } from 'react';
import { Button, Tooltip, Typography, Space, Empty, Segmented, Spin, message } from 'antd';
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
  | { mode: 'pdf'; url: string }
  | { mode: 'html' }
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
  const segments = useMemo(() => splitSegments(para.text, highlights), [para.text, highlights]);
  // 段落类型：优先用 para.type，无则前端兜底识别（与后端规则一致）
  const paraType: ParagraphType = para.type ?? inferParagraphType(para, index);

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

  // === 表格段：渲染 HTML 表格 ===
  if (paraType === 'table' && para.tableData && para.tableData.length > 0) {
    return (
      <div
        data-paragraph-id={para.id}
        style={{ margin: '8px 0', overflowX: 'auto' }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: fontSize - 1,
            border: `1px solid ${COLORS.border}`,
            background: '#fff',
          }}
        >
          <tbody>
            {para.tableData.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      border: `1px solid ${COLORS.border}`,
                      padding: '6px 8px',
                      background: ri === 0 ? '#fafbfc' : 'transparent',
                      fontWeight: ri === 0 ? 600 : 400,
                      color: COLORS.textPrimary,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      textAlign: 'left',
                    }}
                  >
                    {cell || ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // === 图片段：渲染 base64 图片 ===
  if (paraType === 'image' && para.imageData) {
    return (
      <div
        data-paragraph-id={para.id}
        style={{ margin: '8px 0', textAlign: 'center' }}
      >
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
  ({ paragraphs, risks, activeRiskId, onActivateRisk, fileName, taskId, htmlContent, sampleId }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const docxContainerRef = useRef<HTMLDivElement>(null);
    const docxBlobRef = useRef<Blob | null>(null);
    const [fontSizeIdx, setFontSizeIdx] = useState(1);
    const [viewMode, setViewMode] = useState<'structure' | 'original'>('structure');

    // 原文格式视图状态
    const [originalState, setOriginalState] = useState<OriginalState>({ mode: 'idle' });

    // 判断是否有原文可预览（任意一种来源都算）
    const hasOriginal = !!fileName || !!sampleId || !!htmlContent;

    // 文件扩展名
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

    // Effect: 切换到原文格式视图时，加载/生成原文内容
    useEffect(() => {
      if (viewMode !== 'original') {
        setOriginalState({ mode: 'idle' });
        return;
      }

      let cancelled = false;
      setOriginalState({ mode: 'loading' });
      docxBlobRef.current = null;

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
            const { API_BASE } = await import('@/utils/apiBase');
            const token = localStorage.getItem('qszk:auth:accessToken');
            const resp = await fetch(`${API_BASE}/api/data/documents/${taskId}/download`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (!resp.ok) throw new Error(`文件下载失败（${resp.status}）`);
            const blob = await resp.blob();
            if (cancelled) return;

            if (fileExt === 'pdf') {
              // PDF：用 iframe 预览 blob
              const url = URL.createObjectURL(blob);
              setOriginalState({ mode: 'pdf', url });
            } else if (fileExt === 'docx' || fileExt === 'doc') {
              // DOCX：用 docx-preview 渲染
              docxBlobRef.current = blob;
              setOriginalState({ mode: 'docx' });
            } else {
              // 其他格式：尝试用 iframe 直接预览
              const url = URL.createObjectURL(blob);
              setOriginalState({ mode: 'pdf', url });
            }
            return;
          }

          // 优先级 3：降级到 htmlContent（mammoth 生成的 HTML）
          if (htmlContent) {
            setOriginalState({ mode: 'html' });
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
        // 清理 PDF blob URL
        setOriginalState((prev) => {
          if (prev.mode === 'pdf' && prev.url) {
            URL.revokeObjectURL(prev.url);
          }
          return { mode: 'idle' };
        });
      };
    }, [viewMode, sampleId, fileName, taskId, htmlContent, fileExt]);

    // Effect: 当原文模式为 docx 时，渲染 DOCX 到容器
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
      }).catch((e) => {
        console.error('[ContractTextView] docx-preview 渲染失败:', e);
        setOriginalState({ mode: 'error', message: 'DOCX 渲染失败' });
      });
    }, [originalState.mode]);

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
            {hasOriginal && (
              <Segmented
                size="small"
                value={viewMode}
                onChange={(v) => setViewMode(v as 'structure' | 'original')}
                options={[
                  { label: '结构化视图', value: 'structure' },
                  { label: '原文格式', value: 'original' },
                ]}
              />
            )}
            <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>
              共 {paragraphs.length} 段 · {risks.length} 处风险标注
            </Text>
          </Space>
          <Space size={4}>
            <Tooltip title="下载原文">
              <Button type="text" size="small" icon={<Download size={14} />} onClick={handleDownload} />
            </Tooltip>
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
            padding: viewMode === 'original' ? 0 : '12px 16px',
            background: '#fff',
            lineHeight: 1.8,
            fontSize: viewMode === 'original' ? 14 : fontSize,
            wordBreak: 'break-word',
          }}
        >
          {viewMode === 'original' ? (
            // === 原文格式视图 ===
            <>
              {originalState.mode === 'loading' && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: 300 }}>
                  <Spin tip="正在加载原文..." size="large" />
                </div>
              )}

              {originalState.mode === 'error' && (
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: 300, gap: 12 }}>
                  <FileWarning size={40} color={COLORS.textSecondary} />
                  <Text style={{ color: COLORS.textSecondary }}>{originalState.message}</Text>
                  <Text style={{ color: COLORS.textSecondary, fontSize: 12 }}>
                    可切换至「结构化视图」查看合同内容，或下载原文件查看
                  </Text>
                </div>
              )}

              {originalState.mode === 'pdf' && (
                <iframe
                  title="原文预览"
                  src={originalState.url}
                  style={{ width: '100%', height: '100%', border: 'none', minHeight: 500 }}
                />
              )}

              {originalState.mode === 'docx' && (
                <div
                  ref={docxContainerRef}
                  style={{
                    width: '100%',
                    height: '100%',
                    overflow: 'auto',
                    padding: '24px 32px',
                    background: '#f5f5f5',
                  }}
                />
              )}

              {originalState.mode === 'html' && htmlContent && (
                <iframe
                  title="原文预览"
                  srcDoc={htmlContent}
                  style={{ width: '100%', height: '100%', border: 'none' }}
                  sandbox="allow-same-origin"
                />
              )}
            </>
          ) : (
            // === 结构化视图 ===
            <>
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
            </>
          )}
        </div>
      </div>
    );
  },
);

ContractTextView.displayName = 'ContractTextView';
export default ContractTextView;
