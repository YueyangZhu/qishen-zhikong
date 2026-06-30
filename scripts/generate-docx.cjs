/**
 * 生成 PRD Word 文档：包含全部文字内容 + 12 张截图嵌入
 * 用法：node scripts/generate-docx.cjs
 * 输出：docs/契审智控_PRD需求文档_V2.0.docx
 */
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ImageRun,
  PageBreak, PageOrientation, convertInchesToTwip,
} = require('docx');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHOT_DIR = path.join(ROOT, 'docs', 'screenshots');
const OUTPUT = path.join(ROOT, 'docs', '契审智控_PRD需求文档_V2.0.docx');

// ============= 辅助函数 =============

/** 读取截图（返回 ArrayBuffer） */
function readImage(name) {
  const file = path.join(SHOT_DIR, `${name}.png`);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file);
}

/** 创建段落 */
function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, ...opts })],
    spacing: { after: 80 },
  });
}

/** 创建标题 */
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, bold: true, size: 32, color: '1677ff' })],
    spacing: { before: 320, after: 160 },
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true, size: 26, color: '1d2129' })],
    spacing: { before: 280, after: 140 },
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, bold: true, size: 22, color: '1d2129' })],
    spacing: { before: 200, after: 100 },
  });
}

function h4(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_4,
    children: [new TextRun({ text, bold: true, size: 20, color: '5b6470' })],
    spacing: { before: 160, after: 80 },
  });
}

/** 普通段落 */
function para(text) {
  return new Paragraph({
    children: [new TextRun({ text, size: 20 })],
    spacing: { after: 100, line: 320 },
  });
}

/** 加粗段落 */
function bold(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 20 })],
    spacing: { after: 80 },
  });
}

/** 项目符号项 */
function bullet(text, level = 0) {
  return new Paragraph({
    children: [new TextRun({ text, size: 20 })],
    bullet: { level },
    spacing: { after: 60 },
  });
}

/** 引用块（左缩进 + 灰色背景感） */
function quote(text) {
  return new Paragraph({
    children: [new TextRun({ text, italics: true, size: 18, color: '5b6470' })],
    indent: { left: 360 },
    spacing: { before: 80, after: 120 },
  });
}

/** 分页符 */
function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

/** 创建表格单元格 */
function cell(text, opts = {}) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: String(text), size: 18, bold: opts.bold, color: opts.color })],
      alignment: opts.align || AlignmentType.LEFT,
    })],
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.bg ? { fill: opts.bg } : undefined,
  });
}

/** 创建简单表格 */
function makeTable(headers, rows, widths) {
  const headerRow = new TableRow({
    children: headers.map((h, i) => cell(h, { bold: true, bg: 'f0f5ff', width: widths?.[i] })),
    tableHeader: true,
  });
  const bodyRows = rows.map((r) => new TableRow({
    children: r.map((c, i) => cell(c, { width: widths?.[i] })),
  }));
  return new Table({
    rows: [headerRow, ...bodyRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'e8ecf0' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'e8ecf0' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'e8ecf0' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'e8ecf0' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'e8ecf0' },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'e8ecf0' },
    },
  });
}

/** 插入截图（宽度自适应） */
function image(name, width = 540) {
  const data = readImage(name);
  if (!data) {
    return para(`[截图缺失：${name}.png]`);
  }
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new ImageRun({
      data,
      type: 'png',
      transformation: { width, height: Math.round(width * 900 / 1440) },
    })],
    spacing: { before: 120, after: 120 },
  });
}

/** 截图说明（居中灰色小字） */
function caption(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, size: 16, italics: true, color: '8c8c8c' })],
    spacing: { after: 200 },
  });
}

// ============= 文档内容构建 =============

const children = [];

// === 封面 ===
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [new TextRun({ text: '', size: 48 })],
  spacing: { before: 2400, after: 240 },
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [new TextRun({ text: '契审智控', bold: true, size: 64, color: '1677ff' })],
  spacing: { after: 120 },
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [new TextRun({ text: 'AI 采购合同审核平台', bold: true, size: 36, color: '13c2c2' })],
  spacing: { after: 480 },
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [new TextRun({ text: 'PRD 需求规格说明书', size: 32, color: '1d2129' })],
  spacing: { after: 120 },
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [new TextRun({ text: 'V2.0', size: 28, color: '5b6470' })],
  spacing: { after: 960 },
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [new TextRun({ text: '编写日期：2026-06-29', size: 22, color: '5b6470' })],
  spacing: { after: 80 },
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [new TextRun({ text: '状态：第一阶段已实现', size: 22, color: '52c41a' })],
  spacing: { after: 80 },
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [new TextRun({ text: '适用范围：AI 产品经理求职作品集展示与项目交接说明', size: 22, color: '5b6470' })],
  spacing: { after: 80 },
}));
children.push(pageBreak());

// === 目录 ===
children.push(h1('目录'));
children.push(para('一、产品概述'));
children.push(para('二、角色与权限'));
children.push(para('三、统一规范'));
children.push(para('四、页面清单与路由'));
children.push(para('P01 登录页'));
children.push(para('P02 工作台'));
children.push(para('P03 合同审核列表'));
children.push(para('P04 新建审核任务'));
children.push(para('P05 审核处理进度页'));
children.push(para('P06 合同信息字段确认页'));
children.push(para('P07 合同审核详情页（核心）'));
children.push(para('P08 法务复核页'));
children.push(para('P09 审核报告列表'));
children.push(para('P10 审核报告详情'));
children.push(para('P11 审核记录'));
children.push(para('P12 风险规则库'));
children.push(para('五、核心业务状态机'));
children.push(para('六、数据一致性约束'));
children.push(para('七、演示主流程'));
children.push(pageBreak());

// === 一、产品概述 ===
children.push(h1('一、产品概述'));

children.push(h2('1.1 产品定位'));
children.push(para('契审智控是一款面向企业采购合同审核场景的 AI 辅助审核平台。系统融合规则引擎与大模型语义分析，覆盖合同解析、字段抽取、风险识别、原文定位、修改建议、人工确认、法务复核、报告生成的完整闭环。'));

children.push(h2('1.2 核心业务流程'));
children.push(para('上传合同 → 文档解析 → 字段抽取 → 规则引擎检查 → AI 语义审核 → 风险原文定位 → 生成风险说明与修改建议 → 业务人员逐条处理 → 提交法务复核 → 法务确认 → 生成审核报告 → 审核记录留档'));

children.push(h2('1.3 当前阶段边界'));
children.push(makeTable(
  ['已实现', '暂未实现'],
  [
    ['本地可交互前端 Demo（12 个页面）', '真实大模型 API 接入'],
    ['完整业务闭环演示', '真实 Supabase 后端'],
    ['高质量 Mock 数据层 + localStorage 持久化', '真实鉴权（Mock 登录）'],
    ['端到端 23 步演示流程', '扫描 PDF OCR'],
    ['浏览器打印导出 PDF', 'Word 红线修订'],
    ['角色切换、数据重置', '电子签章 / 复杂审批流'],
  ],
  [50, 50]
));

children.push(h2('1.4 系统免责声明'));
children.push(quote('本系统审核结果由 AI 辅助生成，仅供合同初审参考，不构成正式法律意见，最终结论应由专业人员确认。'));
children.push(para('免责声明在以下位置展示：'));
children.push(bullet('登录页底部黄色提示框'));
children.push(bullet('全局左侧导航底部'));
children.push(bullet('审核进度页底部'));
children.push(bullet('审核报告详情页底部'));
children.push(pageBreak());

// === 二、角色与权限 ===
children.push(h1('二、角色与权限'));

children.push(h2('2.1 角色定义'));
children.push(makeTable(
  ['角色', '标识', '演示账号', '主要职责'],
  [
    ['采购业务人员', 'purchaser', 'purchaser@qszk.com / 123456', '发起审核、处理风险、提交复核'],
    ['法务审核人员', 'legal', 'legal@qszk.com / 123456', '法务复核、修改建议、出具结论'],
    ['系统管理员', 'admin', 'admin@qszk.com / 123456', '全部权限 + 规则库管理'],
  ],
  [22, 18, 30, 30]
));

children.push(h2('2.2 权限矩阵'));
children.push(makeTable(
  ['功能', 'purchaser', 'legal', 'admin'],
  [
    ['工作台', '✅', '✅', '✅'],
    ['新建审核', '✅', '❌', '❌'],
    ['查看审核列表', '✅', '✅（菜单名「合同复核」）', '✅'],
    ['风险处理（接受/编辑/忽略）', '✅', '❌', '❌'],
    ['提交法务复核', '✅', '❌', '❌'],
    ['法务复核操作', '❌', '✅', '❌'],
    ['生成报告', '✅', '✅', '✅'],
    ['规则库管理', '❌', '✅', '✅'],
    ['角色切换', '✅', '✅', '✅'],
  ],
  [40, 20, 20, 20]
));
children.push(pageBreak());

// === 三、统一规范 ===
children.push(h1('三、统一规范'));

children.push(h2('3.1 设计 Token'));
children.push(makeTable(
  ['Token', '色值', '用途'],
  [
    ['primary', '#1677ff', '主色，专业蓝'],
    ['ai', '#13c2c2', 'AI 辅助色，青绿'],
    ['bg', '#f5f7fa', '页面背景，浅灰白'],
    ['high', '#f5222d', '高风险，红'],
    ['medium', '#fa8c16', '中风险，橙'],
    ['low', '#52c41a', '低风险，绿'],
    ['notice', '#8c8c8c', '提示项，蓝灰'],
  ],
  [20, 30, 50]
));

children.push(h2('3.2 风险等级映射'));
children.push(makeTable(
  ['等级', '标签', '颜色', '背景'],
  [
    ['high', '高风险', '#f5222d', '#fff1f0'],
    ['medium', '中风险', '#fa8c16', '#fff7e6'],
    ['low', '低风险', '#52c41a', '#f6ffed'],
    ['notice', '提示项', '#8c8c8c', '#fafafa'],
  ],
  [20, 25, 25, 30]
));

children.push(h2('3.3 审核任务状态映射'));
children.push(makeTable(
  ['状态', '标签', '颜色'],
  [
    ['draft', '草稿', 'default'],
    ['parsing', '解析中', 'processing'],
    ['ai_reviewing', 'AI审核中', 'processing'],
    ['pending_business', '待人工确认', 'warning'],
    ['pending_legal', '待法务复核', 'warning'],
    ['completed', '已完成', 'success'],
    ['failed', '失败', 'error'],
  ],
  [30, 30, 40]
));

children.push(h2('3.4 风险处理状态映射'));
children.push(makeTable(
  ['状态', '标签', '颜色'],
  [
    ['pending', '待处理', 'default'],
    ['accepted', '已接受', 'success'],
    ['edited', '已编辑', 'processing'],
    ['ignored', '已忽略', 'default'],
    ['manual_review', '转人工', 'warning'],
    ['confirmed', '已确认', 'success'],
  ],
  [30, 30, 40]
));
children.push(pageBreak());

// === 四、页面清单与路由 ===
children.push(h1('四、页面清单与路由'));
children.push(makeTable(
  ['编号', '页面名称', '路由', '源文件'],
  [
    ['P01', '登录页', '/login', 'src/pages/LoginPage.tsx'],
    ['P02', '工作台', '/dashboard', 'src/pages/DashboardPage.tsx'],
    ['P03', '合同审核列表', '/reviews', 'src/pages/ReviewListPage.tsx'],
    ['P04', '新建审核任务', '/reviews/new', 'src/pages/ReviewNewPage.tsx'],
    ['P05', '审核处理进度页', '/reviews/:id/progress', 'src/pages/ReviewProgressPage.tsx'],
    ['P06', '字段确认页', '/reviews/:id/fields', 'src/pages/FieldsConfirmPage.tsx'],
    ['P07', '合同审核详情页', '/reviews/:id', 'src/pages/ReviewDetailPage.tsx'],
    ['P08', '法务复核页', '/legal-reviews/:id', 'src/pages/LegalReviewPage.tsx'],
    ['P09', '审核报告列表', '/reports', 'src/pages/ReportListPage.tsx'],
    ['P10', '审核报告详情', '/reports/:id', 'src/pages/ReportDetailPage.tsx'],
    ['P11', '审核记录', '/reviews/:id/history', 'src/pages/ReviewHistoryPage.tsx'],
    ['P12', '风险规则库', '/rules', 'src/pages/RuleListPage.tsx'],
  ],
  [10, 25, 30, 35]
));
children.push(pageBreak());

// === P01 登录页 ===
children.push(h1('P01 登录页'));
children.push(para('路由：/login  ｜  访问条件：未登录'));
children.push(image('P01-登录页'));
children.push(caption('图 P01-1 登录页整体效果'));

children.push(h2('页面元素'));

children.push(h4('左侧品牌介绍区'));
children.push(bullet('产品 Logo（ShieldCheck 图标 + 渐变背景方块 48×48）'));
children.push(bullet('产品名称：契审智控'));
children.push(bullet('产品副标题：AI 采购合同审核平台'));
children.push(bullet('主标题：让每一份采购合同都经过智能审核'));
children.push(bullet('产品简介段落'));
children.push(bullet('3 个能力卡片：智能解析 / AI 语义审核 / 原文定位'));

children.push(h4('右侧登录卡片（宽 420px）'));
children.push(bullet('标题：欢迎登录'));
children.push(bullet('副标题：请使用演示账号登录体验完整审核流程'));
children.push(bullet('账号输入框（邮箱格式校验）'));
children.push(bullet('密码输入框（带显隐切换）'));
children.push(bullet('登录按钮（loading 态防重复提交）'));
children.push(bullet('分割线：演示账号（点击填充）'));
children.push(bullet('3 个演示账号卡片（点击一键填充邮箱密码）'));
children.push(bullet('底部黄色免责声明提示框'));

children.push(h2('交互逻辑'));
children.push(makeTable(
  ['交互', '行为'],
  [
    ['点击演示账号', '自动填充邮箱密码，选中态高亮（蓝色边框 + 浅蓝背景）'],
    ['提交登录', '校验邮箱格式 + 必填项 → 调用 authService.login → 成功跳转 /dashboard，失败提示'],
    ['登录态校验', '已登录用户访问 /login 自动跳转到 /dashboard'],
    ['路由守卫', '未登录访问受保护路由自动跳转到 /login'],
  ],
  [30, 70]
));

children.push(h2('校验规则'));
children.push(bullet('账号：必填，邮箱格式'));
children.push(bullet('密码：必填'));
children.push(bullet('错误账号密码提示：「账号或密码错误，请使用演示账号登录」'));
children.push(pageBreak());

// === P02 工作台 ===
children.push(h1('P02 工作台'));
children.push(para('路由：/dashboard  ｜  访问条件：已登录'));
children.push(image('P02-工作台'));
children.push(caption('图 P02-1 工作台整体效果'));

children.push(h2('页面元素'));

children.push(h4('欢迎信息条'));
children.push(bullet('时段问候语（早上好 / 上午好 / 中午好 / 下午好 / 晚上好）+ 用户名'));
children.push(bullet('用户角色描述'));
children.push(bullet('右侧「新建审核」主按钮（仅 purchaser 角色显示）'));

children.push(h4('4 个指标卡（点击跳转对应列表筛选）'));
children.push(makeTable(
  ['指标', '含义', '跳转目标'],
  [
    ['待我处理', '当前用户待处理任务数', '/reviews?status=pending_business'],
    ['审核中合同', 'AI 审核中任务数', '/reviews?status=ai_reviewing'],
    ['高风险合同', '含高风险等级的合同数', '/reviews?riskLevel=high'],
    ['本月已完成', '本月完成任务数', '/reviews?status=completed'],
  ],
  [25, 45, 30]
));

children.push(h4('审核趋势图（折线图，ECharts）'));
children.push(bullet('X 轴：最近 6 个月'));
children.push(bullet('双折线：发起数（蓝）/ 完成数（绿）'));

children.push(h4('风险类型分布（饼图）'));
children.push(bullet('按风险类型统计：主体 / 付款 / 交付 / 验收 / 违约 / 知识产权 / 保密 / 解除 / 争议'));

children.push(h4('最近审核任务列表（6 条）'));
children.push(bullet('合同名称、状态标签、风险等级标签、相对方、金额、更新时间'));
children.push(bullet('点击跳转详情页'));

children.push(h4('待办事项列表'));
children.push(bullet('仅显示当前用户角色需要处理的任务'));
children.push(bullet('法务角色显示待复核任务'));

children.push(h4('快捷入口'));
children.push(bullet('新建审核 / 查看报告 / 风险规则库'));

children.push(h2('数据逻辑'));
children.push(bullet('所有数据来自 dashboardService，与列表、详情同源'));
children.push(bullet('指标卡数据由 db.getTasks() 实时计算，不缓存'));
children.push(bullet('趋势数据为 Mock 6 个月固定值'));
children.push(bullet('风险分布基于所有任务的风险项聚合'));
children.push(pageBreak());

// === P03 合同审核列表 ===
children.push(h1('P03 合同审核列表'));
children.push(para('路由：/reviews'));
children.push(image('P03-审核列表'));
children.push(caption('图 P03-1 审核列表整体效果'));

children.push(h2('页面元素'));

children.push(h4('筛选区（Card 包裹）'));
children.push(bullet('关键词搜索框（合同名称 / 编号 / 相对方）'));
children.push(bullet('审核状态多选'));
children.push(bullet('风险等级多选'));
children.push(bullet('合同类型单选（软件采购 / 硬件采购 / 服务采购 / 系统集成 / 设备租赁）'));
children.push(bullet('创建时间范围选择器'));

children.push(h4('操作区'));
children.push(bullet('新建审核按钮（跳转 /reviews/new）'));

children.push(h4('表格列'));
children.push(makeTable(
  ['列名', '字段', '说明'],
  [
    ['合同名称', 'contractName', '点击进入详情'],
    ['合同编号', 'contractNo', '—'],
    ['相对方', 'counterparty', '—'],
    ['合同金额', 'amount + currency', '货币格式化'],
    ['合同类型', 'contractType', 'Tag'],
    ['审核状态', 'status', 'ReviewStatusTag'],
    ['最高风险等级', 'riskLevelMax', 'RiskLevelTag（含圆点）'],
    ['风险数量', 'riskCount', '数字（高+中+低+提示合计）'],
    ['发起人', 'creatorName', '—'],
    ['创建时间', 'createdAt', '相对时间'],
    ['操作', '—', '详情 / 报告 / 删除'],
  ],
  [22, 28, 50]
));

children.push(h4('操作按钮（按状态动态显示）'));
children.push(bullet('详情：跳转 /reviews/:id'));
children.push(bullet('报告：若已生成报告则跳转 /reports/:rid，否则提示'));
children.push(bullet('删除：仅草稿状态可删，二次确认'));

children.push(h2('交互逻辑'));
children.push(bullet('筛选条件变化自动重新加载（debounce 300ms）'));
children.push(bullet('筛选状态同步到 URL（useSearchParams），刷新可恢复'));
children.push(bullet('空状态：EmptyState 组件 + 「新建审核」按钮'));
children.push(bullet('加载状态：Skeleton 占位'));
children.push(bullet('删除前 modal.confirm 二次确认'));
children.push(pageBreak());

// === P04 新建审核任务 ===
children.push(h1('P04 新建审核任务'));
children.push(para('路由：/reviews/new  ｜  访问权限：仅 purchaser'));
children.push(image('P04-新建审核-上传'));
children.push(caption('图 P04-1 新建审核第一步：上传合同'));

children.push(h2('页面元素'));

children.push(h4('步骤指示器（3 步）'));
children.push(bullet('第一步：上传合同'));
children.push(bullet('第二步：填写审核信息'));
children.push(bullet('第三步：确认并发起'));

children.push(h4('第一步：上传合同'));
children.push(bullet('拖拽上传区（支持点击选择）'));
children.push(bullet('文件类型限制：PDF / DOCX'));
children.push(bullet('文件大小限制：10MB'));
children.push(bullet('演示合同快捷按钮（一键填充预设文件）'));
children.push(bullet('上传成功后显示文件卡片（名称、大小、删除按钮）'));

children.push(h4('第二步：填写审核信息'));
children.push(bullet('合同名称（必填）'));
children.push(bullet('合同类型（必选）'));
children.push(bullet('我方身份（甲方 / 乙方，必选）'));
children.push(bullet('相对方（必填）'));
children.push(bullet('所属部门（必选）'));
children.push(bullet('合同金额（数字输入，必填）'));
children.push(bullet('币种（CNY / USD / EUR）'));
children.push(bullet('审核重点（多选 Checkbox）：'));
children.push(bullet('合同主体 / 付款条款 / 交付与验收 / 违约责任 / 知识产权 / 保密与数据安全 / 合同解除 / 争议解决', 1));
children.push(bullet('补充说明（TextArea）'));

children.push(h4('第三步：确认并发起'));
children.push(bullet('文件信息摘要'));
children.push(bullet('表单信息摘要（Descriptions）'));
children.push(bullet('「返回修改」按钮'));
children.push(bullet('「保存草稿」按钮（创建 draft 状态任务，跳转列表）'));
children.push(bullet('「开始 AI 审核」按钮（创建任务并跳转进度页）'));

children.push(h2('校验规则'));
children.push(bullet('文件格式非 PDF/DOCX：错误提示并阻止'));
children.push(bullet('文件大小超 10MB：错误提示并阻止'));
children.push(bullet('必填项未填：表单项红色提示'));
children.push(bullet('必须选择演示合同或上传文件后才能进入第二步'));
children.push(pageBreak());

// === P05 审核处理进度页 ===
children.push(h1('P05 审核处理进度页'));
children.push(para('路由：/reviews/:id/progress'));
children.push(image('P05-审核进度'));
children.push(caption('图 P05-1 审核进度页效果'));

children.push(h2('页面元素'));

children.push(h4('顶部摘要卡'));
children.push(bullet('当前阶段名称（如「正在抽取关键字段」）'));
children.push(bullet('阶段描述'));
children.push(bullet('整体进度百分比（28px 大字 + 蓝色渐变进度条）'));
children.push(bullet('Sparkles AI 图标'));

children.push(h4('处理阶段卡（Steps 垂直方向）'));
children.push(makeTable(
  ['序号', '阶段', '说明'],
  [
    ['1', '上传文件', '文件已接收'],
    ['2', '解析文档', 'OCR + 文本提取'],
    ['3', '识别合同结构', '章节切分'],
    ['4', '抽取关键字段', '金额、日期、主体等'],
    ['5', '执行风险规则', '规则引擎匹配'],
    ['6', '执行 AI 语义审核', '大模型分析'],
    ['7', '生成审核结果', '整理输出'],
  ],
  [10, 30, 60]
));
children.push(para('每阶段状态：wait / processing / success / failed'));

children.push(h4('底部操作区'));
children.push(bullet('「模拟解析失败（演示用）」红色链接按钮'));
children.push(bullet('「预计处理时间约 10 秒」提示'));

children.push(h4('完成态'));
children.push(bullet('Result 成功组件'));
children.push(bullet('风险数量摘要'));
children.push(bullet('「进入审核详情」主按钮'));

children.push(h2('交互逻辑'));
children.push(bullet('进度基于时间戳计算（localStorage.data:reviewStarts 记录启动时间）'));
children.push(bullet('刷新页面后基于 Date.now() - start 重新计算进度，不丢失状态'));
children.push(bullet('每阶段约 1.5 秒，全程约 10 秒'));
children.push(bullet('全部完成 1 秒后自动跳转 /reviews/:id'));
children.push(bullet('点击「模拟解析失败」将任务标记为 failed 状态'));
children.push(bullet('失败后显示错误 Result + 「重新审核」按钮'));
children.push(pageBreak());

// === P06 字段确认页 ===
children.push(h1('P06 合同信息字段确认页'));
children.push(para('路由：/reviews/:id/fields'));
children.push(image('P06-字段确认'));
children.push(caption('图 P06-1 字段确认页效果'));

children.push(h2('页面元素'));

children.push(h4('顶部信息条'));
children.push(bullet('返回详情按钮'));
children.push(bullet('任务状态标签'));
children.push(bullet('字段总数 / 已确认数 / 低置信度数'));

children.push(h4('字段表格'));
children.push(makeTable(
  ['列名', '说明'],
  [
    ['字段名', 'fieldLabel'],
    ['字段值', 'fieldValue（可编辑）'],
    ['置信度', 'confidence 百分比 + 颜色标签'],
    ['来源原文', 'sourceText（点击查看）'],
    ['状态', '已确认 / 待确认'],
    ['操作', '编辑 / 保存 / 确认'],
  ],
  [25, 75]
));

children.push(h4('字段清单（15 个）'));
children.push(para('合同名称、甲方、乙方、合同编号、合同金额、币种、税率、签约日期、生效日期、合同期限、付款方式、交付时间、验收方式、质保期限、争议管辖'));

children.push(h4('底部操作'));
children.push(bullet('确认全部字段按钮（标记 task.fieldsConfirmed = true）'));

children.push(h2('交互逻辑'));
children.push(bullet('低置信度字段（confidence < 0.85）显示橙色「低置信度」标签'));
children.push(bullet('点击「编辑」切到 Input 输入框，按钮变「保存」'));
children.push(bullet('保存后字段 confirmed = true，写入审计日志'));
children.push(bullet('确认全部字段后 task.fieldsConfirmed 标记为 true'));
children.push(bullet('字段未全部确认时，提交法务复核会有提示'));
children.push(pageBreak());

// === P07 合同审核详情页 ===
children.push(h1('P07 合同审核详情页（核心页面）'));
children.push(para('路由：/reviews/:id  ｜  本项目最核心页面，三栏布局'));
children.push(image('P07-审核详情三栏'));
children.push(caption('图 P07-1 三栏审核详情页效果'));

children.push(h2('整体布局'));

children.push(h4('顶部任务信息条（Card）'));
children.push(bullet('返回列表按钮'));
children.push(bullet('状态标签 + 最高风险等级标签'));
children.push(bullet('合同名称（H4 标题）'));
children.push(bullet('合同编号 / 相对方 / 金额 / 更新时间（灰色小字）'));
children.push(bullet('右侧：字段确认入口（含待确认 Tag）+ 审核记录入口'));

children.push(h4('三栏布局（flex 布局）'));
children.push(makeTable(
  ['栏目', '宽度', '内容'],
  [
    ['左栏', '240px 固定', '合同结构 + 风险统计 + 筛选'],
    ['中栏', 'flex:1 自适应', '合同原文 + 风险高亮'],
    ['右栏', '380px 固定', 'AI 结果 + 风险卡片列表 + 操作栏'],
  ],
  [15, 25, 60]
));

children.push(h2('左栏元素'));

children.push(h4('合同结构卡'));
children.push(bullet('字段确认入口（带「待确认」橙色 Tag）'));
children.push(bullet('条款目录列表：按段落分组显示，每段显示条款编号 + 名称 + 风险数量 Tag'));
children.push(bullet('点击段落：筛选该段落风险 + 滚动到原文位置'));

children.push(h4('风险统计卡（2×2 网格）'));
children.push(bullet('高风险数（红色背景）'));
children.push(bullet('中风险数（橙色背景）'));
children.push(bullet('低风险数（绿色背景）'));
children.push(bullet('提示项数（蓝灰背景）'));
children.push(bullet('底部：已处理 / 总数'));

children.push(h4('筛选卡'));
children.push(bullet('处理状态 Select（全部 / 待处理 / 已接受 / 已编辑 / 已忽略 / 转人工 / 已确认）'));
children.push(bullet('风险类型 Select（9 种类型）'));
children.push(bullet('清空筛选按钮'));

children.push(h2('中栏元素'));

children.push(h4('合同原文区（Card 内 padding 0，高度撑满）'));
children.push(bullet('合同标题'));
children.push(bullet('16 段落正文（合同主体 / 采购标的 / 合同金额 / 付款方式 / 交付安排 / 验收标准 / 质保服务 / 知识产权 / 保密与数据安全 / 违约责任 / 合同解除 / 争议解决 / 合同期限 / 其他）'));
children.push(bullet('风险原文高亮：根据 startPosition / endPosition 切分文本，用 <mark> 包裹'));
children.push(bullet('高亮颜色按风险等级区分（红 / 橙 / 绿 / 蓝灰）'));
children.push(bullet('点击高亮 → 触发 onActivateRisk，右栏滚动到对应卡片'));
children.push(bullet('顶部工具栏：字号调整（小 / 中 / 大）+ 返回顶部'));

children.push(h2('右栏元素'));

children.push(h4('AI 审核结果综合卡'));
children.push(bullet('Sparkles 图标 + 「AI 审核结果」标题'));
children.push(bullet('最高风险等级标签'));
children.push(bullet('风险评分 Statistic（/100）'));
children.push(bullet('风险数量统计（4 个小卡）'));
children.push(bullet('审核进度条（已处理 / 总数）'));
children.push(bullet('AI 免责声明（小字）'));

children.push(h4('风险卡片列表（RiskCard 组件）'));
children.push(para('每张卡片包含：'));
children.push(bullet('顶部：序号 #N + 风险等级标签 + 风险类型标签 + 处理状态标签 + 风险标题'));
children.push(bullet('右上：条款位置 + 置信度百分比'));
children.push(bullet('低置信度警告条（橙色背景，仅 confidence < 0.85 显示）'));
children.push(bullet('合同原文（折叠面板，可展开）'));
children.push(bullet('风险说明'));
children.push(bullet('审核依据（折叠）'));
children.push(bullet('修改建议（蓝色高亮卡片）'));
children.push(bullet('处理人 + 处理说明（已处理时显示）'));

children.push(h4('操作按钮区'));
children.push(bullet('接受建议（绿色按钮，pending 显示）'));
children.push(bullet('编辑建议（弹窗输入新建议）'));
children.push(bullet('忽略风险（弹窗：选择忽略原因 + 填写说明，均必填）'));
children.push(bullet('转人工复核（弹窗：填写说明，必填）'));
children.push(bullet('恢复处理（已处理态显示，恢复为 pending）'));
children.push(bullet('添加备注（弹窗：填写备注）'));

children.push(h4('底部固定操作栏（Affix）'));
children.push(bullet('上一条 / 下一条风险导航'));
children.push(bullet('保存处理结果（仅提示已自动保存）'));
children.push(bullet('提交法务复核（按钮，含二次确认）'));
children.push(bullet('生成报告（条件：任务状态为 completed 或 pending_legal）'));
children.push(bullet('返回列表'));

children.push(h2('交互逻辑'));

children.push(h4('双向定位'));
children.push(bullet('点击右栏风险卡片 → setActiveRiskId → 中栏 useEffect 滚动到段落 → 高亮该风险'));
children.push(bullet('点击中栏原文高亮 → setActiveRiskId → 右栏对应卡片 scrollIntoView'));

children.push(h4('风险处理状态机'));
children.push(bullet('pending → accepted（接受建议）'));
children.push(bullet('pending → edited（编辑建议，必填新建议）'));
children.push(bullet('pending → ignored（忽略，必填原因 + 说明）'));
children.push(bullet('pending → manual_review（转人工，必填说明）'));
children.push(bullet('accepted/edited/ignored/manual_review → pending（恢复处理）'));

children.push(h4('提交法务复核校验（checkCanSubmitForLegalReview）'));
children.push(bullet('任务状态必须为 pending_business'));
children.push(bullet('所有高风险必须已处理（accepted/edited/ignored/manual_review）'));
children.push(bullet('字段必须全部确认'));
children.push(bullet('二次确认弹窗：若有未处理风险提示数量'));
children.push(bullet('成功后任务状态变为 pending_legal'));

children.push(h4('进度实时更新'));
children.push(bullet('风险处理操作后 db.recalcTaskStats 重算任务统计'));
children.push(bullet('列表页风险数量同步变化'));
children.push(bullet('工作台统计同步变化'));
children.push(pageBreak());

// === P08 法务复核页 ===
children.push(h1('P08 法务复核页'));
children.push(para('路由：/legal-reviews/:id  ｜  访问权限：legal 角色'));
children.push(image('P08-法务复核'));
children.push(caption('图 P08-1 法务复核页效果'));

children.push(h2('页面元素'));

children.push(h4('页面头'));
children.push(bullet('标题：法务复核'));
children.push(bullet('描述：合同名称 + 最高风险标签'));
children.push(bullet('返回详情按钮'));

children.push(h4('状态提示（非 pending_legal 时显示）'));
children.push(bullet('Alert 警告：当前任务非待法务复核状态'));

children.push(h4('综合信息卡（5 列 Statistic + 描述列表）'));
children.push(bullet('风险评分 / 风险总数 / 已处理 / 重大风险'));
children.push(bullet('合同金额 / 相对方 / 发起人 + 发起时间'));

children.push(h4('合同基本信息卡（3 列 Descriptions）'));
children.push(bullet('显示前 9 个抽取字段'));

children.push(h4('风险列表卡'));
children.push(bullet('标题：风险审核（N）'));
children.push(bullet('右上：「新增人工风险」按钮（仅可复核时）'));
children.push(para('每个风险卡片包含：'));
children.push(bullet('序号 + 风险等级 + 处理状态 + 风险标题', 1));
children.push(bullet('条款位置 + 置信度', 1));
children.push(bullet('风险说明（粗体标签 + 内容）', 1));
children.push(bullet('修改建议（粗体标签 + 内容，优先显示 editedSuggestion）', 1));
children.push(bullet('业务处理信息（处理人 + 说明）', 1));
children.push(bullet('法务操作按钮：', 1));
children.push(bullet('确认（主按钮，pending/edited 显示，弹窗填写确认说明）', 2));
children.push(bullet('修改建议（弹窗编辑建议，状态变 edited）', 2));

children.push(h4('新增人工风险弹窗'));
children.push(bullet('风险标题（必填）'));
children.push(bullet('风险类型（必选）'));
children.push(bullet('风险等级（必选）'));
children.push(bullet('风险说明（必填）'));
children.push(bullet('修改建议（可选）'));
children.push(bullet('原文（可选）'));

children.push(h4('法务意见与结论卡'));
children.push(bullet('法务审核意见 TextArea（必填，最多 500 字，带字数统计）'));
children.push(bullet('最终审核结论 Select（4 选 1）：'));
children.push(bullet('sign：建议签署', 1));
children.push(bullet('sign_after_modify：建议修改后签署', 1));
children.push(bullet('postpone：建议暂缓签署', 1));
children.push(bullet('reject：不建议签署', 1));
children.push(bullet('底部操作：'));
children.push(bullet('退回业务人员（弹窗填写退回原因，必填，任务状态变回 pending_business）', 1));
children.push(bullet('完成审核（必须填写法务意见 + 选择结论，任务状态变 completed，自动生成报告）', 1));

children.push(h2('校验规则'));
children.push(bullet('退回业务人员：必填退回原因（TextArea）'));
children.push(bullet('完成审核：法务意见不能为空 + 必须选择结论'));
children.push(bullet('完成后自动调用 reportService.generate 生成报告'));
children.push(pageBreak());

// === P09 审核报告列表 ===
children.push(h1('P09 审核报告列表'));
children.push(para('路由：/reports'));
children.push(image('P09-报告列表'));
children.push(caption('图 P09-1 报告列表效果'));

children.push(h2('页面元素'));

children.push(h4('筛选区'));
children.push(bullet('关键词搜索（报告编号 / 合同名称）'));
children.push(bullet('状态筛选（全部 / 生成中 / 已生成 / 生成失败）'));

children.push(h4('表格列'));
children.push(makeTable(
  ['列名', '字段', '说明'],
  [
    ['报告编号', 'reportNo', '点击查看详情'],
    ['合同名称', 'snapshot.contractName', '—'],
    ['版本', 'versionNo', 'v1, v2...'],
    ['综合风险', 'snapshot.overallRiskLevel', 'RiskLevelTag'],
    ['状态', 'status', '生成中 / 已生成 / 失败'],
    ['生成时间', 'createdAt', '—'],
    ['操作', '—', '查看 / 重试（失败时）'],
  ],
  [20, 30, 50]
));

children.push(h2('交互逻辑'));
children.push(bullet('「查看」跳转 /reports/:id'));
children.push(bullet('「重试」仅失败状态显示，调用 reportService.retry'));
children.push(bullet('空状态 EmptyState + 引导按钮'));
children.push(pageBreak());

// === P10 审核报告详情 ===
children.push(h1('P10 审核报告详情'));
children.push(para('路由：/reports/:id'));
children.push(image('P10-报告详情'));
children.push(caption('图 P10-1 报告详情效果'));

children.push(h2('页面元素'));

children.push(h4('工具栏（.no-print 不打印）'));
children.push(bullet('返回列表'));
children.push(bullet('打印按钮（调用 window.print()）'));
children.push(bullet('导出 PDF（弹窗提示后调用打印）'));
children.push(bullet('导出 Word（弹窗提示「当前版本暂未开放」）'));

children.push(h4('报告头'));
children.push(bullet('ShieldCheck 图标 + 「采购合同审核报告」标题'));
children.push(bullet('报告编号 + 版本 + 生成时间'));

children.push(h4('综合风险概览卡（背景色按风险等级）'));
children.push(bullet('综合风险等级标签'));
children.push(bullet('风险评分（大字 /100）'));
children.push(bullet('高 / 中 / 低 / 提示项 4 列统计'));

children.push(h4('合同基本信息（2 列 Descriptions）'));
children.push(bullet('合同名称、编号、相对方、金额、币种、合同类型'));
children.push(bullet('我方身份、所属部门、发起人、创建时间'));

children.push(h4('抽取字段（3 列 Descriptions）'));
children.push(bullet('显示所有 15 个字段'));

children.push(h4('AI 审核结论摘要'));
children.push(bullet('文本块（来自 buildAISummary）'));
children.push(bullet('包含风险总数、主要风险类型、重大风险数量、建议'));

children.push(h4('重大风险条款（Table）'));
children.push(bullet('序号 / 风险标题 / 等级 / 条款 / 处理状态'));

children.push(h4('逐条风险明细（Table）'));
children.push(bullet('序号 / 风险（标题+等级+条款）/ 风险说明 / 修改建议 / 状态'));

children.push(h4('人工审核结论卡'));
children.push(bullet('最终审核结论（带颜色 Tag）'));
children.push(bullet('法务审核意见（文本块）'));
children.push(bullet('法务审核人 + 完成时间'));

children.push(h4('附件与留档'));
children.push(bullet('原始合同文件（文件名 + 大小）'));
children.push(bullet('报告版本记录'));

children.push(h4('免责声明（底部）'));

children.push(h2('打印逻辑'));
children.push(bullet('使用 @media print CSS'));
children.push(bullet('隐藏 .no-print 元素（工具栏、侧边栏、顶栏）'));
children.push(bullet('报告正文 .print-area 占满 A4 宽度'));
children.push(bullet('浏览器打印对话框可选「另存为 PDF」'));
children.push(pageBreak());

// === P11 审核记录 ===
children.push(h1('P11 审核记录'));
children.push(para('路由：/reviews/:id/history'));
children.push(image('P11-审核记录'));
children.push(caption('图 P11-1 审核记录效果'));

children.push(h2('页面元素'));

children.push(h4('页面头'));
children.push(bullet('标题：审核记录'));
children.push(bullet('描述：合同名称 + 当前状态标签'));
children.push(bullet('返回详情按钮'));

children.push(h4('任务信息卡（Descriptions）'));
children.push(bullet('任务编号、合同编号、相对方、合同金额'));
children.push(bullet('发起人、创建时间、更新时间'));
children.push(bullet('提交复核时间、完成时间、法务审核人'));

children.push(h4('文件记录卡'));
children.push(bullet('原始上传文件名 + 大小 + 「原始上传」Tag'));

children.push(h4('报告记录卡（仅已生成报告时显示）'));
children.push(bullet('报告编号 + 版本 + 生成时间'));
children.push(bullet('状态 Tag（已生成 / 生成中 / 失败）'));
children.push(bullet('「查看」按钮跳转报告详情'));

children.push(h4('操作时间轴（Timeline）'));
children.push(para('每条记录包含：'));
children.push(bullet('操作图标（按动作类型映射颜色与图标）'));
children.push(bullet('操作动作名称（粗体）'));
children.push(bullet('操作时间'));
children.push(bullet('操作人'));
children.push(bullet('操作前状态 → 操作后状态'));
children.push(bullet('备注（详细说明）'));
children.push(bullet('对象类型 Tag（task / risk / field / report）'));

children.push(h2('图标映射'));
children.push(makeTable(
  ['动作关键字', '图标', '颜色'],
  [
    ['创建 / 上传', 'PlusCircle', '蓝 #1677ff'],
    ['解析 / 审核', 'RefreshCw', '青 #13c2c2'],
    ['接受', 'CheckCircle', '绿 #52c41a'],
    ['编辑', 'Edit3', '蓝 #1677ff'],
    ['忽略', 'Ban', '灰 #8c8c8c'],
    ['转人工 / 复核', 'ClipboardCheck', '橙 #fa8c16'],
    ['提交', 'Send', '紫 #722ed1'],
    ['确认', 'ShieldCheck', '绿 #52c41a'],
    ['退回', 'Undo2', '红 #f5222d'],
    ['报告 / 生成', 'FileText', '蓝 #1677ff'],
    ['其他', 'Clock', '灰 #8c8c8c'],
  ],
  [35, 30, 35]
));

children.push(h2('数据来源'));
children.push(bullet('全部来自 db.getAuditLogsByTask(taskId)'));
children.push(bullet('按时间正序排列'));
children.push(bullet('所有操作均会写入审计日志：风险处理、字段编辑、状态变更、报告生成等'));
children.push(pageBreak());

// === P12 风险规则库 ===
children.push(h1('P12 风险规则库'));
children.push(para('路由：/rules  ｜  访问权限：legal / admin'));
children.push(image('P12-风险规则库'));
children.push(caption('图 P12-1 风险规则库效果'));

children.push(h2('页面元素'));

children.push(h4('筛选区'));
children.push(bullet('关键词搜索（规则名称 / 编码）'));
children.push(bullet('风险类型筛选'));
children.push(bullet('风险等级筛选'));
children.push(bullet('启用状态筛选（启用 / 停用 / 草稿）'));

children.push(h4('操作区'));
children.push(bullet('「新建规则」按钮（仅 admin / legal）'));

children.push(h4('表格列'));
children.push(makeTable(
  ['列名', '字段', '说明'],
  [
    ['规则名称', 'name', '—'],
    ['规则编码', 'code', '—'],
    ['合同类型', 'contractType', '—'],
    ['风险类型', 'riskType', 'Tag'],
    ['风险等级', 'riskLevel', 'RiskLevelTag'],
    ['检测方式', 'method', '规则 / AI / 混合'],
    ['状态', 'status', '启用 / 停用 / 草稿'],
    ['版本', 'version', 'v1, v2...'],
    ['更新时间', 'updatedAt', '—'],
    ['操作', '—', '编辑 / 启停 / 版本 / 删除'],
  ],
  [20, 25, 55]
));

children.push(h2('新建 / 编辑规则弹窗（Form）'));
children.push(makeTable(
  ['字段', '类型', '必填'],
  [
    ['规则名称', 'Input', '✅'],
    ['规则编码', 'Input', '✅'],
    ['合同类型', 'Select', '✅'],
    ['风险类型', 'Select', '✅'],
    ['风险等级', 'Select', '✅'],
    ['检测方式', 'Select', '✅'],
    ['触发条件', 'TextArea', '✅'],
    ['风险说明模板', 'TextArea', '✅'],
    ['修改建议模板', 'TextArea', '✅'],
    ['规则状态', 'Select', '✅'],
    ['规则说明', 'TextArea', '❌'],
  ],
  [30, 30, 40]
));

children.push(h2('交互逻辑'));
children.push(bullet('新建：调用 ruleService.create，状态默认 draft'));
children.push(bullet('编辑：编辑启用规则时自动 +1 版本号'));
children.push(bullet('启用/停用：modal.confirm 二次确认，调用 ruleService.toggle'));
children.push(bullet('删除：modal.confirm 二次确认，调用 ruleService.remove'));
children.push(bullet('查看版本：Drawer 抽屉展示当前版本详情（含触发条件、模板等）'));
children.push(bullet('所有操作持久化到 localStorage，刷新不丢失'));
children.push(pageBreak());

// === 五、核心业务状态机 ===
children.push(h1('五、核心业务状态机'));

children.push(h2('5.1 审核任务状态机'));
children.push(para('状态流转路径：'));
children.push(bullet('draft → parsing（开始审核）'));
children.push(bullet('parsing → ai_reviewing（解析完成）'));
children.push(bullet('ai_reviewing → pending_business（AI 审核完成）'));
children.push(bullet('pending_business → pending_legal（提交法务复核）'));
children.push(bullet('pending_legal → pending_business（法务退回）'));
children.push(bullet('pending_legal → completed（法务完成审核）'));
children.push(bullet('parsing → failed（解析失败，可重试回到 parsing）'));

children.push(h2('5.2 风险项状态机'));
children.push(para('状态流转路径：'));
children.push(bullet('pending → accepted（接受建议）'));
children.push(bullet('pending → edited（编辑建议，必填新建议）'));
children.push(bullet('pending → ignored（忽略，必填原因 + 说明）'));
children.push(bullet('pending → manual_review（转人工，必填说明）'));
children.push(bullet('accepted/edited/ignored/manual_review → pending（恢复处理）'));
children.push(bullet('法务复核阶段：pending/edited → confirmed（法务确认）'));

children.push(h2('5.3 提交法务复核校验规则'));
children.push(para('checkCanSubmitForLegalReview(task, risks, force) 校验：'));
children.push(bullet('1. 任务状态必须为 pending_business'));
children.push(bullet('2. 所有 riskLevel === "high" 的风险必须 status ∈ [accepted, edited, ignored, manual_review]'));
children.push(bullet('3. 所有字段必须 confirmed === true'));
children.push(bullet('4. 校验失败返回 { canSubmit: false, reasons: [...] }'));
children.push(pageBreak());

// === 六、数据一致性约束 ===
children.push(h1('六、数据一致性约束'));

children.push(h2('6.1 统一数据源'));
children.push(para('所有页面数据来自 src/services/db.ts 的 localStorage 集合：'));
children.push(makeTable(
  ['集合', 'Key', '内容'],
  [
    ['users', 'data:users', '3 个演示账号'],
    ['tasks', 'data:tasks', '5 个预设审核任务'],
    ['risks', 'data:risks', '演示合同预埋的 18 个风险'],
    ['fields', 'data:fields', '每个任务 15 个抽取字段'],
    ['reports', 'data:reports', '已生成的报告'],
    ['rules', 'data:rules', '风险规则库'],
    ['auditLogs', 'data:auditLogs', '全部操作日志'],
  ],
  [20, 25, 55]
));

children.push(h2('6.2 数据联动规则'));
children.push(makeTable(
  ['操作', '联动效果'],
  [
    ['风险处理（接受/编辑/忽略/转人工）', 'db.recalcTaskStats 重算任务 riskCount + riskLevelMax，列表与工作台同步'],
    ['提交法务复核', '任务状态 → pending_legal，列表状态变化'],
    ['法务完成审核', '任务状态 → completed，自动生成报告，报告列表出现新记录'],
    ['法务退回', '任务状态 → pending_business，业务人员可重新处理'],
    ['字段编辑', '字段 confirmed = true，写入审计日志'],
    ['规则启停', '规则状态变化，规则列表实时反映'],
    ['所有操作', '写入 auditLogs，审核记录页可查看'],
  ],
  [35, 65]
));

children.push(h2('6.3 报告快照机制'));
children.push(bullet('报告生成时调用 generateReportSnapshot(task, fields, risks, aiSummary, legalOpinion, conclusion)'));
children.push(bullet('快照为不可变对象，存储在 report.snapshot 字段'));
children.push(bullet('即使后续风险变化，已生成报告的内容不会改变'));
children.push(bullet('重新生成报告会创建新版本（versionNo + 1）'));
children.push(pageBreak());

// === 七、演示主流程 ===
children.push(h1('七、演示主流程'));

children.push(h2('端到端 23 步演示路径'));
children.push(makeTable(
  ['步骤', '操作', '角色', '期望结果'],
  [
    ['1', '登录', 'purchaser', '进入工作台'],
    ['2', '查看工作台', '—', '显示 4 个指标卡 + 图表'],
    ['3', '点击「新建审核」', '—', '进入新建页'],
    ['4', '选择演示合同', '—', '文件已添加'],
    ['5', '填写审核信息', '—', '进入确认步骤'],
    ['6', '发起 AI 审核', '—', '创建任务，跳转进度页'],
    ['7', '查看进度页', '—', '7 阶段依次推进'],
    ['8', '完成后进入字段确认', '—', '显示 15 个字段'],
    ['9', '确认字段', '—', 'task.fieldsConfirmed = true'],
    ['10', '进入三栏详情', '—', '显示 18 个风险'],
    ['11', '点击风险卡片', '—', '中栏原文滚动定位 + 高亮'],
    ['12', '接受一条风险建议', '—', '状态 → accepted，统计 +1'],
    ['13', '编辑一条修改建议', '—', '状态 → edited，弹窗输入'],
    ['14', '忽略一条低风险', '—', '弹窗填写原因 + 说明'],
    ['15', '转人工复核一条', '—', '状态 → manual_review'],
    ['16', '提交法务复核', '—', '二次确认，状态 → pending_legal'],
    ['17', '退出登录，切换 legal 账号', '—', '登录成功'],
    ['18', '进入合同复核', 'legal', '显示业务处理结果'],
    ['19', '填写法务意见', '—', 'TextArea 输入'],
    ['20', '选择「建议修改后签署」', '—', '结论下拉选择'],
    ['21', '完成法务审核', '—', '状态 → completed，自动生成报告'],
    ['22', '查看报告', '—', '报告详情 7 大章节'],
    ['23', '查看审核记录', '—', '时间轴展示所有操作'],
  ],
  [10, 30, 15, 45]
));

children.push(h2('数据一致性验证点'));
children.push(bullet('步骤 12-15：每处理一条风险，左栏统计数字实时变化'));
children.push(bullet('步骤 16：列表页任务状态变为「待法务复核」'));
children.push(bullet('步骤 21：报告列表自动出现新报告'));
children.push(bullet('步骤 23：时间轴包含登录后的所有操作（创建、字段确认、风险处理、提交、法务确认、报告生成）'));
children.push(bullet('全程刷新页面：所有状态保留（localStorage 持久化）'));
children.push(pageBreak());

// === 附录 ===
children.push(h1('附录'));

children.push(h2('A. 项目结构'));
children.push(para('src/ 目录组织：'));
children.push(bullet('pages/ - 12 个页面组件'));
children.push(bullet('features/review/ - 业务组件（RiskCard / ContractTextView）'));
children.push(bullet('components/ - 通用组件（StatusTag / PageHeader / EmptyState / ChartCard）'));
children.push(bullet('services/ - 业务服务层（8 个 service）'));
children.push(bullet('store/ - Zustand 状态管理'));
children.push(bullet('mock/ - 演示数据（合同正文 / 种子数据）'));
children.push(bullet('utils/ - 工具函数（logic / format / storage）'));
children.push(bullet('constants/ - 全局常量与状态映射'));
children.push(bullet('types/ - TypeScript 类型定义'));
children.push(bullet('theme/ - AntD 主题配置'));
children.push(bullet('layouts/ - 全局布局'));
children.push(bullet('router/ - 路由配置（懒加载 + 守卫）'));

children.push(h2('B. 演示账号速查'));
children.push(makeTable(
  ['角色', '邮箱', '密码'],
  [
    ['采购业务人员', 'purchaser@qszk.com', '123456'],
    ['法务审核人员', 'legal@qszk.com', '123456'],
    ['系统管理员', 'admin@qszk.com', '123456'],
  ],
  [30, 50, 20]
));

children.push(h2('C. 预设演示任务'));
children.push(makeTable(
  ['任务编号', '合同名称', '状态', '风险数'],
  [
    ['RVT-DEMO-001', '软件系统采购合同', '待人工确认', '18'],
    ['RVT-DEMO-002', 'OA 系统集成服务合同', 'AI 审核中', '0'],
    ['RVT-DEMO-003', '硬件设备采购合同', '待法务复核', '15'],
    ['RVT-DEMO-004', '云服务采购合同', '已完成', '12'],
    ['RVT-DEMO-005', '设备租赁合同', '草稿', '0'],
  ],
  [25, 35, 25, 15]
));

children.push(h2('D. 截图清单'));
children.push(para('所有截图位于 docs/screenshots/ 目录：'));
children.push(bullet('P01-登录页.png'));
children.push(bullet('P02-工作台.png'));
children.push(bullet('P03-审核列表.png'));
children.push(bullet('P04-新建审核-上传.png'));
children.push(bullet('P05-审核进度.png'));
children.push(bullet('P06-字段确认.png'));
children.push(bullet('P07-审核详情三栏.png'));
children.push(bullet('P08-法务复核.png'));
children.push(bullet('P09-报告列表.png'));
children.push(bullet('P10-报告详情.png'));
children.push(bullet('P11-审核记录.png'));
children.push(bullet('P12-风险规则库.png'));
children.push(para('截图脚本：scripts/capture.cjs（基于 Playwright + 本地 Chrome，1440×900 视窗）'));

children.push(h1('文档结束'));
children.push(para('本 PRD 与系统实际实现一一对应，所有页面元素、交互逻辑、状态流转、数据约束均已在第一阶段代码中落地。后续阶段将基于此文档扩展真实后端接入与高级能力。'));

// ============= 生成文档 =============

const doc = new Document({
  creator: '契审智控',
  title: '契审智控 PRD 需求文档 V2.0',
  description: 'AI 采购合同审核平台 PRD',
  styles: {
    default: {
      document: {
        run: { font: '微软雅黑', size: 20 },
      },
    },
  },
  sections: [{
    properties: {
      page: {
        margin: { top: 1440, right: 1080, bottom: 1440, left: 1080 },
        size: { orientation: PageOrientation.PORTRAIT },
      },
    },
    children,
  }],
});

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(OUTPUT, buffer);
  console.log('✓ Word 文档已生成：', OUTPUT);
  console.log('  文件大小：', (buffer.length / 1024).toFixed(2), 'KB');
}).catch((e) => {
  console.error('生成失败：', e);
  process.exit(1);
});
