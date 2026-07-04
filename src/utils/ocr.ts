/**
 * 图片 OCR 工具：使用 tesseract.js 识别图片中的文字
 * 支持中文（chi_sim）和英文（eng）
 */
import type { ContractParagraph } from '@/types';

let workerPromise: Promise<any> | null = null;

async function getWorker(): Promise<any> {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker(['chi_sim', 'eng']);
    return worker;
  })();
  return workerPromise;
}

/**
 * 对 base64 图片做 OCR，返回识别文本
 */
export async function ocrImage(
  imageData: string,
  imageFormat: string = 'png',
): Promise<string> {
  try {
    const worker = await getWorker();
    const dataUrl = `data:image/${imageFormat};base64,${imageData}`;
    const { data } = await worker.recognize(dataUrl);
    const text = (data?.text || '').trim();
    return text;
  } catch (e) {
    console.warn('[OCR] 识别失败:', e);
    return '';
  }
}

/**
 * 对段落列表中所有 image 类型段落执行 OCR，返回带 ocrText 的新段落列表
 * 不阻塞：OCR 异步执行，完成后回调更新
 */
export async function ocrParagraphs(
  paragraphs: ContractParagraph[],
  onUpdate?: (paragraphId: string, ocrText: string) => void,
): Promise<ContractParagraph[]> {
  const imageParas = paragraphs.filter(
    (p) => p.type === 'image' && p.imageData && !p.ocrText,
  );

  if (imageParas.length === 0) return paragraphs;

  // 并行 OCR 所有图片（最多 3 个并发）
  const concurrency = 3;
  const results = new Map<string, string>();

  for (let i = 0; i < imageParas.length; i += concurrency) {
    const batch = imageParas.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (para) => {
        const text = await ocrImage(para.imageData!, para.imageFormat || 'png');
        results.set(para.id, text);
        if (text && onUpdate) {
          onUpdate(para.id, text);
        }
      }),
    );
  }

  // 返回更新后的段落列表
  return paragraphs.map((p) => {
    const ocrText = results.get(p.id);
    if (ocrText) {
      return { ...p, ocrText };
    }
    return p;
  });
}
