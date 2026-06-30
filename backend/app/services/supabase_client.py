"""Supabase 客户端初始化

后端使用 service_role key 绕过 RLS，直接操作数据库。
前端传入的 JWT token 仅用于身份验证（识别当前用户）。
"""
import logging
from typing import Optional
from supabase import create_client, Client

from app.config import settings

logger = logging.getLogger(__name__)

# 全局单例（service_role 模式，绕过 RLS）
_supabase_client: Optional[Client] = None


def get_supabase() -> Client:
    """获取 Supabase 客户端（service_role 模式）

    service_role key 拥有完全权限，绕过 RLS。
    仅在后端使用，绝不能暴露给前端。
    """
    global _supabase_client
    if _supabase_client is None:
        if not settings.supabase_configured:
            raise RuntimeError("Supabase 未配置：请在 .env 中设置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY")
        _supabase_client = create_client(
            settings.supabase_url,
            settings.supabase_service_role_key,
        )
        logger.info("Supabase 客户端已初始化（service_role 模式）")
    return _supabase_client


def get_supabase_anon() -> Client:
    """获取 Supabase 客户端（anon 模式）

    用于 Auth 相关操作（signIn/signUp），anon key 受 RLS 保护。
    """
    return create_client(
        settings.supabase_url,
        settings.supabase_anon_key,
    )
