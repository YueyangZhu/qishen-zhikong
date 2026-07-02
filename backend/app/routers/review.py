"""AI 风险审核路由"""
import logging
from typing import List
from fastapi import APIRouter, HTTPException, Depends

from app.auth import AuthUser, require_role
from app.services.ai_service import ai_service
from app.services.rule_service import rule_service
from app.schemas.review import ReviewRisksRequest, ReviewRisksResponse, RiskItemAI, ContractParagraph
from app.schemas.common import ApiResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["review"])


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
    for para in paragraphs:
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
                clauseNumber="未标注",
                clauseTitle="",
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
        ai_risks, ai_summary = ai_service.review_risks(
            paragraphs=req.paragraphs,
            contract_type=req.contractType,
            my_role=req.myRole,
            review_focus=req.reviewFocus,
            review_note=req.reviewNote,
        )

        # 3. 合并去重：AI 风险中如果 matchedRuleId 已被规则引擎命中，跳过
        merged = list(rule_risks)
        seen_ids = set(rule_risk_ids)
        for r in ai_risks:
            rid = r.matchedRuleId
            if rid and rid in seen_ids:
                continue
            merged.append(r)

        # 兜底：规则引擎和 AI 都未识别到风险时，用通用关键词再扫描一遍生成基础风险
        # 避免真实合同上传后因规则库为空或 AI 返回空导致风险明细空白
        if not merged and paragraphs:
            logger.warning("规则引擎和 AI 均未识别风险，触发兜底风险生成")
            merged = _generate_fallback_risks(paragraphs)
            ai_summary = ai_summary or f"本次审核未识别到明确风险，已按通用规则生成 {len(merged)} 项提示项供参考"

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
