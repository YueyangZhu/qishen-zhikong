/**
 * 可调整列宽的 Table 组件（基于 AntD Table + 原生 mouse events，无第三方依赖）
 *
 * 用法：
 *   <ResizableTable<RiskRule>
 *     columns={columns}
 *     dataSource={rules}
 *     storageKey="rules"  // 可选：持久化列宽到 localStorage
 *   />
 *
 * 列配置中：
 * - 添加 `width` 作为初始宽度（不设默认 150）
 * - 添加 `resizable: false` 可禁用某列调整（操作列建议禁用）
 * - 添加 `minWidth` 可设置最小宽度（默认 80）
 *
 * 注意：fixed: 'right' 的列默认不可调整宽度
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Table, type TableProps } from 'antd';
import type { ColumnsType, ColumnType } from 'antd/es/table';
import { COLORS } from '@/constants';

interface ResizableColumn<T> extends ColumnType<T> {
  /** 是否可调整宽度，默认 true；fixed 列强制为 false */
  resizable?: boolean;
  /** 最小宽度，默认 80 */
  minWidth?: number;
}

type ResizableColumnsType<T> = ResizableColumn<T>[];

interface ResizeState {
  columnKey: string;
  startX: number;
  startWidth: number;
  minWidth: number;
}

interface ResizableTableProps<T> extends Omit<TableProps<T>, 'columns'> {
  columns: ResizableColumnsType<T>;
  /** 列宽持久化 key（传则持久化到 localStorage，不传则内存态） */
  storageKey?: string;
}

/** 表头单元格拖拽手柄 */
function ResizeHandle({
  resizing,
  onMouseDown,
}: {
  resizing: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <span
      role="button"
      aria-label="调整列宽"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={onMouseDown}
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        width: 6,
        cursor: 'col-resize',
        zIndex: 10,
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span
        style={{
          width: 2,
          height: resizing ? '100%' : 14,
          background: resizing ? COLORS.primary : COLORS.border,
          transition: 'height 0.15s',
          borderRadius: 1,
        }}
      />
    </span>
  );
}

export default function ResizableTable<T extends object>({
  columns,
  storageKey,
  ...tableProps
}: ResizableTableProps<T>) {
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    if (storageKey) {
      try {
        const saved = localStorage.getItem(`table-width:${storageKey}`);
        if (saved) return JSON.parse(saved);
      } catch {
        /* ignore */
      }
    }
    return {};
  });

  // 持久化列宽
  useEffect(() => {
    if (storageKey && Object.keys(columnWidths).length > 0) {
      try {
        localStorage.setItem(`table-width:${storageKey}`, JSON.stringify(columnWidths));
      } catch {
        /* ignore */
      }
    }
  }, [columnWidths, storageKey]);

  // 鼠标移动处理
  useEffect(() => {
    if (!resizeState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeState.startX;
      const newWidth = Math.max(resizeState.minWidth, resizeState.startWidth + delta);
      setColumnWidths((prev) => ({ ...prev, [resizeState.columnKey]: newWidth }));
    };

    const handleMouseUp = () => {
      setResizeState(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizeState]);

  const handleResize = useCallback(
    (columnKey: string, startWidth: number, minWidth: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setResizeState({
        columnKey,
        startX: e.clientX,
        startWidth,
        minWidth,
      });
    },
    [],
  );

  // 注入 resize 手柄到表头
  const enhancedColumns: ColumnsType<T> = columns.map((col) => {
    const key = (col.key as string) || (col.dataIndex as string) || '';
    // 仅 fixed: 'right' 的操作列禁用调整；fixed: 'left' 的首列允许调整
    const canResize = col.resizable !== false && col.fixed !== 'right';
    const minWidth = col.minWidth ?? 80;
    const currentWidth = columnWidths[key] ?? (col.width as number | undefined) ?? 150;

    return {
      ...col,
      width: currentWidth,
      // onHeaderCell 返回的 props 会合并到 th 上，设置 position: relative 让手柄定位生效
      onHeaderCell: () => ({
        style: { position: 'relative' } as React.CSSProperties,
      }),
      title: (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: canResize ? 6 : 0, width: '100%' }}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {col.title as ReactNode}
          </span>
          {canResize && (
            <ResizeHandle
              resizing={resizeState?.columnKey === key}
              onMouseDown={(e) => handleResize(key, currentWidth, minWidth, e)}
            />
          )}
        </div>
      ),
    };
  });

  return <Table<T> {...tableProps} columns={enhancedColumns} />;
}
