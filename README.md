# 契审智控｜AI采购合同审核平台

> 面向企业采购业务的 AI 合同风险审核工作台，覆盖「上传 → 解析 → 字段抽取 → 规则检查 → AI 语义审核 → 原文定位 → 修改建议 → 人工确认 → 法务复核 → 审核报告 → 留档」核心闭环。

作品集 MVP 项目。前端 React 18 + TypeScript + Ant Design 5；后端 FastAPI + Supabase + DeepSeek 大模型；PDF 报告由 Playwright 无头浏览器生成，视觉与网页 100% 一致且文字可复制。

## 技术栈

**前端**
- React 18 + TypeScript（严格模式）+ Vite 5
- Ant Design 5（唯一 UI 框架）
- React Router 6（数据持久化后刷新可访问）
- Zustand（状态管理）
- ECharts + echarts-for-react（图表）
- dayjs（时间）
- lucide-react / @ant-design/icons（图标）

**后端**
- FastAPI + Uvicorn
- Supabase（PostgreSQL 数据持久化 + Auth 鉴权）
- DeepSeek 大模型（合同解析 / 字段抽取 / 风险审核，支持 Mock 降级）
- Playwright + Chromium（PDF 报告生成）
- python-docx / pdfplumber（合同文件解析）

## 目录结构

```
zhinenghetong/
├── src/                    # 前端源码
│   ├── pages/              # 页面（P01-P12）
│   ├── features/           # 审核域内聚模块（原文区/风险卡）
│   ├── components/         # 通用业务组件
│   ├── services/           # 业务服务层（Mock + 真实后端切换）
│   ├── store/              # zustand store
│   ├── router/             # 路由表与守卫
│   ├── layouts/            # 全局布局
│   ├── constants/          # 状态映射、Design Token、枚举
│   ├── theme/              # AntD 主题
│   ├── types/              # 全局类型定义
│   ├── utils/              # 工具（持久化、id、格式化）
│   └── mock/               # 演示合同正文与种子数据
├── backend/                # 后端源码
│   ├── app/
│   │   ├── routers/        # FastAPI 路由
│   │   ├── services/       # 业务服务（AI/解析/PDF/Supabase）
│   │   ├── schemas/        # Pydantic 模型
│   │   └── main.py         # 入口
│   ├── supabase/           # 数据库 schema 与种子数据
│   ├── test_contracts/     # 5 份演示合同（docx + pdf）
│   ├── requirements.txt
│   └── run.bat             # Windows 启动脚本
├── docs/                   # 设计文档（PRD/数据模型/API/开发计划）
├── reference/              # 原 PRD V1.0
└── AGENTS.md               # 项目协作规则
```

## 快速开始

### 环境要求
- Node.js ≥ 18
- Python ≥ 3.10
- Windows / macOS / Linux 均可（Windows 已验证）

### 1. 启动后端

```bash
cd backend

# 创建虚拟环境并安装依赖
python -m venv venv
# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入 DEEPSEEK_API_KEY（可选，未填则使用 Mock 模式）

# 安装 Playwright 浏览器（PDF 报告生成需要）
playwright install chromium

# 启动
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Windows 用户可直接双击 `backend/run.bat` 一键完成上述步骤。

后端启动后：
- API 文档：http://localhost:8000/docs
- 健康检查：http://localhost:8000/health

### 2. 启动前端

```bash
# 在项目根目录
npm install
npm run dev
```

前端启动后访问 http://localhost:5173

### 3. 演示账号

| 角色 | 邮箱 | 密码 | 权限 |
|------|------|------|------|
| 采购员 | purchaser@demo.com | demo123456 | 新建审核任务、字段确认、风险处理 |
| 法务 | legal@demo.com | demo123456 | 法务复核、风险确认、规则库管理 |
| 管理员 | admin@demo.com | demo123456 | 全部权限 |

也可在登录后通过右上角用户菜单「切换演示角色」快速切换。

## 环境变量说明

**前端**（项目根目录 `.env`）
```
VITE_API_BASE=http://127.0.0.1:8000
VITE_SUPABASE_URL=<your-supabase-url>
VITE_SUPABASE_ANON_KEY=<your-supabase-anon-key>
```

**后端**（`backend/.env`，参考 `.env.example`）
- `DEEPSEEK_API_KEY`：DeepSeek API Key，未填则自动启用 Mock 模式
- `DEEPSEEK_MODEL`：模型选择（deepseek-chat / deepseek-reasoner）
- `SUPABASE_URL` / `SUPABASE_KEY`：Supabase 项目配置
- `FRONTEND_ORIGIN`：CORS 允许的前端地址
- `MOCK_MODE`：auto（推荐）/ true / false

## 功能模块

| 编号 | 页面 | 说明 |
|------|------|------|
| P01 | 登录页 | 多角色登录、JWT 鉴权 |
| P02 | 工作台 | 任务统计、趋势图、待办列表 |
| P03 | 审核列表 | 任务台账、状态筛选、URL 持久化 |
| P04 | 新建审核 | 上传合同 → 填写信息 → 发起 AI 审核 |
| P05 | 审核进度 | AI 解析 → 抽取 → 审核进度可视化 |
| P06 | 字段确认 | AI 抽取字段人工校对、置信度提示 |
| P07 | 审核详情 | 三栏：原文 / 风险卡 / 详情，原文高亮联动 |
| P08 | 法务复核 | 法务独立复核、新增人工风险 |
| P09 | 报告列表 | 审核报告台账 |
| P10 | 报告详情 | 完整审核报告、PDF 下载（Playwright 生成） |
| P11 | 审核记录 | 操作时间轴、结构化审计日志 |
| P12 | 风险规则库 | 规则 CRUD、版本管理、启用/禁用 |

## 演示主流程（端到端）

1. 采购员登录 → 工作台 → 新建审核任务
2. 上传演示合同（`backend/test_contracts/`）→ 填写信息 → 发起 AI 审核
3. 查看审核进度（解析 → 抽取 → 风险审核）
4. 确认抽取字段（可修正 AI 抽取值）
5. 进入三栏审核详情：点击风险卡 → 接受 / 编辑 / 忽略 / 转人工
6. 提交法务复核 → 切换法务角色 → 法务复核 → 完成审核
7. 生成审核报告 → 下载 PDF（视觉与网页一致、文字可复制）→ 查看审核记录

## 生产构建

```bash
# 类型检查 + 生产构建
npm run build

# 预览构建产物
npm run preview
```

构建产物输出到 `dist/`，已配置代码分割：
- `react` / `react-dom` 独立 chunk
- `antd` 独立 chunk
- `echarts` 独立 chunk
- 各页面按路由懒加载

## 技术亮点

- **AI 审核结果结构化**：风险项含原文定位、置信度策略（≥0.85 正常 / 0.60-0.84 建议复核 / <0.60 转人工）
- **三栏审核交互**：原文区与风险卡联动高亮、风险定位滚动（`scrollIntoView({ block: 'nearest' })`）
- **乐观更新**：风险操作即时响应，后台异步持久化，失败自动回滚
- **PDF 报告生成**：Playwright 无头浏览器方案，避开 html2canvas 内容截断与 reportlab 视觉不一致问题；subprocess 隔离绕过 Windows ProactorEventLoop 限制
- **数据一致性**：统一业务服务层，工作台 / 列表 / 详情 / 报告 / 记录共享同一数据源
- **响应式适配**：侧边栏可折叠、三栏审核页小屏堆叠、表格横向滚动
- **错误边界**：全局 ErrorBoundary + 网络错误友好化（超时 / 网络断开中文提示）
- **JWT 鉴权**：access_token 过期自动用 refresh_token 续期，401 重试

## 项目文档

- [PRD 需求文档 V2.0](docs/PRD需求文档_V2.0.md)
- [开发计划](docs/开发计划.md)
- [数据模型](docs/数据模型.md)
- [API 设计](docs/API设计.md)
- [功能清单](docs/功能清单.md)
- [测试清单](docs/测试清单.md)
- [后端接入说明](docs/后端接入说明.md)

## 项目约束

本项目为作品集 MVP，第一阶段不实现：
- 真实文件解析 OCR（已用 Mock 进度模拟）
- Word 红线修订、电子签章、复杂审批流
- 线上部署、推送 GitHub（仅本地演示）

## AI 免责声明

> 本系统审核结果由 AI 辅助生成，仅供合同初审参考，不构成正式法律意见，最终结论应由专业人员确认。
