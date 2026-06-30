"""后端配置：从 .env 读取环境变量"""
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置

    优先级：环境变量 > .env 文件 > 默认值
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # DeepSeek API
    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-chat"
    deepseek_base_url: str = "https://api.deepseek.com/v1"

    # Supabase 配置
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""

    # 服务配置
    backend_port: int = 8000
    frontend_origin: str = "http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176,http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175,http://127.0.0.1:5176"
    ai_timeout: int = 120

    # Mock 模式：auto / true / false
    mock_mode: str = "auto"

    @property
    def supabase_configured(self) -> bool:
        """Supabase 是否已配置"""
        return bool(self.supabase_url and self.supabase_service_role_key)

    @property
    def cors_origins(self) -> List[str]:
        """解析 CORS 允许的前端来源列表

        开发模式下放宽：包含 localhost / 127.0.0.1 的 5173-5176 端口，
        覆盖 vite 端口冲突时自动切换的情况。
        """
        return [o.strip() for o in self.frontend_origin.split(",") if o.strip()]

    @property
    def is_mock_mode(self) -> bool:
        """是否使用 Mock 模式

        - mock_mode=true：强制 Mock
        - mock_mode=false：强制真实调用（API Key 缺失会抛错）
        - mock_mode=auto：API Key 为空时自动 Mock
        """
        if self.mock_mode.lower() == "true":
            return True
        if self.mock_mode.lower() == "false":
            return False
        # auto：根据 API Key 是否存在判断
        return not bool(self.deepseek_api_key)


settings = Settings()
