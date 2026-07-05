# 合并原文格式与风险标注 + 图片表格参与风险识别

## Summary

用户希望：
1. 将「结构化视图」和「原文格式」合并为统一视图——直接加载文件原文格式展示，风险标注叠加在原文上，Word 和 PDF 都要支持，风险定位要准。
2. 原文中的图片和表格内容也要参与风险规则判断（当前图片完全跳过、表格仅传摘要给 AI）。

## Current State Analysis

### 前端视图（`src/features/review/ContractTextView.tsx`）
- 当前有两种视图，通过 `viewMode` 切换：
  - **结构化视图**：渲染 `paragraphs` 数组，body 段落单独渲染 clauseNo/clauseTitle 头部 + 去重后的正文文本，表格渲染为 HTML table，图片渲染为 `<img>`。风险高亮通过 `splitSegments(text, highlights)` 按字符位置叠加 `<mark>`。**风险定位准确**，但不是原文排版。
  - **原文格式视图**：DOCX 用 `docx-preview`（`renderAsync`）渲染原文件 DOM；PDF 用 `<iframe src=blob-url>` 浏览器原生渲染；HTML 用 `<iframe srcDoc>`。**是原文排版**，但没有风险标注叠加。
- `paraRiskMap`：按 `paragraphId` 分组风险，记录 `riskId/start/end/level`。
- `scrollToParagraph`：通过 `querySelector('[data-paragraph-id=...]')` 定位段落。

### 后端文档解析（`backend/app/services/pdf_service.py`）
- DOCX：`python-docx` 提取文本/表格/图片，`mammoth` 转 HTML。
- PDF：`pdfplumber` 提取文本/表格，`PyMuPDF(fitz)` 提取图片。
- 统一输出 `ContractParagraph` 模型：`id/index/text/type/clauseNo/clauseTitle/tableData/imageData/imageFormat`。
- 段落类型：`title/header/body/signature/table/image`。
- **图片**：`text` 字段存 `[图片]` 占位符，无 OCR，无内容识别。
- **表格**：`text` 字段存每行拼接的摘要文本，`tableData` 存完整二维数组。

### 规则引擎（`backend/app/services/rule_service.py`）
- `keyword_match`：**显式跳过 `image` 和 `table` 类型段落**（`if ptype in ('image', 'table'): continue`），只用 body/header/title/signature 的文本做关键词缺失检测。
- 缺失类规则：关键词不在全文 → 触发，用 `_find_target_paragraph` 定位到相关章节。

### AI 审核（`backend/app/services/prompt_service.py` + `ai_service.py`）
- `build_risk_review_prompt`：`contract_text = "\n".join(f"[段落ID:{p.id} 编号:{p.index}] {p.text}" for p in paragraphs)`。
- 表格段落的 `p.text` 是摘要（每行拼接），AI 看不到表格结构。
- 图片段落的 `p.text` 是 `[图片]`，AI 看不到图片内容。
- 无 OCR 能力。

## Proposed Changes

### 决策：采用「原文渲染 + 文本匹配叠加风险」方案

**为什么不用「增强结构化视图」替代原文？**
- 用户明确要求「展示是原文」，需要保留原文排版（字体、加粗、表格样式、页眉页脚等）。
- 结构化视图无法保留原文的富文本格式。

**为什么不用「pdf.js / docx-preview + 段落ID 映射」？**
- docx-preview 渲染的 DOM 没有 paragraphId 标记，无法直接按段落定位。
- PDF iframe 内部无法注入 DOM。

**选定方案**：在原文渲染（docx-preview / pdf.js）完成后，通过**文本匹配**在渲染出的 DOM 文本节点中找到风险原文，用 Range API 包裹 `<mark>` 叠加风险标注。

---

### Part 1：统一为原文视图 + 风险叠加（前端）

#### 修改文件：`src/features/review/ContractTextView.tsx`

**1.1 移除视图切换，统一为原文视图**
- 删除 `viewMode` state 和 `Button.Group` 切换按钮。
- 始终使用原文格式渲染（DOCX → docx-preview，PDF → pdf.js，HTML → iframe）。
- 保留 `fontSize` 调整、下载、返回顶部工具栏按钮。
- 结构化视图的 `ParagraphItem` 渲染逻辑保留为降级兜底（当原文加载失败时使用）。

**1.2 PDF 改用 pdf.js 渲染（替代 iframe）**
- 安装 `pdfjs-dist` 依赖。
- 用 `pdfjs.getDocument()` 加载 PDF blob，逐页渲染为 `<canvas>` + 文本层（`TextLayer`）。
- 文本层的 `<span>` 包含实际文本内容，且位置与 canvas 对齐，可在上面叠加风险高亮。
- 配置 `workerSrc` 指向 `pdfjs-dist/build/pdf.worker.min.js`。

**1.3 DOCX 保持 docx-preview 渲染**
- 现有 `renderAsync` 逻辑不变，渲染后得到带原文样式的 DOM。

**1.4 风险叠加核心逻辑（新增 `overlayRisks` 函数）**

渲染完成后（docx-preview 或 pdf.js text layer ready），执行：
```
1. 用 TreeWalker 遍历渲染容器内所有文本节点
2. 拼接成 fullDomText，记录每个字符对应的 (textNode, offset)
3. 对每个风险：
   a. 取 risk.originalText（风险原文片段）
   b. 在 fullDomText 中搜索 originalText（先精确匹配，失败则做空白归一化后匹配）
   c. 找到后用 Range API 选中该范围，surroundContents 包裹 <mark class="risk-highlight" data-risk-id="...">
   d. 应用风险等级对应的背景色/边框/点击事件
4. 若 originalText 匹配失败，在渲染容器顶部显示风险 badge 列表（点击定位到最近段落）
```

**匹配消歧策略**：
- 同一原文可能出现多次。用 `risk.paragraphId` 对应的段落文本先在 DOM 中定位段落大致区域，再在该区域内匹配 originalText。
- 段落定位：取 `paragraphs.find(p => p.id === risk.paragraphId).text`，在 fullDomText 中找到该段落文本的位置，再在其范围内搜索 originalText。

**1.5 章节导航联动调整**
- `scrollToParagraph`：原文视图下，通过匹配段落文本在 DOM 中定位，`scrollIntoView({ block: 'start' })`。
- 左栏章节点击仍只定位正文，不联动风险筛选（保持当前解耦逻辑）。

**1.6 激活风险高亮联动**
- 当 `activeRiskId` 变化时，找到对应的 `<mark data-risk-id="...">`，添加 `active` 样式（boxShadow），并 `scrollIntoView`。

---

### Part 2：图片 OCR（前端 Tesseract.js）

**为什么用前端 OCR？**
- 后端 Render 部署安装 Tesseract 系统依赖复杂，用户无开发经验。
- `tesseract.js` 纯前端运行，支持中文（`chi_sim`），无需后端改动。

#### 修改文件：`src/features/review/ContractTextView.tsx` 或新建 `src/utils/ocr.ts`
- 安装 `tesseract.js` 依赖。
- 加载合同时，对所有 `type === 'image'` 的段落执行 OCR：
  - 将 base64 imageData 转为 canvas/blob
  - `Tesseract.recognize(blob, 'chi_sim+eng')` 获取文本
  - 将 OCR 文本存入 `para.ocrText` 字段（新增）

#### 修改文件：`src/pages/ReviewDetailPage.tsx` / `src/services/reviewService.ts`
- 提交审核时，把 `ocrText` 随段落数据一起发给后端。

#### 修改文件：`backend/app/schemas/review.py`
- `ContractParagraph` 新增 `ocrText: Optional[str] = None` 字段。

#### 修改文件：`backend/app/services/rule_service.py`
- `keyword_match` 中，对 `image` 类型段落不再直接跳过：
  - 如果 `para.ocrText` 非空，将 OCR 文本加入 `full_text` 参与关键词缺失检测
  - 如果 `ocrText` 为空，仍跳过

#### 修改文件：`backend/app/services/prompt_service.py`
- `build_risk_review_prompt`：对 image 段落，如果 `ocrText` 非空，用 `[段落ID:{p.id} 编号:{p.index}] [图片内容] {p.ocrText}` 替代 `[图片]` 占位符。

---

### Part 3：表格参与风险识别（后端）

#### 修改文件：`backend/app/services/rule_service.py`
- `keyword_match` 中，对 `table` 类型段落不再跳过：
  - 将 `tableData` 所有单元格文本拼接，加入 `full_text` 参与关键词缺失检测
  - `_find_target_paragraph` 中，table 段落也纳入候选定位段落

#### 修改文件：`backend/app/services/prompt_service.py`
- `build_risk_review_prompt`：对 table 段落，用 markdown 表格格式传递：
  ```
  [段落ID:{p.id} 编号:{p.index}] 表格内容：
  | 表头1 | 表头2 |
  |-------|-------|
  | 值1   | 值2   |
  ```
  替代当前的摘要文本，让 AI 能看到完整表格结构。

---

### Part 4：清理

- 移除 `viewMode` 相关逻辑和 UI。
- 移除 `Segmented` / `Button.Group` 视图切换组件。
- `ParagraphItem` 保留为降级兜底（原文渲染失败时使用），但不再作为主视图。
- 移除 `originalState` 中的 `html` 模式（mammoth iframe），统一用 docx-preview/pdf.js。

---

## Assumptions & Decisions

- **决策：PDF 改用 pdf.js 渲染**。原因：浏览器原生 PDF iframe 无法注入风险标注 DOM；pdf.js 提供 text layer 可供文本匹配叠加。代价：增加 `pdfjs-dist` 依赖（~1MB），但可按需懒加载。
- **决策：DOCX 保持 docx-preview**。原因：已集成且效果良好，渲染后 DOM 可直接做文本匹配。
- **决策：图片 OCR 用前端 tesseract.js**。原因：Render 后端安装 Tesseract 系统依赖复杂，前端方案零后端部署成本。代价：大图 OCR 较慢（2-5 秒），异步执行不阻塞渲染。
- **决策：风险叠加用文本匹配而非段落ID映射**。原因：docx-preview/pdf.js 渲染的 DOM 没有段落ID标记，文本匹配是唯一可行方案。用段落文本预定位 + originalText 精确匹配两步法降低误匹配率。
- **决策：保留结构化视图作为降级兜底**。原因：原文渲染或文本匹配可能失败（扫描版 PDF、加密文档等），需要兜底保证可用性。
- **假设**：`pdfjs-dist` 兼容当前 Vite + React 构建环境。
- **假设**：`tesseract.js` 的 Web Worker 在浏览器中正常加载（需配置 workerPath）。

## Verification Steps

1. **DOCX 原文 + 风险叠加**：上传 DOCX 合同，确认显示原文排版（字体/表格/图片），风险原文处有彩色 `<mark>` 高亮，点击高亮可激活右侧风险卡片。
2. **PDF 原文 + 风险叠加**：上传 PDF 合同，确认 pdf.js 渲染原文页面，风险原文处有高亮标注。
3. **图片 OCR**：上传含图片的合同，确认图片段落 OCR 完成（控制台日志可见），OCR 文本参与规则匹配（图片中的关键词能触发缺失检测）。
4. **表格识别**：上传含表格的合同，确认表格段落参与规则关键词匹配，AI prompt 中表格以 markdown 格式传递。
5. **章节导航**：左栏章节点击 → 正文定位到对应位置（原文视图中通过文本匹配定位）。
6. **降级兜底**：模拟原文加载失败，确认降级到结构化视图，风险高亮仍正常。
7. `npm run build` 无报错。
8. 推送至 GitHub master。
