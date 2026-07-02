/**
 * P02 工作台
 * - 欢迎信息 + 新建审核主按钮
 * - 4 个指标卡（待我处理 / 审核中 / 高风险 / 本月完成）
 * - 审核趋势图（折线）+ 风险类型分布（饼图）
 * - 最近审核任务 + 待办事项 + 快捷入口
 * 所有数据来自 dashboardService（与列表/详情同源）
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, Row, Col, Button, Typography, Space, List, Empty, Skeleton, App, Tooltip } from 'antd';
import { FilePlus2, Clock, AlertTriangle, CheckCircle2, ArrowRight, Scale, FileText, Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import { useAuthStore } from '@/store/useAuthStore';
import { dashboardService, type DashboardStats } from '@/services/dashboardService';
import { COLORS, ROLE_MAP } from '@/constants';
import { formatMoney, formatDateTime } from '@/utils/format';
import { ReviewStatusTag, RiskLevelTag } from '@/components/StatusTag';
import type { ReviewTask } from '@/types';

const { Title, Text } = Typography;

interface TrendItem {
  month: string;
  created: number;
  completed: number;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuthStore();
  const { message } = App.useApp();

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [riskTypes, setRiskTypes] = useState<{ name: string; value: number }[]>([]);
  const [riskLevels, setRiskLevels] = useState<{ name: string; value: number; color: string }[]>([]);
  const [recentTasks, setRecentTasks] = useState<ReviewTask[]>([]);
  const [todos, setTodos] = useState<ReviewTask[]>([]);

  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      setLoading(true);
      try {
        const data = await dashboardService.loadAll(currentUser);
        setStats(data.stats);
        setTrends(data.trends);
        setRiskTypes(data.riskTypes);
        setRiskLevels(data.riskLevels);
        setRecentTasks(data.recentTasks);
        setTodos(data.todos);
      } catch (e) {
        message.error(e instanceof Error ? e.message : '加载工作台数据失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [currentUser, message]);

  if (!currentUser) return null;

  const hour = new Date().getHours();
  const greeting = hour < 9 ? '早上好' : hour < 12 ? '上午好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';

  // 指标卡配置
  // 按角色确定「待我处理」的跳转筛选条件
  // - 业务人员：待人工确认（pending_business）+ 只看自己创建的（creator=me）
  // - 法务：待法务复核（pending_legal）
  // - 管理员：待人工确认 + 待法务复核（看全部）
  const myPendingQuery =
    currentUser?.role === 'legal'
      ? 'status=pending_legal'
      : currentUser?.role === 'admin'
        ? 'status=pending_business,pending_legal'
        : 'status=pending_business&creator=me';

  const metricCards = [
    {
      key: 'myPending',
      label: '待我处理',
      value: stats?.myPending ?? 0,
      unit: '项',
      icon: <Clock size={20} color={COLORS.primary} />,
      bg: '#e6f4ff',
      onClick: () => navigate(`/reviews?${myPendingQuery}`),
    },
    {
      key: 'reviewing',
      label: '审核中合同',
      value: stats?.reviewing ?? 0,
      unit: '份',
      icon: <FileText size={20} color={COLORS.ai} />,
      bg: '#e6fffb',
      onClick: () => navigate('/reviews?status=ai_reviewing'),
    },
    {
      key: 'highRisk',
      label: '高风险合同',
      value: stats?.highRiskContracts ?? 0,
      unit: '份',
      icon: <AlertTriangle size={20} color={COLORS.high} />,
      bg: '#fff1f0',
      onClick: () => navigate('/reviews?riskLevel=high'),
    },
    {
      key: 'totalCompleted',
      label: '累计完成',
      value: stats?.totalCompleted ?? 0,
      unit: '份',
      icon: <CheckCircle2 size={20} color={COLORS.low} />,
      bg: '#f6ffed',
      onClick: () => navigate('/reviews?status=completed'),
    },
  ];

  // 趋势图配置（useMemo：仅当 trends 变化时重算，避免父组件重渲染触发图表重绘）
  const trendOption = useMemo(() => ({
    tooltip: { trigger: 'axis' as const },
    legend: { data: ['新建', '完成'], bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8 },
    grid: { left: 40, right: 16, top: 16, bottom: 36 },
    xAxis: {
      type: 'category' as const,
      data: trends.map((t) => t.month.slice(5) + '月'),
      axisLine: { lineStyle: { color: '#e8ecf0' } },
      axisLabel: { color: '#5b6470', fontSize: 12 },
    },
    yAxis: {
      type: 'value' as const,
      splitLine: { lineStyle: { color: '#f0f2f5' } },
      axisLabel: { color: '#5b6470', fontSize: 12 },
    },
    series: [
      {
        name: '新建',
        type: 'line' as const,
        smooth: true,
        data: trends.map((t) => t.created),
        itemStyle: { color: COLORS.primary },
        lineStyle: { width: 2 },
        areaStyle: { color: 'rgba(22, 119, 255, 0.08)' },
      },
      {
        name: '完成',
        type: 'line' as const,
        smooth: true,
        data: trends.map((t) => t.completed),
        itemStyle: { color: COLORS.ai },
        lineStyle: { width: 2 },
        areaStyle: { color: 'rgba(19, 194, 194, 0.08)' },
      },
    ],
  }), [trends]);

  // 风险等级分布饼图
  const riskLevelOption = useMemo(() => ({
    tooltip: { trigger: 'item' as const, formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, fontSize: 12 },
    series: [
      {
        type: 'pie' as const,
        radius: ['45%', '70%'],
        center: ['50%', '42%'],
        avoidLabelOverlap: false,
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 14, fontWeight: 'bold' } },
        data: riskLevels.map((r) => ({ name: r.name, value: r.value, itemStyle: { color: r.color } })),
      },
    ],
  }), [riskLevels]);

  const quickEntries = [
    {
      title: '新建审核',
      desc: '上传合同，发起 AI 审核',
      icon: <FilePlus2 size={20} color={COLORS.primary} />,
      roles: ['purchaser'],
      onClick: () => navigate('/reviews/new'),
    },
    {
      title: '合同审核',
      desc: '查看与处理审核任务',
      icon: <FileText size={20} color={COLORS.ai} />,
      roles: ['purchaser', 'legal', 'admin'],
      onClick: () => navigate('/reviews'),
    },
    {
      title: '法务复核',
      desc: '复核高风险与提交结论',
      icon: <Scale size={20} color={COLORS.medium} />,
      roles: ['legal'],
      onClick: () => navigate('/reviews?status=pending_legal'),
    },
    {
      title: '风险规则',
      desc: '维护审核规则库',
      icon: <Shield size={20} color={COLORS.high} />,
      roles: ['legal', 'admin'],
      onClick: () => navigate('/rules'),
    },
  ];

  return (
    <div>
      {/* 欢迎条 */}
      <Card style={{ marginBottom: 16, background: `linear-gradient(135deg, #e6f4ff 0%, #f0f5ff 100%)`, border: 'none' }} styles={{ body: { padding: 20 } }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <Title level={4} style={{ margin: 0, fontWeight: 600 }}>
              {greeting}，{currentUser.name}
            </Title>
            <Text style={{ color: COLORS.textSecondary, fontSize: 13 }}>
              {ROLE_MAP[currentUser.role].desc} · 今日有 <Text strong style={{ color: COLORS.primary }}>{stats?.myPending ?? 0}</Text> 项待办任务
            </Text>
          </div>
          <Space>
            {currentUser.role === 'purchaser' && (
              <Button
                type="primary"
                size="large"
                icon={<FilePlus2 size={16} />}
                onClick={() => navigate('/reviews/new')}
              >
                新建审核
              </Button>
            )}
          </Space>
        </div>
      </Card>

      {/* 指标卡 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {metricCards.map((m) => (
          <Col xs={12} sm={12} md={6} key={m.key}>
            <Card
              hoverable
              onClick={m.onClick}
              style={{ cursor: 'pointer', transition: 'all 0.2s' }}
              styles={{ body: { padding: 20 } }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <Text style={{ color: COLORS.textSecondary, fontSize: 13 }}>{m.label}</Text>
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontSize: 28, fontWeight: 700, color: COLORS.textPrimary, fontFamily: "'DIN', 'Helvetica Neue', sans-serif" }}>
                      {loading ? <Skeleton.Input size="small" active style={{ width: 48 }} /> : m.value}
                    </span>
                    <Text style={{ color: COLORS.textSecondary, fontSize: 12 }}>{m.unit}</Text>
                  </div>
                </div>
                <div style={{ width: 40, height: 40, borderRadius: 8, background: m.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {m.icon}
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* 图表区 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={14}>
          <Card title="审核趋势" styles={{ body: { height: 300, padding: 12 } }} style={{ height: '100%' }}>
            {loading ? (
              <Skeleton active paragraph={{ rows: 5 }} />
            ) : (
              <ReactECharts option={trendOption} style={{ height: '100%' }} />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card
            title={
              <Space size={6}>
                <span>风险等级分布</span>
                <Tooltip title="统计所有审核任务中识别出的风险项总数，按风险等级分类统计。">
                  <span style={{ color: COLORS.textSecondary, fontSize: 12, cursor: 'help' }}>ⓘ</span>
                </Tooltip>
              </Space>
            }
            styles={{ body: { height: 300, padding: 12 } }}
            style={{ height: '100%' }}
          >
            {loading ? (
              <Skeleton active paragraph={{ rows: 5 }} />
            ) : riskLevels.every((r) => r.value === 0) ? (
              <Empty description="暂无风险数据" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ paddingTop: 60 }} />
            ) : (
              <ReactECharts option={riskLevelOption} style={{ height: '100%' }} />
            )}
          </Card>
        </Col>
      </Row>

      {/* 列表区 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={14}>
          <Card
            title="最近审核任务"
            extra={<Button type="link" onClick={() => navigate('/reviews')} icon={<ArrowRight size={14} />}>查看全部</Button>}
            styles={{ body: { padding: 0 } }}
          >
            <List
              loading={loading}
              dataSource={recentTasks}
              locale={{ emptyText: <Empty description="暂无审核任务" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
              renderItem={(task) => (
                <List.Item
                  style={{ padding: '12px 20px', cursor: 'pointer' }}
                  onClick={() => navigate(`/reviews/${task.id}`)}
                >
                  <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <Text strong ellipsis style={{ fontSize: 14, maxWidth: 240 }}>
                          {task.contractName}
                        </Text>
                        <ReviewStatusTag status={task.status} />
                        {task.riskLevelMax && <RiskLevelTag level={task.riskLevelMax} />}
                      </div>
                      <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>
                        {task.counterparty} · {formatMoney(task.amount, task.currency)} · {formatDateTime(task.updatedAt)}
                      </Text>
                    </div>
                    <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{task.creatorName}</Text>
                  </div>
                </List.Item>
              )}
            />
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card
            title="待办事项"
            extra={<Button type="link" onClick={() => navigate(`/reviews?${myPendingQuery}`)} icon={<ArrowRight size={14} />}>查看全部</Button>}
            styles={{ body: { padding: 0 } }}
          >
            <List
              loading={loading}
              dataSource={todos.slice(0, 5)}
              locale={{ emptyText: <Empty description="暂无待办" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
              renderItem={(task) => (
                <List.Item style={{ padding: '12px 20px', cursor: 'pointer' }} onClick={() => navigate(currentUser.role === 'legal' && task.status === 'pending_legal' ? `/legal-reviews/${task.id}` : `/reviews/${task.id}`)}>
                  <div style={{ width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <Text strong ellipsis style={{ fontSize: 13, maxWidth: 220 }}>
                        {task.contractName}
                      </Text>
                    </div>
                    <Space size={8}>
                      <ReviewStatusTag status={task.status} />
                      {task.riskLevelMax && <RiskLevelTag level={task.riskLevelMax} />}
                      <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>{formatDateTime(task.updatedAt)}</Text>
                    </Space>
                  </div>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      {/* 快捷入口 */}
      <Card title="快捷入口">
        <Row gutter={[16, 16]}>
          {quickEntries
            .filter((q) => q.roles.includes(currentUser.role))
            .map((q) => (
              <Col xs={12} sm={6} key={q.title}>
                <Card
                  hoverable
                  size="small"
                  onClick={q.onClick}
                  styles={{ body: { padding: 16 } }}
                  style={{ cursor: 'pointer', border: `1px solid ${COLORS.border}` }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: '#f5f7fa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {q.icon}
                    </div>
                    <div>
                      <Text strong style={{ display: 'block', fontSize: 14 }}>
                        {q.title}
                      </Text>
                      <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{q.desc}</Text>
                    </div>
                  </div>
                </Card>
              </Col>
            ))}
        </Row>
      </Card>
    </div>
  );
}
