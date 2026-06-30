/**
 * P05 审核处理进度页
 * - 7 阶段进度展示
 * - 阶段状态：waiting / processing / success / failed
 * - 整体进度条
 * - 失败重试
 * - 完成后自动跳转详情
 * - 刷新可恢复（基于 start 时间戳）
 */
import { useEffect, useRef, useState } from 'react';
import { Card, Progress, Steps, Button, Typography, Space, Result, Alert, Skeleton, Tag, App } from 'antd';
import {
  UploadCloud, FileSearch, ListTree, Database, ShieldCheck, Sparkles, CheckCircle2, RotateCw, AlertTriangle, ArrowRight, FileText,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { reviewService, type ProgressResult } from '@/services/reviewService';
import { COLORS, DISCLAIMER } from '@/constants';
import { formatDateTime } from '@/utils/format';
import PageHeader from '@/components/PageHeader';
import { ReviewStatusTag } from '@/components/StatusTag';
import type { ProgressStage } from '@/types';

const { Text, Paragraph } = Typography;

const STAGE_ICONS: Record<string, React.ReactNode> = {
  upload: <UploadCloud size={16} />,
  parse: <FileSearch size={16} />,
  structure: <ListTree size={16} />,
  extract: <Database size={16} />,
  rule: <ShieldCheck size={16} />,
  ai: <Sparkles size={16} />,
  result: <CheckCircle2 size={16} />,
};

export default function ReviewProgressPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuthStore();
  const { message, modal } = App.useApp();

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<ProgressResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchProgress = async () => {
    if (!id) return;
    try {
      const r = await reviewService.getProgress(id);
      setResult(r);
      setError(null);
      if (r.done) {
        // 完成后延迟跳转
        if (timerRef.current) clearInterval(timerRef.current);
        setTimeout(() => navigate(`/reviews/${id}`), 800);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载进度失败');
      if (timerRef.current) clearInterval(timerRef.current);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProgress();
    timerRef.current = setInterval(fetchProgress, 600);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleRetry = async () => {
    if (!id || !currentUser) return;
    setRetrying(true);
    try {
      await reviewService.startReview(id, currentUser);
      message.success('已重新发起审核');
      setLoading(true);
      setError(null);
      fetchProgress();
      timerRef.current = setInterval(fetchProgress, 600);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '重试失败');
    } finally {
      setRetrying(false);
    }
  };

  const handleSimulateFail = () => {
    if (!id || !currentUser) return;
    modal.confirm({
      title: '模拟解析失败',
      content: '将强制中断当前审核流程并标记为失败，用于演示异常处理。是否继续？',
      okText: '继续',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await reviewService.simulateFail(id, currentUser);
          message.success('已模拟失败');
          fetchProgress();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '操作失败');
        }
      },
    });
  };

  if (loading) {
    return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;
  }

  if (error || !result) {
    return (
      <Result
        status="error"
        title="加载进度失败"
        subTitle={error ?? '未知错误'}
        extra={
          <Button type="primary" onClick={() => navigate('/reviews')}>
            返回列表
          </Button>
        }
      />
    );
  }

  const { task, stages, progress, done, failed } = result;

  // 失败状态
  if (failed) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <PageHeader title="审核处理" description={`合同：${task.contractName}`} />
        <Card>
          <Result
            status="error"
            title="AI 审核失败"
            subTitle={task.errorMsg ?? '审核过程出现异常'}
            extra={
              <Space>
                <Button icon={<RotateCw size={14} />} onClick={handleRetry} loading={retrying}>
                  重新审核
                </Button>
                <Button onClick={() => navigate('/reviews')}>返回列表</Button>
              </Space>
            }
          />
          <Alert
            type="info"
            style={{ marginTop: 16 }}
            message="失败说明"
            description={`任务编号：${task.id}，失败时间：${formatDateTime(task.updatedAt)}。可检查文件格式或重新上传后再次发起审核。`}
          />
        </Card>
      </div>
    );
  }

  // 当前阶段索引
  const currentIdx = stages.findIndex((s) => s.status === 'processing');
  const currentStage: ProgressStage | undefined = currentIdx >= 0 ? stages[currentIdx] : stages[stages.length - 1];

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      <PageHeader
        title="AI 审核处理中"
        description={
          <Space>
            <Text>{task.contractName}</Text>
            <ReviewStatusTag status={task.status} />
            <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{task.contractNo}</Text>
          </Space>
        }
      />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 12, background: 'linear-gradient(135deg, #e6f4ff 0%, #e6fffb 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Sparkles size={28} color={COLORS.ai} />
          </div>
          <div style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: 600 }}>
              {done ? '审核已完成' : `当前阶段：${currentStage?.label ?? '—'}`}
            </Text>
            <Paragraph style={{ margin: 0, fontSize: 13, color: COLORS.textSecondary }}>
              {done
                ? '正在跳转到审核详情页...'
                : currentStage?.description ?? 'AI 正在分析合同，请稍候'}
            </Paragraph>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: COLORS.primary, fontFamily: "'DIN', sans-serif" }}>
              {progress}%
            </div>
            <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>整体进度</Text>
          </div>
        </div>
        <Progress
          percent={progress}
          status={done ? 'success' : 'active'}
          strokeColor={{ from: COLORS.primary, to: COLORS.ai }}
          showInfo={false}
        />
      </Card>

      <Card title="处理阶段" styles={{ body: { padding: 24 } }}>
        <Steps
          direction="vertical"
          size="small"
          current={currentIdx}
          items={stages.map((s, i) => {
            const icon = STAGE_ICONS[s.key];
            let status: 'wait' | 'process' | 'finish' | 'error' = 'wait';
            if (s.status === 'success') status = 'finish';
            else if (s.status === 'processing') status = 'process';
            else if (s.status === 'failed') status = 'error';

            return {
              title: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{s.label}</span>
                  {s.status === 'processing' && <Tag color="processing" style={{ margin: 0, fontSize: 11 }}>处理中</Tag>}
                  {s.status === 'success' && <CheckCircle2 size={14} color={COLORS.low} />}
                  {s.status === 'failed' && <AlertTriangle size={14} color={COLORS.high} />}
                </div>
              ),
              description: s.description,
              status,
              icon: <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>,
            };
          })}
        />
      </Card>

      {!done && !failed && (
        <Card style={{ marginTop: 16 }}>
          <Alert
            type="info"
            showIcon
            icon={<FileText size={16} />}
            message="预计处理时间约 10 秒"
            description="审核过程基于时间推进，刷新页面不会丢失进度。完成后将自动跳转至审核详情页。"
          />
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between' }}>
            <Button type="link" danger onClick={handleSimulateFail} icon={<AlertTriangle size={14} />}>
              模拟解析失败（演示用）
            </Button>
            <Button type="link" onClick={() => navigate(`/reviews/${id}`)} disabled>
              {done ? '查看结果' : '审核中，请稍候'}
              <ArrowRight size={14} />
            </Button>
          </div>
        </Card>
      )}

      {done && (
        <Card style={{ marginTop: 16, textAlign: 'center' }}>
          <Result
            status="success"
            title="AI 审核完成"
            subTitle={`共识别 ${task.riskCount.high + task.riskCount.medium + task.riskCount.low + task.riskCount.notice} 项风险，请进入详情页处理`}
            extra={
              <Button type="primary" size="large" icon={<ArrowRight size={16} />} onClick={() => navigate(`/reviews/${id}`)}>
                进入审核详情
              </Button>
            }
          />
        </Card>
      )}

      <div style={{ marginTop: 16, textAlign: 'center' }}>
        <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{DISCLAIMER}</Text>
      </div>
    </div>
  );
}
