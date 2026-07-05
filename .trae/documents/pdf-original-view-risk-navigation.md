# Plan：PDF 恢复原文格式展示 + 右侧风险定位导航

## 1. Summary

当前 PDF 合同预览被简化为结构化段落视图（纯文本），失去了原始 PDF 的排版格式。用户明确要求：

1. PDF 必须按原格式展示（保留分页、字体、表格等真实排版）。
2. PDF 原文上必须有风险标识（背景色 + 字体色 + 下划线），且不能破坏 PDF 布局。
3. 右侧风险卡片点击后，PDF 自动滚动并定位到对应风险原文。
4. 删除顶部容易误导的「重试加载原文」按钮。
5. DOCX 现有风险高亮方式保持不变。

本计划将重新启用 `pdf.js` 渲染 PDF 原格式页面；风险标识通过给 text layer 中匹配到的文本 span 添加内联样式实现（不包裹、不移动 DOM），从而避免之前 overlay/提取文本导致的错位和布局破坏。

## 2. Current State Analysis

- `src/features/review/ContractTextView.tsx`
  - 是合同原文渲染的核心组件，当前支持 `docx` / `pdf` / `error` / 结构化 fallback 四种状态。
  - DOCX 路径：`renderAsync` 渲染 + `overlayRisks` 包裹 `<mark>` + `applyTableRiskOverlays` 处理表格，工作正常。
  - PDF 路径：当前 Effect 直接 `setUseFallback(true)`，完全放弃 pdf.js 渲染，导致 PDF 显示为纯文本段落视图。
  - 工具栏左侧有一个「重试加载原文」按钮，在 `useFallback === true` 时显示。
  - `useImperativeHandle` 暴露了 `scrollToParagraph` 和 `scrollToTop`，用于父组件滚动定位。

- `src/pages/ReviewDetailPage.tsx`
  - 通过 `contractRef` 调用 `scrollToParagraph(risk.paragraphId)` 实现右侧风险卡片点击后的中栏滚动。
  - RiskCard 组件已有 `onActivate` 回调，点击卡片会调用 `handleActivateRisk`。

- 依赖
  - `pdfjs-dist` 仍在 `package.json` 中，可直接重新使用。
  - 之前的 pdf.js canvas + overlay 方案已被移除，需要重新编写一个更稳定的渲染逻辑（只渲染页面，不做覆盖层）。

## 3. Proposed Changes

### 3.1 删除「重试加载原文」按钮

**文件**：`src/features/review/ContractTextView.tsx`

**位置**：工具栏左侧 Space 中 `useFallback && (...)` 的条件渲染块（当前约第 977-981 行）。

**操作**：删除整个条件渲染块。

**理由**：该按钮在 PDF 场景下会误导用户点击后期待「原文格式」，但当前点击后只会重新进入 loading → fallback 的循环。删除后，PDF 直接用原格式渲染，fallback 仅在真正失败时自动出现。

### 3.2 恢复 PDF 原格式渲染

**文件**：`src/features/review/ContractTextView.tsx`

**位置**：PDF Effect（当前约第 948-955 行）。

**操作**：

1. 重新引入 `pdfjs-dist`：
   ```ts
   import * as pdfjs from 'pdfjs-dist';
   import PdfWorker from 'pdfjs-dist/build/pdf.worker.min?worker';
   pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
   ```
   或采用当前项目已有的 worker 引入方式（需按实际构建验证）。

2. 在 PDF Effect 中：
   - 读取 `pdfBlobRef.current`。
   - 使用 `pdfjs.getDocument({ data: arrayBuffer }).promise` 加载 PDF。
   - 循环 `1..numPages`，对每一页：
     - 创建 `pageDiv`（带 `data-page-index`）。
     - 创建 canvas，按 viewport scale 渲染页面。
     - 创建 textLayer div，使用 `page.getTextContent()` 获取文本 items，生成与 canvas 对齐的透明文本 span。
     - 将 pageDiv 追加到 `pdfContainerRef.current`。
   - 渲染失败时：`setOriginalState({ mode: 'error', message: 'PDF 渲染失败' })` 并 `setUseFallback(true)`。

3. textLayer 渲染完成后，调用新的 `highlightPdfRisks` 函数：
   - 遍历所有风险，按 `paragraphId` 和 `originalText` 在 textLayer span 中定位文本。
   - 对匹配到的 span（可能连续多个）直接添加内联样式：`background`、`color`、`border-bottom`。
   - 为 span 添加 `data-risk-id` 和 `click` 事件，点击后触发 `onActivateRisk`。
   - 完全不使用 `range.extractContents()`，不包裹 mark，不移动 DOM 节点，只修改样式属性（触发 repaint，不触发 reflow）。

**理由**：之前失败的根本原因是 `overlayRisks` 用 `range.extractContents()` 提取文本并插入单个 `<mark>`，破坏了 pdf.js text layer 的 span 布局和坐标。本次改为只修改 span 的内联样式，不移动节点、不修改布局属性，因此不会导致文字错位或聚集。

### 3.3 实现 PDF 风险高亮与点击交互

**文件**：`src/features/review/ContractTextView.tsx`

**位置**：新增 `highlightPdfRisks` 函数，在 PDF textLayer 渲染完成后调用。

**操作**：

1. 新增 `highlightPdfRisks(container, risks, paragraphs, onActivateRisk)` 函数：
   - 清除旧的高亮样式（恢复 span 原始样式）。
   - 构建段落到页码/文本范围的索引，便于按 `paragraphId` 限定搜索范围。
   - 对每个风险：
     - 在对应页面的 textLayer span 中，按 `originalText` 顺序匹配连续 span。
     - 对匹配到的每个 span 直接设置 `style.background`、`style.color`、`style.borderBottom`，并添加 `data-risk-id`、`data-risk-level` 属性。
     - 为 span 绑定一次性 click 事件（通过 `dataset.riskHighlightBound` 去重），点击时调用 `onActivateRisk(riskId)`。
   - 匹配不到时记录 warn，不影响其他风险显示。

2. 在 PDF Effect 渲染全部页面后调用 `highlightPdfRisks`。

**理由**：只修改 span 内联样式，不移动 DOM 节点，不触发 reflow，能最大程度保持 pdf.js text layer 的原有布局稳定。

### 3.4 右侧风险卡片点击联动 PDF 定位

**文件**：`src/features/review/ContractTextView.tsx`、`src/pages/ReviewDetailPage.tsx`

**位置**：`ContractTextViewHandle` 接口、`useImperativeHandle`、`ReviewDetailPage.handleActivateRisk`。

**操作**：

1. 扩展接口：
   ```ts
   export interface ContractTextViewHandle {
     scrollToParagraph: (paragraphId: string) => void;
     scrollToRisk: (riskId: string) => void;
     scrollToTop: () => void;
   }
   ```

2. 实现 `scrollToRisk(riskId: string)`：
   - 在当前视图（PDF / DOCX / fallback）中查找带 `data-risk-id="{riskId}"` 的元素。
   - PDF 场景：找到已高亮的 textLayer span，调用 `scrollIntoView({ block: 'center' })`，并临时加深高亮样式作为定位提示。
   - DOCX / fallback 场景：回退到查找 `mark[data-risk-id]` 或调用 `scrollToParagraph`。

3. 修改 `ReviewDetailPage.handleActivateRisk`：
   ```ts
   const handleActivateRisk = useCallback((riskId: string) => {
     setActiveRiskId(riskId);
     const r = risks.find((x) => x.id === riskId);
     if (!r) return;
     if (contractRef.current?.scrollToRisk) {
       contractRef.current.scrollToRisk(riskId);
     } else {
       contractRef.current?.scrollToParagraph(r.paragraphId);
     }
     setTimeout(() => {
       document.getElementById(`risk-card-${riskId}`)?.scrollIntoView({ block: 'start' });
     }, 60);
   }, [risks]);
   ```

**理由**：父组件统一调用 `scrollToRisk`，由 ContractTextView 根据当前渲染模式决定如何定位；PDF 模式下直接滚动到已高亮的 span。

### 3.5 保留 DOCX 现有高亮与结构化 fallback

**文件**：`src/features/review/ContractTextView.tsx`

**操作**：

- DOCX Effect 及其 `overlayRisks` / `applyTableRiskOverlays` 调用保持不变。
- 结构化 fallback 视图（`useFallback || originalState.mode === 'error'`）保持不变，继续作为 DOCX/PDF 渲染失败后的兜底。
- 当 PDF 渲染失败时，自动进入 fallback，不再显示「重试加载原文」按钮。

**理由**：DOCX 的高亮方案已经稳定工作，不应因 PDF 改动而受影响；fallback 是必要容错。

## 4. Assumptions & Decisions

| 决策点 | 选择 | 理由 |
|--------|------|------|
| PDF 风险高亮方式 | 修改 textLayer span 内联样式（背景色 + 字体色 + 下划线） | 只修改样式不移动 DOM，不触发 reflow，避免之前 extractContents 破坏布局 |
| 风险与 PDF 原文的关联 | 渲染时自动给匹配 span 上色 + 右侧卡片点击滚动定位 | 既满足原文上可见标识，又支持从列表快速定位 |
| PDF 定位搜索策略 | 按 `originalText` 在 textLayer span 中搜索 | 不依赖 PDF 内部坐标，只依赖文本内容，容错性高 |
| 失败处理 | 自动降级到结构化段落视图 | 保持现有 fallback 机制，确保任何情况下都能看内容 |
| 重试按钮 | 删除 | 当前按钮无实际意义，且容易误导用户 |
| DOCX 高亮 | 保持不变 | 现有方案稳定，用户未要求改动 |

## 5. Verification Steps

1. 构建检查：
   ```bash
   npm run build
   ```

2. 打开一个 PDF 合同的审核详情页：
   - 确认中栏显示原始 PDF 页面（有分页、灰色背景、canvas 渲染）。
   - 确认顶部不再显示「重试加载原文」按钮。
   - 确认可以正常缩放/滚动 PDF。

3. PDF 风险高亮与交互：
   - 打开 PDF 合同后，确认原文中风险文字带有背景色 + 字体色 + 下划线标识。
   - 点击任意风险卡片，确认 PDF 自动滚动到对应风险文字位置。
   - 点击 PDF 中已标识的风险文字，确认右侧对应风险卡片被激活并滚动到视图。

4. 失败降级：
   - 模拟 PDF 渲染失败（如断网或文件损坏）。
   - 确认自动切换到结构化段落视图。

5. DOCX 合同回归：
   - 打开一个 DOCX 合同。
   - 确认风险 mark 高亮仍然精确。
   - 确认点击风险卡片仍正常滚动。
