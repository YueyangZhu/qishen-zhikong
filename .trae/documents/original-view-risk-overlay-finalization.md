# 原文视图 + 风险叠加 ｜ 收尾与验证计划

## Summary

承接上一轮会话已完成的主体工作（ContractTextView 统一为原文视图 + 风险叠加、pdf.js 渲染 PDF、docx-preview 渲染 DOCX、前端 tesseract.js OCR、后端表格/图片参与规则匹配与 AI Prompt），本计划聚焦于：

1. **清理遗留**：移除 `originalState` 的 `html` 模式分支（计划 Part 4 未完成项）。
2. **风险匹配消歧**：`overlayRisks` 增加 `paragraphId` 预定位，避免同一原文多次出现时误匹配到首次出现位置。
3. **构建验证**：运行 `npm run build` 确保 TypeScript 严格模式无报错。
4. **代码提交**：本地构建通过后，git commit + push 到 GitHub master。

用户两个核心诉求的当前实现状态：
- ✅ 合同正文加载文件原文格式（DOCX 用 docx-preview，PDF 用 pdf.js），风险标注通过文本匹配叠加在原文 DOM 上
- ✅ 图片内容通过前端 tesseract.js OCR 识别后参与风险规则判断；表格内容直接参与规则匹配（拼接所有单元格文本）和 AI Prompt（markdown 格式传递完整结构）

## Current State Analysis

### 已完成（无需改动）

| 模块 | 文件 | 状态 |
|------|------|------|
| 前端原文视图 | `src/features/review/ContractTextView.tsx` | viewMode 已移除，overlayRisks/renderPdfWithPdfJs/useFallback 齐全 |
| 前端 OCR 工具 | `src/utils/ocr.ts` | tesseract.js chi_sim+eng，ocrParagraphs 并发 3 |
| 前端类型 | `src/types/index.ts` | ContractParagraph 含 ocrText |
| 前端审核流程 | `src/services/apiClient.ts` | runFullAIReview 步骤 1.5 集成 OCR |
| 后端 Schema | `backend/app/schemas/review.py` | ContractParagraph 含 ocrText |
| 后端规则引擎 | `backend/app/services/rule_service.py` | keyword_match 表格拼接单元格、图片用 ocrText |
| 后端 Prompt | `backend/app/services/prompt_service.py` | _format_paragraph_for_prompt 表格 markdown、图片 OCR |
| 依赖 | `package.json` | pdfjs-dist ^6.1.200、tesseract.js ^7.0.0 已安装 |

### 未完成（本计划处理）

1. **`ContractTextView.tsx` 第 53 行** `OriginalState` 类型仍保留 `| { mode: 'html' }`，第 744-747 行 `loadOriginal` 仍有 `htmlContent` 分支，第 956-963 行仍有 iframe 渲染。原计划 Part 4 要求移除。
2. **`ContractTextView.tsx` `overlayRisks` 函数**（第 340-475 行）直接在全文做 `indexOf` 匹配，未用 `risk.paragraphId` 预定位段落范围。当同一原文（如"甲方"、"乙方"）在合同中多次出现时，所有风险都会命中第一次出现的位置，导致风险标注错位。
3. **未运行 `npm run build`** 验证 TypeScript 编译。
4. **未 git commit / push**。

## Proposed Changes

### Change 1：移除 originalState 的 html 模式

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
- `OriginalState` 类型联合中移除 `| { mode: 'html' }`（第 53 行）。
- `loadOriginal` 函数中移除 `htmlContent` 分支（第 744-747 行附近的 `if (htmlContent) { setOriginalState({ mode: 'html' }); return; }`）。
- 移除 iframe 渲染分支（第 956-963 行附近的 `originalState.mode === 'html'` JSX 块）。
- `ContractTextViewProps` 接口中保留 `htmlContent?: string | null` 字段（外部仍可能传入，但内部不再使用，避免破坏调用方），或一并移除该字段并检查调用处。优先方案：保留接口字段，仅移除内部 html 渲染分支，降低改动面。

**Why**：html iframe 渲染（mammoth 生成的 HTML）无法在 iframe 内部叠加风险高亮（跨 document 的 TreeWalker 不可用），与"原文 + 风险标注"的统一目标冲突。当前已用 docx-preview/pdf.js 替代，html 分支为死代码。

**How**：直接删除三处代码块，TypeScript 严格模式不会报错（OriginalState 联合类型缩小）。

### Change 2：overlayRisks 风险匹配消歧

**文件**：`src/features/review/ContractTextView.tsx`

**What**：修改 `overlayRisks` 函数（第 340-475 行），在全文 indexOf 匹配前，先按 `risk.paragraphId` 预定位段落范围。

**Why**：当前实现直接在全文做 indexOf，当风险原文（如"甲方应在收到发票后30日内付款"）在合同中只出现一次时正常，但当短原文（如"甲方"、"乙方"、"违约金"）多次出现时，所有风险都会命中第一次出现的位置，导致同一位置被多个 mark 重复包裹、其他位置无标注。

**How**（两步法）：
1. **构建段落文本位置映射**：在 TreeWalker 遍历文本节点时，同时记录每个段落（通过 `data-paragraph-id` 属性或文本前缀匹配）在 fullText 中的起止位置。具体做法：
   - 遍历 DOM 时，对每个文本节点，向上查找最近的 `data-paragraph-id` 容器，记录该 paragraphId 在 fullText 中的区间 `[paraStart, paraEnd]`。
   - 若 docx-preview/pdf.js 渲染的 DOM 没有显式 `data-paragraph-id`，则用 `paragraphs` 数组中每个段落 `text` 的前 20 字符在 fullText 中顺序匹配，建立段落区间表。
2. **按 paragraphId 限定匹配范围**：对每个 risk，若 `risk.paragraphId` 存在且在段落区间表中找到对应区间，则在该区间内做 indexOf 匹配；找不到区间或无 paragraphId 时，回退到全文匹配（保持现有行为）。
3. **保留归一化空白匹配作为兜底**：精确匹配失败时仍走现有的归一化逻辑，但限定在段落区间内。

**关键代码骨架**：
```typescript
// 1. 构建段落区间表：paraRanges: Map<paragraphId, {start, end}>
const paraRanges = new Map<string, {start: number, end: number}>();
// 方案 A：DOM 有 data-paragraph-id
// 方案 B：用 paragraphs[].text 前 20 字符顺序匹配
let searchStart = 0;
for (const para of paragraphs) {
  const prefix = (para.text || '').slice(0, 20).trim();
  if (prefix) {
    const idx = fullText.indexOf(prefix, searchStart);
    if (idx !== -1) {
      const paraEnd = idx + (para.text?.length || prefix.length);
      paraRanges.set(para.id, { start: idx, end: Math.min(paraEnd, fullText.length) });
      searchStart = paraEnd;
    }
  }
}

// 2. 匹配时优先在段落区间内查找
for (const risk of risks) {
  const range = paraRanges.get(risk.paragraphId);
  const searchStart = range ? range.start : 0;
  const searchEnd = range ? range.end : fullText.length;
  const segment = fullText.slice(searchStart, searchEnd);
  let localIdx = segment.indexOf(search);
  // ... 归一化匹配同理限定在 segment 内
  const matchStart = searchStart + localIdx;
  // 后续 Range 包裹逻辑不变
}
```

### Change 3：npm run build 验证

**命令**：`npm run build`（在 `d:\TRAE_work_demo\zhinenghetong` 目录）

**通过标准**：TypeScript 编译 + Vite 构建无报错，dist 目录生成。若有报错，逐项修复（常见：未使用变量、类型不匹配、import 缺失）。

### Change 4：git commit + push

**步骤**：
1. `git status` 查看变更文件
2. `git diff` 确认改动范围
3. `git log -n 5 --oneline` 查看最近提交风格
4. `git add` 相关文件（ContractTextView.tsx 及可能的其他改动）
5. `git commit -m "..."` 提交（消息参考历史风格，中文描述）
6. `git push origin master`

**提交消息草稿**：
```
feat(review): 统一合同正文为原文视图+风险叠加，支持图片OCR与表格参与识别

- ContractTextView 移除 viewMode，统一用 docx-preview/pdf.js 渲染原文
- overlayRisks 通过 TreeWalker 文本匹配在原文 DOM 上叠加风险高亮
- 新增 src/utils/ocr.ts：tesseract.js 对图片段落做 chi_sim+eng OCR
- 后端 keyword_match 表格拼接单元格、图片用 ocrText 参与规则匹配
- 后端 _format_paragraph_for_prompt 表格转 markdown、图片传 OCR 文本
- 移除 originalState html 模式，overlayRisks 增加 paragraphId 预定位消歧
```

## Assumptions & Decisions

1. **保留 `htmlContent` 接口字段**：避免破坏 ReviewDetailPage 等调用方，仅移除内部 html 渲染分支。若调用方未传 htmlContent，无副作用。
2. **段落区间表用文本前缀匹配**：docx-preview 渲染的 DOM 不保留 `data-paragraph-id`，pdf.js 渲染的文本层更无段落概念，因此用 `paragraphs[].text` 前 20 字符顺序匹配建立区间。前 20 字符足以唯一定位段落开头。
3. **OCR 失败不阻断**：现有 try/catch 吞错策略保留，OCR 失败时图片段落无 ocrText，规则引擎和 AI 都按"无文本"处理。
4. **不修改后端**：后端代码（review.py / rule_service.py / prompt_service.py）已就绪，本计划不动后端。
5. **不新增测试**：项目无单测框架，验证靠 `npm run build` + 手动演示流程。

## Verification Steps

1. `npm run build` 无报错，dist 目录生成。
2. `git status` 显示仅 ContractTextView.tsx（及可能的关联文件）变更。
3. `git push origin master` 成功，GitHub 远端可见最新提交。
4. （可选，用户手动）启动后端 + 前端，上传一个 DOCX 合同，确认原文格式渲染 + 风险高亮叠加在原文上、章节标题不重复、章节标题颜色与自身风险一致。
5. （可选，用户手动）上传一个 PDF 合同，确认 pdf.js 渲染 + 风险高亮叠加。
6. （可选，用户手动）上传含图片的合同，确认 OCR 进度提示出现、图片段落风险识别正常。
7. （可选，用户手动）上传含表格的合同，确认表格内容参与规则匹配（如表格中含"违约金 0.01%"应被识别为风险）。

## Out of Scope

- 不重新设计筛选布局、章节标题风险标识（已在上一轮会话完成）。
- 不修改后端代码（已就绪）。
- 不实现真实 PDF/DOCX 解析（仍用现有 docx-preview/pdf.js 渲染）。
- 不引入新的 UI 框架或依赖。
