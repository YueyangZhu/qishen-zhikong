"""FastAPI 入口

启动方式：
    cd backend
    pip install -r requirements.txt
    uvicorn app.main:app --reload --port 8000

或使用 run.bat
"""
# noqa
import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routers import parse as parse_router
from app.routers import extract as extract_router
from app.routers import review as review_router
from app.routers import report as report_router
from app.routers import data as data_router
from app.routers import auth as auth_router
from app.schemas.review import HealthResponse

# 日志配置
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="契审智控后端",
    description="AI 采购合同审核平台 - FastAPI 后端（PDF 解析 + DeepSeek AI）",
    version="2.0.0",
    docs_url="/docs",       # Swagger UI
    redoc_url="/redoc",     # ReDoc
)

# CORS 配置（开发模式：允许所有 origin，避免 vite 端口切换导致预检失败）
# 生产环境应改为 allow_origins=settings.cors_origins + allow_credentials=True
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,  # 与 allow_origins=["*"] 配合，允许跨域但禁用 cookie
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


# ===== 全局异常处理器 =====
# 把未捕获的异常转成带 CORS 头的 JSON 错误响应，避免 500 被 Chrome CORS 拦截
# 导致前端只看到 "Failed to fetch" 而看不到真实错误
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"未处理异常 [{request.method} {request.url.path}]: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "data": None,
            "message": f"服务器内部错误：{exc}",
            "error": str(exc),
        },
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "*",
        },
    )

# 注册路由
app.include_router(parse_router.router)
app.include_router(extract_router.router)
app.include_router(review_router.router)
app.include_router(report_router.router)
app.include_router(data_router.router)
app.include_router(auth_router.router)


@app.get("/")
async def root():
    """根路径"""
    return {
        "name": "契审智控后端",
        "version": "2.0.0",
        "docs": "/docs",
        "endpoints": ["/api/parse", "/api/extract-fields", "/api/review-risks", "/api/reports/generate-pdf"],
    }


@app.get("/health", response_model=HealthResponse)
async def health():
    """健康检查 + 当前模式（Mock / 真实 AI）"""
    return HealthResponse(
        status="ok",
        is_mock=settings.is_mock_mode,
        model=None if settings.is_mock_mode else settings.deepseek_model,
        reason="DEEPSEEK_API_KEY 未配置，运行在 Mock 模式" if settings.is_mock_mode else None,
        base_url=settings.deepseek_base_url,
    )


@app.on_event("startup")
async def startup_event():
    """启动时打印模式信息"""
    if settings.is_mock_mode:
        logger.warning("⚠ 当前为 Mock 模式（DEEPSEEK_API_KEY 未配置），AI 接口将返回预设数据")
        logger.warning("  配置方法：复制 .env.example 为 .env，填入 DEEPSEEK_API_KEY")
    else:
        logger.info(f"✓ 真实 AI 模式已启用，模型：{settings.deepseek_model}")
