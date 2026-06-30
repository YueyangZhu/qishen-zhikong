"""审核报告相关 Pydantic 模型，对齐前端 src/types/index.ts 的 ReportSnapshot

前端在调用 /api/reports/generate-pdf 时把完整 snapshot + 报告元信息 POST 给后端，
后端用 reportlab 渲染为 PDF 二进制流返回。
"""
from typing import List, Optional, Literal
from pydantic import BaseModel, Field


# ===== 枚举（与 review.py 保持一致）=====
RiskLevel = Literal["high", "medium", "low", "notice"]
RiskStatus = Literal["pending", "accepted", "edited", "ignored", "manual_review", "confirmed"]
RiskCategory = Literal[
    "subject", "amount", "payment", "delivery", "acceptance",
    "warranty", "breach", "termination", "ip",
    "confidentiality", "data_security", "dispute", "term",
]
RiskSource = Literal["rule", "ai", "manual"]
LegalConclusion = Literal["sign", "sign_after_modify", "defer", "not_sign"]


# ===== 风险项（报告快照中包含完整 RiskItem）=====
class ReportRiskItem(BaseModel):
    """报告中的风险项（包含运行时字段，用于明细展示）"""
    id: str
    title: str
    riskType: RiskCategory
    riskLevel: RiskLevel
    clauseNumber: str
    clauseTitle: str
    originalText: str
    riskReason: str
    suggestion: str
    editedSuggestion: Optional[str] = None
    confidence: float = Field(ge=0, le=1)
    sourceType: RiskSource = "ai"
    status: RiskStatus = "pending"
    handler: Optional[str] = None


# ===== 字段（报告快照中包含完整字段）=====
class ReportField(BaseModel):
    """报告中的字段项"""
    id: str
    fieldKey: str
    fieldLabel: str
    fieldValue: str
    confirmedValue: Optional[str] = None
    confidence: float = Field(ge=0, le=1)


# ===== 报告快照（与前端 ReportSnapshot 对齐）=====
class ReportSnapshot(BaseModel):
    """报告快照 - 前端传入的完整快照数据"""
    contractName: str
    contractNo: str
    counterparty: str
    amount: float
    currency: str = "CNY"
    contractType: str
    reviewFocus: List[str] = Field(default_factory=list)
    fields: List[ReportField] = Field(default_factory=list)
    risks: List[ReportRiskItem] = Field(default_factory=list)
    riskCount: dict  # {high, medium, low, notice}
    riskScore: int
    overallRiskLevel: RiskLevel
    aiSummary: str
    legalOpinion: str
    legalConclusion: LegalConclusion
    majorRisks: List[ReportRiskItem] = Field(default_factory=list)
    disclaimer: str
    generatedAt: str  # ISO 字符串


class GeneratePdfRequest(BaseModel):
    """生成 PDF 报告请求"""
    reportNo: str  # 报告编号
    versionNo: int  # 报告版本
    snapshot: ReportSnapshot  # 报告快照
