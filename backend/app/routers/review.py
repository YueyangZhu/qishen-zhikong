"""AI 风险审核路由"""
import logging
from typing import List
from fastapi import APIRouter, HTTPException, Depends

from app.auth import AuthUser, require_role
from app.services.ai_service import ai_service
from app.services.rule_service import rule_service
from app.schemas.review import ReviewRisksRequest, ReviewRisksResponse, RiskItemAI
from app.schemas.common import ApiResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["review"])


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
        rule_hits = rule_service.keyword_match(req.paragraphs, req.contractType)
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
