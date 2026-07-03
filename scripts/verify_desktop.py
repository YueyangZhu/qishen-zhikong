"""桌面端三栏布局验证脚本：使用 Playwright 截图 1366x768 下的审核详情页。"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

BASE_URL = "http://localhost:5177"
OUTPUT_DIR = Path("d:/TRAE_work_demo/zhinenghetong/docs/screenshots/verify_20260703_")

async def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1366, "height": 768})
        page = await context.new_page()

        # 1. 登录
        await page.goto(f"{BASE_URL}/login")
        await page.wait_for_load_state("networkidle")
        await page.screenshot(path=str(OUTPUT_DIR / "login_page.png"), full_page=False)
        print(f"登录页 URL: {page.url}")
        await page.wait_for_selector("input#email", timeout=15000)
        await page.click("input#email")
        await page.fill("input#email", "purchaser@qszk.com")
        await page.click("input#password")
        await page.fill("input#password", "123456")
        await page.click("button[type='submit']")
        await page.wait_for_url("**/dashboard", timeout=15000)

        # 2. 进入合同审核列表
        await page.goto(f"{BASE_URL}/reviews")
        await page.wait_for_selector("tr[data-row-key='RVT-DEMO-001']", timeout=15000)

        # 3. 进入详情页（点击操作列的「详情」按钮）
        await page.locator("tr[data-row-key='RVT-DEMO-001'] button:has-text('详情')").click()
        await page.wait_for_url("**/reviews/RVT-DEMO-001", timeout=15000)

        # 等待风险卡片渲染完成（骨架屏消失）
        await page.locator("[id^='risk-card-']").first.wait_for(state="visible", timeout=20000)
        # 等待至少 18 张风险卡片
        await page.wait_for_selector("[id^='risk-card-']", timeout=20000)
        await page.wait_for_timeout(500)
        risk_count = await page.locator("[id^='risk-card-']").count()
        print(f"风险卡片总数: {risk_count}")

        # 4. 截图：三栏全貌
        await page.screenshot(path=str(OUTPUT_DIR / "desktop_three_column_full.png"), full_page=False)

        # 5. 检查三栏是否存在（通过 JS 按结构定位）
        panels = await page.evaluate("""() => {
            const leftCard = Array.from(document.querySelectorAll('.ant-card')).find(
                c => c.querySelector('.ant-card-head-title')?.textContent.includes('合同结构')
            );
            const middleCard = document.querySelector('[data-paragraph-id]')?.closest('.ant-card');
            const firstRisk = document.querySelector('[id^="risk-card-"]');
            const rightCol = firstRisk ? firstRisk.closest('div[style*="flex-direction: column"]') || firstRisk.parentElement : null;
            const toBox = (el) => el ? el.getBoundingClientRect().toJSON() : null;
            return { left: toBox(leftCard), middle: toBox(middleCard), right: toBox(rightCol) };
        }""")
        left, middle, right = panels['left'], panels['middle'], panels['right']
        print(f"左栏合同结构: {left}")
        print(f"中栏合同正文: {middle}")
        print(f"右栏 AI 审核结果: {right}")

        # 断言三栏在桌面端水平排列且不重叠
        assert left and middle and right, "三栏未全部渲染"
        assert left['x'] < middle['x'] < right['x'], "三栏未按左中右顺序排列"
        assert middle['x'] > left['x'] + left['width'], "中栏与左栏重叠"
        assert right['x'] > middle['x'] + middle['width'], "右栏与中栏重叠"

        # 6. 检查正文区域独立滚动
        body_scroll_before = await page.evaluate(
            "() => document.querySelector('[data-paragraph-id=\"p1\"]')?.parentElement?.scrollTop || 0"
        )
        await page.evaluate("() => window.scrollBy(0, 300)")
        await page.wait_for_timeout(500)
        body_scroll_after = await page.evaluate(
            "() => document.querySelector('[data-paragraph-id=\"p1\"]')?.parentElement?.scrollTop || 0"
        )
        print(f"页面滚动前后正文 scrollTop: {body_scroll_before} -> {body_scroll_after}")
        assert body_scroll_before == body_scroll_after, "页面滚动时正文区域发生了联动滚动"

        # 7. 在正文区域滚动
        await page.hover("[data-paragraph-id='p1']")
        await page.mouse.wheel(0, 300)
        await page.wait_for_timeout(500)
        body_scroll_final = await page.evaluate(
            "() => document.querySelector('[data-paragraph-id=\"p1\"]')?.parentElement?.scrollTop || 0"
        )
        print(f"正文区域滚动后 scrollTop: {body_scroll_final}")
        assert body_scroll_final > body_scroll_before, "在正文区域滚动未生效"

        # 8. 截图各栏（使用 clip 按 bounding box 截取）
        def clip(box):
            return {"x": box["x"], "y": box["y"], "width": box["width"], "height": box["height"]}
        await page.screenshot(path=str(OUTPUT_DIR / "desktop_left_panel.png"), clip=clip(left))
        await page.screenshot(path=str(OUTPUT_DIR / "desktop_middle_panel.png"), clip=clip(middle))
        await page.screenshot(path=str(OUTPUT_DIR / "desktop_right_panel.png"), clip=clip(right))

        # 9. 检查风险顺序（前 5 条）
        risks = await page.locator("[id^='risk-card-']").all()
        print("\n前 5 条风险顺序:")
        for i, r in enumerate(risks[:5]):
            title = await r.locator(".ant-typography").first.text_content()
            # 定位「条款：X Y」所在的父 span（避免内部 Text 子元素也匹配）
            clause_spans = await r.locator("span:has(> span:has-text('条款：'))").all_text_contents()
            clause = clause_spans[0] if clause_spans else ""
            print(f"#{i+1}: {title.strip()} | {clause.strip()}")

        # 10. 检查合同结构章节（不应出现虚假章节）
        section_items = await page.locator(".ant-card:has(.ant-card-head-title:has-text('合同结构')) .ant-card-body > div > div").all_text_contents()
        section_texts = [s.strip() for s in section_items if s.strip()]
        print(f"\n合同结构章节 ({len(section_texts)} 个):")
        for s in section_texts[:8]:
            print(f"  - {s[:40]}")

        # 断言没有虚假章节
        fake_keywords = ["首部", "签署落款", "合同首部"]
        for text in section_texts:
            for kw in fake_keywords:
                assert kw not in text, f"发现虚假章节: {text}"

        await browser.close()
        print("\n✅ 桌面端三栏布局验证通过")

if __name__ == "__main__":
    asyncio.run(main())
