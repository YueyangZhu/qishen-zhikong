# Plan：修复 PDF 原格式渲染 textLayer 错乱问题

## 1. Summary

上一次实现虽然重新启用了 `pdf.js` 渲染 PDF，但因为**没有引入 pdf.js 配套的 `pdf_viewer.css`**，`textLayer` 中的 span 缺少 `position: absolute`、`color: transparent`、CSS 变量（`--total-scale-factor` 等）等关键样式，导致所有文字按默认 inline flow 堆叠、重复显示、与 canvas 图像错位，页面呈现"全乱了"的效果。

本计划将引入 pdf.js 的 viewer CSS，修复 textLayer 渲染；同时调整 PDF 上的风险高亮样式为「背景色块 + 下划线」，避免改字体色造成的 canvas/textLayer 重影；并在 PDF 渲染失败时给出明确提示文案，再自动降级到结构化段落视图。

## 2. Current State Analysis

- `src/features/review/ContractTextView.tsx`
  - 已重新实现 PDF 渲染 Effect：加载 PDF → 逐页 canvas 绘制 → 创建 `div.textLayer` → `new pdfjs.TextLayer(...).render()` → 高亮风险。
  - **问题 1：未引入 pdf.js CSS**。`TextLayer.render()` 依赖 `pdf_viewer.css` 中的 `.textLayer` 和 `.textLayer span` 样式（`position: absolute`、`color: transparent`、CSS 变量等），否则 span 无法正确定位，造成文字堆叠、重复、错位。
  - **问题 2：高亮样式改动了 `color`**。当前 `highlightPdfRisks` 给 span 设置了 `color: cfg.color`，会与 canvas 上的原文字叠加产生重影。
  - **问题 3：失败兜底缺少提示文案**。当前 PDF Effect 在 catch 中仅设置 `mode: 'error'` 并 fallback，没有向用户展示"已切换为段落视图"的提示。

- `src/main.tsx`
  - 当前没有全局引入 pdf.js 的 CSS。

- `package.json`
  - `pdfjs-dist` 已安装，`web/pdf_viewer.css` 可用。

## 3. Proposed Changes

### 3.1 全局引入 pdf.js viewer CSS

**文件**：`src/main.tsx`

**操作**：在入口文件顶部加入：
```ts
import 'pdfjs-dist/web/pdf_viewer.css';
```

**理由**：这是让 `TextLayer.render()` 正确工作的必要条件，提供 `.textLayer`、`.textLayer span` 所需的定位、透明文字、CSS 变量等样式。

**冲突评估**：`pdf_viewer.css` 中的样式大多为带 class 的 viewer 组件样式（如 `.messageBar`、`.toolbar`），不会直接影响 Ant Design 组件；`.textLayer` 样式仅作用于 class 为 `textLayer` 的容器，影响范围可控。

### 3.2 调整 PDF 风险高亮样式（不重影）

**文件**：`src/features/review/ContractTextView.tsx`

**位置**：`highlightPdfRisks` 函数内的样式设置逻辑。

**操作**：
- 移除 `span.style.color = cfg.color;`，避免与 canvas 原文字重影。
- 保留并调整 `span.style.backgroundColor`：使用风险等级对应的半透明背景色（`cfg.bg`，如 `#fff1f0`），让 PDF 原文字透过背景色可见。
- 保留 `span.style.borderBottom = 2px solid ${cfg.color};` 作为风险下划线标识。
- 保留 `span.style.fontWeight = '500';` 让文字略微加粗（实际视觉由 canvas 提供，textLayer 透明，该属性影响较小，可保留）。
- 临时定位提示（scrollToRisk / activeRiskId Effect 中）同样只加深背景色，不改字体色。

**理由**：PDF 是 canvas 图像层 + 透明 textLayer 双层结构。textLayer 默认 `color: transparent`，只用于选择和搜索。若强行设置 color，会在 canvas 原文字之上再叠一层彩色文字，产生重影/模糊。背景色块和下划线既能标识风险，又不会破坏原文字显示。

### 3.3 修复 PDF 渲染失败时的用户提示

**文件**：`src/features/review/ContractTextView.tsx`

**位置**：PDF Effect 的 catch 块。

**操作**：
```ts
} catch (e) {
  console.error('[ContractTextView] PDF 渲染失败:', e);
  if (!cancelled) {
    message.warning('PDF 原格式加载失败，已自动切换为文本段落视图');
    setOriginalState({ mode: 'error', message: 'PDF 原格式加载失败' });
    setUseFallback(true);
  }
}
```

**理由**：用户明确要求"渲染失败，不能按照原格式展示时，需要有提示文案告知用户"。

### 3.4 清理/验证 PDF 容器样式

**文件**：`src/features/review/ContractTextView.tsx`

**位置**：PDF Effect 中 `pageDiv` 与 `textLayerDiv` 的内联样式。

**操作**：
- 保留 `pageDiv` 的 `position: 'relative'`、`margin: '0 auto 16px'`、`width/height` 与 canvas 一致。
- `textLayerDiv` 的 className 保持为 `'textLayer'`，移除冗余的内联 `position/left/top/width/height/overflow` 样式（`pdf_viewer.css` 已定义 `position: absolute; inset: 0; overflow: clip`）。
  - 或保留内联样式作为兜底，二者不冲突。

**理由**：既然引入了 pdf_viewer.css，应让 CSS 负责 textLayer 基础布局，减少内联样式的维护负担。

### 3.5 回归验证 DOCX 与结构化 fallback

**文件**：`src/features/review/ContractTextView.tsx`

**操作**：
- 确认 DOCX Effect 的 `overlayRisks` / `applyTableRiskOverlays` 不受本次改动影响（它们不操作 PDF textLayer）。
- 确认 `useFallback` 为 true 时仍渲染结构化段落视图。

**理由**：确保修复 PDF 的同时不破坏已稳定的 DOCX 路径。

## 4. Assumptions & Decisions

| 决策点 | 选择 | 理由 |
|--------|------|------|
| PDF textLayer 错乱根因 | 缺少 `pdfjs-dist/web/pdf_viewer.css` | `TextLayer.render()` 生成的 span 依赖该 CSS 中的定位与 CSS 变量 |
| PDF 风险标识样式 | 背景色块 + 下划线，不改字体色 | 避免 textLayer 彩色文字与 canvas 原文字重影 |
| 提示文案 | `message.warning('PDF 原格式加载失败，已自动切换为文本段落视图')` | 用户明确要求失败时告知 |
| CSS 引入方式 | 在 `main.tsx` 全局 import | 最简单可靠，viewer CSS 主要为 class 限定，污染风险低 |
| 兜底策略 | 自动降级到结构化段落视图 | 用户已确认接受 |

## 5. Verification Steps

1. 构建检查：
   ```bash
   npm run build
   ```

2. 打开一个 PDF 合同的审核详情页：
   - 确认 PDF 页面正常显示，文字、表格、分页与真实 PDF 一致，不再堆叠/重复。
   - 确认 textLayer 文字可被鼠标选中（说明透明文字层已正确定位在 canvas 上方）。

3. PDF 风险高亮：
   - 确认风险文字区域有半透明背景色块 + 彩色下划线。
   - 确认没有彩色重影文字覆盖在 PDF 原文字上。
   - 点击右侧风险卡片，确认 PDF 滚动到对应风险位置并临时加深背景色提示。

4. 失败提示：
   - 模拟 PDF 加载失败（如断网、损坏文件）。
   - 确认页面顶部出现 Ant Design `warning` 提示："PDF 原格式加载失败，已自动切换为文本段落视图"。
   - 确认随后显示结构化段落视图。

5. DOCX 回归：
   - 打开一个 DOCX 合同。
   - 确认风险 mark 高亮、表格高亮仍然精确，无样式异常。
