/**
 * 后端 API 客户端
 * 与 FastAPI 后端（默认 http://127.0.0.1:8000）通信
 *
 * 设计原则：
 * 1. 统一错误处理，返回标准格式
 * 2. 支持超时控制
 * 3. 保留 Mock fallback：后端不可用时降级到 Mock
 */
import type { ParsedDocument, ExtractedField, RiskItem } from '@/types';
import { delay } from './db';
import { authHeaders } from '@/utils/token';
import { API_BASE } from '@/utils/apiBase';

/** 默认超时 180 秒（AI 调用较慢，DeepSeek 复杂合同审核可能需要 90-150 秒） */
const DEFAULT_TIMEOUT = 180_000;

/** 后端响应统一格式 */
interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  message: string | null;
}

/** 后端模式信息 */
export interface BackendMode {
  is_mock: boolean;
  model: string | null;
  reason: string | null;
}

/** 检查后端是否可用 + 当前模式
 *
 * Render 免费档服务 15 分钟无请求会休眠，冷启动需 30-60 秒。
 * 单次请求超时 35 秒，最多重试 2 次（首次 + 重试），总等待约 70 秒。
 */
export async function checkBackendHealth(): Promise<BackendMode | null> {
  const url = `${API_BASE}/health`;
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[apiClient] checkBackendHealth 第 ${attempt}/${maxAttempts} 次请求:`, url);
      const resp = await fetchWithTimeout(url, { method: 'GET' }, 35_000);
      if (!resp.ok) {
        console.warn(`[apiClient] checkBackendHealth 第 ${attempt} 次 HTTP 状态异常:`, resp.status, url);
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        return null;
      }
      const data = await resp.json();
      console.log('[apiClient] checkBackendHealth 成功:', data);
      return data as BackendMode;
    } catch (e) {
      console.error(`[apiClient] checkBackendHealth 第 ${attempt} 次失败:`, url, e);
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      return null;
    }
  }
  return null;
}

/** 解析文档结果 */
export interface ParsedDocumentResult {
  title: string;
  sections: ParsedDocument['sections'];
  paragraphs: ParsedDocument['paragraphs'];
  fullText: string;
  htmlContent?: string | null;
}

/** 调用后端解析合同文件 */
export async function parseDocument(file: File): Promise<ParsedDocumentResult> {
  const formData = new FormData();
  formData.append('file', file);

  const resp = await fetchWithTimeout(
    `${API_BASE}/api/parse`,
    { method: 'POST', body: formData, headers: { ...authHeaders() } },
    DEFAULT_TIMEOUT,
  );

  const result = await resp.json() as ApiResponse<ParsedDocumentResult>;
  if (!result.success || !result.data) {
    throw new Error(result.message ?? '文件解析失败');
  }
  return result.data;
}

/** 字段抽取结果（与后端 ExtractedField 对齐） */
export interface AIExtractedField {
  fieldKey: string;
  fieldLabel: string;
  fieldValue: string;
  confidence: number;
  lowConfidence: boolean;
  sourceText: string;
}

/** 调用后端 AI 抽取字段 */
export async function extractFields(
  paragraphs: ParsedDocument['paragraphs'],
): Promise<AIExtractedField[]> {
  const resp = await fetchWithTimeout(
    `${API_BASE}/api/extract-fields`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ paragraphs }),
    },
    DEFAULT_TIMEOUT,
  );

  const result = await resp.json() as ApiResponse<{ fields: AIExtractedField[] }>;
  if (!result.success || !result.data) {
    throw new Error(result.message ?? '字段抽取失败');
  }
  return result.data.fields;
}

/** AI 审核结果风险项（与后端 RiskItemAI 对齐） */
export interface AIRiskItem {
  title: string;
  riskType: RiskItem['riskType'];
  riskLevel: RiskItem['riskLevel'];
  clauseNumber: string;
  clauseTitle: string;
  originalText: string;
  paragraphId: string;
  startPosition: number;
  endPosition: number;
  riskReason: string;
  reviewBasis: string;
  suggestion: string;
  confidence: number;
  sourceType: 'ai' | 'rule';
  /** 匹配的规则 ID（如 RR-003），由规则引擎注入 */
  matchedRuleId?: string | null;
}

/** 调用后端 AI 审核风险 */
export async function reviewRisks(
  paragraphs: ParsedDocument['paragraphs'],
  options: {
    contractType?: string;
    myRole?: 'buyer' | 'seller';
    reviewFocus?: string[];
    reviewNote?: string;
  },
): Promise<{ risks: AIRiskItem[]; aiSummary: string }> {
  const resp = await fetchWithTimeout(
    `${API_BASE}/api/review-risks`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        paragraphs,
        contractType: options.contractType,
        myRole: options.myRole,
        reviewFocus: options.reviewFocus ?? [],
        reviewNote: options.reviewNote,
      }),
    },
    DEFAULT_TIMEOUT,
  );

  const result = await resp.json() as ApiResponse<{ risks: AIRiskItem[]; aiSummary: string }>;
  if (!result.success || !result.data) {
    throw new Error(result.message ?? 'AI 审核失败');
  }
  return result.data;
}

/** 完整 AI 审核流程：解析 → 抽取 → 审核，带进度回调 */
export interface AIReviewProgress {
  stage: 'parse' | 'extract' | 'review' | 'done' | 'error';
  message: string;
  progress: number; // 0-100
}

export async function runFullAIReview(
  file: File,
  options: {
    contractType?: string;
    myRole?: 'buyer' | 'seller';
    reviewFocus?: string[];
    reviewNote?: string;
  },
  onProgress?: (p: AIReviewProgress) => void,
  taskId?: string,
): Promise<{
  parsedDocument: ParsedDocumentResult;
  fields: AIExtractedField[];
  risks: AIRiskItem[];
  aiSummary: string;
}> {
  // 0. 上传原始文件到后端（用于后续下载）
  if (taskId) {
    const uploadFormData = new FormData();
    uploadFormData.append('file', file);
    fetchWithTimeout(
      `${API_BASE}/api/data/documents/${taskId}/upload`,
      { method: 'POST', body: uploadFormData, headers: { ...authHeaders() } },
      60000,
    ).catch((e) => console.warn('[runFullAIReview] 原文件上传失败（不影响审核）:', e));
  }

  // 1. 解析文档
  onProgress?.({ stage: 'parse', message: '正在解析合同文档...', progress: 15 });
  const parsedDocument = await parseDocument(file);

  // 1.5 图片 OCR：对 image 类型段落执行 OCR，将文字内容加入段落数据
  const hasImages = parsedDocument.paragraphs.some((p) => p.type === 'image' && p.imageData);
  if (hasImages) {
    onProgress?.({ stage: 'parse', message: '正在识别图片内容（OCR）...', progress: 25 });
    try {
      const { ocrParagraphs } = await import('@/utils/ocr');
      parsedDocument.paragraphs = await ocrParagraphs(parsedDocument.paragraphs);
    } catch (e) {
      console.warn('[runFullAIReview] OCR 失败（不影响审核）:', e);
    }
  }

  // 2. 抽取字段
  onProgress?.({ stage: 'extract', message: `正在抽取字段（${parsedDocument.paragraphs.length} 段）...`, progress: 40 });
  const fields = await extractFields(parsedDocument.paragraphs);

  // 3. AI 审核风险（带重试：DeepSeek 复杂合同审核可能因网络抖动/超时失败）
  onProgress?.({ stage: 'review', message: '正在 AI 审核风险...', progress: 70 });
  let risks: AIRiskItem[] = [];
  let aiSummary = '';
  const maxReviewAttempts = 2;
  let reviewError: Error | null = null;
  for (let attempt = 1; attempt <= maxReviewAttempts; attempt++) {
    try {
      const result = await reviewRisks(parsedDocument.paragraphs, options);
      risks = result.risks;
      aiSummary = result.aiSummary;
      reviewError = null;
      break;
    } catch (e) {
      reviewError = e instanceof Error ? e : new Error(String(e));
      console.warn(`[runFullAIReview] AI 审核第 ${attempt}/${maxReviewAttempts} 次失败:`, reviewError.message);
      if (attempt < maxReviewAttempts) {
        onProgress?.({
          stage: 'review',
          message: `AI 审核第 ${attempt} 次失败，2 秒后重试...`,
          progress: 70,
        });
        await new Promise((r) => setTimeout(r, 2000));
        onProgress?.({ stage: 'review', message: '正在重新审核风险...', progress: 75 });
      }
    }
  }
  if (reviewError) {
    throw reviewError;
  }

  onProgress?.({ stage: 'done', message: '审核完成', progress: 100 });
  return { parsedDocument, fields, risks, aiSummary };
}

/** 生成 PDF 报告请求体（与后端 GeneratePdfRequest 对齐） */
export interface GeneratePdfRequestPayload {
  reportNo: string;
  versionNo: number;
  snapshot: {
    contractName: string;
    contractNo: string;
    counterparty: string;
    amount: number;
    currency: string;
    contractType: string;
    reviewFocus: string[];
    fields: Array<{
      id: string;
      fieldKey: string;
      fieldLabel: string;
      fieldValue: string;
      confirmedValue: string | null;
      confidence: number;
    }>;
    risks: Array<{
      id: string;
      title: string;
      riskType: string;
      riskLevel: string;
      clauseNumber: string;
      clauseTitle: string;
      originalText: string;
      riskReason: string;
      suggestion: string;
      editedSuggestion: string | null;
      confidence: number;
      sourceType: string;
      status: string;
      handler: string | null;
    }>;
    riskCount: { high: number; medium: number; low: number; notice: number };
    riskScore: number;
    overallRiskLevel: string;
    aiSummary: string;
    legalOpinion: string;
    legalConclusion: string;
    majorRisks: unknown[];
    disclaimer: string;
    generatedAt: string;
  };
}

/**
 * 调用后端生成 PDF 审核报告
 * 返回 Blob 用于触发浏览器下载
 */
export async function generateReportPDF(payload: GeneratePdfRequestPayload): Promise<Blob> {
  const resp = await fetchWithTimeout(
    `${API_BASE}/api/reports/generate-pdf`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    30_000, // PDF 生成通常较快，30s 超时
  );
  return await resp.blob();
}

/**
 * 调用后端 Playwright 接口生成 PDF（视觉与网页 100% 一致，文字可复制）
 * 用无头 Chromium 加载报告页 → page.pdf() → 返回 PDF 二进制
 * 需要前端 dev server 运行中
 */
export async function generateReportPDFViaBrowser(reportId: string): Promise<Blob> {
  const { authHeaders } = await import('@/utils/token');
  const resp = await fetchWithTimeout(
    `${API_BASE}/api/reports/${encodeURIComponent(reportId)}/pdf`,
    {
      method: 'GET',
      headers: {
        ...authHeaders(),
      },
    },
    90_000, // Playwright 启动 Chromium + 渲染 + 生成 PDF，给 90s
  );
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(errText || `HTTP ${resp.status}: ${resp.statusText}`);
  }
  return await resp.blob();
}

/** 触发浏览器下载 Blob 文件 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 延迟释放 URL
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 带超时的 fetch 封装 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    if (!resp.ok) {
      // 尝试读取后端返回的详细错误信息（FastAPI 的 detail 字段）
      let detailText = resp.statusText;
      try {
        const errBody = await resp.json();
        if (errBody?.detail) {
          detailText = typeof errBody.detail === 'string'
            ? errBody.detail
            : JSON.stringify(errBody.detail);
        } else if (errBody?.message) {
          detailText = errBody.message;
        } else if (errBody?.error) {
          detailText = errBody.error;
        }
      } catch {
        // 响应体不是 JSON，回退到 statusText
      }
      throw new Error(`HTTP ${resp.status}: ${detailText}`);
    }
    return resp;
  } catch (e) {
    // 保留原始错误信息 + 请求 URL，便于在控制台诊断公网部署问题
    if (e instanceof Error) {
      if (e.name === 'AbortError' || e.message.includes('aborted')) {
        throw new Error(`请求超时（${url}），请检查网络后重试`);
      }
      if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
        throw new Error(`后端连接失败 [${url}]：${e.message}。公网部署可能正在冷启动（30秒左右），请稍候重试；若持续失败请检查 API_BASE 配置。`);
      }
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Mock 模式下的字段抽取（后端不可用时降级） */
export async function mockExtractFields(): Promise<AIExtractedField[]> {
  return [
    { fieldKey: 'contractName', fieldLabel: '合同名称', fieldValue: '演示合同', confidence: 0.95, lowConfidence: false, sourceText: '演示合同' },
    { fieldKey: 'amount', fieldLabel: '合同金额', fieldValue: '100000', confidence: 0.9, lowConfidence: false, sourceText: '合同金额 100000 元' },
  ];
}
