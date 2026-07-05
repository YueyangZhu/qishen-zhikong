/**
 * P10 审核报告详情
 * - 报告标题、合同信息、报告编号
 * - 导出 PDF（浏览器打印）、导出 Word（提示未实现）、打印
 * - 综合风险等级、评分、高中低统计
 * - 合同基本信息、审核结论摘要、重大风险、逐条明细
 * - 人工审核结论、附件留档
 * 浏览器打印布局可用
 */
import { useEffect, useState } from 'react';
import {
  Card, Typography, Space, Button, Tag, Descriptions, Statistic, Row, Col, Empty, Skeleton, App, Divider, Alert, Table, Tooltip,
} from 'antd';
import {
  ArrowLeft, Printer, FileDown, FileText, ShieldCheck, AlertTriangle, Sparkles, CheckCircle2, FileBarChart, Info,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import { reportService } from '@/services/reportService';
import { useAuthStore } from '@/store/useAuthStore';
import { generateReportPDFViaBrowser, downloadBlob } from '@/services/apiClient';
import { COLORS, RISK_LEVEL_MAP, RISK_CATEGORY_MAP, LEGAL_CONCLUSION_MAP, DISCLAIMER, REVIEW_FOCUS_LABEL } from '@/constants';
import { formatMoney, formatDateTime } from '@/utils/format';
import { RiskLevelTag, RiskStatusTag } from '@/components/StatusTag';
import PageHeader from '@/components/PageHeader';
import type { ReviewReport, RiskItem } from '@/types';

const { Title, Text, Paragraph } = Typography;

/**
 * AI 审核结论摘要英文枚举值 → 中文标签 转换
 * 合并风险类型、审核重点、风险等级三类枚举，对摘要文本中出现的英文 key 整词替换为中文。
 * 使用负向断言确保不匹配到包含该子串的更大单词（如 "principle" 中的 "ip"）。
 */
const AI_SUMMARY_ZH_MAP: Record<string, string> = {
  // 风险类型
  ...Object.fromEntries(Object.entries(RISK_CATEGORY_MAP).map(([k, v]) => [k, v.label])),
  // 审核重点（与风险类型有重叠，保密相关以审核重点的"保密与数据安全"为准）
  ...REVIEW_FOCUS_LABEL,
  // 风险等级
  high: '高风险',
  medium: '中风险',
  low: '低风险',
  notice: '提示项',
};

const AI_SUMMARY_KEYS = Object.keys(AI_SUMMARY_ZH_MAP).sort((a, b) => b.length - a.length);
const AI_SUMMARY_REGEX = new RegExp(
  `(?<![a-zA-Z0-9_])(${AI_SUMMARY_KEYS.join('|')})(?![a-zA-Z0-9_])`,
  'g',
);

function translateAiSummary(text: string): string {
  if (!text) return text;
  return text.replace(AI_SUMMARY_REGEX, (m) => AI_SUMMARY_ZH_MAP[m] ?? m);
}

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();

  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useEffect(() => {
    (async () => {
      if (!id) return;
      setLoading(true);
      try {
        let r = await reportService.get(id);
        if (!r) {
          message.error('报告不存在');
          navigate('/reports');
          return;
        }
        // 兜底：旧报告 status=generated 但 snapshot 为 null（种子数据迁移遗留）
        // 调 generate 重新构建 snapshot 并写回数据库
        if (r.status === 'generated' && !r.snapshot && r.reviewTaskId) {
          try {
            const user = useAuthStore.getState().currentUser;
            if (user) {
              r = await reportService.generate(r.reviewTaskId, user);
            }
          } catch {
            // 重新生成失败，保持原状显示失败页
          }
        }
        setReport(r);
      } catch (e) {
        message.error(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handlePrint = () => {
    window.print();
  };

  /** 真实下载 PDF：调后端 Playwright 渲染报告页 → PDF
   *  视觉与网页 100% 一致，文字为真实文本可复制 */
  const handleDownloadPDF = async () => {
    if (!report) return;
    setDownloadingPdf(true);
    message.loading({ content: '正在生成 PDF，请稍候（启动浏览器渲染中）...', key: 'pdfGen', duration: 0 });
    try {
      const blob = await generateReportPDFViaBrowser(report.id);
      downloadBlob(blob, `采购合同审核报告_${report.reportNo}.pdf`);
      message.success({ content: 'PDF 已下载', key: 'pdfGen' });
    } catch (e) {
      message.error({ content: `生成失败：${e instanceof Error ? e.message : '未知错误'}`, key: 'pdfGen' });
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleExportWord = () => {
    modal.info({
      title: '导出 Word',
      content: '当前版本暂未开放 Word 导出能力，后续版本将支持生成 .docx 修订版文件。请使用「导出 PDF」或「打印」功能。',
      okText: '我知道了',
    });
  };

  if (loading) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (!report) return null;

  if (report.status === 'generating') {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: 40 }}>
          <FileBarChart size={48} color={COLORS.primary} style={{ marginBottom: 16 }} />
          <Title level={4}>报告生成中</Title>
          <Paragraph style={{ color: COLORS.textSecondary }}>请稍候，报告正在生成...</Paragraph>
          <Button type="primary" onClick={() => window.location.reload()}>刷新查看</Button>
        </div>
      </Card>
    );
  }

  if (report.status === 'failed' || !report.snapshot) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: 40 }}>
          <AlertTriangle size={48} color={COLORS.high} style={{ marginBottom: 16 }} />
          <Title level={4}>报告生成失败</Title>
          <Paragraph style={{ color: COLORS.textSecondary }}>{report.errorMsg ?? '生成过程中出现错误'}</Paragraph>
          <Button type="primary" onClick={() => navigate('/reports')}>返回报告列表</Button>
        </div>
      </Card>
    );
  }

  const snap = report.snapshot;
  const levelCfg = RISK_LEVEL_MAP[snap.overallRiskLevel];
  const legalCfg = LEGAL_CONCLUSION_MAP[snap.legalConclusion];

  // 重大风险表列
  const majorColumns: ColumnsType<RiskItem> = [
    { title: '序号', key: 'idx', width: 50, render: (_, __, i) => i + 1 },
    { title: '风险标题', dataIndex: 'title', key: 'title' },
    {
      title: '等级',
      dataIndex: 'riskLevel',
      key: 'riskLevel',
      width: 70,
      render: (l) => <RiskLevelTag level={l} />,
    },
    { title: '条款', key: 'clause', width: 120, render: (_, r) => `${r.clauseNumber} ${r.clauseTitle}` },
    { title: '处理状态', dataIndex: 'status', key: 'status', width: 90, render: (s) => <RiskStatusTag status={s} /> },
  ];

  // 逐条风险明细
  const detailColumns: ColumnsType<RiskItem> = [
    { title: '序号', key: 'idx', width: 50, render: (_, __, i) => i + 1 },
    {
      title: '风险',
      key: 'risk',
      width: 200,
      render: (_, r) => (
        <div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
            <RiskLevelTag level={r.riskLevel} />
            <Text strong>{r.title}</Text>
          </div>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{r.clauseNumber} {r.clauseTitle}</Text>
        </div>
      ),
    },
    {
      title: '风险说明',
      dataIndex: 'riskReason',
      key: 'riskReason',
      render: (v: string) => <Text style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v}</Text>,
    },
    {
      title: '修改建议',
      key: 'suggestion',
      render: (_, r) => <Text style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.editedSuggestion ?? r.suggestion}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (s) => <RiskStatusTag status={s} />,
    },
  ];

  return (
    <div className="report-page-root" style={{ maxWidth: 1000, margin: '0 auto' }}>
      {/* 工具栏（不打印）：固定在页面顶部，操作按钮始终可见 */}
      <div
        className="no-print"
        style={{
          position: 'sticky',
          top: 56,
          zIndex: 9,
          marginBottom: 12,
          padding: '10px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#fff',
          borderRadius: 6,
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
        }}
      >
        <Button type="text" size="small" icon={<ArrowLeft size={14} />} onClick={() => navigate(-1)}>返回</Button>
        <Space>
          <Button icon={<Printer size={14} />} onClick={handlePrint}>打印</Button>
          <Button type="primary" icon={<FileDown size={14} />} loading={downloadingPdf} onClick={handleDownloadPDF}>下载 PDF 报告</Button>
          <Button icon={<FileText size={14} />} onClick={handleExportWord}>导出 Word</Button>
        </Space>
      </div>

      {/* 报告正文（可打印 / 后端生成 PDF） */}
      <Card className="print-area" styles={{ body: { padding: 32 } }}>
        {/* 报告头 */}
        <div style={{ textAlign: 'center', marginBottom: 24, paddingBottom: 16, borderBottom: `2px solid ${COLORS.primary}` }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <ShieldCheck size={28} color={COLORS.primary} />
            <Title level={3} style={{ margin: 0, fontWeight: 700 }}>采购合同审核报告</Title>
          </div>
          <Text style={{ color: COLORS.textSecondary, fontSize: 13 }}>
            报告编号：{report.reportNo} · 版本 v{report.versionNo} · 生成时间：{formatDateTime(snap.generatedAt)}
          </Text>
        </div>

        {/* 综合风险概览 */}
        <Card size="small" style={{ marginBottom: 16, background: levelCfg.bg, border: `1px solid ${levelCfg.border}` }}>
          <Row gutter={16} align="middle">
            <Col span={6}>
              <div style={{ textAlign: 'center' }}>
                <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>综合风险等级</Text>
                <div style={{ marginTop: 4 }}>
                  <RiskLevelTag level={snap.overallRiskLevel} showDot />
                </div>
              </div>
            </Col>
            <Col span={6}>
              <Statistic title="风险评分" value={snap.riskScore} suffix="/100" valueStyle={{ color: levelCfg.color, fontSize: 24 }} />
            </Col>
            <Col span={12}>
              <Row gutter={8}>
                <Col span={6}><Statistic title="高风险" value={snap.riskCount.high} valueStyle={{ color: COLORS.high, fontSize: 18 }} /></Col>
                <Col span={6}><Statistic title="中风险" value={snap.riskCount.medium} valueStyle={{ color: COLORS.medium, fontSize: 18 }} /></Col>
                <Col span={6}><Statistic title="低风险" value={snap.riskCount.low} valueStyle={{ color: COLORS.low, fontSize: 18 }} /></Col>
                <Col span={6}><Statistic title="提示项" value={snap.riskCount.notice} valueStyle={{ color: COLORS.notice, fontSize: 18 }} /></Col>
              </Row>
            </Col>
          </Row>
        </Card>

        {/* 合同基本信息 */}
        <Title level={5} style={{ marginTop: 16 }}>一、合同基本信息</Title>
        <Descriptions bordered column={2} size="small">
          <Descriptions.Item label="合同名称">{snap.contractName}</Descriptions.Item>
          <Descriptions.Item label="合同编号">{snap.contractNo}</Descriptions.Item>
          <Descriptions.Item label="相对方">{snap.counterparty}</Descriptions.Item>
          <Descriptions.Item label="合同金额">{formatMoney(snap.amount, snap.currency)}</Descriptions.Item>
          <Descriptions.Item label="合同类型">{snap.contractType}</Descriptions.Item>
          <Descriptions.Item label="审核重点">
            <Space wrap>
              {snap.reviewFocus.map((f) => <Tag key={f}>{REVIEW_FOCUS_LABEL[f] ?? f}</Tag>)}
            </Space>
          </Descriptions.Item>
        </Descriptions>

        {/* 字段信息 */}
        <Title level={5} style={{ marginTop: 16 }}>二、合同要素字段</Title>
        <Descriptions bordered column={2} size="small">
          {snap.fields.map((f) => (
            <Descriptions.Item key={f.id} label={f.fieldLabel}>
              {f.confirmedValue ?? f.fieldValue}
            </Descriptions.Item>
          ))}
        </Descriptions>

        {/* AI 审核结论摘要 */}
        <Title level={5} style={{ marginTop: 16 }}>
          <Space><Sparkles size={16} color={COLORS.ai} />三、AI 审核结论摘要</Space>
        </Title>
        <Card size="small" style={{ background: '#e6fffb', border: `1px solid ${COLORS.ai}33` }}>
          <Paragraph style={{ margin: 0, fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{translateAiSummary(snap.aiSummary)}</Paragraph>
        </Card>

        {/* 重大风险条款 */}
        <Title level={5} style={{ marginTop: 16 }}>
          <Space><AlertTriangle size={16} color={COLORS.high} />四、重大风险条款（{snap.majorRisks.length}）</Space>
        </Title>
        {snap.majorRisks.length === 0 ? (
          <Empty description="无重大风险" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table<RiskItem>
            rowKey="id"
            columns={majorColumns}
            dataSource={snap.majorRisks}
            pagination={false}
            size="small"
            tableLayout="fixed"
          />
        )}

        {/* 逐条风险明细 */}
        <Title level={5} style={{ marginTop: 16 }}>
          <Space><FileText size={16} color={COLORS.primary} />五、逐条风险明细（{snap.risks.length}）</Space>
        </Title>
        <Table<RiskItem>
          rowKey="id"
          columns={detailColumns}
          dataSource={snap.risks}
          pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
          size="small"
          tableLayout="fixed"
        />

        {/* 人工审核结论 */}
        <Title level={5} style={{ marginTop: 16 }}>
          <Space><CheckCircle2 size={16} color={COLORS.low} />六、人工审核结论</Space>
        </Title>
        <Card size="small" style={{ background: LEGAL_CONCLUSION_MAP[snap.legalConclusion] ? '#f6ffed' : '#fafbfc' }}>
          <div style={{ marginBottom: 8 }}>
            <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>最终结论</Text>
            <div>
              <Tag color={legalCfg.color} style={{ fontSize: 13, padding: '2px 12px' }}>{legalCfg.label}</Tag>
              <Text style={{ marginLeft: 8, color: COLORS.textSecondary, fontSize: 12 }}>{legalCfg.desc}</Text>
            </div>
          </div>
          <Divider style={{ margin: '8px 0' }} />
          <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>法务意见</Text>
          <Paragraph style={{ fontSize: 13, lineHeight: 1.7, marginTop: 4 }}>{snap.legalOpinion}</Paragraph>
        </Card>

        {/* 免责声明 */}
        <Alert
          type="warning"
          showIcon
          icon={<Info size={16} />}
          message="免责声明"
          description={snap.disclaimer}
          style={{ marginTop: 16 }}
        />

        {/* 附件与留档 */}
        <Title level={5} style={{ marginTop: 16 }}>七、附件与留档</Title>
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="审核报告编号">{report.reportNo}</Descriptions.Item>
          <Descriptions.Item label="报告版本">v{report.versionNo}</Descriptions.Item>
          <Descriptions.Item label="生成时间">{formatDateTime(snap.generatedAt)}</Descriptions.Item>
          <Descriptions.Item label="风险项总数">{snap.risks.length} 项</Descriptions.Item>
          <Descriptions.Item label="重大风险数">{snap.majorRisks.length} 项</Descriptions.Item>
        </Descriptions>

        <div style={{ marginTop: 24, textAlign: 'center', color: COLORS.textSecondary, fontSize: 12 }}>
          <Divider />
          本报告由「契审智控 · AI采购合同审核平台」自动生成 · {formatDateTime(snap.generatedAt)}
        </div>
      </Card>

      <style>{`
        @media print {
          /* 隐藏工具栏、侧边栏、顶栏 */
          .no-print { display: none !important; }
          /* 重置布局：让报告正文占满页面 */
          .report-page-root { max-width: 100% !important; margin: 0 !important; }
          .main-layout-body { margin: 0 !important; padding: 0 !important; }
          .ant-layout-content { padding: 0 !important; margin: 0 !important; }
          .ant-layout { min-height: auto !important; }
          /* 报告正文区：移除阴影，保留预览的边距与背景色 */
          .print-area {
            box-shadow: none !important;
            margin: 0 !important;
            max-width: 100% !important;
          }
          .print-area > .ant-card-body { padding: 32px !important; }
          /* 强制打印背景色与图片（保留预览的卡片底色、彩色边框、Tag 颜色） */
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          /* 表格不省略，允许换行 */
          .ant-table-cell { white-space: normal !important; word-break: break-word !important; max-width: none !important; }
          .ant-table-cell-content, .ant-typography { white-space: normal !important; }
          /* 打印时表格自适应页面宽度，移除横向滚动约束，避免内容被截断 */
          .ant-table-wrapper { overflow: visible !important; }
          .ant-table-content { overflow: visible !important; overflow-x: visible !important; }
          .ant-table { width: 100% !important; table-layout: auto !important; overflow: visible !important; }
          .ant-table-content > table { width: 100% !important; min-width: 0 !important; }
          /* 移除 ellipsis 截断（打印时显示完整内容） */
          .ant-table-cell { overflow: visible !important; text-overflow: clip !important; }
          .ant-typography { overflow: visible !important; }
          /* 背景纯白 */
          body { background: #fff !important; }
          /* 避免卡片内部分页 */
          .ant-pagination { display: none !important; }
          /* 标题紧跟内容：标题后避免分页，但允许表格内部跨页（避免标题与表格作为整体被推到下页造成大留白） */
          h1, h2, h3, h4, h5, .ant-typography-title { break-after: avoid !important; break-inside: avoid !important; }
          .ant-alert { break-inside: avoid; }
          /* 表格允许跨页，避免标题+表格作为整体被推到下页造成大留白 */
          .ant-table { break-inside: auto !important; }
          .ant-table-thead { break-inside: avoid !important; display: table-header-group !important; }
          .ant-table-row { break-inside: avoid !important; }
          .ant-card { break-inside: auto !important; }
      `}</style>
    </div>
  );
}
