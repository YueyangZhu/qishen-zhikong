/**
 * 页面头部：返回按钮 + 标题 + 描述 + 右侧操作区
 * 返回按钮统一在左上角（标题上方）
 * 支持sticky模式：固定在页面顶部，返回按钮始终可见
 */
import { Typography, Space, Button } from 'antd';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const { Title, Text } = Typography;

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  extra?: React.ReactNode;
  /** 返回按钮目标路径；不传则不显示返回按钮；传 'back' 则走 history.back() */
  backUrl?: string;
  /** 是否启用sticky固定头部：固定到页面顶部，返回按钮始终可见 */
  sticky?: boolean;
}

export default function PageHeader({ title, description, extra, backUrl, sticky = false }: PageHeaderProps) {
  const navigate = useNavigate();
  const stickyStyle: React.CSSProperties = sticky
    ? {
        // 固定在全局 Header（高度56）正下方，返回按钮始终可见
        position: 'sticky',
        top: 56,
        zIndex: 9,
        background: '#f5f7fa',
        padding: '8px 0 12px',
        marginBottom: 16,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
      }
    : { marginBottom: 16 };
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 16,
        flexWrap: 'wrap',
        ...stickyStyle,
      }}
    >
      <div style={{ minWidth: 0 }}>
        {backUrl && (
          <Button
            type="text"
            size="small"
            icon={<ArrowLeft size={14} />}
            style={{ padding: '0 0 4px 0', height: 'auto', marginBottom: 4, color: '#5b6470' }}
            onClick={() => (backUrl === 'back' ? navigate(-1) : navigate(backUrl))}
          >
            返回
          </Button>
        )}
        <Title level={4} style={{ margin: 0, fontWeight: 600 }}>
          {title}
        </Title>
        {description && (
          <Text style={{ color: '#5b6470', fontSize: 13, marginTop: 4, display: 'block' }}>
            {description}
          </Text>
        )}
      </div>
      {extra && <Space wrap>{extra}</Space>}
    </div>
  );
}
