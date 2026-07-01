"""字段抽取路由"""
import logging
from fastapi import APIRouter, HTTPException, Depends

from app.auth import AuthUser, require_role
from app.services.ai_service import ai_service
from app.schemas.review import ExtractFieldsRequest, ExtractFieldsResponse
from app.schemas.common import ApiResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["extract"])


@router.post("/extract-fields", response_model=ApiResponse)
async def extract_fields(req: ExtractFieldsRequest, user: AuthUser = Depends(require_role('purchaser'))):
    """AI 抽取合同字段

    输入：合同段落列表
    输出：抽取的字段数组（含置信度）
    """
    try:
        if not req.paragraphs:
            raise HTTPException(status_code=400, detail="段落列表不能为空")

        fields = ai_service.extract_fields(req.paragraphs)
        result = ExtractFieldsResponse(fields=fields)

        logger.info(f"字段抽取完成：{len(fields)} 个字段")
        return ApiResponse(
            success=True,
            data=result.model_dump(),
            message=f"抽取 {len(fields)} 个字段",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("字段抽取失败")
        return ApiResponse(success=False, error="EXTRACT_ERROR", message=str(e))
