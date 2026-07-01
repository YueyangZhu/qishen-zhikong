/**
 * P08 法务复核页
 * - 查看合同信息与 AI 风险
 * - 查看业务人员处理结果
 * - 修改建议、确认风险、新增人工风险
 * - 退回业务人员（必填原因）
 * - 选择最终结论并完成审核
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card, Typography, Space, Button, Tag, Empty, Skeleton, App, Alert, Descriptions, Modal, Input, Select, Statistic, Row, Col, Collapse, Tooltip,
} from 'antd';
import {
  ArrowLeft, Check, Edit3, Send, RotateCcw, Plus, Scale, FileText, ShieldCheck, AlertTriangle, MessageSquare,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { reviewService } from '@/services/reviewService';
import { riskService } from '@/services/riskService';
import { fieldService } from '@/services/fieldService';
import {
  COLORS, RISK_LEVEL_MAP, RISK_CATEGORY_MAP, LEGAL_CONCLUSION_MAP, DISCLAIMER,
} from '@/constants';
import {
  calcRiskCount, calcRiskScore, getMaxRiskLevel, getProcessedStats, getMajorRisks,
} from '@/utils/logic';
import { formatMoney, formatDateTime } from '@/utils/format';
import { RiskLevelTag, RiskStatusTag } from '@/components/StatusTag';
import PageHeader from '@/components/PageHeader';
import type { ReviewTask, RiskItem, ExtractedField, LegalConclusion } from '@/types';

const { TextArea } = Input;
const { Text, Paragraph, Title } = Typography;

export default function LegalReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuthStore();
  const { message, modal } = App.useApp();

  const [loading, setLoading] = useState(true);
  const [task, setTask] = useState<ReviewTask | null>(null);
  const [risks, setRisks] = useState<RiskItem[]>([]);
  const [fields, setFields] = useState<ExtractedField[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // 法务意见与结论
  const [legalOpinion, setLegalOpinion] = useState('');
  const [conclusion, setConclusion] = useState<LegalConclusion>('sign_after_modify');

  // 编辑/确认/新增弹窗
  const [editModal, setEditModal] = useState<{ risk: RiskItem } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmModal, setConfirmModal] = useState<{ risk: RiskItem } | null>(null);
  const [confirmComment, setConfirmComment] = useState('');
  const [newRiskModal, setNewRiskModal] = useState(false);
  const [newRisk, setNewRisk] = useState({
    title: '',
    riskType: 'breach' as RiskItem['riskType'],
    riskLevel: 'medium' as RiskItem['riskLevel'],
    clauseNumber: '',
    clauseTitle: '',
    originalText: '',
    riskReason: '',
    suggestion: '',
  });

  const loadData = useCallback(async (silent = false) => {
    if (!id) return;
    if (!silent) setLoading(true);
    try {
      const [t, r, f] = await Promise.all([
        reviewService.getTask(id),
        riskService.listByTask(id),
        fieldService.listByTask(id),
      ]);
      if (!t) {
        message.error('任务不存在');
        navigate('/reviews');
        return;
      }
      setTask(t);
      setRisks(r);
      setFields(f);
      setLegalOpinion(t.legalOpinion ?? '');
      setConclusion(t.legalConclusion ?? 'sign_after_modify');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id, message, navigate]);

  /** 乐观更新：法务操作成功后直接更新本地 risks state，不重新拉取 */
  const handleRiskChanged = useCallback((updatedRisk?: RiskItem) => {
    if (!updatedRisk) return;
    setRisks((prev) => prev.map((r) => (r.id === updatedRisk.id ? updatedRisk : r)));
  }, []);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const riskCount = useMemo(() => calcRiskCount(risks), [risks]);
  const riskScore = useMemo(() => calcRiskScore(risks), [risks]);
  const maxLevel = useMemo(() => getMaxRiskLevel(risks), [risks]);
  const processedStats = useMemo(() => getProcessedStats(risks), [risks]);
  const majorRisks = useMemo(() => getMajorRisks(risks), [risks]);

  const handleLegalEdit = () => {
    if (!editModal || !currentUser) return;
    if (!editValue.trim()) {
      message.warning('请输入修改后的建议');
      return;
    }
    const original = editModal.risk;
    const optimistic: RiskItem = {
      ...original,
      status: 'edited',
      editedSuggestion: editValue.trim(),
      handler: currentUser.name,
      version: original.version + 1,
      updatedAt: new Date().toISOString(),
    };
    setEditModal(null);
    handleRiskChanged(optimistic);
    message.success('法务修改建议已保存');
    riskService.legalEdit(original.id, currentUser, editValue.trim()).catch((e) => {
      message.error(e instanceof Error ? e.message : '操作失败，已回滚');
      handleRiskChanged(original);
    });
  };

  const handleConfirm = () => {
    if (!confirmModal || !currentUser) return;
    const original = confirmModal.risk;
    const optimistic: RiskItem = {
      ...original,
      status: 'confirmed',
      handleComment: confirmComment.trim() || null,
      handler: currentUser.name,
      version: original.version + 1,
      updatedAt: new Date().toISOString(),
    };
    setConfirmModal(null);
    setConfirmComment('');
    handleRiskChanged(optimistic);
    message.success('已确认该风险');
    riskService.confirm(original.id, currentUser, optimistic.handleComment ?? '').catch((e) => {
      message.error(e instanceof Error ? e.message : '操作失败，已回滚');
      handleRiskChanged(original);
    });
  };

  const handleCreateRisk = () => {
    if (!currentUser || !id) return;
    if (!newRisk.title.trim() || !newRisk.riskReason.trim()) {
      message.warning('请填写风险标题与风险说明');
      return;
    }
    const tempId = `RISK-TEMP-${Date.now()}`;
    const optimistic: RiskItem = {
      id: tempId,
      reviewTaskId: id,
      title: newRisk.title.trim(),
      riskType: newRisk.riskType,
      riskLevel: newRisk.riskLevel,
      clauseNumber: newRisk.clauseNumber || '人工补充',
      clauseTitle: newRisk.clauseTitle || '法务补充风险',
      originalText: newRisk.originalText || '（法务人工补充，无原文定位）',
      paragraphId: 'p1',
      startPosition: 0,
      endPosition: (newRisk.originalText || '').length,
      riskReason: newRisk.riskReason.trim(),
      reviewBasis: '法务人员人工识别',
      suggestion: newRisk.suggestion || '请根据业务实际情况处理',
      editedSuggestion: null,
      confidence: 1,
      sourceType: 'manual',
      ruleId: null,
      status: 'pending',
      handler: currentUser.name,
      handleComment: null,
      ignoreReason: null,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setNewRiskModal(false);
    setNewRisk({ title: '', riskType: 'breach', riskLevel: 'medium', clauseNumber: '', clauseTitle: '', originalText: '', riskReason: '', suggestion: '' });
    setRisks((prev) => [...prev, optimistic]);
    message.success('已新增人工风险');
    riskService.createManual(id, currentUser, {
      title: optimistic.title,
      riskType: optimistic.riskType,
      riskLevel: optimistic.riskLevel,
      clauseNumber: optimistic.clauseNumber,
      clauseTitle: optimistic.clauseTitle,
      originalText: optimistic.originalText,
      paragraphId: 'p1',
      riskReason: optimistic.riskReason,
      reviewBasis: optimistic.reviewBasis,
      suggestion: optimistic.suggestion,
    }).then((created) => {
      // 用真实 id 替换临时 id
      setRisks((prev) => prev.map((r) => (r.id === tempId ? created : r)));
    }).catch((e) => {
      message.error(e instanceof Error ? e.message : '操作失败，已移除');
      setRisks((prev) => prev.filter((r) => r.id !== tempId));
    });
  };

  const handleReject = () => {
    if (!task || !currentUser) return;
    let opinion = '';
    modal.confirm({
      title: '退回业务人员',
      content: (
        <div>
          <Paragraph style={{ color: COLORS.textSecondary }}>退回后任务状态将变为「待人工确认」，业务人员需根据法务意见重新处理。</Paragraph>
          <TextArea rows={4} placeholder="请填写退回原因（必填）" onChange={(e) => (opinion = e.target.value)} />
        </div>
      ),
      okText: '确认退回',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        if (!opinion.trim()) {
          message.error('请填写退回原因');
          return Promise.reject();
        }
        setSubmitting(true);
        try {
          await reviewService.legalReview(task.id, currentUser, { action: 'reject', opinion: opinion.trim() });
          message.success('已退回业务人员');
          navigate('/reviews');
        } catch (e) {
          message.error(e instanceof Error ? e.message : '操作失败');
        } finally {
          setSubmitting(false);
        }
      },
    });
  };

  const handleApprove = () => {
    if (!task || !currentUser) return;
    if (!legalOpinion.trim()) {
      message.warning('请填写法务意见');
      return;
    }
    modal.confirm({
      title: '完成法务审核',
      content: (
        <div>
          <Paragraph>最终结论：<Text strong style={{ color: LEGAL_CONCLUSION_MAP[conclusion].color }}>{LEGAL_CONCLUSION_MAP[conclusion].label}</Text></Paragraph>
          <Paragraph style={{ color: COLORS.textSecondary }}>{LEGAL_CONCLUSION_MAP[conclusion].desc}</Paragraph>
          <Alert type="info" message="完成后将自动生成审核报告，任务状态变为已完成。" />
        </div>
      ),
      okText: '确认完成',
      cancelText: '取消',
      onOk: async () => {
        setSubmitting(true);
        try {
          await reviewService.legalReview(task.id, currentUser, {
            action: 'approve',
            opinion: legalOpinion.trim(),
            conclusion,
          });
          message.success('法务审核已完成');
          // 自动生成报告
          try {
            await import('@/services/reportService').then((m) => m.reportService.generate(task.id, currentUser));
            message.success('审核报告已生成');
          } catch {
            // 报告生成失败不阻断
          }
          navigate('/reviews');
        } catch (e) {
          message.error(e instanceof Error ? e.message : '操作失败');
        } finally {
          setSubmitting(false);
        }
      },
    });
  };

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (!task) return null;

  const canReview = task.status === 'pending_legal';

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <PageHeader
        title="法务复核"
        description={
          <Space>
            <Text>{task.contractName}</Text>
            <RiskLevelTag level={maxLevel ?? 'low'} showDot />
          </Space>
        }
        backUrl={`/reviews/${task.id}`}
      />

      {!canReview && (
        <Alert
          type="warning"
          showIcon
          message="当前任务非待法务复核状态"
          description={`任务状态：${task.status}。仅待法务复核状态可执行法务操作。`}
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 综合信息 */}
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={4}>
            <Statistic title="风险评分" value={riskScore} suffix="/100" valueStyle={{ color: maxLevel ? RISK_LEVEL_MAP[maxLevel].color : COLORS.low }} />
          </Col>
          <Col span={4}>
            <Statistic title="风险总数" value={risks.length} suffix="项" />
          </Col>
          <Col span={4}>
            <Statistic title="已处理" value={processedStats.processed} suffix={`/ ${processedStats.total}`} valueStyle={{ color: COLORS.low }} />
          </Col>
          <Col span={4}>
            <Statistic title="重大风险" value={majorRisks.length} suffix="项" valueStyle={{ color: COLORS.high }} />
          </Col>
          <Col span={8}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="合同金额">{formatMoney(task.amount, task.currency)}</Descriptions.Item>
              <Descriptions.Item label="相对方">{task.counterparty}</Descriptions.Item>
              <Descriptions.Item label="发起人">{task.creatorName} · {formatDateTime(task.createdAt)}</Descriptions.Item>
            </Descriptions>
          </Col>
        </Row>
      </Card>

      {/* 合同信息摘要 */}
      <Card title="合同基本信息" size="small" style={{ marginBottom: 16 }}>
        <Descriptions column={3} size="small">
          {fields.slice(0, 9).map((f) => (
            <Descriptions.Item key={f.id} label={f.fieldLabel}>
              {f.confirmedValue ?? f.fieldValue}
            </Descriptions.Item>
          ))}
        </Descriptions>
      </Card>

      {/* 风险列表 */}
      <Card
        title={
          <Space>
            <Scale size={16} color={COLORS.primary} />
            <Text strong>风险审核（{risks.length}）</Text>
          </Space>
        }
        size="small"
        extra={
          canReview && (
            <Button size="small" icon={<Plus size={12} />} onClick={() => setNewRiskModal(true)}>
              新增人工风险
            </Button>
          )
        }
        style={{ marginBottom: 16 }}
      >
        {risks.length === 0 ? (
          <Empty description="暂无风险" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div>
            {risks.map((risk, idx) => (
              <div
                key={risk.id}
                style={{
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 6,
                  padding: 12,
                  marginBottom: 8,
                  background: risk.status === 'confirmed' ? '#f6ffed' : '#fff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <Space size={6} wrap>
                    <Tag style={{ fontSize: 11 }}>#{idx + 1}</Tag>
                    <RiskLevelTag level={risk.riskLevel} showDot />
                    <RiskStatusTag status={risk.status} />
                    <Text strong>{risk.title}</Text>
                  </Space>
                  <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>
                    {risk.clauseNumber} · 置信度 {Math.round(risk.confidence * 100)}%
                  </Text>
                </div>
                <Paragraph style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>
                  <Text strong style={{ color: COLORS.textPrimary }}>风险说明：</Text>{risk.riskReason}
                </Paragraph>
                <Paragraph style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 4 }}>
                  <Text strong style={{ color: COLORS.textPrimary }}>修改建议：</Text>{risk.editedSuggestion ?? risk.suggestion}
                </Paragraph>
                {(risk.handler || risk.handleComment) && (
                  <div style={{ padding: '4px 8px', background: '#fafbfc', borderRadius: 4, fontSize: 11, color: COLORS.textSecondary }}>
                    {risk.handler && <>业务处理人：{risk.handler} · </>}
                    {risk.handleComment && <>说明：{risk.handleComment}</>}
                  </div>
                )}
                {canReview && (
                  <Space size={4} style={{ marginTop: 8 }}>
                    {risk.status !== 'confirmed' && (
                      <Button size="small" type="primary" icon={<Check size={12} />} onClick={() => { setConfirmModal({ risk }); setConfirmComment(''); }}>
                        确认
                      </Button>
                    )}
                    <Button size="small" icon={<Edit3 size={12} />} onClick={() => { setEditModal({ risk }); setEditValue(risk.editedSuggestion ?? risk.suggestion); }}>
                      修改建议
                    </Button>
                  </Space>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 法务意见与结论 */}
      <Card title={<Space><ShieldCheck size={16} color={COLORS.ai} /><Text strong>法务意见与最终结论</Text></Space>} style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>法务审核意见 *</Text>
          <TextArea
            rows={4}
            value={legalOpinion}
            onChange={(e) => setLegalOpinion(e.target.value)}
            placeholder="请填写法务审核意见，包括对风险处理的评估、修改建议的认可情况、最终结论的依据等"
            maxLength={500}
            showCount
            disabled={!canReview}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>最终审核结论 *</Text>
          <Select
            style={{ width: '100%' }}
            value={conclusion}
            onChange={setConclusion}
            disabled={!canReview}
            options={(Object.keys(LEGAL_CONCLUSION_MAP) as LegalConclusion[]).map((k) => ({
              value: k,
              label: `${LEGAL_CONCLUSION_MAP[k].label} — ${LEGAL_CONCLUSION_MAP[k].desc}`,
            }))}
          />
        </div>
        <Alert type="warning" message={DISCLAIMER} style={{ marginBottom: 16 }} />

        {canReview && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button danger icon={<RotateCcw size={14} />} onClick={handleReject} loading={submitting}>
              退回业务人员
            </Button>
            <Button type="primary" size="large" icon={<Check size={16} />} onClick={handleApprove} loading={submitting}>
              完成法务审核
            </Button>
          </div>
        )}
      </Card>

      {/* 编辑建议弹窗 */}
      <Modal
        title="法务修改建议"
        open={!!editModal}
        onCancel={() => setEditModal(null)}
        onOk={handleLegalEdit}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        bodyStyle={{ paddingBottom: 24 }}
      >
        {editModal && (
          <>
            <Paragraph style={{ fontSize: 12, color: COLORS.textSecondary }}>
              风险：{editModal.risk.title}
            </Paragraph>
            <Text style={{ fontSize: 12 }}>当前建议</Text>
            <div style={{ padding: 8, background: '#fafbfc', borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
              {editModal.risk.editedSuggestion ?? editModal.risk.suggestion}
            </div>
            <TextArea rows={5} value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="请输入法务修改后的建议" maxLength={500} showCount style={{ marginBottom: 8 }} />
          </>
        )}
      </Modal>

      {/* 确认弹窗 */}
      <Modal
        title="确认风险"
        open={!!confirmModal}
        onCancel={() => setConfirmModal(null)}
        onOk={handleConfirm}
        confirmLoading={submitting}
        okText="确认"
        cancelText="取消"
        bodyStyle={{ paddingBottom: 24 }}
      >
        {confirmModal && (
          <>
            <Paragraph>确认风险：{confirmModal.risk.title}</Paragraph>
            <Text style={{ fontSize: 12 }}>法务备注（可选）</Text>
            <TextArea rows={3} value={confirmComment} onChange={(e) => setConfirmComment(e.target.value)} placeholder="可填写法务确认说明" style={{ marginTop: 4, marginBottom: 8 }} />
          </>
        )}
      </Modal>

      {/* 新增人工风险弹窗 */}
      <Modal
        title="新增人工风险"
        open={newRiskModal}
        onCancel={() => setNewRiskModal(false)}
        onOk={handleCreateRisk}
        confirmLoading={submitting}
        okText="新增"
        cancelText="取消"
        width={560}
        bodyStyle={{ paddingBottom: 24 }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div>
            <Text style={{ fontSize: 12 }}>风险标题 *</Text>
            <Input value={newRisk.title} onChange={(e) => setNewRisk({ ...newRisk, title: e.target.value })} placeholder="如：条款表述歧义" />
          </div>
          <Space>
            <div>
              <Text style={{ fontSize: 12 }}>风险等级</Text>
              <Select style={{ width: 140 }} value={newRisk.riskLevel} onChange={(v) => setNewRisk({ ...newRisk, riskLevel: v })} options={[
                { value: 'high', label: '高风险' }, { value: 'medium', label: '中风险' }, { value: 'low', label: '低风险' }, { value: 'notice', label: '提示项' },
              ]} />
            </div>
            <div>
              <Text style={{ fontSize: 12 }}>风险类型</Text>
              <Select style={{ width: 160 }} value={newRisk.riskType} onChange={(v) => setNewRisk({ ...newRisk, riskType: v })} options={(Object.keys(RISK_CATEGORY_MAP) as Array<keyof typeof RISK_CATEGORY_MAP>).map((k) => ({ value: k, label: RISK_CATEGORY_MAP[k].label }))} />
            </div>
          </Space>
          <div>
            <Text style={{ fontSize: 12 }}>条款位置</Text>
            <Input value={newRisk.clauseNumber} onChange={(e) => setNewRisk({ ...newRisk, clauseNumber: e.target.value })} placeholder="如：第十二条" />
          </div>
          <div>
            <Text style={{ fontSize: 12 }}>风险说明 *</Text>
            <TextArea rows={3} value={newRisk.riskReason} onChange={(e) => setNewRisk({ ...newRisk, riskReason: e.target.value })} placeholder="请说明风险原因" />
          </div>
          <div>
            <Text style={{ fontSize: 12 }}>修改建议</Text>
            <TextArea rows={3} value={newRisk.suggestion} onChange={(e) => setNewRisk({ ...newRisk, suggestion: e.target.value })} placeholder="请输入修改建议" />
          </div>
        </Space>
      </Modal>
    </div>
  );
}
