/**
 * P06 合同信息字段确认页
 * - 展示 AI 抽取字段（含置信度）
 * - 逐字段编辑
 * - 低置信度字段标记
 * - 字段来源原文
 * - 确认全部字段
 */
import { useEffect, useState } from 'react';
import {
  Card, Table, Button, Typography, Space, Tag, Tooltip, Input, App, Alert, Statistic, Row, Col, Skeleton, Result,
} from 'antd';
import { ArrowLeft, Check, Edit3, Save, FileCheck2, AlertTriangle } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import { useAuthStore } from '@/store/useAuthStore';
import { reviewService } from '@/services/reviewService';
import { fieldService } from '@/services/fieldService';
import { COLORS } from '@/constants';
import { getConfidenceLevel } from '@/utils/logic';
import PageHeader from '@/components/PageHeader';
import { ReviewStatusTag } from '@/components/StatusTag';
import type { ReviewTask, ExtractedField } from '@/types';

const { Text } = Typography;

export default function FieldsConfirmPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuthStore();
  const { message, modal } = App.useApp();

  const [loading, setLoading] = useState(true);
  const [task, setTask] = useState<ReviewTask | null>(null);
  const [fields, setFields] = useState<ExtractedField[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [t, f] = await Promise.all([
        reviewService.getTask(id),
        fieldService.listByTask(id),
      ]);
      if (!t) {
        message.error('任务不存在');
        navigate('/reviews');
        return;
      }
      setTask(t);
      setFields(f);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleStartEdit = (field: ExtractedField) => {
    setEditingId(field.id);
    setEditValue(field.confirmedValue ?? field.fieldValue);
  };

  const handleSave = async (field: ExtractedField) => {
    if (!currentUser) return;
    setSaving(true);
    try {
      await fieldService.update(field.id, editValue, currentUser);
      message.success('字段已更新');
      setEditingId(null);
      loadData();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmAll = () => {
    if (!task || !currentUser || !id) return;
    const unconfirmed = fields.filter((f) => !f.confirmed);
    const lowConf = fields.filter((f) => f.lowConfidence && !f.confirmed);
    modal.confirm({
      title: '确认全部字段',
      content: (
        <div>
          <p>共 {fields.length} 个字段，其中 {unconfirmed.length} 个未确认，{lowConf.length} 个低置信度。</p>
          {lowConf.length > 0 && (
            <p style={{ color: COLORS.medium }}>仍有 {lowConf.length} 个低置信度字段未确认，建议先核对后再确认。</p>
          )}
          <p>确认后将标记合同信息已确认，可提交法务复核。</p>
        </div>
      ),
      okText: '确认全部',
      cancelText: '取消',
      onOk: async () => {
        setSaving(true);
        try {
          await fieldService.confirmAll(id, currentUser);
          message.success('已确认全部字段');
          loadData();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '确认失败');
        } finally {
          setSaving(false);
        }
      },
    });
  };

  if (loading) {
    return <Skeleton active paragraph={{ rows: 6 }} />;
  }

  if (!task) {
    return <Result status="error" title="任务不存在" extra={<Button onClick={() => navigate('/reviews')}>返回列表</Button>} />;
  }

  const confirmedCount = fields.filter((f) => f.confirmed).length;
  const lowConfCount = fields.filter((f) => f.lowConfidence).length;

  const columns: ColumnsType<ExtractedField> = [
    {
      title: '字段',
      dataIndex: 'fieldLabel',
      key: 'fieldLabel',
      width: 140,
      render: (v, r) => (
        <Space>
          <Text strong>{v}</Text>
          {r.lowConfidence && (
            <Tooltip title="AI 置信度较低，建议人工核对">
              <Tag color="warning" style={{ margin: 0, fontSize: 11 }}>
                <AlertTriangle size={10} style={{ marginRight: 2 }} />低置信
              </Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'AI 抽取值',
      dataIndex: 'fieldValue',
      key: 'fieldValue',
      render: (v, r) => {
        if (editingId === r.id) {
          return <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} style={{ width: '100%' }} />;
        }
        return <Text>{v || '—'}</Text>;
      },
    },
    {
      title: '确认值',
      key: 'confirmedValue',
      width: 200,
      render: (_, r) => {
        if (editingId === r.id) {
          return (
            <Space>
              <Button type="primary" size="small" icon={<Save size={12} />} loading={saving} onClick={() => handleSave(r)}>
                保存
              </Button>
              <Button size="small" onClick={() => setEditingId(null)}>
                取消
              </Button>
            </Space>
          );
        }
        if (r.confirmedValue && r.confirmedValue !== r.fieldValue) {
          return (
            <Space>
              <Text strong style={{ color: COLORS.primary }}>{r.confirmedValue}</Text>
              <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>已编辑</Tag>
            </Space>
          );
        }
        if (r.confirmed) {
          return <Tag color="success" icon={<Check size={10} />} style={{ fontSize: 11 }}>已确认</Tag>;
        }
        return <Text style={{ color: COLORS.textSecondary, fontSize: 12 }}>—</Text>;
      },
    },
    {
      title: '置信度',
      dataIndex: 'confidence',
      key: 'confidence',
      width: 110,
      render: (v: number) => {
        const c = getConfidenceLevel(v);
        return (
          <Tooltip title={c.label}>
            <span style={{ color: c.needReview ? COLORS.medium : COLORS.low, fontWeight: 600 }}>
              {Math.round(v * 100)}%
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: '来源原文',
      dataIndex: 'sourceText',
      key: 'sourceText',
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v}>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{v}</Text>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, r) => (
        <Button
          type="link"
          size="small"
          icon={editingId === r.id ? <Save size={12} /> : <Edit3 size={12} />}
          onClick={() => (editingId === r.id ? handleSave(r) : handleStartEdit(r))}
        >
          {editingId === r.id ? '保存' : '编辑'}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="合同信息字段确认"
        description="核对 AI 抽取的合同要素字段，低置信度字段建议人工复核"
        extra={
          <Space>
            <Link to={`/reviews/${task.id}`}>
              <Button icon={<ArrowLeft size={14} />}>返回详情</Button>
            </Link>
            <Button
              type="primary"
              icon={<FileCheck2 size={14} />}
              onClick={handleConfirmAll}
              loading={saving}
              disabled={task.fieldsConfirmed}
            >
              {task.fieldsConfirmed ? '已确认全部字段' : '确认全部字段'}
            </Button>
          </Space>
        }
      />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="字段总数" value={fields.length} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="已确认" value={confirmedCount} valueStyle={{ color: COLORS.low }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="低置信度" value={lowConfCount} valueStyle={{ color: lowConfCount > 0 ? COLORS.medium : COLORS.textPrimary }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="确认状态"
              value={task.fieldsConfirmed ? '已确认' : '待确认'}
              valueStyle={{
                color: task.fieldsConfirmed ? COLORS.low : COLORS.medium,
                fontSize: 20,
                fontWeight: 700,
              }}
            />
          </Card>
        </Col>
      </Row>

      {!task.fieldsConfirmed && (
        <Alert
          type="info"
          showIcon
          message="字段确认后才能提交法务复核"
          description="请逐字段核对 AI 抽取结果，低置信度字段（标记橙色）建议重点核对。确认后可返回审核详情页提交法务复核。"
          style={{ marginBottom: 16 }}
        />
      )}

      <Card styles={{ body: { padding: 0 } }}>
        <Table<ExtractedField>
          rowKey="id"
          columns={columns}
          dataSource={fields}
          pagination={false}
          size="middle"
          scroll={{ x: 900 }}
          rowClassName={(r) => (r.lowConfidence && !r.confirmed ? 'low-confidence-row' : '')}
          locale={{ emptyText: '暂无抽取字段，请先完成合同解析' }}
        />
      </Card>
    </div>
  );
}
