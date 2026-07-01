"""规则服务：从 Supabase 读取规则，供 AI Prompt 注入和规则引擎使用"""
import logging
import re
import string
from typing import List, Set, Dict, Optional
from pydantic import BaseModel

from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

_CONNECTIVE_WORDS = (
    '的', '或', '及', '与', '但', '而', '并', '且', '时', '后',
    '未', '无', '不', '仅', '全', '已', '将', '把', '被', '由',
)

_PUNCT_RE = re.compile(r'[，。、；：！？（）""''【】,;:!?' + re.escape(string.whitespace) + r']+')

# 合同领域高频术语关键词库（规则触发条件 → 合同正文中实际出现的匹配词）
# triggerCondition 中的长句经过标点切分后，再通过此词库映射到合同中的常见写法
_DOMAIN_KEYWORD_MAP: Dict[str, List[str]] = {
    # 主体信息
    '主体': ['合同主体', '甲方', '乙方', '供应方', '采购方', '统一社会信用代码', '法定代表人'],
    '信用代码': ['统一社会信用代码', '营业执照', '注册号'],
    '地址': ['联系地址', '注册地址', '通讯地址', '住所地'],
    # 金额
    '金额': ['合同金额', '总金额', '合同总价', '价款', '合同价款', '大写', '小写'],
    '大写': ['大写', '整', '元整', '人民币'],
    # 预付款
    '预付款': ['预付款', '首付款', '定金', '预付', '预支付'],
    '履约保函': ['履约保函', '银行保函', '保函', '保证金', '履约保证金', '担保措施'],
    '担保': ['担保', '保函', '保证金', '抵押', '质押'],
    # 交付
    '交付日期': ['交付', '交货', '交付时间', '交货日期', '交付期限', '交付日'],
    '尽快': ['尽快', '及时', '立即', '从速'],
    # 验收
    '验收标准': ['验收标准', '验收', '验收合格', '验收报告', '验收条件'],
    '甲方要求': ['甲方要求', '甲方确认', '甲方认可', '甲方满意', '甲方书面'],
    '验收期限': ['验收期限', '验收时间', '验收期', '验收日', '验收周期'],
    # 知识产权
    '知识产权': ['知识产权', '著作权', '专利权', '版权', '所有权', '使用权'],
    '归乙方': ['归乙方', '乙方所有', '乙方享有', '乙方拥有'],
    # 质保
    '质保期限': ['质保期', '保修期', '质量保证期', '质保期限', '保修期限'],
    '响应时限': ['响应时限', '响应时间', '响应', '修复时间', '修复时限', '故障响应'],
    # 违约责任
    '违约金': ['违约金', '违约', '赔偿', '罚金', '滞纳金'],
    '对等': ['对等', '同等', '相互', '双方', '一致'],
    '上限': ['上限', '封顶', '最高', '累计'],
    # 解除权
    '单方解除': ['单方解除', '解除权', '解除合同', '终止合同', '终止'],
    # 保密
    '保密': ['保密', '保密义务', '保密信息', '机密', '商业秘密', '保密期限'],
    '保密期限': ['保密期限', '保密期', '保密义务期限'],
    # 数据安全
    '数据泄露': ['数据泄露', '数据安全', '信息泄露', '数据保护', '个人信息'],
    '通知': ['通知', '告知', '通报', '报告'],
    # 争议管辖
    '管辖': ['管辖', '法院', '仲裁', '诉讼', '管辖权', '管辖法院'],
    '乙方所在地': ['乙方所在地', '乙方住所地', '供应方所在地', '乙方注册地'],
    # 自动续期
    '自动续期': ['自动续期', '自动续约', '自动延长', '自动顺延', '续期', '续约'],
    '提前通知': ['提前通知', '书面通知', '通知', '协商', '书面确认'],
    # 发票
    '发票': ['发票', '增值税', '专票', '普票', '增值税专用发票', '增值税普通发票'],
    '开票': ['开票', '开具', '发票开具', '发票'],
    # 通知送达
    '通知送达': ['通知送达', '送达', '通知', '通讯'],
    '有效送达地址': ['送达地址', '通讯地址', '联系地址', '地址'],
}


def _extract_keywords(trigger: str, name: str) -> List[str]:
    """从触发条件和规则名称中提取能在合同正文中匹配到的关键词

    策略（v2 增强版）：
    1. 以中英文标点切分触发条件
    2. 再以单字虚词进一步切分长片段
    3. 通过合同领域词库映射，提取常见合同术语变体
    4. 同时从规则名称提取关键词
    5. 优先保留短高价值词汇（2-4字纯合同术语）
    """
    raw_segments: List[str] = []
    all_text = f"{trigger} {name}"

    # 先对整段文本做领域词库匹配（最优先，直接命中合同真实写法）
    for pattern, variants in _DOMAIN_KEYWORD_MAP.items():
        if pattern in all_text:
            raw_segments.extend(variants)

    # 标点切分
    for text in (trigger, name):
        if not text:
            continue
        parts = _PUNCT_RE.split(text)
        for part in parts:
            part = part.strip()
            if not part:
                continue
            # 优先保留短高价值词（2-4字）
            if 2 <= len(part) <= 4:
                raw_segments.append(part)
            # 5-8字也保留
            elif 5 <= len(part) <= 8:
                raw_segments.append(part)
            # 长句进一步切分
            elif len(part) > 8:
                sub = re.split(r'[' + _CONNECTIVE_WORDS + r'>≤=<>%/\d]+', part)
                for s in sub:
                    s = s.strip()
                    if 2 <= len(s) <= 8:
                        raw_segments.append(s)

    # 从名称中提取最后几个字符作为短关键词（规则名称末尾通常是核心术语）
    for text in (name,):
        if not text:
            continue
        # 提取2-4字末尾片段
        text_clean = re.sub(r'[的或及与但]', '', text)
        for i in range(max(0, len(text_clean) - 4), len(text_clean)):
            chunk = text_clean[i:]
            if 2 <= len(chunk) <= 4:
                raw_segments.append(chunk)

    seen: Set[str] = set()
    unique: List[str] = []
    for kw in raw_segments:
        if kw not in seen:
            seen.add(kw)
            unique.append(kw)
    return unique


class RiskRule(BaseModel):
    """与前端 RiskRule 类型对齐"""
    id: str
    code: str
    name: str
    contractType: str
    riskType: str
    riskLevel: str
    method: str
    triggerCondition: str
    reasonTemplate: str
    suggestionTemplate: str
    status: str
    version: int
    description: str


class RuleService:
    """规则读取与匹配服务"""

    def get_enabled_rules(self, contract_type: Optional[str] = None) -> List[RiskRule]:
        """获取已启用的规则，可选按合同类型过滤"""
        try:
            sb = get_supabase()
            query = sb.table("rules").select("*").eq("status", "enabled")
            if contract_type:
                query = query.eq("contract_type", contract_type)
            resp = query.execute()
            if not resp.data:
                return []
            rules = []
            for item in resp.data:
                rules.append(RiskRule(
                    id=item.get("id", ""),
                    code=item.get("code", ""),
                    name=item.get("name", ""),
                    contractType=item.get("contract_type", ""),
                    riskType=item.get("risk_type", ""),
                    riskLevel=item.get("risk_level", ""),
                    method=item.get("method", ""),
                    triggerCondition=item.get("trigger_condition", ""),
                    reasonTemplate=item.get("reason_template", ""),
                    suggestionTemplate=item.get("suggestion_template", ""),
                    status=item.get("status", "enabled"),
                    version=item.get("version", 1),
                    description=item.get("description", ""),
                ))
            return rules
        except Exception as e:
            logger.warning(f"读取规则失败（Supabase 可能未配置），降级为空: {e}")
            return []

    def format_rules_for_prompt(self, rules: List[RiskRule]) -> str:
        """将规则格式化为 AI Prompt 可读的文本块"""
        if not rules:
            return ""

        lines = ["## 企业规则库（审核时请参考以下规则，识别出匹配的风险并在输出中标注 matchedRuleId）",
                 "",
                 "| 规则编码 | 规则名称 | 风险类型 | 风险等级 | 触发条件 |",
                 "|---------|---------|---------|---------|---------|"]
        for r in rules:
            lines.append(f"| {r.code} | {r.name} | {r.riskType} | {r.riskLevel} | {r.triggerCondition} |")

        lines.append("")
        lines.append("输出要求补充：")
        lines.append("1. 如果识别的风险匹配了某条规则，在风险对象中增加 matchedRuleId 字段（值为规则编码，如 RR-003）")
        lines.append("2. matchedRuleId 必须精确匹配上述规则编码，不确定时不填")
        lines.append("3. reviewBasis 可引用规则库中的依据，例如「《预付款规则 RR-PAY-001》：预付款比例超过50且无担保时触发高风险」")
        return "\n".join(lines)

    def match_risk_to_rule(self, risk_title: str, risk_type: str, risk_level: str) -> Optional[str]:
        """根据风险属性匹配规则，返回规则 ID"""
        rules = self.get_enabled_rules()
        for r in rules:
            if r.riskType == risk_type and r.riskLevel == risk_level:
                return r.id
        return None

    def keyword_match(self, paragraphs: List, contract_type: Optional[str] = None) -> List[dict]:
        """关键词/字段规则引擎：对合同段落做关键词匹配，直接命中规则风险

        覆盖所有已启用规则（field / keyword / ai 三类均参与）：
        - field/keyword 规则：按字段定义精确匹配关键词
        - ai 规则：从触发条件与规则名称中提取核心术语做关键词匹配

        返回拟风险项列表，每条包含：
        - ruleId / title / riskType / riskLevel / reviewBasis / suggestion / originalText
        """
        rules = self.get_enabled_rules(contract_type)
        results: List[dict] = []

        for rule in rules:
            keywords = _extract_keywords(rule.triggerCondition, rule.name)
            if not keywords:
                continue

            logger.debug(f"  规则 {rule.code}: keywords={keywords}")

            for para in paragraphs:
                text = para.text if hasattr(para, 'text') else (para.get('text', '') if isinstance(para, dict) else '')
                if not text:
                    continue

                matched = [kw for kw in keywords if kw in text]
                if not matched:
                    continue

                para_id = para.id if hasattr(para, 'id') else (para.get('id', '') if isinstance(para, dict) else '')
                pos = text.find(matched[0])
                results.append({
                    'ruleId': rule.id,
                    'title': rule.name,
                    'riskType': rule.riskType,
                    'riskLevel': rule.riskLevel,
                    'paragraphId': para_id,
                    'originalText': text[:200],
                    'startPosition': pos if pos >= 0 else 0,
                    'endPosition': (pos + len(matched[0])) if pos >= 0 else 0,
                    'riskReason': rule.reasonTemplate,
                    'reviewBasis': f"【规则 {rule.code}】{rule.name}：{rule.triggerCondition}",
                    'suggestion': rule.suggestionTemplate,
                    'confidence': 0.75,
                    'sourceType': 'rule',
                })
                break

        logger.info(f"规则引擎关键词匹配：{len(rules)} 条规则扫描，命中 {len(results)} 项")
        return results


rule_service = RuleService()
