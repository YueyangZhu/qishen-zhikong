/**
 * P04 新建审核任务（步骤式）
 * 第一步：上传合同（拖拽 + 演示合同快捷选择）
 * 第二步：填写审核信息
 * 第三步：确认并发起审核（保存草稿 / 开始 AI 审核）
 */
import { useState, useEffect } from 'react';
import {
  Card, Steps, Button, Typography, Space, Form, Input, InputNumber, Select, Radio, Checkbox, Upload, App, Tag, Descriptions, Alert, Skeleton, Modal,
} from 'antd';
import { UploadCloud, FileText, ArrowLeft, ArrowRight, Save, Sparkles, X, CheckCircle2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { UploadProps } from 'antd';
import { useAuthStore } from '@/store/useAuthStore';
import { reviewService, type CreateTaskInput } from '@/services/reviewService';
import { checkBackendHealth } from '@/services/apiClient';
import { API_BASE } from '@/utils/apiBase';
import { SAMPLE_CONTRACTS, type SampleContract } from '@/mock/sampleContracts';
import { COLORS, REVIEW_FOCUS_OPTIONS, FILE_LIMITS, DISCLAIMER } from '@/constants';
import { formatFileSize } from '@/utils/format';
import PageHeader from '@/components/PageHeader';

const { TextArea } = Input;
const { Text, Paragraph } = Typography;

interface UploadedFile {
  name: string;
  size: number;
  type: string;
  uid: string;
  /** 真实上传文件时保存的 File 对象（用于调用后端 AI 解析；样例合同为 undefined） */
  rawFile?: File;
}

const DEPARTMENTS = ['采购部', '信息技术部', '法务部', '财务部', '运营部', '行政部'];

export default function ReviewNewPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const draftId = searchParams.get('draft'); // 编辑已有草稿
  const { currentUser } = useAuthStore();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();

  const [current, setCurrent] = useState(0);
  const [file, setFile] = useState<UploadedFile | null>(null);
  /** 当前选中的样例合同 ID；为 null 表示用户手动上传（使用默认演示合同数据） */
  const [sampleId, setSampleId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** 保存草稿独立 loading，避免与"开始AI审核"的 submitting 互相影响 */
  const [savingDraft, setSavingDraft] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false);
  // 真实 AI 审核的进度弹窗已移除：上传文件现在也走进度页面，与样例合同体验一致

  // 加载已有草稿回填表单
  useEffect(() => {
    if (!draftId) return;
    setLoadingDraft(true);
    reviewService.getTask(draftId).then(async (task) => {
      if (!task) {
        message.error('草稿任务不存在');
        navigate('/reviews');
        return;
      }
      if (task.status !== 'draft') {
        message.warning('该任务不是草稿状态，无法编辑');
        navigate(`/reviews/${task.id}`);
        return;
      }
      // 回填表单
      const next: Partial<CreateTaskInput> = {
        contractName: task.contractName,
        contractType: task.contractType,
        myRole: task.myRole,
        counterparty: task.counterparty,
        department: task.department,
        amount: task.amount,
        reviewFocus: task.reviewFocus,
        reviewNote: task.reviewNote,
      };
      setFormValues((v) => ({ ...v, ...next }));
      form.setFieldsValue(next);
      // 回填文件：先显示文件名，再尝试从 IndexedDB 恢复原始 File 对象
      if (task.fileName) {
        setFile({
          name: task.fileName,
          size: task.fileSize,
          type: '',
          uid: draftId,
        });
        // 非样例合同任务：从 IndexedDB 恢复原始 File，避免重新上传
        if (!task.sampleId) {
          const { useRealAIStore } = await import('@/store/useRealAIStore');
          const restoredFile = await useRealAIStore.getState().restore(draftId);
          if (restoredFile) {
            setFile({
              name: restoredFile.name,
              size: restoredFile.size,
              type: restoredFile.type,
              uid: draftId,
              rawFile: restoredFile,
            });
          }
        }
      }
      if (task.sampleId) setSampleId(task.sampleId);
      // 草稿已有文件信息，直接进入第二步「填写信息」
      setCurrent(1);
    }).finally(() => setLoadingDraft(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  // 第一步：上传文件
  const uploadProps: UploadProps = {
    accept: FILE_LIMITS.accept,
    multiple: false,
    maxCount: 1,
    beforeUpload: (f) => {
      // 校验格式
      const ext = f.name.split('.').pop()?.toLowerCase();
      if (ext !== 'pdf' && ext !== 'docx') {
        message.error(`不支持的文件格式：.${ext}，仅支持 ${FILE_LIMITS.acceptLabel}`);
        return Upload.LIST_IGNORE;
      }
      // 校验大小
      if (f.size > FILE_LIMITS.maxSize) {
        message.error(`文件过大（${formatFileSize(f.size)}），最大支持 ${formatFileSize(FILE_LIMITS.maxSize)}`);
        return Upload.LIST_IGNORE;
      }
      // 手动上传时清空样例 ID（使用默认演示合同解析数据）
      setSampleId(null);
      setFile({ name: f.name, size: f.size, type: f.type, uid: f.uid, rawFile: f });
      message.success(`文件已添加：${f.name}`);
      return false; // 阻止真实上传
    },
    fileList: [],
    showUploadList: false,
  };

  /** 选择一份预置样例合同：自动填充文件与表单信息 */
  const chooseSample = (sample: SampleContract) => {
    setSampleId(sample.id);
    setFile({
      name: sample.fileName,
      size: sample.fileSize,
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      uid: sample.id,
    });
    const next: Partial<CreateTaskInput> = {
      contractName: sample.contractName,
      contractType: sample.contractType,
      myRole: sample.myRole,
      counterparty: sample.counterparty,
      department: sample.department,
      amount: sample.amount,
      reviewFocus: sample.reviewFocus,
      reviewNote: sample.reviewNote,
    };
    setFormValues((v) => ({ ...v, ...next }));
    form.setFieldsValue(next);
    message.success(`已选择样例：${sample.contractName}（预填信息已自动带入）`);
  };

  const removeFile = () => {
    setFile(null);
    setSampleId(null);
  };

  // 第二步表单值
  const [formValues, setFormValues] = useState<Partial<CreateTaskInput>>({
    contractName: '',
    contractType: '软件采购',
    myRole: 'buyer',
    counterparty: '',
    department: currentUser?.department ?? '采购部',
    amount: 0,
    reviewFocus: ['subject', 'payment', 'breach'],
    reviewNote: '',
  });

  const handleNextFromUpload = () => {
    if (!file) {
      message.warning('请先上传合同文件或选择演示合同');
      return;
    }
    // 自动填充合同名称（如果为空）
    if (!formValues.contractName) {
      const baseName = file.name.replace(/\.[^.]+$/, '');
      setFormValues((v) => ({ ...v, contractName: baseName }));
      form.setFieldValue('contractName', baseName);
    }
    setCurrent(1);
  };

  const handleNextFromForm = async () => {
    try {
      const values = await form.validateFields();
      setFormValues(values);
      setCurrent(2);
    } catch {
      message.warning('请完善必填信息后再继续');
    }
  };

  // 第三步：保存草稿 / 开始审核
  const buildInput = (): CreateTaskInput => ({
    contractName: formValues.contractName ?? '',
    contractType: formValues.contractType ?? '软件采购',
    myRole: formValues.myRole ?? 'buyer',
    counterparty: formValues.counterparty ?? '',
    department: formValues.department ?? '',
    amount: formValues.amount ?? 0,
    reviewFocus: formValues.reviewFocus ?? [],
    reviewNote: formValues.reviewNote ?? '',
    fileName: file?.name ?? '',
    fileSize: file?.size ?? 0,
    sampleId: sampleId ?? undefined,
  });

  const handleSaveDraft = async () => {
    if (!currentUser) return;
    if (!file) {
      message.warning('请先上传合同文件');
      return;
    }
    setSavingDraft(true);
    try {
      if (draftId) {
        await reviewService.updateTask(draftId, buildInput(), currentUser);
        message.success('草稿已更新');
      } else {
        await reviewService.createTask(buildInput(), currentUser);
        message.success('草稿已保存');
      }
      navigate('/reviews');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSavingDraft(false);
    }
  };

  const handleStartReview = async () => {
    if (!currentUser) return;
    // 判断走真实 AI 还是 Mock 流程
    // 真实 AI：用户手动上传文件（非样例合同）+ 拥有原始 File 对象
    // 草稿编辑时 File 从 IndexedDB 恢复，无需重新上传
    const useRealAI = !sampleId && !!file?.rawFile;

    setSubmitting(true);
    try {
      // 真实 AI 场景：先检查后端是否可用，避免后续解析失败给出晦涩错误
      if (useRealAI) {
        const health = await checkBackendHealth();
        if (!health) {
          modal.error({
            title: '后端服务暂时不可用',
            content: `上传合同审核需要后端服务支持。当前前端推导的后端地址为：${API_BASE || '（空，走相对路径）'}。请打开浏览器 F12 控制台查看详细错误。公网部署可能正在冷启动（30秒左右），请稍候重试；若地址不对请检查 Render 前端服务的 VITE_API_BASE 环境变量。`,
            okText: '我知道了',
          });
          return;
        }
      }
      // 统一流程：创建/更新草稿任务 → 启动审核 → 跳进度页
      // 真实 AI 与样例合同都走进度页面，由进度页根据 realAI 标记决定执行方式
      let taskId: string;
      if (draftId) {
        await reviewService.updateTask(draftId, buildInput(), currentUser);
        taskId = draftId;
      } else {
        const task = await reviewService.createTask(buildInput(), currentUser);
        taskId = task.id;
      }
      if (useRealAI) {
        // 真实 AI：startRealAIReview 标记 realAI=true + 存 File 到内存 store
        await reviewService.startRealAIReview(taskId, currentUser, file!.rawFile!, {
          contractType: formValues.contractType,
          myRole: formValues.myRole,
          reviewFocus: formValues.reviewFocus,
          reviewNote: formValues.reviewNote,
        });
      } else {
        // 样例合同：标准 startReview 走时间模拟进度
        await reviewService.startReview(taskId, currentUser);
      }
      message.success('已发起 AI 审核，正在解析合同...');
      // 直接跳转进度页，不再显示"任务已创建"中间页
      navigate(`/reviews/${taskId}/progress`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '发起审核失败');
    } finally {
      setSubmitting(false);
    }
  };

  const steps = [
    { title: '上传合同', desc: 'PDF / DOCX' },
    { title: '填写信息', desc: '合同要素' },
    { title: '确认发起', desc: '开始 AI 审核' },
  ];

  if (loadingDraft) {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <PageHeader title="编辑草稿任务" description="修改草稿任务信息后保存或发起 AI 审核" />
        <Card><Skeleton active paragraph={{ rows: 8 }} /></Card>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <PageHeader
        title={draftId ? '编辑草稿任务' : '新建审核任务'}
        description={draftId ? '修改草稿任务信息后保存或发起 AI 审核' : '上传采购合同，填写审核要素，发起 AI 智能审核'}
      />

      <Card>
        <Steps current={current} items={steps} style={{ marginBottom: 32 }} />

        {/* 第一步：上传 */}
        {current === 0 && (
          <div>
            {file ? (
              <div
                style={{
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 8,
                  padding: 20,
                  background: '#fafbfc',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 8, background: '#e6f4ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <FileText size={22} color={COLORS.primary} />
                  </div>
                  <div>
                    <Text strong style={{ fontSize: 14 }}>
                      {file.name}
                    </Text>
                    <div>
                      <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>{file.name.split('.').pop()?.toUpperCase()}</Tag>
                      <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginLeft: 8 }}>{formatFileSize(file.size)}</Text>
                    </div>
                  </div>
                </div>
                <Space>
                  <Upload {...uploadProps}>
                    <Button icon={<UploadCloud size={14} />}>替换文件</Button>
                  </Upload>
                  <Button danger icon={<X size={14} />} onClick={removeFile}>
                    移除
                  </Button>
                </Space>
              </div>
            ) : (
              <Upload.Dragger {...uploadProps} style={{ padding: 24 }}>
                <div style={{ padding: '20px 0' }}>
                  <UploadCloud size={48} color={COLORS.primary} style={{ marginBottom: 12 }} />
                  <Paragraph style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                    点击或拖拽文件到此处上传
                  </Paragraph>
                  <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>
                    支持 {FILE_LIMITS.acceptLabel} 文件，单文件不超过 {formatFileSize(FILE_LIMITS.maxSize)}
                  </Text>
                </div>
              </Upload.Dragger>
            )}

            <div style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <Sparkles size={16} color={COLORS.ai} />
                <Text strong style={{ fontSize: 14 }}>或从预置样例合同中选择</Text>
                <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>
                  （推荐用于测试：每份含独立的合同正文、抽取字段与预埋风险，选中后表单自动带入）
                </Text>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                {SAMPLE_CONTRACTS.map((s) => {
                  const selected = sampleId === s.id;
                  return (
                    <div
                      key={s.id}
                      onClick={() => chooseSample(s)}
                      style={{
                        border: `1px solid ${selected ? COLORS.primary : COLORS.border}`,
                        borderRadius: 8,
                        padding: 12,
                        cursor: 'pointer',
                        background: selected ? '#e6f4ff' : '#fafbfc',
                        transition: 'all 0.2s',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <FileText size={16} color={COLORS.primary} style={{ flexShrink: 0 }} />
                          <Text strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.contractName}
                          </Text>
                        </div>
                        {selected && <CheckCircle2 size={16} color={COLORS.primary} style={{ flexShrink: 0 }} />}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                        <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>{s.contractType}</Tag>
                        <Tag style={{ margin: 0, fontSize: 11, color: COLORS.high, borderColor: COLORS.high }}>
                          风险 {s.risks.length} 项
                        </Tag>
                      </div>
                      <div style={{ fontSize: 12, color: COLORS.textSecondary }}>
                        相对方：{s.counterparty}
                      </div>
                      <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}>
                        金额：¥{s.amount.toLocaleString('zh-CN')}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between' }}>
              <Button icon={<ArrowLeft size={14} />} onClick={() => navigate('/reviews')}>
                返回
              </Button>
              <Button type="primary" icon={<ArrowRight size={14} />} onClick={handleNextFromUpload} disabled={!file}>
                下一步
              </Button>
            </div>
          </div>
        )}

        {/* 第二步：填写信息 */}
        {current === 1 && (
          <Form
            form={form}
            layout="vertical"
            initialValues={formValues}
            requiredMark="optional"
            style={{ maxWidth: 720 }}
          >
            <Form.Item label="合同名称" name="contractName" rules={[{ required: true, message: '请输入合同名称' }]}>
              <Input placeholder="如：XX 软件系统采购合同" maxLength={80} showCount />
            </Form.Item>

            <Form.Item label="合同类型" name="contractType" rules={[{ required: true, message: '请选择合同类型' }]}>
              <Select
                options={[
                  { value: '软件采购', label: '软件采购' },
                  { value: '硬件采购', label: '硬件采购' },
                  { value: '服务采购', label: '服务采购' },
                  { value: '系统集成', label: '系统集成' },
                  { value: '设备租赁', label: '设备租赁' },
                ]}
              />
            </Form.Item>

            <Form.Item label="我方身份" name="myRole" rules={[{ required: true, message: '请选择我方身份' }]}>
              <Radio.Group>
                <Radio value="buyer">采购方（甲方）</Radio>
                <Radio value="seller">供应方（乙方）</Radio>
              </Radio.Group>
            </Form.Item>

            <Form.Item label="相对方" name="counterparty" rules={[{ required: true, message: '请输入相对方名称' }]}>
              <Input placeholder="如：XX 科技有限公司" maxLength={60} />
            </Form.Item>

            <Space size={16} style={{ display: 'flex' }}>
              <Form.Item label="所属部门" name="department" rules={[{ required: true, message: '请选择所属部门' }]} style={{ flex: 1 }}>
                <Select options={DEPARTMENTS.map((d) => ({ value: d, label: d }))} />
              </Form.Item>
              <Form.Item
                label="合同金额（元）"
                name="amount"
                rules={[
                  { required: true, message: '请输入合同金额' },
                  { type: 'number', min: 0, message: '金额不能为负' },
                ]}
                style={{ flex: 1 }}
              >
                <InputNumber style={{ width: '100%' }} min={0} step={1000} placeholder="如：580000" />
              </Form.Item>
            </Space>

            <Form.Item label="审核重点（可多选）" name="reviewFocus" rules={[{ required: true, message: '请至少选择一项审核重点' }]}>
              <Checkbox.Group style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {REVIEW_FOCUS_OPTIONS.map((opt) => (
                  <Checkbox key={opt.value} value={opt.value}>
                    <Space size={4}>
                      <Text strong style={{ fontSize: 13 }}>{opt.label}</Text>
                      <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>{opt.desc}</Text>
                    </Space>
                  </Checkbox>
                ))}
              </Checkbox.Group>
            </Form.Item>

            <Form.Item label="补充说明" name="reviewNote">
              <TextArea rows={3} placeholder="如有特殊审核要求或背景信息，请在此说明（选填）" maxLength={300} showCount />
            </Form.Item>

            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between' }}>
              <Button icon={<ArrowLeft size={14} />} onClick={() => setCurrent(0)}>
                上一步
              </Button>
              <Button type="primary" icon={<ArrowRight size={14} />} onClick={handleNextFromForm}>
                下一步
              </Button>
            </div>
          </Form>
        )}

        {/* 第三步：确认 */}
        {current === 2 && (
          <div>
            <Descriptions title="文件信息" bordered column={1} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="文件名">{file?.name}</Descriptions.Item>
              <Descriptions.Item label="文件大小">{file ? formatFileSize(file.size) : '—'}</Descriptions.Item>
              <Descriptions.Item label="文件格式">{file?.name.split('.').pop()?.toUpperCase()}</Descriptions.Item>
            </Descriptions>

            <Descriptions title="审核信息" bordered column={2} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="合同名称">{formValues.contractName}</Descriptions.Item>
              <Descriptions.Item label="合同类型">{formValues.contractType}</Descriptions.Item>
              <Descriptions.Item label="我方身份">{formValues.myRole === 'buyer' ? '采购方（甲方）' : '供应方（乙方）'}</Descriptions.Item>
              <Descriptions.Item label="相对方">{formValues.counterparty}</Descriptions.Item>
              <Descriptions.Item label="所属部门">{formValues.department}</Descriptions.Item>
              <Descriptions.Item label="合同金额">
                {formValues.amount ? Number(formValues.amount).toLocaleString('zh-CN') + ' 元' : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="审核重点" span={2}>
                <Space wrap>
                  {formValues.reviewFocus?.map((v) => (
                    <Tag color="blue" key={v}>
                      {REVIEW_FOCUS_OPTIONS.find((o) => o.value === v)?.label ?? v}
                    </Tag>
                  ))}
                </Space>
              </Descriptions.Item>
              {formValues.reviewNote && (
                <Descriptions.Item label="补充说明" span={2}>{formValues.reviewNote}</Descriptions.Item>
              )}
            </Descriptions>

            <Alert
              type="info"
              showIcon
              icon={<Sparkles size={16} color={COLORS.ai} />}
              message={sampleId ? '样例合同：将使用模拟审核流程快速演示' : '上传合同：将调用 AI 进行解析与审核'}
              description={sampleId
                ? '样例合同走模拟流程，可快速体验完整审核闭环。'
                : 'AI 将自动解析合同文本、抽取字段、识别风险，审核进度可在进度页实时查看。'}
              style={{ marginBottom: 16 }}
            />

            <Alert
              type="warning"
              showIcon
              message="AI 审核免责声明"
              description={DISCLAIMER}
              style={{ marginBottom: 24 }}
            />

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Button icon={<ArrowLeft size={14} />} onClick={() => setCurrent(1)}>
                返回修改
              </Button>
              <Space>
                <Button icon={<Save size={14} />} onClick={handleSaveDraft} loading={savingDraft}>
                  保存草稿
                </Button>
                <Button type="primary" icon={<Sparkles size={14} />} onClick={handleStartReview} loading={submitting}>
                  {sampleId ? '开始 AI 审核（Mock）' : '开始 AI 审核'}
                </Button>
              </Space>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
