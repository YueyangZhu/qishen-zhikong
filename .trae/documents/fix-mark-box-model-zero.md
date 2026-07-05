# 彻底修复表格风险高亮导致行错乱（mark 盒模型归零）

## Summary

用户反馈：表格中"出现风险的行"内容仍然挤到第一列。前几次修复（box-shadow 替代 border、移除 word-break 注入、table-layout:fixed、surroundContents）虽然方向正确，但 mark 元素本身仍带有 `padding:1px 3px`、`border-bottom:2px solid`、`border-radius`，这些盒模型属性会让被高亮的 inline 文字略微撑大，在 `table-layout: fixed` 下虽然列宽不变，但被高亮单元格内容可能溢出，视觉上仍像"挤到第一列"。

同时，用户在 Render 公网部署环境查看，可能存在浏览器缓存或 Render 部署未完成的情况。

本计划做**最彻底的修复**：让 `<mark>` 完全不影响布局——纯 `display: inline`、无 padding、无 border、无 border-radius，仅用 `background-color` 和 `color` 标识风险。同时给所有 td 加 `overflow: hidden` 兜底防止内容溢出影响视觉。

## Current State Analysis

### 当前 mark 样式（问题点）

**文件**：`src/features/review/ContractTextView.tsx` 第 450-459 行

```typescript
mark.style.cssText = [
  `background:${cfg.bg}`,
  `color:${cfg.color}`,
  `border-bottom:2px solid ${cfg.color}`,   // ← border 占盒模型空间
  'padding:1px 3px',                         // ← padding 占盒模型空间
  'border-radius:2px',
  'cursor:pointer',
  'font-weight:500',
  'transition:all 0.15s',
].join(';');
```

### 为什么"只有出现风险的行错乱"

- 其他行没有 `<mark>`，单元格内文本在 docx-preview 原生 `span { white-space: pre-wrap }` 约束下正常显示。
- 出现风险的行：单元格内插入了 `<mark>`，其 `padding:1px 3px` 和 `border-bottom:2px solid` 让被高亮文字的 inline-box 在水平和垂直方向都变大。
- 在 `table-layout: fixed` 下，列宽虽然不会被重算，但被高亮单元格的**内容宽度**可能超出单元格宽度，触发浏览器对整个表格的重新排版（特别是 `border-collapse: collapse` 模式下，相邻单元格的 border 重叠规则会因内容溢出而变化）。
- 同时 `surroundContents` 虽然不拆碎 span，但 mark 被插入到 span 内部后，mark 自身的 padding/border 仍会让该 span 的内容区扩大。

## Proposed Changes

### Change 1：mark 样式彻底归零，纯 inline 不占盒模型空间

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
重写 `highlightInTableCell` 中 mark 的 cssText，移除所有可能影响盒模型的属性：
- 移除 `padding`
- 移除 `border-bottom`
- 移除 `border-radius`
- 显式设置 `display: inline`（防止浏览器默认 inline-block）
- 显式设置 `box-sizing: border-box`（即使有 border 也不影响内容区）
- 显式设置 `line-height: inherit`（不改变行高）
- 仅保留 `background-color` 和 `color` 作为视觉标识
- 用 `text-decoration: underline` 替代 `border-bottom` 做下划线（text-decoration 不占盒模型空间）

**Why**：
- `padding` 和 `border` 是盒模型属性，会让 inline 元素的占用空间变大，可能触发内容溢出和排版重算。
- `text-decoration: underline` 是绘制行为，不占盒模型空间。
- `display: inline` 是 mark 的默认值，但显式声明防止其他 CSS 覆盖。

**How**：

```typescript
mark.style.cssText = [
  'display:inline',
  'background:' + cfg.bg,
  'color:' + cfg.color,
  'text-decoration:underline',
  'text-decoration-color:' + cfg.color,
  'text-decoration-thickness:2px',
  'text-underline-offset:2px',
  'cursor:pointer',
  'font-weight:500',
  'line-height:inherit',
  'box-sizing:border-box',
  'transition:color 0.15s, background 0.15s',
].join(';');
```

### Change 2：给所有 td 增加 overflow:hidden 兜底

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
在表格后处理循环中，给每个 td/th 增加 `overflow: hidden` 和 `text-overflow: clip`，防止任何情况下内容溢出影响其他列。

**Why**：
- 即使 mark 不占盒模型空间，极端情况下（如长串无换行字符）仍可能溢出。
- `overflow: hidden` 让单元格成为 BFC，内部内容溢出不会影响相邻单元格。

**How**：

```typescript
cells.forEach((cell) => {
  const text = (cell.textContent || '').replace(/\s+/g, ' ').trim();
  if (text) {
    cell.setAttribute('data-cell-text', text);
  }
  // 兜底：防止内容溢出影响其他列
  const c = cell as HTMLElement;
  c.style.overflow = 'hidden';
  c.style.wordBreak = 'keep-all';  // 保持词组完整，不任意断字
});
```

注意：`word-break: keep-all` 不同于之前的 `break-word`，它保持中文词组完整，仅在词组间换行，不会让最小内容宽度骤降。

### Change 3：highlightRowBackground 也用纯背景色，移除 box-shadow

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
虽然 box-shadow 不占盒模型空间，但为了最彻底的保险，改为仅设置 `outline`（outline 不占盒模型空间）做行级标识。

**Why**：
- `outline` 是绘制在 border 外侧的，完全不参与盒模型计算，不影响布局。
- 比 `box-shadow` 更语义化，专门用于视觉标识。

**How**：

```typescript
function highlightRowBackground(row: HTMLTableRowElement, level: RiskItem['riskLevel']) {
  const cfg = RISK_LEVEL_MAP[level];
  row.querySelectorAll('td, th').forEach((cell) => {
    const el = cell as HTMLElement;
    // outline 不占盒模型空间，完全不影响布局
    el.style.outline = `2px solid ${cfg.color}`;
    el.style.outlineOffset = '-2px';  // 内缩，避免超出单元格
  });
}
```

## Assumptions & Decisions

1. **mark 的 padding 和 border 是当前布局错乱的最后元凶**：移除后应该彻底解决。
2. **text-decoration 不占盒模型空间**：这是 CSS 规范保证的。
3. **outline 不占盒模型空间**：这是 CSS 规范保证的，比 box-shadow 更安全。
4. **word-break: keep-all 不会让最小内容宽度骤降**：它保持词组完整，只在词组间换行。
5. **如果 Render 部署未完成或浏览器缓存**：用户可能看到的是旧代码，建议无痕模式 + 强制刷新。

## Verification Steps

1. `npm run build` 无报错。
2. 推送 GitHub master。
3. **等 Render 部署完成**（在 Render Dashboard 确认状态为 Live）。
4. 用**无痕模式**打开 `https://qishen-frontend.onrender.com/`（避开缓存）。
5. 打开含表格的合同，确认：
   - 表格布局与 Word 原文一致（列宽、边框、底纹）
   - **出现风险高亮的行不再错乱**（这是核心验证点）
   - 风险行有 outline 标识
   - 风险文字有下划线（text-decoration）和背景色
6. "质保金比例偏低"风险高亮位于正确行。

## Out of Scope

- 不修改后端代码。
- 不修改 AI 返回 originalText 格式。
- 不处理 PDF 表格。
- 不修改 preprocessTableOriginalText 和 highlightInTableRow 的匹配逻辑。
