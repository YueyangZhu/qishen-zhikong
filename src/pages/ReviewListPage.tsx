/**
 * P03 合同审核列表
 * - 搜索（合同名称/编号/相对方）
 * - 筛选：状态、风险等级、合同类型、创建时间
 * - 表格展示 + 分页
 * - 操作：查看详情、继续处理、查看报告、删除草稿
 * - 空状态、加载状态、筛选无结果
 * 筛选状态写入 URL，刷新可恢复
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Card, Input, Select, DatePicker, Button, Table, Space, Typography, App, Tag, Tooltip, Row, Col, Alert,
} from 'antd';
import { Search, Plus, FileBarChart, Trash2, RotateCw, Eye } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useAuthStore } from '@/store/useAuthStore';
import { reviewService, type TaskFilter } from '@/services/reviewService';
import { reportService } from '@/services/reportService';
import { COLORS, REVIEW_STATUS_OPTIONS, RISK_LEVEL_OPTIONS, PAGE_SIZE } from '@/constants';
import { formatMoney, formatDateTime } from '@/utils/format';
import { ReviewStatusTag, RiskLevelTag } from '@/components/StatusTag';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import type { ReviewTask, ReviewStatus, RiskLevel } from '@/types';

const { RangePicker } = DatePicker;
const { Text } = Typography;

const CONTRACT_TYPES = [
  { value: '软件采购', label: '软件采购' },
  { value: '硬件采购', label: '硬件采购' },
  { value: '服务采购', label: '服务采购' },
  { value: '系统集成', label: '系统集成' },
  { value: '设备租赁', label: '设备租赁' },
];

export default function ReviewListPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuthStore();
  const { message, modal } = App.useApp();
  const [searchParams, setSearchParams] = useSearchParams();

  // 从 URL 读取初始筛选
  const [keyword, setKeyword] = useState(searchParams.get('keyword') ?? '');
  const [statusFilter, setStatusFilter] = useState<ReviewStatus[]>(
    searchParams.get('status') ? (searchParams.get('status')!.split(',') as ReviewStatus[]) : [],
  );
  const [riskLevelFilter, setRiskLevelFilter] = useState<RiskLevel[]>(
    searchParams.get('riskLevel') ? (searchParams.get('riskLevel')!.split(',') as RiskLevel[]) : [],
  );
  const [contractType, setContractType] = useState(searchParams.get('contractType') ?? '');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);

  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // 同步筛选到 URL
  const syncUrl = (overrides: Record<string, string | undefined> = {}) => {
    const params: Record<string, string> = {};
    const kw = overrides.keyword ?? keyword;
    const st = overrides.status ?? statusFilter.join(',');
    const rl = overrides.riskLevel ?? riskLevelFilter.join(',');
    const ct = overrides.contractType ?? contractType;
    if (kw) params.keyword = kw;
    if (st) params.status = st;
    if (rl) params.riskLevel = rl;
    if (ct) params.contractType = ct;
    setSearchParams(params, { replace: true });
  };

  const loadTasks = async () => {
    setLoading(true);
    try {
      const creatorParam = searchParams.get('creator');
      const filter: TaskFilter = {
        keyword: keyword || undefined,
        status: statusFilter.length ? statusFilter : undefined,
        riskLevel: riskLevelFilter.length ? riskLevelFilter : undefined,
        contractType: contractType || undefined,
        // creator=me 表示只看当前用户创建的任务（业务人员「待我处理」专用）
        creatorId: creatorParam === 'me' && currentUser ? currentUser.id : undefined,
        dateRange: dateRange && dateRange[0] && dateRange[1]
          ? [dateRange[0].format('YYYY-MM-DD'), dateRange[1].format('YYYY-MM-DD')]
          : null,
      };
      const list = await reviewService.listTasks(filter);
      setTasks(list);
      setTotal(list.length);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, statusFilter, riskLevelFilter, contractType, dateRange]);

  // 工作台跳转时根据 URL 参数自动设置筛选（仅首次）
  useEffect(() => {
    const st = searchParams.get('status');
    const rl = searchParams.get('riskLevel');
    if (st) setStatusFilter(st.split(',') as ReviewStatus[]);
    if (rl) setRiskLevelFilter(rl.split(',') as RiskLevel[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = (task: ReviewTask) => {
    if (!currentUser) return;
    modal.confirm({
      title: '删除审核任务',
      content: `确认删除「${task.contractName}」？删除后无法恢复，相关风险与字段记录将一并清除。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await reviewService.deleteTask(task.id, currentUser);
          message.success('已删除');
          loadTasks();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '删除失败');
        }
      },
    });
  };

  const handleViewReport = async (task: ReviewTask) => {
    try {
      const reports = await reportService.list({ reviewTaskId: task.id });
      if (reports.length > 0) {
        navigate(`/reports/${reports[0].id}`);
      } else {
        modal.confirm({
          title: '暂无审核报告',
          content: '该任务尚未生成审核报告。是否前往详情页查看审核结果？',
          okText: '前往详情',
          cancelText: '取消',
          onOk: () => navigate(`/reviews/${task.id}`),
        });
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '查询报告失败');
    }
  };

  const handleReset = () => {
    setKeyword('');
    setStatusFilter([]);
    setRiskLevelFilter([]);
    setContractType('');
    setDateRange(null);
    setSearchParams({}, { replace: true });
  };

  const hasFilter = keyword || statusFilter.length || riskLevelFilter.length || contractType || dateRange;

  // 跳转目标：根据状态决定查看详情/继续处理/法务复核
  const getNavigatePath = (task: ReviewTask) => {
    if (task.status === 'draft') return `/reviews/${task.id}`;
    if (task.status === 'parsing' || task.status === 'ai_reviewing') return `/reviews/${task.id}/progress`;
    if (task.status === 'pending_business') return `/reviews/${task.id}`;
    if (task.status === 'pending_legal' && currentUser?.role === 'legal') return `/legal-reviews/${task.id}`;
    if (task.status === 'pending_legal') return `/reviews/${task.id}`;
    if (task.status === 'completed') return `/reviews/${task.id}`;
    if (task.status === 'failed') return `/reviews/${task.id}/progress`;
    return `/reviews/${task.id}`;
  };

  const columns: ColumnsType<ReviewTask> = [
    {
      title: '合同名称',
      dataIndex: 'contractName',
      key: 'contractName',
      width: 220,
      fixed: 'left',
      render: (_, r) => (
        <div>
          <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 2 }}>
            {r.contractName}
          </Text>
          <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>{r.contractNo}</Text>
        </div>
      ),
    },
    {
      title: '相对方',
      dataIndex: 'counterparty',
      key: 'counterparty',
      width: 160,
      ellipsis: true,
    },
    {
      title: '合同金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 130,
      align: 'right',
      render: (_, r) => <Text style={{ fontSize: 13 }}>{formatMoney(r.amount, r.currency)}</Text>,
    },
    {
      title: '合同类型',
      dataIndex: 'contractType',
      key: 'contractType',
      width: 110,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '审核状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (s: ReviewStatus) => <ReviewStatusTag status={s} />,
    },
    {
      title: '最高风险',
      dataIndex: 'riskLevelMax',
      key: 'riskLevelMax',
      width: 100,
      render: (l: RiskLevel | null) => (l ? <RiskLevelTag level={l} /> : <Text style={{ color: COLORS.textSecondary, fontSize: 12 }}>—</Text>),
    },
    {
      title: '风险数',
      key: 'riskCount',
      width: 90,
      align: 'center',
      render: (_, r) => {
        const { high, medium, low } = r.riskCount;
        const total = high + medium + low + r.riskCount.notice;
        if (total === 0) return <Text style={{ color: COLORS.textSecondary, fontSize: 12 }}>—</Text>;
        return (
          <Space size={4}>
            {high > 0 && <Tag color="error" style={{ margin: 0, fontSize: 11 }}>{high}</Tag>}
            {medium > 0 && <Tag color="warning" style={{ margin: 0, fontSize: 11 }}>{medium}</Tag>}
            {low > 0 && <Tag color="success" style={{ margin: 0, fontSize: 11 }}>{low}</Tag>}
          </Space>
        );
      },
    },
    {
      title: '发起人',
      dataIndex: 'creatorName',
      key: 'creatorName',
      width: 100,
      render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 180,
      render: (v: string) => (
        <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{formatDateTime(v)}</Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      fixed: 'right',
      render: (_, r) => {
        const canDelete = (r.status === 'draft' || r.status === 'failed') && currentUser?.role === 'purchaser';
        const isProcessing = r.status === 'parsing' || r.status === 'ai_reviewing';
        const isLegalReview = r.status === 'pending_legal' && currentUser?.role === 'legal';
        return (
          <Space size={4}>
            <Tooltip title={isProcessing ? '查看进度' : isLegalReview ? '前往复核' : '查看详情'}>
              <Button type="link" size="small" icon={<Eye size={14} />} onClick={() => navigate(getNavigatePath(r))}>
                {isProcessing ? '进度' : isLegalReview ? '复核' : '详情'}
              </Button>
            </Tooltip>
            {r.status === 'completed' && (
              <Tooltip title="查看报告">
                <Button type="link" size="small" icon={<FileBarChart size={14} />} onClick={() => handleViewReport(r)} />
              </Tooltip>
            )}
            {canDelete && (
              <Tooltip title="删除">
                <Button type="link" size="small" danger icon={<Trash2 size={14} />} onClick={() => handleDelete(r)} />
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  const pagedTasks = useMemo(() => tasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [tasks, page]);

  return (
    <div>
      <PageHeader
        title="合同审核"
        description="查看与处理所有采购合同审核任务，支持按状态、风险等级、合同类型筛选"
        extra={
          currentUser?.role === 'purchaser' && (
            <Button type="primary" icon={<Plus size={14} />} onClick={() => navigate('/reviews/new')}>
              新建审核
            </Button>
          )
        }
      />

      {searchParams.get('creator') === 'me' && (
        <Alert
          type="info"
          showIcon
          message="当前仅展示您创建的任务"
          description="此筛选来自工作台「待我处理」。如需查看全部任务，请点击右侧「重置」按钮清空筛选条件。"
          style={{ marginBottom: 16 }}
        />
      )}

      <Card style={{ marginBottom: 16 }} styles={{ body: { padding: 16 } }}>
        <Row gutter={[12, 12]}>
          <Col xs={24} md={8}>
            <Input
              allowClear
              size="middle"
              placeholder="搜索合同名称、合同编号、相对方"
              prefix={<Search size={14} color={COLORS.textSecondary} />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </Col>
          <Col xs={12} md={5}>
            <Select
              mode="multiple"
              allowClear
              placeholder="审核状态"
              style={{ width: '100%' }}
              maxTagCount="responsive"
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                syncUrl({ status: v.join(',') });
              }}
              options={REVIEW_STATUS_OPTIONS}
            />
          </Col>
          <Col xs={12} md={4}>
            <Select
              mode="multiple"
              allowClear
              placeholder="风险等级"
              style={{ width: '100%' }}
              maxTagCount="responsive"
              value={riskLevelFilter}
              onChange={(v) => {
                setRiskLevelFilter(v);
                syncUrl({ riskLevel: v.join(',') });
              }}
              options={RISK_LEVEL_OPTIONS}
            />
          </Col>
          <Col xs={12} md={4}>
            <Select
              allowClear
              placeholder="合同类型"
              style={{ width: '100%' }}
              value={contractType || undefined}
              onChange={(v) => setContractType(v ?? '')}
              options={CONTRACT_TYPES}
            />
          </Col>
          <Col xs={12} md={3}>
            <RangePicker
              style={{ width: '100%' }}
              value={dateRange as [dayjs.Dayjs, dayjs.Dayjs] | null}
              onChange={(v) => setDateRange(v as [dayjs.Dayjs | null, dayjs.Dayjs | null] | null)}
            />
          </Col>
        </Row>
        {hasFilter ? (
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="link" icon={<RotateCw size={14} />} onClick={handleReset}>
              清空筛选
            </Button>
          </div>
        ) : null}
      </Card>

      <Card styles={{ body: { padding: 0 } }}>
        <Table<ReviewTask>
          rowKey="id"
          columns={columns}
          dataSource={pagedTasks}
          loading={loading}
          scroll={{ x: 1400 }}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: false,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p) => setPage(p),
          }}
          locale={{
            emptyText: hasFilter ? (
              <EmptyState description="没有符合筛选条件的合同" actionText="清空筛选" onAction={handleReset} />
            ) : (
              <EmptyState
                description="暂无审核任务"
                actionText={currentUser?.role === 'purchaser' ? '新建审核' : undefined}
                onAction={currentUser?.role === 'purchaser' ? () => navigate('/reviews/new') : undefined}
              />
            ),
          }}
        />
      </Card>
    </div>
  );
}
