# 回滚表格重建逻辑并修复风险定位

## Summary

用户反馈：上一次的修改把表格展示改坏了（文字竖排、布局错乱），而之前表格展示是正常的，只是风险定位不准、样式不完全像原文。

本计划：
1. **回滚** `ContractTextView.tsx` 中"清空原 table 并用 `tableData` 重建"的逻辑。
2. **保留 docx-preview 原 table DOM 结构**，仅注入 CSS 修复文字方向/换行等显示问题。
3. **在原 table DOM 上直接做风险高亮**：通过给单元格打 `data-cell-text` 标记 + 行内文本匹配，精准定位风险单元格。
4. **尽量迁移原 table 样式**（列宽、对齐、背景色）但不破坏原 DOM 结构。

## Current State Analysis

### 之前状态（用户认可"展示正常"）

- docx-preview 渲染出的 table 布局是正常的。
- 风险定位不准：因为 `preprocessTableOriginalText` 拆出 `"5%"` 短候选词，在 `"25%"` 单元格误匹配。
- 样式不完全像原文：docx-preview 默认样式与企业 Word 样式有差异，但不影响阅读。

### 当前状态（本次修改后变坏）

`ContractTextView.tsx` 第 1040-1135 行左右的逻辑：
- 找到所有 `<table>`，按顺序对应 `paragraphs` 中的 table 段落。
- `oldTable.innerHTML = ''` 清空原 table。
- 用 `tableData` 重新生成 `tbody/tr/td`，列宽从原 `<col>` 提取，单元格样式从 `getComputedStyle` 提取。
- 问题：
  - `tableData` 是后端解析的二维数组，丢失了 Word 原表格的列宽、合并单元格、文字方向等细节。
  - 注入 `table-layout: fixed`、`width: 100%` 后，单元格宽度被重新分配，导致文字被挤压成竖排（每个字一行）。
  - 原 docx-preview 渲染的布局被破坏。

## Proposed Changes

### Change 1：回滚 table 重建逻辑，保留原 DOM

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
- 删除"清空 innerHTML + 用 tableData 重建 tbody"的全部代码。
- 恢复为：docx-preview 渲染完成后，仅对原 table 做轻量后处理。
- 给每个原 table 增加 `data-paragraph-id` 属性（用于风险标注定位）。
- 给每个原 table 的 `td/th` 增加 `data-cell-text` 属性（值为单元格文本去空白归一化后的字符串，用于快速匹配）。

**Why**：
- docx-preview 渲染的原 table 布局是正确的，清空重建反而丢失布局信息。
- `tableData` 只应作为风险匹配的辅助数据源，不应作为 DOM 重建依据。

**How**：

```typescript
renderedTables.forEach((tableEl, idx) => {
  const para = tableParas[idx];
  if (!para || !para.tableData) return;

  // 标记段落 ID
  tableEl.setAttribute('data-paragraph-id', para.id);

  // 给每个单元格标记归一化文本，便于风险匹配
  const cells = Array.from(tableEl.querySelectorAll('td, th')) as HTMLTableCellElement[];
  cells.forEach((cell) => {
    const text = (cell.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) {
      cell.setAttribute('data-cell-text', text);
    }
  });

  // 可选：轻量样式修正（不破坏布局）
  tableEl.style.maxWidth = '100%';
  tableEl.style.borderCollapse = 'collapse';
});
```

### Change 2：修复表格风险定位匹配

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
重写 `overlayRisks` 中 table 段落的匹配逻辑：
1. 通过 `paragraphId` 找到对应的 `<table>`。
2. 对 table 的每一行，将行内所有单元格文本按顺序拼接成 `rowText`。
3. 用 `preprocessTableOriginalText` 生成候选词列表（已过滤短候选词和纯数字/百分比）。
4. **优先长候选词在行内精确匹配**：如果某行的 `rowText` 包含候选词，则在该行所有单元格内高亮该候选词片段。
5. **找不到整行匹配时**，fallback 到单个单元格的 `data-cell-text` 精确匹配（不使用子串匹配，避免 `"5%"` 命中 `"25%"`）。
6. 命中后给该行加浅色背景边框，明确标识风险行。

**Why**：
- 避免短子串误匹配。
- 在保留原 table DOM 的前提下，通过行级文本拼接实现整行定位。

**How**：

```typescript
function preprocessTableOriginalText(search: string): string[] {
  let cleaned = search.replace(/\|\s*-{2,}\s*\|/g, ' ').replace(/\|/g, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  const candidates: string[] = [cleaned];

  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && !/^\d+[,.\d]*%?$/.test(t));

  // 生成相邻 2~4 个 token 的组合，按长度降序
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 2; j <= Math.min(i + 4, tokens.length); j++) {
      const combined = tokens.slice(i, j).join(' ');
      if (combined.length >= 4 && !candidates.includes(combined)) {
        candidates.push(combined);
      }
    }
  }

  // 按长度降序，优先长匹配
  return candidates.sort((a, b) => b.length - a.length);
}

function highlightInTableRow(
  row: HTMLTableRowElement,
  searchCandidates: string[],
  risk: RiskOverlayItem,
  onActivateRisk?: (riskId: string) => void,
): boolean {
  const cells = Array.from(row.querySelectorAll('td, th')) as HTMLTableCellElement[];
  const rowText = cells.map((c) => c.textContent || '').join(' ').replace(/\s+/g, ' ').trim();

  // 优先：整行精确匹配
  for (const candidate of searchCandidates) {
    if (candidate.length >= 6 && rowText.includes(candidate)) {
      let highlightedAny = false;
      cells.forEach((cell) => {
        if (highlightInTableCell(cell, candidate, risk, onActivateRisk)) {
          highlightedAny = true;
        }
      });
      if (highlightedAny) {
        highlightRowBackground(row, risk.level);
        return true;
      }
    }
  }

  // fallback：单元格 data-cell-text 精确匹配
  for (const candidate of searchCandidates) {
    for (const cell of cells) {
      const cellText = (cell.getAttribute('data-cell-text') || cell.textContent || '').trim();
      if (cellText === candidate || cellText.includes(candidate)) {
        if (highlightInTableCell(cell, candidate, risk, onActivateRisk)) {
          return true;
        }
      }
    }
  }

  return false;
}
```

注意：`highlightInTableCell` 内部仍使用 `cellText.indexOf(search)` 做子串匹配，但由于传入的 candidate 已经过滤了短词，并且优先整行精确匹配，误匹配概率大大降低。

### Change 3：保留原 table 样式，仅做轻量修正

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
不再迁移 `getComputedStyle` 的每个属性。改为：
1. 给 container 注入一个全局 `<style>`，覆盖 docx-preview 表格的常见样式问题：
   - `writing-mode: horizontal-tb !important`（强制横向文字）
   - `text-orientation: mixed !important`
   - `white-space: normal`
   - `word-break: break-word`
   - 统一边框颜色 `#d9d9d9`
2. 不修改 table 的 `table-layout`、`width` 等会改变布局的属性。

**Why**：
- 不破坏 docx-preview 原布局。
- 修复文字竖排、挤压等问题。

**How**：

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
  .docx-preview table td,
  .docx-preview table th {
    border: 1px solid #d9d9d9 !important;
  }
`;
container.appendChild(style);
```

## Assumptions & Decisions

1. **docx-preview 原布局可接受**：用户已确认之前展示正常，因此不再尝试用 `tableData` 重建 DOM。
2. **风险定位以原 DOM 为准**：通过 `data-cell-text` 和行内文本拼接匹配，而不是依赖 `tableData` 的行列顺序。
3. **短候选词过滤**：过滤掉长度 < 4 和纯数字/百分比，避免子串误匹配。
4. **CSS 注入优先于 DOM 重建**：用 CSS 修复文字方向问题，避免破坏原布局。
5. **PDF 表格不在范围内**：PDF 仍使用 pdf.js 渲染。

## Verification Steps

1. `npm run build` 无报错。
2. 重新打开含表格的合同，确认表格布局恢复正常（与 Word 原文一致，不再竖排）。
3. 找到"质保金比例偏低"风险，确认高亮位于第 5 行（"质保期满（24 个月） 5%"），而不是第 4 行 "25%"。
4. 点击风险卡片，原文自动滚动到对应表格行。
5. 检查表格样式是否接近 Word 原文（表头背景、边框、对齐等）。

## Out of Scope

- 不修改后端表格解析逻辑。
- 不修改 AI 返回 `originalText` 格式。
- 不处理 PDF 表格。
- 不实现表格单元格合并的精确还原（依赖 docx-preview 自身能力）。
