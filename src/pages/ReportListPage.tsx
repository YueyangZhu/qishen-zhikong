/**
 * P09 审核报告列表
 * - 报告搜索、状态筛选
 * - 查看报告、下载报告（打印）、查看对应合同
 * - 报告生成失败时重试
 */
import { useEffect, useState } from 'react';
import {
  Card, Table, Button, Input, Select, Space, Typography, Tag, Tooltip, App, Empty, Skeleton,
} from 'antd';
import { Search, Eye, FileBarChart, FileText, RotateCw, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import { useAuthStore } from '@/store/useAuthStore';
import { reportService } from '@/services/reportService';
import { reviewService } from '@/services/reviewService';
import { COLORS, PAGE_SIZE } from '@/constants';
import { formatDateTime } from '@/utils/format';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import type { ReviewReport } from '@/types';

const { Text } = Typography;

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  generating: { label: '生成中', color: 'processing' },
  generated: { label: '已生成', color: 'success' },
  failed: { label: '生成失败', color: 'error' },
};

export default function ReportListPage() {
  const navigate = useNavigate();
  const { currentUser } = useAuthStore();
  const { message } = App.useApp();

  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<ReviewReport[]>([]);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const loadReports = async () => {
    setLoading(true);
    try {
      const list = await reportService.list({ keyword: keyword || undefined, status: statusFilter || undefined });
      setReports(list);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, statusFilter]);

  const handleRetry = async (report: ReviewReport) => {
    if (!currentUser) return;
    try {
      await reportService.retry(report.reviewTaskId, currentUser);
      message.success('正在重新生成报告...');
      setTimeout(loadReports, 1000);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '重试失败');
    }
  };

  const columns: ColumnsType<ReviewReport> = [
    {
      title: '报告编号',
      dataIndex: 'reportNo',
      key: 'reportNo',
      width: 200,
      render: (v, r) => (
        <div>
          <Text strong style={{ fontSize: 13 }}>{v}</Text>
          <Text style={{ fontSize: 11, color: COLORS.textSecondary, display: 'block' }}>
            版本 v{r.versionNo}
          </Text>
        </div>
      ),
    },
    {
      title: '合同名称',
      key: 'contractName',
      width: 220,
      render: (_, r) => (
        <div>
          <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 2 }}>
            {r.snapshot?.contractName ?? '—'}
          </Text>
          {r.snapshot?.contractNo && (
            <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>{r.snapshot.contractNo}</Text>
          )}
        </div>
      ),
    },
    {
      title: '相对方',
      key: 'counterparty',
      width: 160,
      ellipsis: true,
      render: (_, r) => r.snapshot?.counterparty ?? '—',
    },
    {
      title: '综合风险',
      key: 'riskLevel',
      width: 110,
      render: (_, r) => {
        const level = r.snapshot?.overallRiskLevel;
        if (!level) return <Text style={{ color: COLORS.textSecondary }}>—</Text>;
        const cfgMap = {
          high: { label: '高风险', color: COLORS.high, desc: '可能导致重大经济损失或核心权利受限，必须人工确认' },
          medium: { label: '中风险', color: COLORS.medium, desc: '可能影响履约或造成管理成本，建议处理' },
          low: { label: '低风险', color: COLORS.low, desc: '对履约影响较小，可批量处理' },
          notice: { label: '提示项', color: COLORS.notice, desc: '不阻断流程，供业务参考' },
        };
        const cfg = cfgMap[level];
        return (
          <Tooltip title={cfg.desc}>
            <Tag style={{ background: cfg.color, color: '#fff', border: 'none', borderRadius: 4, margin: 0, fontSize: 12, fontWeight: 600 }}>
              {cfg.label}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '风险评分',
      key: 'riskScore',
      width: 100,
      align: 'center',
      render: (_, r) => r.snapshot ? <Text strong>{r.snapshot.riskScore}/100</Text> : '—',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (s: string) => {
        const cfg = STATUS_MAP[s] ?? { label: s, color: 'default' };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: '生成时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (v: string) => (
        <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{formatDateTime(v)}</Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_, r) => (
        <Space size={4}>
          {r.status === 'generated' && (
            <Button type="link" size="small" icon={<Eye size={14} />} onClick={() => navigate(`/reports/${r.id}`)}>
              查看报告
            </Button>
          )}
          {r.status === 'generated' && (
            <Button type="link" size="small" icon={<FileText size={14} />} onClick={() => navigate(`/reviews/${r.reviewTaskId}`)}>
              查看合同
            </Button>
          )}
          {r.status === 'failed' && (
            <Button type="link" size="small" icon={<RotateCw size={14} />} onClick={() => handleRetry(r)}>
              重试
            </Button>
          )}
          {r.status === 'generating' && <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>生成中...</Text>}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="审核报告" description="查看与管理已生成的采购合同审核报告" />

      <Card style={{ marginBottom: 16 }}>
        <Space style={{ width: '100%' }} direction="vertical" size={12}>
          <Space wrap>
            <Input
              allowClear
              placeholder="搜索报告编号、合同名称"
              prefix={<Search size={14} color={COLORS.textSecondary} />}
              style={{ width: 280 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Select
              allowClear
              placeholder="报告状态"
              style={{ width: 140 }}
              value={statusFilter || undefined}
              onChange={(v) => setStatusFilter(v ?? '')}
              options={[
                { value: 'generating', label: '生成中' },
                { value: 'generated', label: '已生成' },
                { value: 'failed', label: '生成失败' },
              ]}
            />
          </Space>
        </Space>
      </Card>

      <Card styles={{ body: { padding: 0 } }}>
        <Table<ReviewReport>
          rowKey="id"
          columns={columns}
          dataSource={reports}
          loading={loading}
          pagination={{ pageSize: PAGE_SIZE, showTotal: (t) => `共 ${t} 份报告` }}
          scroll={{ x: 1000 }}
          locale={{
            emptyText: <EmptyState description="暂无审核报告，完成法务审核后将自动生成" />,
          }}
        />
      </Card>
    </div>
  );
}
