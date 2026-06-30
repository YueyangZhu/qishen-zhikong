"""通用响应模型"""
from typing import Any, Optional
from pydantic import BaseModel


class ApiResponse(BaseModel):
    """统一 API 响应结构"""
    success: bool
    data: Optional[Any] = None
    error: Optional[str] = None
    message: Optional[str] = None


class MockModeInfo(BaseModel):
    """Mock 模式信息（用于前端提示用户当前是否真实 AI）"""
    is_mock: bool
    reason: Optional[str] = None  # Mock 原因（如 API_KEY 未配置）
    model: Optional[str] = None   # 真实模式下的模型名
