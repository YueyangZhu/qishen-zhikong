# 修复表格风险定位错位与样式不一致问题

## Summary

用户反馈两个问题：
1. **表格风险定位错位**：风险"质保金比例偏低"的 `originalText` 是整行 "5 质保期满（24 个月） 5% 140,000.00 质保金"，对应表格第 5 行，但高亮跑到了第 4 行第 3 列的 "25%" 单元格。
2. **表格样式与 Word 原文不一致**：重建后的表格丢失原表格列宽、对齐、边框、颜色等样式。

本计划将修复：
- 表格风险匹配算法：优先整行精确匹配，候选词加入最小长度约束（≥ 4 个非空白字符）并避免纯数字/百分比短词作为独立候选。
- 表格重建逻辑：从 docx-preview 渲染出的原 table 中提取 `col` 宽度、`style` 属性、`className`、边框/背景色等可迁移样式，应用回新 table。

## Current State Analysis

### 问题 1 根因：候选词拆分导致短词误匹配

**文件**：`src/features/review/ContractTextView.tsx`

- `preprocessTableOriginalText`（第 339-349 行）把风险原文拆成多个候选词：
  - 输入：`"5 质保期满（24 个月） 5% 140,000.00 质保金"`
  - 候选词列表：`["5 质保期满（24 个月） 5% 140,000.00 质保金", "5", "质保期满（24", "个月）", "5%", "140,000.00", "质保金"]`
- `highlightInTableRow`（第 444-458 行）逐行扫描，对每个候选词在每个单元格里调用 `highlightInTableCell`。
- `highlightInTableCell` 用 `cellText.indexOf(search)` 做子串匹配。
- 当扫描到第 4 行 "25%" 单元格时，候选词 `"5%"` 是 `"25%"` 的子串，`indexOf("5%")` 返回 1，于是把 "5%" 高亮在了错误的单元格。
- 正确匹配项（整行文本）在单元格里找不到完整字符串，因为单元格是分散的；但短候选词先命中了错误位置。

### 问题 2 根因：重建 table 时未保留原样式

**文件**：`src/features/review/ContractTextView.tsx`（第 971-1008 行）

当前逻辑：
- docx-preview 渲染后，找到所有 `<table>`，按顺序用 `tableData` 重建。
- 重建时把原 table 的 `innerHTML` 清空，重新生成 `tbody/tr/th/td`。
- 新单元格写死了统一样式：`width:100%`、`border-collapse:collapse`、`table-layout:fixed`、边框 `#d9d9d9`、背景 `#fafafa` 等。
- 没有读取原 table 的列宽（`<col>` / `width`）、单元格对齐、背景色、边框粗细/颜色、字体等。
- 因此样式和 Word 原文差异明显。

## Proposed Changes

### Change 1：修复表格风险匹配算法

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
修改 `preprocessTableOriginalText` 和 `highlightInTableRow`：
1. 候选词按长度过滤：只保留长度 ≥ 4 的非空白字符（避免 `"5%"`、`"5"` 等短词）。
2. 候选词排序：优先用完整整行文本匹配；完整文本失败后再 fallback 到长片段。
3. 在行内匹配时：优先精确匹配完整候选词；只有当候选词长度 ≥ 6 且不含纯数字/百分比时才允许子串命中（避免 `"5%"` 命中 `"25%"`）。
4. 高亮命中后应高亮**包含该风险的整行**或**完整单元格**，让用户一眼看到风险所在行，而不是只高亮一个短子串。

**Why**：
- 短子串（如 `"5%"`）在表格中重复概率高，极易误匹配。
- 用户期望看到风险行被整体标识出来，而不是一个孤零零的 "5%" 高亮。

**How**：

```typescript
function preprocessTableOriginalText(search: string): string[] {
  // 去除 markdown 表格符号
  let cleaned = search.replace(/\|\s*-{2,}\s*\|/g, ' ').replace(/\|/g, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  // 候选 1：整行文本（最优先）
  const candidates: string[] = [cleaned];

  // 候选 2：按空格拆分为长度 >= 4 的片段，避免 "5%"、"5" 等短词误匹配
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && !/^\d+%?$/.test(t));

  // 候选 3：相邻片段组合成长片段，优先长匹配
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j <= Math.min(i + 3, tokens.length); j++) {
      const combined = tokens.slice(i, j).join(' ');
      if (combined.length >= 4 && !candidates.includes(combined)) {
        candidates.push(combined);
      }
    }
  }

  return candidates;
}
```

```typescript
function highlightInTableRow(
  row: HTMLTableRowElement,
  searchCandidates: string[],
  risk: RiskOverlayItem,
  onActivateRisk?: (riskId: string) => void,
): boolean {
  const cells = Array.from(row.querySelectorAll('td, th')) as HTMLTableCellElement[];
  const rowText = cells.map((c) => c.textContent || '').join(' ').replace(/\s+/g, ' ').trim();

  for (const candidate of searchCandidates) {
    // 优先：整行文本包含完整候选词 → 高亮该行所有单元格（或关键单元格）
    if (candidate.length >= 6 && rowText.includes(candidate)) {
      let highlightedAny = false;
      cells.forEach((cell) => {
        if (highlightInTableCell(cell, candidate, risk, onActivateRisk, true)) {
          highlightedAny = true;
        }
      });
      if (highlightedAny) return true;
    }

    // fallback：单元格内匹配
    for (const cell of cells) {
      if (highlightInTableCell(cell, candidate, risk, onActivateRisk, false)) {
        return true;
      }
    }
  }
  return false;
}
```

```typescript
function highlightInTableCell(
  cell: HTMLTableCellElement,
  search: string,
  risk: RiskOverlayItem,
  onActivateRisk?: (riskId: string) => void,
  allowPartial = false,
): boolean {
  const cellText = cell.textContent || '';
  const normCell = cellText.replace(/\s+/g, '');
  const normSearch = search.replace(/\s+/g, '');

  let idx = -1;

  if (cellText.includes(search)) {
    idx = cellText.indexOf(search);
  } else if (normCell.includes(normSearch)) {
    // 归一化匹配
    let origIdx = 0;
    let ni = 0;
    while (ni < normCell.indexOf(normSearch)) {
      if (!/\s/.test(cellText[origIdx])) ni++;
      origIdx++;
    }
    idx = origIdx;
  } else if (allowPartial && search.length >= 6 && normCell.includes(search.replace(/\s+/g, ''))) {
    // 允许部分匹配，但仅对较长候选
  } else {
    return false;
  }

  // ... 后续 mark 包裹逻辑不变
}
```

实际实现时会更精炼，但核心原则：
- 过滤掉过短候选（< 4 字符）和纯数字/百分比（`/^\d+%?$/`）。
- 优先长候选、整行匹配。
- 命中后如果候选能覆盖整行，则整行高亮；否则高亮单个单元格。

### Change 2：保留原表格样式

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
在重建 table 时，先读取 docx-preview 原 table 的以下样式信息并迁移：
1. table 级别：`width`、`border`、`border-collapse`、`margin`、`font-size`、`color`、`background`。
2. col 宽度：读取原 table 的 `<col>` 元素 `width` 属性，按列设置到新 table 的 `colgroup`。
3. 单元格级别：读取每个原 `td/th` 的 `style.width`、`style.textAlign`、`style.verticalAlign`、`style.backgroundColor`、`style.color`、`style.fontWeight`、`style.border`，应用回新单元格。
4. 表头识别：若原表头有 `backgroundColor` 或 `fontWeight`，保留；否则仍按第 0 行作为表头兜底。

**Why**：
- 让重建后的表格在视觉上尽可能接近 Word 原文。
- 用户明确对比了 Word 截图，说明对样式还原有要求。

**How**：

```typescript
renderedTables.forEach((oldTable, idx) => {
  const para = tableParas[idx];
  if (!para?.tableData) return;

  // 1. 提取原 table 的 <col> 宽度
  const colWidths: (string | null)[] = [];
  oldTable.querySelectorAll('col').forEach((col) => {
    colWidths.push(col.getAttribute('width') || col.style.width || null);
  });

  // 2. 提取原单元格样式矩阵
  const oldRows = Array.from(oldTable.querySelectorAll('tr'));
  const oldStyles: CSSStyleDeclaration[][] = oldRows.map((tr) =>
    Array.from(tr.querySelectorAll('td, th')).map((cell) => getComputedStyle(cell as HTMLElement)),
  );

  // 3. 重建 tbody
  const newTbody = document.createElement('tbody');
  para.tableData.forEach((row, rowIdx) => {
    const tr = document.createElement('tr');
    row.forEach((cellText, colIdx) => {
      const cellEl = document.createElement(rowIdx === 0 ? 'th' : 'td');
      cellEl.textContent = cellText || '';

      // 默认样式
      cellEl.style.border = '1px solid #d9d9d9';
      cellEl.style.padding = '6px 10px';
      cellEl.style.whiteSpace = 'normal';
      cellEl.style.wordBreak = 'break-word';
      cellEl.style.lineHeight = '1.6';

      // 迁移原样式
      const oldStyle = oldStyles[rowIdx]?.[colIdx];
      if (oldStyle) {
        if (oldStyle.width && oldStyle.width !== 'auto') cellEl.style.width = oldStyle.width;
        if (oldStyle.textAlign && oldStyle.textAlign !== 'start') cellEl.style.textAlign = oldStyle.textAlign;
        if (oldStyle.verticalAlign) cellEl.style.verticalAlign = oldStyle.verticalAlign;
        if (oldStyle.backgroundColor && oldStyle.backgroundColor !== 'rgba(0,0,0,0)') cellEl.style.backgroundColor = oldStyle.backgroundColor;
        if (oldStyle.color && oldStyle.color !== 'rgb(0,0,0)') cellEl.style.color = oldStyle.color;
        if (oldStyle.fontWeight && oldStyle.fontWeight !== '400') cellEl.style.fontWeight = oldStyle.fontWeight;
      }

      tr.appendChild(cellEl);
    });
    newTbody.appendChild(tr);
  });

  // 4. 清空并重建，保留 table 自身的 class/width
  const tableClass = oldTable.className;
  const tableWidth = oldTable.style.width || oldTable.getAttribute('width');
  oldTable.innerHTML = '';
  if (colWidths.some(Boolean)) {
    const colgroup = document.createElement('colgroup');
    colWidths.forEach((w) => {
      const col = document.createElement('col');
      if (w) col.style.width = w;
      colgroup.appendChild(col);
    });
    oldTable.appendChild(colgroup);
  }
  oldTable.appendChild(newTbody);
  if (tableClass) oldTable.className = tableClass;
  if (tableWidth) oldTable.style.width = tableWidth;
  oldTable.style.borderCollapse = 'collapse';
  oldTable.style.tableLayout = 'fixed';
  oldTable.setAttribute('data-paragraph-id', para.id);
});
```

### Change 3：整行高亮增强可见性

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
当风险原文能匹配到一整行（如 "5 质保期满（24 个月） 5% 140,000.00 质保金" 这样的整行拼接文本）时，给该行所有单元格添加一个轻量背景高亮（如该行所有单元格背景变为风险等级的浅色），而不仅仅是单元格内文字上的 mark。

**Why**：
- 用户一眼能看到风险所在行。
- 避免"只高亮一个 5%"这种让人困惑的情况。

**How**：
在 `highlightInTableRow` 返回 true 前，给该行所有 `td/th` 设置一个细左边框或背景色样式（与风险等级一致，但要浅）。

```typescript
function highlightRowBackground(row: HTMLTableRowElement, level: RiskItem['riskLevel']) {
  const cfg = RISK_LEVEL_MAP[level];
  row.querySelectorAll('td, th').forEach((cell) => {
    (cell as HTMLElement).style.backgroundColor = cfg.bg;
    (cell as HTMLElement).style.borderLeft = `3px solid ${cfg.color}`;
  });
}
```

注意：这个背景高亮只在整行匹配时应用；单元格级匹配时不应用，避免过度渲染。

## Assumptions & Decisions

1. **整行匹配优先**：后端解析的 `tableData` 行内单元格顺序与 Word 原文一致，行内用空格拼接后可与 AI 返回的 `originalText` 对齐。
2. **候选词过滤策略**：
   - 长度 < 4 的候选词丢弃。
   - 纯数字或纯百分比（如 "5%"、"20%"、"140,000.00"）不作为独立候选词。
   - 这些短/纯数字片段只作为整行文本的一部分参与匹配。
3. **样式迁移限制**：`getComputedStyle` 返回的是计算后的 rgba 颜色，可能和 Word 原文不完全一致，但能接近。合并单元格、竖排文字等极端复杂格式仍可能不完全还原。
4. **只处理 DOCX 表格**：PDF 表格用 pdf.js 渲染，不在本计划范围内。

## Verification Steps

1. `npm run build` 无报错。
2. 重新上传含付款计划表的 DOCX 合同，触发新 AI 审核。
3. 确认表格样式（列宽、对齐、边框、表头背景）更接近 Word 原文。
4. 找到"质保金比例偏低"风险，确认高亮位于第 5 行（"质保期满（24 个月） 5%" 所在行），而不是第 4 行 "25%"。
5. 点击风险卡片，原文自动滚动到对应表格行。

## Out of Scope

- 不修改后端 `pdf_service.py` 的表格解析逻辑。
- 不修改 AI 返回 `originalText` 的内容格式。
- 不处理 PDF 表格样式。
- 不实现表格单元格合并的精确还原（docx-preview 已丢失该信息）。
