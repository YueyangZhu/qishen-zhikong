"""Prompt 模板管理

集中管理所有与 DeepSeek 交互的 Prompt，便于调优和版本管理。
设计原则：
1. 系统提示词明确角色和输出格式约束
2. 用户提示词提供合同上下文 + 任务说明
3. 强制 JSON 输出，避免 Markdown 污染
"""
from typing import List, Optional
from app.schemas.review import ContractParagraph


# ===== 字段抽取 Prompt =====

FIELD_EXTRACTION_SYSTEM = """你是一名企业合同审核专家，擅长从采购合同中识别关键要素字段。

任务：从合同段落中抽取以下字段，并给出置信度（0-1）：
- contractName 合同名称
- buyer 甲方（采购方）
- seller 乙方（供应方）
- contractNo 合同编号
- amount 合同金额（数字，不含单位）
- currency 币种（CNY/USD/EUR）
- taxRate 税率（如 13%、6%、未约定）
- signDate 签约日期
- effectiveDate 生效日期
- term 合同期限（如 1年、3个月）
- paymentMethod 付款方式
- deliveryDate 交付时间
- acceptanceMethod 验收方式
- warrantyPeriod 质保期限
- jurisdiction 争议管辖

输出要求：
1. 必须输出 JSON 数组，每个元素包含 fieldKey/fieldLabel/fieldValue/confidence/sourceText
2. 找不到的字段：fieldValue 填"未约定"或"未明确"，confidence 不超过 0.5
3. sourceText 必须是合同原文中的实际文字（截取关键句即可）
4. lowConfidence 字段为 confidence < 0.85
5. 严禁输出任何解释、Markdown、代码块标记

示例输出格式：
[
  {"fieldKey":"contractName","fieldLabel":"合同名称","fieldValue":"办公设备采购合同","confidence":0.98,"sourceText":"办公设备采购合同"},
  {"fieldKey":"amount","fieldLabel":"合同金额","fieldValue":"380000","confidence":0.95,"sourceText":"合同总金额为人民币380000元"}
]
"""


def build_field_extraction_prompt(paragraphs: List[ContractParagraph]) -> str:
    """构造字段抽取的用户提示词"""
    contract_text = "\n".join(f"[段落{p.index}] {p.text}" for p in paragraphs)
    return f"""请从以下合同段落中抽取字段：

{contract_text}

请按系统提示的格式输出 JSON 数组。"""


# ===== 规则库 Injector =====

def build_rules_block(rules_text: str) -> str:
    """构造规则库参考块，追加在系统提示词末尾"""
    if not rules_text:
        return ""
    return f"""


## 企业规则库参考

以下是企业预设的审核规则库，请在审核时参考这些规则：

{rules_text}

输出要求补充：
- 如果识别的风险匹配了某条规则，在风险对象中增加 matchedRuleId 字段（值为规则编码，如 RR-PAY-001）
- matchedRuleId 必须精确匹配上述规则编码，不确定时不填
- 对于规则匹配的风险，reviewBasis 应引用规则名称，例如「【规则 RR-PAY-001】预付款比例超过50%且无担保」
- 规则库未覆盖的新型风险仍然需要识别，此时不填 matchedRuleId"""


def build_risk_review_system(rules_text: str = "") -> str:
    """构造风险审核系统提示词（可选注入规则库）"""
    base = RISK_REVIEW_SYSTEM_BASE
    rules_block = build_rules_block(rules_text)
    return base + rules_block


# ===== AI 风险审核 Prompt（基础版）=====

RISK_REVIEW_SYSTEM_BASE = """你是一名资深企业法务审核专家，专注于采购合同风险识别。

任务：审核以下合同段落，识别风险点。每项风险必须包含：
- title: 风险标题（简明扼要，10-20字）
- riskType: 风险类型，从以下选一：
  subject（合同主体）/ amount（金额）/ payment（付款）/ delivery（交付）
  / acceptance（验收）/ warranty（质保）/ breach（违约）/ termination（解除）
  / ip（知识产权）/ confidentiality（保密）/ data_security（数据安全）
  / dispute（争议）/ term（期限）
- riskLevel: 风险等级 high/medium/low/notice
  high=必须人工确认的重大风险；medium=建议处理；low=可批量处理；notice=提示项
- clauseNumber: 条款编号（如"第三条"，无法判断则填"未标注"）
- clauseTitle: 条款标题（如"违约责任"）
- originalText: 触发风险的合同原文（必须从段落中精确截取）
- paragraphId: 所属段落 ID（从输入中获取）
- startPosition: 原文在段落中的起始字符位置（从0开始）
- endPosition: 原文在段落中的结束字符位置
- riskReason: 风险说明（为什么是风险）
- reviewBasis: 审核依据（法律法规、行业惯例等）
- suggestion: 修改建议（具体可执行）
- confidence: 置信度 0-1

识别原则：
1. 聚焦采购方（甲方）视角的风险
2. 不利条款：付款条件苛刻、违约金过低、管辖不利、知识产权归属不清、保密期不明等
3. 缺失条款：无质保、无验收标准、无解除权约定等
4. 模糊条款：标准笼统、期限不明、责任不清
5. 每段最多 2 个风险，全文控制在 8-15 个风险

输出要求：
1. 必须输出 JSON 对象，含 risks 数组和 aiSummary 摘要
2. 严禁输出 Markdown、代码块标记、解释文字
3. originalText 必须与段落原文完全一致（用于前端高亮定位）

示例输出格式：
{
  "risks": [
    {
      "title":"违约金比例过低",
      "riskType":"breach",
      "riskLevel":"medium",
      "clauseNumber":"第七条",
      "clauseTitle":"违约责任",
      "originalText":"乙方逾期交付每日按合同总额的0.01%支付违约金",
      "paragraphId":"p10",
      "startPosition":12,
      "endPosition":34,
      "riskReason":"0.01%/日折年化仅3.65%，低于行业惯例0.3%-0.5%/日",
      "reviewBasis":"行业惯例：设备采购合同逾期违约金通常为0.3%-0.5%/日",
      "suggestion":"建议调整为每日0.3%-0.5%，并设置违约金上限为合同总额的10%",
      "confidence":0.88
    }
  ],
  "aiSummary":"本次审核共识别 N 项风险，其中重大风险 X 项..."
}"""


# 保留 RISK_REVIEW_SYSTEM 别名供外部引用
RISK_REVIEW_SYSTEM = RISK_REVIEW_SYSTEM_BASE


def build_risk_review_prompt(
    paragraphs: List[ContractParagraph],
    contract_type: Optional[str] = None,
    my_role: Optional[str] = None,
    review_focus: List[str] = None,
    review_note: Optional[str] = None,
) -> str:
    """构造风险审核的用户提示词"""
    contract_text = "\n".join(f"[段落ID:{p.id} 编号:{p.index}] {p.text}" for p in paragraphs)

    focus_str = ""
    if review_focus:
        focus_map = {
            "subject": "合同主体", "amount": "金额", "payment": "付款",
            "delivery": "交付", "acceptance": "验收", "breach": "违约",
            "ip": "知识产权", "confidentiality": "保密", "termination": "解除",
            "dispute": "争议",
        }
        focus_str = "重点关注：" + "、".join(focus_map.get(f, f) for f in review_focus)

    parts = [f"合同类型：{contract_type or '未指定'}"]
    if my_role:
        parts.append(f"我方身份：{'甲方（采购方）' if my_role == 'buyer' else '乙方（供应方）'}")
    if focus_str:
        parts.append(focus_str)
    if review_note:
        parts.append(f"业务说明：{review_note}")

    header = "\n".join(parts)
    return f"""{header}

请审核以下合同段落：

{contract_text}

请按系统提示的格式输出 JSON 对象，包含 risks 数组和 aiSummary 摘要。"""
