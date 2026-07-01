/**
 * P12 风险规则库
 * - 规则列表、全字段搜索、筛选、列宽可调整
 * - 新建/编辑规则、启用/停用、查看版本、查看详情（业务人员只读）
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Card, Button, Input, Select, Space, Typography, Tag, Tooltip, App, Modal, Form, Drawer, Descriptions, Empty, Timeline, Skeleton,
} from 'antd';
import {
  Search, Plus, Edit3, Power, Eye, Trash2, Shield, History,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/store/useAuthStore';
import { ruleService, type RuleFilter } from '@/services/ruleService';
import type { RuleVersionRecord } from '@/services/db';
import {
  COLORS, RISK_LEVEL_OPTIONS, RISK_CATEGORY_OPTIONS, RISK_LEVEL_MAP,
  RISK_CATEGORY_MAP, RULE_METHOD_MAP,
} from '@/constants';
import { RiskLevelTag } from '@/components/StatusTag';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import ResizableTable from '@/components/ResizableTable';
import { formatDateTime } from '@/utils/format';
import type { RiskRule, RiskLevel, RiskCategory, RuleMethod, RuleStatus } from '@/types';

const { TextArea } = Input;
const { Text, Paragraph } = Typography;

const STATUS_MAP: Record<RuleStatus, { label: string; color: string }> = {
  enabled: { label: '已启用', color: 'success' },
  disabled: { label: '已停用', color: 'default' },
  draft: { label: '草稿', color: 'warning' },
};

const RULE_METHOD_OPTIONS = (Object.keys(RULE_METHOD_MAP) as RuleMethod[]).map((k) => ({ value: k, label: RULE_METHOD_MAP[k].label }));

// 检测方式说明（用于详情抽屉展示）
const METHOD_DESC: Record<RuleMethod, string> = {
  field: '字段规则：校验合同字段是否填写、格式是否正确。例如甲方名称、统一社会信用代码是否缺失。',
  keyword: '关键词规则：在合同段落中匹配预设关键词，命中即标记风险。例如"尽快""另行约定"等模糊表述。',
  ai: 'AI语义规则：由大模型结合上下文语义判断，用于复杂条款（如违约金是否对等、知识产权归属是否合理）。',
};

export default function RuleListPage() {
  const { currentUser } = useAuthStore();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const [searchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<RiskRule[]>([]);
  const [keyword, setKeyword] = useState('');
  const [riskTypeFilter, setRiskTypeFilter] = useState<RiskCategory | ''>('');
  const [riskLevelFilter, setRiskLevelFilter] = useState<RiskLevel | ''>('');
  const [statusFilter, setStatusFilter] = useState<RuleStatus | ''>('');
  const [methodFilter, setMethodFilter] = useState<RuleMethod | ''>('');

  const [editModal, setEditModal] = useState<RiskRule | null>(null);
  const [createModal, setCreateModal] = useState(false);
  const [detailDrawer, setDetailDrawer] = useState<RiskRule | null>(null);
  const [versionDrawer, setVersionDrawer] = useState<RiskRule | null>(null);
  const [versions, setVersions] = useState<RuleVersionRecord[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canManage = currentUser?.role === 'admin' || currentUser?.role === 'legal';

  const loadRules = async () => {
    setLoading(true);
    try {
      const filter: RuleFilter = {
        keyword: keyword || undefined,
        riskType: riskTypeFilter || undefined,
        riskLevel: riskLevelFilter || undefined,
        status: statusFilter || undefined,
      };
      const list = await ruleService.list(filter);
      setRules(list);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, riskTypeFilter, riskLevelFilter, statusFilter]);

  // 从 URL 读取 keyword 参数（从风险卡片点击"规则 RR-018"跳转过来时自动搜索）
  useEffect(() => {
    const kw = searchParams.get('keyword');
    if (kw && kw !== keyword) {
      setKeyword(kw);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleToggle = (rule: RiskRule) => {
    modal.confirm({
      title: rule.status === 'enabled' ? '停用规则' : '启用规则',
      content: `确认${rule.status === 'enabled' ? '停用' : '启用'}规则「${rule.name}」？`,
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        try {
          await ruleService.toggle(rule.id);
          message.success(`已${rule.status === 'enabled' ? '停用' : '启用'}`);
          loadRules();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '操作失败');
        }
      },
    });
  };

  const handleDelete = (rule: RiskRule) => {
    modal.confirm({
      title: '删除规则',
      content: `确认删除规则「${rule.name}」？删除后无法恢复。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await ruleService.remove(rule.id);
          message.success('已删除');
          loadRules();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '删除失败');
        }
      },
    });
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (editModal) {
        await ruleService.update(editModal.id, values);
        message.success('规则已更新');
      } else {
        await ruleService.create({ ...values, code: values.code || `RR-${Date.now().toString().slice(-6)}` });
        message.success('规则已创建');
      }
      setEditModal(null);
      setCreateModal(false);
      form.resetFields();
      loadRules();
    } catch (e) {
      if (e instanceof Error) message.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (rule: RiskRule) => {
    setEditModal(rule);
    form.setFieldsValue(rule);
  };

  const openCreate = () => {
    setCreateModal(true);
    form.resetFields();
    form.setFieldsValue({
      contractType: '通用',
      riskType: 'breach',
      riskLevel: 'medium',
      method: 'keyword',
      status: 'draft',
    });
  };

  const handleViewVersions = async (rule: RiskRule) => {
    setVersionDrawer(rule);
    setVersions([]);
    setVersionsLoading(true);
    try {
      const list = await ruleService.getVersions(rule.id);
      setVersions(list);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载版本失败');
    } finally {
      setVersionsLoading(false);
    }
  };

  // 检测方式本地筛选（前端过滤，因为后端 RuleFilter 未含 method）
  const finalRules = useMemo(() => {
    if (!methodFilter) return rules;
    return rules.filter((r) => r.method === methodFilter);
  }, [rules, methodFilter]);

  const columns = [
    {
      title: '规则ID', dataIndex: 'id', key: 'id', width: 100, minWidth: 80,
      render: (v: string) => <Text strong style={{ fontSize: 12, color: COLORS.primary }}>{v}</Text>,
    },
    {
      title: '规则编码', dataIndex: 'code', key: 'code', width: 130, minWidth: 100,
      render: (v: string, r: RiskRule) => (
        <div>
          <Text style={{ fontSize: 12 }}>{v}</Text>
          <Text style={{ fontSize: 11, color: COLORS.textSecondary, display: 'block' }}>v{r.version}</Text>
        </div>
      ),
    },
    {
      title: '规则名称', dataIndex: 'name', key: 'name', width: 180, minWidth: 120,
      ellipsis: true,
      render: (v: string) => <Text strong style={{ fontSize: 13 }}>{v}</Text>,
    },
    {
      title: '合同类型', dataIndex: 'contractType', key: 'contractType', width: 100, minWidth: 80,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '风险类型', dataIndex: 'riskType', key: 'riskType', width: 110, minWidth: 90,
      render: (v: RiskCategory) => <Text style={{ fontSize: 12 }}>{RISK_CATEGORY_MAP[v]?.label ?? v}</Text>,
    },
    {
      title: '风险等级', dataIndex: 'riskLevel', key: 'riskLevel', width: 90, minWidth: 80,
      render: (l: RiskLevel) => <RiskLevelTag level={l} />,
    },
    {
      title: '检测方式', dataIndex: 'method', key: 'method', width: 110, minWidth: 90,
      render: (m: RuleMethod) => <Tag color={m === 'ai' ? 'cyan' : m === 'keyword' ? 'blue' : 'default'}>{RULE_METHOD_MAP[m].label}</Tag>,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90, minWidth: 80,
      render: (s: RuleStatus) => <Tag color={STATUS_MAP[s].color}>{STATUS_MAP[s].label}</Tag>,
    },
    {
      title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 170, minWidth: 140,
      render: (v: string) => (
        <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{formatDateTime(v)}</Text>
      ),
    },
    {
      title: '操作', key: 'action', width: 200, fixed: 'right' as const, resizable: false as const,
      render: (_: unknown, r: RiskRule) => (
        <Space size={4}>
          <Tooltip title="查看详情">
            <Button type="link" size="small" icon={<Eye size={12} />} onClick={() => setDetailDrawer(r)} />
          </Tooltip>
          {canManage && (
            <Button type="link" size="small" icon={<Edit3 size={12} />} onClick={() => openEdit(r)}>编辑</Button>
          )}
          {canManage && (
            <Tooltip title={r.status === 'enabled' ? '停用' : '启用'}>
              <Button type="link" size="small" icon={<Power size={12} />} onClick={() => handleToggle(r)} />
            </Tooltip>
          )}
          <Tooltip title="查看版本">
            <Button type="link" size="small" icon={<History size={12} />} onClick={() => handleViewVersions(r)} />
          </Tooltip>
          {canManage && (
            <Tooltip title="删除">
              <Button type="link" size="small" danger icon={<Trash2 size={12} />} onClick={() => handleDelete(r)} />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  const renderForm = () => (
    <Form form={form} layout="vertical" requiredMark="optional">
      <Form.Item label="规则名称" name="name" rules={[{ required: true, message: '请输入规则名称' }]}>
        <Input placeholder="如：预付款比例检查" maxLength={50} />
      </Form.Item>
      <Form.Item label="规则编码" name="code" rules={[{ required: true, message: '请输入规则编码' }]}>
        <Input placeholder="如：RR-001" disabled={!!editModal} />
      </Form.Item>
      <Space style={{ display: 'flex' }}>
        <Form.Item label="合同类型" name="contractType" rules={[{ required: true }]} style={{ flex: 1 }}>
          <Select options={[
            { value: '通用', label: '通用' },
            { value: '软件采购', label: '软件采购' },
            { value: '硬件采购', label: '硬件采购' },
            { value: '服务采购', label: '服务采购' },
            { value: '系统集成', label: '系统集成' },
          ]} />
        </Form.Item>
        <Form.Item label="风险类型" name="riskType" rules={[{ required: true }]} style={{ flex: 1 }}>
          <Select options={RISK_CATEGORY_OPTIONS} />
        </Form.Item>
      </Space>
      <Space style={{ display: 'flex' }}>
        <Form.Item label="风险等级" name="riskLevel" rules={[{ required: true }]} style={{ flex: 1 }}>
          <Select options={RISK_LEVEL_OPTIONS} />
        </Form.Item>
        <Form.Item label="检测方式" name="method" rules={[{ required: true }]} style={{ flex: 1 }}>
          <Select options={RULE_METHOD_OPTIONS} />
        </Form.Item>
      </Space>
      <Form.Item label="触发条件" name="triggerCondition" rules={[{ required: true, message: '请输入触发条件' }]}>
        <TextArea rows={2} placeholder="如：预付款比例 > 30%" />
      </Form.Item>
      <Form.Item label="风险说明模板" name="reasonTemplate" rules={[{ required: true, message: '请输入风险说明模板' }]}>
        <TextArea rows={3} placeholder="如：预付款比例过高，存在资金风险" />
      </Form.Item>
      <Form.Item label="修改建议模板" name="suggestionTemplate" rules={[{ required: true, message: '请输入修改建议模板' }]}>
        <TextArea rows={3} placeholder="如：建议将预付款比例降低至 30% 以内，并增加履约保障" />
      </Form.Item>
      <Form.Item label="规则状态" name="status" rules={[{ required: true }]}>
        <Select options={[
          { value: 'enabled', label: '已启用' },
          { value: 'disabled', label: '已停用' },
          { value: 'draft', label: '草稿' },
        ]} />
      </Form.Item>
      <Form.Item label="规则说明" name="description">
        <TextArea rows={2} placeholder="规则用途与适用场景说明" />
      </Form.Item>
    </Form>
  );

  return (
    <div>
      <PageHeader
        title="风险规则库"
        description="维护合同审核规则，规则引擎与 AI 语义审核共同识别风险"
        extra={
          canManage && (
            <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>
              新建规则
            </Button>
          )
        }
      />

      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input
            allowClear
            placeholder="搜索规则ID、编码、名称、触发条件、模板、说明"
            prefix={<Search size={14} color={COLORS.textSecondary} />}
            style={{ width: 320 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            allowClear
            placeholder="风险类型"
            style={{ width: 140 }}
            value={riskTypeFilter || undefined}
            onChange={(v) => setRiskTypeFilter(v ?? '')}
            options={RISK_CATEGORY_OPTIONS}
          />
          <Select
            allowClear
            placeholder="风险等级"
            style={{ width: 120 }}
            value={riskLevelFilter || undefined}
            onChange={(v) => setRiskLevelFilter(v ?? '')}
            options={RISK_LEVEL_OPTIONS}
          />
          <Select
            allowClear
            placeholder="检测方式"
            style={{ width: 130 }}
            value={methodFilter || undefined}
            onChange={(v) => setMethodFilter((v ?? '') as RuleMethod | '')}
            options={RULE_METHOD_OPTIONS}
          />
          <Select
            allowClear
            placeholder="启用状态"
            style={{ width: 120 }}
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v ?? '')}
            options={[
              { value: 'enabled', label: '已启用' },
              { value: 'disabled', label: '已停用' },
              { value: 'draft', label: '草稿' },
            ]}
          />
        </Space>
      </Card>

      <Card styles={{ body: { padding: 0 } }}>
        <ResizableTable<RiskRule>
          rowKey="id"
          columns={columns}
          dataSource={finalRules}
          loading={loading}
          scroll={{ x: 1280 }}
          storageKey="rules"
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showQuickJumper: true,
            pageSizeOptions: ['10', '20', '50'],
            showTotal: (t, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${t} 条规则`,
          }}
          locale={{ emptyText: <EmptyState description="暂无规则，请新建" /> }}
        />
      </Card>

      {/* 新建/编辑弹窗 */}
      <Modal
        title={editModal ? '编辑规则' : '新建规则'}
        open={createModal || !!editModal}
        onCancel={() => { setCreateModal(false); setEditModal(null); form.resetFields(); }}
        onOk={handleSave}
        confirmLoading={submitting}
        okText={editModal ? '保存' : '创建'}
        cancelText="取消"
        width={640}
      >
        {renderForm()}
      </Modal>

      {/* 规则详情抽屉（所有角色可看） */}
      <Drawer
        title={detailDrawer ? `规则详情 · ${detailDrawer.name}` : '规则详情'}
        open={!!detailDrawer}
        onClose={() => setDetailDrawer(null)}
        width={560}
        footer={canManage && detailDrawer ? (
          <div style={{ textAlign: 'right' }}>
            <Button onClick={() => setDetailDrawer(null)} style={{ marginRight: 8 }}>关闭</Button>
            <Button type="primary" icon={<Edit3 size={14} />} onClick={() => { openEdit(detailDrawer); setDetailDrawer(null); }}>
              编辑
            </Button>
          </div>
        ) : null}
      >
        {detailDrawer && (
          <div>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="规则ID">
                <Text strong style={{ color: COLORS.primary }}>{detailDrawer.id}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="规则编码">{detailDrawer.code}</Descriptions.Item>
              <Descriptions.Item label="当前版本">
                <Tag color="blue">v{detailDrawer.version}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={STATUS_MAP[detailDrawer.status].color}>{STATUS_MAP[detailDrawer.status].label}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="合同类型">{detailDrawer.contractType}</Descriptions.Item>
              <Descriptions.Item label="风险类型">{RISK_CATEGORY_MAP[detailDrawer.riskType]?.label ?? detailDrawer.riskType}</Descriptions.Item>
              <Descriptions.Item label="风险等级"><RiskLevelTag level={detailDrawer.riskLevel} /></Descriptions.Item>
              <Descriptions.Item label="检测方式">
                <Tag color={detailDrawer.method === 'ai' ? 'cyan' : detailDrawer.method === 'keyword' ? 'blue' : 'default'}>
                  {RULE_METHOD_MAP[detailDrawer.method].label}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="更新时间">{formatDateTime(detailDrawer.updatedAt)}</Descriptions.Item>
            </Descriptions>

            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Shield size={13} color={COLORS.primary} />
                <Text strong style={{ fontSize: 13 }}>规则配置</Text>
              </div>
              <div style={{ padding: 12, background: '#fafbfc', borderRadius: 6, border: `1px solid ${COLORS.border}` }}>
                <div style={{ marginBottom: 8 }}>
                  <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>触发条件：</Text>
                  <Text style={{ fontSize: 12 }}>{detailDrawer.triggerCondition}</Text>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>风险说明模板：</Text>
                  <div style={{ fontSize: 12, marginTop: 2 }}>{detailDrawer.reasonTemplate}</div>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>修改建议模板：</Text>
                  <div style={{ fontSize: 12, marginTop: 2 }}>{detailDrawer.suggestionTemplate}</div>
                </div>
                {detailDrawer.description && (
                  <div>
                    <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>规则说明：</Text>
                    <div style={{ fontSize: 12, marginTop: 2 }}>{detailDrawer.description}</div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ fontSize: 13 }}>检测方式说明</Text>
              <Paragraph style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 6, marginBottom: 0 }}>
                {METHOD_DESC[detailDrawer.method]}
              </Paragraph>
            </div>

            {!canManage && (
              <div style={{ marginTop: 16, padding: 12, background: '#e6f7ff', borderRadius: 6, border: '1px solid #91d5ff' }}>
                <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>
                  当前为只读视图，如需修改规则请联系法务或管理员。
                </Text>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* 版本抽屉 */}
      <Drawer
        title={versionDrawer ? `规则版本 · ${versionDrawer.name}` : '规则版本'}
        open={!!versionDrawer}
        onClose={() => setVersionDrawer(null)}
        width={560}
      >
        {versionDrawer && (
          <div>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="规则编码">{versionDrawer.code}</Descriptions.Item>
              <Descriptions.Item label="当前版本">
                <Tag color="blue">v{versionDrawer.version}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={STATUS_MAP[versionDrawer.status].color}>{STATUS_MAP[versionDrawer.status].label}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="风险等级"><RiskLevelTag level={versionDrawer.riskLevel} /></Descriptions.Item>
              <Descriptions.Item label="更新时间">{formatDateTime(versionDrawer.updatedAt)}</Descriptions.Item>
            </Descriptions>

            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <History size={14} color={COLORS.primary} />
              <Text strong style={{ fontSize: 13 }}>历史版本（{versions.length}）</Text>
            </div>

            {versionsLoading ? (
              <Skeleton active paragraph={{ rows: 6 }} />
            ) : versions.length === 0 ? (
              <Empty description="暂无历史版本" />
            ) : (
              <Timeline
                items={versions.map((v) => ({
                  color: v.version === versionDrawer.version ? 'green' : 'gray',
                  children: (
                    <div style={{ paddingBottom: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <Space>
                          <Tag color={v.version === versionDrawer.version ? 'success' : 'default'} style={{ margin: 0 }}>
                            v{v.version}
                          </Tag>
                          {v.version === versionDrawer.version && (
                            <Text style={{ fontSize: 11, color: COLORS.low }}>当前</Text>
                          )}
                        </Space>
                        <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>
                          {formatDateTime(v.createdAt)}
                        </Text>
                      </div>
                      <div style={{ padding: '8px 12px', background: '#fafbfc', borderRadius: 4, border: `1px solid ${COLORS.border}` }}>
                        <div style={{ fontSize: 12, marginBottom: 4 }}>
                          <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>变更说明：</Text>
                          <Text style={{ fontSize: 12 }}>{v.changeNote}</Text>
                        </div>
                        <div style={{ fontSize: 11, color: COLORS.textSecondary }}>
                          操作人：{v.operatorName} · {formatDateTime(v.createdAt)}
                        </div>
                        {/* 展示该版本快照的关键配置 */}
                        <div style={{ marginTop: 6, fontSize: 11, color: COLORS.textSecondary, lineHeight: 1.7 }}>
                          <div>触发条件：{v.snapshot.triggerCondition}</div>
                          <div>风险等级：{RISK_LEVEL_MAP[v.snapshot.riskLevel]?.label ?? v.snapshot.riskLevel}</div>
                          <div>风险说明：{v.snapshot.reasonTemplate}</div>
                        </div>
                      </div>
                    </div>
                  ),
                }))}
              />
            )}

            <div style={{ marginTop: 16, padding: 12, background: '#fafbfc', borderRadius: 6 }}>
              <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>
                规则版本说明：启用状态的规则被修改时将自动生成新版本快照，确保历史审核结果可追溯。每个版本记录当时的完整配置（触发条件、风险等级、模板等）。
              </Text>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
