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

    # 性能计时
    import time as _time
    t0 = _time.time()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright 未安装", file=sys.stderr)
        sys.exit(1)

    print(f"[worker] 开始生成 PDF: report_id={report_id}", file=sys.stderr)
    print(f"[worker] user_json 长度: {len(user_json)}", file=sys.stderr)

    # 下载中文字体到用户字体目录（如果不存在）
    # 关键：Linux 服务器无中文字体时，Chromium 渲染中文会变 (cid:0)
    # 生产环境（Render）已预装字体，通过 SKIP_FONT_DOWNLOAD=1 跳过检查节省时间
    skip_font = os.getenv("SKIP_FONT_DOWNLOAD", "0") == "1"
    if skip_font:
        print("[worker] 跳过字体下载检查（SKIP_FONT_DOWNLOAD=1）", file=sys.stderr)
    else:
        import urllib.request
        import subprocess as _sp
        # 用 ~/.fonts 目录，fontconfig 默认会扫描这里
        font_dir = os.path.expanduser("~/.fonts")
        os.makedirs(font_dir, exist_ok=True)
        font_path = os.path.join(font_dir, "NotoSansSC-Regular.otf")
        if not os.path.exists(font_path):
            font_url = "https://fonts.gstatic.com/s/notosanssc/v26/k3kXo84MPvpLmixcA63oeALhL4iP-Q8.otf"
            print(f"[worker] 下载中文字体: {font_url}", file=sys.stderr)
            try:
                urllib.request.urlretrieve(font_url, font_path)
                print(f"[worker] 字体下载成功: {os.path.getsize(font_path)} 字节", file=sys.stderr)
                # 刷新 fontconfig 缓存
                try:
                    _sp.run(["fc-cache", "-fv", font_dir], capture_output=True, timeout=10)
                    print("[worker] fontconfig 缓存已刷新", file=sys.stderr)
                except Exception as e:
                    print(f"[worker] fc-cache 失败（不影响）: {e}", file=sys.stderr)
            except Exception as e:
                print(f"[worker] 字体下载失败: {e}", file=sys.stderr)
        else:
            print(f"[worker] 字体已存在: {font_path}", file=sys.stderr)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
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

            # 先访问前端域名根路径，注入 localStorage（避免后续 reload）
            try:
                page.goto(frontend_url, wait_until="domcontentloaded", timeout=15_000)
                page.evaluate(
                    "(token) => localStorage.setItem('qszk:auth:accessToken', token)",
                    access_token
                )
                if user_json:
                    page.evaluate(
                        "(u) => localStorage.setItem('qszk:auth:currentUser', u)",
                        user_json
                    )
            except Exception as e:
                print(f"[worker] 预注入 localStorage 失败: {e}", file=sys.stderr)

            print(f"[worker] 加载: {url}", file=sys.stderr)
            # 用 domcontentloaded 加快加载速度（不等图片/字体等资源）
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=15_000)
            except Exception as e:
                print(f"[worker] 首次加载超时: {e}", file=sys.stderr)
            print(f"[worker] 页面加载耗时: {_time.time()-t0:.1f}s", file=sys.stderr)

            # 等待报告正文渲染（10s 超时）
            try:
                page.wait_for_selector(".print-area", timeout=10_000)
            except Exception:
                # 兜底：再 reload 一次
                print("[worker] 首次未找到 .print-area，reload 重试", file=sys.stderr)
                page.reload(wait_until="domcontentloaded", timeout=15_000)
                page.wait_for_selector(".print-area", timeout=10_000)
            print(f"[worker] 报告渲染耗时: {_time.time()-t0:.1f}s", file=sys.stderr)

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
