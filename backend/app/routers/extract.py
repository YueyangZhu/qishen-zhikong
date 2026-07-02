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
        logger.exception("字段抽取失败，降级返回兜底字段")
        # 兜底：AI 抽取失败时返回基础字段，避免前端 40% 处卡住或闪烁失败提示
        fallback_fields = [
            {"fieldKey": "contractName", "fieldLabel": "合同名称", "fieldValue": "未识别", "confidence": 0.5, "lowConfidence": True, "sourceText": "AI 抽取失败，使用兜底值"},
            {"fieldKey": "buyer", "fieldLabel": "甲方", "fieldValue": "未识别", "confidence": 0.5, "lowConfidence": True, "sourceText": "AI 抽取失败，使用兜底值"},
            {"fieldKey": "seller", "fieldLabel": "乙方", "fieldValue": "未识别", "confidence": 0.5, "lowConfidence": True, "sourceText": "AI 抽取失败，使用兜底值"},
            {"fieldKey": "amount", "fieldLabel": "合同金额", "fieldValue": "0", "confidence": 0.5, "lowConfidence": True, "sourceText": "AI 抽取失败，使用兜底值"},
            {"fieldKey": "contractNo", "fieldLabel": "合同编号", "fieldValue": "未识别", "confidence": 0.5, "lowConfidence": True, "sourceText": "AI 抽取失败，使用兜底值"},
        ]
        return ApiResponse(
            success=True,
            data={"fields": fallback_fields},
            message=f"字段抽取异常，已降级返回 {len(fallback_fields)} 个基础字段：{e}",
        )
