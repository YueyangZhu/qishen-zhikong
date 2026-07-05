/**
 * P08 法务复核页（三栏布局，业务闭环版）
 * - 左栏：合同结构（章节目录、风险统计）
 * - 中栏：合同原文（ContractTextView，风险高亮 + 双向定位）
 * - 右栏：综合信息 + 筛选 + 风险卡（含原文/依据/业务反馈/法务操作）
 * - 底部 Affix：法务意见 + 最终结论 + 退回/完成
 * - 法务可查看合同原文与风险上下文，避免盲判
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Card, Typography, Space, Button, Tag, Empty, Skeleton, Select, App, Tooltip, Progress, Affix, Row, Col, Statistic, Modal, Grid, Alert, Input, Collapse,
} from 'antd';
import {
  ArrowLeft, Check, Edit3, RotateCcw, Plus, Scale, FileCheck2, History, ChevronUp, ChevronDown, Sparkles, AlertTriangle,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { reviewService } from '@/services/reviewService';
import { riskService } from '@/services/riskService';
import { fieldService } from '@/services/fieldService';
import {
  COLORS, RISK_LEVEL_MAP, RISK_LEVEL_OPTIONS, RISK_CATEGORY_MAP, RISK_CATEGORY_OPTIONS,
  LEGAL_CONCLUSION_MAP, DISCLAIMER, REVIEW_FOCUS_LABEL,
} from '@/constants';
import {
  calcRiskCount, calcRiskScore, getMaxRiskLevel, getProcessedStats, getMajorRisks, extractClauseOrder,
} from '@/utils/logic';
import { formatMoney, formatDateTime } from '@/utils/format';
import { ReviewStatusTag, RiskLevelTag, RiskStatusTag } from '@/components/StatusTag';
import RiskCard from '@/features/review/RiskCard';
import ContractTextView, { type ContractTextViewHandle } from '@/features/review/ContractTextView';
import type {
  ReviewTask, RiskItem, RiskStatus, RiskCategory, RiskLevel, ParsedDocument, ExtractedField, LegalConclusion,
} from '@/types';

const { TextArea } = Input;
const { Text, Paragraph } = Typography;

/** 法务风险卡：包装 RiskCard(readOnly) + 法务操作按钮 */
interface LegalRiskCardProps {
  risk: RiskItem;
  index: number;
  total: number;
  active: boolean;
  canReview: boolean;
  onActivate: (id: string) => void;
  onChanged: (updatedRisk?: RiskItem) => void;
  onLegalConfirm: (risk: RiskItem) => void;
  onLegalEdit: (risk: RiskItem) => void;
}

function LegalRiskCard({
  risk, index, total, active, canReview, onActivate, onChanged, onLegalConfirm, onLegalEdit,
}: LegalRiskCardProps) {
  // 法务操作按钮区，叠在 RiskCard 下方
  return (
    <div
      id={`risk-card-${risk.id}`}
      style={{ marginBottom: 12 }}
    >
      <RiskCard
        risk={risk}
        index={index}
        total={total}
        active={active}
        onActivate={onActivate}
        onChanged={onChanged}
        readOnly
      />
      {/* 法务操作按钮（独立于 RiskCard 的业务操作） */}
      {canReview && (
        <div
          style={{
            marginTop: -4,
            padding: '8px 14px 12px',
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            background: active ? risk.riskLevel && RISK_LEVEL_MAP[risk.riskLevel].bg : '#fff',
            borderBottomLeftRadius: 8,
            borderBottomRightRadius: 8,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {risk.status !== 'confirmed' && risk.status !== 'edited' && (
            <>
              <Button
                size="small"
                type="primary"
                icon={<Check size={12} />}
                onClick={() => onLegalConfirm(risk)}
              >
                确认风险
              </Button>
              <Button
                size="small"
                icon={<Edit3 size={12} />}
                onClick={() => onLegalEdit(risk)}
              >
                修改建议
              </Button>
            </>
          )}
          {risk.status === 'confirmed' && (
            <Tag color="success" style={{ margin: 0, fontSize: 12, padding: '2px 8px' }}>
              <Check size={11} style={{ marginRight: 4 }} />
              法务已确认
            </Tag>
          )}
          {risk.status === 'edited' && (
            <Tag color="blue" style={{ margin: 0, fontSize: 12, padding: '2px 8px' }}>
              <Edit3 size={11} style={{ marginRight: 4 }} />
              法务已修改建议
            </Tag>
          )}
          {risk.status === 'manual_review' && (
            <Tag color="warning" style={{ margin: 0, fontSize: 12, padding: '2px 8px' }}>
              <AlertTriangle size={11} style={{ marginRight: 4 }} />
              待业务重新处理
            </Tag>
          )}
        </div>
      )}
    </div>
  );
}

export default function LegalReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuthStore();
  const { message, modal } = App.useApp();
  const contractRef = useRef<ContractTextViewHandle>(null);
  // 响应式：lg 以下垂直堆叠
  const screens = Grid.useBreakpoint();
  const isStacked = !screens.lg;

  const [loading, setLoading] = useState(true);
  const [task, setTask] = useState<ReviewTask | null>(null);
  const [risks, setRisks] = useState<RiskItem[]>([]);
  const [fields, setFields] = useState<ExtractedField[]>([]);
  const [parsedDoc, setParsedDoc] = useState<ParsedDocument | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 法务意见与结论
  const [legalOpinion, setLegalOpinion] = useState('');
  const [conclusion, setConclusion] = useState<LegalConclusion>('sign_after_modify');

  // 风险筛选
  const [activeRiskId, setActiveRiskId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RiskStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<RiskCategory | 'all'>('all');
  const [levelFilter, setLevelFilter] = useState<RiskLevel | 'all'>('all');
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [hoverSectionId, setHoverSectionId] = useState<string | null>(null);

  // 弹窗
  const [editModal, setEditModal] = useState<{ risk: RiskItem } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmModal, setConfirmModal] = useState<{ risk: RiskItem } | null>(null);
  const [confirmComment, setConfirmComment] = useState('');
  const [newRiskModal, setNewRiskModal] = useState(false);
  const [newRisk, setNewRisk] = useState<{
    title: string;
    riskType: RiskCategory;
    riskLevel: RiskLevel;
    clauseNumber: string;
    clauseTitle: string;
    originalText: string;
    paragraphId: string;
    riskReason: string;
    suggestion: string;
  }>({
    title: '', riskType: 'breach', riskLevel: 'medium',
    clauseNumber: '', clauseTitle: '', originalText: '', paragraphId: '',
    riskReason: '', suggestion: '',
  });

  // 跟踪最新 activeRiskId，供稳定回调读取
  const activeRiskIdRef = useRef<string | null>(null);
  useEffect(() => { activeRiskIdRef.current = activeRiskId; }, [activeRiskId]);

  const loadData = useCallback(async (silent = false) => {
    if (!id) return;
    if (!silent) setLoading(true);
    try {
      const t = await reviewService.getTask(id);
      if (!t) {
        message.error('任务不存在');
        navigate('/reviews');
        return;
      }
      setTask(t);
      setLegalOpinion(t.legalOpinion ?? '');
      setConclusion(t.legalConclusion ?? 'sign_after_modify');
      // 并行加载风险、字段、合同文档
      const [r, f, d] = await Promise.allSettled([
        riskService.listByTask(id),
        fieldService.listByTask(id),
        reviewService.getDocument(id),
      ]);
      if (r.status === 'fulfilled') setRisks(r.value);
      if (f.status === 'fulfilled') setFields(f.value);
      if (d.status === 'fulfilled') setParsedDoc(d.value);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id, message, navigate]);

  /** 乐观更新：法务操作成功后直接更新本地 risks state */
  const handleRiskChanged = useCallback((updatedRisk?: RiskItem) => {
    if (!updatedRisk) return;
    setRisks((prev) => prev.map((r) => (r.id === updatedRisk.id ? updatedRisk : r)));
    setTimeout(() => {
      document.getElementById(`risk-card-${updatedRisk.id}`)?.scrollIntoView({ block: 'nearest' });
    }, 60);
  }, []);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 风险统计
  const riskCount = useMemo(() => calcRiskCount(risks), [risks]);
  const riskScore = useMemo(() => calcRiskScore(risks), [risks]);
  const maxLevel = useMemo(() => getMaxRiskLevel(risks), [risks]);
  const processedStats = useMemo(() => getProcessedStats(risks), [risks]);
  const majorRisks = useMemo(() => getMajorRisks(risks), [risks]);
  const progressPercent = risks.length === 0 ? 0 : Math.round((processedStats.processed / processedStats.total) * 100);
  const overallColor = maxLevel ? RISK_LEVEL_MAP[maxLevel].color : COLORS.low;

  // 按合同位置排序
  const sortedRisks = useMemo(() => {
    const paraIndexMap = new Map((parsedDoc?.paragraphs ?? []).map((p) => [p.id, p.index]));
    const getOrder = (r: RiskItem) => {
      const paraIdx = paraIndexMap.get(r.paragraphId);
      if (paraIdx !== undefined) return { kind: 0, value: paraIdx };
      const clauseOrder = extractClauseOrder(r.clauseNumber);
      if (clauseOrder !== Infinity) return { kind: 1, value: clauseOrder };
      return { kind: 2, value: new Date(r.createdAt).getTime() };
    };
    return [...risks].sort((a, b) => {
      const ao = getOrder(a);
      const bo = getOrder(b);
      if (ao.kind !== bo.kind) return ao.kind - bo.kind;
      if (ao.value !== bo.value) return (ao.value as number) - (bo.value as number);
      return a.startPosition - b.startPosition;
    });
  }, [risks, parsedDoc]);

  // 筛选
  const filteredRisks = useMemo(() => {
    let list = sortedRisks;
    if (statusFilter !== 'all') list = list.filter((r) => r.status === statusFilter);
    if (typeFilter !== 'all') list = list.filter((r) => r.riskType === typeFilter);
    if (levelFilter !== 'all') list = list.filter((r) => r.riskLevel === levelFilter);
    if (sectionFilter && sectionFilter !== 'all') {
      const sec = parsedDoc?.sections.find((s) => s.id === sectionFilter);
      if (sec) {
        const pidSet = new Set(sec.paragraphIds);
        list = list.filter((r) => pidSet.has(r.paragraphId));
      }
    }
    return list;
  }, [sortedRisks, statusFilter, typeFilter, levelFilter, sectionFilter, parsedDoc]);

  // 当前选中风险索引
  const activeRiskIndex = useMemo(() => {
    if (!activeRiskId) return -1;
    return filteredRisks.findIndex((r) => r.id === activeRiskId);
  }, [filteredRisks, activeRiskId]);

  // 默认选中第一个未处理风险
  useEffect(() => {
    if (activeRiskId || filteredRisks.length === 0 || !parsedDoc) return;
    const firstPending = filteredRisks.find((r) => r.status === 'pending' || r.status === 'manual_review');
    setActiveRiskId((firstPending ?? filteredRisks[0]).id);
  }, [activeRiskId, filteredRisks, parsedDoc]);

  const handlePrevRisk = () => {
    if (filteredRisks.length === 0) return;
    const nextIdx = activeRiskIndex <= 0 ? filteredRisks.length - 1 : activeRiskIndex - 1;
    const next = filteredRisks[nextIdx];
    setActiveRiskId(next.id);
    contractRef.current?.scrollToParagraph(next.paragraphId);
  };

  const handleNextRisk = () => {
    if (filteredRisks.length === 0) return;
    const nextIdx = activeRiskIndex >= filteredRisks.length - 1 ? 0 : activeRiskIndex + 1;
    const next = filteredRisks[nextIdx];
    setActiveRiskId(next.id);
    contractRef.current?.scrollToParagraph(next.paragraphId);
  };

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
    }, 50);
  }, [risks]);

  // ===== 法务操作 =====

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

  const openLegalEdit = (risk: RiskItem) => {
    setEditValue(risk.editedSuggestion ?? risk.suggestion);
    setEditModal({ risk });
  };

  const openConfirm = (risk: RiskItem) => {
    setConfirmComment('');
    setConfirmModal({ risk });
  };

  const handleCreateRisk = () => {
    if (!currentUser || !id) return;
    if (!newRisk.title.trim() || !newRisk.riskReason.trim()) {
      message.warning('请填写风险标题与风险说明');
      return;
    }
    // 关联段落：选择段落则使用所选；未选则使用空字符串（无原文定位）
    const selectedPara = parsedDoc?.paragraphs.find((p) => p.id === newRisk.paragraphId);
    const paragraphId = selectedPara ? selectedPara.id : '';
    const originalText = newRisk.originalText || (selectedPara ? selectedPara.text : '（法务人工补充，无原文定位）');
    const tempId = `RISK-TEMP-${Date.now()}`;
    const optimistic: RiskItem = {
      id: tempId,
      reviewTaskId: id,
      title: newRisk.title.trim(),
      riskType: newRisk.riskType,
      riskLevel: newRisk.riskLevel,
      clauseNumber: newRisk.clauseNumber || (selectedPara?.clauseNo ?? '人工补充'),
      clauseTitle: newRisk.clauseTitle || (selectedPara?.clauseTitle ?? '法务补充风险'),
      originalText,
      paragraphId,
      startPosition: 0,
      endPosition: originalText.length,
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
    setNewRisk({
      title: '', riskType: 'breach', riskLevel: 'medium',
      clauseNumber: '', clauseTitle: '', originalText: '', paragraphId: '',
      riskReason: '', suggestion: '',
    });
    setRisks((prev) => [...prev, optimistic]);
    message.success('已新增人工风险');
    riskService.createManual(id, currentUser, {
      title: optimistic.title,
      riskType: optimistic.riskType,
      riskLevel: optimistic.riskLevel,
      clauseNumber: optimistic.clauseNumber,
      clauseTitle: optimistic.clauseTitle,
      originalText: optimistic.originalText,
      paragraphId,
      riskReason: optimistic.riskReason,
      reviewBasis: optimistic.reviewBasis,
      suggestion: optimistic.suggestion,
    }).then((created) => {
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
    // 前置校验：无未处理 high 风险
    const pendingHigh = risks.filter((r) => r.riskLevel === 'high' && r.status === 'pending');
    if (pendingHigh.length > 0) {
      modal.error({
        title: '存在未处理的高风险',
        content: (
          <div>
            <Paragraph>以下 {pendingHigh.length} 项高风险未处理，无法完成法务审核：</Paragraph>
            <ul style={{ paddingLeft: 20 }}>
              {pendingHigh.slice(0, 5).map((r) => (
                <li key={r.id} style={{ marginBottom: 4 }}>{r.title}</li>
              ))}
              {pendingHigh.length > 5 && <li>...等 {pendingHigh.length} 项</li>}
            </ul>
            <Paragraph style={{ color: COLORS.textSecondary, marginTop: 8 }}>请先确认或退回业务人员处理。</Paragraph>
          </div>
        ),
        okText: '我知道了',
      });
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
          message.success('法务审核已完成，已生成审核报告');
          navigate(`/reports`);
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
    <div style={{ height: 'calc(100vh - 56px - 40px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 顶部任务信息条 */}
      <Card
        style={{ marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', flexShrink: 0 }}
        styles={{ body: { padding: '10px 16px' } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Space size={6}>
            <Link to={`/reviews/${task.id}`}>
              <Button type="text" size="small" icon={<ArrowLeft size={14} />}>返回</Button>
            </Link>
            <ReviewStatusTag status={task.status} />
            {maxLevel && <RiskLevelTag level={maxLevel} showDot />}
            <Tag color="purple" style={{ margin: 0, fontSize: 11 }}>
              <Scale size={11} style={{ marginRight: 4 }} />
              法务复核
            </Tag>
          </Space>
          <div style={{ flex: 1, minWidth: 200, overflow: 'hidden' }}>
            <Text strong ellipsis style={{ fontSize: 15, color: COLORS.textPrimary }}>
              {task.contractName}
            </Text>
          </div>
          <Space size={6}>
            <Link to={`/reviews/${task.id}/fields`}>
              <Button size="small" icon={<FileCheck2 size={14} />}>字段信息</Button>
            </Link>
            <Link to={`/reviews/${task.id}/history`}>
              <Button size="small" icon={<History size={14} />}>审核记录</Button>
            </Link>
          </Space>
        </div>
        <div style={{ marginTop: 4, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>编号：{task.contractNo}</Text>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>相对方：{task.counterparty}</Text>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>金额：{formatMoney(task.amount, task.currency)}</Text>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>发起人：{task.creatorName}</Text>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>更新：{formatDateTime(task.updatedAt)}</Text>
          {task.reviewFocus && task.reviewFocus.length > 0 && (
            <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>
              审核重点：{task.reviewFocus.map((f) => REVIEW_FOCUS_LABEL[f] ?? f).join('、')}
            </Text>
          )}
        </div>
        {!canReview && (
          <Alert
            type="warning"
            showIcon
            message="当前任务非待法务复核状态"
            description={`任务状态：${task.status}。仅待法务复核状态可执行法务操作，下方信息为只读查看。`}
            style={{ marginTop: 8 }}
            banner
          />
        )}
      </Card>

      {/* 三栏布局 */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflow: isStacked ? 'auto' : 'hidden',
        display: 'flex',
        gap: 12,
        flexDirection: isStacked ? 'column' : 'row',
      }}>
        {/* 左栏：合同结构 */}
        <div style={{ width: isStacked ? '100%' : 240, flexShrink: 0, height: isStacked ? 'auto' : '100%', flex: isStacked ? '1 1 200' : '0 0 auto', minHeight: isStacked ? 200 : 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Card
            size="small"
            title={<Text strong style={{ fontSize: 14 }}>合同结构</Text>}
            styles={{ body: { padding: 12, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } }}
            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ marginBottom: 8, flexShrink: 0 }}>
              <Link to={`/reviews/${task.id}/fields`}>
                <Button type="text" size="small" block style={{ textAlign: 'left', padding: '4px 8px' }}>
                  <FileCheck2 size={12} style={{ marginRight: 6 }} />
                  合同信息字段
                </Button>
              </Link>
            </div>
            <Paragraph style={{ fontSize: 11, color: COLORS.textSecondary, margin: '4px 8px 8px', flexShrink: 0 }}>
              合同章节（共 {(parsedDoc?.sections ?? []).length} 节 · {risks.length} 项风险）
            </Paragraph>
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0, paddingRight: 2 }}>
              {(() => {
                const sections = parsedDoc?.sections ?? [];
                if (sections.length === 0) {
                  return <Empty description="暂无合同结构" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 40 }} />;
                }
                const riskCountByPara = new Map<string, number>();
                risks.forEach((r) => riskCountByPara.set(r.paragraphId, (riskCountByPara.get(r.paragraphId) ?? 0) + 1));
                return sections.map((sec) => {
                  const sectionRiskCount = sec.paragraphIds.reduce((sum, pid) => sum + (riskCountByPara.get(pid) ?? 0), 0);
                  const firstParaId = sec.paragraphIds[0];
                  return (
                    <div
                      key={sec.id}
                      onClick={() => firstParaId && contractRef.current?.scrollToParagraph(firstParaId)}
                      onMouseEnter={() => setHoverSectionId(sec.id)}
                      onMouseLeave={() => setHoverSectionId(null)}
                      style={{
                        padding: '6px 8px',
                        cursor: 'pointer',
                        borderRadius: 4,
                        background: hoverSectionId === sec.id ? '#f5f5f5' : 'transparent',
                        fontSize: 12,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 2,
                      }}
                    >
                      <span style={{ color: COLORS.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sec.clauseNo ? `${sec.clauseNo} ${sec.title}` : sec.title}
                      </span>
                      {sectionRiskCount > 0 && (
                        <Tag color="red" style={{ margin: 0, fontSize: 10, flexShrink: 0 }}>{sectionRiskCount}</Tag>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </Card>
        </div>

        {/* 中栏：合同原文 */}
        <Card style={{ flex: isStacked ? '1 1 360' : 1, minWidth: isStacked ? 'auto' : 360, width: isStacked ? '100%' : 'auto', height: isStacked ? 360 : '100%', minHeight: isStacked ? 360 : '100%', overflow: 'hidden', padding: 0 }} styles={{ body: { padding: 0, height: '100%' } }}>
          <ContractTextView
            ref={contractRef}
            paragraphs={parsedDoc?.paragraphs ?? []}
            risks={risks}
            activeRiskId={activeRiskId}
            onActivateRisk={handleActivateRisk}
            fileName={task?.fileName}
            taskId={id}
            htmlContent={parsedDoc?.htmlContent}
            sampleId={task?.sampleId}
          />
        </Card>

        {/* 右栏：综合信息 + 筛选 + 风险卡列表 */}
        <div style={{ width: isStacked ? '100%' : 400, flexShrink: 0, height: isStacked ? 'auto' : '100%', flex: isStacked ? '1 1 360' : '0 0 auto', minHeight: isStacked ? 360 : 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* 综合信息卡 */}
          <Card size="small" style={{ marginBottom: 8 }} styles={{ body: { padding: 12 } }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Space>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: '#e6fffb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Scale size={16} color={COLORS.primary} />
                </div>
                <div>
                  <Text strong style={{ fontSize: 13 }}>法务复核</Text>
                  <Text style={{ fontSize: 11, color: COLORS.textSecondary, display: 'block' }}>业务反馈 + 法务确认</Text>
                </div>
              </Space>
              {maxLevel && <RiskLevelTag level={maxLevel} showDot />}
            </div>
            <Row gutter={12}>
              <Col span={6}>
                <Statistic
                  title={<Text style={{ fontSize: 11 }}>风险评分</Text>}
                  value={riskScore}
                  suffix="/100"
                  valueStyle={{ color: overallColor, fontSize: 20, fontWeight: 700 }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title={<Text style={{ fontSize: 11 }}>风险总数</Text>}
                  value={risks.length}
                  suffix="项"
                  valueStyle={{ fontSize: 20, fontWeight: 700 }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title={<Text style={{ fontSize: 11 }}>已处理</Text>}
                  value={processedStats.processed}
                  suffix={`/ ${processedStats.total}`}
                  valueStyle={{ fontSize: 20, fontWeight: 700, color: COLORS.low }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title={<Text style={{ fontSize: 11 }}>重大风险</Text>}
                  value={majorRisks.length}
                  suffix="项"
                  valueStyle={{ fontSize: 20, fontWeight: 700, color: COLORS.high }}
                />
              </Col>
            </Row>
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>处理进度</Text>
                <Text style={{ fontSize: 11 }}>{processedStats.processed}/{processedStats.total}</Text>
              </div>
              <Progress percent={progressPercent} size="small" strokeColor={{ from: COLORS.primary, to: COLORS.ai }} />
            </div>
          </Card>

          {/* 风险导航 + 筛选 */}
          <div style={{ marginBottom: 8, padding: '0 4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Space size={6} align="center">
                <Text strong style={{ fontSize: 13 }}>
                  风险明细（{filteredRisks.length}）
                </Text>
                {canReview && (
                  <Button size="small" type="text" icon={<Plus size={12} />} onClick={() => setNewRiskModal(true)}>
                    新增人工风险
                  </Button>
                )}
              </Space>
              <Space size={4}>
                <Tooltip title="上一条">
                  <Button type="text" size="small" icon={<ChevronUp size={14} />} onClick={handlePrevRisk} disabled={filteredRisks.length === 0} />
                </Tooltip>
                <Tooltip title="下一条">
                  <Button type="text" size="small" icon={<ChevronDown size={14} />} onClick={handleNextRisk} disabled={filteredRisks.length === 0} />
                </Tooltip>
              </Space>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Select
                size="small"
                style={{ width: '100%' }}
                value={sectionFilter}
                onChange={(v) => setSectionFilter(v)}
                options={[
                  { value: 'all', label: '全部章节' },
                  ...(parsedDoc?.sections ?? []).map((s) => ({
                    value: s.id,
                    label: s.clauseNo ? `${s.clauseNo} ${s.title}` : s.title,
                  })),
                ]}
              />
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Select
                  size="small"
                  style={{ flex: 1, minWidth: 80 }}
                  value={levelFilter}
                  onChange={(v) => setLevelFilter(v)}
                  options={[{ value: 'all', label: '全部等级' }, ...RISK_LEVEL_OPTIONS]}
                />
                <Select
                  size="small"
                  style={{ flex: 1, minWidth: 80 }}
                  value={statusFilter}
                  onChange={(v) => setStatusFilter(v)}
                  options={[
                    { value: 'all', label: '全部状态' },
                    { value: 'pending', label: '待处理' },
                    { value: 'accepted', label: '已接受' },
                    { value: 'edited', label: '已编辑' },
                    { value: 'ignored', label: '已忽略' },
                    { value: 'manual_review', label: '转人工' },
                    { value: 'confirmed', label: '已确认' },
                  ]}
                />
                <Select
                  size="small"
                  style={{ flex: 1, minWidth: 80 }}
                  value={typeFilter}
                  onChange={(v) => setTypeFilter(v)}
                  options={[{ value: 'all', label: '全部类型' }, ...RISK_CATEGORY_OPTIONS]}
                />
                {(statusFilter !== 'all' || typeFilter !== 'all' || levelFilter !== 'all' || sectionFilter !== 'all') && (
                  <Button type="link" size="small" style={{ padding: 0, flexShrink: 0 }} onClick={() => { setStatusFilter('all'); setTypeFilter('all'); setLevelFilter('all'); setSectionFilter('all'); }}>
                    清空
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* 风险卡列表 */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
            {filteredRisks.length === 0 ? (
              <Empty description={risks.length === 0 ? '暂无风险数据' : '无符合筛选条件的风险'} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ paddingTop: 40 }} />
            ) : (
              filteredRisks.map((risk, idx) => {
                const useVirtualOpt = filteredRisks.length > 30;
                return (
                  <div
                    key={risk.id}
                    style={useVirtualOpt ? {
                      contentVisibility: 'auto',
                      containIntrinsicSize: 'auto 400px',
                    } : undefined}
                  >
                    <LegalRiskCard
                      risk={risk}
                      index={idx}
                      total={filteredRisks.length}
                      active={risk.id === activeRiskId}
                      canReview={canReview}
                      onActivate={handleActivateRisk}
                      onChanged={handleRiskChanged}
                      onLegalConfirm={openConfirm}
                      onLegalEdit={openLegalEdit}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 底部 Affix：法务意见 + 结论 + 退回/完成 */}
      <Affix offsetBottom={0}>
        <Card size="small" style={{ marginTop: 12, boxShadow: '0 -2px 8px rgba(0,0,0,0.06)' }} styles={{ body: { padding: '12px 16px' } }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 320 }}>
              <Text strong style={{ fontSize: 13 }}>
                法务意见 <Text type="danger">*</Text>
              </Text>
              <TextArea
                rows={2}
                value={legalOpinion}
                onChange={(e) => setLegalOpinion(e.target.value)}
                placeholder="请填写法务综合意见，完成后将作为审核报告的法务结论"
                disabled={!canReview}
                style={{ marginTop: 4 }}
                maxLength={500}
                showCount
              />
            </div>
            <div style={{ width: 200 }}>
              <Text strong style={{ fontSize: 13 }}>最终结论</Text>
              <Select
                value={conclusion}
                onChange={(v) => setConclusion(v)}
                style={{ width: '100%', marginTop: 4 }}
                disabled={!canReview}
                options={Object.entries(LEGAL_CONCLUSION_MAP).map(([k, v]) => ({ value: k as LegalConclusion, label: v.label }))}
              />
              <Text style={{ fontSize: 11, color: COLORS.textSecondary, display: 'block', marginTop: 4 }}>
                {LEGAL_CONCLUSION_MAP[conclusion].desc}
              </Text>
            </div>
            <Space direction="vertical" style={{ flexShrink: 0 }}>
              <Button danger block icon={<RotateCcw size={14} />} onClick={handleReject} disabled={!canReview} loading={submitting}>
                退回业务人员
              </Button>
              <Button type="primary" block icon={<Check size={14} />} onClick={handleApprove} disabled={!canReview} loading={submitting}>
                完成法务审核
              </Button>
            </Space>
          </div>
          <Alert type="warning" message={DISCLAIMER} style={{ marginTop: 8 }} banner />
        </Card>
      </Affix>

      {/* 法务修改建议弹窗 */}
      <Modal
        title="法务修改建议"
        open={!!editModal}
        onCancel={() => setEditModal(null)}
        onOk={handleLegalEdit}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        width={560}
        styles={{ body: { paddingBottom: 24 } }}
      >
        {editModal && (
          <>
            <div style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>风险标题</Text>
              <div style={{ padding: 8, background: '#fafbfc', borderRadius: 4, fontSize: 13, marginTop: 4 }}>
                <Text strong>{editModal.risk.title}</Text>
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>合同原文</Text>
              <div style={{ padding: 8, background: RISK_LEVEL_MAP[editModal.risk.riskLevel].bg, borderRadius: 4, fontSize: 12, marginTop: 4, borderLeft: `3px solid ${RISK_LEVEL_MAP[editModal.risk.riskLevel].color}` }}>
                {editModal.risk.originalText}
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>当前建议</Text>
              <div style={{ padding: 8, background: '#fafbfc', borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
                {editModal.risk.editedSuggestion ?? editModal.risk.suggestion}
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>修改后的建议</Text>
            </div>
            <TextArea
              rows={5}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder="请输入法务修改后的建议"
              maxLength={500}
              showCount
            />
          </>
        )}
      </Modal>

      {/* 法务确认弹窗 */}
      <Modal
        title="确认风险"
        open={!!confirmModal}
        onCancel={() => setConfirmModal(null)}
        onOk={handleConfirm}
        confirmLoading={submitting}
        okText="确认"
        cancelText="取消"
        styles={{ body: { paddingBottom: 24 } }}
      >
        {confirmModal && (
          <>
            <div style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>风险标题</Text>
              <div style={{ padding: 8, background: '#fafbfc', borderRadius: 4, fontSize: 13, marginTop: 4 }}>
                <Text strong>{confirmModal.risk.title}</Text>
                <div style={{ marginTop: 4, fontSize: 12, color: COLORS.textSecondary }}>
                  {confirmModal.risk.clauseNumber} {confirmModal.risk.clauseTitle}
                </div>
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>合同原文</Text>
              <div style={{ padding: 8, background: RISK_LEVEL_MAP[confirmModal.risk.riskLevel].bg, borderRadius: 4, fontSize: 12, marginTop: 4, borderLeft: `3px solid ${RISK_LEVEL_MAP[confirmModal.risk.riskLevel].color}` }}>
                {confirmModal.risk.originalText}
              </div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>业务处理结果</Text>
              <div style={{ padding: 8, background: '#fafbfc', borderRadius: 4, fontSize: 12, marginTop: 4 }}>
                <RiskStatusTag status={confirmModal.risk.status} />
                {confirmModal.risk.handler && <span style={{ marginLeft: 8 }}>处理人：{confirmModal.risk.handler}</span>}
              </div>
              {confirmModal.risk.handleComment && (
                <div style={{ padding: 8, background: '#fafbfc', borderRadius: 4, fontSize: 12, marginTop: 4 }}>
                  处理说明：{confirmModal.risk.handleComment}
                </div>
              )}
            </div>
            <div>
              <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>法务备注（可选）</Text>
              <TextArea
                rows={3}
                value={confirmComment}
                onChange={(e) => setConfirmComment(e.target.value)}
                placeholder="可填写法务确认说明"
                style={{ marginTop: 4 }}
                maxLength={200}
                showCount
              />
            </div>
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
        width={600}
        styles={{ body: { paddingBottom: 24 } }}
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
              <Select style={{ width: 180 }} value={newRisk.riskType} onChange={(v) => setNewRisk({ ...newRisk, riskType: v })} options={(Object.keys(RISK_CATEGORY_MAP) as Array<keyof typeof RISK_CATEGORY_MAP>).map((k) => ({ value: k, label: RISK_CATEGORY_MAP[k].label }))} />
            </div>
          </Space>
          <div>
            <Text style={{ fontSize: 12 }}>关联段落（选择后可在原文高亮定位）</Text>
            <Select
              style={{ width: '100%', marginTop: 4 }}
              value={newRisk.paragraphId || undefined}
              onChange={(v) => setNewRisk({ ...newRisk, paragraphId: v ?? '' })}
              placeholder="可选择合同段落关联原文（可选）"
              allowClear
              showSearch
              optionFilterProp="label"
              options={(parsedDoc?.paragraphs ?? []).map((p) => ({
                value: p.id,
                label: `[${p.clauseNo ?? p.id}] ${p.text.slice(0, 50)}${p.text.length > 50 ? '...' : ''}`,
              }))}
            />
          </div>
          <div>
            <Text style={{ fontSize: 12 }}>条款位置</Text>
            <Input value={newRisk.clauseNumber} onChange={(e) => setNewRisk({ ...newRisk, clauseNumber: e.target.value })} placeholder="如：第十二条（不填则取关联段落的条款号）" />
          </div>
          <div>
            <Text style={{ fontSize: 12 }}>原文片段（不填则使用关联段落全文）</Text>
            <TextArea
              rows={2}
              value={newRisk.originalText}
              onChange={(e) => setNewRisk({ ...newRisk, originalText: e.target.value })}
              placeholder="可粘贴风险对应的原文片段，便于精确高亮"
              maxLength={300}
              showCount
            />
          </div>
          <div>
            <Text style={{ fontSize: 12 }}>风险说明 *</Text>
            <TextArea rows={3} value={newRisk.riskReason} onChange={(e) => setNewRisk({ ...newRisk, riskReason: e.target.value })} placeholder="请说明风险原因" maxLength={500} showCount />
          </div>
          <div>
            <Text style={{ fontSize: 12 }}>修改建议</Text>
            <TextArea rows={3} value={newRisk.suggestion} onChange={(e) => setNewRisk({ ...newRisk, suggestion: e.target.value })} placeholder="请输入修改建议" maxLength={500} showCount />
          </div>
        </Space>
      </Modal>
    </div>
  );
}
