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

_CONNECTIVE_RE_STR = '[' + ''.join(_CONNECTIVE_WORDS) + r'>≤=<>%/\d]+'

# 关键词提取时需过滤的通用词（在合同中太常见，不能作为有效关键词）
_KEYWORD_STOP_WORDS = {
    '合同', '约定', '条款', '规定', '条件', '机制', '责任', '义务',
    '权利', '承担', '处理', '执行', '说明', '确认', '双方', '乙方',
    '甲方', '支付', '提供', '进行', '包括', '内容', '相关',
    '明确', '不明确', '未约定', '不合理', '缺失', '不完整', '不清',
    '未设置', '未列明', '未提供', '未发现', '上限',
}

# 含连接词的短片段（5-8字）需进一步拆分的连接词正则
_INNER_CONNECTIVE_RE = re.compile(r'[与及和或而但]')

_PUNCT_RE = re.compile(r'[，。、；：！？（）""''【】,;:!?' + re.escape(string.whitespace) + r'等]+')

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
    '删除返还': ['删除', '返还', '销毁', '清除'],
    '通知义务': ['通知义务', '告知义务'],
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
    '通知送达': ['通知送达', '送达'],
    '有效送达地址': ['送达地址', '通讯地址', '联系地址'],
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
            # 5-8字也保留，但含连接词的进一步拆分
            elif 5 <= len(part) <= 8:
                if _INNER_CONNECTIVE_RE.search(part):
                    sub = _INNER_CONNECTIVE_RE.split(part)
                    for s in sub:
                        s = s.strip()
                        if 2 <= len(s) <= 8:
                            raw_segments.append(s)
                raw_segments.append(part)
            # 长句进一步切分
            elif len(part) > 8:
                sub = re.split(_CONNECTIVE_RE_STR, part)
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
        if kw not in seen and kw not in _KEYWORD_STOP_WORDS:
            seen.add(kw)
            unique.append(kw)
    return unique


# 风险类型 -> 章节定位关键词（用于缺失类规则绑定到对应章节，避免全部落到标题）
_RISK_TYPE_SECTION_KEYWORDS: Dict[str, List[str]] = {
    'subject': ['第一条', '合同主体', '甲方', '乙方', '主体信息', '统一社会信用代码'],
    'amount': ['第三条', '合同金额', '金额', '价款', '合同总价'],
    'payment': ['第三条', '付款', '支付', '合同金额', '价款'],
    'delivery': ['第四条', '交付', '交货', '交付安排'],
    'acceptance': ['第五条', '验收', '验收标准'],
    'warranty': ['第六条', '质保', '保修', '质量保证'],
    'breach': ['第八条', '违约', '违约责任', '违约金'],
    'termination': ['解除', '终止', '合同终止'],
    'ip': ['第六条', '知识产权', '著作权', '专利权', '版权'],
    'confidentiality': ['第七条', '保密', '商业秘密', '机密'],
    'data_security': ['第七条', '数据安全', '数据保护', '个人信息', '信息泄露'],
    'dispute': ['第九条', '争议', '仲裁', '诉讼', '管辖'],
    'term': ['期限', '有效期', '合同期限'],
}


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


def _paragraph_text(para) -> str:
    """统一读取 paragraph 的 text（支持 Pydantic 模型和 dict）"""
    if hasattr(para, 'text'):
        return para.text or ''
    if isinstance(para, dict):
        return para.get('text', '') or ''
    return ''


def _paragraph_attr(para, attr: str, default=''):
    """统一读取 paragraph 属性（支持 Pydantic 模型和 dict）"""
    if hasattr(para, attr):
        return getattr(para, attr, default) or default
    if isinstance(para, dict):
        return para.get(attr, default) or default
    return default


def _find_target_paragraph(rule: RiskRule, text_paragraphs: List) -> dict:
    """为缺失类规则找到最适合定位的段落，避免全部绑定到合同标题。

    策略：
    1. 根据 riskType 提取章节关键词，同时从规则名/触发条件中提取“第X条”
    2. 优先匹配 clauseNo / clauseTitle（权重最高）
    3. 其次匹配段落正文
    4. 优先 body 段落，避免绑定 title/header/signature
    5. 若无匹配，返回第一个文本段落作为兜底
    """
    if not text_paragraphs:
        return {}

    # 收集定位关键词
    keywords: List[str] = []
    rule_text = f"{rule.name} {rule.triggerCondition}"
    clause_match = re.search(r'第[一二三四五六七八九十百零\d]+条', rule_text)
    if clause_match:
        keywords.append(clause_match.group(0))
    keywords.extend(_RISK_TYPE_SECTION_KEYWORDS.get(rule.riskType, []))

    seen: Set[str] = set()
    unique_keywords: List[str] = []
    for kw in keywords:
        if kw and kw not in seen:
            seen.add(kw)
            unique_keywords.append(kw)

    best_para = None
    best_score = -1
    for para in text_paragraphs:
        ptype = _paragraph_attr(para, 'type', 'body')
        clause_no = _paragraph_attr(para, 'clauseNo', '')
        clause_title = _paragraph_attr(para, 'clauseTitle', '')
        text = _paragraph_text(para)

        score = 0
        for kw in unique_keywords:
            if clause_no and kw in clause_no:
                score += 12
            if clause_title and kw in clause_title:
                score += 10
            if kw in text:
                score += 6

        # 优先 body 段落，扣分 title/header/signature
        if ptype == 'body':
            score += 4
        elif ptype in ('title', 'header', 'signature'):
            score -= 8

        if score > best_score:
            best_score = score
            best_para = para

    # 如果没有匹配到任何关键词，退回第一个文本段落
    if best_score <= 0 or best_para is None:
        best_para = text_paragraphs[0]

    return {
        'paragraphId': _paragraph_attr(best_para, 'id', ''),
        'clauseNumber': _paragraph_attr(best_para, 'clauseNo', '未标注'),
        'clauseTitle': _paragraph_attr(best_para, 'clauseTitle', ''),
        'originalText': _paragraph_text(best_para)[:200],
    }


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
        """关键词规则引擎：仅对 method='keyword' 的规则做匹配

        设计原则：
        - method='keyword' 的规则（RR-018~RR-026）检测的是「合同缺失某条款」，
          匹配逻辑为：如果关键词在合同正文中 **找不到**，则触发该规则。
        - method='field' 的规则需要字段抽取或数值计算，keyword 匹配无法正确判断。
        - method='ai' 的规则需要语义理解，keyword 匹配会产生大量误报。

        返回拟风险项列表，每条包含：
        - ruleId / title / riskType / riskLevel / reviewBasis / suggestion / originalText
        """
        rules = self.get_enabled_rules(None)
        # 只对 method='keyword' 的规则做关键词匹配
        keyword_rules = [r for r in rules if r.method == 'keyword']
        if not keyword_rules:
            logger.info("规则引擎：无 method='keyword' 规则，跳过关键词匹配")
            return []

        # 把合同所有段落拼成全文，用于关键词缺失检测
        # text 类型段落直接用 text 字段；table 类型用所有单元格文本拼接；image 类型用 ocrText（若有）
        text_paragraphs = []
        for para in paragraphs:
            ptype = para.type if hasattr(para, 'type') else (para.get('type', 'body') if isinstance(para, dict) else 'body')
            if ptype == 'image':
                # 图片段落：仅当有 OCR 文本时才纳入
                ocr = para.ocrText if hasattr(para, 'ocrText') else (para.get('ocrText', '') if isinstance(para, dict) else '')
                if ocr:
                    text_paragraphs.append(para)
                continue
            # body/header/title/signature/table 都纳入
            text_paragraphs.append(para)

        if not text_paragraphs:
            logger.info("规则引擎：合同无文本段落，跳过关键词匹配")
            return []

        full_text = ''
        for para in text_paragraphs:
            ptype = para.type if hasattr(para, 'type') else (para.get('type', 'body') if isinstance(para, dict) else 'body')
            if ptype == 'image':
                ocr = para.ocrText if hasattr(para, 'ocrText') else (para.get('ocrText', '') if isinstance(para, dict) else '')
                full_text += (ocr or '') + '\n'
            elif ptype == 'table':
                # 表格：拼接所有单元格文本
                td = para.tableData if hasattr(para, 'tableData') else (para.get('tableData') if isinstance(para, dict) else None)
                if td:
                    for row in td:
                        full_text += ' '.join((cell or '').strip() for cell in row) + '\n'
                else:
                    text = para.text if hasattr(para, 'text') else (para.get('text', '') if isinstance(para, dict) else '')
                    full_text += text + '\n'
            else:
                text = para.text if hasattr(para, 'text') else (para.get('text', '') if isinstance(para, dict) else '')
                full_text += text + '\n'

        results: List[dict] = []
        for rule in keyword_rules:
            keywords = _extract_keywords(rule.triggerCondition, rule.name)
            if not keywords:
                continue

            logger.debug(f"  规则 {rule.code}: keywords={keywords}")

            # 关键词缺失检测：如果合同正文中找不到任何匹配关键词，说明合同缺失该条款
            any_matched = any(kw in full_text for kw in keywords)
            if any_matched:
                logger.debug(f"  规则 {rule.code} 跳过：合同正文中找到关键词，说明该条款已存在")
                continue

            # 合同缺失该条款 → 触发规则，定位到最相关的章节段落
            target = _find_target_paragraph(rule, text_paragraphs)

            results.append({
                'ruleId': rule.id,
                'title': rule.name,
                'riskType': rule.riskType,
                'riskLevel': rule.riskLevel,
                'paragraphId': target.get('paragraphId', ''),
                'clauseNumber': target.get('clauseNumber', '未标注'),
                'clauseTitle': target.get('clauseTitle', ''),
                'originalText': target.get('originalText') or '（合同全文未发现相关条款）',
                'startPosition': 0,
                'endPosition': 0,
                'riskReason': rule.reasonTemplate,
                'reviewBasis': f"【规则 {rule.code}】{rule.name}：{rule.triggerCondition}",
                'suggestion': rule.suggestionTemplate,
                'confidence': 0.65,
                'sourceType': 'rule',
            })

        logger.info(
            f"规则引擎关键词匹配：{len(keyword_rules)} 条 keyword 规则扫描，"
            f"缺失命中 {len(results)} 项"
        )
        return results


rule_service = RuleService()
