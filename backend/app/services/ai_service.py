"""DeepSeek AI 服务（兼容 OpenAI 协议）

使用 openai SDK 调用 DeepSeek，支持：
- 字段抽取（结构化 JSON 输出）
- 风险审核（结构化 JSON 输出）
- Mock 模式 fallback（API Key 未配置时返回预设数据）
"""
import json
import logging
from typing import List, Tuple
from openai import OpenAI

from app.config import settings
from app.schemas.review import (
    ContractParagraph, ExtractedField, RiskItemAI,
)
from app.services import prompt_service

logger = logging.getLogger(__name__)


class AIService:
    """DeepSeek AI 调用封装"""

    def __init__(self):
        self._client: OpenAI | None = None

    @property
    def client(self) -> OpenAI:
        """懒加载 OpenAI 客户端"""
        if self._client is None:
            if settings.is_mock_mode:
                raise RuntimeError("Mock 模式下不应初始化 OpenAI 客户端")
            self._client = OpenAI(
                api_key=settings.deepseek_api_key,
                base_url=settings.deepseek_base_url,
                timeout=settings.ai_timeout,
            )
        return self._client

    def _chat(self, system_prompt: str, user_prompt: str) -> str:
        """调用 DeepSeek 对话接口，返回文本响应"""
        resp = self.client.chat.completions.create(
            model=settings.deepseek_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,  # 低温度保证输出稳定
            response_format={"type": "json_object"}
            if "json" in system_prompt.lower() else None,
        )
        return resp.choices[0].message.content or ""

    @staticmethod
    def _extract_json(text: str) -> dict | list:
        """从响应中提取 JSON（兼容代码块包裹的情况）"""
        text = text.strip()
        # 去除可能的 ```json ... ``` 包裹
        if text.startswith("```"):
            text = text.split("```")[1] if "```" in text[3:] else text
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
            if text.endswith("```"):
                text = text[:-3].strip()
        return json.loads(text)

    # ===== 字段抽取 =====

    def extract_fields(self, paragraphs: List[ContractParagraph]) -> List[ExtractedField]:
        """AI 抽取合同字段"""
        if settings.is_mock_mode:
            return self._mock_extract_fields()

        try:
            user_prompt = prompt_service.build_field_extraction_prompt(paragraphs)
            resp_text = self._chat(prompt_service.FIELD_EXTRACTION_SYSTEM, user_prompt)
            data = self._extract_json(resp_text)
            if not isinstance(data, list):
                raise ValueError(f"字段抽取响应格式错误：期望数组，实际 {type(data).__name__}")

            fields: List[ExtractedField] = []
            for item in data:
                confidence = float(item.get("confidence", 0.5))
                fields.append(ExtractedField(
                    fieldKey=item.get("fieldKey", ""),
                    fieldLabel=item.get("fieldLabel", ""),
                    fieldValue=item.get("fieldValue", ""),
                    confidence=confidence,
                    lowConfidence=confidence < 0.85,
                    sourceText=item.get("sourceText", ""),
                ))
            return fields
        except Exception as e:
            logger.exception("字段抽取失败")
            raise RuntimeError(f"AI 字段抽取失败：{e}") from e

    # ===== 风险审核 =====

    def review_risks(
        self,
        paragraphs: List[ContractParagraph],
        contract_type: str | None = None,
        my_role: str | None = None,
        review_focus: List[str] = None,
        review_note: str | None = None,
    ) -> Tuple[List[RiskItemAI], str]:
        """AI 审核合同风险，返回 (风险列表, AI 摘要)"""
        if settings.is_mock_mode:
            return self._mock_review_risks(paragraphs)

        try:
            user_prompt = prompt_service.build_risk_review_prompt(
                paragraphs, contract_type, my_role, review_focus or [], review_note,
            )
            resp_text = self._chat(prompt_service.RISK_REVIEW_SYSTEM, user_prompt)
            data = self._extract_json(resp_text)
            if not isinstance(data, dict):
                raise ValueError(f"风险审核响应格式错误：期望对象，实际 {type(data).__name__}")

            risks_data = data.get("risks", [])
            risks: List[RiskItemAI] = []
            for item in risks_data:
                confidence = float(item.get("confidence", 0.7))
                risks.append(RiskItemAI(
                    title=item.get("title", "未命名风险"),
                    riskType=item.get("riskType", "subject"),
                    riskLevel=item.get("riskLevel", "medium"),
                    clauseNumber=item.get("clauseNumber", "未标注"),
                    clauseTitle=item.get("clauseTitle", ""),
                    originalText=item.get("originalText", ""),
                    paragraphId=item.get("paragraphId", paragraphs[0].id if paragraphs else ""),
                    startPosition=int(item.get("startPosition", 0)),
                    endPosition=int(item.get("endPosition", 0)),
                    riskReason=item.get("riskReason", ""),
                    reviewBasis=item.get("reviewBasis", ""),
                    suggestion=item.get("suggestion", ""),
                    confidence=confidence,
                    sourceType=item.get("sourceType", "ai"),
                ))

            ai_summary = data.get("aiSummary", f"本次审核共识别 {len(risks)} 项风险")
            return risks, ai_summary
        except Exception as e:
            logger.exception("风险审核失败")
            raise RuntimeError(f"AI 风险审核失败：{e}") from e

    # ===== Mock 数据（API Key 未配置时返回）=====

    def _mock_extract_fields(self) -> List[ExtractedField]:
        """Mock 字段抽取结果"""
        return [
            ExtractedField(fieldKey="contractName", fieldLabel="合同名称",
                          fieldValue="演示合同", confidence=0.95,
                          lowConfidence=False, sourceText="[Mock] 演示合同"),
            ExtractedField(fieldKey="amount", fieldLabel="合同金额",
                          fieldValue="100000", confidence=0.9,
                          lowConfidence=False, sourceText="[Mock] 合同金额 100000 元"),
            ExtractedField(fieldKey="contractNo", fieldLabel="合同编号",
                          fieldValue="未约定", confidence=0.4,
                          lowConfidence=True, sourceText="[Mock] 未约定"),
        ]

    def _mock_review_risks(
        self, paragraphs: List[ContractParagraph]
    ) -> Tuple[List[RiskItemAI], str]:
        """Mock 风险审核结果"""
        first_p = paragraphs[0] if paragraphs else ContractParagraph(
            id="p1", index=1, text=""
        )
        mock_risks = [
            RiskItemAI(
                title="[Mock] 验收标准笼统",
                riskType="acceptance", riskLevel="medium",
                clauseNumber="第五条", clauseTitle="验收标准",
                originalText=first_p.text[:30] if first_p.text else "验收标准",
                paragraphId=first_p.id,
                startPosition=0, endPosition=min(30, len(first_p.text)),
                riskReason="[Mock] 验收标准缺乏量化指标",
                reviewBasis="[Mock] 行业惯例",
                suggestion="[Mock] 建议明确验收指标",
                confidence=0.85, sourceType="ai",
            ),
        ]
        return mock_risks, "[Mock] 本次为演示数据，请配置 DEEPSEEK_API_KEY 启用真实审核"


# 单例
ai_service = AIService()
