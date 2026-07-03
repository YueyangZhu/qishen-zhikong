"""数据 CRUD 路由

为前端 db.ts 提供统一的数据访问接口。
所有接口需要 JWT 鉴权（除 /api/data/seed 用于初始化）。

接口列表：
- GET    /api/data/users              获取用户列表
- GET    /api/data/tasks              获取任务列表
- GET    /api/data/tasks/{id}         获取单个任务
- POST   /api/data/tasks              创建/更新任务（upsert）
- DELETE /api/data/tasks/{id}         删除任务（级联）
- GET    /api/data/risks              获取风险列表（?task_id=xxx）
- POST   /api/data/risks              upsert 风险
- POST   /api/data/risks/batch        批量保存风险（覆盖式）
- GET    /api/data/fields             获取字段列表（?task_id=xxx）
- POST   /api/data/fields             upsert 字段
- POST   /api/data/fields/batch       批量保存字段（覆盖式）
- GET    /api/data/reports            获取报告列表
- GET    /api/data/reports/{id}       获取单个报告
- POST   /api/data/reports            upsert 报告
- GET    /api/data/rules             获取规则列表
- GET    /api/data/rules/{id}         获取单个规则
- POST   /api/data/rules              upsert 规则
- DELETE /api/data/rules/{id}         删除规则（级联版本）
- GET    /api/data/rule-versions      获取规则版本（?rule_id=xxx）
- POST   /api/data/rule-versions      添加规则版本
- GET    /api/data/audit-logs         获取审计日志（?task_id=xxx）
- POST   /api/data/audit-logs         添加审计日志
- GET    /api/data/documents/{task_id}  获取合同文档
- POST   /api/data/documents          upsert 合同文档
- POST   /api/data/documents/{task_id}/upload   上传合同原文件
- GET    /api/data/documents/{task_id}/download  下载合同原文件
- POST   /api/data/seed               初始化种子数据
- GET    /api/data/db-health          数据库连接检查
"""
import logging
import uuid
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Query, Body, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel

from app.auth import get_current_user, AuthUser, require_role
from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/data", tags=["data"])


# ===== 通用响应 =====
def _ok(data: Any = None, message: Optional[str] = None):
    return {"success": True, "data": data, "message": message, "error": None}


def _err(message: str, data: Any = None):
    return {"success": False, "data": data, "message": message, "error": message}


def _now_iso() -> str:
    """当前 UTC 时间 ISO 字符串（Supabase TIMESTAMPTZ 存储）"""
    return datetime.now(timezone.utc).isoformat()


def _to_json_safe(obj: Any) -> Any:
    """转换 Supabase 返回的数据为 JSON 安全格式（处理 datetime/Decimal）"""
    if obj is None:
        return None
    if isinstance(obj, list):
        return [_to_json_safe(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _to_json_safe(v) for k, v in obj.items()}
    # datetime / Decimal 等会由 FastAPI 的 jsonable_encoder 自动处理
    return obj


# ===== 通用 upsert 请求体 =====
class UpsertRequest(BaseModel):
    """通用 upsert 请求：data 是完整实体对象（含 id）"""
    data: dict


class BatchSaveRequest(BaseModel):
    """批量保存请求：覆盖式写入某 task 下的所有记录"""
    items: list[dict]


# ===== 1. Users =====
@router.get("/users")
async def list_users(user: AuthUser = Depends(get_current_user)):
    """获取用户列表"""
    sb = get_supabase()
    resp = sb.table("users").select("*").order("created_at").execute()
    return _ok(_to_json_safe(resp.data))


# ===== 2. Tasks =====
@router.get("/tasks")
async def list_tasks(user: AuthUser = Depends(get_current_user)):
    """获取审核任务列表（按创建时间倒序）"""
    sb = get_supabase()
    resp = sb.table("review_tasks").select("*").order("created_at", desc=True).execute()
    return _ok(_to_json_safe(resp.data))


@router.get("/tasks/{task_id}")
async def get_task(task_id: str, user: AuthUser = Depends(get_current_user)):
    """获取单个任务"""
    sb = get_supabase()
    resp = sb.table("review_tasks").select("*").eq("id", task_id).maybe_single().execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="任务不存在")
    return _ok(_to_json_safe(resp.data))


@router.post("/tasks")
async def upsert_task(req: UpsertRequest, user: AuthUser = Depends(require_role('purchaser', 'legal'))):
    """创建/更新任务（upsert by id）"""
    sb = get_supabase()
    data = _to_db_row(req.data, "review_tasks")
    resp = sb.table("review_tasks").upsert(data).execute()
    return _ok(_to_json_safe(resp.data[0] if resp.data else None))


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, user: AuthUser = Depends(require_role('purchaser'))):
    """删除任务（级联删除 risks/fields/audit_logs/documents，由 FK ON DELETE CASCADE 处理）"""
    sb = get_supabase()
    sb.table("review_tasks").delete().eq("id", task_id).execute()
    return _ok(message="已删除")


# ===== 3. Risks =====
@router.get("/risks")
async def list_risks(
    task_id: Optional[str] = Query(None),
    user: AuthUser = Depends(get_current_user),
):
    """获取风险列表（可按 task_id 过滤）"""
    sb = get_supabase()
    q = sb.table("risks").select("*")
    if task_id:
        q = q.eq("review_task_id", task_id)
    resp = q.order("created_at").execute()
    return _ok(_to_json_safe(resp.data))


@router.post("/risks")
async def upsert_risk(req: UpsertRequest, user: AuthUser = Depends(require_role('purchaser', 'legal'))):
    """upsert 单个风险"""
    sb = get_supabase()
    data = _to_db_row(req.data, "risks")
    resp = sb.table("risks").upsert(data).execute()
    return _ok(_to_json_safe(resp.data[0] if resp.data else None))


@router.post("/risks/batch")
async def batch_save_risks(req: BatchSaveRequest, user: AuthUser = Depends(require_role('purchaser', 'legal'))):
    """批量保存风险（覆盖式：先删后插）

    注意：Supabase 客户端 insert 在某些约束违反时会静默返回空 data（不抛异常），
    因此必须显式检查返回数据长度，避免"先删后插失败"导致风险被删但没插入。
    """
    sb = get_supabase()
    if not req.items:
        return _ok([])
    task_id = req.items[0].get("reviewTaskId") or req.items[0].get("review_task_id")
    if task_id:
        sb.table("risks").delete().eq("review_task_id", task_id).execute()
        logger.info(f"[batch_save_risks] 已删除 task_id={task_id} 的旧风险")
    rows = [_to_db_row(item, "risks") for item in req.items]
    logger.info(f"[batch_save_risks] 准备插入 {len(rows)} 条风险，task_id={task_id}")
    try:
        resp = sb.table("risks").insert(rows).execute()
    except Exception as e:
        logger.error(f"[batch_save_risks] insert 抛异常: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"风险批量插入失败：{e}")
    # 关键：检查返回数据长度，防止静默失败（约束违反时 data 为空但不抛异常）
    if not resp.data or len(resp.data) < len(rows):
        logger.error(
            f"[batch_save_risks] 插入失败或部分失败：期望 {len(rows)} 条，实际 {len(resp.data) if resp.data else 0} 条"
        )
        raise HTTPException(
            status_code=500,
            detail=f"风险批量插入失败：期望 {len(rows)} 条，实际 {len(resp.data) if resp.data else 0} 条（可能存在枚举值不匹配或约束违反）",
        )
    logger.info(f"[batch_save_risks] 成功插入 {len(resp.data)} 条风险")
    return _ok(_to_json_safe(resp.data))


# ===== 4. Fields =====
@router.get("/fields")
async def list_fields(
    task_id: Optional[str] = Query(None),
    user: AuthUser = Depends(get_current_user),
):
    """获取字段列表"""
    sb = get_supabase()
    q = sb.table("extracted_fields").select("*")
    if task_id:
        q = q.eq("review_task_id", task_id)
    resp = q.order("id").execute()
    return _ok(_to_json_safe(resp.data))


@router.post("/fields")
async def upsert_field(req: UpsertRequest, user: AuthUser = Depends(require_role('purchaser'))):
    """upsert 单个字段"""
    sb = get_supabase()
    data = _to_db_row(req.data, "extracted_fields")
    resp = sb.table("extracted_fields").upsert(data).execute()
    return _ok(_to_json_safe(resp.data[0] if resp.data else None))


@router.post("/fields/batch")
async def batch_save_fields(req: BatchSaveRequest, user: AuthUser = Depends(require_role('purchaser'))):
    """批量保存字段（覆盖式：先删后插，同 batch_save_risks 的保护逻辑）"""
    sb = get_supabase()
    if not req.items:
        return _ok([])
    task_id = req.items[0].get("reviewTaskId") or req.items[0].get("review_task_id")
    if task_id:
        sb.table("extracted_fields").delete().eq("review_task_id", task_id).execute()
    rows = [_to_db_row(item, "extracted_fields") for item in req.items]
    try:
        resp = sb.table("extracted_fields").insert(rows).execute()
    except Exception as e:
        logger.error(f"[batch_save_fields] insert 抛异常: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"字段批量插入失败：{e}")
    if not resp.data or len(resp.data) < len(rows):
        logger.error(
            f"[batch_save_fields] 插入失败或部分失败：期望 {len(rows)} 条，实际 {len(resp.data) if resp.data else 0} 条"
        )
        raise HTTPException(
            status_code=500,
            detail=f"字段批量插入失败：期望 {len(rows)} 条，实际 {len(resp.data) if resp.data else 0} 条",
        )
    return _ok(_to_json_safe(resp.data))


# ===== 5. Documents =====
@router.get("/documents/{task_id}")
async def get_document(task_id: str, user: AuthUser = Depends(get_current_user)):
    """获取合同文档（按 taskId 索引）"""
    sb = get_supabase()
    resp = sb.table("parsed_documents").select("*").eq("review_task_id", task_id).maybe_single().execute()
    return _ok(_to_json_safe(resp.data))


@router.post("/documents")
async def upsert_document(req: UpsertRequest, user: AuthUser = Depends(require_role('purchaser'))):
    """upsert 合同文档"""
    sb = get_supabase()
    data = _to_db_row(req.data, "parsed_documents")
    resp = sb.table("parsed_documents").upsert(data).execute()
    return _ok(_to_json_safe(resp.data[0] if resp.data else None))


@router.post("/documents/{task_id}/upload")
async def upload_contract_file(
    task_id: str,
    file: UploadFile = File(...),
    user: AuthUser = Depends(require_role('purchaser')),
):
    """上传合同原文件到 Supabase Storage"""
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="文件内容为空")
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件大小超过 10MB")

    filename = file.filename or "contract.bin"
    storage_path = f"{task_id}/{filename}"

    sb = get_supabase()
    try:
        sb.storage.from_("contract_files").upload(storage_path, content)
    except Exception as e:
        err_msg = str(e).lower()
        if "already exists" in err_msg or "duplicate" in err_msg:
            sb.storage.from_("contract_files").update(storage_path, content)
        else:
            try:
                sb.storage.create_bucket("contract_files", {"public": False})
                sb.storage.from_("contract_files").upload(storage_path, content)
            except Exception as create_err:
                logger.error(f"创建或上传文件失败: {create_err}")
                raise HTTPException(status_code=500, detail=f"上传文件失败: {create_err}")

    sb.table("review_tasks").update({
        "file_name": filename,
        "file_size": len(content),
    }).eq("id", task_id).execute()

    return _ok(message=f"文件已上传: {filename}")


@router.get("/documents/{task_id}/download")
async def download_contract_file(
    task_id: str,
    user: AuthUser = Depends(get_current_user),
):
    """下载合同原文件"""
    sb = get_supabase()
    resp = sb.table("review_tasks").select("file_name").eq("id", task_id).maybe_single().execute()
    if not resp.data or not resp.data.get("file_name"):
        raise HTTPException(status_code=404, detail="文件不存在或尚未上传")

    filename = resp.data["file_name"]
    storage_path = f"{task_id}/{filename}"

    try:
        file_bytes = sb.storage.from_("contract_files").download(storage_path)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"文件下载失败: {e}")

    # 根据文件名推断 content-type
    content_type = "application/octet-stream"
    name_lower = filename.lower()
    if name_lower.endswith(".pdf"):
        content_type = "application/pdf"
    elif name_lower.endswith(".docx"):
        content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    elif name_lower.endswith(".doc"):
        content_type = "application/msword"
    elif name_lower.endswith(".txt"):
        content_type = "text/plain"

    encoded_filename = urllib.parse.quote(filename)
    return Response(
        content=file_bytes,
        media_type=content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"; filename*=UTF-8\'\'{encoded_filename}',
            "Content-Length": str(len(file_bytes)),
        },
    )


# ===== 6. Reports =====
@router.get("/reports")
async def list_reports(user: AuthUser = Depends(get_current_user)):
    """获取报告列表"""
    sb = get_supabase()
    resp = sb.table("reports").select("*").order("created_at", desc=True).execute()
    return _ok(_to_json_safe(resp.data))


@router.get("/reports/{report_id}")
async def get_report(report_id: str, user: AuthUser = Depends(get_current_user)):
    """获取单个报告"""
    sb = get_supabase()
    resp = sb.table("reports").select("*").eq("id", report_id).maybe_single().execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="报告不存在")
    return _ok(_to_json_safe(resp.data))


@router.post("/reports")
async def upsert_report(req: UpsertRequest, user: AuthUser = Depends(require_role('legal', 'admin'))):
    """upsert 报告"""
    sb = get_supabase()
    data = _to_db_row(req.data, "reports")
    resp = sb.table("reports").upsert(data).execute()
    return _ok(_to_json_safe(resp.data[0] if resp.data else None))


# ===== 7. Rules =====
@router.get("/rules")
async def list_rules(user: AuthUser = Depends(get_current_user)):
    """获取规则列表"""
    sb = get_supabase()
    resp = sb.table("rules").select("*").order("updated_at", desc=True).execute()
    return _ok(_to_json_safe(resp.data))


@router.get("/rules/{rule_id}")
async def get_rule(rule_id: str, user: AuthUser = Depends(get_current_user)):
    """获取单个规则"""
    sb = get_supabase()
    resp = sb.table("rules").select("*").eq("id", rule_id).maybe_single().execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="规则不存在")
    return _ok(_to_json_safe(resp.data))


@router.post("/rules")
async def upsert_rule(req: UpsertRequest, user: AuthUser = Depends(require_role('admin', 'legal'))):
    """upsert 规则"""
    sb = get_supabase()
    data = _to_db_row(req.data, "rules")
    resp = sb.table("rules").upsert(data).execute()
    return _ok(_to_json_safe(resp.data[0] if resp.data else None))


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: str, user: AuthUser = Depends(require_role('admin', 'legal'))):
    """删除规则（级联删除 rule_versions）"""
    sb = get_supabase()
    sb.table("rules").delete().eq("id", rule_id).execute()
    return _ok(message="已删除")


# ===== 8. Rule Versions =====
@router.get("/rule-versions")
async def list_rule_versions(
    rule_id: str = Query(...),
    user: AuthUser = Depends(get_current_user),
):
    """获取规则历史版本（按 version 倒序）"""
    sb = get_supabase()
    resp = sb.table("rule_versions").select("*").eq("rule_id", rule_id).order("version", desc=True).execute()
    return _ok(_to_json_safe(resp.data))


@router.post("/rule-versions")
async def add_rule_version(req: UpsertRequest, user: AuthUser = Depends(require_role('admin', 'legal'))):
    """添加规则版本记录（自动生成 id 和 created_at）"""
    sb = get_supabase()
    data = _to_db_row(req.data, "rule_versions")
    if not data.get("id"):
        data["id"] = f"RV-{uuid.uuid4().hex[:12].upper()}"
    if not data.get("created_at"):
        data["created_at"] = _now_iso()
    resp = sb.table("rule_versions").insert(data).execute()
    return _ok(_to_json_safe(resp.data[0] if resp.data else None))


# ===== 9. Audit Logs =====
@router.get("/audit-logs")
async def list_audit_logs(
    task_id: Optional[str] = Query(None),
    user: AuthUser = Depends(get_current_user),
):
    """获取审计日志"""
    sb = get_supabase()
    q = sb.table("audit_logs").select("*")
    if task_id:
        q = q.eq("review_task_id", task_id)
    resp = q.order("created_at").execute()
    return _ok(_to_json_safe(resp.data))


@router.post("/audit-logs")
async def add_audit_log(req: UpsertRequest, user: AuthUser = Depends(get_current_user)):
    """添加审计日志（自动生成 id 和 created_at，前端不传这两个字段）"""
    sb = get_supabase()
    data = _to_db_row(req.data, "audit_logs")
    if not data.get("id"):
        data["id"] = f"LOG-{uuid.uuid4().hex[:12].upper()}"
    if not data.get("created_at"):
        data["created_at"] = _now_iso()
    resp = sb.table("audit_logs").insert(data).execute()
    return _ok(_to_json_safe(resp.data[0] if resp.data else None))


# ===== 字段名转换（camelCase → snake_case）=====
def _to_db_row(data: dict, table: str) -> dict:
    """将前端的 camelCase 字段名转为数据库的 snake_case

    根据 schema.sql 的列定义进行映射。
    未知字段会被丢弃，避免 Supabase 报列不存在错误。
    """
    # 前端临时字段，不写入数据库（避免列不存在导致 500）
    _DROP_FIELDS = {"realAI"}

    # 通用字段名映射表（camelCase → snake_case）
    key_map = {
        # common
        "reviewTaskId": "review_task_id",
        "createdAt": "created_at",
        "updatedAt": "updated_at",
        "completedAt": "completed_at",
        "submittedAt": "submitted_at",
        # task
        "contractId": "contract_id",
        "contractName": "contract_name",
        "contractNo": "contract_no",
        "contractType": "contract_type",
        "myRole": "my_role",
        "reviewFocus": "review_focus",
        "reviewNote": "review_note",
        "fileName": "file_name",
        "fileSize": "file_size",
        "sampleId": "sample_id",
        "creatorId": "creator_id",
        "creatorName": "creator_name",
        "riskLevelMax": "risk_level_max",
        "riskCount": "risk_count",
        "currentStage": "current_stage",
        "errorCode": "error_code",
        "errorMsg": "error_msg",
        "fieldsConfirmed": "fields_confirmed",
        "legalOpinion": "legal_opinion",
        "legalConclusion": "legal_conclusion",
        "legalReviewerId": "legal_reviewer_id",
        "legalReviewerName": "legal_reviewer_name",
        # risk
        "riskType": "risk_type",
        "riskLevel": "risk_level",
        "clauseNumber": "clause_number",
        "clauseTitle": "clause_title",
        "originalText": "original_text",
        "paragraphId": "paragraph_id",
        "startPosition": "start_position",
        "endPosition": "end_position",
        "riskReason": "risk_reason",
        "reviewBasis": "review_basis",
        "editedSuggestion": "edited_suggestion",
        "sourceType": "source_type",
        "ruleId": "rule_id",
        "handleComment": "handle_comment",
        "ignoreReason": "ignore_reason",
        # audit log
        "objectType": "object_type",
        "objectId": "object_id",
        "operatorId": "operator_id",
        "operatorName": "operator_name",
        "beforeState": "before_state",
        "afterState": "after_state",
        # field
        "fieldKey": "field_key",
        "fieldLabel": "field_label",
        "fieldValue": "field_value",
        "confirmedValue": "confirmed_value",
        "lowConfidence": "low_confidence",
        "sourceText": "source_text",
        # report
        "reportNo": "report_no",
        "versionNo": "version_no",
        # rule
        "triggerCondition": "trigger_condition",
        "reasonTemplate": "reason_template",
        "suggestionTemplate": "suggestion_template",
        # rule version
        "changeNote": "change_note",
        # user
        "authUid": "auth_uid",
        "avatarColor": "avatar_color",
        # document
        "fullText": "full_text",
        "taskId": "review_task_id",  # documents 用 review_task_id 作主键
    }
    result = {}
    for k, v in data.items():
        if k in _DROP_FIELDS:
            continue
        new_key = key_map.get(k, k)
        result[new_key] = v
    return result


# ===== 数据库健康检查 =====
@router.get("/db-health")
async def db_health():
    """数据库连接检查（无需鉴权）"""
    try:
        sb = get_supabase()
        sb.table("users").select("id").limit(1).execute()
        return {"status": "ok", "supabase_configured": True}
    except Exception as e:
        return {"status": "error", "message": str(e), "supabase_configured": False}


# ===== 种子数据初始化 =====
@router.post("/seed")
async def seed_data():
    """重置演示数据：清空所有表，重新插入种子数据"""
    import importlib.util

    seed_path = Path(__file__).resolve().parent.parent.parent / "supabase" / "seed.py"
    if not seed_path.exists():
        raise HTTPException(status_code=500, detail=f"seed.py 不存在: {seed_path}")

    spec = importlib.util.spec_from_file_location("seed_module", str(seed_path))
    seed_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(seed_module)

    sb = get_supabase()
    try:
        seed_module.seed_users(sb)
        seed_module.seed_rules(sb)
        seed_module.seed_tasks(sb)
        seed_module.seed_risks(sb)
        seed_module.seed_fields(sb)
        seed_module.seed_reports(sb)
        return _ok(message="种子数据初始化完成")
    except Exception as e:
        logger.error(f"种子数据初始化失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"种子数据初始化失败: {e}")
