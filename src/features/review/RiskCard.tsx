/**
 * 风险卡片（P07 右栏单元）
 * - 风险标题、等级、类型、条款位置、置信度
 * - 原文、说明、依据、建议
 * - 处理操作：接受 / 编辑 / 忽略 / 转人工 / 恢复 / 备注
 * - 选中态：高亮边框 + 滚动到视图
 */
import { memo, useState } from 'react';
import {
  Card, Tag, Typography, Space, Button, Modal, Input, Select, Tooltip, Divider, Collapse, App,
} from 'antd';
import {
  Check, Edit3, EyeOff, Send, RotateCcw, MessageSquarePlus, ChevronDown, AlertTriangle, Sparkles, Shield, User,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { Link } from 'react-router-dom';
import { riskService } from '@/services/riskService';
import {
  COLORS, RISK_LEVEL_MAP, RISK_CATEGORY_MAP, RISK_STATUS_MAP, IGNORE_REASONS,
} from '@/constants';
import { getConfidenceLevel } from '@/utils/logic';
import { formatDateTime } from '@/utils/format';
import { RiskLevelTag, RiskStatusTag } from '@/components/StatusTag';
import type { RiskItem } from '@/types';

const { TextArea } = Input;
const { Text, Paragraph } = Typography;

interface RiskCardProps {
  risk: RiskItem;
  index: number;
  total: number;
  active: boolean;
  selectable?: boolean;
  onActivate?: (id: string) => void;
  /** 操作完成回调；传入更新后的 risk 触发乐观更新，不传则仅刷新（如备注） */
  onChanged?: (updatedRisk?: RiskItem) => void;
  /** 是否只读（法务/管理员在详情页只查看不处理；法务在 LegalReviewPage 单独处理） */
  readOnly?: boolean;
}

type ModalType = 'edit' | 'ignore' | 'transfer' | 'comment' | null;

function RiskCardInner({ risk, index, total, active, selectable = true, onActivate, onChanged, readOnly = false }: RiskCardProps) {
  const { currentUser } = useAuthStore();
  const { message } = App.useApp();
  const [modal, setModal] = useState<ModalType>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editValue, setEditValue] = useState(risk.suggestion);
  const [ignoreReason, setIgnoreReason] = useState<string | undefined>();
  const [ignoreComment, setIgnoreComment] = useState('');
  const [transferComment, setTransferComment] = useState('');
  const [commentValue, setCommentValue] = useState('');
  const [expanded, setExpanded] = useState(false);

  if (!currentUser) return null;

  const levelCfg = RISK_LEVEL_MAP[risk.riskLevel];
  const conf = getConfidenceLevel(risk.confidence);
  const isLowConfidence = conf.needReview;
  const isPending = risk.status === 'pending';
  const isProcessed = risk.status !== 'pending';
  const canRestore = risk.status === 'accepted' || risk.status === 'edited' || risk.status === 'ignored' || risk.status === 'manual_review';

  const handleAccept = () => {
    // 乐观更新：立即更新 UI，后台异步持久化
    const optimistic: RiskItem = {
      ...risk,
      status: 'accepted',
      handler: currentUser.name,
      version: risk.version + 1,
      updatedAt: new Date().toISOString(),
    };
    onChanged?.(optimistic);
    message.success('已接受修改建议');
    // 后台异步执行，失败回滚
    riskService.accept(risk.id, currentUser).catch((e) => {
      message.error(e instanceof Error ? e.message : '操作失败，已回滚');
      onChanged?.(risk); // 回滚
    });
  };

  const handleEdit = () => {
    if (!editValue.trim()) {
      message.warning('请输入修改后的建议');
      return;
    }
    const optimistic: RiskItem = {
      ...risk,
      status: 'edited',
      editedSuggestion: editValue.trim(),
      handler: currentUser.name,
      version: risk.version + 1,
      updatedAt: new Date().toISOString(),
    };
    setModal(null);
    onChanged?.(optimistic);
    message.success('修改建议已保存');
    riskService.edit(risk.id, currentUser, editValue.trim()).catch((e) => {
      message.error(e instanceof Error ? e.message : '操作失败，已回滚');
      onChanged?.(risk);
    });
  };

  const handleIgnore = () => {
    if (!ignoreReason) {
      message.warning('请选择忽略原因');
      return;
    }
    if (!ignoreComment.trim()) {
      message.warning('请填写忽略说明');
      return;
    }
    const optimistic: RiskItem = {
      ...risk,
      status: 'ignored',
      ignoreReason,
      handleComment: ignoreComment.trim(),
      handler: currentUser.name,
      version: risk.version + 1,
      updatedAt: new Date().toISOString(),
    };
    setModal(null);
    setIgnoreReason(undefined);
    setIgnoreComment('');
    onChanged?.(optimistic);
    message.success('已忽略该风险');
    riskService.ignore(risk.id, currentUser, ignoreReason, ignoreComment.trim()).catch((e) => {
      message.error(e instanceof Error ? e.message : '操作失败，已回滚');
      onChanged?.(risk);
    });
  };

  const handleTransfer = () => {
    if (!transferComment.trim()) {
      message.warning('请填写转人工复核说明');
      return;
    }
    const optimistic: RiskItem = {
      ...risk,
      status: 'manual_review',
      handleComment: transferComment.trim(),
      handler: currentUser.name,
      version: risk.version + 1,
      updatedAt: new Date().toISOString(),
    };
    setModal(null);
    setTransferComment('');
    onChanged?.(optimistic);
    message.success('已转人工复核');
    riskService.transferManual(risk.id, currentUser, transferComment.trim()).catch((e) => {
      message.error(e instanceof Error ? e.message : '操作失败，已回滚');
      onChanged?.(risk);
    });
  };

  const handleRestore = () => {
    const optimistic: RiskItem = {
      ...risk,
      status: 'pending',
      ignoreReason: null,
      handleComment: null,
      handler: currentUser.name,
      version: risk.version + 1,
      updatedAt: new Date().toISOString(),
    };
    onChanged?.(optimistic);
    message.success('已恢复为待处理');
    riskService.restore(risk.id, currentUser).catch((e) => {
      message.error(e instanceof Error ? e.message : '操作失败，已回滚');
      onChanged?.(risk);
    });
  };

  const handleAddComment = () => {
    if (!commentValue.trim()) {
      message.warning('请输入备注内容');
      return;
    }
    setModal(null);
    const prev = commentValue;
    setCommentValue('');
    message.success('备注已添加');
    riskService.addComment(risk.id, currentUser, prev.trim()).catch((e) => {
      message.error(e instanceof Error ? e.message : '操作失败');
    });
  };

  const openEdit = () => {
    setEditValue(risk.suggestion);
    setModal('edit');
  };
  const openIgnore = () => {
    setIgnoreReason(undefined);
    setIgnoreComment('');
    setModal('ignore');
  };

  const finalSuggestion = risk.editedSuggestion ?? risk.suggestion;
  const cardBorder = active ? levelCfg.color : COLORS.border;
  const cardBg = active ? levelCfg.bg : '#fff';

  return (
    <div
      id={`risk-card-${risk.id}`}
      style={{
        border: `1px solid ${cardBorder}`,
        borderRadius: 8,
        background: cardBg,
        marginBottom: 12,
        transition: 'all 0.2s',
        boxShadow: active ? `0 2px 8px ${levelCfg.color}22` : 'none',
        overflow: 'hidden',
      }}
      onClick={() => selectable && onActivate?.(risk.id)}
    >
      {/* 头部 */}
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${COLORS.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <Tag color="default" style={{ fontSize: 11, margin: 0, padding: '0 6px', lineHeight: '18px' }}>
                #{index + 1}/{total}
              </Tag>
              <RiskLevelTag level={risk.riskLevel} showDot />
              <RiskStatusTag status={risk.status} />
              {isLowConfidence && (
                <Tooltip title={conf.label}>
                  <Tag color="warning" style={{ fontSize: 11, margin: 0, padding: '0 6px', lineHeight: '18px' }}>
                    <AlertTriangle size={10} style={{ marginRight: 2 }} />
                    {conf.label}
                  </Tag>
                </Tooltip>
              )}
            </div>
            <Text strong style={{ fontSize: 14, color: COLORS.textPrimary, lineHeight: 1.4 }}>
              {risk.title}
            </Text>
          </div>
        </div>
      </div>

      {/* 元信息 */}
      <div style={{ padding: '8px 14px', background: '#fafbfc', borderBottom: `1px solid ${COLORS.border}` }}>
        <Space size={12} wrap>
          <span style={{ fontSize: 12 }}>
            <Text style={{ color: COLORS.textSecondary }}>类型：</Text>
            <Text>{RISK_CATEGORY_MAP[risk.riskType]?.label ?? risk.riskType}</Text>
          </span>
          <span style={{ fontSize: 12 }}>
            <Text style={{ color: COLORS.textSecondary }}>条款：</Text>
            <Text>{risk.clauseNumber} {risk.clauseTitle}</Text>
          </span>
          <span style={{ fontSize: 12 }}>
            <Text style={{ color: COLORS.textSecondary }}>置信度：</Text>
            <Text style={{ color: isLowConfidence ? COLORS.medium : COLORS.textPrimary }}>
              {Math.round(risk.confidence * 100)}%
            </Text>
          </span>
          <span style={{ fontSize: 12 }}>
            <Text style={{ color: COLORS.textSecondary }}>来源：</Text>
            {risk.sourceType === 'rule' && <Tag color="blue" icon={<Shield size={10} />} style={{ margin: 0, fontSize: 11 }}>规则</Tag>}
            {risk.sourceType === 'ai' && <Tag color="cyan" icon={<Sparkles size={10} />} style={{ margin: 0, fontSize: 11 }}>AI</Tag>}
            {risk.sourceType === 'manual' && <Tag color="purple" icon={<User size={10} />} style={{ margin: 0, fontSize: 11 }}>人工</Tag>}
            {risk.ruleId && (
              <Link to={`/rules?keyword=${encodeURIComponent(risk.ruleId)}`} style={{ fontSize: 12, color: COLORS.primary, textDecoration: 'none' }}>
                规则 {risk.ruleId}
              </Link>
            )}
          </span>
        </Space>
      </div>

      {/* 内容区 */}
      <div style={{ padding: '12px 14px' }}>
        {/* 原文 */}
        <div style={{ marginBottom: 10 }}>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary, fontWeight: 600 }}>合同原文</Text>
          <div
            style={{
              marginTop: 4,
              padding: '8px 10px',
              background: levelCfg.bg,
              borderLeft: `3px solid ${levelCfg.color}`,
              borderRadius: '0 4px 4px 0',
              fontSize: 13,
              lineHeight: 1.7,
              color: COLORS.textPrimary,
              whiteSpace: 'pre-wrap',
            }}
          >
            {risk.originalText}
          </div>
        </div>

        {/* 风险说明 */}
        <div style={{ marginBottom: 10 }}>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary, fontWeight: 600 }}>风险说明</Text>
          <Paragraph style={{ fontSize: 13, marginTop: 4, marginBottom: 0, lineHeight: 1.7, color: COLORS.textPrimary }}>
            {risk.riskReason}
          </Paragraph>
        </div>

        {/* 审核依据 */}
        <div style={{ marginBottom: 10 }}>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary, fontWeight: 600 }}>审核依据</Text>
          <Paragraph style={{ fontSize: 12, marginTop: 4, marginBottom: 0, lineHeight: 1.6, color: COLORS.textSecondary }}>
            {risk.reviewBasis}
          </Paragraph>
        </div>

        {/* 修改建议 */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <Text style={{ fontSize: 12, color: COLORS.textSecondary, fontWeight: 600 }}>
              修改建议{risk.editedSuggestion && <Tag color="blue" style={{ marginLeft: 6, fontSize: 10, margin: 0, padding: '0 4px' }}>已编辑</Tag>}
            </Text>
          </div>
          <div
            style={{
              padding: '8px 10px',
              background: risk.editedSuggestion ? '#e6f4ff' : '#f6ffed',
              border: `1px solid ${risk.editedSuggestion ? '#d6e4ff' : '#d9f7be'}`,
              borderRadius: 4,
              fontSize: 13,
              lineHeight: 1.7,
              color: COLORS.textPrimary,
              whiteSpace: 'pre-wrap',
            }}
          >
            {finalSuggestion}
          </div>
        </div>

        {/* 操作记录摘要 */}
        {(risk.handler || risk.handleComment) && (
          <div style={{ padding: '6px 10px', background: '#fafbfc', borderRadius: 4, marginTop: 8 }}>
            <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>
              {risk.handler && <>处理人：{risk.handler} · </>}
              {risk.handleComment && <>说明：{risk.handleComment}</>}
            </Text>
          </div>
        )}

        {/* 操作按钮（readOnly 时隐藏全部处理操作，仅保留备注） */}
        {!readOnly && (
          <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {isPending && (
              <>
                <Button size="small" type="primary" icon={<Check size={12} />} loading={submitting} onClick={(e) => { e.stopPropagation(); handleAccept(); }}>
                  接受建议
                </Button>
                <Button size="small" icon={<Edit3 size={12} />} onClick={(e) => { e.stopPropagation(); openEdit(); }}>
                  编辑建议
                </Button>
                <Button size="small" icon={<EyeOff size={12} />} onClick={(e) => { e.stopPropagation(); openIgnore(); }}>
                  忽略
                </Button>
                <Button size="small" icon={<Send size={12} />} onClick={(e) => { e.stopPropagation(); setModal('transfer'); }}>
                  转人工
                </Button>
              </>
            )}
            {canRestore && (
              <Button size="small" icon={<RotateCcw size={12} />} loading={submitting} onClick={(e) => { e.stopPropagation(); handleRestore(); }}>
                恢复处理
              </Button>
            )}
            <Button size="small" type="text" icon={<MessageSquarePlus size={12} />} onClick={(e) => { e.stopPropagation(); setModal('comment'); }}>
              添加备注
            </Button>
          </div>
        )}
      </div>

      {/* 编辑建议弹窗 */}
      <Modal
        title="编辑修改建议"
        open={modal === 'edit'}
        onCancel={() => setModal(null)}
        onOk={handleEdit}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        width={560}
        styles={{ body: { paddingBottom: 24 } }}
      >
        <div style={{ marginBottom: 8 }}>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>AI 原始建议</Text>
          <div style={{ padding: 8, background: '#fafbfc', borderRadius: 4, fontSize: 12, color: COLORS.textSecondary, marginTop: 4 }}>
            {risk.suggestion}
          </div>
        </div>
        <div style={{ marginBottom: 8 }}>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>修改后的建议</Text>
        </div>
        <TextArea
          rows={5}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          placeholder="请输入修改后的建议内容"
          maxLength={500}
          showCount
          style={{ marginBottom: 8 }}
        />
      </Modal>

      {/* 忽略弹窗 */}
      <Modal
        title="忽略风险"
        open={modal === 'ignore'}
        onCancel={() => setModal(null)}
        onOk={handleIgnore}
        confirmLoading={submitting}
        okText="确认忽略"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        styles={{ body: { paddingBottom: 24 } }}
      >
        <AlertTriangle size={20} color={COLORS.medium} style={{ marginBottom: 8 }} />
        <Paragraph style={{ fontSize: 13, color: COLORS.textSecondary }}>
          忽略后该风险将不进入重大风险摘要，但仍保留在审核记录中。请选择忽略原因并填写说明。
        </Paragraph>
        <div style={{ marginBottom: 12 }}>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>忽略原因 *</Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            placeholder="请选择忽略原因"
            value={ignoreReason}
            onChange={setIgnoreReason}
            options={IGNORE_REASONS.map((r) => ({ value: r, label: r }))}
          />
        </div>
        <div>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>忽略说明 *</Text>
          <TextArea
            rows={3}
            style={{ marginTop: 4, marginBottom: 8 }}
            value={ignoreComment}
            onChange={(e) => setIgnoreComment(e.target.value)}
            placeholder="请说明忽略该风险的原因"
            maxLength={200}
            showCount
          />
        </div>
      </Modal>

      {/* 转人工弹窗 */}
      <Modal
        title="转人工复核"
        open={modal === 'transfer'}
        onCancel={() => setModal(null)}
        onOk={handleTransfer}
        confirmLoading={submitting}
        okText="提交"
        cancelText="取消"
        styles={{ body: { paddingBottom: 24 } }}
      >
        <Paragraph style={{ fontSize: 13, color: COLORS.textSecondary }}>
          该风险将转由法务人员人工复核，请填写转复核说明。
        </Paragraph>
        <TextArea
          rows={4}
          value={transferComment}
          onChange={(e) => setTransferComment(e.target.value)}
          placeholder="请说明需要法务复核的具体问题"
          maxLength={300}
          showCount
          style={{ marginBottom: 8 }}
        />
      </Modal>

      {/* 添加备注弹窗 */}
      <Modal
        title="添加备注"
        open={modal === 'comment'}
        onCancel={() => setModal(null)}
        onOk={handleAddComment}
        confirmLoading={submitting}
        okText="添加"
        cancelText="取消"
        styles={{ body: { paddingBottom: 24 } }}
      >
        <TextArea
          rows={4}
          value={commentValue}
          onChange={(e) => setCommentValue(e.target.value)}
          placeholder="请输入备注内容（不影响风险处理状态）"
          maxLength={300}
          showCount
          style={{ marginBottom: 8 }}
        />
      </Modal>
    </div>
  );
}

/**
 * memo 包裹：父组件 ReviewDetailPage 重渲染时，仅当 props 变化才重渲染对应卡片
 * 配合父层 useCallback 稳定 onActivate/onChanged，可显著降低大规模风险列表的重渲染开销
 */
const RiskCard = memo(RiskCardInner);
RiskCard.displayName = 'RiskCard';
export default RiskCard;
