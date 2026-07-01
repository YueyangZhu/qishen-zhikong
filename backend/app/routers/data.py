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
- POST   /api/data/seed               初始化种子数据
- GET    /api/data/db-health          数据库连接检查
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional, Any
from fastapi import APIRouter, Depends, HTTPException, Query, Body
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
async def upsert_task(req: UpsertRequest, user: AuthUser = Depends(require_role('purchaser'))):
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
    """批量保存风险（覆盖式：先删后插）"""
    sb = get_supabase()
    if not req.items:
        return _ok([])
    task_id = req.items[0].get("reviewTaskId") or req.items[0].get("review_task_id")
    if task_id:
        sb.table("risks").delete().eq("review_task_id", task_id).execute()
    rows = [_to_db_row(item, "risks") for item in req.items]
    resp = sb.table("risks").insert(rows).execute()
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
    """批量保存字段（覆盖式）"""
    sb = get_supabase()
    if not req.items:
        return _ok([])
    task_id = req.items[0].get("reviewTaskId") or req.items[0].get("review_task_id")
    if task_id:
        sb.table("extracted_fields").delete().eq("review_task_id", task_id).execute()
    rows = [_to_db_row(item, "extracted_fields") for item in req.items]
    resp = sb.table("extracted_fields").insert(rows).execute()
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
    """
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
        # audit
        "objectType": "object_type",
        "objectId": "object_id",
        "operatorId": "operator_id",
        "operatorName": "operator_name",
        "beforeState": "before_state",
        "afterState": "after_state",
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
