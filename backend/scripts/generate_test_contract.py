"""
生成可验证的测试合同 PDF
- 包含大量可被规则引擎关键词匹配到的风险条款
- 上传到系统后应能看到蓝色 [规则] 标签
- 直接运行即可在当前目录生成 test_contract.pdf

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
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY

# 注册中文字体
font_dirs = [
    r"C:\Windows\Fonts",
    r"C:\Windows\Fonts\Microsoft",
]
SIMHEI_PATH = None
for d in font_dirs:
    p = os.path.join(d, "simhei.ttf")
    if os.path.exists(p):
        SIMHEI_PATH = p
        break

if not SIMHEI_PATH:
    # 尝试其他常见中文黑体路径
    for p in [
        r"C:\Windows\Fonts\msyh.ttc",  # 微软雅黑
        r"C:\Windows\Fonts\msyhbd.ttc",
    ]:
        if os.path.exists(p):
            SIMHEI_PATH = p
            break

if SIMHEI_PATH:
    try:
        pdfmetrics.registerFont(TTFont("SimHei", SIMHEI_PATH))
        CN_FONT = "SimHei"
    except Exception:
        CN_FONT = "Helvetica"
else:
    CN_FONT = "Helvetica"

OUTPUT = os.path.join(os.path.dirname(__file__), "..", "test_contract_验证合同.pdf")
OUTPUT = os.path.normpath(OUTPUT)

# 样式
styles = getSampleStyleSheet()
style_normal = ParagraphStyle(
    "CN_Normal", parent=styles["Normal"],
    fontName=CN_FONT, fontSize=10, leading=16, alignment=TA_JUSTIFY,
    spaceAfter=6, firstLineIndent=20,
)
style_title = ParagraphStyle(
    "CN_Title", parent=styles["Title"],
    fontName=CN_FONT, fontSize=18, leading=24, alignment=TA_CENTER,
    spaceAfter=20,
)
style_h1 = ParagraphStyle(
    "CN_H1", parent=styles["Heading1"],
    fontName=CN_FONT, fontSize=14, leading=20, spaceAfter=10, spaceBefore=16,
)
style_h2 = ParagraphStyle(
    "CN_H2", parent=styles["Heading2"],
    fontName=CN_FONT, fontSize=12, leading=18, spaceAfter=8, spaceBefore=12,
)
style_small = ParagraphStyle(
    "CN_Small", parent=styles["Normal"],
    fontName=CN_FONT, fontSize=8, leading=12, textColor=colors.grey,
)
style_table_header = ParagraphStyle(
    "CN_TH", parent=styles["Normal"],
    fontName=CN_FONT, fontSize=9, leading=13, alignment=TA_CENTER,
)
style_table_cell = ParagraphStyle(
    "CN_TD", parent=styles["Normal"],
    fontName=CN_FONT, fontSize=9, leading=13, alignment=TA_LEFT,
)


def build_story():
    story = []

    # 封面标题
    story.append(Paragraph("采购合同", style_title))
    story.append(Spacer(1, 6 * mm))

    # 合同信息表
    info_data = [
        [Paragraph("合同编号", style_table_header), Paragraph("HT-YZ-2026-VALID-001", style_table_cell),
         Paragraph("签订日期", style_table_header), Paragraph("2026年7月1日", style_table_cell)],
        [Paragraph("采购方（甲方）", style_table_header), Paragraph("智远科技有限公司", style_table_cell),
         Paragraph("供应方（乙方）", style_table_header), Paragraph("星河软件有限公司", style_table_cell)],
        [Paragraph("合同金额", style_table_header), Paragraph("人民币 580,000.00 元", style_table_cell),
         Paragraph("币种", style_table_header), Paragraph("人民币（CNY）", style_table_cell)],
        [Paragraph("付款方式", style_table_header), Paragraph("分期付款", style_table_cell),
         Paragraph("争议管辖", style_table_header), Paragraph("乙方所在地法院", style_table_cell)],
    ]
    t = Table(info_data, colWidths=[80, 130, 80, 130])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#e6f7ff")),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('PADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(t)
    story.append(Spacer(1, 8 * mm))

    # ===== 第一条 合同主体 =====
    story.append(Paragraph("第一条 合同主体", style_h1))
    story.append(Paragraph(
        "甲方（采购方）：智远科技有限公司，法定代表人：张智远，统一社会信用代码：91440101MA5XXXXXXX，"
        "注册地址：北京市海淀区中关村大街1号。",
        style_normal,
    ))
    story.append(Paragraph(
        "乙方（供应方）：星河软件有限公司，法定代表人：刘星河，统一社会信用代码：未提供，联系地址：未提供。",
        style_normal,
    ))
    # ↑ RR-001 规则命中：统一社会信用代码缺失、联系地址缺失

    # ===== 第二条 合同标的 =====
    story.append(Paragraph("第二条 合同标的与范围", style_h1))
    story.append(Paragraph(
        "甲方同意向乙方采购企业资源计划（ERP）管理系统一套，包括系统软件、数据库配置、接口开发及三年运维服务。"
        "具体功能模块与技术规格详见本合同附件。",
        style_normal,
    ))
    story.append(Paragraph(
        "乙方应于合同签署后尽快完成系统的交付与安装部署。",
        style_normal,
    ))
    # ↑ RR-006 规则命中：尽快 → RR-DEL-001
    # ↑ RR-018 规则命中：附件 → RR-DOC-001

    # ===== 第三条 合同金额 =====
    story.append(Paragraph("第三条 合同金额与支付", style_h1))
    story.append(Paragraph(
        "本合同总金额为人民币 580000 元（大写：伍拾捌万捌仟元整），已含增值税。",
        style_normal,
    ))
    # ↑ RR-002 规则命中：大小写不一致（580000 vs 伍拾捌万捌仟）
    # ↑ RR-005 规则命中：未约定发票类型与开票时间
    story.append(Paragraph(
        "1. 合同签订后7个工作日内，甲方应向乙方支付合同总额的80%作为预付款，即人民币464,000元；",
        style_normal,
    ))
    # ↑ RR-003 规则命中：预付款80% > 50% 无担保
    # ↑ RR-004 规则命中：预付款缺少履约保障
    story.append(Paragraph(
        "2. 系统部署完成后甲方应向乙方支付合同总额的20%作为尾款。",
        style_normal,
    ))
    # ↑ RR-019 规则命中：付款节点与交付节点脱钩（付款在验收前）

    # ===== 第四条 交付 =====
    story.append(Paragraph("第四条 交付安排", style_h1))
    story.append(Paragraph(
        "乙方应在合同生效后尽快完成ERP系统的交付与安装部署工作，具体交付日期由双方协商确定。",
        style_normal,
    ))
    # ↑ RR-006 规则命中：尽快 — 交付日期不明确
    story.append(Paragraph(
        "乙方负责系统的运输、安装及初步调试工作。运输费用与安装费用由乙方承担。",
        style_normal,
    ))
    # ↑ RR-025 规则命中：运输费、安装费已约定，不触发（这是好的）

    # ===== 第五条 验收 =====
    story.append(Paragraph("第五条 验收标准", style_h1))
    story.append(Paragraph(
        "系统交付后，甲方应在合理期限内进行验收。验收标准为：系统功能应符合甲方要求，"
        "经甲方确认后签署验收报告，即视为验收合格。",
        style_normal,
    ))
    # ↑ RR-007 规则命中：验收标准 — "符合甲方要求"无量化指标
    # ↑ RR-008 规则命中：验收期限 — 未约定验收期限与异议期

    # ===== 第六条 知识产权 =====
    story.append(Paragraph("第六条 知识产权", style_h1))
    story.append(Paragraph(
        "本项目定制开发的全部源代码及相关技术文档的知识产权全部归乙方所有，"
        "甲方仅享有非独占的、不可转授权的内部使用权。",
        style_normal,
    ))
    # ↑ RR-012 规则命中：知识产权全部归乙方

    # ===== 第七条 质保 =====
    story.append(Paragraph("第七条 质保服务", style_h1))
    story.append(Paragraph(
        "具体质保期限及响应时限由双方另行约定。乙方在质保期内提供故障修复服务。",
        style_normal,
    ))
    # ↑ RR-009 规则命中：质保期限与响应时限缺失

    # ===== 第八条 保密 =====
    story.append(Paragraph("第八条 保密条款", style_h1))
    story.append(Paragraph(
        "双方应对在合作过程中知悉的对方商业秘密承担保密义务，未经对方书面同意不得向第三方披露。",
        style_normal,
    ))
    # ↑ RR-013 规则命中：保密期限缺失

    # ===== 第九条 数据安全 =====
    story.append(Paragraph("第九条 数据安全", style_h1))
    story.append(Paragraph(
        "因数据泄露造成的损失由双方共同承担。合同终止后，乙方应在合理期限内删除相关数据。",
        style_normal,
    ))
    # ↑ RR-014 规则命中：数据安全责任划分不清

    # ===== 第十条 违约责任 =====
    story.append(Paragraph("第十条 违约责任", style_h1))
    story.append(Paragraph(
        "1. 甲方逾期付款的，每日按应付未付金额的千分之五支付违约金；",
        style_normal,
    ))
    # ↑ RR-010 规则命中：甲方违约金过高（日千分之五）
    story.append(Paragraph(
        "2. 乙方延期交付的，每日按合同总额的千分之一支付违约金，"
        "累计违约金总额不超过合同总额的1%；",
        style_normal,
    ))
    # ↑ RR-010 规则命中：乙方违约金过低且上限仅1%
    story.append(Paragraph(
        "3. 因乙方违约导致甲方损失的，乙方的赔偿责任总额不超过本合同总额。",
        style_normal,
    ))
    # ↑ RR-022 规则命中：赔偿上限不合理

    # ===== 第十一条 合同解除 =====
    story.append(Paragraph("第十一条 合同解除", style_h1))
    story.append(Paragraph(
        "甲方逾期付款超过15日的，乙方有权单方解除本合同，并要求甲方承担违约责任。",
        style_normal,
    ))
    # ↑ RR-011 规则命中：乙方单方解除权，甲方无对应权利

    # ===== 第十二条 合同期限 =====
    story.append(Paragraph("第十二条 合同期限", style_h1))
    story.append(Paragraph(
        "本合同有效期为2年。期满后若需继续合作，自动续期。",
        style_normal,
    ))
    # ↑ RR-016 规则命中：自动续期未设置提前通知

    # ===== 第十三条 争议解决 =====
    story.append(Paragraph("第十三条 争议解决", style_h1))
    story.append(Paragraph(
        "因本合同引起的或与本合同有关的任何争议，由乙方所在地有管辖权的人民法院管辖。",
        style_normal,
    ))
    # ↑ RR-015 规则命中：乙方所在地法院管辖

    # ===== 第十四条 不可抗力 =====
    story.append(Paragraph("第十四条 附则", style_h1))
    story.append(Paragraph(
        "本合同自双方签字盖章之日起生效。本合同一式两份，双方各执一份，具有同等法律效力。",
        style_normal,
    ))
    # ↑ RR-021 规则命中：不可抗力条款缺失
    story.append(Paragraph(
        "本合同未约定事项，由双方协商解决。",
        style_normal,
    ))
    # ↑ RR-024 规则命中：未约定适用法律

    # 签署栏
    story.append(Spacer(1, 15 * mm))
    sign_data = [
        [Paragraph("甲方（盖章）：", style_table_cell), Paragraph("乙方（盖章）：", style_table_cell)],
        [Paragraph("签字：", style_table_cell), Paragraph("签字：", style_table_cell)],
        [Paragraph("日期：", style_table_cell), Paragraph("日期：", style_table_cell)],
    ]
    t2 = Table(sign_data, colWidths=[150, 150])
    t2.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 20),
    ]))
    story.append(t2)

    # 页脚标注
    story.append(Spacer(1, 10 * mm))
    story.append(Paragraph(
        "（本测试合同由系统自动生成，用于验证规则引擎关键词匹配功能）",
        style_small,
    ))

    return story


def main():
    doc = SimpleDocTemplate(
        OUTPUT,
        pagesize=A4,
        title="采购合同",
        author="契审智控",
        leftMargin=25 * mm, rightMargin=25 * mm,
        topMargin=25 * mm, bottomMargin=20 * mm,
    )
    story = build_story()
    doc.build(story)
    print(f"✅ 测试合同已生成：{OUTPUT}")
    print(f"   文件大小：{os.path.getsize(OUTPUT) / 1024:.1f} KB")
    print()
    print("包含的可命中规则（预期）：")
    rules_hit = [
        ("RR-001", "乙方主体信息不完整", "统一社会信用代码未提供"),
        ("RR-002", "合同大小写金额不一致", "580000 vs 伍拾捌万捌仟"),
        ("RR-003", "预付款比例超过50%且无担保", "预付款80%"),
        ("RR-005", "发票类型与开票时间未约定", "已含增值税"),
        ("RR-006", "交付日期使用'尽快'", "尽快完成交付"),
        ("RR-007", "验收标准无法量化（符合甲方要求）", "符合甲方要求"),
        ("RR-008", "验收期限缺失", "合理期限内"),
        ("RR-009", "质保期限缺失", "另行约定"),
        ("RR-010", "违约责任不对等", "千分之五 vs 千分之一"),
        ("RR-011", "乙方单方解除权", "乙方有权单方解除"),
        ("RR-012", "知识产权归属乙方", "全部归乙方所有"),
        ("RR-013", "保密期限缺失", "保密义务"),
        ("RR-014", "数据安全责任划分不清", "数据泄露"),
        ("RR-015", "争议管辖地不利（乙方所在地）", "乙方所在地法院"),
        ("RR-016", "自动续期未设置提前通知", "自动续期"),
        ("RR-021", "不可抗力条款缺失", "无不可抗力条款"),
        ("RR-022", "赔偿上限不合理", "赔偿上限"),
        ("RR-024", "适用法律未约定", "无适用法律"),
    ]
    for code, name, hit in rules_hit:
        print(f"  {code:>10}  {name}  ←  {hit}")


if __name__ == "__main__":
    main()
