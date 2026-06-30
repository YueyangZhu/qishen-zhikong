/**
 * 图表卡片：统一标题、描述、内容区
 */
import { Card, Skeleton } from 'antd';

interface ChartCardProps {
  title: string;
  description?: string;
  loading?: boolean;
  extra?: React.ReactNode;
  height?: number;
  children: React.ReactNode;
}

export default function ChartCard({ title, description, loading, extra, height = 280, children }: ChartCardProps) {
  return (
    <Card
      title={
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
          {description && (
            <div style={{ fontSize: 12, color: '#5b6470', fontWeight: 400, marginTop: 2 }}>{description}</div>
          )}
        </div>
      }
      extra={extra}
      styles={{ body: { padding: 16, height, position: 'relative' } }}
      style={{ height: '100%' }}
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : (
        <div style={{ height: '100%' }}>{children}</div>
      )}
    </Card>
  );
}
