/**
 * 通用空状态
 */
import { Empty, Button } from 'antd';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  description?: string;
  actionText?: string;
  onAction?: () => void;
  image?: ReactNode;
}

export default function EmptyState({ description = '暂无数据', actionText, onAction }: EmptyStateProps) {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={description}
      style={{ padding: '40px 0' }}
    >
      {actionText && onAction && (
        <Button type="primary" onClick={onAction}>
          {actionText}
        </Button>
      )}
    </Empty>
  );
}
