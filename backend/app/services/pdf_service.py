"""PDF / DOCX 解析服务

使用 pdfplumber 解析 PDF，python-docx 解析 DOCX，
将文档切分为段落（ContractParagraph），与前端 types 对齐。
"""
import io
import re
import logging
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
        页与页之间用一个空行分隔。这样 _split_paragraphs 能按原稿顺序切分。
        """
        text_parts: List[str] = []
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                # extract_text 默认按阅读顺序输出，每行一个 \n
                page_text = page.extract_text() or ""
                if page_text:
                    # 规范化：去除行尾空白，保留行内结构
                    lines = [line.rstrip() for line in page_text.split("\n") if line.strip()]
                    if lines:
                        text_parts.append("\n".join(lines))
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
        4. 每段分配 id（p1, p2, ...）和 index，顺序与原稿一致
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
        current_section_paras: List[str] = []
        current_section_title = "合同首部"
        current_section_no = "首部"

        for idx, raw in enumerate(raw_paragraphs, start=1):
            para_id = f"p{idx}"
            clause_no, clause_title = self._detect_clause(raw)

            # 新章节开始（条款编号变化）
            if clause_no and clause_no != current_section_no:
                # 保存上一节
                if current_section_paras:
                    sections.append(ContractSection(
                        id=f"s{len(sections) + 1}",
                        title=current_section_title,
                        clauseNo=current_section_no,
                        paragraphIds=current_section_paras[:],
                    ))
                current_section_no = clause_no
                current_section_title = clause_title or clause_no
                current_section_paras = []

            paragraphs.append(ContractParagraph(
                id=para_id,
                index=idx,
                text=raw,
                clauseNo=clause_no,
                clauseTitle=clause_title,
            ))
            current_section_paras.append(para_id)

        # 最后一节
        if current_section_paras:
            sections.append(ContractSection(
                id=f"s{len(sections) + 1}",
                title=current_section_title,
                clauseNo=current_section_no,
                paragraphIds=current_section_paras[:],
            ))

        return paragraphs, sections

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
