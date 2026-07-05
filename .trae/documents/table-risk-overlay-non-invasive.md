# 表格风险展示改用非侵入式覆盖层方案

## 背景

经过 4-5 轮修复（`highlightRowBackground` box-shadow/outline、mark 盒模型归零、surroundContents、移除 td width、data attribute CSS），每次修复后表格仍然会错乱。

**核心问题总结**：
1. 我对 docx-preview 渲染的表格做了过多修改（`table-layout: fixed`、`width: 100%`、移除 td width、`word-break: keep-all`、`overflow: hidden`）—— 破坏了 Word 原布局，特别是列宽不等的表格。
2. 只要在表格 DOM 上做任何标记（即使是纯 data attribute），结合 docx-preview 复杂的内联样式表，都会不可预测地触发布局问题。

**方案**：尊重 docx-preview 的原渲染，**不对表格做任何 CSS/DOM 修改**。风险展示改为在表格上方叠加一个**透明的绝对定位层**，通过 getBoundingClientRect 定位风险格子。

## 当前记录状态

所有表格相关的修改存在于 `ContractTextView.tsx` 的两个位置：

1. **`renderAsync().then()`**（约 1039-1080 行）—— docx-preview 渲染完成后的后处理：
   - 注入 `writing-mode: horizontal-tb` 的 CSS
   - 强制 `table-layout: fixed`、`width: 100%`
   - 给每个 td 设置 `overflow: hidden`、`word-break: keep-all`
   - 移除 td 的 width 属性
   - 给 td 打 `data-cell-text` 标记
   - 注入 `td[data-risk-highlight]` 的 CSS

2. **`overlayRisks` 中的 table 分支**（约 538-660 行）—— 风险标注逻辑：
   - `tableMap` 建立 paragraphId → `<table>` 映射
   - `highlightInTableRow` 逐行匹配候选词
   - `highlightInTableCell` 标记 data attribute
   - `highlightRowBackground` 设置 outline

## 新的思路

**完全放弃在表格 DOM 上做任何标记。** 改为：

1. docx-preview 渲染完成后，**不对表格做任何修改**（只保留 `writing-mode: horizontal-tb` 的 CSS）
2. 风险匹配只用于**定位**（确定风险落在哪个表格、哪一行、哪一列）
3. 风险视觉展示通过**一个覆盖在表格上方的透明层**实现：
   - 在表格容器上创建 `position: relative` 的包裹元素
   - 根据匹配结果，用 `getBoundingClientRect` 获取对应单元格的位置
   - 在包裹层内按位置创建绝对定位的彩色小标记（如 4px 宽的竖条或小圆点）
   - 标记附着风险 ID，可点击

这样做：
- 表格 DOM 完全不受影响 → 布局不会错乱
- 覆盖层是独立层，不参与表格布局计算
- 视觉上仍然能让用户看到风险在哪个单元格

## 拟变更

### Change 1：完全回滚表格后处理，只保留 writing-mode

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
在 `renderAsync().then()` 中，删除所有对表格 DOM/样式的修改。只保留：
- `writing-mode: horizontal-tb`、`text-orientation: mixed` 的 CSS（修复竖排）
- 给 table 设置 `data-paragraph-id`（用于风险定位）

**删除**：
- `table-layout: fixed`
- `width: 100%`
- 所有 td 的 `overflow`、`word-break`、`width` 修改
- 所有 `data-cell-text` 标记
- 所有 `data-risk-highlight` 的 CSS

**How**：

```typescript
.then(() => {
  // 仅做最轻量的后处理：标记段落 ID 用于风险定位，注入 writing-mode CSS
  const tableParas = paragraphs.filter((p) => p.type === 'table');
  const renderedTables = Array.from(container.querySelectorAll('table'));
  renderedTables.forEach((tableEl, idx) => {
    const para = tableParas[idx];
    if (!para) return;
    tableEl.setAttribute('data-paragraph-id', para.id);
  });

  // 注入 CSS，只修复竖排问题，不做任何布局修改
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

  // 渲染完成后应用风险覆盖层
  if (originalScrollRef.current) {
    applyTableRiskOverlays(originalScrollRef.current, overlayRiskItems, paragraphs, onActivateRisk);
  }
})
```

### Change 2：新增 `applyTableRiskOverlays` 函数——非侵入式覆盖层

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
新增函数 `applyTableRiskOverlays`，用绝对定位层展示表格风险。

**Why**：
完全不修改表格 DOM，避免触发布局重算。

**How**：

```typescript
/**
 * 非侵入式表格风险覆盖层：在表格上方叠加透明层，通过 getBoundingClientRect
 * 在对应单元格位置绘制彩色标记。表格 DOM 完全不受影响。
 */
function applyTableRiskOverlays(
  container: HTMLElement,
  risks: RiskOverlayItem[],
  paragraphs: ContractParagraph[],
  onActivateRisk?: (riskId: string) => void,
): void {
  // 清除旧的覆盖层
  container.querySelectorAll('.table-risk-overlay-wrapper').forEach((el) => el.remove());

  // 按 paragraphId 分组风险
  const riskByTable = new Map<string, RiskOverlayItem[]>();
  for (const risk of risks) {
    const para = paragraphs.find((p) => p.id === risk.paragraphId);
    if (para?.type !== 'table') continue;
    const list = riskByTable.get(risk.paragraphId) || [];
    list.push(risk);
    riskByTable.set(risk.paragraphId, list);
  }

  if (riskByTable.size === 0) return;

  // 对每个表格创建覆盖层
  riskByTable.forEach((tableRisks, paraId) => {
    const table = container.querySelector(`table[data-paragraph-id="${paraId}"]`) as HTMLTableElement;
    if (!table) return;

    // 为表格创建包裹层，用于定位覆盖层
    const wrapper = document.createElement('div');
    wrapper.className = 'table-risk-overlay-wrapper';
    wrapper.style.cssText = 'position:relative;display:inline-block;width:100%;';

    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);

    // 创建覆盖层
    const overlay = document.createElement('div');
    overlay.className = 'table-risk-overlay';
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;';
    wrapper.appendChild(overlay);

    // 为每个风险在对应单元格上放置标记
    for (const risk of tableRisks) {
      const cell = findTableCell(table, risk.originalText);
      if (!cell) continue;

      const rect = cell.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      const cfg = RISK_LEVEL_MAP[risk.level];

      // 在单元格左侧或右侧放置一个小竖条
      const marker = document.createElement('div');
      marker.className = `table-risk-marker`;
      marker.setAttribute('data-risk-id', risk.riskId);
      marker.style.cssText = [
        'position:absolute',
        `top:${rect.top - wrapperRect.top}px`,
        `left:${rect.left - wrapperRect.left}px`,
        `width:${rect.width}px`,
        `height:${rect.height}px`,
        `background:${cfg.bg}`,
        `border-left:3px solid ${cfg.color}`,
        'border-radius:2px',
        'pointer-events:auto',
        'cursor:pointer',
        'z-index:11',
      ].join(';');
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        onActivateRisk?.(risk.riskId);
      });
      overlay.appendChild(marker);
    }
  });
}

/** 在表格中找到包含指定文本的单元格 */
function findTableCell(table: HTMLTableElement, search: string): HTMLTableCellElement | null {
  const normSearch = search.replace(/\s+/g, '');
  if (!normSearch) return null;
  const cells = Array.from(table.querySelectorAll('td, th')) as HTMLTableCellElement[];
  // 按行优先遍历，优先匹配最长的单元格内容
  const cellScore = cells
    .map((c) => { 
      const text = c.textContent || '';
      const norm = text.replace(/\s+/g, '');
      const idx = norm.indexOf(normSearch);
      return idx !== -1 ? { cell: c, length: norm.length, idx } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b!.length - a!.length); // 短单元格优先（更精准）
  
  for (const candidate of cellScore) {
    const c = candidate!.cell;
    const fullText = c.textContent || '';
    const normFull = fullText.replace(/\s+/g, '');
    const normSearch2 = search.replace(/\s+/g, '');
    if (normFull.includes(normSearch2)) {
      return c;
    }
  }
  return null;
}
```

### Change 3：移除 overlayRisks 中的 table 分支

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
从 `overlayRisks` 函数中删除 table 段落的特殊处理分支（`if (para?.type === 'table') { ... continue }`），因为 table 风险现在由 `applyTableRiskOverlays` 独立处理。

删除以下代码块：
- `tableMap` 的构建
- table 段落的分支判断
- `highlightInTableRow`、`highlightInTableCell`、`highlightRowBackground` 函数

**Why**：
table 风险展示已完全独立出去，不再需要 `overlayRisks` 中的 table 相关逻辑。

**How**：
删除 `overlayRisks` 函数中从 `const tableElements = ... 到 tableIdx++ }` 的 tableMap 构建，以及 `if (para?.type === 'table') { ... continue }` 分支。

同时删除以下不再需要的函数：
- `highlightInTableRow`
- `highlightRowBackground`
- `preprocessTableOriginalText`

`highlightInTableCell` 保留，但不再被调用，可清理掉。

### Change 4：清理 `RISK_LEVEL_MAP` 导入及相关导入

`RISK_LEVEL_MAP` 仍然在 `applyTableRiskOverlays` 中使用，保持不变。`COLORS` 在结构化视图中使用，也保持不变。

## Assumptions & Decisions

1. **表格 DOM 完全不碰**：这是最核心的原则。任何对表格 DOM 的修改（即使是纯 CSS + data attribute）都可能触发不可预测的浏览器重排。
2. **覆盖层用 absolute 定位**：基于 `getBoundingClientRect` 计算出单元格位置后放置标记。表格内容变化（如缩放）时覆盖层自动跟随？需要处理。解决方案：在 `useEffect` 或 resize 事件中重建覆盖层。
3. **覆盖层的滚动跟随**：表格在滚动容器内，`getBoundingClientRect` 需要相对表格容器的坐标。目前 wrapper 是 `position:relative`，overlay 是 `position:absolute`，相对于 wrapper 定位，滚动会自动跟随。
4. **缩放时重建**：当前 `useState(zoom)` 变化时触发 `overlayRisks` 重新执行，可以在此回调中重建 table overlays。

## Verification Steps

1. `npm run build` 无报错。
2. 打开含"附表一付款计划表"的合同，确认：
   - 表格列宽与 Word 原文一致（不再等宽）
   - 表格边框、底纹与 Word 原文一致
   - 出现风险的单元格有左侧彩色竖条覆盖层标识
   - 整个表格布局**完全不受风险展示影响**
3. 打开含"附表二项目里程碑表"的合同，确认列宽不同不再被等宽破坏。
4. 点击风险覆盖层的竖条，能触发风险激活（右侧风险卡片同步）。
5. 缩放时覆盖层位置跟随正确。