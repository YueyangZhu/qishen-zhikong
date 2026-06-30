"""独立 PDF 生成脚本（由 report_html_pdf_service 通过 subprocess 调用）

为什么用独立脚本：
Playwright 的 sync_api 在 uvicorn 主进程的 asyncio 事件循环里
会触发 NotImplementedError（Windows ProactorEventLoop 不支持 subprocess）。
放到独立子进程里跑，子进程有自己的 event loop，不受 uvicorn 影响。

用法：
    python -m app.services.report_pdf_worker <report_id> <access_token> <output_path>

退出码：
    0 成功（PDF 写入 output_path）
    1 失败（错误信息打到 stderr）
"""
import sys
import os
import logging

# 加载 .env（复用后端配置）
from pathlib import Path
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
try:
    from dotenv import load_dotenv
    load_dotenv(BACKEND_DIR / ".env")
except Exception:
    pass

logger = logging.getLogger(__name__)


def main():
    if len(sys.argv) < 4:
        print("用法: python -m app.services.report_pdf_worker <report_id> <access_token> <output_path>", file=sys.stderr)
        sys.exit(1)

    report_id = sys.argv[1]
    access_token = sys.argv[2]
    output_path = sys.argv[3]
    # user_json 从环境变量读取（避免命令行参数转义问题）
    user_json = os.getenv("REPORT_USER_JSON", "")

    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
    url = f"{frontend_url}/reports/{report_id}?print=1"

    # 配置日志输出到 stderr（stdout 留给结果）
    logging.basicConfig(level=logging.INFO, stream=sys.stderr, format="[worker] %(levelname)s %(message)s")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright 未安装", file=sys.stderr)
        sys.exit(1)

    print(f"[worker] 开始生成 PDF: report_id={report_id}", file=sys.stderr)
    print(f"[worker] user_json 长度: {len(user_json)}", file=sys.stderr)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        try:
            # 构建 localStorage 项：accessToken + currentUser
            local_storage_items = [
                {"name": "qszk:auth:accessToken", "value": access_token},
            ]
            if user_json:
                local_storage_items.append(
                    {"name": "qszk:auth:currentUser", "value": user_json}
                )

            context = browser.new_context(
                extra_http_headers={"Authorization": f"Bearer {access_token}"},
                storage_state={
                    "origins": [
                        {
                            "origin": frontend_url,
                            "localStorage": local_storage_items,
                        }
                    ]
                },
            )
            page = context.new_page()

            print(f"[worker] 加载: {url}", file=sys.stderr)
            page.goto(url, wait_until="domcontentloaded", timeout=30_000)

            # 注入 token + currentUser 后 reload（兜底 storage_state 未生效）
            # 用 evaluate 的参数传递避免字符串插值导致的 JS 语法错误
            page.evaluate(
                "(token) => localStorage.setItem('qszk:auth:accessToken', token)",
                access_token
            )
            if user_json:
                # user_json 已是 JSON 字符串，直接存入 localStorage
                page.evaluate(
                    "(u) => localStorage.setItem('qszk:auth:currentUser', u)",
                    user_json
                )
            page.reload(wait_until="domcontentloaded", timeout=30_000)

            # 等待报告正文渲染
            try:
                page.wait_for_selector(".print-area", timeout=20_000)
            except Exception:
                print("[worker] 首次未找到 .print-area，再次注入 token 重试", file=sys.stderr)
                page.evaluate(
                    "(token) => localStorage.setItem('qszk:auth:accessToken', token)",
                    access_token
                )
                if user_json:
                    page.evaluate(
                        "(u) => localStorage.setItem('qszk:auth:currentUser', u)",
                        user_json
                    )
                page.reload(wait_until="domcontentloaded", timeout=30_000)
                page.wait_for_selector(".print-area", timeout=20_000)

            # 等待 Skeleton 消失
            try:
                page.wait_for_function(
                    "() => !document.querySelector('.ant-skeleton')",
                    timeout=15_000,
                )
            except Exception:
                print("[worker] Skeleton 未消失，继续", file=sys.stderr)

            # 等待网络空闲
            try:
                page.wait_for_load_state("networkidle", timeout=10_000)
            except Exception:
                pass

            # 显式等待 Google Fonts 加载完成（PDF 中文不乱码的关键）
            try:
                page.evaluate("document.fonts.ready")
                page.wait_for_function("document.fonts.status === 'loaded'", timeout=10_000)
            except Exception:
                print("[worker] 字体加载等待超时，继续", file=sys.stderr)
            # 兜底再等 500ms 让字体渲染稳定
            import time
            time.sleep(0.5)

            # 注入打印 CSS
            page.add_style_tag(content="""
                /* 全局字体：用 Noto Sans SC 渲染中文（Linux 服务器无中文字体时关键） */
                * {
                    font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif !important;
                }
                @media print {
                    .no-print { display: none !important; }
                    .report-page-root { max-width: 100% !important; margin: 0 !important; }
                    .main-layout-body { margin: 0 !important; padding: 0 !important; }
                    .ant-layout-content { padding: 0 !important; margin: 0 !important; }
                    .ant-layout { min-height: auto !important; }
                    .print-area {
                        box-shadow: none !important;
                        margin: 0 !important;
                        max-width: 100% !important;
                    }
                    .print-area > .ant-card-body { padding: 32px !important; }
                    * {
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    /* 表格不省略，允许换行 */
                    .ant-table-cell { white-space: normal !important; word-break: break-word !important; max-width: none !important; }
                    .ant-table-cell-content, .ant-typography { white-space: normal !important; }
                    /* 打印时表格自适应页面宽度，移除横向滚动约束，避免内容被截断 */
                    .ant-table-wrapper { overflow: visible !important; }
                    .ant-table-content { overflow: visible !important; overflow-x: visible !important; }
                    .ant-table { width: 100% !important; table-layout: auto !important; overflow: visible !important; }
                    .ant-table-content > table { width: 100% !important; min-width: 0 !important; }
                    /* 移除 ellipsis 截断（打印时显示完整内容） */
                    .ant-table-cell { overflow: visible !important; text-overflow: clip !important; }
                    .ant-typography { overflow: visible !important; }
                    .ant-pagination { display: none !important; }
                    /* 标题紧跟内容：标题后避免分页，但允许表格内部跨页 */
                    h1, h2, h3, h4, h5, .ant-typography-title { break-after: avoid !important; break-inside: avoid !important; }
                    .ant-alert { break-inside: avoid; }
                    .ant-table { break-inside: auto !important; }
                    .ant-table-thead { break-inside: avoid !important; display: table-header-group !important; }
                    .ant-table-row { break-inside: avoid !important; }
                    .ant-card { break-inside: auto !important; }
                }
                .ant-pagination { display: none !important; }
            """)

            # 生成 PDF
            pdf_bytes = page.pdf(
                format="A4",
                print_background=True,
                margin={"top": "10mm", "bottom": "10mm", "left": "10mm", "right": "10mm"},
                display_header_footer=False,
            )

            # 写入文件
            with open(output_path, "wb") as f:
                f.write(pdf_bytes)

            print(f"[worker] PDF 生成成功: {len(pdf_bytes)} 字节 → {output_path}", file=sys.stderr)
            sys.exit(0)
        finally:
            browser.close()


if __name__ == "__main__":
    main()
