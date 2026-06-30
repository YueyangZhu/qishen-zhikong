/**
 * 页面头部：标题 + 描述 + 右侧操作区
 */
import { Typography, Space } from 'antd';

const { Title, Text } = Typography;

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  extra?: React.ReactNode;
}

export default function PageHeader({ title, description, extra }: PageHeaderProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
      <div>
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
