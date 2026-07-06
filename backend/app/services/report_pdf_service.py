"""审核报告 PDF 生成服务（v3 - 卡片式布局版）

彻底对齐网页版 ReportDetailPage 的视觉设计：
- 章节标题：整行浅色背景 + 左侧彩色竖条 + 大圆形图标（含罗马数字）+ 粗体标题
- 综合风险概览：明显的卡片（彩色边框）+ 4 列布局 + 大字号数字
- AI 摘要/法务结论/免责声明：统一的「标题栏 + 内容区」卡片样式
- Tag 标签：彩色文字 + 浅色背景 + 彩色边框（模拟网页 antd Tag）
- 表格：彩色表头白字 + 行间隔色 + 加大 padding

中文字体使用 simsun.ttc（宋体）。
"""
import os
import io

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    KeepTogether, HRFlowable,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics.shapes import Drawing, Circle, String

from app.schemas.report import GeneratePdfRequest, ReportSnapshot


# ===== 中文字体注册 =====
FONT_NAME = 'SimSun'
FONT_BOLD = 'SimSun'
_FONT_REGISTERED = False


def _ensure_font():
    """注册中文字体（仅注册一次）
    优先使用 reportlab 内置 Adobe CJK CID 字体（STSong-Light 简体中文宋体）
    完全不依赖系统字体文件，跨平台一致，Render/Linux 也能正常显示中文
    """
    global _FONT_REGISTERED
    if _FONT_REGISTERED:
        return
    # 优先方案：reportlab 内置 CID 字体（无需任何系统字体文件）
    try:
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
        globals()['FONT_NAME'] = 'STSong-Light'
        globals()['FONT_BOLD'] = 'STSong-Light'
        _FONT_REGISTERED = True
        return
    except Exception as e:
        print(f"[report_pdf] 注册 CID 字体 STSong-Light 失败，回退到系统字体: {e}")
    # 回退方案：查找系统字体文件
    candidates = [
        ("C:/Windows/Fonts/simsun.ttc", "SimSun"),
        ("C:/Windows/Fonts/msyh.ttc", "MSYH"),
        ("C:/Windows/Fonts/simfang.ttf", "SimFang"),
        ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "NotoCJK"),
        ("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", "NotoCJK"),
        ("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", "WQYZH"),
        ("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc", "WQYMH"),
    ]
    for path, name in candidates:
        if os.path.exists(path):
            try:
                pdfmetrics.registerFont(TTFont(name, path))
                globals()['FONT_NAME'] = name
                globals()['FONT_BOLD'] = name
                _FONT_REGISTERED = True
                return
            except Exception:
                continue
    globals()['FONT_NAME'] = 'Helvetica'
    globals()['FONT_BOLD'] = 'Helvetica-Bold'
    _FONT_REGISTERED = True


# ===== 颜色规范（对齐前端 COLORS / RISK_LEVEL_MAP）=====
C_PRIMARY = colors.HexColor('#1677ff')      # 主色 专业蓝
C_AI = colors.HexColor('#13c2c2')            # AI 辅助色 青绿
C_BG = colors.HexColor('#f5f7fa')            # 浅灰白背景
C_BG_LIGHT = colors.HexColor('#fafbfc')      # 更浅的背景
C_BORDER = colors.HexColor('#e8ecf0')
C_TEXT_PRIMARY = colors.HexColor('#1d2129')
C_TEXT_SECONDARY = colors.HexColor('#5b6470')

C_HIGH = colors.HexColor('#f5222d')         # 高风险 红
C_MEDIUM = colors.HexColor('#fa8c16')        # 中风险 橙
C_LOW = colors.HexColor('#52c41a')           # 低风险 绿
C_NOTICE = colors.HexColor('#7c8696')        # 提示项 蓝灰

C_HIGH_BG = colors.HexColor('#fff1f0')
C_MEDIUM_BG = colors.HexColor('#fff7e6')
C_LOW_BG = colors.HexColor('#f6ffed')
C_NOTICE_BG = colors.HexColor('#f0f5ff')

C_HIGH_BORDER = colors.HexColor('#ffccc7')
C_MEDIUM_BORDER = colors.HexColor('#ffd591')
C_LOW_BORDER = colors.HexColor('#b7eb8f')
C_NOTICE_BORDER = colors.HexColor('#d6e4ff')

C_AI_BG = colors.HexColor('#e6fffb')
C_AI_BORDER = colors.HexColor('#87e8de')
C_LEGAL_BG = colors.HexColor('#f6ffed')
C_LEGAL_BORDER = colors.HexColor('#b7eb8f')
C_WARN_BG = colors.HexColor('#fffbe6')
C_WARN_BORDER = colors.HexColor('#faad14')

# 章节标题行的浅色背景（主色的极浅版本）
C_SECTION_BG = colors.HexColor('#f0f5ff')  # 蓝色浅底
C_SECTION_BG_AI = colors.HexColor('#e6fffb')  # 青绿浅底
C_SECTION_BG_HIGH = colors.HexColor('#fff1f0')  # 红色浅底
C_SECTION_BG_LOW = colors.HexColor('#f6ffed')  # 绿色浅底
C_SECTION_BG_WARN = colors.HexColor('#fffbe6')  # 黄色浅底


# ===== 等级映射 =====
RISK_LEVEL_LABEL = {
    'high': '高风险', 'medium': '中风险', 'low': '低风险', 'notice': '提示项',
}
RISK_LEVEL_COLOR = {
    'high': C_HIGH, 'medium': C_MEDIUM, 'low': C_LOW, 'notice': C_NOTICE,
}
RISK_LEVEL_BG = {
    'high': C_HIGH_BG, 'medium': C_MEDIUM_BG, 'low': C_LOW_BG, 'notice': C_NOTICE_BG,
}
RISK_LEVEL_BORDER = {
    'high': C_HIGH_BORDER, 'medium': C_MEDIUM_BORDER, 'low': C_LOW_BORDER, 'notice': C_NOTICE_BORDER,
}
LEGAL_CONCLUSION_LABEL = {
    'sign': '建议直接签署', 'sign_after_modify': '建议修改后签署',
    'defer': '建议暂缓签署', 'not_sign': '建议不予签署',
}
LEGAL_CONCLUSION_DESC = {
    'sign': '合同风险可控，可正常签署',
    'sign_after_modify': '需按审核建议修改条款后再签署',
    'defer': '存在需进一步确认事项，建议暂缓',
    'not_sign': '存在重大风险，不建议签署',
}
LEGAL_CONCLUSION_COLOR = {
    'sign': C_LOW,            # 绿 - 建议直接签署
    'sign_after_modify': C_MEDIUM,  # 橙 - 建议修改后签署
    'defer': C_MEDIUM,         # 橙 - 建议暂缓签署
    'not_sign': C_HIGH,        # 红 - 建议不予签署
}
LEGAL_CONCLUSION_BG = {
    'sign': C_LOW_BG,
    'sign_after_modify': C_MEDIUM_BG,
    'defer': C_MEDIUM_BG,
    'not_sign': C_HIGH_BG,
}
LEGAL_CONCLUSION_BORDER = {
    'sign': C_LOW_BORDER,
    'sign_after_modify': C_MEDIUM_BORDER,
    'defer': C_MEDIUM_BORDER,
    'not_sign': C_HIGH_BORDER,
}
RISK_STATUS_LABEL = {
    'pending': '待处理', 'accepted': '已接受', 'edited': '已编辑',
    'ignored': '已忽略', 'manual_review': '转人工复核', 'confirmed': '已确认',
}
RISK_STATUS_COLOR = {
    'pending': C_NOTICE, 'accepted': C_LOW, 'edited': C_PRIMARY,
    'ignored': C_TEXT_SECONDARY, 'manual_review': C_MEDIUM, 'confirmed': C_LOW,
}


def _format_amount(amount: float, currency: str = 'CNY') -> str:
    symbol = '¥' if currency == 'CNY' else ''
    return f"{symbol}{amount:,.2f}"


def _format_generated_at(iso_str: str) -> str:
    try:
        s = iso_str.replace('T', ' ').replace('Z', '')
        if '.' in s:
            s = s.split('.')[0]
        return s
    except Exception:
        return iso_str


def _circular_icon(text: str, bg_color, size: float = 26.0, font_size: float = 11.0):
    """绘制圆形图标：彩色背景 + 白色字符（模拟网页中的 lucide 图标视觉）"""
    d = Drawing(size, size)
    d.add(Circle(size / 2, size / 2, size / 2,
                 fillColor=bg_color, strokeColor=bg_color))
    if text:
        d.add(String(size / 2, size / 2 - font_size * 0.35, text,
                     textAnchor='middle',
                     fontName=FONT_BOLD, fontSize=font_size,
                     fillColor=colors.white))
    return d


def _section_title(text: str, color, bg_color, styles: dict, num: str = ''):
    """章节标题：整行浅色背景 + 左侧彩色竖条 + 大圆形图标 + 粗体标题

    视觉对齐网页 antd Title + lucide 图标效果。
    """
    icon = _circular_icon(num, color, size=26, font_size=11)
    block = Table(
        [[icon, Paragraph(f"<b>{text}</b>", styles['section_title'])]],
        colWidths=[1.1 * cm, 15.4 * cm],
        hAlign='LEFT',
    )
    block.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), bg_color),      # 整行浅色背景
        ('LINEBEFORE', (0, 0), (0, -1), 4, color),         # 左侧 4px 彩色竖条
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (1, 0), (1, 0), 10),
        ('LEFTPADDING', (0, 0), (0, 0), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 9),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 9),
    ]))
    return block


def _tag(text: str, color, bg_color, border_color, styles: dict, font_size=9):
    """模拟网页 antd Tag 样式：彩色文字 + 浅色背景 + 彩色边框"""
    style = ParagraphStyle(
        'TagStyle', parent=styles['cell'],
        fontName=FONT_BOLD, fontSize=font_size, leading=font_size + 3,
        textColor=color, alignment=TA_CENTER,
    )
    t = Table([[Paragraph(text, style)]], hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), bg_color),
        ('BOX', (0, 0), (-1, -1), 0.6, border_color),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    return t


def _card(title_text: str, title_color, content_flowables: list,
          content_bg, border_color, styles: dict, content_padding=12):
    """带标题栏的卡片：标题栏（彩色背景白字）+ 内容区（浅色背景）+ 外层边框

    用于 AI 摘要、法务结论、免责声明等区块，形成统一的卡片视觉。
    """
    # 标题栏（彩色背景白字）
    header = Table(
        [[Paragraph(f"<b>{title_text}</b>", styles['card_header'])]],
        colWidths=[16.5 * cm],
    )
    header.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), title_color),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.white),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('RIGHTPADDING', (0, 0), (-1, -1), 12),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
    ]))

    # 内容区（浅色背景）
    inner_rows = [[f] for f in content_flowables]
    content = Table(inner_rows, colWidths=[16.5 * cm])
    content.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), content_bg),
        ('LEFTPADDING', (0, 0), (-1, -1), content_padding),
        ('RIGHTPADDING', (0, 0), (-1, -1), content_padding),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))

    # 外层卡片（边框）
    outer = Table([[header], [content]], colWidths=[16.5 * cm], hAlign='LEFT')
    outer.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1, border_color),
        ('LINEBELOW', (0, 0), (-1, 0), 0.5, border_color),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    return outer


def _boxed_content(flowables: list, bg_color, border_color, styles: dict, padding=8):
    """带背景色与边框的内容框"""
    inner = []
    for f in flowables:
        inner.append([f])
    t = Table(inner, colWidths=[16.5 * cm], hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), bg_color),
        ('BOX', (0, 0), (-1, -1), 0.8, border_color),
        ('LEFTPADDING', (0, 0), (-1, -1), padding),
        ('RIGHTPADDING', (0, 0), (-1, -1), padding),
        ('TOPPADDING', (0, 0), (-1, -1), padding),
        ('BOTTOMPADDING', (0, 0), (-1, -1), padding),
    ]))
    return t


class ReportPDFService:
    """审核报告 PDF 生成服务（v3 - 卡片式布局版）"""

    def generate(self, request: GeneratePdfRequest) -> bytes:
        _ensure_font()

        buf = io.BytesIO()
        doc = SimpleDocTemplate(
            buf, pagesize=A4,
            leftMargin=1.5 * cm, rightMargin=1.5 * cm,
            topMargin=1.5 * cm, bottomMargin=1.8 * cm,
            title=f"采购合同审核报告 - {request.reportNo}",
        )

        styles = self._build_styles()
        story = []
        snap = request.snapshot

        # 1. 标题区
        story.extend(self._build_header(snap, request.reportNo, request.versionNo, styles))
        story.append(Spacer(1, 5 * mm))

        # 2. 综合风险概览（视觉重点）
        story.extend(self._build_risk_overview(snap, styles))
        story.append(Spacer(1, 6 * mm))

        # 3. 合同基本信息
        story.append(_section_title("一、合同基本信息", C_PRIMARY, C_SECTION_BG, styles, num='I'))
        story.append(Spacer(1, 2 * mm))
        story.append(self._build_contract_info(snap, styles))
        story.append(Spacer(1, 6 * mm))

        # 4. 合同要素字段
        story.append(_section_title("二、合同要素字段", C_PRIMARY, C_SECTION_BG, styles, num='II'))
        story.append(Spacer(1, 2 * mm))
        story.append(self._build_fields(snap, styles))
        story.append(Spacer(1, 6 * mm))

        # 5. AI 审核结论摘要
        story.append(_section_title("三、AI 审核结论摘要", C_AI, C_SECTION_BG_AI, styles, num='III'))
        story.append(Spacer(1, 2 * mm))
        story.append(self._build_ai_summary(snap, styles))
        story.append(Spacer(1, 6 * mm))

        # 6. 重大风险条款
        story.append(_section_title(f"四、重大风险条款（共 {len(snap.majorRisks)} 项）", C_HIGH, C_SECTION_BG_HIGH, styles, num='IV'))
        story.append(Spacer(1, 2 * mm))
        story.append(self._build_major_risks(snap, styles))
        story.append(Spacer(1, 6 * mm))

        # 7. 逐条风险明细
        story.append(_section_title(f"五、逐条风险明细（共 {len(snap.risks)} 项）", C_PRIMARY, C_SECTION_BG, styles, num='V'))
        story.append(Spacer(1, 2 * mm))
        story.append(self._build_all_risks(snap, styles))
        story.append(Spacer(1, 6 * mm))

        # 8. 人工审核结论
        story.append(_section_title("六、人工审核结论", C_LOW, C_SECTION_BG_LOW, styles, num='VI'))
        story.append(Spacer(1, 2 * mm))
        story.append(self._build_legal_conclusion(snap, styles))
        story.append(Spacer(1, 6 * mm))

        # 9. 免责声明
        story.append(_section_title("七、免责声明", C_WARN_BORDER, C_SECTION_BG_WARN, styles, num='VII'))
        story.append(Spacer(1, 2 * mm))
        story.append(self._build_disclaimer(snap, styles))
        story.append(Spacer(1, 6 * mm))

        # 10. 附件与留档
        story.append(_section_title("八、附件与留档", C_PRIMARY, C_SECTION_BG, styles, num='VIII'))
        story.append(Spacer(1, 2 * mm))
        story.append(self._build_appendix(snap, request, styles))

        # 页脚
        def _on_page(canvas, doc):
            canvas.saveState()
            canvas.setFont(FONT_NAME, 8)
            canvas.setFillColor(C_TEXT_SECONDARY)
            canvas.drawString(1.5 * cm, 1 * cm, "契审智控 · AI采购合同审核平台")
            canvas.drawRightString(A4[0] - 1.5 * cm, 1 * cm, f"第 {doc.page} 页")
            canvas.setStrokeColor(C_BORDER)
            canvas.setLineWidth(0.3)
            canvas.line(1.5 * cm, 1.3 * cm, A4[0] - 1.5 * cm, 1.3 * cm)
            canvas.restoreState()

        doc.build(story, onFirstPage=_on_page, onLaterPages=_on_page)
        return buf.getvalue()

    # ===== 样式定义 =====
    def _build_styles(self) -> dict:
        styles = getSampleStyleSheet()
        return {
            'title': ParagraphStyle('CnTitle', parent=styles['Title'],
                                    fontName=FONT_BOLD, fontSize=22, alignment=TA_CENTER,
                                    spaceAfter=4, leading=28, textColor=C_TEXT_PRIMARY),
            'subtitle': ParagraphStyle('CnSubtitle', parent=styles['Normal'],
                                       fontName=FONT_NAME, fontSize=10, alignment=TA_CENTER,
                                       textColor=C_TEXT_SECONDARY, spaceAfter=10),
            'section_title': ParagraphStyle('SectionTitle', parent=styles['Heading2'],
                                            fontName=FONT_BOLD, fontSize=14,
                                            textColor=C_TEXT_PRIMARY,
                                            leading=20),
            'card_header': ParagraphStyle('CardHeader', parent=styles['Normal'],
                                          fontName=FONT_BOLD, fontSize=11, leading=16,
                                          textColor=colors.white),
            'body': ParagraphStyle('CnBody', parent=styles['Normal'],
                                   fontName=FONT_NAME, fontSize=10, leading=16,
                                   alignment=TA_JUSTIFY, textColor=C_TEXT_PRIMARY),
            'body_small': ParagraphStyle('CnBodySmall', parent=styles['Normal'],
                                         fontName=FONT_NAME, fontSize=9, leading=13,
                                         alignment=TA_JUSTIFY, textColor=C_TEXT_PRIMARY),
            'cell': ParagraphStyle('CnCell', parent=styles['Normal'],
                                  fontName=FONT_NAME, fontSize=9.5, leading=14,
                                  textColor=C_TEXT_PRIMARY),
            'cell_small': ParagraphStyle('CnCellSmall', parent=styles['Normal'],
                                         fontName=FONT_NAME, fontSize=8.5, leading=12,
                                         textColor=C_TEXT_PRIMARY),
            'cell_label': ParagraphStyle('CnCellLabel', parent=styles['Normal'],
                                         fontName=FONT_BOLD, fontSize=9.5, leading=14,
                                         textColor=C_TEXT_SECONDARY),
            'cell_white_bold': ParagraphStyle('CnCellWhiteBold', parent=styles['Normal'],
                                              fontName=FONT_BOLD, fontSize=10, leading=14,
                                              textColor=colors.white, alignment=TA_CENTER),
            'table_header': ParagraphStyle('TableHeader', parent=styles['Normal'],
                                           fontName=FONT_BOLD, fontSize=9.5, leading=14,
                                           textColor=colors.white, alignment=TA_CENTER),
            'summary': ParagraphStyle('CnSummary', parent=styles['Normal'],
                                     fontName=FONT_NAME, fontSize=10.5, leading=18,
                                     textColor=C_TEXT_PRIMARY, alignment=TA_JUSTIFY),
            'disclaimer': ParagraphStyle('CnDisclaimer', parent=styles['Normal'],
                                        fontName=FONT_NAME, fontSize=9.5, leading=15,
                                        textColor=C_TEXT_PRIMARY, alignment=TA_JUSTIFY),
            'big_score': ParagraphStyle('BigScore', parent=styles['Normal'],
                                        fontName=FONT_BOLD, fontSize=32, leading=36,
                                        alignment=TA_CENTER),
            'level_label': ParagraphStyle('LevelLabel', parent=styles['Normal'],
                                          fontName=FONT_BOLD, fontSize=14, leading=20,
                                          alignment=TA_CENTER, textColor=colors.white),
            'stat_label': ParagraphStyle('StatLabel', parent=styles['Normal'],
                                         fontName=FONT_NAME, fontSize=9, leading=12,
                                         alignment=TA_CENTER, textColor=C_TEXT_SECONDARY),
            'stat_value': ParagraphStyle('StatValue', parent=styles['Normal'],
                                         fontName=FONT_BOLD, fontSize=20, leading=24,
                                         alignment=TA_CENTER, textColor=C_TEXT_PRIMARY),
        }

    # ===== 1. 标题区 =====
    def _build_header(self, snap: ReportSnapshot, report_no: str, version_no: int, styles: dict):
        # 装饰性 logo 圆形（蓝色背景 + "契" 字，模拟网页 ShieldCheck 图标）
        logo = _circular_icon('契', C_PRIMARY, size=44, font_size=20)
        title_para = Paragraph("采购合同审核报告", styles['title'])

        # logo + 标题 横向排列，整体居中
        header_table = Table(
            [[logo, title_para]],
            colWidths=[2 * cm, 14.5 * cm],
            hAlign='CENTER',
        )
        header_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN', (1, 0), (1, 0), 'LEFT'),
            ('LEFTPADDING', (1, 0), (1, 0), 12),
            ('RIGHTPADDING', (0, 0), (0, 0), 0),
            ('LEFTPADDING', (0, 0), (0, 0), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ]))

        return [
            header_table,
            Paragraph(
                f"报告编号：{report_no}  ·  版本 v{version_no}  ·  生成时间：{_format_generated_at(snap.generatedAt)}",
                styles['subtitle']
            ),
            HRFlowable(width="100%", thickness=2, color=C_PRIMARY),
            Spacer(1, 3 * mm),
        ]

    # ===== 2. 综合风险概览（视觉重点 - 卡片式）=====
    def _build_risk_overview(self, snap: ReportSnapshot, styles: dict):
        level_label = RISK_LEVEL_LABEL.get(snap.overallRiskLevel, snap.overallRiskLevel)
        level_color = RISK_LEVEL_COLOR.get(snap.overallRiskLevel, C_PRIMARY)
        level_bg = RISK_LEVEL_BG.get(snap.overallRiskLevel, colors.white)
        rc = snap.riskCount

        # 等级色块（彩色背景白字，大尺寸）
        level_block = Table(
            [[Paragraph(level_label, styles['level_label'])]],
            colWidths=[3.5 * cm], rowHeights=[1.8 * cm],
        )
        level_block.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), level_color),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ]))

        # 评分大字（彩色数字 + /100 后缀）
        score_block = Table(
            [[Paragraph(
                f"<font color='{level_color.hexval()}'><b>{snap.riskScore}</b></font>",
                styles['big_score']
            )],
             [Paragraph("风险评分（满分 100）", styles['stat_label'])]],
            colWidths=[3.5 * cm], rowHeights=[1.2 * cm, 0.6 * cm],
        )
        score_block.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), level_bg),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ]))

        # 4 列统计（每个有独立的浅色背景小卡片 + 彩色边框）
        stat_cells = []
        for level_key, label, color, bg, border in [
            ('high', '高风险', C_HIGH, C_HIGH_BG, C_HIGH_BORDER),
            ('medium', '中风险', C_MEDIUM, C_MEDIUM_BG, C_MEDIUM_BORDER),
            ('low', '低风险', C_LOW, C_LOW_BG, C_LOW_BORDER),
            ('notice', '提示项', C_NOTICE, C_NOTICE_BG, C_NOTICE_BORDER),
        ]:
            count = rc.get(level_key, 0)
            stat_card = Table(
                [[Paragraph(
                    f"<font color='{color.hexval()}'><b>{count}</b></font>",
                    styles['stat_value']
                )],
                 [Paragraph(label, styles['stat_label'])]],
                colWidths=[2.1 * cm], rowHeights=[1.2 * cm, 0.6 * cm],
            )
            stat_card.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, -1), bg),
                ('BOX', (0, 0), (-1, -1), 0.8, border),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ]))
            stat_cells.append(stat_card)

        # 横向拼接 4 个统计小卡片
        stat_row = Table([stat_cells], colWidths=[2.1 * cm] * 4, hAlign='LEFT')
        stat_row.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('LEFTPADDING', (0, 0), (-1, -1), 1),
            ('RIGHTPADDING', (0, 0), (-1, -1), 1),
        ]))

        # 4 列标签行
        label_row = Table(
            [[
                Paragraph("综合风险等级", styles['stat_label']),
                Paragraph("风险评分", styles['stat_label']),
                Paragraph("风险数量分布", styles['stat_label']),
            ]],
            colWidths=[3.5 * cm, 3.5 * cm, 9 * cm],
        )
        label_row.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), C_BG),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))

        # 数据行
        data_row = Table(
            [[level_block, score_block, stat_row]],
            colWidths=[3.5 * cm, 3.5 * cm, 9 * cm],
            hAlign='LEFT',
        )
        data_row.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ]))

        # 外层卡片（彩色边框 + 白色背景 + padding）
        outer = Table(
            [[label_row], [data_row]],
            colWidths=[16.5 * cm],
            hAlign='LEFT',
        )
        outer.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 1.5, level_color),
            ('BACKGROUND', (0, 0), (-1, -1), colors.white),
            ('LINEBELOW', (0, 0), (-1, 0), 0.5, C_BORDER),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ]))

        return [outer]

    # ===== 3. 合同基本信息 =====
    def _build_contract_info(self, snap: ReportSnapshot, styles: dict):
        focus_text = '、'.join(snap.reviewFocus) if snap.reviewFocus else '无'
        data = [
            [Paragraph("合同名称", styles['cell_label']), Paragraph(snap.contractName, styles['cell']),
             Paragraph("合同编号", styles['cell_label']), Paragraph(snap.contractNo, styles['cell'])],
            [Paragraph("相对方", styles['cell_label']), Paragraph(snap.counterparty, styles['cell']),
             Paragraph("合同金额", styles['cell_label']),
             Paragraph(_format_amount(snap.amount, snap.currency), styles['cell'])],
            [Paragraph("合同类型", styles['cell_label']), Paragraph(snap.contractType, styles['cell']),
             Paragraph("审核重点", styles['cell_label']), Paragraph(focus_text, styles['cell'])],
        ]
        col_widths = [2.4 * cm, 6 * cm, 2.4 * cm, 5.7 * cm]
        t = Table(data, colWidths=col_widths, hAlign='LEFT')
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), C_BG),
            ('BACKGROUND', (2, 0), (2, -1), C_BG),
            ('GRID', (0, 0), (-1, -1), 0.5, C_BORDER),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
            ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ]))
        return t

    # ===== 4. 合同要素字段 =====
    def _build_fields(self, snap: ReportSnapshot, styles: dict):
        if not snap.fields:
            return _boxed_content(
                [Paragraph("（无抽取字段）", styles['body_small'])],
                colors.white, C_BORDER, styles,
            )
        rows = [[
            Paragraph("字段名称", styles['table_header']),
            Paragraph("字段值", styles['table_header']),
            Paragraph("字段名称", styles['table_header']),
            Paragraph("字段值", styles['table_header']),
        ]]
        fields = snap.fields
        for i in range(0, len(fields), 2):
            f1 = fields[i]
            f2 = fields[i + 1] if i + 1 < len(fields) else None
            v1 = f1.confirmedValue or f1.fieldValue or '—'
            rows.append([
                Paragraph(f1.fieldLabel, styles['cell']),
                Paragraph(str(v1), styles['cell']),
                Paragraph(f2.fieldLabel if f2 else '', styles['cell']),
                Paragraph(str(f2.confirmedValue or f2.fieldValue) if f2 else '', styles['cell']),
            ])
        col_widths = [3.5 * cm, 4.75 * cm, 3.5 * cm, 4.75 * cm]
        t = Table(rows, colWidths=col_widths, hAlign='LEFT', repeatRows=1)
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), C_PRIMARY),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, C_BG]),
            ('GRID', (0, 0), (-1, -1), 0.5, C_BORDER),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
            ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ]))
        return t

    # ===== 5. AI 审核结论摘要（卡片样式）=====
    def _build_ai_summary(self, snap: ReportSnapshot, styles: dict):
        content = Paragraph(snap.aiSummary, styles['summary'])
        return _card(
            title_text="AI 智能分析",
            title_color=C_AI,
            content_flowables=[Spacer(1, 2 * mm), content],
            content_bg=C_AI_BG,
            border_color=C_AI_BORDER,
            styles=styles,
            content_padding=14,
        )

    # ===== 6. 重大风险条款 =====
    def _build_major_risks(self, snap: ReportSnapshot, styles: dict):
        if not snap.majorRisks:
            return _boxed_content(
                [Paragraph("未发现重大风险", styles['body_small'])],
                C_LOW_BG, C_LEGAL_BORDER, styles,
            )
        header = [
            Paragraph("序号", styles['table_header']),
            Paragraph("风险标题", styles['table_header']),
            Paragraph("等级", styles['table_header']),
            Paragraph("条款位置", styles['table_header']),
            Paragraph("处理状态", styles['table_header']),
        ]
        rows = [header]
        for i, r in enumerate(snap.majorRisks, 1):
            level_label = RISK_LEVEL_LABEL.get(r.riskLevel, r.riskLevel)
            level_color = RISK_LEVEL_COLOR.get(r.riskLevel, colors.black)
            level_bg = RISK_LEVEL_BG.get(r.riskLevel, colors.white)
            level_border = RISK_LEVEL_BORDER.get(r.riskLevel, C_BORDER)
            status_label = RISK_STATUS_LABEL.get(r.status, r.status)
            status_color = RISK_STATUS_COLOR.get(r.status, C_TEXT_PRIMARY)
            # 等级 Tag（彩色文字 + 浅色背景 + 彩色边框）
            level_tag = _tag(level_label, level_color, level_bg, level_border, styles, font_size=9)
            status_tag = _tag(status_label, status_color, colors.white, C_BORDER, styles, font_size=8.5)
            rows.append([
                Paragraph(str(i), styles['cell']),
                Paragraph(r.title, styles['cell']),
                level_tag,
                Paragraph(f"{r.clauseNumber} {r.clauseTitle}", styles['cell_small']),
                status_tag,
            ])
        col_widths = [1 * cm, 4.8 * cm, 1.8 * cm, 6 * cm, 2.9 * cm]
        t = Table(rows, colWidths=col_widths, hAlign='LEFT', repeatRows=1)
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), C_HIGH),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, C_HIGH_BG]),
            ('GRID', (0, 0), (-1, -1), 0.5, C_BORDER),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN', (0, 0), (0, -1), 'CENTER'),
            ('ALIGN', (2, 0), (2, -1), 'CENTER'),
            ('ALIGN', (4, 0), (4, -1), 'CENTER'),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ]))
        return t

    # ===== 7. 逐条风险明细 =====
    def _build_all_risks(self, snap: ReportSnapshot, styles: dict):
        if not snap.risks:
            return _boxed_content(
                [Paragraph("未识别到风险", styles['body_small'])],
                C_LOW_BG, C_LEGAL_BORDER, styles,
            )
        header = [
            Paragraph("序号", styles['table_header']),
            Paragraph("风险信息", styles['table_header']),
            Paragraph("风险说明", styles['table_header']),
            Paragraph("修改建议", styles['table_header']),
            Paragraph("状态", styles['table_header']),
        ]
        rows = [header]
        for i, r in enumerate(snap.risks, 1):
            level_label = RISK_LEVEL_LABEL.get(r.riskLevel, r.riskLevel)
            level_color = RISK_LEVEL_COLOR.get(r.riskLevel, colors.black)
            level_bg = RISK_LEVEL_BG.get(r.riskLevel, colors.white)
            level_border = RISK_LEVEL_BORDER.get(r.riskLevel, C_BORDER)
            status_label = RISK_STATUS_LABEL.get(r.status, r.status)
            status_color = RISK_STATUS_COLOR.get(r.status, C_TEXT_PRIMARY)
            level_tag = _tag(level_label, level_color, level_bg, level_border, styles, font_size=8.5)
            status_tag = _tag(status_label, status_color, colors.white, C_BORDER, styles, font_size=8)
            risk_info = (
                f"<b>{r.title}</b><br/>"
                f"<font size='7' color='#8c8c8c'>{r.clauseNumber} {r.clauseTitle}</font>"
            )
            suggestion = r.editedSuggestion or r.suggestion or '—'
            rows.append([
                Paragraph(str(i), styles['cell_small']),
                [level_tag, Spacer(1, 1 * mm), Paragraph(risk_info, styles['cell_small'])],
                Paragraph(r.riskReason or '—', styles['cell_small']),
                Paragraph(suggestion, styles['cell_small']),
                status_tag,
            ])
        col_widths = [0.8 * cm, 4 * cm, 4.5 * cm, 4.5 * cm, 2.7 * cm]
        t = Table(rows, colWidths=col_widths, hAlign='LEFT', repeatRows=1)
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), C_PRIMARY),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, C_BG]),
            ('GRID', (0, 0), (-1, -1), 0.5, C_BORDER),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('ALIGN', (0, 0), (0, -1), 'CENTER'),
            ('ALIGN', (4, 0), (4, -1), 'CENTER'),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('LEFTPADDING', (0, 0), (-1, -1), 5),
            ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ]))
        return t

    # ===== 8. 人工审核结论（卡片 + 彩色 Tag）=====
    def _build_legal_conclusion(self, snap: ReportSnapshot, styles: dict):
        conclusion = snap.legalConclusion
        conclusion_label = LEGAL_CONCLUSION_LABEL.get(conclusion, conclusion)
        conclusion_desc = LEGAL_CONCLUSION_DESC.get(conclusion, '')
        conclusion_color = LEGAL_CONCLUSION_COLOR.get(conclusion, C_PRIMARY)
        conclusion_bg = LEGAL_CONCLUSION_BG.get(conclusion, colors.white)
        conclusion_border = LEGAL_CONCLUSION_BORDER.get(conclusion, C_BORDER)

        # 彩色 Tag（白字彩色背景，模拟网页 antd Tag color 效果）
        tag_style = ParagraphStyle(
            'LegalTag', parent=styles['cell_white_bold'],
            fontSize=11, leading=16,
        )
        tag = Table(
            [[Paragraph(f"<b>{conclusion_label}</b>", tag_style)]],
            colWidths=[4.5 * cm],
        )
        tag.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), conclusion_color),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ]))

        # desc 描述（与 Tag 同行）
        desc_para = Paragraph(
            f"<font color='{C_TEXT_SECONDARY.hexval()}'>{conclusion_desc}</font>",
            styles['body_small']
        )
        top_row = Table(
            [[tag, desc_para]],
            colWidths=[4.5 * cm, 11.5 * cm],
            hAlign='LEFT',
        )
        top_row.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN', (1, 0), (1, 0), 'LEFT'),
            ('LEFTPADDING', (1, 0), (1, 0), 12),
            ('LEFTPADDING', (0, 0), (0, 0), 0),
            ('RIGHTPADDING', (0, 0), (0, 0), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ]))

        # 法务意见标签
        opinion_label = Paragraph("<b>法务意见</b>", styles['cell_label'])
        opinion_para = Paragraph(snap.legalOpinion or '暂无法务意见', styles['summary'])

        return _card(
            title_text="人工审核结论",
            title_color=C_LOW,
            content_flowables=[
                Spacer(1, 3 * mm),
                top_row,
                Spacer(1, 5 * mm),
                opinion_label,
                Spacer(1, 2 * mm),
                opinion_para,
            ],
            content_bg=C_LEGAL_BG,
            border_color=C_LEGAL_BORDER,
            styles=styles,
            content_padding=14,
        )

    # ===== 9. 免责声明（卡片样式）=====
    def _build_disclaimer(self, snap: ReportSnapshot, styles: dict):
        content = Paragraph(snap.disclaimer, styles['disclaimer'])
        return _card(
            title_text="免责声明",
            title_color=C_WARN_BORDER,
            content_flowables=[Spacer(1, 3 * mm), content],
            content_bg=C_WARN_BG,
            border_color=C_WARN_BORDER,
            styles=styles,
            content_padding=14,
        )

    # ===== 10. 附件与留档 =====
    def _build_appendix(self, snap: ReportSnapshot, request: GeneratePdfRequest, styles: dict):
        data = [
            [Paragraph("审核报告编号", styles['cell_label']), Paragraph(request.reportNo, styles['cell'])],
            [Paragraph("报告版本", styles['cell_label']), Paragraph(f"v{request.versionNo}", styles['cell'])],
            [Paragraph("生成时间", styles['cell_label']), Paragraph(_format_generated_at(snap.generatedAt), styles['cell'])],
            [Paragraph("风险项总数", styles['cell_label']), Paragraph(f"{len(snap.risks)} 项", styles['cell'])],
            [Paragraph("重大风险数", styles['cell_label']), Paragraph(f"{len(snap.majorRisks)} 项", styles['cell'])],
        ]
        col_widths = [4 * cm, 12.5 * cm]
        t = Table(data, colWidths=col_widths, hAlign='LEFT')
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), C_BG),
            ('GRID', (0, 0), (-1, -1), 0.5, C_BORDER),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
            ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ]))
        # 底部签名行
        footer = Table(
            [[Paragraph(
                f"本报告由「契审智控 · AI采购合同审核平台」自动生成 · {_format_generated_at(snap.generatedAt)}",
                ParagraphStyle('Footer', parent=styles['body_small'],
                               fontName=FONT_NAME, fontSize=8,
                               textColor=C_TEXT_SECONDARY, alignment=TA_CENTER)
            )]],
            colWidths=[16.5 * cm],
        )
        footer.setStyle(TableStyle([
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('LINEABOVE', (0, 0), (-1, 0), 0.5, C_BORDER),
        ]))
        return Table([[t], [footer]], colWidths=[16.5 * cm], hAlign='LEFT')


# 单例
report_pdf_service = ReportPDFService()
