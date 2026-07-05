/**
 * 演示采购合同正文（真实结构）
 * 软件系统采购合同，预埋 18 个可解释风险点（含用户要求的 15 个 + 3 个补充）。
 * 段落 id 用于风险原文双向定位；风险 originalText 必须是段落 text 的连续子串。
 */
import type { ParsedDocument, ContractParagraph, ContractSection } from '@/types';

export const DEMO_CONTRACT_TITLE = '软件系统采购合同';

/** 合同段落（text 为最终定稿，风险原文必须是其连续子串） */
export const DEMO_PARAGRAPHS: ContractParagraph[] = [
  {
    id: 'p1',
    index: 1,
    text: '软件系统采购合同',
    type: 'title',
  },
  {
    id: 'p2',
    index: 2,
    clauseNo: '第一条',
    clauseTitle: '合同主体',
    text: '第一条 合同主体\n甲方（采购方）：智远科技有限公司\n统一社会信用代码：91110108MA01ABC23X\n法定代表人：陈志远\n联系地址：北京市海淀区中关村大街1号\n乙方（供应方）：星河软件有限公司\n统一社会信用代码：未提供\n法定代表人：刘星河\n联系地址：未提供\n鉴于甲方拟采购、乙方拟提供“智远协同办公平台”软件系统，双方经友好协商，根据《中华人民共和国民法典》及相关法律法规，就本次采购事宜达成如下协议，以资共同遵守。',
    type: 'body',
  },
  {
    id: 'p3',
    index: 3,
    clauseNo: '第二条',
    clauseTitle: '采购标的',
    text: '第二条 采购标的\n乙方为甲方提供“智远协同办公平台”软件系统一套，含系统授权许可、安装部署、基础培训及一年期技术支持服务。系统功能、模块清单、技术规格与性能指标以双方确认的附件《技术规格书》为准，附件与本合同具有同等法律效力。乙方应保证所提供的系统为最新稳定版本，且不含任何恶意代码或后门程序。',
    type: 'body',
  },
  {
    id: 'p4',
    index: 4,
    clauseNo: '第三条',
    clauseTitle: '合同金额',
    text: '第三条 合同金额\n合同总金额为人民币580000元（大写：伍拾捌万捌仟元整）。上述金额已含增值税，不以其他费用另行收取。本合同金额已包含系统授权、安装部署、培训、一年期技术支持及保修期内所有服务的全部费用，乙方不得以任何理由向甲方追加费用。',
    type: 'body',
  },
  {
    id: 'p5',
    index: 5,
    clauseNo: '第四条',
    clauseTitle: '付款方式',
    text: '第四条 付款方式\n1.合同签订后7个工作日内，甲方应向乙方支付合同总额的80%作为预付款；\n2.系统验收合格后10个工作日内，甲方支付剩余20%尾款。付款前乙方应向甲方开具等额合规的增值税专用发票，发票未到账的甲方有权顺延付款且不承担违约责任。',
    type: 'body',
  },
  {
    id: 'p6',
    index: 6,
    clauseNo: '第五条',
    clauseTitle: '交付安排',
    text: '第五条 交付安排\n乙方应在合同签订后尽快完成系统的交付与安装部署，并配合甲方完成上线准备。交付内容包括系统软件包、安装文档、操作手册、测试报告及相关源代码（如约定）。乙方应在甲方环境完成系统部署、初始化配置与试运行，确保系统可正常使用。',
    type: 'body',
  },
  {
    id: 'p7',
    index: 7,
    clauseNo: '第六条',
    clauseTitle: '验收标准',
    text: '第六条 验收标准\n系统交付后应符合甲方要求，经甲方确认后签署验收报告，即视为验收合格。验收具体包括功能完整性测试、性能压力测试、安全漏洞扫描与用户验收测试，任一项不通过的乙方应在10个工作日内整改并申请复验。',
    type: 'body',
  },
  {
    id: 'p8',
    index: 8,
    clauseNo: '第七条',
    clauseTitle: '知识产权',
    text: '第七条 知识产权\n乙方为甲方定制开发的系统成果及相关知识产权，全部归乙方所有，甲方仅享有非独占的使用权。乙方保证所交付系统不侵犯任何第三方知识产权，否则由乙方承担全部责任并赔偿甲方因此遭受的全部损失。',
    type: 'body',
  },
  {
    id: 'p9',
    index: 9,
    clauseNo: '第八条',
    clauseTitle: '质保服务',
    text: '第八条 质保服务\n乙方对所提供的系统提供质保服务，具体质保期限及响应时限由双方另行约定。质保期内乙方应免费提供版本升级、补丁更新、远程支持与现场服务，确保系统稳定运行。',
    type: 'body',
  },
  {
    id: 'p10',
    index: 10,
    clauseNo: '第九条',
    clauseTitle: '保密条款',
    text: '第九条 保密条款\n双方应对因履行本合同而知悉的对方商业信息承担保密义务，未经对方书面同意不得向第三方披露。保密信息包括但不限于商业计划、客户资料、技术资料、财务数据及合同条款本身。',
    type: 'body',
  },
  {
    id: 'p11',
    index: 11,
    clauseNo: '第十条',
    clauseTitle: '数据安全',
    text: '第十条 数据安全\n双方应采取必要措施保障数据安全，因数据泄露造成的损失由双方共同承担。乙方应对甲方业务数据采取加密存储、访问控制与日志审计等措施，发生数据安全事件应在24小时内通知甲方。',
    type: 'body',
  },
  {
    id: 'p12',
    index: 12,
    clauseNo: '第十一条',
    clauseTitle: '合同期限',
    text: '第十一条 合同期限\n本合同自双方签字盖章之日起生效，有效期为2年。期满后若需继续合作，自动续期。续期期间双方权利义务按本合同约定执行，价格另行协商。',
    type: 'body',
  },
  {
    id: 'p13',
    index: 13,
    clauseNo: '第十二条',
    clauseTitle: '违约责任',
    text: '第十二条 违约责任\n1.甲方逾期付款的，每日按应付未付金额的千分之五支付违约金；\n2.乙方延期交付的，每日按合同总额的千分之一支付违约金，累计不超过合同总额的1%。任一方根本违约导致合同无法履行的，守约方有权解除合同并要求违约方赔偿全部实际损失。',
    type: 'body',
  },
  {
    id: 'p14',
    index: 14,
    clauseNo: '第十三条',
    clauseTitle: '合同解除',
    text: '第十三条 合同解除\n甲方逾期付款超过15日的，乙方有权单方解除本合同，并要求甲方承担相应违约责任。合同解除后乙方应在10日内退还甲方已付但未对应服务部分的款项，并配合甲方完成数据迁移与系统交接。',
    type: 'body',
  },
  {
    id: 'p15',
    index: 15,
    clauseNo: '第十四条',
    clauseTitle: '争议解决',
    text: '第十四条 争议解决\n因本合同产生的或与本合同有关的争议，由乙方所在地有管辖权的人民法院管辖。争议解决期间，双方应继续履行不涉及争议部分的合同义务。',
    type: 'body',
  },
  {
    id: 'p16',
    index: 16,
    clauseNo: '第十五条',
    clauseTitle: '附则',
    text: '第十五条 附则\n本合同一式两份，双方各执一份，自双方签字盖章之日起生效。未尽事宜由双方另行约定，补充协议与本合同具有同等法律效力。本合同附件为本合同不可分割的组成部分。',
    type: 'body',
  },
  {
    id: 'p17',
    index: 17,
    clauseNo: '第十六条',
    clauseTitle: '合同变更',
    text: '第十六条 合同变更\n本合同生效后，任何一方不得擅自变更或解除。如需变更，双方应协商一致并签订书面补充协议，由双方授权代表签字盖章后生效。补充协议与本合同具有同等法律效力，冲突之处以补充协议为准。变更内容涉及金额、交付期、付款方式等重大事项的，应经甲方内部审批程序通过后方可签署。',
    type: 'body',
  },
  {
    id: 'p18',
    index: 18,
    clauseNo: '第十七条',
    clauseTitle: '通知送达',
    text: '第十七条 通知送达\n双方因履行本合同而相互发出的通知、文件或资料，应以书面形式通过专人递送、挂号信、快递或电子邮件方式送达至本合同首部所列地址或邮箱。专人递送的以对方签收之日为送达日，邮寄的以挂号信或快递寄出后第3个工作日为送达日，电子邮件以发送成功之日为送达日。任何一方变更联系方式的，应提前3个工作日书面通知对方，否则按原联系方式送达视为有效。',
    type: 'body',
  },
  {
    id: 'p19',
    index: 19,
    clauseNo: '第十八条',
    clauseTitle: '附件清单',
    text: '第十八条 附件清单\n本合同包含以下附件：附件一《技术规格书》明确系统功能模块与性能指标；附件二《项目实施计划》明确各阶段交付时间与里程碑；附件三《培训方案》明确培训内容、人数与课时；附件四《售后服务方案》明确质保期服务响应流程；附件五《保密协议》细化双方保密义务。所有附件均与本合同同时生效，具有同等法律效力。',
    type: 'body',
  },
  {
    id: 'p20',
    index: 20,
    clauseNo: '第十九条',
    clauseTitle: '适用法律',
    text: '第十九条 适用法律\n本合同的订立、效力、解释、履行、变更、终止及争议解决均适用中华人民共和国法律（不含香港特别行政区、澳门特别行政区及台湾地区法律）。本合同任何条款被认定为无效或不可执行的，不影响其他条款的效力，双方应协商以最接近原条款本意的有效条款替代。',
    type: 'body',
  },
];

/** 合同章节目录（含标题、正文条款、签署落款三类章节） */
export const DEMO_SECTIONS: ContractSection[] = [
  { id: 's0', title: '软件系统采购合同', clauseNo: '', paragraphIds: ['p1'] },
  { id: 's1', title: '合同主体', clauseNo: '第一条', paragraphIds: ['p2'] },
  { id: 's2', title: '采购标的', clauseNo: '第二条', paragraphIds: ['p3'] },
  { id: 's3', title: '合同金额', clauseNo: '第三条', paragraphIds: ['p4'] },
  { id: 's4', title: '付款方式', clauseNo: '第四条', paragraphIds: ['p5'] },
  { id: 's5', title: '交付安排', clauseNo: '第五条', paragraphIds: ['p6'] },
  { id: 's6', title: '验收标准', clauseNo: '第六条', paragraphIds: ['p7'] },
  { id: 's7', title: '知识产权', clauseNo: '第七条', paragraphIds: ['p8'] },
  { id: 's8', title: '质保服务', clauseNo: '第八条', paragraphIds: ['p9'] },
  { id: 's9', title: '保密条款', clauseNo: '第九条', paragraphIds: ['p10'] },
  { id: 's10', title: '数据安全', clauseNo: '第十条', paragraphIds: ['p11'] },
  { id: 's11', title: '合同期限', clauseNo: '第十一条', paragraphIds: ['p12'] },
  { id: 's12', title: '违约责任', clauseNo: '第十二条', paragraphIds: ['p13'] },
  { id: 's13', title: '合同解除', clauseNo: '第十三条', paragraphIds: ['p14'] },
  { id: 's14', title: '争议解决', clauseNo: '第十四条', paragraphIds: ['p15', 'p16'] },
  { id: 's15', title: '合同变更', clauseNo: '第十六条', paragraphIds: ['p17'] },
  { id: 's16', title: '通知送达', clauseNo: '第十七条', paragraphIds: ['p18'] },
  { id: 's17', title: '附件清单', clauseNo: '第十八条', paragraphIds: ['p19'] },
  { id: 's18', title: '适用法律', clauseNo: '第十九条', paragraphIds: ['p20'] },
];

/** 风险原文片段（key -> {paragraphId, originalText}），供 seedData 引用，保证与段落 text 一致 */
export const RISK_SNIPPETS: Record<string, { paragraphId: string; originalText: string }> = {
  R1: {
    paragraphId: 'p2',
    originalText:
      '乙方（供应方）：星河软件有限公司\n统一社会信用代码：未提供\n法定代表人：刘星河\n联系地址：未提供',
  },
  R2: { paragraphId: 'p4', originalText: '580000元（大写：伍拾捌万捌仟元整）' },
  R3: { paragraphId: 'p5', originalText: '支付合同总额的80%作为预付款' },
  R4: { paragraphId: 'p5', originalText: '1.合同签订后7个工作日内，甲方应向乙方支付合同总额的80%作为预付款；' },
  R5: { paragraphId: 'p6', originalText: '尽快完成系统的交付与安装部署' },
  R6: { paragraphId: 'p7', originalText: '应符合甲方要求' },
  R7: { paragraphId: 'p7', originalText: '经甲方确认后签署验收报告，即视为验收合格' },
  R8: { paragraphId: 'p8', originalText: '全部归乙方所有，甲方仅享有非独占的使用权' },
  R9: { paragraphId: 'p9', originalText: '具体质保期限及响应时限由双方另行约定' },
  R10: { paragraphId: 'p10', originalText: '承担保密义务，未经对方书面同意不得向第三方披露' },
  R11: { paragraphId: 'p11', originalText: '因数据泄露造成的损失由双方共同承担' },
  R12: { paragraphId: 'p12', originalText: '期满后若需继续合作，自动续期' },
  R13: { paragraphId: 'p13', originalText: '每日按应付未付金额的千分之五支付违约金' },
  R14: { paragraphId: 'p13', originalText: '每日按合同总额的千分之一支付违约金，累计不超过合同总额的1%' },
  R15: { paragraphId: 'p14', originalText: '甲方逾期付款超过15日的，乙方有权单方解除本合同' },
  R16: { paragraphId: 'p15', originalText: '由乙方所在地有管辖权的人民法院管辖' },
  R17: { paragraphId: 'p4', originalText: '上述金额已含增值税' },
  R18: { paragraphId: 'p16', originalText: '未尽事宜由双方另行约定' },
};

/** 解析后的文档对象 */
export const DEMO_PARSED_DOCUMENT: ParsedDocument = {
  title: DEMO_CONTRACT_TITLE,
  sections: DEMO_SECTIONS,
  paragraphs: DEMO_PARAGRAPHS,
  fullText: DEMO_PARAGRAPHS.map((p) => p.text).join('\n\n'),
};

/** 抽取字段种子（模拟 AI 字段抽取结果） */
export const DEMO_EXTRACTED_FIELDS = [
  { fieldKey: 'contractName', fieldLabel: '合同名称', fieldValue: '软件系统采购合同', confidence: 0.98, lowConfidence: false, sourceText: '软件系统采购合同' },
  { fieldKey: 'buyer', fieldLabel: '甲方', fieldValue: '智远科技有限公司', confidence: 0.97, lowConfidence: false, sourceText: '甲方（采购方）：智远科技有限公司' },
  { fieldKey: 'seller', fieldLabel: '乙方', fieldValue: '星河软件有限公司', confidence: 0.88, lowConfidence: false, sourceText: '乙方（供应方）：星河软件有限公司' },
  { fieldKey: 'contractNo', fieldLabel: '合同编号', fieldValue: 'RVT-2026-001', confidence: 0.55, lowConfidence: true, sourceText: '（系统生成编号）' },
  { fieldKey: 'amount', fieldLabel: '合同金额', fieldValue: '580000', confidence: 0.95, lowConfidence: false, sourceText: '合同总金额为人民币580000元' },
  { fieldKey: 'currency', fieldLabel: '币种', fieldValue: 'CNY', confidence: 0.99, lowConfidence: false, sourceText: '人民币' },
  { fieldKey: 'taxRate', fieldLabel: '税率', fieldValue: '13%', confidence: 0.72, lowConfidence: true, sourceText: '上述金额已含增值税' },
  { fieldKey: 'signDate', fieldLabel: '签约日期', fieldValue: '2026-06-15', confidence: 0.65, lowConfidence: true, sourceText: '（未在正文明确，依据创建时间推断）' },
  { fieldKey: 'effectiveDate', fieldLabel: '生效日期', fieldValue: '2026-06-15', confidence: 0.9, lowConfidence: false, sourceText: '本合同自双方签字盖章之日起生效' },
  { fieldKey: 'term', fieldLabel: '合同期限', fieldValue: '2年', confidence: 0.96, lowConfidence: false, sourceText: '有效期为2年' },
  { fieldKey: 'paymentMethod', fieldLabel: '付款方式', fieldValue: '签约后付80%，验收后付20%', confidence: 0.94, lowConfidence: false, sourceText: '支付合同总额的80%作为预付款' },
  { fieldKey: 'deliveryDate', fieldLabel: '交付时间', fieldValue: '尽快', confidence: 0.4, lowConfidence: true, sourceText: '尽快完成系统的交付与安装部署' },
  { fieldKey: 'acceptanceMethod', fieldLabel: '验收方式', fieldValue: '符合甲方要求并签署验收报告', confidence: 0.6, lowConfidence: true, sourceText: '应符合甲方要求，经甲方确认后签署验收报告' },
  { fieldKey: 'warrantyPeriod', fieldLabel: '质保期限', fieldValue: '未约定', confidence: 0.3, lowConfidence: true, sourceText: '具体质保期限及响应时限由双方另行约定' },
  { fieldKey: 'jurisdiction', fieldLabel: '争议管辖', fieldValue: '乙方所在地法院', confidence: 0.93, lowConfidence: false, sourceText: '由乙方所在地有管辖权的人民法院管辖' },
];
