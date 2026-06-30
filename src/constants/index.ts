/**
 * 全局常量与状态映射（唯一来源）
 * 所有页面必须从此引用，禁止各自定义状态名/颜色/标签。
 */
import type {
  RiskLevel,
  RiskStatus,
  ReviewStatus,
  RiskCategory,
  LegalConclusion,
  RuleMethod,
  Role,
} from '@/types';

/** AI 免责声明（全局展示，不可删除） */
export const DISCLAIMER =
  '本系统审核结果由AI辅助生成，仅供合同初审参考，不构成正式法律意见，最终结论应由专业人员确认。';

/** Design Token 颜色 */
export const COLORS = {
  primary: '#1677ff', // 主色 专业蓝
  ai: '#13c2c2', // AI 辅助色 青绿
  bg: '#f5f7fa', // 背景 浅灰白
  card: '#ffffff',
  border: '#e8ecf0',
  textPrimary: '#1d2129',
  textSecondary: '#5b6470',
  high: '#f5222d', // 高风险 红
  medium: '#fa8c16', // 中风险 橙
  low: '#52c41a', // 低风险 绿
  notice: '#7c8696', // 提示项 蓝灰
} as const;

/** 风险等级映射 */
export const RISK_LEVEL_MAP: Record<
  RiskLevel,
  { label: string; color: string; bg: string; border: string; rank: number; desc: string }
> = {
  high: {
    label: '高风险',
    color: COLORS.high,
    bg: '#fff1f0',
    border: '#ffccc7',
    rank: 4,
    desc: '可能导致重大经济损失或核心权利受限，必须人工确认',
  },
  medium: {
    label: '中风险',
    color: COLORS.medium,
    bg: '#fff7e6',
    border: '#ffd591',
    rank: 3,
    desc: '可能影响履约或造成管理成本，建议处理',
  },
  low: {
    label: '低风险',
    color: COLORS.low,
    bg: '#f6ffed',
    border: '#b7eb8f',
    rank: 2,
    desc: '条款表达、完整性或轻微不利问题',
  },
  notice: {
    label: '提示项',
    color: COLORS.notice,
    bg: '#f0f5ff',
    border: '#d6e4ff',
    rank: 1,
    desc: '信息提醒，不直接判定风险，不阻断流程',
  },
};

export const RISK_LEVEL_OPTIONS: { value: RiskLevel; label: string }[] = [
  { value: 'high', label: '高风险' },
  { value: 'medium', label: '中风险' },
  { value: 'low', label: '低风险' },
  { value: 'notice', label: '提示项' },
];

/** 审核任务状态映射 */
export const REVIEW_STATUS_MAP: Record<
  ReviewStatus,
  { label: string; color: string; processing?: boolean }
> = {
  draft: { label: '草稿', color: 'default' },
  parsing: { label: '解析中', color: 'processing', processing: true },
  ai_reviewing: { label: 'AI审核中', color: 'processing', processing: true },
  pending_business: { label: '待人工确认', color: 'warning' },
  pending_legal: { label: '待法务复核', color: 'blue' },
  completed: { label: '已完成', color: 'success' },
  failed: { label: '失败', color: 'error' },
};

export const REVIEW_STATUS_OPTIONS: { value: ReviewStatus; label: string }[] = [
  { value: 'draft', label: '草稿' },
  { value: 'parsing', label: '解析中' },
  { value: 'ai_reviewing', label: 'AI审核中' },
  { value: 'pending_business', label: '待人工确认' },
  { value: 'pending_legal', label: '待法务复核' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
];

/** 风险处理状态映射 */
export const RISK_STATUS_MAP: Record<
  RiskStatus,
  { label: string; color: string; processed: boolean }
> = {
  pending: { label: '待处理', color: 'default', processed: false },
  accepted: { label: '已接受', color: 'success', processed: true },
  edited: { label: '已编辑', color: 'blue', processed: true },
  ignored: { label: '已忽略', color: 'default', processed: true },
  manual_review: { label: '转人工复核', color: 'warning', processed: true },
  confirmed: { label: '已确认', color: 'success', processed: true },
};

/** 风险类型映射 */
export const RISK_CATEGORY_MAP: Record<RiskCategory, { label: string; icon: string }> = {
  subject: { label: '合同主体', icon: 'UserOutlined' },
  amount: { label: '合同金额', icon: 'PayCircleOutlined' },
  payment: { label: '付款条款', icon: 'WalletOutlined' },
  delivery: { label: '交付与验收', icon: 'CarryOutOutlined' },
  acceptance: { label: '验收标准', icon: 'CheckSquareOutlined' },
  warranty: { label: '质保服务', icon: 'SafetyOutlined' },
  breach: { label: '违约责任', icon: 'WarningOutlined' },
  termination: { label: '合同解除', icon: 'DisconnectOutlined' },
  ip: { label: '知识产权', icon: 'BulbOutlined' },
  confidentiality: { label: '保密条款', icon: 'LockOutlined' },
  data_security: { label: '数据安全', icon: 'SafetyCertificateOutlined' },
  dispute: { label: '争议解决', icon: 'AuditOutlined' },
  term: { label: '合同期限', icon: 'CalendarOutlined' },
};

export const RISK_CATEGORY_OPTIONS: { value: RiskCategory; label: string }[] = (
  Object.keys(RISK_CATEGORY_MAP) as RiskCategory[]
).map((k) => ({ value: k, label: RISK_CATEGORY_MAP[k].label }));

/** 法务最终结论映射 */
export const LEGAL_CONCLUSION_MAP: Record<
  LegalConclusion,
  { label: string; color: string; desc: string }
> = {
  sign: { label: '建议签署', color: 'success', desc: '合同风险可控，可正常签署' },
  sign_after_modify: {
    label: '建议修改后签署',
    color: 'warning',
    desc: '需按审核建议修改条款后再签署',
  },
  defer: { label: '建议暂缓签署', color: 'orange', desc: '存在需进一步确认事项，建议暂缓' },
  not_sign: { label: '不建议签署', color: 'error', desc: '存在重大风险，不建议签署' },
};

/** 规则检测方式 */
export const RULE_METHOD_MAP: Record<RuleMethod, { label: string }> = {
  field: { label: '字段规则' },
  keyword: { label: '关键词规则' },
  ai: { label: 'AI语义规则' },
};

/** 角色映射 */
export const ROLE_MAP: Record<Role, { label: string; desc: string }> = {
  purchaser: { label: '采购业务人员', desc: '上传合同、处理基础风险、提交法务' },
  legal: { label: '法务审核人员', desc: '复核高风险、修改建议、确认报告' },
  admin: { label: '系统管理员', desc: '维护风险规则、查看规则状态' },
};

/** 审核重点选项（8 类） */
export const REVIEW_FOCUS_OPTIONS: { value: string; label: string; desc: string }[] = [
  { value: 'subject', label: '合同主体', desc: '主体资质、授权能力' },
  { value: 'payment', label: '付款条款', desc: '预付比例、付款节点、发票' },
  { value: 'delivery', label: '交付与验收', desc: '交付日期、验收标准、期限' },
  { value: 'breach', label: '违约责任', desc: '违约金、责任对等性' },
  { value: 'ip', label: '知识产权', desc: '成果归属、许可范围' },
  { value: 'confidentiality', label: '保密与数据安全', desc: '保密期限、数据安全' },
  { value: 'termination', label: '合同解除', desc: '解除条件、单方权利' },
  { value: 'dispute', label: '争议解决', desc: '管辖法院、仲裁条款' },
];

/** 忽略原因选项 */
export const IGNORE_REASONS = [
  '不适用于当前合同',
  '已有其他条款覆盖',
  '业务可接受',
  '识别错误，非风险',
  '其他',
];

/** 文件上传限制 */
export const FILE_LIMITS = {
  maxSize: 20 * 1024 * 1024, // 20MB
  accept: '.pdf,.docx',
  acceptLabel: 'PDF、DOCX',
};

/** localStorage 命名空间 */
export const STORAGE_PREFIX = 'qszk';

/** 演示账号 */
export const DEMO_ACCOUNTS = [
  {
    role: 'purchaser' as Role,
    email: 'purchaser@qszk.com',
    password: '123456',
    name: '李明',
    department: '采购部',
    position: '采购经理',
    avatarColor: '#1677ff',
  },
  {
    role: 'legal' as Role,
    email: 'legal@qszk.com',
    password: '123456',
    name: '王律师',
    department: '法务部',
    position: '高级法务',
    avatarColor: '#13c2c2',
  },
  {
    role: 'admin' as Role,
    email: 'admin@qszk.com',
    password: '123456',
    name: '张管理员',
    department: '信息技术部',
    position: '系统管理员',
    avatarColor: '#722ed1',
  },
];

/** 通用分页默认 */
export const PAGE_SIZE = 10;
