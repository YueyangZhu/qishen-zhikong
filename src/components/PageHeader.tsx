/**
 * 页面头部：返回按钮 + 标题 + 描述 + 右侧操作区
 * 返回按钮统一在左上角（标题上方）
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
}

export default function PageHeader({ title, description, extra, backUrl }: PageHeaderProps) {
  const navigate = useNavigate();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
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
