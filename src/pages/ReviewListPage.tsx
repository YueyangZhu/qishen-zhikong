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
  Card, Input, Select, DatePicker, Button, Space, Typography, App, Tag, Tooltip, Row, Col, Alert,
} from 'antd';
import { Search, Plus, FileBarChart, Trash2, RotateCw, Eye } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { useAuthStore } from '@/store/useAuthStore';
import { reviewService, type TaskFilter } from '@/services/reviewService';
import { reportService } from '@/services/reportService';
import { COLORS, REVIEW_STATUS_OPTIONS, RISK_LEVEL_OPTIONS, PAGE_SIZE } from '@/constants';
import { formatMoney, formatDateTime } from '@/utils/format';
import { ReviewStatusTag, RiskLevelTag } from '@/components/StatusTag';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import ResizableTable from '@/components/ResizableTable';
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

/** 按角色返回可见的审核状态列表
 * - 法务：只看待法务复核、已完成
 * - 管理员：排除草稿/解析中/AI审核中（这些只有业务人员能操作）
 * - 业务人员：全部状态
 */
function getAllowedStatuses(role: string | undefined): ReviewStatus[] | null {
  if (!role) return null;
  if (role === 'legal') return ['pending_legal', 'completed'];
  if (role === 'admin') return ['pending_business', 'pending_legal', 'completed', 'failed'];
  return null; // purchaser 等其他角色不做限制
}

export default function ReviewListPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuthStore();
  const { message, modal } = App.useApp();
  const [searchParams, setSearchParams] = useSearchParams();

  // 筛选条件持久化到 sessionStorage，详情页返回时 navigate('/reviews') 也能恢复筛选
  // URL query 作为备用（直接访问 URL 时生效），sessionStorage 优先级更高（保留用户上次操作）
  const FILTERS_STORAGE_KEY = 'reviews:filters';

  function loadFiltersFromStorage() {
    try {
      const raw = sessionStorage.getItem(FILTERS_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  const savedFilters = loadFiltersFromStorage();

  // 从 sessionStorage 或 URL 读取初始筛选（sessionStorage 优先）
  const [keyword, setKeyword] = useState(savedFilters?.keyword ?? searchParams.get('keyword') ?? '');
  const [statusFilter, setStatusFilter] = useState<ReviewStatus[]>(
    savedFilters?.statusFilter ?? (searchParams.get('status') ? (searchParams.get('status')!.split(',') as ReviewStatus[]) : []),
  );
  const [riskLevelFilter, setRiskLevelFilter] = useState<RiskLevel[]>(
    savedFilters?.riskLevelFilter ?? (searchParams.get('riskLevel') ? (searchParams.get('riskLevel')!.split(',') as RiskLevel[]) : []),
  );
  const [contractType, setContractType] = useState(savedFilters?.contractType ?? searchParams.get('contractType') ?? '');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(() => {
    if (savedFilters?.dateRange) {
      const [from, to] = savedFilters.dateRange;
      if (from && to) return [dayjs(from), dayjs(to)];
    }
    const from = searchParams.get('dateFrom');
    const to = searchParams.get('dateTo');
    if (from && to) return [dayjs(from), dayjs(to)];
    return null;
  });

  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [page, setPage] = useState(() => {
    if (savedFilters?.page) return savedFilters.page;
    const p = searchParams.get('page');
    return p ? Math.max(1, parseInt(p, 10) || 1) : 1;
  });
  const [total, setTotal] = useState(0);

  // 统一同步所有筛选到 sessionStorage + URL（replace 模式）
  // sessionStorage 让详情页 navigate('/reviews') 返回时能恢复筛选
  // URL query 支持刷新和直接访问
  useEffect(() => {
    const params: Record<string, string> = {};
    if (keyword) params.keyword = keyword;
    if (statusFilter.length) params.status = statusFilter.join(',');
    if (riskLevelFilter.length) params.riskLevel = riskLevelFilter.join(',');
    if (contractType) params.contractType = contractType;
    if (dateRange && dateRange[0] && dateRange[1]) {
      params.dateFrom = dateRange[0].format('YYYY-MM-DD');
      params.dateTo = dateRange[1].format('YYYY-MM-DD');
    }
    if (page > 1) params.page = String(page);
    const creator = searchParams.get('creator');
    if (creator) params.creator = creator;
    setSearchParams(params, { replace: true });
    // 持久化到 sessionStorage
    try {
      sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({
        keyword, statusFilter, riskLevelFilter, contractType,
        dateRange: dateRange && dateRange[0] && dateRange[1]
          ? [dateRange[0].format('YYYY-MM-DD'), dateRange[1].format('YYYY-MM-DD')]
          : null,
        page,
      }));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, statusFilter, riskLevelFilter, contractType, dateRange, page]);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const creatorParam = searchParams.get('creator');
      const roleAllowed = getAllowedStatuses(currentUser?.role);
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
      // 按角色过滤可见状态：法务只看待法务复核+已完成，管理员排除草稿/解析中/AI审核中
      const filtered = roleAllowed
        ? list.filter((t) => roleAllowed.includes(t.status))
        : list;
      setTasks(filtered);
      setTotal(filtered.length);
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
    setPage(1);
    // URL 由统一同步的 useEffect 自动清空
  };

  const hasFilter = keyword || statusFilter.length || riskLevelFilter.length || contractType || dateRange;

  // 状态筛选选项：根据角色过滤，法务/管理员只看到自己能处理的任务状态
  const roleAllowedStatuses = getAllowedStatuses(currentUser?.role);
  const roleStatusOptions = roleAllowedStatuses
    ? REVIEW_STATUS_OPTIONS.filter((o) => roleAllowedStatuses.includes(o.value))
    : REVIEW_STATUS_OPTIONS;

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

  const columns = [
    {
      title: '合同名称', dataIndex: 'contractName', key: 'contractName', width: 220, minWidth: 140, fixed: 'left' as const,
      render: (_: unknown, r: ReviewTask) => (
        <div>
          <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 2 }}>
            {r.contractName}
          </Text>
          <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>{r.contractNo}</Text>
        </div>
      ),
    },
    {
      title: '相对方', dataIndex: 'counterparty', key: 'counterparty', width: 160, minWidth: 100, ellipsis: true,
    },
    {
      title: '合同金额', dataIndex: 'amount', key: 'amount', width: 130, minWidth: 100, align: 'right' as const,
      render: (_: unknown, r: ReviewTask) => <Text style={{ fontSize: 13 }}>{formatMoney(r.amount, r.currency)}</Text>,
    },
    {
      title: '合同类型', dataIndex: 'contractType', key: 'contractType', width: 110, minWidth: 80,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '审核状态', dataIndex: 'status', key: 'status', width: 110, minWidth: 90,
      render: (s: ReviewStatus) => <ReviewStatusTag status={s} />,
    },
    {
      title: '最高风险', dataIndex: 'riskLevelMax', key: 'riskLevelMax', width: 100, minWidth: 80,
      render: (l: RiskLevel | null) => (l ? <RiskLevelTag level={l} /> : <Text style={{ color: COLORS.textSecondary, fontSize: 12 }}>—</Text>),
    },
    {
      title: '风险数', key: 'riskCount', width: 90, minWidth: 80, align: 'center' as const,
      render: (_: unknown, r: ReviewTask) => {
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
      title: '发起人', dataIndex: 'creatorName', key: 'creatorName', width: 100, minWidth: 80,
      render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 170, minWidth: 140,
      render: (v: string) => (
        <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{formatDateTime(v)}</Text>
      ),
    },
    {
      title: '操作', key: 'action', width: 170, minWidth: 130, fixed: 'right' as const, resizable: false as const,
      render: (_: unknown, r: ReviewTask) => {
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
          <Col xs={24} md={7}>
            <Input
              allowClear
              size="middle"
              placeholder="搜索合同名称、编号、相对方、类型、发起人、部门、备注"
              prefix={<Search size={14} color={COLORS.textSecondary} />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </Col>
          <Col xs={12} md={4}>
            <Select
              mode="multiple"
              allowClear
              placeholder="审核状态"
              style={{ width: '100%' }}
              maxTagCount="responsive"
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
              options={roleStatusOptions}
            />
          </Col>
          <Col xs={12} md={3}>
            <Select
              mode="multiple"
              allowClear
              placeholder="风险等级"
              style={{ width: '100%' }}
              maxTagCount="responsive"
              value={riskLevelFilter}
              onChange={(v) => {
                setRiskLevelFilter(v);
                setPage(1);
              }}
              options={RISK_LEVEL_OPTIONS}
            />
          </Col>
          <Col xs={12} md={3}>
            <Select
              allowClear
              placeholder="合同类型"
              style={{ width: '100%' }}
              value={contractType || undefined}
              onChange={(v) => {
                setContractType(v ?? '');
                setPage(1);
              }}
              options={CONTRACT_TYPES}
            />
          </Col>
          <Col xs={12} md={4}>
            <RangePicker
              style={{ width: '100%' }}
              value={dateRange as [dayjs.Dayjs, dayjs.Dayjs] | null}
              onChange={(v) => {
                setDateRange(v as [dayjs.Dayjs | null, dayjs.Dayjs | null] | null);
                setPage(1);
              }}
            />
          </Col>
          {hasFilter && (
            <Col xs={12} md={2} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
              <Button type="link" icon={<RotateCw size={14} />} onClick={handleReset}>
                重置
              </Button>
            </Col>
          )}
        </Row>
      </Card>

      <Card styles={{ body: { padding: 0 } }}>
        <ResizableTable<ReviewTask>
          rowKey="id"
          columns={columns}
          dataSource={pagedTasks}
          loading={loading}
          scroll={{ x: 1400 }}
          storageKey="reviews"
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: true,
            showQuickJumper: true,
            pageSizeOptions: ['10', '20', '50'],
            showTotal: (t, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${t} 条`,
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
