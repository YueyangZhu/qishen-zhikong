/**
 * 全局错误边界：捕获子组件渲染异常，避免整树白屏
 *
 * 用法：在 main.tsx 中包裹 <App />
 *   <AntdApp>
 *     <ErrorBoundary>
 *       <App />
 *     </ErrorBoundary>
 *   </AntdApp>
 *
 * 捕获异常后显示友好的错误页，提供「刷新页面」按钮。
 * 开发环境额外展示错误堆栈（可折叠），生产环境仅显示简要提示。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Result, Button, Typography, Space } from 'antd';
import { ReloadOutlined, HomeOutlined, BugOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 记录错误信息（生产环境可接入监控平台）
    this.setState({ error, errorInfo });
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] 捕获到未处理异常：', error, errorInfo);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleGoHome = (): void => {
    window.location.assign('/dashboard');
  };

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    const { error, errorInfo } = this.state;
    const isDev = import.meta.env.DEV;

    return (
      <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>
        <Result
          status="error"
          icon={<BugOutlined style={{ color: '#f5222d' }} />}
          title="页面出现异常"
          subTitle={
            <Text type="secondary">
              页面渲染过程中发生错误，请尝试刷新页面。如问题持续存在，请联系技术支持。
            </Text>
          }
          extra={
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Space>
                <Button type="primary" icon={<ReloadOutlined />} onClick={this.handleReload}>
                  刷新页面
                </Button>
                <Button icon={<HomeOutlined />} onClick={this.handleGoHome}>
                  返回工作台
                </Button>
              </Space>
              {/* 开发环境展示错误堆栈，便于排查 */}
              {isDev && error && (
                <div
                  style={{
                    marginTop: 16,
                    textAlign: 'left',
                    background: '#fafafa',
                    border: '1px solid #f0f0f0',
                    borderRadius: 8,
                    padding: 16,
                    maxWidth: 720,
                    overflow: 'auto',
                  }}
                >
                  <Paragraph strong style={{ marginBottom: 8 }}>
                    错误信息：
                  </Paragraph>
                  <Paragraph
                    style={{
                      margin: 0,
                      fontSize: 12,
                      fontFamily: 'monospace',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      color: '#f5222d',
                    }}
                  >
                    {error.toString()}
                  </Paragraph>
                  {errorInfo?.componentStack && (
                    <>
                      <Paragraph strong style={{ marginTop: 12, marginBottom: 8 }}>
                        组件堆栈：
                      </Paragraph>
                      <Paragraph
                        style={{
                          margin: 0,
                          fontSize: 12,
                          fontFamily: 'monospace',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          color: '#8c8c8c',
                        }}
                      >
                        {errorInfo.componentStack}
                      </Paragraph>
                    </>
                  )}
                </div>
              )}
            </Space>
          }
        />
      </div>
    );
  }
}

export default ErrorBoundary;
