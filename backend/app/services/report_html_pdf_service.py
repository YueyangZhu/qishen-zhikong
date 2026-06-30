"""审核报告 PDF 生成服务（Playwright 版，通过 subprocess 调用独立 worker）

为什么用 subprocess 而非直接调 sync_playwright：
uvicorn 主进程的 asyncio 事件循环（Windows ProactorEventLoop）不支持
asyncio.create_subprocess_exec，Playwright 内部启动 Chromium 会失败。
放到独立子进程（report_pdf_worker.py）里跑，子进程有自己的 event loop，
不受 uvicorn 影响。

流程：
1. 后端路由调用 report_html_pdf_service.generate(report_id, access_token)
2. service 启动子进程：python -m app.services.report_pdf_worker <id> <token> <tmp_path>
3. worker 用 Playwright 加载前端报告页 → page.pdf() → 写入临时文件
4. service 读取临时文件返回 PDF 二进制
"""
import logging
import os
import subprocess
import sys
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

# 后端根目录（用于定位 venv python）
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent


class ReportHtmlPdfService:
    """用 Playwright 无头浏览器渲染报告页并生成 PDF"""

    async def generate(self, report_id: str, access_token: str, user_json: str) -> bytes:
        """
        :param report_id: 报告 ID（如 RPT-DEMO-001）
        :param access_token: 调用方的 Supabase JWT，用于无头浏览器访问受保护页面
        :param user_json: 用户信息 JSON（用于注入 localStorage 让前端守卫通过）
        :return: PDF 二进制流
        """
        import asyncio

        # 临时输出文件
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            output_path = tmp.name

        try:
            pdf_bytes = await asyncio.to_thread(
                self._run_worker, report_id, access_token, user_json, output_path
            )
            return pdf_bytes
        finally:
            # 清理临时文件
            try:
                if os.path.exists(output_path):
                    os.remove(output_path)
            except Exception:
                pass

    def _run_worker(self, report_id: str, access_token: str, user_json: str, output_path: str) -> bytes:
        """同步方法：启动子进程跑 worker，返回 PDF 二进制"""
        # 用 venv 的 python（保证有 playwright）
        venv_python = BACKEND_DIR / "venv" / "Scripts" / "python.exe"
        python_exe = str(venv_python) if venv_python.exists() else sys.executable

        cmd = [
            python_exe, "-m", "app.services.report_pdf_worker",
            report_id, access_token, output_path,
        ]

        # user_json 通过环境变量传递（避免命令行参数转义问题）
        env = os.environ.copy()
        env["REPORT_USER_JSON"] = user_json

        logger.info(f"[Playwright] 启动 worker: report_id={report_id}")
        # capture_output 捕获 stderr 用于排查问题
        result = subprocess.run(
            cmd,
            cwd=str(BACKEND_DIR),
            capture_output=True,
            text=True,
            timeout=120,  # 2 分钟超时
            env=env,
        )

        if result.returncode != 0:
            err = result.stderr or result.stdout or "未知错误"
            logger.error(f"[Playwright] worker 失败 (exit={result.returncode}): {err}")
            raise RuntimeError(f"PDF 生成失败：{err[:3000]}")

        # 读取生成的 PDF
        if not os.path.exists(output_path):
            raise RuntimeError(f"PDF 文件未生成: {output_path}")

        with open(output_path, "rb") as f:
            pdf_bytes = f.read()

        logger.info(f"[Playwright] PDF 生成成功: {len(pdf_bytes)} 字节")
        if result.stderr:
            logger.info(f"[Playwright] worker 日志:\n{result.stderr}")

        return pdf_bytes


# 单例
report_html_pdf_service = ReportHtmlPdfService()
