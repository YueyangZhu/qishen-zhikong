"""AI 风险审核路由"""
import logging
import re
from typing import List
from fastapi import APIRouter, HTTPException, Depends

from app.auth import AuthUser, require_role
from app.services.ai_service import ai_service
from app.services.rule_service import rule_service
from app.schemas.review import ReviewRisksRequest, ReviewRisksResponse, RiskItemAI, ContractParagraph
from app.schemas.common import ApiResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["review"])


# 风险等级排序（数值越小优先级越高）
_RISK_LEVEL_ORDER = {"high": 0, "medium": 1, "low": 2, "notice": 3}


def _normalize_text(text: str) -> str:
    """对文本做归一化：去除空白、全角数字/标点转半角，用于重叠比较。"""
    text = text or ""
    text = re.sub(r"\s+", "", text)
    # 全角字符转半角
    result = []
    for ch in text:
        code = ord(ch)
        if 0xFF01 <= code <= 0xFF5E:
            result.append(chr(code - 0xFEE0))
        elif code == 0x3000:
            result.append(" ")
        else:
            result.append(ch)
    return "".join(result)


def _deduplicate_risks_by_text(
    risks: List[RiskItemAI],
    paragraphs: List[ContractParagraph],
    overlap_threshold: float = 0.6,
) -> List[RiskItemAI]:
    """按原文重叠度对风险去重：同一段落内原文高度重叠时只保留最高等级风险。

    目的：避免 AI 对同一段文字返回多个风险，导致前端高亮叠加、颜色浑浊。
    策略：
    1. 按风险等级排序（高风险优先）
    2. 对每条风险，在段落文本中定位 originalText 的实际字符区间
    3. 重叠判定同时考虑：原文子串包含、区间覆盖比例
    4. 保留第一个命中的高等级风险，跳过后续低等级重叠风险
    """
    if not risks:
        return []

    # 构建段落文本索引，用于定位 originalText 在段落中的真实位置
    para_text_map = {p.id: p.text or "" for p in paragraphs}

    sorted_risks = sorted(
        risks,
        key=lambda r: (_RISK_LEVEL_ORDER.get(r.riskLevel, 99), -len(r.originalText or "")),
    )

    selected: List[RiskItemAI] = []
    # 按 paragraphId 记录已覆盖的归一化原文区间 (start, end, norm_text)
    covered: dict = {}

    for risk in sorted_risks:
        para_id = risk.paragraphId or ""
        text = risk.originalText or ""
        if not text:
            continue

        # 限制 originalText 最大长度：若 AI 返回整段大文本，只保留前 300 字符作为定位锚点
        if len(text) > 300:
            risk.originalText = text[:300]
            text = risk.originalText

        norm = _normalize_text(text)
        if not norm:
            continue

        # 在段落文本中定位当前 originalText 的真实位置
        para_text = para_text_map.get(para_id, "")
        norm_para_text = _normalize_text(para_text)
        start_pos = norm_para_text.find(norm)
        end_pos = start_pos + len(norm) if start_pos != -1 else -1

        is_overlap = False
        if para_id in covered:
            for (s, e, prev_norm) in covered[para_id]:
                # 1. 子串包含：当前原文是已保留原文的子串，或已保留原文是当前原文的子串
                if norm in prev_norm or prev_norm in norm:
                    is_overlap = True
                    break
                # 2. 区间重叠比例：使用在段落文本中的真实字符位置
                if start_pos != -1 and s != -1:
                    o_s = max(start_pos, s)
                    o_e = min(end_pos, e)
                    if o_e > o_s:
                        overlap_len = o_e - o_s
                        min_len = min(len(norm), len(prev_norm))
                        if min_len > 0 and overlap_len / min_len > overlap_threshold:
                            is_overlap = True
                            break

        if is_overlap:
            logger.debug(f"风险去重：跳过与已保留风险重叠的 '{risk.title}'")
            continue

        selected.append(risk)
        if para_id not in covered:
            covered[para_id] = []
        covered[para_id].append((start_pos, end_pos, norm))

    # 保持原始顺序：按输入列表中的相对顺序返回
    selected_ids = {id(r) for r in selected}
    return [r for r in risks if id(r) in selected_ids]


# 兜底风险关键词映射：当规则库和 AI 都未返回风险时使用
_FALLBACK_RISK_PATTERNS = [
    {
        "keywords": ["预付款", "首付", "定金", "预付"],
        "title": "预付款比例偏高",
        "riskType": "payment",
        "riskLevel": "medium",
        "riskReason": "合同中约定预付款条款，建议明确比例、支付节点及对应履约担保措施",
        "reviewBasis": "企业采购风控惯例：大额预付款应配套履约保函或分阶段验收",
        "suggestion": "建议约定预付款不超过合同总额30%，或要求乙方提供等额履约保函/保证金",
    },
    {
        "keywords": ["违约金", "赔偿", "罚金", "滞纳金"],
        "title": "违约责任不对等",
        "riskType": "breach",
        "riskLevel": "medium",
        "riskReason": "合同违约责任条款可能存在单方或不对等约定，需核对双方责任是否平衡",
        "reviewBasis": "《民法典》合同编：违约责任应体现公平原则",
        "suggestion": "建议明确甲乙双方违约责任对等，违约金比例合理且设置上限",
    },
    {
        "keywords": ["验收", "验收标准", "验收报告"],
        "title": "验收标准不够量化",
        "riskType": "acceptance",
        "riskLevel": "low",
        "riskReason": "验收条款若仅作原则性约定，易导致后续争议",
        "reviewBasis": "采购合同管理实践：验收标准应具体、可量化、可测试",
        "suggestion": "建议补充验收指标、测试方法、验收期限及不合格处理方式",
    },
    {
        "keywords": ["质保", "保修", "质量保证"],
        "title": "质保期限及范围不明",
        "riskType": "warranty",
        "riskLevel": "low",
        "riskReason": "质保条款未明确期限起算点、覆盖范围及免责情形",
        "reviewBasis": "行业惯例：软硬件采购通常质保期不少于1年",
        "suggestion": "建议明确质保期起算时间、质保范围、响应时限及维修/更换责任",
    },
    {
        "keywords": ["知识产权", "著作权", "专利权", "所有权"],
        "title": "知识产权归属需确认",
        "riskType": "ip",
        "riskLevel": "low",
        "riskReason": "涉及定制开发或技术成果时，知识产权归属约定不明将引发后续权益争议",
        "reviewBasis": "《专利法》《著作权法》：知识产权归属应以合同约定优先",
        "suggestion": "建议明确成果知识产权归属、使用范围及后续改进权益分配",
    },
    {
        "keywords": ["管辖", "仲裁", "诉讼", "法院"],
        "title": "争议管辖约定需关注",
        "riskType": "dispute",
        "riskLevel": "notice",
        "riskReason": "争议解决条款约定影响维权成本，需确认是否对我方有利",
        "reviewBasis": "《民事诉讼法》：合同当事人可约定管辖法院",
        "suggestion": "建议优先约定甲方所在地法院或双方认可的仲裁机构管辖",
    },
    {
        "keywords": ["保密", "商业秘密", "机密"],
        "title": "保密义务范围不明",
        "riskType": "confidentiality",
        "riskLevel": "notice",
        "riskReason": "保密条款若未界定保密信息范围、期限及违约责任，难以有效约束",
        "reviewBasis": "《反不正当竞争法》：商业秘密保护需明确权利义务",
        "suggestion": "建议明确保密信息范围、保密期限、双方义务及违约责任",
    },
]


def _generate_fallback_risks(paragraphs: List[ContractParagraph]) -> List[RiskItemAI]:
    """兜底风险生成：基于通用关键词扫描合同段落，生成提示级风险。

    仅在规则引擎和 AI 均未能识别风险时调用，保证真实上传合同至少
    能展示若干参考风险，避免风险明细完全空白。
    """
    results: List[RiskItemAI] = []
    seen_patterns: set = set()
    # 兜底关键词扫描仅对真实文本段落执行，跳过 image/table 等无语义段落
    for para in paragraphs:
        if para.type in ('image', 'table'):
            continue
        text = para.text
        if not text:
            continue
        for pattern in _FALLBACK_RISK_PATTERNS:
            if pattern["title"] in seen_patterns:
                continue
            matched_kw = next((kw for kw in pattern["keywords"] if kw in text), None)
            if matched_kw:
                seen_patterns.add(pattern["title"])
                pos = text.find(matched_kw)
                results.append(RiskItemAI(
                    title=pattern["title"],
                    riskType=pattern["riskType"],
                    riskLevel=pattern["riskLevel"],
                    clauseNumber="未标注",
                    clauseTitle="",
                    originalText=text[:200],
                    paragraphId=para.id,
                    startPosition=pos if pos >= 0 else 0,
                    endPosition=(pos + len(matched_kw)) if pos >= 0 else 0,
                    riskReason=pattern["riskReason"],
                    reviewBasis=pattern["reviewBasis"],
                    suggestion=pattern["suggestion"],
                    confidence=0.7,
                    sourceType="ai",
                    matchedRuleId=None,
                ))
                break
    return results


@router.post("/review-risks", response_model=ApiResponse)
async def review_risks(req: ReviewRisksRequest, user: AuthUser = Depends(require_role('purchaser'))):
    """AI 审核合同风险（含规则引擎前置匹配）

    流程：
    1. 规则引擎关键词匹配 → 直接命中的规则风险
    2. AI 语义审核 → AI 识别的风险（含规则库 Prompt 注入）
    3. 合并去重：规则风险在前，AI 风险在后，按 ruleId 去重

    输入：合同段落 + 合同类型 + 我方身份 + 审核重点
    输出：风险项列表 + AI 摘要
    """
    try:
        if not req.paragraphs:
            raise HTTPException(status_code=400, detail="段落列表不能为空")

        # 1. 规则引擎关键词匹配
        logger.info(f"规则引擎开始匹配：合同类型={req.contractType}, 段落数={len(req.paragraphs)}")
        for p in req.paragraphs:
            logger.debug(f"  段落[{p.id}]: {p.text[:80]}...")
        rule_hits = rule_service.keyword_match(req.paragraphs, req.contractType)
        logger.info(f"规则引擎命中：{len(rule_hits)} 项")
        rule_risk_ids: set = set()
        rule_risks: List[RiskItemAI] = []
        for hit in rule_hits:
            rule_risk_ids.add(hit['ruleId'])
            rule_risks.append(RiskItemAI(
                title=hit['title'],
                riskType=hit['riskType'],
                riskLevel=hit['riskLevel'],
                clauseNumber=hit.get('clauseNumber', '未标注'),
                clauseTitle=hit.get('clauseTitle', ''),
                originalText=hit['originalText'],
                paragraphId=hit['paragraphId'],
                startPosition=hit['startPosition'],
                endPosition=hit['endPosition'],
                riskReason=hit['riskReason'],
                reviewBasis=hit['reviewBasis'],
                suggestion=hit['suggestion'],
                confidence=hit['confidence'],
                sourceType="rule",
                matchedRuleId=hit['ruleId'],
            ))
        if rule_risks:
            logger.info(f"规则引擎命中：{len(rule_risks)} 项")

        # 2. AI 语义审核（含规则库 Prompt 注入）
        # AI 调用可能因 DeepSeek 超时/限流/网络抖动失败，失败时不中断流程，
        # 改用兜底风险生成，确保真实上传合同至少能返回参考风险
        ai_risks: List[RiskItemAI] = []
        ai_summary = ""
        try:
            ai_risks, ai_summary = ai_service.review_risks(
                paragraphs=req.paragraphs,
                contract_type=req.contractType,
                my_role=req.myRole,
                review_focus=req.reviewFocus,
                review_note=req.reviewNote,
            )
            logger.info(f"AI 审核返回：{len(ai_risks)} 项风险")
        except Exception as ai_err:
            logger.warning(f"AI 审核调用失败，将使用兜底风险：{ai_err}")
            ai_summary = f"AI 审核服务暂时不可用，已按通用规则生成参考风险。错误信息：{ai_err}"

        # 3. 合并去重：AI 风险中如果 matchedRuleId 已被规则引擎命中，跳过
        merged = list(rule_risks)
        seen_ids = set(rule_risk_ids)
        for r in ai_risks:
            rid = r.matchedRuleId
            if rid and rid in seen_ids:
                continue
            merged.append(r)

        # 4. 按原文重叠度二次去重：避免同一段文字被多个中/低风险叠加标注
        before_dedup = len(merged)
        merged = _deduplicate_risks_by_text(merged, req.paragraphs, overlap_threshold=0.6)
        if before_dedup != len(merged):
            logger.info(f"风险去重：{before_dedup} -> {len(merged)} 项（已合并同段重叠风险）")

        # 兜底：规则引擎和 AI 都未识别到风险（或 AI 失败）时，用通用关键词再扫描一遍生成基础风险
        # 避免真实合同上传后因规则库为空或 AI 异常导致风险明细完全空白
        if not merged and paragraphs:
            logger.warning("规则引擎和 AI 均未识别风险，触发兜底风险生成")
            merged = _generate_fallback_risks(paragraphs)
            if not ai_summary:
                ai_summary = f"本次审核未识别到明确风险，已按通用规则生成 {len(merged)} 项提示项供参考"

        result = ReviewRisksResponse(
            risks=merged,
            aiSummary=ai_summary,
        )

        logger.info(
            f"风险审核完成：规则引擎 {len(rule_risks)} 项 + AI {len(ai_risks)} 项"
            f"（去重后共 {len(merged)} 项）"
            f"(high={sum(1 for r in merged if r.riskLevel == 'high')}, "
            f"medium={sum(1 for r in merged if r.riskLevel == 'medium')}, "
            f"low={sum(1 for r in merged if r.riskLevel == 'low')})"
        )
        return ApiResponse(
            success=True,
            data=result.model_dump(),
            message=f"识别 {len(merged)} 项风险（规则 {len(rule_risks)} + AI {len(ai_risks) - sum(1 for r in ai_risks if r.matchedRuleId and r.matchedRuleId in seen_ids)}）",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("风险审核失败")
        return ApiResponse(success=False, error="REVIEW_ERROR", message=str(e))
