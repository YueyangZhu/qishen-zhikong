@echo off
REM 契审智控后端启动脚本（Windows）
REM 用法：双击 run.bat 或在 backend 目录执行 run.bat

cd /d %~dp0

REM 检查 venv
if not exist venv (
    echo [初始化] 创建虚拟环境...
    python -m venv venv
    call venv\Scripts\activate.bat
    echo [初始化] 安装依赖...
    pip install -r requirements.txt
) else (
    call venv\Scripts\activate.bat
)

REM 检查 .env
if not exist .env (
    echo [警告] 未找到 .env 文件，将使用 Mock 模式
    echo [提示] 复制 .env.example 为 .env 并填入 DEEPSEEK_API_KEY 启用真实 AI
)

REM 启动服务
echo.
echo ====================================
echo   契审智控后端启动中...
echo   API 文档：http://localhost:8000/docs
echo   健康检查：http://localhost:8000/health
echo ====================================
echo.

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

pause
