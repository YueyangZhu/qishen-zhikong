/**
 * 根据合同段落数据动态生成 DOCX Blob
 * 用于样例合同的前端原生预览（docx-preview 渲染）
 */
import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  BorderStyle,
} from 'docx';
import type { ContractParagraph } from '@/types';

/**
 * 根据 paragraphs 生成 DOCX Blob
 * @param paragraphs 合同段落数组
 * @param title 合同标题（可选，默认取第一段文本）
 * @returns Promise<Blob> DOCX 文件的 Blob
 */
export async function generateDocxFromParagraphs(
  paragraphs: ContractParagraph[],
  title?: string,
): Promise<Blob> {
  const docParagraphs: Paragraph[] = [];

  for (const para of paragraphs) {
    const paraType = para.type ?? inferType(para.index);
    const text = para.text || '';

    switch (paraType) {
      case 'title': {
        // 标题：居中、大字号、加粗
        docParagraphs.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 240 },
            children: [
              new TextRun({
                text,
                bold: true,
                size: 36, // 18pt
                font: 'SimSun',
              }),
            ],
          }),
        );
        break;
      }

      case 'header': {
        // 首部甲乙方信息：正常字号，带左边框
        const lines = text.split('\n');
        const runs: TextRun[] = [];
        lines.forEach((line, i) => {
          if (i > 0) runs.push(new TextRun({ break: 1 }));
          runs.push(new TextRun({ text: line, size: 24, font: 'SimSun' }));
        });
        docParagraphs.push(
          new Paragraph({
            spacing: { before: 60, after: 60 },
            border: {
              left: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
            },
            children: runs,
          }),
        );
        break;
      }

      case 'signature': {
        // 签署落款：正常字号，灰色
        const lines = text.split('\n');
        const runs: TextRun[] = [];
        lines.forEach((line, i) => {
          if (i > 0) runs.push(new TextRun({ break: 1 }));
          runs.push(new TextRun({ text: line, size: 24, font: 'SimSun', color: '666666' }));
        });
        docParagraphs.push(
          new Paragraph({
            spacing: { before: 240, after: 120 },
            children: runs,
          }),
        );
        break;
      }

      case 'body':
      default: {
        // 正文条款：条款编号加粗，正文正常
        const clauseNo = para.clauseNo;
        const firstLineEnd = text.indexOf('\n');
        const firstLine = firstLineEnd > 0 ? text.substring(0, firstLineEnd) : text;
        const rest = firstLineEnd > 0 ? text.substring(firstLineEnd + 1) : '';

        const runs: TextRun[] = [];
        // 条款编号加粗
        if (clauseNo && firstLine.startsWith(clauseNo)) {
          runs.push(new TextRun({ text: firstLine, bold: true, size: 24, font: 'SimSun' }));
        } else {
          runs.push(new TextRun({ text: firstLine, size: 24, font: 'SimSun' }));
        }
        // 剩余内容
        if (rest) {
          const restLines = rest.split('\n');
          restLines.forEach((line) => {
            runs.push(new TextRun({ break: 1 }));
            runs.push(new TextRun({ text: line, size: 24, font: 'SimSun' }));
          });
        }

        docParagraphs.push(
          new Paragraph({
            spacing: { before: 80, after: 80, line: 360 }, // 1.5倍行距
            children: runs,
          }),
        );
        break;
      }
    }
  }

  // 如果没有段落，添加一个空段落
  if (docParagraphs.length === 0) {
    docParagraphs.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }, // 1 inch
          },
        },
        children: docParagraphs,
      },
    ],
  });

  return Packer.toBlob(doc);
}

/**
 * 根据段落索引推断类型（与后端 seed.py 逻辑一致）
 */
function inferType(index: number): ContractParagraph['type'] {
  if (index === 1) return 'title';
  if (index <= 3) return 'header';
  return 'body';
}
