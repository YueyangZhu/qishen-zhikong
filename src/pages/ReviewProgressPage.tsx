/**
 * P05 审核处理进度页
 * - 7 阶段进度展示
 * - 阶段状态：waiting / processing / success / failed
 * - 整体进度条
 * - 失败重试
 * - 完成后自动跳转详情
 * - 刷新可恢复（基于 start 时间戳）
 *
 * 轮询策略：
 * - 仅在「等待 AI 启动」阶段使用 600ms 定时器轮询 fetchProgress
 * - 真实 AI 开始执行后（realAIRunRef=true）立即停止定时器，
 *   改由 onProgress 回调手动调用 fetchProgress 更新 UI
 * - fetchProgress 失败时：若已有 result 则保留旧数据不覆盖，
 *   避免单次网络抖动导致整页错误闪烁
 */
import { useEffect, useRef, useState } from 'react';
import { Card, Progress, Steps, Button, Typography, Space, Result, Alert, Skeleton, Tag, App } from 'antd';
import {
  UploadCloud, FileSearch, ListTree, Database, ShieldCheck, Sparkles, CheckCircle2, RotateCw, AlertTriangle, ArrowRight, FileText,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { reviewService, type ProgressResult } from '@/services/reviewService';
import { runFullAIReview } from '@/services/apiClient';
import { useRealAIStore } from '@/store/useRealAIStore';
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
  // error 只在「完全没有 result」时才触发整页错误；已有 result 时的网络抖动保留旧数据
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 真实 AI 执行标记：防止重复触发（真实 AI 审核只执行一次）
  const realAIRunRef = useRef(false);
  // 跳转标记：避免 done 后多次触发 setTimeout 跳转
  const navigateRef = useRef(false);

  const fetchProgress = async () => {
    if (!id) return;
    try {
      const r = await reviewService.getProgress(id);
      setResult(r);
      // 仅在没有错误时清除 error（保留旧 result 时不清除 error 让 UI 有连续性）
      setError(null);
      if (r.done) {
        // 完成后延迟跳转，给数据库多一点同步时间（避免详情页首次查询读到旧数据）
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (!navigateRef.current) {
          navigateRef.current = true;
          setTimeout(() => navigate(`/reviews/${id}`), 2000);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '加载进度失败';
      // 关键：若已有 result，保留旧数据不覆盖，避免单次网络抖动导致整页错误闪烁
      if (result) {
        console.warn('[ProgressPage] 进度查询失败，保留上次进度数据:', msg);
      } else {
        // 首次加载就失败，才显示整页错误
        setError(msg);
      }
      // 网络抖动不停定时器（只有 AI 失败或 done 才停）
    } finally {
      setLoading(false);
    }
  };

  // 启动时拉取一次 + 启动定时器（AI 执行后会停掉定时器）
  useEffect(() => {
    fetchProgress();
    timerRef.current = setInterval(fetchProgress, 600);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 真实 AI 审核执行：检测到上传文件任务（非样例合同）后，从内存 store 取 File 调用 runFullAIReview
  // 3 阶段（parse/extract/review）映射到 7 阶段进度展示，完成后填充任务结果
  useEffect(() => {
    if (!id || !currentUser) return;
    const task = result?.task;
    if (!task) return;
    // 仅当任务为上传文件审核（无 sampleId）、尚未执行、且处于处理中状态时触发
    if (task.sampleId || realAIRunRef.current) return;
    if (task.status !== 'parsing' && task.status !== 'ai_reviewing') return;

    const { file, options } = useRealAIStore.getState();
    if (!file) {
      // File 丢失（页面刷新）：标记失败并提示
      realAIRunRef.current = true;
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      reviewService.failRealAIReview(id, '页面已刷新，上传文件丢失，请重新发起审核', currentUser).then(() => {
        message.error('页面已刷新，上传文件丢失，请重新发起审核');
        fetchProgress();
      });
      return;
    }

    // AI 开始执行：立即停止定时轮询，改由 onProgress 回调驱动 UI 更新
    // 这样避免定时器和 onProgress 同时调用 fetchProgress 导致冲突和闪烁
    realAIRunRef.current = true;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    // 阶段映射：runFullAIReview 的 3 阶段 → 7 阶段进度展示
    const stageMap: Record<string, string> = {
      parse: 'parse',      // 解析文档 → 解析阶段
      extract: 'extract',  // 抽取字段 → 抽取阶段
      review: 'ai',        // AI 审核 → AI 语义审核阶段
      done: 'result',      // 完成 → 生成结果
      error: 'parse',
    };
    // 进度映射：runFullAIReview 的 0-100 → 7 阶段进度
    const progressMap: Record<string, number> = {
      parse: 15, extract: 40, review: 70, done: 100, error: 0,
    };

    runFullAIReview(file, options ?? {}, async (p) => {
      // done 阶段不处理：completeRealAIReview 尚未执行，风险数据还没写入数据库，
      // 此时触发导航会让详情页读到空风险列表。
      // 由 then 回调在 completeRealAIReview 保存完所有数据后才触发导航。
      if (p.stage === 'done') return;
      const stage = stageMap[p.stage] ?? 'parse';
      const progress = progressMap[p.stage] ?? p.progress;
      try {
        await reviewService.updateRealAIStage(id, stage, progress);
      } catch (e) {
        // 进度更新失败不中断 AI 流程，只记录日志
        console.warn('[ProgressPage] updateRealAIStage 失败（不中断）:', e);
      }
      fetchProgress(); // 刷新 UI
    }, id).then(async (aiResult) => {
      console.info(`[ProgressPage] AI审核完成，准备保存：字段${aiResult.fields.length}个，风险${aiResult.risks.length}项`);
      await reviewService.completeRealAIReview(id, currentUser, aiResult);
      console.info('[ProgressPage] completeRealAIReview 保存完成');
      message.success(`AI 审核完成：识别 ${aiResult.risks.length} 项风险`);
      // 审核完成后刷新一次 token，避免跳转详情页时 token 过期导致 401
      try {
        const { refreshAccessToken } = await import('@/services/dataApi');
        await refreshAccessToken();
      } catch {
        // token 刷新失败不阻断跳转，详情页会处理 401
      }
      // 延迟 1 秒后刷新进度（给数据库提交多一点时间），done=true 会触发跳转
      setTimeout(() => fetchProgress(), 1000);
    }).catch(async (e) => {
      const errMsg = e instanceof Error ? e.message : 'AI 审核失败';
      console.error('[ProgressPage] AI审核失败:', e);
      // 失败后停止定时轮询，避免错误提示反复闪烁
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      // 重置执行标记，允许用户点"重新审核"后再次触发 AI
      realAIRunRef.current = false;
      navigateRef.current = false;
      await reviewService.failRealAIReview(id, errMsg, currentUser);
      message.error(errMsg);
      fetchProgress();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.task?.sampleId, result?.task?.status, id, currentUser]);

  const handleRetry = async () => {
    if (!id || !currentUser) return;
    setRetrying(true);
    try {
      // 判断是否为真实 AI 任务（无 sampleId 且内存 store 里有 File）
      const { file: storedFile, options } = useRealAIStore.getState();
      const task = result?.task;
      const isRealAI = !task?.sampleId && !!storedFile;

      // 重置执行标记，允许 useEffect 重新触发 AI
      realAIRunRef.current = false;
      navigateRef.current = false;

      if (isRealAI) {
        // 真实 AI 任务：用 startRealAIReview 重新设置状态 + 存 File
        await reviewService.startRealAIReview(id, currentUser, storedFile!, options ?? {});
      } else {
        // 样例合同任务：标准 startReview
        await reviewService.startReview(id, currentUser);
      }
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

  // 只在「完全没有 result」时才显示整页错误（首次加载失败）
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
        backUrl="back"
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
        <Card style={{ marginTop: 16, textAlign: 'center', padding: '12px 0' }}>
          <Space>
            <CheckCircle2 size={18} color={COLORS.low} />
            <Text strong>AI 审核完成，共识别 {task.riskCount.high + task.riskCount.medium + task.riskCount.low + task.riskCount.notice} 项风险，正在跳转详情页...</Text>
          </Space>
        </Card>
      )}

      <div style={{ marginTop: 16, textAlign: 'center' }}>
        <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{DISCLAIMER}</Text>
      </div>
    </div>
  );
}
