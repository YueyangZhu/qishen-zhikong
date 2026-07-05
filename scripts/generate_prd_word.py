# -*- coding: utf-8 -*-
"""
生成《契审智控｜AI 采购合同审核平台 PRD V3.0》Word 文档
- 产品向 PRD，对齐 V2.0 写作风格（去技术化、业务语言描述）
- 嵌入 docs/screenshots/ 下的 12 张页面截图
- 全文字体：宋体（中文）+ Calibri（英文/数字）
"""
import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn, nsmap
from docx.oxml import OxmlElement

# ===== 路径配置 =====
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCREENSHOT_DIR = os.path.join(ROOT, 'docs', 'screenshots')
OUTPUT_PATH = os.path.join(ROOT, 'docs', 'PRD需求文档_V3.0.docx')

# ===== 字体常量（用户偏好宋体） =====
FONT_CN = '宋体'
FONT_EN = 'Calibri'

# ===== 颜色 =====
COLOR_PRIMARY = RGBColor(0x16, 0x77, 0xff)
COLOR_HIGH = RGBColor(0xf5, 0x22, 0x2d)
COLOR_MEDIUM = RGBColor(0xfa, 0x8c, 0x16)
COLOR_LOW = RGBColor(0x52, 0xc4, 0x1a)
COLOR_NOTICE = RGBColor(0x7c, 0x86, 0x96)
COLOR_AI = RGBColor(0x13, 0xc2, 0xc2)
COLOR_TEXT = RGBColor(0x1d, 0x21, 0x29)
COLOR_TEXT_SECONDARY = RGBColor(0x5b, 0x64, 0x70)
COLOR_BG_HEADER = RGBColor(0xf0, 0xf5, 0xff)
COLOR_BG_WARNING = RGBColor(0xff, 0xfb, 0xe6)

# ============================================================
# 工具函数
# ============================================================

def set_run_font(run, size=11, bold=False, color=None, font_cn=FONT_CN, font_en=FONT_EN):
    """统一设置 Run 字体（中英文分别设置）"""
    run.font.name = font_en
    run.font.size = Pt(size)
    run.font.bold = bold
    if color is not None:
        run.font.color.rgb = color
    # 设置中文字体（east-asia）
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = OxmlElement('w:rFonts')
        rPr.append(rFonts)
    rFonts.set(qn('w:eastAsia'), font_cn)
    rFonts.set(qn('w:ascii'), font_en)
    rFonts.set(qn('w:hAnsi'), font_en)


def add_paragraph(doc, text='', size=11, bold=False, color=None, align=None,
                  space_before=0, space_after=4, line_spacing=1.5, indent=None):
    """添加普通段落"""
    p = doc.add_paragraph()
    if align is not None:
        p.alignment = align
    pf = p.paragraph_format
    pf.space_before = Pt(space_before)
    pf.space_after = Pt(space_after)
    pf.line_spacing = line_spacing
    if indent is not None:
        pf.left_indent = Cm(indent)
    if text:
        run = p.add_run(text)
        set_run_font(run, size=size, bold=bold, color=color)
    return p


def add_heading(doc, text, level=1):
    """添加标题（一级/二级/三级）"""
    sizes = {1: 20, 2: 16, 3: 13, 4: 12}
    colors = {1: COLOR_PRIMARY, 2: COLOR_PRIMARY, 3: COLOR_TEXT, 4: COLOR_TEXT}
    size = sizes.get(level, 12)
    color = colors.get(level, COLOR_TEXT)
    p = doc.add_paragraph()
    p.style = doc.styles[f'Heading {level}']
    pf = p.paragraph_format
    pf.space_before = Pt(12 if level <= 2 else 8)
    pf.space_after = Pt(6)
    pf.line_spacing = 1.4
    run = p.add_run(text)
    set_run_font(run, size=size, bold=True, color=color)
    return p


def set_cell_background(cell, color_hex):
    """设置单元格背景色"""
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), color_hex)
    tcPr.append(shd)


def set_cell_borders(cell):
    """设置单元格边框"""
    tcPr = cell._tc.get_or_add_tcPr()
    tcBorders = OxmlElement('w:tcBorders')
    for border_name in ['top', 'left', 'bottom', 'right']:
        border = OxmlElement(f'w:{border_name}')
        border.set(qn('w:val'), 'single')
        border.set(qn('w:sz'), '4')
        border.set(qn('w:color'), 'CCCCCC')
        tcBorders.append(border)
    tcPr.append(tcBorders)


def add_cell_text(cell, text, bold=False, size=10, color=None, align=None):
    """单元格内添加文字"""
    cell.text = ''
    p = cell.paragraphs[0]
    if align is not None:
        p.alignment = align
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.2
    # 支持多行
    lines = str(text).split('\n')
    for i, line in enumerate(lines):
        if i > 0:
            p.add_run().add_break()
        run = p.add_run(line)
        set_run_font(run, size=size, bold=bold, color=color)
    cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER


def add_table(doc, headers, rows, col_widths=None, header_bg='F0F5FF',
              header_color=COLOR_PRIMARY, font_size=10):
    """添加表格"""
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False

    # 设置列宽
    if col_widths:
        for i, w in enumerate(col_widths):
            for cell in table.columns[i].cells:
                cell.width = Cm(w)

    # 表头
    for i, h in enumerate(headers):
        cell = table.rows[0].cells[i]
        add_cell_text(cell, h, bold=True, size=font_size, color=header_color,
                      align=WD_ALIGN_PARAGRAPH.CENTER)
        set_cell_background(cell, header_bg)
        set_cell_borders(cell)

    # 数据行
    for r_idx, row in enumerate(rows):
        for i, val in enumerate(row):
            cell = table.rows[r_idx + 1].cells[i]
            add_cell_text(cell, val, size=font_size)
            set_cell_borders(cell)
            # 隔行变色
            if r_idx % 2 == 1:
                set_cell_background(cell, 'FAFBFC')
    return table


def add_image(doc, image_path, width_cm=15, caption=None):
    """添加图片 + 图注"""
    if not os.path.exists(image_path):
        add_paragraph(doc, f'[图片缺失: {os.path.basename(image_path)}]',
                      size=10, color=COLOR_HIGH, align=WD_ALIGN_PARAGRAPH.CENTER)
        return
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(2)
    run = p.add_run()
    run.add_picture(image_path, width=Cm(width_cm))
    if caption:
        cap = doc.add_paragraph()
        cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        cap.paragraph_format.space_after = Pt(10)
        cap_run = cap.add_run(caption)
        set_run_font(cap_run, size=9, color=COLOR_TEXT_SECONDARY)


def add_callout(doc, text, color_hex='FFFBE6', border_color='FAAD14'):
    """添加提示框（带背景色的段落）"""
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = table.rows[0].cells[0]
    cell.width = Cm(16)
    set_cell_background(cell, color_hex)
    # 边框
    tcPr = cell._tc.get_or_add_tcPr()
    tcBorders = OxmlElement('w:tcBorders')
    for b in ['top', 'left', 'bottom', 'right']:
        border = OxmlElement(f'w:{b}')
        border.set(qn('w:val'), 'single')
        border.set(qn('w:sz'), '8')
        border.set(qn('w:color'), border_color)
        tcBorders.append(border)
    tcPr.append(tcBorders)
    cell.text = ''
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(4)
    run = p.add_run(text)
    set_run_font(run, size=10, color=COLOR_TEXT)
    add_paragraph(doc, '', size=2, space_after=4)


def add_bullet(doc, text, size=11, indent=0.5):
    """添加项目符号段落"""
    p = doc.add_paragraph(style='List Bullet')
    p.paragraph_format.left_indent = Cm(indent)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.4
    run = p.add_run(text)
    set_run_font(run, size=size)


def add_page_break(doc):
    doc.add_page_break()


def add_horizontal_line(doc):
    """添加分隔线（一段带底边的空段）"""
    p = doc.add_paragraph()
    pPr = p._element.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '6')
    bottom.set(qn('w:color'), 'CCCCCC')
    pBdr.append(bottom)
    pPr.append(pBdr)


# ============================================================
# 文档样式初始化
# ============================================================

def init_document():
    doc = Document()

    # 页面边距
    for section in doc.sections:
        section.top_margin = Cm(2.2)
        section.bottom_margin = Cm(2.2)
        section.left_margin = Cm(2.2)
        section.right_margin = Cm(2.2)

    # 设置默认样式字体
    style = doc.styles['Normal']
    style.font.name = FONT_EN
    style.font.size = Pt(11)
    rPr = style.element.get_or_add_rPr()
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = OxmlElement('w:rFonts')
        rPr.append(rFonts)
    rFonts.set(qn('w:eastAsia'), FONT_CN)

    # Heading 样式
    for level in [1, 2, 3, 4]:
        h_style = doc.styles[f'Heading {level}']
        h_style.font.name = FONT_EN
        hPr = h_style.element.get_or_add_rPr()
        hFonts = hPr.find(qn('w:rFonts'))
        if hFonts is None:
            hFonts = OxmlElement('w:rFonts')
            hPr.append(hFonts)
        hFonts.set(qn('w:eastAsia'), FONT_CN)

    return doc


# ============================================================
# 各章节内容生成
# ============================================================

def build_cover(doc):
    """封面"""
    # 顶部留白
    for _ in range(5):
        add_paragraph(doc, '', size=14, space_after=0)

    # 主标题
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run('契审智控')
    set_run_font(run, size=42, bold=True, color=COLOR_PRIMARY)

    # 副标题
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run('AI 采购合同审核平台')
    set_run_font(run, size=22, bold=False, color=COLOR_TEXT)

    add_paragraph(doc, '', size=10, space_after=20)

    # 文档标题
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run('产品需求规格说明书')
    set_run_font(run, size=24, bold=True, color=COLOR_TEXT)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run('PRD V3.0')
    set_run_font(run, size=20, bold=True, color=COLOR_AI)

    add_paragraph(doc, '', size=10, space_after=40)

    # 信息表
    table = doc.add_table(rows=6, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    info = [
        ('文档版本', 'V3.0'),
        ('编写日期', '2026-07-05'),
        ('文档状态', '已实现阶段 2（真实 AI + 真实后端）'),
        ('文档定位', '与系统页面一一对应的产品需求规格说明，包含页面元素清单、交互逻辑、状态流转与系统截图'),
        ('适用范围', 'AI 产品经理求职作品集展示、项目交接说明'),
        ('与 V2.0 差异', 'V2.0 描述第一阶段 Mock 实现；V3.0 补充阶段 2 真实 AI 接入后的全部能力，写作风格延续 V2.0 产品向、去技术化'),
    ]
    for i, (k, v) in enumerate(info):
        c1 = table.rows[i].cells[0]
        c2 = table.rows[i].cells[1]
        c1.width = Cm(4)
        c2.width = Cm(12)
        add_cell_text(c1, k, bold=True, size=11, color=COLOR_PRIMARY)
        add_cell_text(c2, v, size=11)
        set_cell_borders(c1)
        set_cell_borders(c2)
        set_cell_background(c1, 'F0F5FF')

    add_page_break(doc)


def build_toc(doc):
    """目录（手动列出，非 Word 自动目录）"""
    add_heading(doc, '目录', level=1)
    add_horizontal_line(doc)

    toc_items = [
        '一、产品概述',
        '二、角色与权限',
        '三、统一规范',
        '    3.1 设计 Token',
        '    3.2 风险等级映射',
        '    3.3 审核任务状态',
        '    3.4 风险处理状态',
        '    3.5 通用规范',
        '    3.6 技术栈概览',
        '四、全局布局',
        '五、页面清单与路由',
        'P01 登录页',
        'P02 工作台',
        'P03 合同审核列表',
        'P04 新建审核任务',
        'P05 审核处理进度页',
        'P06 合同信息字段确认页',
        'P07 合同审核详情页',
        'P08 法务复核页',
        'P09 审核报告列表',
        'P10 审核报告详情',
        'P11 审核记录',
        'P12 风险规则库',
        '六、核心业务状态机',
        '七、核心业务流程',
        '八、演示主流程',
        '九、当前阶段边界',
    ]
    for item in toc_items:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.line_spacing = 1.5
        run = p.add_run(item)
        set_run_font(run, size=11,
                     bold=not item.startswith('    '),
                     color=COLOR_TEXT if item.startswith('    ') else COLOR_PRIMARY)

    add_page_break(doc)


def build_chapter_1_overview(doc):
    """一、产品概述"""
    add_heading(doc, '一、产品概述', level=1)

    add_heading(doc, '1.1 产品定位', level=2)
    add_paragraph(doc,
                  '契审智控 是一款面向企业采购合同审核场景的 AI 辅助审核平台。系统融合规则引擎与大模型语义分析，'
                  '覆盖合同解析、字段抽取、风险识别、原文定位、修改建议、人工确认、法务复核、报告生成的完整闭环。')

    add_heading(doc, '1.2 核心业务流程', level=2)
    add_callout(doc,
                '上传合同 → 文档解析 → 字段抽取 → 规则引擎检查 → AI 语义审核\n'
                '→ 风险原文定位 → 生成风险说明与修改建议 → 业务人员逐条处理\n'
                '→ 提交法务复核 → 法务确认 → 生成审核报告 → 审核记录留档',
                color_hex='E6F7FF', border_color='1677FF')

    add_heading(doc, '1.3 当前实现阶段', level=2)
    add_table(doc,
              ['维度', '状态'],
              [
                  ['前端 12 个页面', '✅ 全部实现'],
                  ['真实 DeepSeek AI 接入', '✅ 已接入（字段抽取 + 风险审核）'],
                  ['真实 Supabase 后端', '✅ 已接入（Postgres + Auth + Storage）'],
                  ['真实文件解析', '✅ pdfplumber / python-docx / mammoth'],
                  ['PDF 报告生成', '✅ Playwright 无头 Chromium（视觉与网页一致）'],
                  ['浏览器打印导出', '✅ 兜底方案'],
                  ['OCR 扫描件支持', '❌ 不支持（仅文字型 PDF）'],
                  ['Word 红线修订导出', '❌ 未实现'],
                  ['电子签章 / 复杂审批流', '❌ 未实现'],
                  ['履约管理', '❌ 未实现'],
              ],
              col_widths=[6, 10])

    add_heading(doc, '1.4 系统免责声明', level=2)
    add_callout(doc,
                '本系统审核结果由 AI 辅助生成，仅供合同初审参考，不构成正式法律意见，最终结论应由专业人员确认。',
                color_hex='FFFBE6', border_color='FAAD14')
    add_paragraph(doc, '免责声明展示位置：登录页底部、全局左侧导航底部、审核进度页底部、审核报告详情页底部。',
                  size=10, color=COLOR_TEXT_SECONDARY)

    add_page_break(doc)


def build_chapter_2_roles(doc):
    """二、角色与权限"""
    add_heading(doc, '二、角色与权限', level=1)

    add_heading(doc, '2.1 角色定义', level=2)
    add_table(doc,
              ['角色', '标识', '演示账号', '主要职责'],
              [
                  ['采购业务人员', 'purchaser', 'purchaser@qszk.com / 123456', '发起审核、处理风险、提交复核'],
                  ['法务审核人员', 'legal', 'legal@qszk.com / 123456', '法务复核、修改建议、出具结论'],
                  ['系统管理员', 'admin', 'admin@qszk.com / 123456', '全部权限 + 规则库管理'],
              ],
              col_widths=[3, 2.5, 5, 5.5])

    add_heading(doc, '2.2 权限矩阵', level=2)
    add_table(doc,
              ['功能', 'purchaser', 'legal', 'admin'],
              [
                  ['工作台', '✅', '✅', '✅'],
                  ['新建审核', '✅', '❌', '❌'],
                  ['查看审核列表', '✅', '✅（菜单名「合同复核」）', '✅'],
                  ['字段确认（编辑）', '✅', '只读', '只读'],
                  ['风险处理（接受/编辑/忽略/转人工）', '✅', '❌', '❌'],
                  ['提交法务复核', '✅', '❌', '❌'],
                  ['法务复核操作', '❌', '✅', '❌'],
                  ['生成报告', '✅', '✅', '✅'],
                  ['规则库管理', '只读', '✅（只读+管理）', '✅'],
                  ['角色切换', '✅', '✅', '✅'],
                  ['重置演示数据', '✅', '✅', '✅'],
              ],
              col_widths=[6, 3.5, 3.5, 3])

    add_page_break(doc)


def build_chapter_3_spec(doc):
    """三、统一规范"""
    add_heading(doc, '三、统一规范', level=1)

    add_heading(doc, '3.1 设计 Token', level=2)
    add_table(doc,
              ['Token', '色值', '用途'],
              [
                  ['primary', '#1677ff', '主色 专业蓝'],
                  ['ai', '#13c2c2', 'AI 辅助色 青绿'],
                  ['bg', '#f5f7fa', '背景 浅灰白'],
                  ['card', '#ffffff', '卡片背景'],
                  ['border', '#e8ecf0', '边框'],
                  ['textPrimary', '#1d2129', '主文字'],
                  ['textSecondary', '#5b6470', '次要文字'],
                  ['high', '#f5222d', '高风险 红'],
                  ['medium', '#fa8c16', '中风险 橙'],
                  ['low', '#52c41a', '低风险 绿'],
                  ['notice', '#7c8696', '提示项 蓝灰'],
              ],
              col_widths=[4, 4, 8])

    add_heading(doc, '3.2 风险等级映射（全局唯一）', level=2)
    add_table(doc,
              ['值', '中文', '色值', '背景色', '含义'],
              [
                  ['high', '高风险', '#f5222d', '#fff1f0', '必须人工确认，未处理不得生成报告'],
                  ['medium', '中风险', '#fa8c16', '#fff7e6', '建议处理'],
                  ['low', '低风险', '#52c41a', '#f6ffed', '可批量处理'],
                  ['notice', '提示项', '#7c8696', '#f0f5ff', '不阻断流程'],
              ],
              col_widths=[2, 2, 3, 3, 6])

    add_heading(doc, '3.3 审核任务状态（全局唯一）', level=2)
    add_paragraph(doc, 'draft 草稿 / parsing 解析中 / ai_reviewing AI审核中 / pending_business 待人工确认 / '
                       'pending_legal 待法务复核 / completed 已完成 / failed 失败',
                  size=11, color=COLOR_TEXT)

    add_heading(doc, '3.4 风险处理状态（全局唯一）', level=2)
    add_paragraph(doc, 'pending 待处理 / accepted 已接受 / edited 已编辑 / ignored 已忽略 / '
                       'manual_review 转人工复核 / confirmed 已确认',
                  size=11, color=COLOR_TEXT)

    add_heading(doc, '3.5 通用规范', level=2)
    rules = [
        '主色蓝 + AI 青绿辅助；浅色背景；企业级 B 端 SaaS 风格',
        '1366×768 核心内容可用，三栏审核页不出现横向滚动',
        '所有按钮三种归宿：真实执行 / 跳真实页面 / 明确提示「当前版本暂未开放」',
        '关键操作：表单校验、成功/失败提示、二次确认、加载态、防重复提交、空/错状态',
        '表单防抖 300ms；列表筛选写 URL；危险操作二次确认',
        '风险明细表网页端不出现左右滚动条，内容自动换行不省略',
        '返回按钮统一在左上角',
        '所有显示时间统一 YYYY-MM-DD HH:mm:ss 格式',
        '乐观更新 + 失败回滚（风险处理、法务复核）',
        '列宽可调，列宽持久化本地存储',
    ]
    for r in rules:
        add_bullet(doc, r)

    add_heading(doc, '3.6 技术栈概览', level=2)
    add_paragraph(doc, '系统采用前后端分离架构，前端负责界面交互，后端负责业务编排与 AI 调用，'
                       '云服务提供数据持久化与对象存储。技术选型如下：', size=11)
    add_table(doc,
              ['类别', '技术'],
              [
                  ['前端', 'React + TypeScript + Vite + Ant Design + Zustand + React Router'],
                  ['后端', 'Python + FastAPI + Pydantic + uvicorn'],
                  ['AI', 'DeepSeek 大模型（OpenAI 兼容接口）'],
                  ['数据存储', 'Supabase Postgres + Supabase Storage'],
                  ['文档解析', 'pdfplumber + python-docx + mammoth + PyMuPDF'],
                  ['PDF 生成', 'Playwright 无头 Chromium'],
                  ['图表', 'ECharts'],
                  ['状态管理', 'Zustand + localStorage'],
              ],
              col_widths=[4, 12])

    add_page_break(doc)


def build_chapter_4_layout(doc):
    """四、全局布局"""
    add_heading(doc, '四、全局布局', level=1)

    add_heading(doc, '4.1 整体结构', level=2)
    add_bullet(doc, '左侧固定侧边栏（宽 220px，可折叠，宽屏以下自动收起）')
    add_bullet(doc, '顶部工具栏（高 56px，吸顶）')
    add_bullet(doc, '主内容区（统一 20px 内边距）')

    add_heading(doc, '4.2 侧边栏元素', level=2)
    add_table(doc,
              ['元素', '内容'],
              [
                  ['Logo', '盾牌图标 + "契审智控" 主标题 + "AI 采购合同审核" 副标题'],
                  ['菜单项（按角色动态构建）', '工作台 / 合同审核 / 审核报告 / 风险规则库'],
                  ['采购人员额外菜单', '"新建审核"插在第 2 位'],
                  ['法务角色菜单差异', '"合同审核"改名为"合同复核"，图标改为天平'],
                  ['底部免责声明', '黄色背景卡片，展示 AI 审核免责声明全文'],
              ],
              col_widths=[5, 11])

    add_heading(doc, '4.3 顶栏元素', level=2)
    add_table(doc,
              ['元素', '内容/行为'],
              [
                  ['折叠按钮', '图标按钮，控制侧边栏展开/收起'],
                  ['"AI 辅助"标签', '青绿色标签，鼠标悬停提示"AI 辅助审核"'],
                  ['角色描述', '当前登录用户的角色文字描述'],
                  ['用户菜单', '头像（首字母圆）+ 姓名 + 角色标签 + 下拉箭头'],
                  ['用户菜单-切换演示角色', '采购人员 / 法务 / 管理员三个角色，当前角色标记"当前"标签；切换后刷新到工作台'],
                  ['用户菜单-重置演示数据', '重置演示环境数据并刷新页面'],
                  ['用户菜单-退出登录', '二次确认弹窗，确认后退出并跳转登录页'],
              ],
              col_widths=[5, 11])

    add_heading(doc, '4.4 浏览器标签页标题', level=2)
    add_paragraph(doc, '根据当前路由动态设置浏览器标签页标题，覆盖：工作台 / 合同审核 / 新建审核任务 / '
                       '审核进度 / 字段确认 / 审核记录 / 审核详情 / 法务复核 / 审核报告 / 报告详情。')

    add_page_break(doc)


def build_chapter_5_routes(doc):
    """五、页面清单与路由"""
    add_heading(doc, '五、页面清单与路由', level=1)
    add_table(doc,
              ['编号', '页面名称', '路由', '访问条件', '截图'],
              [
                  ['P01', '登录页', '/login', '未登录', 'P01-登录页.png'],
                  ['P02', '工作台', '/dashboard', '已登录', 'P02-工作台.png'],
                  ['P03', '合同审核列表', '/reviews', '已登录', 'P03-审核列表.png'],
                  ['P04', '新建审核任务', '/reviews/new', '采购人员', 'P04-新建审核-上传.png'],
                  ['P05', '审核处理进度页', '/reviews/:id/progress', '已登录', 'P05-审核进度.png'],
                  ['P06', '字段确认页', '/reviews/:id/fields', '已登录', 'P06-字段确认.png'],
                  ['P07', '合同审核详情页', '/reviews/:id', '已登录', 'P07-审核详情三栏.png'],
                  ['P08', '法务复核页', '/legal-reviews/:id', '法务角色', 'P08-法务复核.png'],
                  ['P09', '审核报告列表', '/reports', '已登录', 'P09-报告列表.png'],
                  ['P10', '审核报告详情', '/reports/:id', '已登录', 'P10-报告详情.png'],
                  ['P11', '审核记录', '/reviews/:id/history', '已登录', 'P11-审核记录.png'],
                  ['P12', '风险规则库', '/rules', '已登录', 'P12-风险规则库.png'],
              ],
              col_widths=[1.5, 4, 4.5, 3, 4])
    add_page_break(doc)


# ============================================================
# P01-P12 详细页面章节
# ============================================================

def build_p01(doc):
    """P01 登录页"""
    add_heading(doc, 'P01 登录页', level=1)
    add_paragraph(doc, '路由：/login    ｜    访问条件：未登录',
                  size=10, color=COLOR_TEXT_SECONDARY)

    add_image(doc, os.path.join(SCREENSHOT_DIR, 'P01-登录页.png'),
              width_cm=15, caption='图 P01-1 登录页完整截图')

    add_heading(doc, '页面元素', level=2)

    add_heading(doc, '左侧品牌介绍区', level=3)
    add_bullet(doc, '产品 Logo（盾牌图标 + 渐变背景方块 48×48）')
    add_bullet(doc, '产品名称：契审智控')
    add_bullet(doc, '产品副标题：AI 采购合同审核平台')
    add_bullet(doc, '主标题：让每一份采购合同都经过智能审核')
    add_bullet(doc, '产品简介段落（一句话说明平台定位与价值）')
    add_bullet(doc, '3 个能力卡片（智能解析 / AI 语义审核 / 原文定位）')

    add_heading(doc, '右侧登录卡片（宽 420px）', level=3)
    add_bullet(doc, '标题：欢迎登录')
    add_bullet(doc, '副标题：请使用演示账号登录体验完整审核流程')
    add_bullet(doc, '账号输入框（邮箱格式校验）')
    add_bullet(doc, '密码输入框（带显隐切换）')
    add_bullet(doc, '登录按钮（加载态防重复提交）')
    add_bullet(doc, '分割线：演示账号（点击填充）')
    add_bullet(doc, '3 个演示账号卡片（点击一键填充邮箱密码）')
    add_bullet(doc, '底部黄色免责声明提示框')

    add_heading(doc, '交互逻辑', level=2)
    add_table(doc,
              ['交互', '行为'],
              [
                  ['点击演示账号', '自动填充邮箱密码，选中态高亮（蓝色边框 + 浅蓝背景）'],
                  ['提交登录', '校验邮箱格式 + 必填项 → 调用登录接口 → 成功跳转工作台，失败提示'],
                  ['登录态校验', '已登录用户访问登录页自动跳转到工作台'],
                  ['路由守卫', '未登录访问受保护路由自动跳转到登录页'],
              ],
              col_widths=[4, 12])

    add_heading(doc, '校验规则', level=2)
    add_bullet(doc, '账号：必填，邮箱格式')
    add_bullet(doc, '密码：必填')
    add_bullet(doc, '错误账号密码提示：「账号或密码错误，请使用演示账号登录」')

    add_page_break(doc)


def build_p02(doc):
    """P02 工作台"""
    add_heading(doc, 'P02 工作台', level=1)
    add_paragraph(doc, '路由：/dashboard    ｜    访问条件：已登录',
                  size=10, color=COLOR_TEXT_SECONDARY)

    add_image(doc, os.path.join(SCREENSHOT_DIR, 'P02-工作台.png'),
              width_cm=15, caption='图 P02-1 工作台完整截图')

    add_heading(doc, '页面元素', level=2)

    add_heading(doc, '欢迎信息条（渐变背景卡片）', level=3)
    add_bullet(doc, '时段问候语（早上好 / 上午好 / 中午好 / 下午好 / 晚上好）+ 用户姓名')
    add_bullet(doc, '用户角色描述')
    add_bullet(doc, '今日待办任务数提示')
    add_bullet(doc, '右侧「新建审核」主按钮（仅采购人员显示）')

    add_heading(doc, '4 个指标卡（点击跳转对应列表筛选）', level=3)
    add_table(doc,
              ['指标', '含义', '跳转目标'],
              [
                  ['待我处理', '当前用户待处理任务数', '按角色跳转到对应待办列表筛选'],
                  ['审核中合同', 'AI 审核中任务数', '审核中状态筛选'],
                  ['高风险合同', '含高风险等级的合同数', '高风险等级筛选'],
                  ['累计完成', '累计完成任务数', '已完成状态筛选'],
              ],
              col_widths=[3, 6, 7])

    add_heading(doc, '审核趋势图（折线图）', level=3)
    add_bullet(doc, 'X 轴：最近 6 个月')
    add_bullet(doc, '双折线：发起数（蓝）/ 完成数（绿）')

    add_heading(doc, '风险等级分布（饼图）', level=3)
    add_bullet(doc, '按风险等级（高 / 中 / 低 / 提示）统计所有审核任务的风险项总数')
    add_bullet(doc, '悬停提示该项统计口径说明')

    add_heading(doc, '最近审核任务列表', level=3)
    add_bullet(doc, '展示最近 6 条任务')
    add_bullet(doc, '每条：合同名称、状态标签、风险等级标签、相对方、金额、更新时间、创建人')
    add_bullet(doc, '点击跳转详情页')
    add_bullet(doc, '右上角「查看全部」入口')

    add_heading(doc, '待办事项列表', level=3)
    add_bullet(doc, '仅显示当前用户角色需要处理的任务')
    add_bullet(doc, '法务角色显示待复核任务')
    add_bullet(doc, '点击按角色跳转（法务跳法务复核页，其他跳详情页）')

    add_heading(doc, '快捷入口', level=3)
    add_bullet(doc, '新建审核（采购人员）')
    add_bullet(doc, '合同审核（采购人员 / 法务 / 管理员）')
    add_bullet(doc, '法务复核（法务）')
    add_bullet(doc, '风险规则（法务 / 管理员）')

    add_heading(doc, '数据逻辑', level=2)
    add_bullet(doc, '所有数据来自统一数据源，与列表、详情同源')
    add_bullet(doc, '指标卡数据实时计算，不缓存')
    add_bullet(doc, '趋势数据为最近 6 个月聚合')
    add_bullet(doc, '风险分布基于所有任务的风险项聚合')

    add_page_break(doc)


def build_p03(doc):
    """P03 合同审核列表"""
    add_heading(doc, 'P03 合同审核列表', level=1)
    add_paragraph(doc, '路由：/reviews    ｜    访问条件：已登录',
                  size=10, color=COLOR_TEXT_SECONDARY)

    add_image(doc, os.path.join(SCREENSHOT_DIR, 'P03-审核列表.png'),
              width_cm=15, caption='图 P03-1 合同审核列表完整截图')

    add_heading(doc, '页面元素', level=2)

    add_heading(doc, '页面头', level=3)
    add_bullet(doc, '标题：合同审核')
    add_bullet(doc, '描述：查看与处理所有采购合同审核任务，支持按状态、风险等级、合同类型筛选')
    add_bullet(doc, '「新建审核」按钮（仅采购人员显示）')

    add_heading(doc, '筛选区', level=3)
    add_bullet(doc, '关键词搜索框（合同名称 / 编号 / 相对方 / 类型 / 发起人 / 部门 / 备注）')
    add_bullet(doc, '审核状态多选')
    add_bullet(doc, '风险等级多选')
    add_bullet(doc, '合同类型单选（软件 / 硬件 / 服务 / 系统集成 / 设备租赁）')
    add_bullet(doc, '创建时间范围选择器')
    add_bullet(doc, '重置按钮（有筛选条件时显示）')
    add_bullet(doc, '仅看我创建的任务时显示提示条')

    add_heading(doc, '表格列', level=3)
    add_table(doc,
              ['列名', '说明'],
              [
                  ['合同名称', '合同名（加粗）+ 编号（灰色小字），点击进入详情'],
                  ['相对方', '—'],
                  ['合同金额', '货币格式化'],
                  ['合同类型', '彩色标签'],
                  ['审核状态', '状态标签'],
                  ['最高风险等级', '风险标签（含圆点），无风险显示 —'],
                  ['风险数量', '高 / 中 / 低分色数字标签'],
                  ['发起人', '—'],
                  ['更新时间', '格式化日期时间'],
                  ['操作', '详情 / 进度 / 复核 / 报告 / 删除（按状态动态显示）'],
              ],
              col_widths=[4, 12])

    add_heading(doc, '操作按钮（按状态动态显示）', level=3)
    add_bullet(doc, '详情：跳转审核详情页')
    add_bullet(doc, '进度：跳转审核进度页（审核中状态显示）')
    add_bullet(doc, '复核：跳转法务复核页（待法务复核状态显示）')
    add_bullet(doc, '报告：已生成报告跳转报告详情，否则提示')
    add_bullet(doc, '删除：仅草稿状态可删，二次确认')

    add_heading(doc, '交互逻辑', level=2)
    add_table(doc,
              ['行为', '流程'],
              [
                  ['筛选', '条件变化自动重新加载（防抖 300ms），筛选状态同步 URL，刷新可恢复'],
                  ['空状态', '空状态组件 + 「新建审核」按钮'],
                  ['加载状态', '骨架屏占位'],
                  ['删除', '弹窗二次确认'],
                  ['分页', '每页 10 条，支持切换每页条数与显示总数'],
              ],
              col_widths=[4, 12])

    add_heading(doc, '权限控制', level=2)
    add_bullet(doc, '新建审核按钮：仅采购人员显示')
    add_bullet(doc, '删除：仅创建人本人 + 草稿状态可删')
    add_bullet(doc, '法务角色菜单名变为「合同复核」，可看全部任务但不能新建')

    add_page_break(doc)


def build_p04(doc):
    """P04 新建审核任务"""
    add_heading(doc, 'P04 新建审核任务', level=1)
    add_paragraph(doc, '路由：/reviews/new（支持草稿编辑模式）    ｜    访问权限：仅采购人员',
                  size=10, color=COLOR_TEXT_SECONDARY)

    add_image(doc, os.path.join(SCREENSHOT_DIR, 'P04-新建审核-上传.png'),
              width_cm=15, caption='图 P04-1 新建审核任务（第一步上传）截图')

    add_heading(doc, '页面元素', level=2)

    add_heading(doc, '页面头', level=3)
    add_bullet(doc, '标题：草稿模式显示「编辑草稿任务」，否则显示「新建审核任务」')

    add_heading(doc, '步骤指示器（3 步）', level=3)
    add_table(doc,
              ['步骤', '标题', '描述'],
              [
                  ['1', '上传合同', 'PDF / DOCX'],
                  ['2', '填写审核信息', '合同要素'],
                  ['3', '确认并发起', '开始 AI 审核'],
              ],
              col_widths=[2, 4, 10])

    add_heading(doc, '第一步：上传合同', level=3)
    add_bullet(doc, '拖拽上传区（支持点击选择）')
    add_bullet(doc, '文件类型限制：PDF / DOCX')
    add_bullet(doc, '文件大小限制：10MB')
    add_bullet(doc, '上传成功后显示文件卡片（名称、大小、格式标签、替换/移除按钮）')
    add_bullet(doc, '演示合同快捷选择区（2 列网格，每张卡片显示合同名、类型、风险数、相对方、金额）')
    add_bullet(doc, '选中演示合同后自动带入合同基本信息')

    add_heading(doc, '第二步：填写审核信息', level=3)
    add_bullet(doc, '合同名称（必填，最多 80 字，带字数统计）')
    add_bullet(doc, '合同类型（必选，5 类）')
    add_bullet(doc, '我方身份（甲方 / 乙方，必选）')
    add_bullet(doc, '相对方（必填，最多 60 字）')
    add_bullet(doc, '所属部门（必选：采购部 / 信息技术部 / 法务部 / 财务部 / 运营部 / 行政部）')
    add_bullet(doc, '合同金额（数字输入，必填）')
    add_bullet(doc, '审核重点（多选，必填，8 类：合同主体 / 付款条款 / 交付与验收 / 违约责任 / 知识产权 / 保密与数据安全 / 合同解除 / 争议解决）')
    add_bullet(doc, '补充说明（多行文本，选填，最多 300 字）')

    add_heading(doc, '第三步：确认并发起', level=3)
    add_bullet(doc, '文件信息摘要（文件名 / 大小 / 格式）')
    add_bullet(doc, '审核信息摘要（全部字段，审核重点以标签展示）')
    add_bullet(doc, '提示条：演示合同提示 Mock 流程，上传合同提示调用真实 AI')
    add_bullet(doc, 'AI 审核免责声明（黄色提示条）')
    add_bullet(doc, '「返回修改」按钮')
    add_bullet(doc, '「保存草稿」按钮（创建草稿状态任务，跳转列表）')
    add_bullet(doc, '「开始 AI 审核」按钮（创建任务并跳转进度页）')

    add_heading(doc, '交互逻辑', level=2)
    add_table(doc,
              ['行为', '流程'],
              [
                  ['上传校验', '非 PDF/DOCX 拒绝；超 10MB 拒绝'],
                  ['选择演示合同', '自动填充合同基本信息到表单'],
                  ['保存草稿', '创建草稿状态任务并跳转列表，手动上传文件暂存到浏览器本地'],
                  ['开始 AI 审核', '演示合同走 Mock 预制结果；手动上传合同走真实 AI（解析 + 抽取 + 审核），跳转进度页'],
                  ['后端健康检查', '手动上传场景下检测后端可用性，冷启动时提示等待 30-60 秒'],
                  ['草稿回填', '草稿模式从浏览器本地恢复文件对象，直接进入第二步'],
              ],
              col_widths=[4, 12])

    add_heading(doc, '校验规则', level=2)
    add_bullet(doc, '文件格式：仅 PDF / DOCX')
    add_bullet(doc, '文件大小：≤ 10MB')
    add_bullet(doc, '表单：所有必填项')
    add_bullet(doc, '后端连接失败：弹窗显示后端地址与排查建议')

    add_page_break(doc)


def build_p05(doc):
    """P05 审核处理进度页"""
    add_heading(doc, 'P05 审核处理进度页', level=1)
    add_paragraph(doc, '路由：/reviews/:id/progress    ｜    访问条件：已登录',
                  size=10, color=COLOR_TEXT_SECONDARY)

    add_image(doc, os.path.join(SCREENSHOT_DIR, 'P05-审核进度.png'),
              width_cm=15, caption='图 P05-1 审核处理进度页截图')

    add_heading(doc, '页面元素', level=2)

    add_heading(doc, '页面头', level=3)
    add_bullet(doc, '标题：AI 审核处理中')
    add_bullet(doc, '描述：合同名称 + 状态标签 + 编号')

    add_heading(doc, '进度概览卡', level=3)
    add_bullet(doc, 'AI 图标（渐变背景方块）')
    add_bullet(doc, '当前阶段名称（如「正在抽取关键字段」）')
    add_bullet(doc, '阶段描述文字')
    add_bullet(doc, '整体进度百分比（大字）')
    add_bullet(doc, '蓝绿渐变进度条（完成时变绿色）')

    add_heading(doc, '处理阶段卡（7 阶段，垂直方向）', level=3)
    add_table(doc,
              ['序号', '阶段', '说明'],
              [
                  ['1', '上传文件', '文件已接收'],
                  ['2', '解析文档', '提取文本与表格'],
                  ['3', '识别合同结构', '章节切分'],
                  ['4', '抽取关键字段', '金额、日期、主体等 15 个字段'],
                  ['5', '执行风险规则', '规则引擎匹配'],
                  ['6', '执行 AI 语义审核', '大模型分析'],
                  ['7', '生成审核结果', '整理输出'],
              ],
              col_widths=[2, 5, 9])
    add_paragraph(doc, '每阶段状态：待处理 / 处理中 / 成功 / 失败，处理中显示「处理中」标签，'
                       '成功显示绿色对勾，失败显示红色三角。',
                  size=10, color=COLOR_TEXT_SECONDARY)

    add_heading(doc, '底部操作区（未完成时）', level=3)
    add_bullet(doc, '提示条：预计处理时间约 10 秒')
    add_bullet(doc, '「模拟解析失败（演示用）」红色链接按钮')
    add_bullet(doc, '「查看结果」按钮（仅完成后可用）')

    add_heading(doc, '完成提示卡', level=3)
    add_bullet(doc, '成功图标 + 「AI 审核完成，共识别 X 项风险，正在跳转详情页...」')
    add_bullet(doc, '底部 AI 免责声明')

    add_heading(doc, '交互逻辑', level=2)
    add_table(doc,
              ['行为', '流程'],
              [
                  ['进度计算', '基于启动时间戳计算，刷新页面后不丢失状态'],
                  ['每阶段时长', '约 1.5 秒，全程约 10 秒'],
                  ['自动跳转', '全部完成 1 秒后自动跳转审核详情页'],
                  ['模拟失败', '点击「模拟解析失败」将任务标记为失败状态'],
                  ['失败处理', '显示错误结果页 + 「重新审核」按钮'],
              ],
              col_widths=[4, 12])

    add_heading(doc, '失败状态页', level=2)
    add_bullet(doc, '错误图标 + 错误标题 + 错误描述')
    add_bullet(doc, '「重新审核」按钮：重置进度并重新触发审核')
    add_bullet(doc, '「返回列表」按钮')

    add_heading(doc, '真实 AI 审核三步流程', level=2)
    add_paragraph(doc, '手动上传合同场景下，进度页对应后端真实 AI 处理流程：', size=11)
    add_table(doc,
              ['步骤', '说明'],
              [
                  ['1. 解析文档', '后端调用文档解析库提取段落、表格与图片，返回结构化合同文本'],
                  ['2. 抽取字段', '调用真实 AI 模型抽取 15 个合同要素（含置信度），失败时返回 5 个基础兜底字段'],
                  ['3. 风险审核', '规则引擎前置匹配 + AI 语义识别 13 类风险，失败时返回兜底风险数据'],
              ],
              col_widths=[4, 12])

    add_page_break(doc)


def build_p06(doc):
    """P06 合同信息字段确认页"""
    add_heading(doc, 'P06 合同信息字段确认页', level=1)
    add_paragraph(doc, '路由：/reviews/:id/fields    ｜    访问条件：已登录',
                  size=10, color=COLOR_TEXT_SECONDARY)

    add_image(doc, os.path.join(SCREENSHOT_DIR, 'P06-字段确认.png'),
              width_cm=15, caption='图 P06-1 字段确认页截图')

    add_heading(doc, '页面元素', level=2)

    add_heading(doc, '顶部信息条', level=3)
    add_bullet(doc, '返回详情按钮')
    add_bullet(doc, '任务状态标签')
    add_bullet(doc, '字段总数 / 已确认数 / 低置信度数')

    add_heading(doc, '字段表格', level=3)
    add_table(doc,
              ['列名', '说明'],
              [
                  ['字段名', '合同要素名称（如合同名称、甲方、乙方等）'],
                  ['字段值', 'AI 抽取的值（可编辑）'],
                  ['置信度', '百分比 + 颜色标签'],
                  ['来源原文', '点击查看原文片段'],
                  ['状态', '已确认 / 待确认'],
                  ['操作', '编辑 / 保存 / 确认'],
              ],
              col_widths=[3, 13])

    add_heading(doc, '字段清单（15 个）', level=3)
    add_paragraph(doc, '合同名称、甲方、乙方、合同编号、合同金额、币种、税率、签约日期、生效日期、'
                       '合同期限、付款方式、交付时间、验收方式、质保期限、争议管辖',
                  size=11, color=COLOR_TEXT)

    add_heading(doc, '底部操作', level=3)
    add_bullet(doc, '「确认全部字段」按钮（标记任务字段已全部确认）')

    add_heading(doc, '交互逻辑', level=2)
    add_table(doc,
              ['行为', '流程'],
              [
                  ['低置信度提示', '置信度 < 0.85 显示橙色低置信标签'],
                  ['编辑字段', '点击「编辑」切换为输入框，按钮变「保存」'],
                  ['保存字段', '保存后字段标记为已确认，写入审计日志'],
                  ['确认全部', '任务字段全部标记为已确认'],
                  ['提交复核校验', '字段未全部确认时，提交法务复核会有提示'],
              ],
              col_widths=[4, 12])

    add_heading(doc, '权限控制', level=2)
    add_bullet(doc, '编辑：仅采购人员可编辑')
    add_bullet(doc, '其他角色（法务 / 管理员）只读查看，无编辑按钮')

    add_page_break(doc)


def build_p07(doc):
    """P07 合同审核详情页（核心页面）"""
    add_heading(doc, 'P07 合同审核详情页（核心页面）', level=1)
    add_paragraph(doc, '路由：/reviews/:id    ｜    核心页面    ｜    截图见下方',
                  size=10, color=COLOR_TEXT_SECONDARY)

    add_image(doc, os.path.join(SCREENSHOT_DIR, 'P07-审核详情三栏.png'),
              width_cm=16, caption='图 P07-1 合同审核详情页三栏布局截图')

    add_heading(doc, '整体布局', level=2)
    add_paragraph(doc, '三栏布局（宽屏以上并排，以下垂直堆叠），各栏独立滚动。',
                  size=11)

    add_heading(doc, '顶部任务信息条（吸顶）', level=3)
    add_bullet(doc, '第一行：返回按钮 + 状态标签 + 最高风险等级标签 + 合同名称（大字加粗）+ 字段确认入口 + 审核记录入口')
    add_bullet(doc, '第二行：合同编号 / 相对方 / 金额 / 更新时间 / 审核重点（灰色小字）')
    add_bullet(doc, '字段未确认时显示「待确认」橙色标签')

    add_heading(doc, '左栏：合同结构与筛选（240px 固定）', level=3)
    add_bullet(doc, '字段确认入口（未确认显示「待确认」橙色标签）')
    add_bullet(doc, '章节统计「合同章节（共 X 节 · Y 项风险）」')
    add_bullet(doc, '条款目录列表：每项可点击滚动到原文段落，悬停高亮，风险数红色标签')
    add_bullet(doc, '空状态：「暂无合同结构」')

    add_heading(doc, '中栏：合同原文区', level=3)
    add_paragraph(doc, '渲染能力：', size=11, bold=True)
    add_bullet(doc, 'DOCX：渲染原版式，风险用高亮标签包裹（背景色 + 下划线 + 点击加深）')
    add_bullet(doc, 'PDF：渲染文字层，风险用半透明色块叠加，不遮挡文字')
    add_bullet(doc, '激活态加深底色 + 外框')
    add_bullet(doc, '同一文本段只保留最高等级风险（避免颜色叠加错乱）')
    add_bullet(doc, '多行风险原文按子句拆分匹配，避免行尾漏标')
    add_bullet(doc, '降级：原文渲染失败时切换到结构化段落视图')
    add_bullet(doc, '表格风险：单元格用内联样式高亮，允许文字选择')

    add_paragraph(doc, '段落类型差异化样式：', size=11, bold=True)
    add_table(doc,
              ['类型', '样式'],
              [
                  ['标题', '居中、加大字号、加粗'],
                  ['章节头', '小字号、灰色背景、左边框'],
                  ['图片', '渲染图片 + 风险徽章'],
                  ['正文', '标准样式，去除「第X条 标题」前缀避免重复'],
                  ['签署区', '小字号、灰色背景、顶部留白'],
              ],
              col_widths=[3, 13])

    add_paragraph(doc, '工具栏元素：', size=11, bold=True)
    add_bullet(doc, '缩小按钮 / 缩放比例显示 / 放大按钮')
    add_bullet(doc, '返回顶部按钮')
    add_bullet(doc, '下载按钮（导出当前合同为 DOCX）')
    add_bullet(doc, '当前合同文件名显示')

    add_paragraph(doc, '风险高亮机制：', size=11, bold=True)
    add_bullet(doc, '按高亮位置切分文本段')
    add_bullet(doc, '重叠/包含时保留最高等级（重叠 > 35% 跳过）')
    add_bullet(doc, '标题与正文高亮分离处理')
    add_bullet(doc, '标题区域风险：取最高等级作为标题样式')

    add_heading(doc, '右栏：AI 审核结果（380px 固定）', level=3)

    add_paragraph(doc, '综合信息卡：', size=11, bold=True)
    add_bullet(doc, 'AI 图标 + 「AI 审核结果」标题')
    add_bullet(doc, '最高风险等级标签')
    add_bullet(doc, '风险评分（/100，颜色按最高风险等级）')
    add_bullet(doc, '风险总数统计')
    add_bullet(doc, '4 格风险等级分布（高 / 中 / 低 / 提示，各色背景）')
    add_bullet(doc, '处理进度条（已处理 / 总数 + 百分比）')

    add_paragraph(doc, '风险导航 + 筛选：', size=11, bold=True)
    add_bullet(doc, '风险明细计数「风险明细（X）」')
    add_bullet(doc, '上一条 / 下一条按钮（在筛选结果中循环）')
    add_bullet(doc, '章节筛选 / 等级筛选 / 状态筛选 / 类型筛选')
    add_bullet(doc, '清空按钮（任一筛选生效时显示）')

    add_paragraph(doc, '风险卡片列表，每张卡片包含：', size=11, bold=True)
    add_table(doc,
              ['区域', '元素'],
              [
                  ['头部', '序号 / 总数 + 风险等级标签 + 处理状态标签 + 低置信标签（悬停说明）+ 风险标题'],
                  ['元信息条', '类型 / 条款位置 / 置信度（百分比，低置信橙色）/ 来源（规则 / AI / 人工 + 关联规则链接）'],
                  ['合同原文', '灰色背景 + 左侧等级色边框，超长截断 + 「展开 / 收起」'],
                  ['风险说明', '加粗标签 + 内容'],
                  ['审核依据', '灰色小字'],
                  ['修改建议', '绿色背景（已编辑蓝色），含「已编辑」标签'],
                  ['操作记录摘要', '处理人 + 说明（如有）'],
                  ['操作按钮区', '见下表'],
              ],
              col_widths=[4, 12])

    add_paragraph(doc, '操作按钮（按状态）：', size=11, bold=True)
    add_table(doc,
              ['状态', '按钮'],
              [
                  ['待处理', '接受建议（主按钮）/ 编辑建议 / 忽略 / 转人工'],
                  ['已处理（接受 / 已编辑 / 已忽略 / 转人工）', '恢复处理'],
                  ['任意', '添加备注'],
              ],
              col_widths=[6, 10])

    add_paragraph(doc, '弹窗：', size=11, bold=True)
    add_table(doc,
              ['弹窗', '内容'],
              [
                  ['编辑建议', '多行文本编辑修改建议（必填）'],
                  ['忽略风险', '选择忽略原因（5 项）+ 填写说明（必填）'],
                  ['转人工复核', '填写转人工说明（必填）'],
                  ['添加备注', '填写备注（必填）'],
              ],
              col_widths=[4, 12])

    add_paragraph(doc, '选中态样式：', size=11, bold=True)
    add_bullet(doc, '选中时边框、背景、阴影按风险等级配色，未选中为默认白色背景')

    add_paragraph(doc, '底部固定操作栏（吸底）：', size=11, bold=True)
    add_bullet(doc, '处理统计「已处理 X / Y」+「剩余 Z 项待处理」')
    add_bullet(doc, '生成报告按钮（任何时候可点，未完成时弹窗引导）')
    add_bullet(doc, '提交法务复核按钮（待人工确认 + 采购人员显示）')
    add_bullet(doc, '前往法务复核按钮（法务角色 + 待法务复核状态显示，跳法务复核页）')

    add_heading(doc, '草稿状态特殊视图', level=3)
    add_bullet(doc, '显示任务信息卡（合同编号、相对方、金额、创建时间）')
    add_bullet(doc, '「编辑草稿」按钮（采购人员）→ 跳转新建页草稿模式')
    add_bullet(doc, '「立即发起审核」按钮（采购人员）→ 触发审核并跳转进度页')

    add_heading(doc, '处理中状态特殊视图', level=3)
    add_bullet(doc, '「审核进行中」提示 + 「查看进度」按钮')

    add_heading(doc, '交互逻辑', level=2)
    add_table(doc,
              ['行为', '流程'],
              [
                  ['加载', '并行加载任务、风险、合同原文；风险列表为空但任务有统计时 1.5 秒后自动重试一次'],
                  ['风险排序', '按段落顺序 > 条款编号 > 创建时间，同段内按原文位置'],
                  ['默认选中', '加载完成后选中第一个待处理风险'],
                  ['选中风险', '原文滚动定位高亮 + 风险卡片滚动到视图'],
                  ['上一条 / 下一条', '在筛选结果中循环，同步滚动原文'],
                  ['章节点击', '滚动到该章节第一段'],
                  ['双向定位', '点击风险卡 → 原文滚动高亮；点击原文高亮 → 选中风险卡'],
                  ['风险操作', '乐观更新本地状态，后台异步持久化，失败回滚'],
                  ['提交法务复核校验', '校验不通过时弹窗列出原因'],
                  ['提交确认', '有未处理风险时弹窗「仍有 X 项未处理风险」'],
                  ['生成报告', '已完成状态：找已有报告或生成新报告，跳转报告详情'],
              ],
              col_widths=[4, 12])

    add_heading(doc, '提交法务复核前置校验', level=2)
    add_bullet(doc, '1. 所有高风险均已处理（接受 / 已编辑 / 已忽略 / 转人工 / 已确认）')
    add_bullet(doc, '2. 无未保存编辑')
    add_bullet(doc, '3. 合同基本信息已全部确认')
    add_bullet(doc, '4. 存在未处理风险时二次确认')
    add_bullet(doc, '5. 通过前置校验规则')

    add_heading(doc, '权限控制', level=2)
    add_bullet(doc, '法务 / 管理员在详情页只读，不能修改风险卡')
    add_bullet(doc, '提交法务复核：仅采购人员')
    add_bullet(doc, '草稿发起审核：仅采购人员')

    add_page_break(doc)


def build_p08(doc):
    """P08 法务复核页"""
    add_heading(doc, 'P08 法务复核页', level=1)
    add_paragraph(doc, '路由：/legal-reviews/:id    ｜    访问权限：法务角色',
                  size=10, color=COLOR_TEXT_SECONDARY)

    add_image(doc, os.path.join(SCREENSHOT_DIR, 'P08-法务复核.png'),
              width_cm=15, caption='图 P08-1 法务复核页截图')

    add_heading(doc, '页面元素', level=2)

    add_heading(doc, '页面头', level=3)
    add_bullet(doc, '标题：法务复核')
    add_bullet(doc, '描述：合同名称 + 最高风险标签')
    add_bullet(doc, '返回详情按钮')

    add_heading(doc, '状态提示（非待法务复核时显示）', level=3)
    add_bullet(doc, '警告提示条：当前任务非待法务复核状态')

    add_heading(doc, '综合信息卡', level=3)
    add_bullet(doc, '风险评分 /100（颜色按最高风险等级）')
    add_bullet(doc, '风险总数 / 已处理 / 重大风险数（4 项统计）')
    add_bullet(doc, '合同金额 / 相对方 / 发起人 + 发起时间（描述列表）')

    add_heading(doc, '合同基本信息卡（3 列描述列表）', level=3)
    add_bullet(doc, '展示前 9 个抽取字段')

    add_heading(doc, '风险审核卡', level=3)
    add_bullet(doc, '右上「新增人工风险」按钮（仅可复核时显示）')
    add_paragraph(doc, '每个风险卡片包含：', size=11, bold=True)
    add_table(doc,
              ['元素', '内容'],
              [
                  ['头部', '序号 + 风险等级标签 + 处理状态标签 + 风险标题 + 条款位置 + 置信度'],
                  ['风险说明', '加粗标签 + 内容'],
                  ['修改建议', '优先显示业务人员编辑后的建议'],
                  ['业务处理信息', '处理人 + 说明（如有）'],
                  ['法务操作按钮', '「确认」+「修改建议」（仅可复核时显示）'],
                  ['已确认风险卡', '背景绿色'],
              ],
              col_widths=[4, 12])

    add_heading(doc, '法务意见与结论卡', level=3)
    add_table(doc,
              ['元素', '校验'],
              [
                  ['法务审核意见（多行文本，必填）', '最多 500 字，带字数统计；非可复核状态禁用'],
                  ['最终审核结论（下拉，必选）', '4 选 1：建议签署 / 建议修改后签署 / 建议暂缓签署 / 不建议签署'],
                  ['AI 免责声明（黄色提示条）', '—'],
                  ['退回业务人员按钮（红色，可复核时显示）', '—'],
                  ['完成法务审核按钮（主按钮，可复核时显示）', '—'],
              ],
              col_widths=[5, 11])

    add_heading(doc, '弹窗', level=2)
    add_table(doc,
              ['弹窗', '内容'],
              [
                  ['编辑建议', '显示当前建议 + 多行文本编辑（最多 500 字）'],
                  ['确认风险', '风险标题 + 法务备注（选填）'],
                  ['新增人工风险', '风险标题（必填）/ 风险等级 / 风险类型 / 条款位置 / 风险说明（必填）/ 修改建议'],
                  ['退回业务人员', '提示「退回后任务状态将变为待人工确认」+ 退回原因（必填）'],
              ],
              col_widths=[4, 12])

    add_heading(doc, '交互逻辑', level=2)
    add_table(doc,
              ['行为', '流程'],
              [
                  ['编辑建议', '乐观更新风险状态为已编辑 + 编辑后的建议，失败回滚'],
                  ['确认风险', '乐观更新风险状态为已确认 + 法务备注，失败回滚'],
                  ['新增人工风险', '乐观插入临时项，后端成功后替换为真实 ID，失败移除'],
                  ['退回业务人员', '校验法务意见非空；任务状态变为待人工确认；跳转列表'],
                  ['完成法务审核', '校验法务意见非空 + 选择结论；二次确认显示最终结论；任务状态变为已完成；自动生成报告；跳转列表'],
              ],
              col_widths=[4, 12])

    add_heading(doc, '权限控制', level=2)
    add_bullet(doc, '可复核 = 任务状态为待法务复核（状态限制）')
    add_bullet(doc, '操作按钮仅在可复核时显示')
    add_bullet(doc, '默认期望法务角色操作')

    add_page_break(doc)


def build_p09(doc):
    """P09 审核报告列表"""
    add_heading(doc, 'P09 审核报告列表', level=1)
    add_paragraph(doc, '路由：/reports    ｜    访问条件：已登录',
                  size=10, color=COLOR_TEXT_SECONDARY)

    add_image(doc, os.path.join(SCREENSHOT_DIR, 'P09-报告列表.png'),
              width_cm=15, caption='图 P09-1 审核报告列表截图')

    add_heading(doc, '页面元素', level=2)

    add_heading(doc, '页面头', level=3)
    add_bullet(doc, '标题：审核报告')
    add_bullet(doc, '描述：查看与管理已生成的采购合同审核报告')

    add_heading(doc, '筛选区', level=3)
    add_bullet(doc, '关键词搜索框（报告编号 / 合同名称 / 编号 / 相对方 / 类型）')
    add_bullet(doc, '状态下拉（全部 / 生成中 / 已生成 / 生成失败）')
    add_bullet(doc, '重置按钮（有筛选条件时显示）')

    add_heading(doc, '表格列', level=3)
    add_table(doc,
              ['列名', '说明'],
              [
                  ['报告编号', '编号 + 版本号'],
                  ['合同名称', '合同名（加粗）+ 编号（灰色小字）'],
                  ['相对方', '—'],
                  ['综合风险', '彩色标签，悬停显示各级风险描述'],
                  ['风险评分', 'X / 100'],
                  ['状态', '生成中 / 已生成 / 失败 标签'],
                  ['生成时间', '格式化日期时间'],
                  ['操作', '查看报告 / 查看合同 / 重试（按状态动态显示）'],
              ],
              col_widths=[3, 13])

    add_heading(doc, '交互逻辑', level=2)
    add_table(doc,
              ['行为', '流程'],
              [
                  ['查看报告', '跳转报告详情页'],
                  ['查看合同', '跳转审核详情页'],
                  ['重试', '仅失败状态显示，触发重新生成'],
                  ['分页', '支持切换每页条数 + 快速跳页'],
              ],
              col_widths=[4, 12])

    add_page_break(doc)


def build_p10(doc):
    """P10 审核报告详情"""
    add_heading(doc, 'P10 审核报告详情', level=1)
    add_paragraph(doc, '路由：/reports/:id    ｜    访问条件：已登录',
                  size=10, color=COLOR_TEXT_SECONDARY)

    add_image(doc, os.path.join(SCREENSHOT_DIR, 'P10-报告详情.png'),
              width_cm=15, caption='图 P10-1 审核报告详情截图')

    add_heading(doc, '页面元素', level=2)

    add_heading(doc, '工具栏（吸顶，打印时隐藏）', level=3)
    add_table(doc,
              ['元素', '行为'],
              [
                  ['返回按钮', '返回报告列表'],
                  ['打印按钮', '调用浏览器打印'],
                  ['下载 PDF 按钮', '主按钮，加载态；通过无头浏览器生成 PDF 后下载'],
                  ['导出 Word 按钮', '弹窗提示「当前版本暂未开放」'],
              ],
              col_widths=[4, 12])

    add_heading(doc, '报告正文', level=3)

    add_paragraph(doc, '报告头：', size=11, bold=True)
    add_bullet(doc, '盾牌图标 + 「采购合同审核报告」')
    add_bullet(doc, '报告编号 · 版本 · 生成时间')

    add_paragraph(doc, '综合风险概览卡（按综合风险等级配色）：', size=11, bold=True)
    add_bullet(doc, '综合风险等级标签')
    add_bullet(doc, '风险评分（/100，大字）')
    add_bullet(doc, '高 / 中 / 低 / 提示 4 项统计')

    add_paragraph(doc, '七大章节：', size=11, bold=True)
    add_table(doc,
              ['章节', '内容'],
              [
                  ['一、合同基本信息', '2 列描述列表：合同名称 / 编号 / 相对方 / 金额 / 类型 / 审核重点'],
                  ['二、合同要素字段', '2 列描述列表展示所有 15 个字段'],
                  ['三、AI 审核结论摘要', '青绿色卡，含风险总数 / 主要风险类型 / 重大风险数量 / 建议'],
                  ['四、重大风险条款', '表格（序号 / 标题 / 等级 / 条款 / 处理状态），空时显示空状态'],
                  ['五、逐条风险明细', '分页表格（序号 / 风险 / 风险说明 / 修改建议 / 状态）'],
                  ['六、人工审核结论', '最终结论标签 + 描述 + 法务意见文本'],
                  ['七、附件与留档', '描述列表：报告编号 / 版本 / 生成时间 / 风险项总数 / 重大风险数'],
              ],
              col_widths=[5, 11])

    add_paragraph(doc, '底部：分隔线 + 「本报告由契审智控自动生成 · 时间」', size=11)
    add_paragraph(doc, '免责声明（黄色提示条）', size=11)

    add_heading(doc, '状态特殊页', level=2)
    add_bullet(doc, '生成中：图标 + 「报告生成中」+ 刷新按钮')
    add_bullet(doc, '失败：图标 + 「报告生成失败」+ 返回列表按钮')

    add_heading(doc, '交互逻辑', level=2)
    add_table(doc,
              ['行为', '流程'],
              [
                  ['加载', '加载报告；旧报告无快照时自动重建'],
                  ['下载 PDF', '加载提示 → 调用后端无头浏览器生成 PDF → 下载文件 → 成功提示'],
                  ['打印', '调用浏览器打印'],
                  ['打印样式', '隐藏工具栏 / 侧边栏 / 顶栏，报告正文占满 A4 宽度，表格允许跨页'],
              ],
              col_widths=[4, 12])

    add_heading(doc, '导出能力', level=2)
    add_bullet(doc, '导出 PDF：通过后端无头浏览器渲染网页为 PDF，视觉与网页 100% 一致')
    add_bullet(doc, '兜底：浏览器打印（可另存为 PDF）')
    add_bullet(doc, '导出 Word：明确提示「当前版本暂未开放」，不伪造成功')

    add_heading(doc, '数据来源', level=2)
    add_bullet(doc, '报告数据来自审核快照，后续修改不静默改变已生成报告')
    add_bullet(doc, 'AI 摘要中的英文枚举自动翻译为中文展示')

    add_page_break(doc)


def build_p11(doc):
    """P11 审核记录"""
    add_heading(doc, 'P11 审核记录', level=1)
    add_paragraph(doc, '路由：/reviews/:id/history    ｜    访问条件：已登录',
                  size=10, color=COLOR_TEXT_SECONDARY)

    add_image(doc, os.path.join(SCREENSHOT_DIR, 'P11-审核记录.png'),
              width_cm=15, caption='图 P11-1 审核记录页截图')

    add_heading(doc, '页面元素', level=2)

    add_heading(doc, '页面头（吸顶，返回详情页）', level=3)
    add_bullet(doc, '标题：审核记录')
    add_bullet(doc, '描述：合同名称 + 当前状态标签')

    add_heading(doc, '任务信息卡（2 列描述列表）', level=3)
    add_bullet(doc, '合同名称 / 编号 / 相对方 / 发起人 / 创建时间 / 更新时间')
    add_bullet(doc, '条件显示：提交复核时间 / 完成时间 / 法务审核人')

    add_heading(doc, '文件记录卡', level=3)
    add_bullet(doc, '文件图标 + 文件名 + 大小 + 「原始上传」标签')

    add_heading(doc, '报告记录卡（已生成报告时显示）', level=3)
    add_bullet(doc, '每条：文件图标 + 报告编号 + 版本 · 时间 + 状态标签 + 「查看」按钮（已生成时跳转报告详情）')

    add_heading(doc, '操作时间轴卡', level=3)
    add_table(doc,
              ['元素', '内容'],
              [
                  ['图标 + 颜色', '按动作类型映射颜色与图标'],
                  ['标题', '操作动作名称'],
                  ['时间', '格式化日期时间'],
                  ['操作人 + 状态变化', '操作人 + 操作前状态 → 操作后状态'],
                  ['操作详情', '备注拆分多行，多行时显示「操作详情：」标题 + 项目符号列表'],
              ],
              col_widths=[4, 12])

    add_heading(doc, '图标映射', level=2)
    add_paragraph(doc, '11 种操作图标，按动作关键字映射：创建 / 上传（蓝）、解析 / 审核（青）、'
                       '接受（绿）、编辑（蓝）、忽略（灰）、转人工 / 复核（橙）、提交（紫）、'
                       '确认（绿）、退回（红）、报告 / 生成（蓝）、其他（灰）。',
                  size=11)

    add_heading(doc, '审计日志结构', level=2)
    add_bullet(doc, '风险处理操作记录：风险标题、条款位置、风险等级、详细内容变化')
    add_bullet(doc, '字段编辑记录：AI 抽取值、原确认值、新确认值、置信度')
    add_bullet(doc, '审核流程记录：提交次数、总风险数、状态分布、退回原因、下一步')
    add_bullet(doc, '备注：结构化项目符号 + 「操作详情：」标签 + 边框 / 背景色区分')
    add_bullet(doc, '前后状态使用中文标签（如「待处理 → 已接受」）')

    add_heading(doc, '交互逻辑', level=2)
    add_bullet(doc, '加载：并行加载任务、操作时间轴、报告列表')
    add_bullet(doc, '时间轴按时间倒序展示')
    add_bullet(doc, '点击报告「查看」按钮跳转报告详情')

    add_page_break(doc)


def build_p12(doc):
    """P12 风险规则库"""
    add_heading(doc, 'P12 风险规则库', level=1)
    add_paragraph(doc, '路由：/rules    ｜    访问条件：已登录',
                  size=10, color=COLOR_TEXT_SECONDARY)

    add_image(doc, os.path.join(SCREENSHOT_DIR, 'P12-风险规则库.png'),
              width_cm=15, caption='图 P12-1 风险规则库截图')

    add_heading(doc, '规则库简介', level=2)
    add_paragraph(doc, '风险规则库采用「规则引擎 + AI 语义审核」双引擎机制：规则引擎基于关键词与字段校验'
                       '快速命中已知风险模式，AI 语义审核负责识别复杂语义层面的潜在风险。'
                       '当前规则库内置 26 条规则，覆盖合同主体、金额、付款、交付、验收、违约、'
                       '知识产权、保密、争议等 13 类风险类型。', size=11)

    add_heading(doc, '代表性规则（8 条）', level=2)
    add_table(doc,
              ['编号', '名称', '风险类型', '风险等级', '触发条件（业务化描述）'],
              [
                  ['RR-001', '主体信息缺失', '合同主体', '高', '合同中缺少甲方 / 乙方主体名称或地址等关键信息'],
                  ['RR-002', '金额大小写不一致', '合同金额', '中', '合同金额大小写数值不一致或币种未明确'],
                  ['RR-003', '预付款比例过高', '付款条款', '高', '预付款比例超过 50%，存在资金风险'],
                  ['RR-006', '交付日期模糊', '交付安排', '中', '交付时间未明确具体日期或仅用「尽快」「约定」等模糊表述'],
                  ['RR-007', '验收标准模糊', '验收标准', '中', '验收标准 / 验收方法 / 验收期限未明确'],
                  ['RR-010', '违约责任不对等', '违约责任', '高', '甲乙双方违约责任明显不对等或赔偿上限不合理'],
                  ['RR-012', '定制成果归属不利', '知识产权', '高', '定制成果知识产权归属未约定或归属不利于我方'],
                  ['RR-015', '管辖地不利', '争议解决', '中', '争议管辖法院约定在我方不利地域'],
              ],
              col_widths=[2, 3.5, 2.5, 2, 6])

    add_heading(doc, '页面元素', level=2)

    add_heading(doc, '页面头', level=3)
    add_bullet(doc, '标题：风险规则库')
    add_bullet(doc, '描述：维护合同审核规则，规则引擎与 AI 语义审核共同识别风险')
    add_bullet(doc, '「新建规则」按钮（仅管理员 / 法务可管理时显示）')

    add_heading(doc, '筛选区', level=3)
    add_bullet(doc, '关键词搜索框（规则 ID / 编码 / 名称 / 触发条件 / 模板 / 说明）')
    add_bullet(doc, '风险类型下拉（13 类）')
    add_bullet(doc, '风险等级下拉')
    add_bullet(doc, '检测方式下拉（字段校验 / 关键词 / AI 语义）')
    add_bullet(doc, '启用状态下拉（启用 / 停用 / 草稿）')
    add_bullet(doc, '重置按钮（有筛选条件时显示）')

    add_heading(doc, '表格列', level=3)
    add_table(doc,
              ['列名', '说明'],
              [
                  ['规则 ID', '蓝色加粗'],
                  ['规则编码', '编码 + 版本号'],
                  ['规则名称', '加粗'],
                  ['合同类型', '彩色标签'],
                  ['风险类型', '类型标签'],
                  ['风险等级', '风险标签'],
                  ['检测方式', '方式标签（AI 青色 / 关键词蓝色 / 字段默认）'],
                  ['状态', '状态标签（启用 / 停用 / 草稿）'],
                  ['更新时间', '格式化日期时间'],
                  ['操作', '查看 / 编辑 / 启停 / 版本 / 删除'],
              ],
              col_widths=[3, 13])

    add_heading(doc, '操作列（按权限）', level=3)
    add_table(doc,
              ['操作', '权限'],
              [
                  ['查看详情', '所有角色'],
                  ['编辑', '管理员 / 法务'],
                  ['启用 / 停用', '管理员 / 法务'],
                  ['查看版本', '所有角色'],
                  ['删除', '管理员 / 法务'],
              ],
              col_widths=[6, 10])

    add_heading(doc, '弹窗 / 抽屉', level=2)

    add_heading(doc, '新建 / 编辑规则弹窗', level=3)
    add_table(doc,
              ['字段', '校验'],
              [
                  ['规则名称', '必填，最多 50 字'],
                  ['规则编码', '必填，编辑时禁用，新建默认 RR-时间戳'],
                  ['合同类型', '必选：通用 / 软件 / 硬件 / 服务 / 系统集成'],
                  ['风险类型', '必选（13 类）'],
                  ['风险等级', '必选，含说明「高风险须人工确认...」'],
                  ['检测方式', '必选，含三种方式详细说明'],
                  ['触发条件', '必填，按检测方式动态变化'],
                  ['风险说明模板', '必填，支持占位符'],
                  ['修改建议模板', '必填'],
                  ['规则状态', '必选：启用 / 停用 / 草稿'],
                  ['规则说明', '选填'],
              ],
              col_widths=[5, 11])

    add_heading(doc, '规则详情抽屉', level=3)
    add_bullet(doc, '描述列表：规则 ID / 编码 / 版本 / 状态 / 合同类型 / 风险类型 / 风险等级 / 检测方式 / 更新时间')
    add_bullet(doc, '规则配置：触发条件 / 风险说明模板 / 修改建议模板 / 规则说明')
    add_bullet(doc, '检测方式说明')
    add_bullet(doc, '可管理时底部显示「编辑」按钮')
    add_bullet(doc, '非可管理显示「当前为只读视图」提示')

    add_heading(doc, '版本抽屉', level=3)
    add_bullet(doc, '描述列表：编码 / 当前版本 / 状态 / 风险等级 / 更新时间')
    add_bullet(doc, '历史版本时间轴：版本号标签（当前版本绿色）+ 时间 + 变更说明 + 操作人 + 快照关键配置')
    add_bullet(doc, '底部说明：启用状态规则修改自动生成新版本快照')

    add_heading(doc, '交互逻辑', level=2)
    add_table(doc,
              ['行为', '流程'],
              [
                  ['启用 / 停用', '弹窗二次确认'],
                  ['删除', '弹窗二次确认（红色危险按钮）'],
                  ['保存规则', '表单校验 + 创建 / 更新 + 重置表单 + 重新加载列表'],
                  ['查看版本', '加载版本列表 + 抽屉展示时间轴'],
                  ['从风险卡跳转', '携带规则关键词参数自动设置搜索词'],
                  ['检测方式筛选', '前端过滤'],
              ],
              col_widths=[4, 12])

    add_heading(doc, '权限控制', level=2)
    add_bullet(doc, '可管理 = 当前用户角色为管理员或法务')
    add_bullet(doc, '采购人员仅可查看，无新建 / 编辑 / 启停 / 删除按钮')
    add_bullet(doc, '详情抽屉底部编辑按钮仅可管理时显示')

    add_page_break(doc)


def build_chapter_6_state_machine(doc):
    """六、核心业务状态机"""
    add_heading(doc, '六、核心业务状态机', level=1)

    add_heading(doc, '6.1 审核任务状态机（7 状态）', level=2)
    add_table(doc,
              ['当前状态', '允许动作', '下一状态'],
              [
                  ['draft 草稿', '上传/替换、编辑设置、开始审核、删除', 'parsing'],
                  ['parsing 解析中', '查看进度、取消（受限）', 'ai_reviewing / failed'],
                  ['ai_reviewing AI审核中', '查看进度', 'pending_business / failed'],
                  ['pending_business 待人工确认', '处理风险、提交复核、归档', 'pending_legal'],
                  ['pending_legal 待法务复核', '法务确认/修改/退回', 'pending_business / completed'],
                  ['completed 已完成', '查看/导出/重新审核', '新建任务版本'],
                  ['failed 失败', '重试/重新上传/转人工/删除', 'parsing / pending_business'],
              ],
              col_widths=[4, 7, 5])

    add_heading(doc, '6.2 风险项状态机（6 状态）', level=2)
    add_table(doc,
              ['当前状态', '采购动作', '法务动作'],
              [
                  ['pending 待处理', '接受/编辑/忽略/转人工', '确认/编辑/忽略'],
                  ['accepted 已接受', '撤销（提交前）', '确认/修改'],
                  ['edited 已编辑', '继续编辑/撤销', '确认/继续修改'],
                  ['ignored 已忽略', '撤销（提交前）', '确认忽略/恢复'],
                  ['manual_review 转人工复核', '补充背景', '确认/编辑/忽略'],
                  ['confirmed 已确认', '只读', '提交前可撤销'],
              ],
              col_widths=[5, 5.5, 5.5])

    add_heading(doc, '6.3 关键枚举（全局唯一）', level=2)
    add_table(doc,
              ['枚举', '取值'],
              [
                  ['风险等级', 'high 高风险 / medium 中风险 / low 低风险 / notice 提示项'],
                  ['风险处理状态', 'pending 待处理 / accepted 已接受 / edited 已编辑 / ignored 已忽略 / manual_review 转人工 / confirmed 已确认'],
                  ['审核任务状态', 'draft 草稿 / parsing 解析中 / ai_reviewing AI审核中 / pending_business 待人工确认 / pending_legal 待法务复核 / completed 已完成 / failed 失败'],
                  ['风险类型', '主体 / 金额 / 付款 / 交付 / 验收 / 质保 / 违约 / 解除 / 知识产权 / 保密 / 数据安全 / 争议 / 期限（13 类）'],
                  ['法务结论', '建议签署 / 修改后签署 / 暂缓 / 不建议'],
                  ['规则检测方式', '字段校验 / 关键词匹配 / AI 语义判断'],
                  ['规则状态', '启用 / 禁用 / 草稿'],
              ],
              col_widths=[4, 12])

    add_page_break(doc)


def build_chapter_7_business_flow(doc):
    """七、核心业务流程"""
    add_heading(doc, '七、核心业务流程', level=1)

    add_heading(doc, '7.1 完整审核闭环', level=2)
    flow = (
        '① 采购人员上传合同（PDF/DOCX）\n'
        '② 系统解析文档：提取段落正文、表格与图片（含 OCR 识别）\n'
        '③ AI 抽取字段：识别 15 个合同要素并给出置信度\n'
        '④ 规则引擎检查：26 条规则关键词匹配（支持同义词扩展）\n'
        '⑤ AI 语义审核：识别 13 类风险，返回结构化风险结果\n'
        '⑥ 风险去重：同段重叠 >60% 只保留最高等级\n'
        '⑦ 业务人员逐条处理：接受 / 编辑 / 忽略 / 转人工\n'
        '⑧ 提交法务复核：高风险全部处理 + 字段确认 + 二次确认\n'
        '⑨ 法务复核：确认 / 修改 / 新增人工风险 / 退回\n'
        '⑩ 法务出具结论：建议签署 / 修改后签署 / 暂缓 / 不建议\n'
        '⑪ 自动生成报告：快照当前状态\n'
        '⑫ 导出 PDF：与网页视觉一致\n'
        '⑬ 审核记录留档：时间轴展示全部操作'
    )
    add_callout(doc, flow, color_hex='E6F7FF', border_color='1677FF')

    add_heading(doc, '7.2 真实 AI 审核规则', level=2)
    rules = [
        'AI 结果必须为结构化数据，不接受 Markdown 作为正式结果',
        '每项风险必须含原文证据，无法定位则降置信度并默认进人工复核',
        '置信度策略：≥0.85 正常；0.60–0.84 建议复核；<0.60 默认转人工',
        '不展示模型内部思维过程，仅展示风险结论、触发规则、原文证据、简要说明',
        'AI 生成的风险原文必须 ≤150 字符，仅含触发风险的句子',
        '系统对 AI 返回的风险类型、风险等级、来源类型、置信度做校验与清洗，非法值映射为默认值',
        'AI 调用失败时返回兜底风险数据，确保风险明细非空',
        '字段抽取失败时返回 5 个基础兜底字段，避免进度页卡住',
        '限流重试：指数退避，最多 3 次，应对限流/超时/服务异常',
    ]
    for r in rules:
        add_bullet(doc, r)

    add_heading(doc, '7.3 风险去重规则', level=2)
    add_bullet(doc, '完全相同的归一化原文只保留最高等级')
    add_bullet(doc, '同段重叠 >60% 只保留最高等级')
    add_bullet(doc, '子串包含关系直接跳过')
    add_bullet(doc, '重叠比例 >35% 跳过低等级')
    add_bullet(doc, '同一文本片段上只保留最高等级风险')

    add_page_break(doc)


def build_chapter_8_demo_flow(doc):
    """八、演示主流程"""
    add_heading(doc, '八、演示主流程', level=1)

    add_heading(doc, '8.1 标准演示流程（样例合同）', level=2)
    flow = (
        '1. 采购业务人员登录 → 工作台 → 新建审核\n'
        '2. 选择演示合同 → 填写审核信息 → 发起 AI 审核\n'
        '3. 查看进度 → 确认抽取字段 → 进入三栏详情\n'
        '4. 点击风险卡定位原文 → 接受一条 / 编辑一条 / 忽略一条（填原因）/ 转人工一条\n'
        '5. 提交法务复核 → 切法务 → 查看业务处理结果 → 填法务意见 → 选「建议修改后签署」→ 完成审核\n'
        '6. 生成并查看报告 → 查看审核历史与时间轴\n'
        '7. 返回工作台，统计数据同步更新'
    )
    add_callout(doc, flow, color_hex='F6FFED', border_color='52C41A')

    add_heading(doc, '8.2 真实 AI 上传流程（手动上传）', level=2)
    add_bullet(doc, '1. 用户手动上传 PDF/DOCX（非样例合同）')
    add_bullet(doc, '2. 点击「开始 AI 审核」后系统自动执行：')
    add_bullet(doc, '   - 解析文档：提取段落正文、表格与图片', indent=1.2)
    add_bullet(doc, '   - AI 抽取字段：识别 15 个合同要素并给出置信度', indent=1.2)
    add_bullet(doc, '   - 风险识别：规则引擎 + AI 语义审核识别 13 类风险', indent=1.2)
    add_bullet(doc, '3. 将 AI 结果写入数据库，生成审核任务')
    add_bullet(doc, '4. 任务进入待人工确认状态，跳转审核详情页进行人工处理')

    add_page_break(doc)


def build_chapter_9_boundary(doc):
    """九、当前阶段边界"""
    add_heading(doc, '九、当前阶段边界', level=1)

    add_heading(doc, '9.1 已实现', level=2)
    add_table(doc,
              ['能力', '实现说明'],
              [
                  ['前端 12 个页面', '完整业务闭环，企业级 B 端 SaaS 风格'],
                  ['真实 AI 字段抽取', '调用真实 AI 模型识别 15 个合同要素'],
                  ['真实 AI 风险审核', '规则引擎前置 + AI 语义审核 + 兜底关键词扫描'],
                  ['真实文件解析', '支持 PDF 与 DOCX，提取段落、表格与图片'],
                  ['段落结构识别', '自动识别标题、正文、签字栏、表格、图片，过滤页眉页脚页码'],
                  ['真实数据持久化', '云端数据库 + 对象存储 + 本地缓存'],
                  ['真实鉴权', 'JWT 登录态 + 自动刷新'],
                  ['角色权限校验', '采购 / 法务 / 管理员三角色，路由级权限'],
                  ['PDF 报告生成', '无头浏览器渲染，视觉与网页一致'],
                  ['浏览器打印导出', '兜底导出方案'],
                  ['风险规则库', '26 条规则，3 种检测方式，版本管理'],
                  ['风险原文定位', '原文高亮标注，支持点击定位'],
                  ['表格风险高亮', '表格单元格高亮，允许文字选择'],
                  ['风险去重', '同段重叠 >60% 只保留最高等级'],
                  ['限流重试', '指数退避，最多 3 次，应对限流/超时/服务异常'],
                  ['Mock 降级', 'AI 未配置时自动切换 Mock，格式与真实一致'],
              ],
              col_widths=[5, 11])

    add_heading(doc, '9.2 未实现（明确降级或留空）', level=2)
    add_table(doc,
              ['能力', '状态'],
              [
                  ['OCR 扫描件支持', '❌ 不支持（仅文字型 PDF）'],
                  ['Word 红线修订导出', '❌ 未实现，明确提示'],
                  ['复杂审批流', '❌ 未实现（仅 单审 → 法务复核 二级流程）'],
                  ['履约管理', '❌ 未实现'],
                  ['电子签章', '❌ 未实现'],
                  ['真实部署上线', '❌ 仅本地演示（不部署线上）'],
              ],
              col_widths=[5, 11])

    add_heading(doc, '9.3 错误处理约定', level=2)
    add_bullet(doc, '风险列表与文档加载失败时降级为空列表或样例数据，不阻断页面加载')
    add_bullet(doc, '后端冷启动错误提示：「后端服务连接失败，请确认后端已启动后重试」')
    add_bullet(doc, '审核详情页任务加载失败时显示错误页（返回列表 + 重试按钮），不空白')
    add_bullet(doc, 'AI 审核失败时自动重置状态，允许重新触发')

    add_page_break(doc)


# ============================================================
# 主函数
# ============================================================

def main():
    print(f'开始生成 Word PRD 文档...')
    print(f'截图目录: {SCREENSHOT_DIR}')
    print(f'输出路径: {OUTPUT_PATH}')

    doc = init_document()

    # 封面 + 目录
    build_cover(doc)
    build_toc(doc)

    # 一到五章
    build_chapter_1_overview(doc)
    build_chapter_2_roles(doc)
    build_chapter_3_spec(doc)
    build_chapter_4_layout(doc)
    build_chapter_5_routes(doc)

    # P01-P12
    build_p01(doc)
    build_p02(doc)
    build_p03(doc)
    build_p04(doc)
    build_p05(doc)
    build_p06(doc)
    build_p07(doc)
    build_p08(doc)
    build_p09(doc)
    build_p10(doc)
    build_p11(doc)
    build_p12(doc)

    # 六到九章
    build_chapter_6_state_machine(doc)
    build_chapter_7_business_flow(doc)
    build_chapter_8_demo_flow(doc)
    build_chapter_9_boundary(doc)

    doc.save(OUTPUT_PATH)
    print(f'\n✅ 文档生成成功！')
    print(f'   路径: {OUTPUT_PATH}')
    print(f'   大小: {os.path.getsize(OUTPUT_PATH) / 1024:.1f} KB')


if __name__ == '__main__':
    main()
