# 修复表格风险标注错位问题

## Summary

用户反馈：表格内容被识别出风险后，风险标注在原文视图中全部错位。截图显示表格文字被竖排/折行显示，且高亮位置偏离实际风险单元格。

本计划针对表格段落的原文渲染 + 风险叠加进行修复：
1. 后端 AI Prompt 中表格格式改为与 DOM 文本一致，避免 AI 返回带 markdown 分隔符的 `originalText`。
2. 前端 `overlayRisks` 对 table 段落使用单元格级匹配定位，不再依赖全局 `fullText` 位置。
3. 前端为 docx-preview 渲染的表格注入 CSS，修复文字竖排/重叠问题。

## Current State Analysis

### 后端表格解析

**文件**：`backend/app/services/pdf_service.py`

- `_parse_docx`（第 317-389 行）按文档顺序提取表格，`table.rows` 行优先遍历，`[cell.text.strip() for cell in row.cells]`。
- `summary_lines = [" ".join(row) for row in data]`，然后 `text = "\n".join(summary_lines)`。
- 因此 table 段落的 `paragraph.text` 格式为：
  ```
  期次 付款节点 比例 金额（元） 备注
  1 合同签订后10个工作日内 20% 560,000.00 预付款
  2 设计方 30% 840,000.00 设计款
  ...
  ```
- `_split_paragraphs`（第 457-468 行）将 table 块转为 `type="table"` 的 `ContractParagraph`，`tableData` 为二维数组。

### 后端 AI Prompt 中表格格式

**文件**：`backend/app/services/prompt_service.py`

- `_format_paragraph_for_prompt`（第 151-172 行）对 table 段落使用 markdown 表格格式：
  ```
  [段落ID:p15 编号:14] 表格内容：
  | 期次 | 付款节点 | 比例 | 金额（元） | 备注 |
  | --- | --- | --- | --- | --- |
  | 1 | 合同签订后10个工作日内 | 20% | 560,000.00 | 预付款 |
  ...
  ```
- AI 可能从 prompt 中截取包含 `"|"`、`"---"` 的文本作为 `originalText`，但 docx-preview 渲染的 DOM 中不存在这些符号，导致匹配失败或错位。

### 前端风险叠加逻辑

**文件**：`src/features/review/ContractTextView.tsx`

- `overlayRisks`（第 339-496 行）使用 TreeWalker 拼接 DOM 全文 `fullText`。
- 用 `paragraphs[].text` 前 20 字符在 `fullText` 中顺序匹配建立 `paraRanges`。
- 对每个风险，在 `paragraphId` 对应区间内查找 `originalText`。
- **问题**：
  1. docx-preview 渲染复杂表格时，DOM 文本节点顺序可能与 `paragraph.text`（行内空格拼接）不一致，导致 `paraRanges` 找不到 table 段落。
  2. AI 返回的 `originalText` 若含 markdown 符号，在 DOM 中无法匹配。
  3. 即使匹配到，全局 offset 在跨单元格的复杂表格中容易错位。

### docx-preview 表格渲染样式

- docx-preview 默认样式对复杂表格（竖排文字、合并单元格）支持不佳，截图中文字出现竖排、重叠。
- 需要注入 CSS 强制 `writing-mode: horizontal-tb` 和单元格水平排列。

## Proposed Changes

### Change 1：后端 AI Prompt 表格格式与 DOM 文本对齐

**文件**：`backend/app/services/prompt_service.py`

**What**：
修改 `_format_paragraph_for_prompt` 对 table 段落的格式化逻辑：
- 不再使用 markdown 表格格式（带 `|` 和 `---`）。
- 改为与 `paragraph.text` 一致的空格拼接行文本：每行内单元格用空格拼接，行间用换行分隔。

**Why**：
让 AI 返回的 `originalText` 与 docx-preview 渲染的 DOM 文本一致，提高文本匹配成功率。

**How**：
```python
def _format_paragraph_for_prompt(p: ContractParagraph) -> str:
    ptype = p.type if p.type else 'body'
    if ptype == 'table' and p.tableData:
        # 表格：使用与 paragraph.text 一致的格式，便于 AI 返回的 originalText 在 DOM 中匹配
        lines = [f"[段落ID:{p.id} 编号:{p.index}] 表格内容："]
        for row in p.tableData:
            lines.append(" ".join(cell or '' for cell in row))
        return "\n".join(lines)
    # ... 其他类型不变
```

### Change 2：前端 overlayRisks 增加 table 段落单元格级匹配

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
在 `overlayRisks` 中，对 `paragraphId` 对应段落 `type === 'table'` 的风险，使用单元格级匹配：
1. 按 paragraphs 顺序和 DOM 中 `<table>` 顺序建立 `paragraphId -> HTMLTableElement` 映射。
2. 对该 table 的所有 `td/th` 单元格，遍历其文本节点。
3. 在单元格内精确匹配 `originalText`；匹配失败时做归一化空白匹配。
4. 用 `<mark>` 包裹匹配到的文本节点范围。
5. 非 table 段落保持现有 `fullText` 位置匹配逻辑。

**Why**：
- 避免 docx-preview 渲染的表格 DOM 文本顺序与 `paragraph.text` 不一致导致的区间定位失败。
- 避免 AI 返回的 originalText 含 markdown 符号或单元格内换行造成的全局匹配错位。
- 单元格内匹配更稳定，即使表格样式复杂也能命中。

**How**：
新增 `highlightInTableCell` 辅助函数：
```typescript
function highlightInTableCell(
  cell: HTMLTableCellElement,
  search: string,
  risk: RiskOverlayItem,
  onActivateRisk?: (riskId: string) => void,
): boolean {
  const cellText = cell.textContent || '';
  let idx = cellText.indexOf(search);
  if (idx === -1) {
    // 归一化空白匹配
    const normCell = cellText.replace(/\s+/g, '');
    const normSearch = search.replace(/\s+/g, '');
    const normIdx = normCell.indexOf(normSearch);
    if (normIdx === -1) return false;
    // 映射回原文位置
    let origIdx = 0;
    let ni = 0;
    while (ni < normIdx) {
      if (!/\s/.test(cellText[origIdx])) ni++;
      origIdx++;
    }
    idx = origIdx;
  }
  if (idx === -1) return false;

  const endIdx = idx + search.length;
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const len = node.nodeValue?.length || 0;
    if (!startNode && offset + len > idx) {
      startNode = node;
      startOffset = idx - offset;
    }
    if (offset + len >= endIdx) {
      endNode = node;
      endOffset = endIdx - offset;
      break;
    }
    offset += len;
  }
  if (!startNode || !endNode) return false;

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
    const contents = range.extractContents();
    mark.appendChild(contents);
    range.insertNode(mark);
  } catch (e) {
    console.warn('[highlightInTableCell] wrap failed', risk.riskId, e);
    return false;
  }
  return true;
}
```

在 `overlayRisks` 主循环中：
```typescript
// 按顺序建立 paragraphId -> DOM table 映射
const tableElements = Array.from(container.querySelectorAll('table'));
const tableMap = new Map<string, HTMLTableElement>();
let tableIdx = 0;
for (const para of paragraphs) {
  if (para.type === 'table' && tableIdx < tableElements.length) {
    tableMap.set(para.id, tableElements[tableIdx]);
    tableIdx++;
  }
}

for (const risk of risks) {
  const para = paragraphs.find((p) => p.id === risk.paragraphId);
  if (para?.type === 'table') {
    const table = tableMap.get(risk.paragraphId);
    if (table) {
      const cells = Array.from(table.querySelectorAll('td, th'));
      let highlighted = false;
      for (const cell of cells) {
        if (highlightInTableCell(cell, search, risk, onActivateRisk)) {
          highlighted = true;
          overlaid++;
          // 如需标注所有匹配单元格可继续；通常一个风险只对应一个单元格
          break;
        }
      }
      if (highlighted) continue;
    }
  }
  // ... 原有非 table 段落的全文匹配逻辑
}
```

### Change 3：前端注入 CSS 修复表格竖排文字

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
在 DOCX 渲染容器 `docxContainerRef` 内注入 `<style>`，强制 docx-preview 渲染的表格水平排列、不重叠。

**Why**：
截图显示表格文字竖排、重叠，影响可读性和风险定位。

**How**：
在 DOCX 渲染的 `useEffect` 中，renderAsync 完成后注入样式：
```typescript
const style = document.createElement('style');
style.textContent = `
  .docx-preview table,
  .docx-preview table td,
  .docx-preview table th {
    writing-mode: horizontal-tb !important;
    text-orientation: mixed !important;
    white-space: normal !important;
    word-break: break-word !important;
  }
  .docx-preview table td > *,
  .docx-preview table th > * {
    writing-mode: horizontal-tb !important;
  }
`;
docxContainerRef.current.appendChild(style);
```

注意：style 标签应只在首次渲染时注入，或每次渲染前清除旧 style。

## Assumptions & Decisions

1. **按顺序匹配 DOM table 与 paragraphs**：假设 docx-preview 为每个 table 段落渲染一个 `<table>`，且顺序与 paragraphs 中 table 段落顺序一致。这是合理假设，因为 docx-preview 按文档流渲染。
2. **AI originalText 去 markdown 化**：通过修改 prompt 格式，让 AI 返回的 `originalText` 更接近 DOM 文本，但不能 100% 保证 AI 不返回多余符号。单元格级匹配同时支持精确和归一化匹配，容错性较高。
3. **表格 CSS 注入不影响其他内容**：仅针对 `.docx-preview table` 作用域，强制水平排列，对正常表格无副作用。
4. **只处理 type === 'table' 的段落**：图片、正文段落保持现有逻辑不变。

## Verification Steps

1. `npm run build` 无报错。
2. 启动后端 + 前端，上传含复杂表格（付款计划表、项目里程碑表）的 DOCX 合同。
3. 确认表格文字水平排列，无竖排/重叠。
4. 查看表格中的风险（如预付款比例、付款节点）是否在对应单元格内正确高亮。
5. 点击风险卡片，确认原文自动滚动到对应表格单元格。
6. 上传 PDF 含表格的合同，确认 PDF 表格风险标注不受影响（PDF 用 pdf.js 文本层，已有独立逻辑）。

## Out of Scope

- 不修改后端表格解析逻辑（`pdf_service.py` 的表格提取方式不变）。
- 不修改表格在结构化兜底视图中的渲染。
- 不引入新的第三方库。
- 不处理 docx-preview 无法渲染的极端复杂表格（如多层嵌套表格）。
