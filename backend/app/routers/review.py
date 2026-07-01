"""AI 风险审核路由"""
import logging
from fastapi import APIRouter, HTTPException, Depends

from app.auth import AuthUser, require_role
from app.services.ai_service import ai_service
from app.schemas.review import ReviewRisksRequest, ReviewRisksResponse, RiskItemAI
from app.schemas.common import ApiResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["review"])


@router.post("/review-risks", response_model=ApiResponse)
async def review_risks(req: ReviewRisksRequest, user: AuthUser = Depends(require_role('purchaser'))):
    """AI 审核合同风险

    输入：合同段落 + 合同类型 + 我方身份 + 审核重点
    输出：风险项列表 + AI 摘要
    """
    try:
        if not req.paragraphs:
            raise HTTPException(status_code=400, detail="段落列表不能为空")

        risks, ai_summary = ai_service.review_risks(
            paragraphs=req.paragraphs,
            contract_type=req.contractType,
            my_role=req.myRole,
            review_focus=req.reviewFocus,
            review_note=req.reviewNote,
        )

        result = ReviewRisksResponse(
            risks=risks,
            aiSummary=ai_summary,
        )

        logger.info(
            f"风险审核完成：{len(risks)} 项风险 "
            f"(high={sum(1 for r in risks if r.riskLevel == 'high')}, "
            f"medium={sum(1 for r in risks if r.riskLevel == 'medium')}, "
            f"low={sum(1 for r in risks if r.riskLevel == 'low')})"
        )
        return ApiResponse(
            success=True,
            data=result.model_dump(),
            message=f"识别 {len(risks)} 项风险",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("风险审核失败")
        return ApiResponse(success=False, error="REVIEW_ERROR", message=str(e))
