"""鉴权依赖：验证前端传来的 JWT token，识别当前用户

使用方式（在路由中）：
    from app.auth import get_current_user

    @router.get("/tasks")
    async def list_tasks(user: AuthUser = Depends(get_current_user)):
        ...
"""
import logging
from typing import Optional
from fastapi import Depends, HTTPException, Header
from pydantic import BaseModel

from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)


class AuthUser(BaseModel):
    """当前登录用户（从 JWT 解析）"""
    uid: str            # Supabase Auth user id (UUID)
    email: str
    business_id: str    # 业务用户 ID（如 U-PURCHASER），从 users 表查询
    name: str
    role: str           # purchaser / legal / admin


def _extract_token(authorization: Optional[str]) -> Optional[str]:
    """从 Authorization 头提取 Bearer token"""
    if not authorization:
        return None
    if not authorization.startswith("Bearer "):
        return None
    return authorization[7:].strip()


async def get_current_user(authorization: Optional[str] = Header(None)) -> AuthUser:
    """验证 JWT token 并返回当前用户信息

    前端必须在请求头中携带：Authorization: Bearer <access_token>

    流程：
    1. 从 Authorization 头提取 token
    2. 用 Supabase service_role 验证 token（auth.get_user）
    3. 根据 auth_uid 查询 users 表，获取业务用户信息
    """
    token = _extract_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="未提供认证 token")

    try:
        sb = get_supabase()
        # 用 token 验证用户身份（service_role 也可以用 auth.get_user）
        resp = sb.auth.get_user(token)
        auth_user = resp.user
        if not auth_user:
            raise HTTPException(status_code=401, detail="无效的认证 token")

        # 根据 auth_uid 查询业务用户
        user_row = sb.table("users").select("*").eq("auth_uid", auth_user.id).single().execute()
        if not user_row.data:
            # 兼容：用 email 查询（迁移旧数据时 auth_uid 可能为空）
            user_row = sb.table("users").select("*").eq("email", auth_user.email).single().execute()
            if not user_row.data:
                raise HTTPException(status_code=403, detail="用户未在业务表中注册")

        u = user_row.data
        # 如果 auth_uid 为空，补写一次
        if not u.get("auth_uid"):
            sb.table("users").update({"auth_uid": auth_user.id}).eq("id", u["id"]).execute()

        return AuthUser(
            uid=auth_user.id,
            email=auth_user.email or u["email"],
            business_id=u["id"],
            name=u["name"],
            role=u["role"],
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"鉴权失败: {e}")
        raise HTTPException(status_code=401, detail=f"认证失败: {e}")


async def get_optional_user(authorization: Optional[str] = Header(None)) -> Optional[AuthUser]:
    """可选鉴权：未登录返回 None（用于健康检查等公开接口）"""
    try:
        return await get_current_user(authorization)
    except HTTPException:
        return None
