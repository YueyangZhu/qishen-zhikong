"""审核报告路由

POST /api/reports/generate-pdf
  接收前端传来的报告快照，调用 reportlab 生成 PDF 二进制流返回。
  前端用 Blob 触发浏览器下载。

POST /api/reports/{report_id}/pdf
  用 Playwright 无头 Chromium 加载前端报告页生成 PDF。
  视觉与网页 100% 一致，文字为真实文本可复制。
  需要前端在 dev server 运行中。
"""
import logging
import urllib.parse
from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import Response
from typing import Optional

from app.schemas.report import GeneratePdfRequest
from app.services.report_pdf_service import report_pdf_service
from app.services.report_html_pdf_service import report_html_pdf_service
from app.auth import get_current_user, AuthUser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reports", tags=["报告"])


def _build_pdf_response(pdf_bytes: bytes, report_no: str) -> Response:
    """构造 PDF 下载响应（中文文件名 RFC 5987 编码 + ASCII 回退）"""
    cn_filename = f"采购合同审核报告_{report_no}.pdf"
    ascii_filename = f"contract_review_report_{report_no}.pdf"
    encoded_filename = urllib.parse.quote(cn_filename)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=\"{ascii_filename}\"; filename*=UTF-8''{encoded_filename}",
            "Content-Length": str(len(pdf_bytes)),
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.post("/generate-pdf")
async def generate_pdf(request: GeneratePdfRequest):
    """生成 PDF 审核报告（reportlab 版，保留兼容）

    请求体包含报告编号、版本号与完整快照。
    返回 PDF 二进制流（Content-Type: application/pdf）。
    """
    try:
        pdf_bytes = report_pdf_service.generate(request)
        return _build_pdf_response(pdf_bytes, request.reportNo)
    except Exception as e:
        logger.exception("生成 PDF 报告失败（reportlab）")
        raise HTTPException(status_code=500, detail=f"生成 PDF 失败：{str(e)}")


@router.get("/{report_id}/pdf")
async def generate_pdf_html(
    report_id: str,
    authorization: Optional[str] = Header(None),
    user: AuthUser = Depends(get_current_user),
):
    """生成 PDF 审核报告（Playwright 版，视觉与网页一致）

    用无头 Chromium 访问前端报告页，调用 page.pdf() 生成真实文本 PDF。
    需要前端 dev server 运行中（默认 http://localhost:5173）。
    """
    # 从 Authorization 头取 token，传给无头浏览器访问受保护页面
    access_token = None
    if authorization and authorization.startswith("Bearer "):
        access_token = authorization[7:].strip()
    if not access_token:
        raise HTTPException(status_code=401, detail="未提供认证 token")
    try:
        # 查询完整用户信息（前端 User 类型需要 id/name/email/role/department/position/avatarColor）
        from app.services.supabase_client import get_supabase
        import json
        sb = get_supabase()
        user_row = sb.table("users").select("*").eq("id", user.business_id).single().execute()
        u = user_row.data or {}
        # 构造前端 User 对象（camelCase）
        frontend_user = {
            "id": u.get("id", user.business_id),
            "name": u.get("name", user.name),
            "email": u.get("email", user.email),
            "role": u.get("role", user.role),
            "department": u.get("department", ""),
            "position": u.get("position", ""),
            "avatarColor": u.get("avatar_color", "#1677ff"),
        }
        user_json = json.dumps(frontend_user, ensure_ascii=False)
        pdf_bytes = await report_html_pdf_service.generate(report_id, access_token, user_json)
        return _build_pdf_response(pdf_bytes, report_id)
    except Exception as e:
        logger.exception(f"生成 PDF 报告失败（Playwright）report_id={report_id}")
        raise HTTPException(status_code=500, detail=f"生成 PDF 失败：{str(e)}")
