# 修复表格风险高亮破坏布局问题

## Summary

用户反馈：表格中一旦某行出现风险高亮，整行内容就全部挤到第一列，整个表格展示错乱；同时表格样式没有还原 Word 原文格式。

经过对 docx-preview 0.3.7 渲染机制和当前代码的深入分析，根因已明确：
1. `highlightRowBackground` 给整行 td 加 3px 左右 border，在 `border-collapse: collapse` + `table-layout: auto` 下多出 6px 触发列宽重算。
2. 注入的全局 CSS `white-space: normal !important; word-break: break-word !important;` 覆盖了 docx-preview 原生的 `span { white-space: pre-wrap }`，让所有单元格最小内容宽度骤降。
3. `highlightInTableCell` 用 `Range.extractContents()` 包 `<mark>` 拆碎了原 `<span style="white-space: pre-wrap">`，mark 内部文本失去约束。
4. 注入的 `border: 1px solid #d9d9d9 !important` 覆盖了 Word 原表格真实边框样式。

本计划通过以下方式彻底修复：
- 用 `box-shadow` 替代 `border` 做行级风险标识（不占盒模型空间）。
- 移除破坏布局的全局 `word-break` 和 `border !important` 注入。
- `highlightInTableCell` 改用 `surroundContents` 或保留 span 结构的方式包裹 `<mark>`，避免拆碎 `pre-wrap`。
- 给 table 强制 `table-layout: fixed`，让 colgroup 严格生效。

## Current State Analysis

### 当前代码位置与问题

**文件**：`src/features/review/ContractTextView.tsx`

1. **`highlightRowBackground`（约 480-489 行）** —— 用 `el.style.borderLeft = '3px solid ...'` 和 `borderRight` 给整行 td 加边框，这是导致"挤到第一列"的元凶。

2. **`renderAsync().then()` 中的 CSS 注入（约 1055-1070 行）** —— 注入：
   ```css
   .docx-preview table td, .docx-preview table th {
     white-space: normal !important;
     word-break: break-word !important;
     border: 1px solid #d9d9d9 !important;
   }
   ```
   覆盖了 docx-preview 原生 `span { white-space: pre-wrap }` 和 Word 真实边框。

3. **`highlightInTableCell`（约 374-475 行）** —— 用 `range.extractContents()` + `mark.appendChild(contents)` + `range.insertNode(mark)` 包裹文本，会拆碎原 span 结构。

### docx-preview 渲染机制（关键事实）

- 表格 DOM：`<table style="border-collapse: collapse; table-layout: auto|fixed"><colgroup><col style="width:..."></colgroup><tr><td style="width:...; border:...; padding:..."><p><span style="white-space: pre-wrap">文本</span></p></td></tr></table>`
- 列宽由 `<colgroup><col style="width">` + `<td style="width">` + `table-layout` 三者协同维持。
- `table-layout: auto` 下，浏览器根据所有行 td 内容自动算列宽，最小内容宽度变化会触发重排。
- 默认 `span { white-space: pre-wrap }` 防止长串字符被任意截断。

## Proposed Changes

### Change 1：用 box-shadow 替代 border 做行级风险标识

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
重写 `highlightRowBackground`，不再设置 `borderLeft` 和 `borderRight`，改用 `box-shadow` 内阴影做行标识。同时不再覆盖原 `backgroundColor`，而是用半透明叠加（保留 Word 原底纹）。

**Why**：
- `box-shadow: inset` 不占盒模型空间，不会触发列宽重算。
- 半透明叠加保留原 Word 单元格底纹。

**How**：

```typescript
function highlightRowBackground(row: HTMLTableRowElement, level: RiskItem['riskLevel']) {
  const cfg = RISK_LEVEL_MAP[level];
  row.querySelectorAll('td, th').forEach((cell) => {
    const el = cell as HTMLElement;
    // 用 box-shadow inset 替代 border，不占盒模型空间，避免触发列宽重算
    // 颜色用半透明，保留原 Word 单元格底纹
    el.style.boxShadow = `inset 3px 0 0 ${cfg.color}, inset -3px 0 0 ${cfg.color}`;
    // 背景用半透明叠加，不完全覆盖原底纹
    el.style.backgroundBlendMode = 'multiply';
    // 不直接设置 backgroundColor，避免覆盖 Word 原底纹
  });
}
```

注意：`box-shadow` 不影响盒模型，`backgroundBlendMode` 让半透明色与原底纹混合。

### Change 2：移除破坏布局的全局 CSS 注入

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
移除 `renderAsync().then()` 中注入的 `white-space: normal !important`、`word-break: break-word !important`、`border: 1px solid #d9d9d9 !important`。只保留 `writing-mode: horizontal-tb` 和 `text-orientation: mixed`（修复竖排问题，但不影响列宽）。

**Why**：
- `white-space: normal` 覆盖了 docx-preview 原生 `pre-wrap`，导致最小内容宽度失效。
- `word-break: break-word` 让任何字符可换行，列宽约束失效。
- `border: 1px solid #d9d9d9 !important` 覆盖了 Word 原表格真实边框样式。

**How**：

```typescript
// 注入轻量 CSS，仅修复文字方向问题，不破坏列宽和边框
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
```

### Change 3：给所有 table 强制 table-layout: fixed

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
在 `renderAsync().then()` 的表格后处理循环中，给每个 table 显式设置 `table-layout: fixed`，让 colgroup 的列宽严格生效，避免因内容变化触发列宽重算。

**Why**：
- `table-layout: auto` 下，任何单元格内容变化（如插入 `<mark>`）都可能触发整表列宽重算。
- `table-layout: fixed` 下，列宽由 colgroup 严格决定，内容变化不影响列宽。
- docx-preview 已经从 `<w:tblGrid>` 解析了 colgroup 宽度，强制 fixed 后能严格还原 Word 列宽。

**How**：

```typescript
renderedTables.forEach((tableEl, idx) => {
  const para = tableParas[idx];
  if (!para || !para.tableData) return;

  tableEl.setAttribute('data-paragraph-id', para.id);
  // 强制 fixed 布局，让 colgroup 严格生效，避免内容变化触发列宽重算
  tableEl.style.tableLayout = 'fixed';
  tableEl.style.borderCollapse = 'collapse';
  tableEl.style.width = tableEl.style.width || '100%';

  // 给每个单元格标记归一化文本，便于风险匹配
  const cells = Array.from(tableEl.querySelectorAll('td, th')) as HTMLTableCellElement[];
  cells.forEach((cell) => {
    const text = (cell.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) {
      cell.setAttribute('data-cell-text', text);
    }
  });
});
```

### Change 4：highlightInTableCell 改用 surroundContents 保留 span 结构

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
修改 `highlightInTableCell` 中的 `<mark>` 包裹逻辑：
- 当 startNode 和 endNode 是同一个文本节点时，用 `range.surroundContents(mark)` 包裹（不会拆碎父 span）。
- 当跨节点时，仍用 `extractContents`，但给 `<mark>` 显式设置 `white-space: pre-wrap` 继承原 span 行为。

**Why**：
- `surroundContents` 要求 Range 完整包含一个元素，不会拆碎父 span，保留 `pre-wrap` 约束。
- 跨节点情况给 mark 加 `white-space: pre-wrap` 兜底，避免 mark 内部文本失去约束。

**How**：

```typescript
const range = document.createRange();
range.setStart(startNode, startOffset);
range.setEnd(endNode, endOffset);

try {
  // 同一文本节点内：用 surroundContents 保留父 span 结构
  if (startNode === endNode) {
    range.surroundContents(mark);
  } else {
    // 跨节点：extractContents 但给 mark 加 pre-wrap 继承
    mark.style.whiteSpace = 'pre-wrap';
    const contents = range.extractContents();
    mark.appendChild(contents);
    range.insertNode(mark);
  }
} catch (e) {
  console.warn('[highlightInTableCell] wrap failed', risk.riskId, e);
  return false;
}
return true;
```

## Assumptions & Decisions

1. **box-shadow 不占盒模型空间**：这是 CSS 规范保证的，`box-shadow: inset` 不影响布局计算。
2. **table-layout: fixed 严格按 colgroup 分配列宽**：这是 HTML 标准，fixed 布局忽略内容宽度，只看 colgroup 和第一行。
3. **surroundContents 在单节点内安全**：当 Range 完整包含一个文本节点的一部分时，`surroundContents` 会把这部分文本用 mark 包裹，不会拆碎父元素。
4. **保留 Word 原表格边框**：移除 `border: 1px solid #d9d9d9 !important` 后，docx-preview 从 `<w:tblBorders>` 解析的真实边框会生效，更接近 Word 原文。
5. **PDF 表格不在范围内**：PDF 用 pdf.js 渲染，不受此修改影响。

## Verification Steps

1. `npm run build` 无报错。
2. 重新打开含表格的合同，确认表格布局与 Word 原文一致（列宽、边框、底纹）。
3. 触发风险高亮后，**该行布局不再错乱**（内容不再挤到第一列）。
4. 风险行有清晰的视觉标识（box-shadow 左右边框 + 半透明背景）。
5. "质保金比例偏低"风险高亮位于正确行（第 5 行"质保期满（24 个月） 5%"）。
6. 点击风险卡片能滚动到对应表格行。

## Out of Scope

- 不修改后端表格解析逻辑。
- 不修改 AI 返回 `originalText` 格式。
- 不处理 PDF 表格样式。
- 不实现表格单元格合并的精确还原（依赖 docx-preview 自身能力）。
- 不修改 `preprocessTableOriginalText` 和 `highlightInTableRow` 的匹配逻辑（已在上次修复中过滤短候选词）。
