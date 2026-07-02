"""PDF / DOCX 解析服务

使用 pdfplumber 解析 PDF，python-docx 解析 DOCX，
将文档切分为段落（ContractParagraph），与前端 types 对齐。

解析能力：
- 过滤 PDF 页眉/页脚/页码/水印（启发式：重复出现的短行、纯数字页码、"第X页"等）
- 识别段落类型（title/header/body/signature），支持前端差异化渲染
- 首部段（甲乙方）、签署段独立成节，左栏章节目录完整反映合同结构
- 保留原稿阅读顺序
"""
import io
import re
import logging
from collections import Counter
from typing import List, Tuple
import pdfplumber
from docx import Document as DocxDocument

from app.schemas.review import ContractParagraph, ContractSection, ParsedDocument

logger = logging.getLogger(__name__)


# 段落切分正则
# 匹配"第X条"、"一、二、三、"、"1. 2. 3."、"第一条 第二条"等条款编号
CLAUSE_PATTERN = re.compile(
    r"^(第[一二三四五六七八九十百零\d]+条|[一二三四五六七八九十]+、|\d+[.、）)])",
    re.MULTILINE,
)

# 页眉/页脚/页码识别正则
PAGE_NUMBER_PATTERN = re.compile(
    r"^(第\s*\d+\s*页(?:\s*/\s*共\s*\d+\s*页)?|page\s*\d+|\d+\s*/\s*\d+|\d{1,3})$",
    re.IGNORECASE,
)

# 首部段（甲乙方信息）识别：以"甲方/乙方/供方/需方/发包方/承包方"等开头
HEADER_PATTERN = re.compile(
    r"^(甲方|乙方|供方|需方|发包方|承包方|委托方|受托方|出租方|承租方|买方|卖方|定作方|承揽方|采购方|供应方|卖受人|买受人|出让人|受让人|招标方|投标方|发包人|承包人|委托人|受托人|出租人|承租人|订立人|协议方)[（(：: 　]",
)

# 签署段识别：以签署关键词开头，或末尾含签字盖章
SIGNATURE_PATTERN = re.compile(
    r"^(签署|签字|盖章|签订日期|签订地点|签约地点|签约日期|本合同一式|双方签字|双方盖章|甲方签章|乙方签章|甲方（签章|乙方（签章|甲方盖章|乙方盖章)",
)
SIGNATURE_TAIL_PATTERN = re.compile(r"签字（盖章）|（签字盖章）|（盖章）|签字日期|盖章日期")


class PDFService:
    """合同文件解析"""

    def parse(self, content: bytes, filename: str) -> ParsedDocument:
        """解析合同文件，返回结构化文档

        Args:
            content: 文件二进制内容
            filename: 文件名（用于判断类型）
        """
        name_lower = filename.lower()
        if name_lower.endswith(".pdf"):
            text = self._parse_pdf(content)
        elif name_lower.endswith(".docx"):
            text = self._parse_docx(content)
        elif name_lower.endswith(".txt"):
            text = content.decode("utf-8", errors="ignore")
        else:
            # 默认按文本处理
            try:
                text = content.decode("utf-8", errors="ignore")
            except Exception:
                raise ValueError(f"不支持的文件类型：{filename}")

        if not text.strip():
            raise ValueError("文件内容为空，无法解析")

        paragraphs, sections = self._split_paragraphs(text)
        title = paragraphs[0].text if paragraphs else filename

        return ParsedDocument(
            title=title,
            sections=sections,
            paragraphs=paragraphs,
            fullText=text,
        )

    def _parse_pdf(self, content: bytes) -> str:
        """使用 pdfplumber 解析 PDF

        保留原稿阅读顺序：按行拼接，每行一个换行符，
        页与页之间用一个空行分隔。同时过滤页眉/页脚/页码/水印等非正文内容。
        """
        # 先收集所有页的行，统计每行在多少页出现（用于识别页眉页脚）
        pages_lines: List[List[str]] = []
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text() or ""
                if page_text:
                    # 规范化：去除行尾空白，保留非空行
                    lines = [line.rstrip() for line in page_text.split("\n") if line.strip()]
                    pages_lines.append(lines)
                else:
                    pages_lines.append([])

        if not pages_lines:
            return ""

        # 统计每行在多少页出现（页眉页脚在多页重复出现）
        line_page_count: Counter = Counter()
        for lines in pages_lines:
            # 同一页内去重，避免单页多次出现的行被误判
            for line in set(lines):
                line_page_count[line] += 1
        total_pages = len(pages_lines)

        def is_header_footer(line: str) -> bool:
            """识别页眉/页脚/页码/水印"""
            stripped = line.strip()
            if not stripped:
                return True
            # 纯数字页码或"第X页/Page X/N/M"格式
            if PAGE_NUMBER_PATTERN.match(stripped):
                return True
            # 多页重复出现的短行（页眉页脚特征）
            # 阈值：在 >= 50% 的页中出现且长度 <= 30
            if (
                total_pages >= 2
                and len(stripped) <= 30
                and line_page_count[stripped] >= max(2, total_pages // 2)
            ):
                return True
            return False

        # 过滤后按页拼接
        text_parts: List[str] = []
        for lines in pages_lines:
            filtered = [line for line in lines if not is_header_footer(line)]
            if filtered:
                text_parts.append("\n".join(filtered))
        return "\n\n".join(text_parts)

    def _parse_docx(self, content: bytes) -> str:
        """使用 python-docx 解析 DOCX"""
        doc = DocxDocument(io.BytesIO(content))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())

    def _split_paragraphs(self, text: str) -> Tuple[List[ContractParagraph], List[ContractSection]]:
        """将文本切分为段落和章节

        切分策略（保证与原稿顺序一致，且不破坏多行条款）：
        1. 先按空行（连续换行）切成块
        2. 块内若出现以条款编号开头的行，则在该行处进一步切分，
           使每条条款成为一个独立段落（保留其多行正文）
        3. 识别段落开头的条款编号作为章节边界
        4. title/header/signature 段落各自独立成节
        5. 每段分配 id（p1, p2, ...）和 index，顺序与原稿一致
        """
        # 第一步：按空行切块（保留原稿顺序）
        blocks = [b for b in re.split(r"\n\s*\n", text) if b.strip()]

        # 第二步：块内按"条款编号行"进一步切分，得到逻辑段落
        raw_paragraphs: List[str] = []
        for block in blocks:
            lines = block.split("\n")
            current_lines: List[str] = []
            for line in lines:
                if not line.strip():
                    continue
                # 当前行以条款编号开头，且已有累积内容 → 起始新段落
                if CLAUSE_PATTERN.match(line.strip()) and current_lines:
                    raw_paragraphs.append("\n".join(current_lines))
                    current_lines = []
                current_lines.append(line.rstrip())
            if current_lines:
                raw_paragraphs.append("\n".join(current_lines))

        # 第三步：构建 ContractParagraph 与 ContractSection
        paragraphs: List[ContractParagraph] = []
        sections: List[ContractSection] = []
        # 当前章节累积的段落 id
        current_section_paras: List[str] = []
        # 初始章节：合同首部（涵盖标题+甲乙方，直到遇到第一个条款编号）
        current_section_title = "合同首部"
        current_section_no = "首部"

        def flush_section():
            """把当前累积的段落保存为一个章节"""
            if current_section_paras:
                sections.append(ContractSection(
                    id=f"s{len(sections) + 1}",
                    title=current_section_title,
                    clauseNo=current_section_no,
                    paragraphIds=current_section_paras[:],
                ))
                current_section_paras.clear()

        for idx, raw in enumerate(raw_paragraphs, start=1):
            para_id = f"p{idx}"
            clause_no, clause_title = self._detect_clause(raw)
            para_type = self._detect_type(idx, raw, clause_no)

            # 章节边界判定：
            # - title 段：单独成节（章节标题=合同标题，clauseNo='标题'）
            # - header 段：与 title 段同属"合同首部"，不切节
            # - signature 段：单独成节（章节标题='签署落款'，clauseNo='签署'）
            # - body 段且 clause_no 变化：切节
            if para_type == 'title':
                # 标题段独立成节
                flush_section()
                current_section_title = raw[:30]
                current_section_no = "标题"
            elif para_type == 'header':
                # 首部段：若当前节不是"合同首部"/"标题"，则新建"合同主体"节
                if current_section_no not in ("首部", "标题"):
                    flush_section()
                    current_section_title = "合同主体"
                    current_section_no = "首部"
                # 否则继续累积到当前首部节
            elif para_type == 'signature':
                # 签署段独立成节
                flush_section()
                current_section_title = clause_title or "签署落款"
                current_section_no = "签署"
            else:
                # body 段：条款编号变化则切节
                if clause_no and clause_no != current_section_no:
                    flush_section()
                    current_section_no = clause_no
                    current_section_title = clause_title or clause_no

            paragraphs.append(ContractParagraph(
                id=para_id,
                index=idx,
                text=raw,
                clauseNo=clause_no,
                clauseTitle=clause_title,
                type=para_type,
            ))
            current_section_paras.append(para_id)

        # 最后一节
        flush_section()

        return paragraphs, sections

    @staticmethod
    def _detect_type(idx: int, text: str, clause_no: str | None) -> str:
        """识别段落类型

        Returns: 'title' | 'header' | 'signature' | 'body'
        - title: 第一段且无 clauseNo 且文本长度 < 30（合同标题）
        - header: 以"甲方/乙方/供方/需方"等开头（首部甲乙方信息）
        - signature: 以"签署/签字/盖章/本合同一式"等开头，或末尾含签字盖章
        - body: 其余（含 clauseNo 的条款段，或无 clauseNo 的非首段正文）
        """
        first_line = text.split("\n", 1)[0].strip()
        # 签署段优先识别（避免"本合同一式"段被误判为 body）
        if SIGNATURE_PATTERN.match(first_line) or SIGNATURE_TAIL_PATTERN.search(text):
            return 'signature'
        # 首部段（甲乙方信息）
        if HEADER_PATTERN.match(first_line):
            return 'header'
        # 标题段：第一段、无条款号、文本简短
        if idx == 1 and not clause_no and len(first_line) <= 30:
            return 'title'
        return 'body'

    @staticmethod
    def _detect_clause(text: str) -> Tuple[str | None, str | None]:
        """识别段落开头的条款编号和标题

        Returns: (clause_no, clause_title)
        - "第三条 违约责任：..." -> ("第三条", "违约责任")
        - "一、合同金额..." -> ("一", "合同金额")
        - "1. 付款方式..." -> ("1", "付款方式")
        """
        # 取首行做匹配，避免多行段落时误识别
        first_line = text.split("\n", 1)[0]
        match = CLAUSE_PATTERN.match(first_line.strip())
        if not match:
            return None, None

        clause_no = match.group(1).rstrip("、.）)")
        # 提取标题：编号后的文字，到冒号或换行
        rest = first_line[match.end():].lstrip("：: 　")
        # 取到首个空格、句号、分号为止作为标题
        title_match = re.match(r"[^\s。；;]+", rest)
        title = title_match.group(0) if title_match else None
        # 清理标题中的"甲方乙方"等冗余
        if title and len(title) > 20:
            title = title[:20]
        return clause_no, title


pdf_service = PDFService()
