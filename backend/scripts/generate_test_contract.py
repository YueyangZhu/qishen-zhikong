"""
生成可验证的测试合同 PDF + TXT
- 包含大量可被规则引擎关键词匹配到的风险条款
- PDF 用于上传测试规则引擎
- TXT 作为降级选项（确保文字可被后端解析）
- 同时输出 backend/test_contract_验证合同.txt (UTF-8)

用法：
    cd backend
    .\venv\Scripts\python.exe scripts\generate_test_contract.py
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

OUTPUT_PDF = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "test-contract.pdf"))
OUTPUT_TXT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "test-contract.txt"))

# ===== 合同正文（同时用于 PDF 和 TXT） =====
CONTRACT_SECTIONS = [
    ("合同封面", [
        "采购合同",
        "",
        "合同编号：HT-YZ-2026-VALID-001    签订日期：2026年7月1日",
        "采购方（甲方）：智远科技有限公司",
        "供应方（乙方）：星河软件有限公司",
        "合同金额：人民币 580,000.00 元（大写：伍拾捌万捌仟元整）",
        "币种：人民币（CNY）",
        "争议管辖：乙方所在地法院",
    ]),

    ("第一条  合同主体", [
        "甲方（采购方）：智远科技有限公司，法定代表人：张智远，统一社会信用代码：91440101MA5XXXXXXX，注册地址：北京市海淀区中关村大街1号。",
        "乙方（供应方）：星河软件有限公司，法定代表人：刘星河，统一社会信用代码：未提供，联系地址：未提供。",
        # ↑ RR-001 命中：统一社会信用代码缺失、联系地址缺失
    ]),

    ("第二条  合同标的与范围", [
        "甲方同意向乙方采购企业资源计划（ERP）管理系统一套，包括系统软件、数据库配置、接口开发及三年运维服务。具体功能模块与技术规格详见本合同附件。",
        "乙方应于合同签署后尽快完成系统的交付与安装部署。",
        # ↑ RR-006 命中：尽快 → 交付日期不明确
        # ↑ RR-018 命中：附件 → 附件清单缺失
    ]),

    ("第三条  合同金额与支付", [
        "本合同总金额为人民币 580000 元（大写：伍拾捌万捌仟元整），已含增值税。",
        # ↑ RR-002 命中：大小写不一致（580000 ≠ 伍拾捌万捌仟）
        # ↑ RR-005 命中：未约定发票类型与开票时间
        "1. 合同签订后7个工作日内，甲方应向乙方支付合同总额的80%作为预付款，即人民币464,000元；",
        # ↑ RR-003 命中：预付款80% > 50% 无担保
        # ↑ RR-004 命中：预付款缺少履约保障
        "2. 系统部署完成后甲方应向乙方支付合同总额的20%作为尾款。",
        # ↑ RR-019 命中：付款节点与交付节点脱钩
    ]),

    ("第四条  交付安排", [
        "乙方应在合同生效后尽快完成ERP系统的交付与安装部署工作，具体交付日期由双方协商确定。",
        # ↑ RR-006 命中：尽快
        "乙方负责系统的运输、安装及初步调试工作。运输费用与安装费用由乙方承担。",
    ]),

    ("第五条  验收标准", [
        "系统交付后，甲方应在合理期限内进行验收。验收标准为：系统功能应符合甲方要求，经甲方确认后签署验收报告，即视为验收合格。",
        # ↑ RR-007 命中：验收标准 — "符合甲方要求"无量化指标
        # ↑ RR-008 命中：验收期限 — 未约定验收期限与异议期
    ]),

    ("第六条  知识产权", [
        "本项目定制开发的全部源代码及相关技术文档的知识产权全部归乙方所有，甲方仅享有非独占的、不可转授权的内部使用权。",
        # ↑ RR-012 命中：知识产权全部归乙方
    ]),

    ("第七条  质保服务", [
        "具体质保期限及响应时限由双方另行约定。乙方在质保期内提供故障修复服务。",
        # ↑ RR-009 命中：质保期限与响应时限缺失
    ]),

    ("第八条  保密条款", [
        "双方应对在合作过程中知悉的对方商业秘密承担保密义务，未经对方书面同意不得向第三方披露。",
        # ↑ RR-013 命中：保密期限缺失
    ]),

    ("第九条  数据安全", [
        "因数据泄露造成的损失由双方共同承担。合同终止后，乙方应在合理期限内删除相关数据。",
        # ↑ RR-014 命中：数据安全责任划分不清
    ]),

    ("第十条  违约责任", [
        "1. 甲方逾期付款的，每日按应付未付金额的千分之五支付违约金；",
        # ↑ RR-010 命中：甲方违约金过高
        "2. 乙方延期交付的，每日按合同总额的千分之一支付违约金，累计违约金总额不超过合同总额的1%；",
        # ↑ RR-010 命中：不对等 + 上限过低
        "3. 因乙方违约导致甲方损失的，乙方的赔偿责任总额不超过本合同总额的20%。",
        # ↑ RR-022 命中：赔偿上限不合理
    ]),

    ("第十一条  合同解除", [
        "甲方逾期付款超过15日的，乙方有权单方解除本合同，并要求甲方承担违约责任。",
        # ↑ RR-011 命中：乙方单方解除权
    ]),

    ("第十二条  合同期限", [
        "本合同有效期为2年。期满后若需继续合作，自动续期。",
        # ↑ RR-016 命中：自动续期未设置提前通知
    ]),

    ("第十三条  争议解决", [
        "因本合同引起的或与本合同有关的任何争议，由乙方所在地有管辖权的人民法院管辖。",
        # ↑ RR-015 命中：乙方所在地法院管辖
    ]),

    ("第十四条  附则", [
        "本合同自双方签字盖章之日起生效。本合同一式两份，双方各执一份，具有同等法律效力。",
        "本合同未约定事项，由双方协商解决。",
        # ↑ RR-021 命中：不可抗力条款缺失
        # ↑ RR-024 命中：未约定适用法律
    ]),

    ("签署栏", [
        "",
        "甲方（盖章）：                乙方（盖章）：",
        "签字：                        签字：",
        "日期：                        日期：",
    ]),
]


def generate_txt():
    """生成 UTF-8 文本版本（后端可直接解析）"""
    lines = []
    for title, paragraphs in CONTRACT_SECTIONS:
        lines.append("")
        lines.append(f"{'=' * 60}")
        lines.append(f"  {title}")
        lines.append(f"{'=' * 60}")
        lines.append("")
        for p in paragraphs:
            if p:
                lines.append(f"  {p}")
            else:
                lines.append("")
    lines.append("")
    lines.append("（本测试合同由系统自动生成，用于验证规则引擎关键词匹配功能）")

    text = "\n".join(lines)
    with open(OUTPUT_TXT, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"✅ 测试 TXT 已生成：{OUTPUT_TXT}")
    print(f"   文件大小：{os.path.getsize(OUTPUT_TXT) / 1024:.1f} KB")


# ===== reportlab PDF 生成 =====

# 注册中文字体
CN_FONT = "Helvetica"
font_found = False

font_candidates = [
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttf",
    r"C:\Windows\Fonts\Deng.ttf",
    r"C:\Windows\Fonts\SIMKAI.ttf",
    r"C:\Windows\Fonts\SIMLI.ttf",
    r"C:\Windows\Fonts\SURSONG.ttf",
    r"C:\Windows\Fonts\SURSSON.ttf",
]

for fp in font_candidates:
    if os.path.exists(fp):
        try:
            pdfmetrics.registerFont(TTFont("CNDoc", fp))
            CN_FONT = "CNDoc"
            font_found = True
            print(f"✓ 已注册中文字体：{fp}")
            break
        except Exception as e:
            print(f"  ✗ 注册字体失败 {fp}: {e}")

if not font_found:
    print("⚠ 未找到中文字体，PDF 中文可能显示异常。建议安装 SimHei/微软雅黑。")


styles = getSampleStyleSheet()

style_normal = ParagraphStyle(
    "CN_Normal", parent=styles["Normal"],
    fontName=CN_FONT, fontSize=10, leading=16, spaceAfter=8,
)
style_title = ParagraphStyle(
    "CN_Title", parent=styles["Title"],
    fontName=CN_FONT, fontSize=18, leading=24, spaceAfter=20,
)
style_h1 = ParagraphStyle(
    "CN_H1", parent=styles["Heading1"],
    fontName=CN_FONT, fontSize=13, leading=18, spaceAfter=8, spaceBefore=16,
)
style_small = ParagraphStyle(
    "CN_Small", parent=styles["Normal"],
    fontName=CN_FONT, fontSize=8, leading=12, textColor=colors.grey,
)
style_cell = ParagraphStyle(
    "CN_Cell", parent=styles["Normal"],
    fontName=CN_FONT, fontSize=9, leading=13,
)
style_cell_center = ParagraphStyle(
    "CN_CellCenter", parent=styles["Normal"],
    fontName=CN_FONT, fontSize=9, leading=13,
)


def build_pdf_story():
    story = []

    # 封面标题
    story.append(Paragraph("采 购 合 同", style_title))
    story.append(Spacer(1, 4 * mm))

    # 合同信息表
    info_data = [
        [Paragraph("合同编号", style_cell_center), Paragraph("HT-YZ-2026-VALID-001", style_cell),
         Paragraph("签订日期", style_cell_center), Paragraph("2026年7月1日", style_cell)],
        [Paragraph("采购方（甲方）", style_cell_center), Paragraph("智远科技有限公司", style_cell),
         Paragraph("供应方（乙方）", style_cell_center), Paragraph("星河软件有限公司", style_cell)],
        [Paragraph("合同金额", style_cell_center), Paragraph("580,000.00 元", style_cell),
         Paragraph("币种", style_cell_center), Paragraph("人民币", style_cell)],
    ]
    t = Table(info_data, colWidths=[70, 140, 70, 140])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#e6f7ff")),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('PADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(t)
    story.append(Spacer(1, 6 * mm))

    for title, paragraphs in CONTRACT_SECTIONS:
        if title == "合同封面":
            continue
        if title == "签署栏":
            story.append(Spacer(1, 10 * mm))
            story.append(Paragraph("签署栏", style_h1))
        else:
            story.append(Paragraph(title, style_h1))
        for p in paragraphs:
            if p:
                story.append(Paragraph(p, style_normal))
            else:
                story.append(Spacer(1, 2 * mm))

    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph(
        "（本测试合同由系统自动生成，用于验证规则引擎关键词匹配功能）",
        style_small,
    ))
    return story


def generate_pdf():
    doc = SimpleDocTemplate(
        OUTPUT_PDF,
        pagesize=A4,
        title="采购合同",
        author="契审智控",
        leftMargin=22 * mm, rightMargin=22 * mm,
        topMargin=20 * mm, bottomMargin=18 * mm,
    )
    story = build_pdf_story()
    doc.build(story)
    print(f"✅ 测试合同 PDF 已生成：{OUTPUT_PDF}")
    print(f"   文件大小：{os.path.getsize(OUTPUT_PDF) / 1024:.1f} KB")


def print_expected_hits():
    print()
    print("=" * 55)
    print("  规则引擎预期命中清单：")
    print("=" * 55)
    hits = [
        ("RR-001", "乙方主体信息不完整", "统一社会信用代码：未提供"),
        ("RR-002", "合同大小写金额不一致", "伍拾捌万捌仟元整"),
        ("RR-003", "预付款比例过高", "80%作为预付款"),
        ("RR-004", "预付款缺少履约保障", "预付款 无担保"),
        ("RR-005", "发票类型与开票时间未约定", "已含增值税"),
        ("RR-006", "交付日期使用'尽快'", "尽快完成"),
        ("RR-007", "验收标准无法量化", "符合甲方要求"),
        ("RR-008", "验收期限缺失", "合理期限内"),
        ("RR-009", "质保期限缺失", "另行约定"),
        ("RR-010", "违约责任不对等", "千分之五 vs 千分之一"),
        ("RR-011", "乙方单方解除权", "有权单方解除"),
        ("RR-012", "知识产权归属乙方", "全部归乙方所有"),
        ("RR-013", "保密期限缺失", "保密义务"),
        ("RR-014", "数据安全责任划分不清", "数据泄露"),
        ("RR-015", "争议管辖地不利", "乙方所在地"),
        ("RR-016", "自动续期未提前通知", "自动续期"),
        ("RR-019", "付款与交付脱钩", "尾款 验收前"),
        ("RR-021", "不可抗力条款缺失", "无不可抗力条款"),
        ("RR-022", "赔偿上限不合理", "赔偿上限"),
        ("RR-024", "适用法律未约定", "适用法律"),
    ]
    for code, name, hit in hits:
        print(f"  {code:>10}  {name}  ←  {hit}")


def main():
    generate_txt()
    generate_pdf()
    print_expected_hits()
    print()
    print("=" * 55)
    print("  使用说明：")
    print("  1. 在「新建审核」页上传 test_contract_验证合同.txt 或 PDF")
    print("  2. 填写合同信息后点击「开始AI审核」")
    print("  3. 审核完成后，风险明细中将显示蓝色 [规则] 标签")
    print("=" * 55)


if __name__ == "__main__":
    main()
