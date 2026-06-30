# API 设计

> 对应 PRD 第 9 章。第一阶段为前端 Mock 实现（`src/services/*`），方法签名与下表一致；后续替换为 FastAPI 时仅改实现不改调用方。所有写操作幂等，风险更新携带 `version`，冲突返回 409。

## 一、约定
- 命名空间：`/api`
- 鉴权：第一阶段 Mock，登录后 `currentUser` 写入 localStorage；真实后端用 Bearer Token。
- 幂等：创建任务/提交复核/生成报告使用幂等键防重复。
- 快照：报告基于「已提交审核快照」生成，保证可复现。

## 二、接口清单

### 认证
| 方法 | 接口 | 用途 | Mock 实现 |
|------|------|------|----------|
| POST | /api/auth/login | 登录 | 校验演示账号 |
| POST | /api/auth/logout | 退出 | 清除登录态 |
| GET | /api/auth/me | 当前用户 | 读 localStorage |

### 合同与文件
| 方法 | 接口 | 用途 |
|------|------|------|
| POST | /api/contracts/upload | 上传合同文件（file_id, file_name, checksum） |
| POST | /api/contracts | 创建合同 |
| GET | /api/contracts/:id | 合同详情 |

### 审核任务
| 方法 | 接口 | 用途 | services 方法 |
|------|------|------|---------------|
| POST | /api/review-tasks | 创建并启动审核 | reviewService.createTask |
| GET | /api/review-tasks | 列表与筛选 | reviewService.listTasks |
| GET | /api/review-tasks/:id | 任务详情 | reviewService.getTask |
| GET | /api/review-tasks/:id/progress | 审核进度 | reviewService.getProgress |
| GET | /api/review-tasks/:id/document | 解析文档(sections/paragraphs) | reviewService.getDocument |
| GET | /api/review-tasks/:id/fields | 抽取字段 | fieldService.list |
| PATCH | /api/review-tasks/:id/fields | 确认/编辑字段 | fieldService.confirm |
| GET | /api/review-tasks/:id/risks | 风险列表 | riskService.list |
| PATCH | /api/risks/:id | 更新建议或状态 | riskService.update |
| POST | /api/review-tasks/:id/risks | 新增人工风险 | riskService.create |
| POST | /api/review-tasks/:id/submit | 提交法务复核 | reviewService.submit |
| POST | /api/review-tasks/:id/legal | 法务审核(确认/退回) | reviewService.legalReview |
| GET | /api/review-tasks/:id/history | 操作时间轴 | auditService.list |

### 审核报告
| 方法 | 接口 | 用途 |
|------|------|------|
| GET | /api/reports | 报告列表 |
| POST | /api/review-tasks/:id/reports | 生成报告 |
| GET | /api/reports/:id | 报告详情/快照 |
| GET | /api/reports/:id/download | 下载（第一阶段浏览器打印） |

### 风险规则
| 方法 | 接口 | 用途 |
|------|------|------|
| GET | /api/risk-rules | 规则列表 |
| POST | /api/risk-rules | 新建规则 |
| PATCH | /api/risk-rules/:id | 编辑规则（启用规则改自动生成新版本） |
| POST | /api/risk-rules/:id/toggle | 启停 |
| GET | /api/risk-rules/:id/versions | 版本历史 |

### 工作台
| 方法 | 接口 | 用途 |
|------|------|------|
| GET | /api/dashboard/stats | 指标统计（从统一数据源计算） |
| GET | /api/dashboard/trends | 审核趋势 |
| GET | /api/dashboard/recent | 最近任务 |

## 三、关键领域事件
`review_task.created` / `document.parsed` / `review.completed` / `risk.updated` / `review.submitted` / `review.approved` / `report.generated`
第一阶段以 `AuditLog` 记录代替事件总线，后续接入真实后端时映射为消息。

## 四、并发与幂等
- 风险更新携带 `version`；服务端发现版本冲突返回 409，要求刷新。
- 提交复核/生成报告按钮点击立即禁用 + 加载态，接口幂等键防重复。
- 异步任务（解析/AI）后台执行，前端轮询进度；第一阶段用 setTimeout 模拟。
