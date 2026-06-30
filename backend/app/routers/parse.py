"""PDF / DOCX 解析路由"""
import logging
from fastapi import APIRouter, UploadFile, File, HTTPException

from app.services.pdf_service import pdf_service
from app.schemas.review import ParsedDocument
from app.schemas.common import ApiResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["parse"])


@router.post("/parse", response_model=ApiResponse)
async def parse_document(file: UploadFile = File(...)):
    """解析上传的合同文件，返回结构化段落

    支持格式：PDF / DOCX / TXT
    """
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="文件内容为空")

        # 限制文件大小 10MB
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="文件大小超过 10MB 限制")

        filename = file.filename or "contract.pdf"
        parsed = pdf_service.parse(content, filename)

        logger.info(
            f"解析成功：{filename}，共 {len(parsed.paragraphs)} 段，"
            f"{len(parsed.sections)} 节"
        )

        return ApiResponse(
            success=True,
            data=parsed.model_dump(),
            message=f"解析成功：{len(parsed.paragraphs)} 段",
        )
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"解析失败（文件格式问题）：{e}")
        return ApiResponse(success=False, error="PARSE_ERROR", message=str(e))
    except Exception as e:
        logger.exception("解析失败")
        return ApiResponse(success=False, error="PARSE_ERROR", message=f"解析失败：{e}")
