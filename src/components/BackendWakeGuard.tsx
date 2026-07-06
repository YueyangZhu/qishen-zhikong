/**
 * 后端唤醒守卫
 *
 * Render 免费档 15 分钟无请求会休眠，冷启动需 30-90 秒。
 * 用户首次进入系统（或长时间未操作后）访问页面时，后端可能处于休眠状态。
 *
 * 本组件挂在 MainLayout 顶层，首次进入时做一次带 UI 进度的健康检查：
 * - 唤醒中：显示进度提示（不阻塞已登录路由的渲染，但显示顶部进度条）
 * - 唤醒失败：显示"后端唤醒失败，点击重试"全屏错误页
 * - 唤醒成功：放行子路由
 *
 * 避免每个页面各自调 initDB 等待冷启动，统一处理唤醒流程。
 */
import { useEffect, useRef, useState } from 'react';
import { Result, Button, Progress, Typography, Space } from 'antd';
import { ServerCrash, RefreshCw } from 'lucide-react';
import { checkBackendHealth } from '@/services/apiClient';

const { Text, Paragraph } = Typography;

interface BackendWakeGuardProps {
  children: React.ReactNode;
}

export default function BackendWakeGuard({ children }: BackendWakeGuardProps) {
  const [status, setStatus] = useState<'checking' | 'ok' | 'failed'>('checking');
  const [attempt, setAttempt] = useState(0);
  const [maxAttempts, setMaxAttempts] = useState(10);
  const [retryToken, setRetryToken] = useState(0);
  // 标记本次会话是否已唤醒成功过（成功后不再重复检查，避免页面切换重复唤醒）
  const wokenRef = useRef(false);

  useEffect(() => {
    // 已唤醒成功过，直接放行
    if (wokenRef.current) {
      setStatus('ok');
      return;
    }
    let cancelled = false;
    setStatus('checking');
    checkBackendHealth((att, max) => {
      if (cancelled) return;
      setAttempt(att);
      setMaxAttempts(max);
    }).then((result) => {
      if (cancelled) return;
      if (result) {
        wokenRef.current = true;
        setStatus('ok');
      } else {
        setStatus('failed');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [retryToken]);

  if (status === 'ok') return <>{children}</>;

  if (status === 'failed') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f7fa' }}>
        <Result
          icon={<ServerCrash size={80} color="#1677ff" />}
          status="info"
          title="后端服务唤醒失败"
          subTitle={
            <Space direction="vertical" size={4}>
              <Text type="secondary">Render 免费档服务会休眠，冷启动需 30-90 秒。</Text>
              <Text type="secondary">已连续尝试 {maxAttempts} 次仍未连接成功，可能是网络波动或服务异常。</Text>
            </Space>
          }
          extra={[
            <Button
              key="retry"
              type="primary"
              size="large"
              icon={<RefreshCw size={16} />}
              onClick={() => setRetryToken((t) => t + 1)}
            >
              重新唤醒后端
            </Button>,
            <Button
              key="refresh"
              size="large"
              onClick={() => window.location.reload()}
            >
              刷新页面
            </Button>,
          ]}
        />
      </div>
    );
  }

  // 唤醒中：全屏进度
  const percent = Math.round((attempt / maxAttempts) * 100);
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f7fa' }}>
      <div style={{ width: '100%', maxWidth: 480, padding: 32, textAlign: 'center' }}>
        <Space direction="vertical" size={24} style={{ width: '100%' }}>
          <div>
            <RefreshCw size={48} color="#1677ff" style={{ animation: 'spin 1.5s linear infinite' }} />
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          </div>
          <div>
            <Paragraph style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>
              正在唤醒后端服务
            </Paragraph>
            <Text type="secondary" style={{ fontSize: 13 }}>
              Render 免费档服务休眠后冷启动需 30-90 秒，请稍候
            </Text>
          </div>
          <div>
            <Progress
              percent={percent}
              status="active"
              strokeColor={{ from: '#1677ff', to: '#13c2c2' }}
              format={() => `${attempt}/${maxAttempts}`}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              第 {attempt} 次尝试连接后端...
            </Text>
          </div>
        </Space>
      </div>
    </div>
  );
}
