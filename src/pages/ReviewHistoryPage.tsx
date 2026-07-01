/**
 * P11 审核记录
 * - 审核任务状态变化时间轴
 * - 操作人、时间、前后状态、备注
 * - 文件记录、报告记录
 */
import { useEffect, useState } from 'react';
import {
  Card, Typography, Space, Button, Tag, Timeline, Empty, Skeleton, Descriptions, Divider, App,
} from 'antd';
import {
  ArrowLeft, PlusCircle, RefreshCw, CheckCircle, Edit3, Ban, ClipboardCheck, Send,
  ShieldCheck, Undo2, FileText, Clock, History,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { reviewService } from '@/services/reviewService';
import { auditService, type HistoryEntry } from '@/services/auditService';
import { reportService } from '@/services/reportService';
import { COLORS } from '@/constants';
import { formatDateTime, formatFileSize } from '@/utils/format';
import { ReviewStatusTag } from '@/components/StatusTag';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import type { ReviewTask, ReviewReport } from '@/types';

const { Text, Paragraph } = Typography;

const ICON_MAP: Record<string, React.ReactNode> = {
  PlusCircle: <PlusCircle size={14} />,
  RefreshCw: <RefreshCw size={14} />,
  CheckCircle: <CheckCircle size={14} />,
  Edit3: <Edit3 size={14} />,
  Ban: <Ban size={14} />,
  ClipboardCheck: <ClipboardCheck size={14} />,
  Send: <Send size={14} />,
  ShieldCheck: <ShieldCheck size={14} />,
  Undo2: <Undo2 size={14} />,
  FileText: <FileText size={14} />,
  Clock: <Clock size={14} />,
};

export default function ReviewHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { message } = App.useApp();

  const [loading, setLoading] = useState(true);
  const [task, setTask] = useState<ReviewTask | null>(null);
  const [timeline, setTimeline] = useState<HistoryEntry[]>([]);
  const [reports, setReports] = useState<ReviewReport[]>([]);

  useEffect(() => {
    (async () => {
      if (!id) return;
      setLoading(true);
      try {
        const [t, tl, r] = await Promise.all([
          reviewService.getTask(id),
          auditService.getTimeline(id),
          reportService.list({ reviewTaskId: id }),
        ]);
        setTask(t ?? null);
        setTimeline(tl);
        setReports(r);
      } catch (e) {
        message.error(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (!task) return null;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <PageHeader
        title="审核记录"
        description={
          <Space>
            <Text>{task.contractName}</Text>
            <ReviewStatusTag status={task.status} />
          </Space>
        }
        backUrl={`/reviews/${task.id}`}
      />

      {/* 任务基本信息 */}
      <Card title="任务信息" size="small" style={{ marginBottom: 16 }}>
        <Descriptions column={2} size="small">
          <Descriptions.Item label="合同名称">{task.contractName}</Descriptions.Item>
          <Descriptions.Item label="合同编号">{task.contractNo}</Descriptions.Item>
          <Descriptions.Item label="相对方">{task.counterparty}</Descriptions.Item>
          <Descriptions.Item label="发起人">{task.creatorName}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{formatDateTime(task.createdAt)}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{formatDateTime(task.updatedAt)}</Descriptions.Item>
          {task.submittedAt && <Descriptions.Item label="提交复核时间">{formatDateTime(task.submittedAt)}</Descriptions.Item>}
          {task.completedAt && <Descriptions.Item label="完成时间">{formatDateTime(task.completedAt)}</Descriptions.Item>}
          {task.legalReviewerName && <Descriptions.Item label="法务审核人">{task.legalReviewerName}</Descriptions.Item>}
        </Descriptions>
      </Card>

      {/* 文件记录 */}
      <Card title="文件记录" size="small" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: '#fafbfc', borderRadius: 6 }}>
          <FileText size={18} color={COLORS.primary} />
          <div style={{ flex: 1 }}>
            <Text strong>{task.fileName}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginLeft: 8 }}>
              {formatFileSize(task.fileSize)}
            </Text>
          </div>
          <Tag>原始上传</Tag>
        </div>
      </Card>

      {/* 报告记录 */}
      {reports.length > 0 && (
        <Card title="报告记录" size="small" style={{ marginBottom: 16 }}>
          {reports.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: '#fafbfc', borderRadius: 6, marginBottom: 8 }}>
              <FileText size={18} color={COLORS.primary} />
              <div style={{ flex: 1 }}>
                <Text strong>{r.reportNo}</Text>
                <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginLeft: 8 }}>
                  v{r.versionNo} · {formatDateTime(r.createdAt)}
                </Text>
              </div>
              <Tag color={r.status === 'generated' ? 'success' : r.status === 'generating' ? 'processing' : 'error'}>
                {r.status === 'generated' ? '已生成' : r.status === 'generating' ? '生成中' : '失败'}
              </Tag>
              {r.status === 'generated' && (
                <Button type="link" size="small" onClick={() => navigate(`/reports/${r.id}`)}>查看</Button>
              )}
            </div>
          ))}
        </Card>
      )}

      {/* 操作时间轴 */}
      <Card title={<Space><History size={16} /><Text strong>操作时间轴</Text></Space>}>
        {timeline.length === 0 ? (
          <EmptyState description="暂无操作记录" />
        ) : (
          <Timeline
            items={timeline.map((entry) => {
              // 拆分 remark 为多行，便于结构化展示
              const remarkLines = entry.log.remark ? entry.log.remark.split('\n').filter(Boolean) : [];
              const isMultiLine = remarkLines.length > 1;
              return {
                color: entry.color,
                dot: ICON_MAP[entry.icon] ?? <Clock size={14} />,
                children: (
                  <div style={{ paddingBottom: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                      <Text strong style={{ fontSize: 13 }}>{entry.log.action}</Text>
                      <Text style={{ fontSize: 11, color: COLORS.textSecondary, whiteSpace: 'nowrap' }}>
                        {formatDateTime(entry.log.createdAt)}
                      </Text>
                    </div>
                    <div style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 }}>
                      <Text style={{ fontSize: 12 }}>操作人：{entry.log.operatorName}</Text>
                      {entry.log.beforeState && entry.log.afterState && (
                        <span style={{ marginLeft: 12 }}>
                          · <Text style={{ fontSize: 12 }}>{entry.log.beforeState}</Text>
                          <span style={{ margin: '0 4px' }}>→</span>
                          <Text strong style={{ fontSize: 12, color: COLORS.primary }}>{entry.log.afterState}</Text>
                        </span>
                      )}
                    </div>
                    {remarkLines.length > 0 && (
                      <div style={{
                        marginTop: 4,
                        padding: '8px 12px',
                        background: '#fafbfc',
                        borderRadius: 4,
                        border: `1px solid ${COLORS.border}`,
                        fontSize: 12,
                        lineHeight: 1.8,
                      }}>
                        {isMultiLine ? (
                          <div>
                            <Text style={{ fontSize: 11, color: COLORS.textSecondary, fontWeight: 600 }}>操作详情：</Text>
                            <div style={{ marginTop: 4 }}>
                              {remarkLines.map((line, i) => (
                                <div key={i} style={{ color: COLORS.textSecondary, whiteSpace: 'pre-wrap' }}>
                                  {line.startsWith('  -') ? line : `• ${line}`}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{remarkLines[0]}</Text>
                        )}
                      </div>
                    )}
                  </div>
                ),
              };
            })}
          />
        )}
      </Card>
    </div>
  );
}
