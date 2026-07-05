# 表格风险展示：恢复单元格底色 + 字体颜色方案

## 背景

用户反馈非侵入式覆盖层方案（commit `c8c9b75`）的两个迭代都不满意：
1. 第一版 marker 覆盖整个单元格 + 不透明背景 → 遮挡表格内容
2. 第二版左上角小圆点 dot → "一个点不够明显突出风险，不好看"

用户明确诉求：**"不能给单元格内容加底色和字体颜色的吗？"** —— 希望恢复单元格底色 + 字体颜色的视觉风格。

## 当前状态分析

### 当前实现（commit `5ceca6d`）

`applyTableRiskOverlays` 函数（ContractTextView.tsx 507-611 行）：
- 创建 wrapper div 包裹 table（position:relative）
- 创建透明 overlay 层（position:absolute，pointer-events:none）
- 对每个风险创建两个元素：
  - **hitArea**：透明点击层，覆盖目标区域，z-index:11
  - **dot**：左上角 10px 圆点角标，z-index:12
- 表格 DOM 完全不修改

### project_memory.md 的"红线"与重新审视

project_memory.md 第 49 行记录：
> 任何对表格 DOM 的修改（即使纯 data attribute）都会触发不可预测的浏览器重排

但分析 8 轮失败的真正根因（来自 session_memory 完整演进）：

| 失败属性 | 触发机制 | 是否触发 reflow |
|----------|----------|----------------|
| `table-layout: fixed` | 强制列宽重算 | ✅ reflow |
| `border`（border-collapse 下）| 列宽重算 | ✅ reflow |
| `width`（td 的）| 覆盖 colgroup | ✅ reflow |
| `white-space` / `word-break` | 影响最小内容宽度 | ✅ reflow |
| `outline` / `box-shadow` | 不占盒模型 | ❌ 只 repaint（之前失败是因同时用了上述属性，归因错误）|
| `background-color` | 不占盒模型 | ❌ 只 repaint |
| `color` | 不占盒模型 | ❌ 只 repaint |
| `dataset` / `classList` | 属性变化 | ❌ 不 reflow |

**核心结论**：之前失败的根本原因是 `table-layout`、`border`、`width`、`white-space` 等会触发 **layout reflow** 的属性。`background-color` 和 `color` 只触发 **repaint**，不触发 reflow，理论上是安全的。

### RISK_LEVEL_MAP 颜色值（src/constants/index.ts 34-71 行）

| 等级 | color | bg | 
|------|-------|-----|
| high | #f5222d | #fff1f0 |
| medium | #fa8c16 | #fff7e6 |
| low | #52c41a | #f6ffed |
| notice | #7c8696 | #f0f5ff |

bg 都是浅色（接近白色），作为底色不会遮挡黑色文字。

### docx-preview 渲染结构

- td 内部有 span 子元素（来自 session_memory 记录：span 带 `white-space: pre-wrap`）
- docx-preview 会把 DOCX run 属性转为 span 的 inline style，**span 可能有 color 样式**
- 因此改字体颜色时，必须同时覆盖 td 和 td 内所有 span 的 color，否则 span 的 color 会覆盖 td 的 color

## 拟变更

### Change 1：移除 dot 小圆点，改为直接给 td 加底色 + 字体颜色

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
修改 `applyTableRiskOverlays` 函数（507-611 行）：
1. 保留 wrapper + overlay + hitArea（点击交互不变，hitArea 透明不遮挡）
2. **移除 dot 圆点元素**（590-605 行）
3. **新增**：给目标单元格/行的 td 直接设置 inline style：
   - `backgroundColor = cfg.bg`（浅色底色）
   - `color = cfg.color`（字体颜色）
   - td 内所有 span 也设 `color = cfg.color`
4. **用 dataset 保存原值**，便于清除时恢复

**Why**：
- `background-color` 和 `color` 只触发 repaint 不触发 reflow，不会导致列宽错乱
- 浅色 bg（如 #fff1f0）不会遮挡黑色文字
- 同时覆盖 td 和 span 的 color，确保字体颜色生效（docx-preview 的 span 可能有 color）

**How**：

```typescript
// 为每个风险在对应单元格/行加底色 + 字体颜色
for (const risk of tableRisks) {
  const target = findTableTarget(table, risk.originalText);
  if (!target) continue;

  const cfg = RISK_LEVEL_MAP[risk.level];

  // 确定要加样式的 td 列表：单单元格匹配 → [td]；行级匹配 → tr 内所有 td
  let tds: HTMLTableCellElement[] = [];
  if (target.tagName === 'TD' || target.tagName === 'TH') {
    tds = [target as HTMLTableCellElement];
  } else if (target.tagName === 'TR') {
    tds = Array.from(target.querySelectorAll('td, th')) as HTMLTableCellElement[];
  }
  if (tds.length === 0) continue;

  // 给每个 td 加底色 + 字体颜色（保存原值便于清除）
  for (const td of tds) {
    // 保存原值（dataset 不触发 reflow）
    td.dataset.riskOrigBg = td.style.backgroundColor || '';
    td.dataset.riskOrigColor = td.style.color || '';
    td.style.backgroundColor = cfg.bg;
    td.style.color = cfg.color;

    // td 内所有 span 也设 color（覆盖 docx-preview 的 span color）
    td.querySelectorAll('span').forEach(span => {
      const s = span as HTMLElement;
      s.dataset.riskOrigColor = s.style.color || '';
      s.style.color = cfg.color;
    });
  }

  // 保留 hitArea 透明点击层（覆盖目标区域，可点击，不遮挡内容）
  const rect = target.getBoundingClientRect();
  const wrapperRect = wrapper.getBoundingClientRect();
  const hitArea = document.createElement('div');
  hitArea.className = 'table-risk-hit-area';
  hitArea.setAttribute('data-risk-id', risk.riskId);
  hitArea.style.cssText = [
    'position:absolute',
    `top:${rect.top - wrapperRect.top}px`,
    `left:${rect.left - wrapperRect.left}px`,
    `width:${rect.width}px`,
    `height:${rect.height}px`,
    'background:transparent',
    'border:0',
    'box-shadow:none',
    'pointer-events:auto',
    'cursor:pointer',
    'z-index:11',
  ].join(';');
  hitArea.addEventListener('click', (e) => {
    e.stopPropagation();
    onActivateRisk?.(risk.riskId);
  });
  overlay.appendChild(hitArea);
}
```

### Change 2：修改清除逻辑，恢复 td 原始样式

**文件**：`src/features/review/ContractTextView.tsx`

**What**：
修改 `applyTableRiskOverlays` 开头的清除逻辑（517-526 行），在移除 wrapper 前，先清除所有被标记 td 的 inline style：

**Why**：
- 直接清空 `style.backgroundColor = ''` 会丢失 docx-preview 的原始值
- 用 dataset 保存的原值恢复，确保 docx-preview 原始样式不丢失

**How**：

```typescript
// 清除旧的覆盖层 + 恢复 td 原始样式
// 1. 先恢复所有被标记 td/span 的原始样式
container.querySelectorAll('[data-risk-orig-bg]').forEach(el => {
  const td = el as HTMLTableCellElement;
  td.style.backgroundColor = td.dataset.riskOrigBg || '';
  td.style.color = td.dataset.riskOrigColor || '';
  delete td.dataset.riskOrigBg;
  delete td.dataset.riskOrigColor;
});
container.querySelectorAll('[data-risk-orig-color]').forEach(el => {
  const span = el as HTMLElement;
  // 排除已被上面 td 逻辑处理过的（td 也有 data-risk-orig-color）
  if (span.tagName === 'SPAN') {
    span.style.color = span.dataset.riskOrigColor || '';
    delete span.dataset.riskOrigColor;
  }
});
// 2. 再移除 wrapper（把 table 从 wrapper 里移出去恢复原 DOM 结构）
container.querySelectorAll('.table-risk-overlay-wrapper').forEach((el) => {
  const wrapper = el as HTMLElement;
  const table = wrapper.querySelector('table');
  if (table) {
    wrapper.parentNode?.insertBefore(table, wrapper);
  }
  wrapper.remove();
});
```

### Change 3：findTableTarget 无需修改

`findTableTarget`（613-652 行）已支持返回 td 或 tr，新方案根据 `target.tagName` 判断处理，无需修改。

## Assumptions & Decisions

### 核心技术假设

1. **`background-color` 和 `color` 只触发 repaint 不触发 reflow**：这是 CSS 标准行为，不参与盒模型计算。之前 8 轮失败的根因是 `table-layout`/`border`/`width`/`white-space` 等会触发 reflow 的属性，不是 background/color。
2. **`dataset` 修改不触发 reflow**：dataset 是 HTML 属性，不是 CSS 属性，不影响布局。
3. **浅色 bg（如 #fff1f0）不遮挡黑色文字**：bg 都是接近白色的浅色，对比度足够。

### 风险控制

1. **绝对不碰**的属性（会触发 reflow）：
   - `table-layout`、`border`、`border-collapse`
   - `width`（td 的）、`white-space`、`word-break`
   - `outline`、`box-shadow`（虽然不触发 reflow，但为彻底隔离，不在 td 上用）
   - `padding`、`margin`
2. **只修改**的属性：`background-color`、`color`（td 和 td 内 span）
3. **原值保存与恢复**：用 dataset 保存，清除时恢复，不丢失 docx-preview 原始样式

### 兜底方案

如果实测仍出现布局问题（概率极低），回退到当前 commit `5ceca6d` 的 dot 方案，并考虑：
- 用覆盖层绘制半透明背景色块（不改 DOM，但无法改字体颜色）
- 或用 CSS `mix-blend-mode: multiply` 在覆盖层上模拟底色效果

## Verification Steps

1. `npm run build` 无报错
2. 打开含"附表一付款计划表"的合同，确认：
   - 出现风险的单元格/行有**浅色底色**（如高风险为浅红色 #fff1f0）
   - 风险单元格的**文字颜色**变为对应等级色（如高风险为 #f5222d 红色）
   - 表格列宽/边框/底纹保持 Word 原布局，**不出现挤到第一列的问题**
   - 表格内容完全可见，不遮挡
3. 点击风险单元格，能触发右侧风险卡片联动
4. 切换风险状态（接受/忽略），表格底色和字体颜色正确更新
5. 切换合同后，旧表格的 td 样式已清除恢复原状
