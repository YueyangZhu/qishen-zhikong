"""DeepSeek AI 服务（兼容 OpenAI 协议）

使用 openai SDK 调用 DeepSeek，支持：
- 字段抽取（结构化 JSON 输出）
- 风险审核（结构化 JSON 输出，含规则库注入）
- Mock 模式 fallback（API Key 未配置时返回预设数据）
- 限流自动重试（指数退避，最多 3 次）
"""
import json
import logging
import time
from typing import List, Tuple, Optional
from openai import OpenAI, APIStatusError, APITimeoutError, APIConnectionError

from app.config import settings
from app.schemas.review import (
    ContractParagraph, ExtractedField, RiskItemAI,
)
from app.services import prompt_service
from app.services.rule_service import rule_service

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

    def _is_rate_limit_error(self, exc: Exception) -> bool:
        """判断是否为限流错误（HTTP 429 / TPM 超限）"""
        if isinstance(exc, APIStatusError):
            if exc.status_code == 429:
                return True
        msg = str(exc).lower()
        return any(kw in msg for kw in ["rate limit", "tpm", "too many requests", "429"])

    def _is_retryable_error(self, exc: Exception) -> bool:
        """判断是否为可重试的错误（限流、超时、连接错误、5xx 服务器错误）

        DeepSeek 复杂合同审核可能因网络抖动、服务端瞬时错误导致失败，
        对这些可恢复错误自动重试，避免单次失败导致整个审核流程中断。
        """
        # 限流错误：可重试
        if self._is_rate_limit_error(exc):
            return True
        # 超时错误：可重试（DeepSeek 响应慢但不代表请求无效）
        if isinstance(exc, APITimeoutError):
            return True
        # 连接错误：可重试（网络抖动、DNS 解析失败等）
        if isinstance(exc, APIConnectionError):
            return True
        # 5xx 服务器错误：可重试（DeepSeek 服务端瞬时故障）
        if isinstance(exc, APIStatusError):
            if exc.status_code >= 500:
                return True
        # 其他异常（如 4xx 业务错误、JSON 解析错误）不重试
        return False

    def _chat_with_retry(self, system_prompt: str, user_prompt: str, max_retries: int = 3) -> str:
        """调用 DeepSeek 对话接口，支持限流/超时/连接错误自动重试（指数退避）"""
        last_exc = None
        for attempt in range(1, max_retries + 1):
            try:
                resp = self.client.chat.completions.create(
                    model=settings.deepseek_model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=0.1,
                )
                return resp.choices[0].message.content or ""
            except APIStatusError as e:
                # 记录详细诊断信息，便于识别第三方 API 代理返回的非标准错误
                # （如 "model features vision not support" 是第三方代理报错，非 DeepSeek 官方）
                server = e.response.headers.get("server", "?") if e.response else "?"
                url = str(e.response.request.url) if e.response else "?"
                logger.error(
                    f"DeepSeek API 调用失败 [HTTP {e.status_code}] "
                    f"端点={url} Server={server} "
                    f"响应体={e.body if hasattr(e, 'body') else str(e)[:500]}"
                )
                # 5xx 服务器错误可重试，4xx 业务错误不重试
                if self._is_retryable_error(e) and attempt < max_retries:
                    wait_time = min(2 ** attempt * 3, 30)
                    logger.warning(
                        f"DeepSeek 服务器错误 [HTTP {e.status_code}]（第 {attempt}/{max_retries} 次），"
                        f"{wait_time}s 后重试..."
                    )
                    time.sleep(wait_time)
                    last_exc = e
                    continue
                raise RuntimeError(
                    f"AI 调用失败 [HTTP {e.status_code}]：{e.message if hasattr(e, 'message') else str(e)[:300]}. "
                    f"端点：{url}（若非 api.deepseek.com 说明用了第三方代理，请检查 Render 环境变量 DEEPSEEK_BASE_URL）"
                ) from e
            except Exception as e:
                last_exc = e
                if not self._is_retryable_error(e):
                    raise
                # 限流/超时/连接错误：指数退避重试
                wait_time = min(2 ** attempt * 3, 30)
                error_type = type(e).__name__
                logger.warning(
                    f"DeepSeek {error_type}（第 {attempt}/{max_retries} 次），{wait_time}s 后重试..."
                )
                time.sleep(wait_time)
        raise RuntimeError(
            f"DeepSeek 调用失败，已重试 {max_retries} 次仍失败：{last_exc}"
        ) from last_exc

    def _chat(self, system_prompt: str, user_prompt: str) -> str:
        """调用 DeepSeek 对话接口，返回文本响应"""
        resp = self.client.chat.completions.create(
            model=settings.deepseek_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
        )
        return resp.choices[0].message.content or ""

    @staticmethod
    def _extract_json(text: str) -> dict | list:
        """从响应中提取 JSON（兼容代码块包裹的情况）"""
        text = text.strip()
        if text.startswith("```"):
            text = text.split("```")[1] if "```" in text[3:] else text
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
            if text.endswith("```"):
                text = text[:-3].strip()
        return json.loads(text)

    @staticmethod
    def _resolve_rule_id(matched_rule_id: Optional[str]) -> Optional[str]:
        """将 AI 返回的 matchedRuleId（如 RR-PAY-001）解析为规则库的 ID（如 RR-003）"""
        if not matched_rule_id:
            return None
        # 如果已传完整 ID 直接返回
        if matched_rule_id.startswith("RR-"):
            return matched_rule_id
        # 尝试通过规则编码查找
        rules = rule_service.get_enabled_rules()
        for r in rules:
            if r.code == matched_rule_id or r.id == matched_rule_id:
                return r.id
        return matched_rule_id

    # ===== 字段抽取 =====

    def extract_fields(self, paragraphs: List[ContractParagraph]) -> List[ExtractedField]:
        """AI 抽取合同字段"""
        if settings.is_mock_mode:
            return self._mock_extract_fields()

        try:
            user_prompt = prompt_service.build_field_extraction_prompt(paragraphs)
            resp_text = self._chat_with_retry(prompt_service.FIELD_EXTRACTION_SYSTEM, user_prompt)
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

    # ===== 风险审核（规则库注入版）=====

    def review_risks(
        self,
        paragraphs: List[ContractParagraph],
        contract_type: str | None = None,
        my_role: str | None = None,
        review_focus: List[str] = None,
        review_note: str | None = None,
    ) -> Tuple[List[RiskItemAI], str]:
        """AI 审核合同风险，返回 (风险列表, AI 摘要)

        流程：
        1. 从 Supabase 读取已启用的规则
        2. 将规则注入 AI 系统提示词，让 DeepSeek 在审核时参考规则库
        3. AI 返回风险后，将 matchedRuleId 解析为 ruleId
        """
        if settings.is_mock_mode:
            return self._mock_review_risks(paragraphs)

        try:
            # 1. 读取已启用规则，格式化为 Prompt 文本
            rules = rule_service.get_enabled_rules(contract_type)
            rules_text = rule_service.format_rules_for_prompt(rules)
            logger.info(f"规则库注入：已加载 {len(rules)} 条启用规则" if rules else "规则库为空，将按基础模式审核")

            # 2. 构造带规则注入的系统提示词
            system_prompt = prompt_service.build_risk_review_system(rules_text)
            user_prompt = prompt_service.build_risk_review_prompt(
                paragraphs, contract_type, my_role, review_focus or [], review_note,
            )
            resp_text = self._chat_with_retry(system_prompt, user_prompt)
            data = self._extract_json(resp_text)
            if not isinstance(data, dict):
                raise ValueError(f"风险审核响应格式错误：期望对象，实际 {type(data).__name__}")

            # 3. 解析 AI 返回的风险，并解析 matchedRuleId
            # 对 riskType / riskLevel 做枚举值校验，防止 LLM 返回不在数据库枚举范围内的值
            # 导致 batch_save_risks 的 insert 静默失败（约束违反）
            VALID_RISK_TYPES = {
                "subject", "amount", "payment", "delivery", "acceptance",
                "warranty", "breach", "termination", "ip", "confidentiality",
                "data_security", "dispute", "term",
            }
            VALID_RISK_LEVELS = {"high", "medium", "low", "notice"}

            risks_data = data.get("risks", [])
            risks: List[RiskItemAI] = []
            invalid_type_count = 0
            invalid_level_count = 0
            for item in risks_data:
                confidence = float(item.get("confidence", 0.7))
                # confidence 范围校验：数据库字段为 NUMERIC(3,2)，范围 -9.99~9.99
                # 如果 AI 返回百分比（如 85），转换为 0-1 区间；负数或非数兜底为 0
                if confidence > 1:
                    confidence = confidence / 100 if confidence <= 100 else 1.0
                elif confidence < 0:
                    confidence = 0.0
                matched_rule_id = item.get("matchedRuleId") or None
                rule_id = self._resolve_rule_id(matched_rule_id)
                raw_type = item.get("riskType", "subject")
                raw_level = item.get("riskLevel", "medium")
                # 枚举值校验：不在范围内的映射到默认值
                if raw_type not in VALID_RISK_TYPES:
                    logger.warning(f"AI 返回了无效的 riskType='{raw_type}'，已降级为 'subject'")
                    invalid_type_count += 1
                    raw_type = "subject"
                if raw_level not in VALID_RISK_LEVELS:
                    logger.warning(f"AI 返回了无效的 riskLevel='{raw_level}'，已降级为 'medium'")
                    invalid_level_count += 1
                    raw_level = "medium"
                risks.append(RiskItemAI(
                    title=item.get("title", "未命名风险"),
                    riskType=raw_type,
                    riskLevel=raw_level,
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
                    sourceType="rule" if rule_id else "ai",
                    matchedRuleId=rule_id,
                ))
            if invalid_type_count or invalid_level_count:
                logger.warning(f"AI 返回值校验：{invalid_type_count} 个无效 riskType，{invalid_level_count} 个无效 riskLevel 已降级处理")

            # 4. 统计规则匹配情况
            rule_matched = sum(1 for r in risks if r.matchedRuleId)
            if rule_matched > 0:
                logger.info(f"规则匹配：{rule_matched}/{len(risks)} 项风险关联了规则库")

            ai_summary = data.get("aiSummary", f"本次审核共识别 {len(risks)} 项风险，其中 {rule_matched} 项匹配规则库")
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
                matchedRuleId=None,
            ),
        ]
        return mock_risks, "[Mock] 本次为演示数据，请配置 DEEPSEEK_API_KEY 启用真实审核"


# 单例
ai_service = AIService()
