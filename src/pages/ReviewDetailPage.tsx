/**
 * P07 合同审核详情页（核心页面，三栏布局）
 * 左栏：合同结构与筛选（章节目录、风险统计、筛选）
 * 中栏：合同原文（段落、风险高亮、双向定位）
 * 右栏：AI审核结果（综合等级、评分、风险卡片、处理操作）
 * 底部操作区：保存、提交法务复核、生成报告、返回列表
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Card, Typography, Space, Button, Tag, Empty, Skeleton, Select, App, Tooltip, Progress, Affix, Row, Col, Statistic, Modal, Grid, Alert,
} from 'antd';
import {
  ArrowLeft, FileText, AlertTriangle, Sparkles, FileBarChart, ChevronUp, ChevronDown, Send, FileCheck2, History, Edit3,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { reviewService } from '@/services/reviewService';
import { riskService } from '@/services/riskService';
import { fieldService } from '@/services/fieldService';
import { reportService } from '@/services/reportService';
import {
  COLORS, RISK_LEVEL_MAP, RISK_LEVEL_OPTIONS, RISK_CATEGORY_MAP, RISK_CATEGORY_OPTIONS, REVIEW_FOCUS_LABEL,
} from '@/constants';
import {
  calcRiskCount, calcRiskScore, getMaxRiskLevel, getProcessedStats, getConfidenceLevel, checkCanSubmitForLegalReview,
  extractClauseOrder,
} from '@/utils/logic';
import { formatMoney, formatDateTime } from '@/utils/format';
import { ReviewStatusTag, RiskLevelTag, RiskStatusTag } from '@/components/StatusTag';
import RiskCard from '@/features/review/RiskCard';
import ContractTextView, { type ContractTextViewHandle } from '@/features/review/ContractTextView';
import type { ReviewTask, RiskItem, RiskStatus, RiskCategory, RiskLevel, ParsedDocument } from '@/types';

const { Text, Paragraph, Title } = Typography;

export default function ReviewDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuthStore();
  const { message, modal } = App.useApp();
  const contractRef = useRef<ContractTextViewHandle>(null);
  // 响应式断点：lg 以下（< 992px，如平板/小屏笔记本）改为垂直堆叠布局
  const screens = Grid.useBreakpoint();
  const isStacked = !screens.lg;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [risksError, setRisksError] = useState<string | null>(null);
  const [task, setTask] = useState<ReviewTask | null>(null);
  const [risks, setRisks] = useState<RiskItem[]>([]);
  const [activeRiskId, setActiveRiskId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RiskStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<RiskCategory | 'all'>('all');
  const [levelFilter, setLevelFilter] = useState<RiskLevel | 'all'>('all');
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [hoverSectionId, setHoverSectionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 跟踪最新 activeRiskId，供 loadData 稳定回调读取，避免其依赖 activeRiskId 频繁变化
  const activeRiskIdRef = useRef<string | null>(null);
  useEffect(() => { activeRiskIdRef.current = activeRiskId; }, [activeRiskId]);

  // 合同文档（异步加载：优先真实 AI 解析结果，否则样例合同，最后默认演示合同）
  const [parsedDoc, setParsedDoc] = useState<ParsedDocument | null>(null);

  const loadData = useCallback(async (silent = false) => {
    if (!id) return;
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      // 第一步：先加载 task（快速显示页面框架）
      const t = await reviewService.getTask(id);
      if (!t) {
        message.error('审核任务不存在');
        navigate('/reviews');
        return;
      }
      setTask(t);

      // 第二步：并行加载风险列表和合同文档（慢请求，后台跑）
      // 使用 Promise.allSettled 避免一个失败导致另一个也拿不到数据
      const [risksResult, docResult] = await Promise.allSettled([
        riskService.listByTask(id),
        reviewService.getDocument(id),
      ]);

      // 风险列表：失败时显示内联错误提示，但不阻塞页面（task 已加载）
      if (risksResult.status === 'fulfilled') {
        let risksData = risksResult.value;
        // 自动重试：从进度页跳转过来时，可能数据库写入刚提交、读取还没同步，
        // 导致首次查询返回空数组。如果 task.riskCount 显示有风险但列表为空，
        // 延迟 1.5 秒后自动重试一次（最多重试一次，避免死循环）。
        const expectedCount =
          (t.riskCount?.high ?? 0) + (t.riskCount?.medium ?? 0) +
          (t.riskCount?.low ?? 0) + (t.riskCount?.notice ?? 0);
        if (risksData.length === 0 && expectedCount > 0 && !silent) {
          console.warn(`[ReviewDetailPage] 风险列表为空但 task 统计有 ${expectedCount} 项风险，1.5s 后自动重试...`);
          await new Promise((r) => setTimeout(r, 1500));
          try {
            risksData = await riskService.listByTask(id);
            console.info(`[ReviewDetailPage] 重试完成，加载到 ${risksData.length} 项风险`);
          } catch (retryErr) {
            console.error('[ReviewDetailPage] 重试失败:', retryErr);
          }
        }
        setRisks(risksData);
        setRisksError(null);
      } else {
        // 风险加载失败：记录错误，显示重试提示，不阻塞页面
        const err = risksResult.reason;
        const msg = err instanceof Error ? err.message : '风险列表加载失败';
        setRisks([]);
        setRisksError(msg);
        console.error('[ReviewDetailPage] 风险列表加载失败:', err);
        // 401 错误向上抛，让 triggerForceLogout 处理
        if (msg.includes('登录已过期') || msg.includes('重新登录')) {
          throw err;
        }
      }

      // 合同文档：失败时降级（不阻断页面），静默处理
      if (docResult.status === 'fulfilled') {
        setParsedDoc(docResult.value);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '加载失败';
      setLoadError(msg);
      message.error(msg);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id, message, navigate]);

  /** 乐观更新：风险操作成功后直接更新本地 state，不重新拉取数据，避免整页重载闪烁 */
  const handleRiskChanged = useCallback((updatedRisk?: RiskItem) => {
    if (!updatedRisk) return; // 备注/无返回值的操作无需更新列表
    setRisks((prev) => prev.map((r) => (r.id === updatedRisk.id ? updatedRisk : r)));
    // 停留在当前卡片位置
    setTimeout(() => {
      document.getElementById(`risk-card-${updatedRisk.id}`)?.scrollIntoView({ block: 'nearest' });
    }, 60);
  }, []);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 按合同位置排序后的完整风险列表：
  // 1. 优先按段落 index（来自解析文档的真实顺序）
  // 2. 段落未匹配时，按风险自带的 clauseNumber 兜底排序
  // 3. 都没有时，按创建时间稳定排序（避免顺序随机跳动）
  // 4. 同一段落/条款内按 startPosition 排序
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

  // 筛选 + 排序后的风险（筛选条件与风险明细联动）
  const filteredRisks = useMemo(() => {
    let list = sortedRisks;
    if (statusFilter !== 'all') list = list.filter((r) => r.status === statusFilter);
    if (typeFilter !== 'all') list = list.filter((r) => r.riskType === typeFilter);
    if (levelFilter !== 'all') list = list.filter((r) => r.riskLevel === levelFilter);
    if (sectionFilter && sectionFilter !== 'all') {
      // sectionFilter 存的是 section id，按该 section 的 paragraphIds 过滤
      const sec = parsedDoc?.sections.find((s) => s.id === sectionFilter);
      if (sec) {
        const pidSet = new Set(sec.paragraphIds);
        list = list.filter((r) => pidSet.has(r.paragraphId));
      }
    }
    return list;
  }, [sortedRisks, statusFilter, typeFilter, levelFilter, sectionFilter, parsedDoc]);

  // 风险统计
  const riskCount = useMemo(() => calcRiskCount(risks), [risks]);
  const riskScore = useMemo(() => calcRiskScore(risks), [risks]);
  const maxLevel = useMemo(() => getMaxRiskLevel(risks), [risks]);
  const processedStats = useMemo(() => getProcessedStats(risks), [risks]);
  const progressPercent = risks.length === 0 ? 0 : Math.round((processedStats.processed / processedStats.total) * 100);

  // 当前选中风险在筛选列表中的索引（上下切换基于当前可见列表，与筛选联动）
  const activeRiskIndex = useMemo(() => {
    if (!activeRiskId) return -1;
    return filteredRisks.findIndex((r) => r.id === activeRiskId);
  }, [filteredRisks, activeRiskId]);

  // 数据加载完成后（parsedDoc 与 risks 均就绪），默认选中排序后的第一个未处理风险
  // 等待 parsedDoc 是为了确保 sortedRisks 已按真实段落位置排好序，避免初始选中错位
  useEffect(() => {
    if (activeRiskId || filteredRisks.length === 0 || !parsedDoc) return;
    const firstPending = filteredRisks.find((r) => r.status === 'pending');
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
    // 优先精准定位到风险原文，失败再回退到段落定位
    if (contractRef.current?.scrollToRisk) {
      contractRef.current.scrollToRisk(riskId);
    } else {
      contractRef.current?.scrollToParagraph(r.paragraphId);
    }
    // 滚动风险卡片到视图（无动效，立即跳转）
    setTimeout(() => {
      document.getElementById(`risk-card-${riskId}`)?.scrollIntoView({ block: 'start' });
    }, 50);
  }, [risks]);

  // 草稿状态发起 AI 审核
  const handleStartReviewFromDraft = async () => {
    if (!task || !currentUser) return;
    if (currentUser.role !== 'purchaser') {
      message.error('仅采购业务人员可发起审核');
      return;
    }
    setSubmitting(true);
    try {
      await reviewService.startReview(task.id, currentUser);
      message.success('已发起 AI 审核，正在解析合同...');
      setTimeout(() => navigate(`/reviews/${task.id}/progress`), 400);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '发起审核失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 提交法务复核
  const handleSubmitForLegal = () => {
    if (!task || !currentUser) return;
    if (currentUser.role !== 'purchaser') {
      message.error('仅采购业务人员可提交法务复核');
      return;
    }
    const check = checkCanSubmitForLegalReview(task, risks, false);
    if (!check.canSubmit) {
      modal.error({
        title: '无法提交法务复核',
        content: (
          <div>
            <Paragraph>请先处理以下问题：</Paragraph>
            <ul style={{ paddingLeft: 20 }}>
              {check.reasons.map((r, i) => (
                <li key={i} style={{ marginBottom: 4 }}>{r}</li>
              ))}
            </ul>
          </div>
        ),
        okText: '我知道了',
      });
      return;
    }
    const pendingRisks = risks.filter((r) => r.status === 'pending');
    modal.confirm({
      title: '提交法务复核',
      content: pendingRisks.length > 0
        ? `仍有 ${pendingRisks.length} 项未处理风险，确认提交后将由法务人员复核。是否继续？`
        : '所有风险已处理，确认提交法务复核？提交后将由法务人员复核并出具结论。',
      okText: '确认提交',
      cancelText: '取消',
      onOk: async () => {
        setSubmitting(true);
        try {
          const res = await reviewService.submitForLegalReview(task.id, currentUser);
          if (res.success) {
            message.success('已提交法务复核');
            navigate('/reviews');
          } else {
            modal.error({
              title: '提交失败',
              content: res.reasons?.join('；'),
              okText: '我知道了',
            });
          }
        } catch (e) {
          message.error(e instanceof Error ? e.message : '提交失败');
        } finally {
          setSubmitting(false);
        }
      },
    });
  };

  // 生成报告（仅 completed 状态可生成；法务审核通过时会自动生成报告）
  const handleGenerateReport = async () => {
    if (!task || !currentUser) return;
    if (task.status !== 'completed') {
      modal.info({
        title: '暂无法生成报告',
        content: '请先完成风险处理并提交法务复核，待法务审核完成后将自动生成报告。',
        okText: '我知道了',
      });
      return;
    }
    setSubmitting(true);
    try {
      const reports = await reportService.list({ reviewTaskId: task.id });
      let reportId = reports[0]?.id;
      if (!reportId) {
        const r = await reportService.generate(task.id, currentUser);
        reportId = r.id;
      }
      message.success('报告已生成');
      navigate(`/reports/${reportId}`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '生成报告失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  if (!task) {
    return (
      <Card>
        <div style={{ marginBottom: 16 }}>
          <Button type="text" size="small" icon={<ArrowLeft size={14} />} onClick={() => navigate('/reviews')}>返回</Button>
        </div>
        <div style={{ textAlign: 'center', padding: 40 }}>
          <AlertTriangle size={48} color={COLORS.high} style={{ marginBottom: 16 }} />
          <Title level={4}>加载失败</Title>
          <Paragraph style={{ color: COLORS.textSecondary, marginBottom: 24 }}>
            {loadError || '无法加载审核任务，请稍后重试'}
          </Paragraph>
          <Button type="primary" onClick={() => loadData()}>重试</Button>
        </div>
      </Card>
    );
  }

  // 草稿状态：显示任务信息 + 编辑草稿 / 立即发起审核
  if (task.status === 'draft') {
    return (
      <Card>
        <div style={{ marginBottom: 16 }}>
          <Button type="text" size="small" icon={<ArrowLeft size={14} />} onClick={() => navigate('/reviews')}>返回</Button>
        </div>
        <div style={{ textAlign: 'center', padding: 40 }}>
          <FileText size={48} color={COLORS.textSecondary} style={{ marginBottom: 16 }} />
          <Title level={4}>草稿任务未发起审核</Title>
          <Paragraph style={{ color: COLORS.textSecondary, marginBottom: 24 }}>
            合同「{task.contractName}」已保存为草稿，可继续编辑信息或直接发起 AI 审核。
          </Paragraph>
          <div style={{ background: '#fafbfc', padding: 16, borderRadius: 6, marginBottom: 24, textAlign: 'left', maxWidth: 480, margin: '0 auto 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ color: COLORS.textSecondary, fontSize: 13 }}>合同编号：</Text>
              <Text strong style={{ fontSize: 13 }}>{task.contractNo}</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ color: COLORS.textSecondary, fontSize: 13 }}>相对方：</Text>
              <Text strong style={{ fontSize: 13 }}>{task.counterparty}</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ color: COLORS.textSecondary, fontSize: 13 }}>合同金额：</Text>
              <Text strong style={{ fontSize: 13 }}>{formatMoney(task.amount, task.currency)}</Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text style={{ color: COLORS.textSecondary, fontSize: 13 }}>创建时间：</Text>
              <Text strong style={{ fontSize: 13 }}>{formatDateTime(task.createdAt)}</Text>
            </div>
          </div>
          <Space>
            {currentUser?.role === 'purchaser' && (
              <>
                <Button icon={<Edit3 size={14} />} onClick={() => navigate(`/reviews/new?draft=${task.id}`)}>
                  编辑草稿
                </Button>
                <Button type="primary" icon={<Sparkles size={14} />} loading={submitting} onClick={handleStartReviewFromDraft}>
                  立即发起审核
                </Button>
              </>
            )}
          </Space>
        </div>
      </Card>
    );
  }

  // 处理中状态提示跳转
  if (task.status === 'parsing' || task.status === 'ai_reviewing') {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: 40 }}>
          <FileText size={48} color={COLORS.primary} style={{ marginBottom: 16 }} />
          <Title level={4}>审核进行中</Title>
          <Paragraph style={{ color: COLORS.textSecondary }}>
            当前任务正在 AI 审核处理中，请前往进度页查看。
          </Paragraph>
          <Button type="primary" onClick={() => navigate(`/reviews/${task.id}/progress`)}>
            查看进度
          </Button>
        </div>
      </Card>
    );
  }

  const isLegalContext = currentUser?.role === 'legal' && task.status === 'pending_legal';
  const canSubmitForLegal = task.status === 'pending_business' && currentUser?.role === 'purchaser';
  const overallColor = maxLevel ? RISK_LEVEL_MAP[maxLevel].color : COLORS.low;

  return (
    <div style={{ height: 'calc(100vh - 56px - 40px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 顶部任务信息条：固定高度，不随页面滚动 */}
      <Card
        style={{ marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', flexShrink: 0 }}
        styles={{ body: { padding: '10px 16px' } }}
      >
        {/* 第一行：返回+状态+合同名+操作按钮 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Space size={6}>
            <Button type="text" size="small" icon={<ArrowLeft size={14} />} onClick={() => navigate(-1)}>返回</Button>
            <ReviewStatusTag status={task.status} />
            {maxLevel && <RiskLevelTag level={maxLevel} showDot />}
          </Space>
          <div style={{ flex: 1, minWidth: 200, overflow: 'hidden' }}>
            <Text strong ellipsis style={{ fontSize: 15, color: COLORS.textPrimary }}>
              {task.contractName}
            </Text>
          </div>
          <Space size={6}>
            <Link to={`/reviews/${task.id}/fields`}>
              <Button size="small" icon={<FileCheck2 size={14} />}>
                字段确认
                {!task.fieldsConfirmed && <Tag color="warning" style={{ marginLeft: 6, fontSize: 10, margin: 0, lineHeight: '16px' }}>待确认</Tag>}
              </Button>
            </Link>
            <Link to={`/reviews/${task.id}/history`}>
              <Button size="small" icon={<History size={14} />}>审核记录</Button>
            </Link>
          </Space>
        </div>
        {/* 第二行：合同元信息（紧贴，小字一行） */}
        <div style={{ marginTop: 4, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>编号：{task.contractNo}</Text>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>相对方：{task.counterparty}</Text>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>金额：{formatMoney(task.amount, task.currency)}</Text>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>更新：{formatDateTime(task.updatedAt)}</Text>
          {task.reviewFocus && task.reviewFocus.length > 0 && (
            <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>
              审核重点：
              {task.reviewFocus.map((f) => REVIEW_FOCUS_LABEL[f] ?? f).join('、')}
            </Text>
          )}
        </div>
      </Card>

      {/* 三栏布局：大屏并排，小屏（lg 以下）垂直堆叠；固定高度，各栏独立滚动 */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflow: isStacked ? 'auto' : 'hidden',
        display: 'flex',
        gap: 12,
        flexDirection: isStacked ? 'column' : 'row',
      }}>
        {/* 左栏：合同结构与筛选 */}
        <div style={{ width: isStacked ? '100%' : 240, flexShrink: 0, height: isStacked ? 'auto' : '100%', flex: isStacked ? '1 1 200' : '0 0 auto', minHeight: isStacked ? 200 : 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Card
            size="small"
            title={<Text strong style={{ fontSize: 14 }}>合同结构</Text>}
            styles={{ body: { padding: 12, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } }}
            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
          >
            {task.status !== 'failed' && (
              <div style={{ marginBottom: 8, flexShrink: 0 }}>
                <Link to={`/reviews/${task.id}/fields`}>
                  <Button type="text" size="small" block style={{ textAlign: 'left', padding: '4px 8px' }}>
                    <FileCheck2 size={12} style={{ marginRight: 6 }} />
                    合同信息字段
                    {!task.fieldsConfirmed && <Tag color="warning" style={{ marginLeft: 'auto', fontSize: 10 }}>待确认</Tag>}
                  </Button>
                </Link>
              </div>
            )}
            <Paragraph style={{ fontSize: 11, color: COLORS.textSecondary, margin: '4px 8px 8px', flexShrink: 0 }}>
              合同章节（共 {(parsedDoc?.sections ?? []).length} 节 · {risks.length} 项风险）
            </Paragraph>
            <div style={{ flex: 1, overflow: 'auto', minHeight: 0, paddingRight: 2 }}>
              {(() => {
                const sections = parsedDoc?.sections ?? [];
                if (sections.length === 0) {
                  return <Empty description="暂无合同结构" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 40 }} />;
                }
                // 按段落 id 统计风险数
                const riskCountByPara = new Map<string, number>();
                risks.forEach((r) => riskCountByPara.set(r.paragraphId, (riskCountByPara.get(r.paragraphId) ?? 0) + 1));
                return sections.map((sec) => {
                  const sectionRiskCount = sec.paragraphIds.reduce((sum, pid) => sum + (riskCountByPara.get(pid) ?? 0), 0);
                  const firstParaId = sec.paragraphIds[0];
                  return (
                    <div
                    key={sec.id}
                    onClick={() => {
                      if (firstParaId) contractRef.current?.scrollToParagraph(firstParaId);
                    }}
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

        {/* 中栏：合同原文（固定高度，内部滚动） */}
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

        {/* 右栏：AI审核结果（固定高度，内部滚动） */}
        <div style={{ width: isStacked ? '100%' : 380, flexShrink: 0, height: isStacked ? 'auto' : '100%', flex: isStacked ? '1 1 360' : '0 0 auto', minHeight: isStacked ? 360 : 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* 综合信息 */}
          <Card size="small" style={{ marginBottom: 8 }} styles={{ body: { padding: 12 } }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Space>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: '#e6fffb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Sparkles size={16} color={COLORS.ai} />
                </div>
                <div>
                  <Text strong style={{ fontSize: 13 }}>AI 审核结果</Text>
                  <Text style={{ fontSize: 11, color: COLORS.textSecondary, display: 'block' }}>综合风险评估</Text>
                </div>
              </Space>
              {maxLevel && <RiskLevelTag level={maxLevel} showDot />}
            </div>
            <Row gutter={12}>
              <Col span={12}>
                <Statistic
                  title={<Text style={{ fontSize: 11 }}>风险评分</Text>}
                  value={riskScore}
                  suffix="/100"
                  valueStyle={{ color: overallColor, fontSize: 22, fontWeight: 700 }}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title={<Text style={{ fontSize: 11 }}>风险总数</Text>}
                  value={risks.length}
                  suffix="项"
                  valueStyle={{ fontSize: 22, fontWeight: 700 }}
                />
              </Col>
            </Row>
            {/* 风险等级分布（融合风险统计） */}
            <Row gutter={[6, 6]} style={{ marginTop: 8 }}>
              <Col span={6}>
                <div style={{ padding: '6px 8px', background: RISK_LEVEL_MAP.high.bg, borderRadius: 6, textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: RISK_LEVEL_MAP.high.color, lineHeight: 1.2 }}>{riskCount.high}</div>
                  <Text style={{ fontSize: 10, color: RISK_LEVEL_MAP.high.color }}>高风险</Text>
                </div>
              </Col>
              <Col span={6}>
                <div style={{ padding: '6px 8px', background: RISK_LEVEL_MAP.medium.bg, borderRadius: 6, textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: RISK_LEVEL_MAP.medium.color, lineHeight: 1.2 }}>{riskCount.medium}</div>
                  <Text style={{ fontSize: 10, color: RISK_LEVEL_MAP.medium.color }}>中风险</Text>
                </div>
              </Col>
              <Col span={6}>
                <div style={{ padding: '6px 8px', background: RISK_LEVEL_MAP.low.bg, borderRadius: 6, textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: RISK_LEVEL_MAP.low.color, lineHeight: 1.2 }}>{riskCount.low}</div>
                  <Text style={{ fontSize: 10, color: RISK_LEVEL_MAP.low.color }}>低风险</Text>
                </div>
              </Col>
              <Col span={6}>
                <div style={{ padding: '6px 8px', background: RISK_LEVEL_MAP.notice.bg, borderRadius: 6, textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: RISK_LEVEL_MAP.notice.color, lineHeight: 1.2 }}>{riskCount.notice}</div>
                  <Text style={{ fontSize: 10, color: RISK_LEVEL_MAP.notice.color }}>提示项</Text>
                </div>
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

          {/* 风险导航 + 筛选（筛选与明细联动，置于明细上方） */}
          <div style={{ marginBottom: 8, padding: '0 4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Space size={6} align="center">
                <Text strong style={{ fontSize: 13 }}>
                  风险明细（{filteredRisks.length}）
                </Text>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Select
                  size="small"
                  style={{ flex: 1 }}
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
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Select
                  size="small"
                  style={{ flex: 1, minWidth: 90 }}
                  value={levelFilter}
                  onChange={(v) => setLevelFilter(v)}
                  options={[{ value: 'all', label: '全部等级' }, ...RISK_LEVEL_OPTIONS]}
                />
                <Select
                  size="small"
                  style={{ flex: 1, minWidth: 90 }}
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
                  style={{ flex: 1, minWidth: 90 }}
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

          {/* 风险卡片列表：占满右栏剩余高度，内部滚动 */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
            {filteredRisks.length === 0 ? (
              risksError ? (
                <Alert
                  type="error"
                  showIcon
                  message="风险列表加载失败"
                  description={risksError}
                  style={{ margin: '20px 0' }}
                  action={<Button size="small" onClick={() => loadData()}>重试</Button>}
                />
              ) : risks.length === 0 && task && (task.riskCount?.high + task.riskCount?.medium + task.riskCount?.low + task.riskCount?.notice > 0) ? (
                <Alert
                  type="warning"
                  showIcon
                  message="风险列表为空"
                  description="任务有风险记录但列表为空，可能数据尚未同步完成，请点击重试。"
                  style={{ margin: '20px 0' }}
                  action={<Button size="small" onClick={() => loadData()}>重试</Button>}
                />
              ) : (
                <Empty description={risks.length === 0 ? '暂无风险数据' : '无符合筛选条件的风险'} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ paddingTop: 40 }} />
              )
            ) : (
              /*
               * 大列表性能优化：风险数 > 30 时启用 CSS content-visibility: auto
               * 浏览器自动跳过屏外卡片渲染，显著降低初始渲染与重绘开销
               * contain-intrinsic-size 预估单卡高度（~400px），避免滚动条跳动
               */
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
                    <RiskCard
                      risk={risk}
                      index={idx}
                      total={filteredRisks.length}
                      active={risk.id === activeRiskId}
                      onActivate={handleActivateRisk}
                      onChanged={handleRiskChanged}
                      readOnly={currentUser?.role !== 'purchaser'}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 底部操作栏 */}
      <Affix offsetBottom={0}>
        <Card size="small" style={{ marginTop: 12, boxShadow: '0 -2px 8px rgba(0,0,0,0.04)' }} styles={{ body: { padding: '10px 16px' } }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Space size={16}>
              <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>
                已处理 <Text strong style={{ color: COLORS.primary }}>{processedStats.processed}</Text> / {processedStats.total}
              </Text>
              {processedStats.pending > 0 && (
                <Text style={{ fontSize: 12, color: COLORS.medium }}>
                  剩余 {processedStats.pending} 项待处理
                </Text>
              )}
            </Space>
            <Space>
              <Button icon={<FileBarChart size={14} />} onClick={handleGenerateReport} loading={submitting}>
                生成报告
              </Button>
              {isLegalContext ? (
                <Button type="primary" icon={<Send size={14} />} onClick={() => navigate(`/legal-reviews/${task.id}`)}>
                  前往法务复核
                </Button>
              ) : canSubmitForLegal ? (
                <Button type="primary" icon={<Send size={14} />} onClick={handleSubmitForLegal} loading={submitting}>
                  提交法务复核
                </Button>
              ) : null}
            </Space>
          </div>
        </Card>
      </Affix>
    </div>
  );
}
