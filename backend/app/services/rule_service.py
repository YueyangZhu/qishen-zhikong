"""规则服务：从 Supabase 读取规则，供 AI Prompt 注入和规则引擎使用"""
import logging
import re
import string
from typing import List, Set, Optional
from pydantic import BaseModel

from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

_CONNECTIVE_WORDS = (
    '的', '或', '及', '与', '但', '而', '并', '且', '时', '后',
    '未', '无', '不', '仅', '全', '已', '将', '把', '被', '由',
)

_PUNCT_RE = re.compile(r'[，。、；：！？（）""''【】,;:!?' + re.escape(string.whitespace) + r']+')


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


def _extract_keywords(trigger: str, name: str) -> List[str]:
    """从触发条件和规则名称中提取能在合同正文中匹配到的关键词

    策略：
    1. 以中英文标点切分触发条件
    2. 再以单字虚词进一步切分长片段
    3. 保留 2-8 字的词组（过短命中噪声大，过长几乎不可能逐字命中）
    4. 同时从规则名称提取关键词（名称通常包含核心术语）
    """
    raw_segments: List[str] = []
    for text in (trigger, name):
        if not text:
            continue
        parts = _PUNCT_RE.split(text)
        for part in parts:
            part = part.strip()
            if 2 <= len(part) <= 8:
                raw_segments.append(part)
            elif len(part) > 8:
                sub = re.split(r'[' + _CONNECTIVE_WORDS + ']', part)
                for s in sub:
                    s = s.strip()
                    if 2 <= len(s) <= 8:
                        raw_segments.append(s)

    seen: Set[str] = set()
    unique: List[str] = []
    for kw in raw_segments:
        if kw not in seen:
            seen.add(kw)
            unique.append(kw)
    return unique


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
