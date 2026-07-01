"""Auth 路由：登录、注册、登出、获取当前用户

前端 authService 调用这些接口完成 Supabase Auth 集成。
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from typing import Optional

from app.services.supabase_client import get_supabase, get_supabase_anon
from app.auth import get_current_user, AuthUser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str
    role: str = "purchaser"  # purchaser / legal / admin
    department: str = ""
    position: str = ""


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    user: dict  # 业务用户信息


@router.post("/login")
async def login(req: LoginRequest):
    """登录：调用 Supabase Auth 验证密码，返回 access_token + 用户信息"""
    sb = get_supabase_anon()
    try:
        resp = sb.auth.sign_in_with_password({
            "email": req.email,
            "password": req.password,
        })
    except Exception as e:
        logger.error(f"登录失败: {e}")
        raise HTTPException(status_code=401, detail=f"登录失败：{e}")

    if not resp.user:
        raise HTTPException(status_code=401, detail="登录失败：用户不存在或密码错误")

    # 查询业务用户信息
    sb_admin = get_supabase()
    user_row = sb_admin.table("users").select("*").eq("email", req.email).maybe_single().execute()
    if not user_row.data:
        raise HTTPException(status_code=403, detail="用户未在业务表中注册")

    # 补写 auth_uid（首次登录）
    u = user_row.data
    if not u.get("auth_uid"):
        sb_admin.table("users").update({"auth_uid": resp.user.id}).eq("id", u["id"]).execute()

    return {
        "access_token": resp.session.access_token,
        "refresh_token": resp.session.refresh_token,
        "user": u,
    }


@router.post("/register")
async def register(req: RegisterRequest):
    """注册：创建 Supabase Auth 用户 + 写入业务用户表

    安全限制：只允许注册 purchaser / legal 角色，admin 必须由现有管理员创建。
    """
    # 角色白名单：禁止通过注册接口创建 admin 账号（防权限提升）
    if req.role not in ('purchaser', 'legal'):
        raise HTTPException(status_code=400, detail="不允许注册此角色账号")
    sb = get_supabase_anon()
    try:
        resp = sb.auth.sign_up({
            "email": req.email,
            "password": req.password,
        })
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"注册失败：{e}")

    if not resp.user:
        raise HTTPException(status_code=400, detail="注册失败：未返回用户信息")

    # 写入业务用户表（用 service_role）
    sb_admin = get_supabase()
    # 生成业务 ID（按角色前缀）
    prefix_map = {"purchaser": "U-P", "legal": "U-L", "admin": "U-A"}
    prefix = prefix_map.get(req.role, "U-X")
    biz_id = f"{prefix}-{resp.user.id[:8].upper()}"

    avatar_colors = {"purchaser": "#1677ff", "legal": "#13c2c2", "admin": "#722ed1"}
    new_user = {
        "id": biz_id,
        "auth_uid": resp.user.id,
        "name": req.name,
        "email": req.email,
        "role": req.role,
        "department": req.department,
        "position": req.position,
        "avatar_color": avatar_colors.get(req.role, "#1677ff"),
    }
    sb_admin.table("users").insert(new_user).execute()

    return {"success": True, "user": new_user, "message": "注册成功，请登录"}


@router.post("/logout")
async def logout(authorization: Optional[str] = Header(None)):
    """登出：撤销当前 token"""
    sb = get_supabase_anon()
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    if token:
        try:
            sb.auth.sign_out(token)
        except Exception:
            pass  # 登出失败不报错
    return {"success": True, "message": "已登出"}


@router.get("/me")
async def get_me(user: AuthUser = Depends(get_current_user)):
    """获取当前登录用户信息"""
    sb = get_supabase()
    user_row = sb.table("users").select("*").eq("id", user.business_id).maybe_single().execute()
    return {"user": user_row.data}


class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/refresh")
async def refresh_token(req: RefreshRequest):
    """刷新 access_token：用 refresh_token 换取新的 access_token

    Supabase access_token 默认 1 小时过期，前端检测到 401 时调用此接口刷新。
    """
    sb = get_supabase_anon()
    try:
        # supabase-py 的 refresh_session 接受 refresh_token 字符串（不是 dict）
        resp = sb.auth.refresh_session(req.refresh_token)
        if not resp.session:
            raise HTTPException(status_code=401, detail="refresh_token 无效或已过期")
        return {
            "access_token": resp.session.access_token,
            "refresh_token": resp.session.refresh_token,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"刷新失败：{e}")
