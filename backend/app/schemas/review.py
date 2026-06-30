"""审核相关 Pydantic 模型，对齐前端 src/types/index.ts

字段命名与前端保持一致（snake_case），便于前后端类型共享。
"""
from typing import List, Optional, Literal
from pydantic import BaseModel, Field


# ===== 枚举（与前端 types 一致）=====
RiskLevel = Literal["high", "medium", "low", "notice"]
RiskCategory = Literal[
    "subject", "amount", "payment", "delivery", "acceptance",
    "warranty", "breach", "termination", "ip",
    "confidentiality", "data_security", "dispute", "term",
]
RiskSource = Literal["rule", "ai", "manual"]


# ===== 合同结构 =====
class ContractParagraph(BaseModel):
    """合同段落"""
    id: str
    index: int
    text: str
    clauseNo: Optional[str] = None
    clauseTitle: Optional[str] = None


class ContractSection(BaseModel):
    """合同章节"""
    id: str
    title: str
    clauseNo: str
    paragraphIds: List[str] = Field(default_factory=list)


class ParsedDocument(BaseModel):
    """解析后的合同文档"""
    title: str
    sections: List[ContractSection] = Field(default_factory=list)
    paragraphs: List[ContractParagraph] = Field(default_factory=list)
    fullText: str


# ===== 抽取字段 =====
class ExtractedField(BaseModel):
    """AI 抽取的字段"""
    fieldKey: str
    fieldLabel: str
    fieldValue: str
    confidence: float = Field(ge=0, le=1)
    lowConfidence: bool
    sourceText: str


class ExtractFieldsRequest(BaseModel):
    """字段抽取请求"""
    paragraphs: List[ContractParagraph]
    contractType: Optional[str] = None


class ExtractFieldsResponse(BaseModel):
    """字段抽取响应"""
    fields: List[ExtractedField]


# ===== 风险项 =====
class RiskItemAI(BaseModel):
    """AI 审核生成的风险项（与前端 RiskItem 的 AI 输出部分对齐）

    注意：id / reviewTaskId / status / version / createdAt / updatedAt 等运行时字段
    由前端持久化时补全，AI 只输出风险内容本身。
    """
    title: str
    riskType: RiskCategory
    riskLevel: RiskLevel
    clauseNumber: str
    clauseTitle: str
    originalText: str
    paragraphId: str
    startPosition: int
    endPosition: int
    riskReason: str
    reviewBasis: str
    suggestion: str
    confidence: float = Field(ge=0, le=1)
    sourceType: RiskSource = "ai"


class ReviewRisksRequest(BaseModel):
    """AI 风险审核请求"""
    paragraphs: List[ContractParagraph]
    contractType: Optional[str] = None
    myRole: Optional[Literal["buyer", "seller"]] = None
    reviewFocus: List[str] = Field(default_factory=list)
    reviewNote: Optional[str] = None


class ReviewRisksResponse(BaseModel):
    """AI 风险审核响应"""
    risks: List[RiskItemAI]
    aiSummary: str


# ===== 健康检查 =====
class HealthResponse(BaseModel):
    """健康检查响应（字段名对齐前端 apiClient.BackendMode）"""
    status: str = "ok"
    is_mock: bool
    model: Optional[str] = None
    reason: Optional[str] = None
