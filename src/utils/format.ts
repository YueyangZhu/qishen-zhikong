/**
 * 格式化工具：金额、日期、文件大小、编号
 */
import dayjs from 'dayjs';

/** 格式化金额（千分位 + 币种） */
export function formatMoney(amount: number, currency = 'CNY'): string {
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : '';
  return `${symbol}${(amount ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** 格式化中文大写金额（简化版，用于报告） */
export function formatMoneyCN(num: number): string {
  const cnNums = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  const cnIntRadice = ['', '拾', '佰', '仟', '万', '拾', '佰', '仟', '亿'];
  if (num === 0) return '零元整';
  const intPart = Math.floor(num);
  if (intPart === 0) return '零元整';
  const str = String(intPart);
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const digit = parseInt(str[i], 10);
    const pos = str.length - i - 1;
    result += cnNums[digit] + cnIntRadice[pos];
  }
  result = result.replace(/零+$/, '');
  return `${result}元整`;
}

/** 格式化日期时间（默认精确到秒） */
export function formatDateTime(value?: string | null, withTime = true): string {
  if (!value) return '—';
  const d = dayjs(value);
  if (!d.isValid()) return '—';
  return withTime ? d.format('YYYY-MM-DD HH:mm:ss') : d.format('YYYY-MM-DD');
}

/** 格式化日期 */
export function formatDate(value?: string | null): string {
  return formatDateTime(value, false);
}

/** 文件大小格式化 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 生成 ID（带前缀） */
export function genId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}${rand}`.toUpperCase();
}

/** 当前 ISO 时间 */
export function now(): string {
  return new Date().toISOString();
}

/** 截断文本 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}

/** 防抖 */
export function debounce<T extends (...args: any[]) => void>(fn: T, delay = 300): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  }) as T;
}
