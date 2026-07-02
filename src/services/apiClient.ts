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

/** 后端地址
 * - 本地开发：默认 http://127.0.0.1:8000
 * - 生产部署：通过环境变量 VITE_API_BASE 注入（Render 控制台设置）
 *   - 前后端同域时留空，使用相对路径
 *   - 跨域部署时填完整域名，如 https://qishen-backend.onrender.com
 */
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').trim() || 'http://127.0.0.1:8000';

/** 默认超时 120 秒（AI 调用较慢） */
const DEFAULT_TIMEOUT = 120_000;

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

/** 检查后端是否可用 + 当前模式 */
export async function checkBackendHealth(): Promise<BackendMode | null> {
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/health`, { method: 'GET' }, 5000);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data as BackendMode;
  } catch {
    return null;
  }
}

/** 解析文档结果 */
export interface ParsedDocumentResult {
  title: string;
  sections: ParsedDocument['sections'];
  paragraphs: ParsedDocument['paragraphs'];
  fullText: string;
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
): Promise<{
  parsedDocument: ParsedDocumentResult;
  fields: AIExtractedField[];
  risks: AIRiskItem[];
  aiSummary: string;
}> {
  // 1. 解析文档
  onProgress?.({ stage: 'parse', message: '正在解析合同文档...', progress: 15 });
  const parsedDocument = await parseDocument(file);

  // 2. 抽取字段
  onProgress?.({ stage: 'extract', message: `正在抽取字段（${parsedDocument.paragraphs.length} 段）...`, progress: 40 });
  const fields = await extractFields(parsedDocument.paragraphs);

  // 3. AI 审核风险
  onProgress?.({ stage: 'review', message: '正在 AI 审核风险...', progress: 70 });
  const { risks, aiSummary } = await reviewRisks(
    parsedDocument.paragraphs,
    options,
  );

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
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }
    return resp;
  } catch (e) {
    // 把晦涩的底层网络错误转成友好中文提示，页面层 message.error(e.message) 直接可用
    if (e instanceof Error) {
      if (e.name === 'AbortError' || e.message.includes('aborted')) {
        throw new Error('请求超时，请检查网络后重试');
      }
      if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
        throw new Error('后端服务连接失败，请确认后端已启动（双击 backend/run.bat），或检查网络后重试');
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
