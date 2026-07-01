"""种子数据迁移脚本：把演示数据写入 Supabase 数据库

用法：
    cd backend
    .\\venv\\Scripts\\python.exe supabase\\seed.py

数据来源：src/mock/seedData.ts + src/mock/contractText.ts
表结构：  backend/supabase/schema.sql
字段映射：camelCase → snake_case（与 app/routers/data.py 的 _to_db_row 一致）

幂等性：每次运行先清空表再插入。
"""
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

# ===== 加载 .env（位于 backend/.env）=====
BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()


# ============================================================
# 数据定义（与 src/mock/seedData.ts、contractText.ts 保持一致）
# 字段保持 camelCase，插入前由 to_snake_row 转为 snake_case
# ============================================================

# ===== 用户（3 个）=====
DEMO_USERS = [
    {
        "id": "U-PURCHASER",
        "name": "李明",
        "email": "purchaser@qszk.com",
        "role": "purchaser",
        "department": "采购部",
        "position": "采购经理",
        "avatarColor": "#1677ff",
    },
    {
        "id": "U-LEGAL",
        "name": "王律师",
        "email": "legal@qszk.com",
        "role": "legal",
        "department": "法务部",
        "position": "高级法务",
        "avatarColor": "#13c2c2",
    },
    {
        "id": "U-ADMIN",
        "name": "张管理员",
        "email": "admin@qszk.com",
        "role": "admin",
        "department": "信息技术部",
        "position": "系统管理员",
        "avatarColor": "#722ed1",
    },
]

# ===== 风险规则库（16 条）=====
DEMO_RULES = [
    {"id": "RR-001", "code": "RR-SUB-001", "name": "合同主体名称或统一社会信用代码缺失", "contractType": "采购合同", "riskType": "subject", "riskLevel": "medium", "method": "field", "triggerCondition": "甲乙方名称、统一社会信用代码、联系地址任一缺失", "reasonTemplate": "合同主体信息不完整，缺少{missing}，可能影响主体资格认定与履约追责。", "suggestionTemplate": "建议补充完整的主体信息，并与营业执照一致。", "status": "enabled", "version": 1, "description": "校验合同主体字段完整性", "updatedAt": "2026-06-01T09:00:00.000Z"},
    {"id": "RR-002", "code": "RR-AMT-001", "name": "合同大小写金额不一致", "contractType": "采购合同", "riskType": "amount", "riskLevel": "high", "method": "field", "triggerCondition": "数字金额与大写金额折算后不一致", "reasonTemplate": "合同金额数字与大写不一致，存在金额认定争议风险。", "suggestionTemplate": "以确认金额统一修改大小写表述。", "status": "enabled", "version": 1, "description": "金额大小写一致性校验", "updatedAt": "2026-06-01T09:00:00.000Z"},
    {"id": "RR-003", "code": "RR-PAY-001", "name": "预付款比例超过50%且无担保", "contractType": "采购合同", "riskType": "payment", "riskLevel": "high", "method": "field", "triggerCondition": "预付款比例>50% 且未约定履约保函/担保", "reasonTemplate": "预付款比例{ratio}过高，未约定履约保障，存在款项回收风险。", "suggestionTemplate": "降低预付款比例至30%以内，或要求乙方提供等额履约保函。", "status": "enabled", "version": 1, "description": "预付款比例与担保校验", "updatedAt": "2026-06-02T09:00:00.000Z"},
    {"id": "RR-004", "code": "RR-PAY-002", "name": "预付款缺少履约保障", "contractType": "采购合同", "riskType": "payment", "riskLevel": "high", "method": "ai", "triggerCondition": "存在预付款条款但未约定履约保函、保证金或担保措施", "reasonTemplate": "预付款无履约保障，乙方违约时甲方预付款难以追回。", "suggestionTemplate": "要求乙方提供与预付款等额的履约保函或保证金。", "status": "enabled", "version": 1, "description": "预付款履约保障校验", "updatedAt": "2026-06-02T09:00:00.000Z"},
    {"id": "RR-005", "code": "RR-PAY-003", "name": "未约定发票类型或开票时间", "contractType": "采购合同", "riskType": "payment", "riskLevel": "medium", "method": "field", "triggerCondition": "付款条款未约定发票类型或开票节点", "reasonTemplate": "未约定增值税发票类型及开票时间，影响进项抵扣与付款节奏。", "suggestionTemplate": "补充增值税专用发票类型，并明确开票节点（如付款前开具）。", "status": "enabled", "version": 1, "description": "发票条款校验", "updatedAt": "2026-06-02T09:00:00.000Z"},
    {"id": "RR-006", "code": "RR-DEL-001", "name": "未明确交付日期或仅写尽快", "contractType": "采购合同", "riskType": "delivery", "riskLevel": "high", "method": "ai", "triggerCondition": "交付日期缺失或使用\"尽快\"\"及时\"等模糊表述", "reasonTemplate": "交付日期不明确，使用\"{word}\"等模糊表述，延期责任难以主张。", "suggestionTemplate": "约定明确的交付日期（如2026年X月X日）及延期违约责任。", "status": "enabled", "version": 1, "description": "交付日期明确性校验", "updatedAt": "2026-06-03T09:00:00.000Z"},
    {"id": "RR-007", "code": "RR-ACC-001", "name": "验收标准无法量化", "contractType": "采购合同", "riskType": "acceptance", "riskLevel": "medium", "method": "ai", "triggerCondition": "验收标准使用\"符合甲方要求\"等无量化指标表述", "reasonTemplate": "验收标准模糊，缺乏量化指标，易引发验收争议。", "suggestionTemplate": "补充量化验收标准、测试用例及验收流程，作为合同附件。", "status": "enabled", "version": 1, "description": "验收标准量化校验", "updatedAt": "2026-06-03T09:00:00.000Z"},
    {"id": "RR-008", "code": "RR-ACC-002", "name": "验收期限缺失", "contractType": "采购合同", "riskType": "acceptance", "riskLevel": "medium", "method": "field", "triggerCondition": "未约定验收期限或异议期", "reasonTemplate": "未约定验收期限，可能导致视为验收合格的法律后果。", "suggestionTemplate": "约定交付后X个工作日内完成验收，逾期未提出视为合格。", "status": "enabled", "version": 1, "description": "验收期限校验", "updatedAt": "2026-06-03T09:00:00.000Z"},
    {"id": "RR-009", "code": "RR-WAR-001", "name": "未约定质保期和响应时限", "contractType": "采购合同", "riskType": "warranty", "riskLevel": "medium", "method": "field", "triggerCondition": "未约定质保期限或故障响应/修复时限", "reasonTemplate": "质保期限及响应时限缺失，售后责任不清。", "suggestionTemplate": "补充质保期限（如1年）、故障响应时限（如4小时）及修复时限。", "status": "enabled", "version": 1, "description": "质保条款校验", "updatedAt": "2026-06-04T09:00:00.000Z"},
    {"id": "RR-010", "code": "RR-BRCH-001", "name": "违约责任严重不对等", "contractType": "采购合同", "riskType": "breach", "riskLevel": "high", "method": "ai", "triggerCondition": "甲方违约金显著高于乙方违约金或乙方责任上限过低", "reasonTemplate": "违约责任不对等，甲方违约金{a}，乙方违约金{b}且上限过低，权利义务失衡。", "suggestionTemplate": "调整为对等违约责任，取消或提高乙方违约金上限。", "status": "enabled", "version": 1, "description": "违约责任对等性校验", "updatedAt": "2026-06-04T09:00:00.000Z"},
    {"id": "RR-011", "code": "RR-TERM-001", "name": "乙方享有单方解除权", "contractType": "采购合同", "riskType": "termination", "riskLevel": "high", "method": "ai", "triggerCondition": "乙方享有单方解除权而甲方无对应权利", "reasonTemplate": "乙方享有单方解除权，甲方无对应权利，存在被动终止风险。", "suggestionTemplate": "删除乙方单方解除权，或设置甲方对等的解除条件。", "status": "enabled", "version": 1, "description": "合同解除权对等性校验", "updatedAt": "2026-06-05T09:00:00.000Z"},
    {"id": "RR-012", "code": "RR-IP-001", "name": "定制成果知识产权归属不利", "contractType": "采购合同", "riskType": "ip", "riskLevel": "high", "method": "ai", "triggerCondition": "定制开发成果知识产权全部归乙方，甲方仅享有使用权", "reasonTemplate": "定制成果知识产权全部归乙方，甲方付费开发却无所有权，权益受损。", "suggestionTemplate": "明确甲方对定制成果的所有权，或至少享有永久、不可撤销的使用权。", "status": "enabled", "version": 1, "description": "知识产权归属校验", "updatedAt": "2026-06-05T09:00:00.000Z"},
    {"id": "RR-013", "code": "RR-CON-001", "name": "保密义务无期限", "contractType": "采购合同", "riskType": "confidentiality", "riskLevel": "medium", "method": "ai", "triggerCondition": "保密条款未约定保密期限或范围", "reasonTemplate": "保密义务无期限约定，可能被无限期扩大解释。", "suggestionTemplate": "补充保密信息定义、保密期限（如3年）及例外情形。", "status": "enabled", "version": 1, "description": "保密期限校验", "updatedAt": "2026-06-06T09:00:00.000Z"},
    {"id": "RR-014", "code": "RR-DS-001", "name": "数据安全责任划分不清", "contractType": "采购合同", "riskType": "data_security", "riskLevel": "high", "method": "ai", "triggerCondition": "未约定数据泄露责任、通知义务及终止后数据删除返还", "reasonTemplate": "数据安全责任划分不清，未约定泄露通知与数据删除机制。", "suggestionTemplate": "补充数据安全责任、泄露通知时限及合同终止后数据删除/返还机制。", "status": "enabled", "version": 1, "description": "数据安全责任校验", "updatedAt": "2026-06-06T09:00:00.000Z"},
    {"id": "RR-015", "code": "RR-DIS-001", "name": "争议管辖地对我方不利", "contractType": "采购合同", "riskType": "dispute", "riskLevel": "high", "method": "ai", "triggerCondition": "约定由乙方所在地法院管辖", "reasonTemplate": "争议由乙方所在地法院管辖，异地诉讼增加维权成本。", "suggestionTemplate": "改为甲方所在地或合同履行地有管辖权的法院管辖。", "status": "enabled", "version": 1, "description": "争议管辖校验", "updatedAt": "2026-06-07T09:00:00.000Z"},
    {"id": "RR-016", "code": "RR-TM-001", "name": "自动续期未设置提前通知", "contractType": "采购合同", "riskType": "term", "riskLevel": "medium", "method": "ai", "triggerCondition": "约定自动续期但未设置提前通知或确认", "reasonTemplate": "自动续期未约定提前通知，可能导致非预期续约。", "suggestionTemplate": "增加续期前30日书面确认或提前通知条款。", "status": "enabled", "version": 1, "description": "合同期限与续期校验", "updatedAt": "2026-06-07T09:00:00.000Z"},
    # 新增规则（关键词匹配增强版，供测试合同验证）
    {"id": "RR-017", "code": "RR-SUB-002", "name": "甲方主体信息不完整", "contractType": "采购合同", "riskType": "subject", "riskLevel": "medium", "method": "field", "triggerCondition": "甲方名称或统一社会信用代码缺失", "reasonTemplate": "甲方主体信息不完整，缺少{missing}，可能影响合同效力。", "suggestionTemplate": "补充甲方完整主体信息，包括名称、信用代码及联系地址。", "status": "enabled", "version": 1, "description": "甲方主体字段完整性校验", "updatedAt": "2026-06-08T09:00:00.000Z"},
    {"id": "RR-018", "code": "RR-DOC-001", "name": "合同附件清单缺失", "contractType": "采购合同", "riskType": "subject", "riskLevel": "low", "method": "keyword", "triggerCondition": "合同未列明附件清单或附件内容", "reasonTemplate": "未列明合同附件清单，附件法律效力不清。", "suggestionTemplate": "补充合同附件清单，明确附件内容与法律效力。", "status": "enabled", "version": 1, "description": "附件完整性校验", "updatedAt": "2026-06-08T09:00:00.000Z"},
    {"id": "RR-019", "code": "RR-PAY-004", "name": "付款节点与交付节点脱钩", "contractType": "采购合同", "riskType": "payment", "riskLevel": "high", "method": "keyword", "triggerCondition": "付款节点与交付、验收节点不对应", "reasonTemplate": "付款节点与交付/验收节点未关联，可能导致先付款后收货的风险。", "suggestionTemplate": "将付款节点与交付验收节点挂钩，如验收合格后X日内付款。", "status": "enabled", "version": 1, "description": "付款节奏校验", "updatedAt": "2026-06-09T09:00:00.000Z"},
    {"id": "RR-020", "code": "RR-REN-001", "name": "续约条件不明确", "contractType": "采购合同", "riskType": "term", "riskLevel": "medium", "method": "keyword", "triggerCondition": "续约条件或续约价格调整机制未约定", "reasonTemplate": "续约条件未明确，续约时价格与服务可能产生争议。", "suggestionTemplate": "明确续约条件、价格调整机制及续约通知期限。", "status": "enabled", "version": 1, "description": "续约条款校验", "updatedAt": "2026-06-09T09:00:00.000Z"},
    {"id": "RR-021", "code": "RR-FORCE-001", "name": "不可抗力条款缺失", "contractType": "采购合同", "riskType": "term", "riskLevel": "medium", "method": "keyword", "triggerCondition": "未约定不可抗力条款", "reasonTemplate": "未约定不可抗力条款，遇不可抗力事件时责任划分不清。", "suggestionTemplate": "补充不可抗力条款，明确不可抗力事件范围、通知义务与免责范围。", "status": "enabled", "version": 1, "description": "不可抗力条款校验", "updatedAt": "2026-06-10T09:00:00.000Z"},
    {"id": "RR-022", "code": "RR-INDEM-001", "name": "赔偿上限不合理", "contractType": "采购合同", "riskType": "breach", "riskLevel": "medium", "method": "keyword", "triggerCondition": "乙方赔偿上限过低", "reasonTemplate": "乙方赔偿上限过低，不足以覆盖甲方可能遭受的损失。", "suggestionTemplate": "提高赔偿上限至合同金额的100%或实际损失额。", "status": "enabled", "version": 1, "description": "赔偿上限校验", "updatedAt": "2026-06-10T09:00:00.000Z"},
    {"id": "RR-023", "code": "RR-ASSIGN-001", "name": "合同转让未约定限制", "contractType": "采购合同", "riskType": "term", "riskLevel": "low", "method": "keyword", "triggerCondition": "未约定合同转让限制条件", "reasonTemplate": "未约定合同转让限制，任一方可将合同权利义务转让给第三方。", "suggestionTemplate": "增加合同转让限制条款，约定未经对方书面同意不得转让。", "status": "enabled", "version": 1, "description": "合同转让限制校验", "updatedAt": "2026-06-11T09:00:00.000Z"},
    {"id": "RR-024", "code": "RR-LAW-001", "name": "适用法律未约定", "contractType": "采购合同", "riskType": "dispute", "riskLevel": "medium", "method": "keyword", "triggerCondition": "未约定合同适用法律", "reasonTemplate": "未约定适用法律，争议时法律适用不明确。", "suggestionTemplate": "明确约定适用中华人民共和国法律。", "status": "enabled", "version": 1, "description": "适用法律校验", "updatedAt": "2026-06-11T09:00:00.000Z"},
    {"id": "RR-025", "code": "RR-COST-001", "name": "隐含费用未约定承担方", "contractType": "采购合同", "riskType": "amount", "riskLevel": "medium", "method": "keyword", "triggerCondition": "运输、保险、安装等附带费用承担未约定", "reasonTemplate": "运输、保险、安装等附带费用承担方未明确，可能产生额外成本。", "suggestionTemplate": "明确运输费、保险费、安装费等附带费用的承担方。", "status": "enabled", "version": 1, "description": "附带费用校验", "updatedAt": "2026-06-12T09:00:00.000Z"},
    {"id": "RR-026", "code": "RR-TRAIN-001", "name": "培训义务未约定", "contractType": "采购合同", "riskType": "delivery", "riskLevel": "low", "method": "keyword", "triggerCondition": "涉及系统交付但未约定培训义务", "reasonTemplate": "系统交付未约定培训义务，甲方人员可能无法正常使用系统。", "suggestionTemplate": "补充乙方培训义务，包括培训时间、内容与人数。", "status": "enabled", "version": 1, "description": "培训义务校验", "updatedAt": "2026-06-12T09:00:00.000Z"},
]

# ===== 风险模板（18 个，引用 RISK_SNIPPETS）=====
DEMO_RISK_TEMPLATES = [
    {"snippetKey": "R1", "title": "乙方主体信息不完整", "riskType": "subject", "riskLevel": "medium", "clauseNumber": "第一条", "clauseTitle": "合同主体", "riskReason": "乙方未提供统一社会信用代码与联系地址，主体信息不完整，可能影响主体资格认定与后续履约追责。", "reviewBasis": "《合同主体信息完整性规则 RR-SUB-001》：合同主体应包含名称、统一社会信用代码、法定代表人及联系地址。", "suggestion": "要求乙方补充完整的统一社会信用代码、注册地址及联系方式，并与营业执照核对一致。", "confidence": 0.88, "sourceType": "rule", "ruleId": "RR-001"},
    {"snippetKey": "R2", "title": "合同金额大小写不一致", "riskType": "amount", "riskLevel": "high", "clauseNumber": "第三条", "clauseTitle": "合同金额", "riskReason": "合同金额数字为580000元（伍拾捌万元），但大写写为\"伍拾捌万捌仟元整\"，多出捌仟元，大小写不一致，存在金额认定争议风险。", "reviewBasis": "《金额一致性规则 RR-AMT-001》：合同金额数字与大写折算后应完全一致。", "suggestion": "以580000元为准，将大写修改为\"伍拾捌万元整\"，确保大小写一致。", "confidence": 0.95, "sourceType": "rule", "ruleId": "RR-002"},
    {"snippetKey": "R3", "title": "预付款比例过高", "riskType": "payment", "riskLevel": "high", "clauseNumber": "第四条", "clauseTitle": "付款方式", "riskReason": "预付款比例为80%，显著超过50%的行业惯例，若乙方履约能力不足，甲方预付款回收风险较高。", "reviewBasis": "《预付款规则 RR-PAY-001》：预付款比例超过50%且无担保时触发高风险。", "suggestion": "将预付款比例降至30%以内，剩余款项按交付与验收节点分期支付。", "confidence": 0.93, "sourceType": "rule", "ruleId": "RR-003"},
    {"snippetKey": "R4", "title": "预付款缺少履约保障", "riskType": "payment", "riskLevel": "high", "clauseNumber": "第四条", "clauseTitle": "付款方式", "riskReason": "约定80%预付款但未要求乙方提供履约保函或保证金，一旦乙方违约，甲方预付款难以追回。", "reviewBasis": "《预付款履约保障规则 RR-PAY-002》：高额预付款应配套履约保函或担保。", "suggestion": "要求乙方提供与预付款等额的银行履约保函，或在付款前约定担保措施。", "confidence": 0.86, "sourceType": "ai", "ruleId": "RR-004"},
    {"snippetKey": "R5", "title": "交付日期不明确", "riskType": "delivery", "riskLevel": "high", "clauseNumber": "第五条", "clauseTitle": "交付安排", "riskReason": "交付时间仅表述为\"尽快\"，无明确日期，乙方延期交付时甲方难以主张违约责任。", "reviewBasis": "《交付日期规则 RR-DEL-001》：交付日期应明确，禁止使用\"尽快\"等模糊表述。", "suggestion": "约定明确的交付日期（如2026年8月31日），并约定延期交付的违约责任。", "confidence": 0.5, "sourceType": "ai", "ruleId": "RR-006"},
    {"snippetKey": "R6", "title": "验收标准无法量化", "riskType": "acceptance", "riskLevel": "medium", "clauseNumber": "第六条", "clauseTitle": "验收标准", "riskReason": "验收标准为\"符合甲方要求\"，缺乏量化指标与测试依据，易引发验收争议。", "reviewBasis": "《验收标准规则 RR-ACC-001》：验收标准应可量化、可测试。", "suggestion": "补充量化验收指标、测试用例及验收流程，作为合同附件。", "confidence": 0.82, "sourceType": "ai", "ruleId": "RR-007"},
    {"snippetKey": "R7", "title": "验收期限缺失", "riskType": "acceptance", "riskLevel": "medium", "clauseNumber": "第六条", "clauseTitle": "验收标准", "riskReason": "未约定验收期限与异议期，依据《民法典》可能产生\"交付后视为验收合格\"的法律后果。", "reviewBasis": "《验收期限规则 RR-ACC-002》：应约定验收期限与异议期。", "suggestion": "约定交付后10个工作日内完成验收，逾期未提出异议视为验收合格。", "confidence": 0.62, "sourceType": "rule", "ruleId": "RR-008"},
    {"snippetKey": "R8", "title": "知识产权归属对甲方不利", "riskType": "ip", "riskLevel": "high", "clauseNumber": "第七条", "clauseTitle": "知识产权", "riskReason": "甲方付费定制开发的成果知识产权全部归乙方，甲方仅享有非独占使用权，权益严重受损。", "reviewBasis": "《知识产权规则 RR-IP-001》：定制开发成果归属应保障甲方权益。", "suggestion": "明确甲方对定制成果的所有权，或至少享有永久、不可撤销、可转授权的使用权。", "confidence": 0.91, "sourceType": "ai", "ruleId": "RR-012"},
    {"snippetKey": "R9", "title": "质保期限缺失", "riskType": "warranty", "riskLevel": "medium", "clauseNumber": "第八条", "clauseTitle": "质保服务", "riskReason": "质保期限与响应时限\"另行约定\"，实质未明确，售后责任不清。", "reviewBasis": "《质保规则 RR-WAR-001》：应明确质保期限与故障响应时限。", "suggestion": "约定不少于1年的质保期，故障4小时响应、24小时修复或提供备机。", "confidence": 0.55, "sourceType": "rule", "ruleId": "RR-009"},
    {"snippetKey": "R10", "title": "保密期限缺失", "riskType": "confidentiality", "riskLevel": "medium", "clauseNumber": "第九条", "clauseTitle": "保密条款", "riskReason": "保密义务未约定期限与范围，可能被无限期扩大解释。", "reviewBasis": "《保密规则 RR-CON-001》：保密条款应明确期限、范围与例外。", "suggestion": "补充保密信息定义、3年保密期限及法定例外情形。", "confidence": 0.79, "sourceType": "ai", "ruleId": "RR-013"},
    {"snippetKey": "R11", "title": "数据安全责任划分不清", "riskType": "data_security", "riskLevel": "high", "clauseNumber": "第十条", "clauseTitle": "数据安全", "riskReason": "数据泄露损失\"由双方共同承担\"，责任比例不清，且未约定泄露通知与终止后数据删除。", "reviewBasis": "《数据安全规则 RR-DS-001》：应明确数据泄露责任、通知义务与数据删除机制。", "suggestion": "明确乙方为主要责任方，约定泄露24小时内通知、终止后数据删除/返还。", "confidence": 0.84, "sourceType": "ai", "ruleId": "RR-014"},
    {"snippetKey": "R12", "title": "自动续期未约定提前通知", "riskType": "term", "riskLevel": "notice", "clauseNumber": "第十一条", "clauseTitle": "合同期限", "riskReason": "合同期满自动续期，未约定提前通知或确认，可能导致非预期续约。", "reviewBasis": "《期限规则 RR-TM-001》：自动续期应设置提前通知。", "suggestion": "增加续期前30日书面确认条款，任一方不同意则不续期。", "confidence": 0.9, "sourceType": "ai", "ruleId": "RR-016"},
    {"snippetKey": "R13", "title": "甲方逾期付款违约金过高", "riskType": "breach", "riskLevel": "high", "clauseNumber": "第十二条", "clauseTitle": "违约责任", "riskReason": "甲方逾期付款违约金为日千分之五（年化约182%），显著过高，可能被法院调整且显失公平。", "reviewBasis": "《违约责任规则 RR-BRCH-001》：违约金应合理且对等。", "suggestion": "将甲方违约金调整为日万分之五（与乙方对等），或日千分之一以内。", "confidence": 0.92, "sourceType": "ai", "ruleId": "RR-010"},
    {"snippetKey": "R14", "title": "乙方延期交付责任过低", "riskType": "breach", "riskLevel": "high", "clauseNumber": "第十二条", "clauseTitle": "违约责任", "riskReason": "乙方延期违约金仅日千分之一且上限1%，与甲方日千分之五严重不对等，乙方违约成本低。", "reviewBasis": "《违约责任对等规则 RR-BRCH-001》：双方违约责任应基本对等。", "suggestion": "提高乙方违约金至与甲方对等，取消1%上限或提高至合同总额的10%。", "confidence": 0.9, "sourceType": "ai", "ruleId": "RR-010"},
    {"snippetKey": "R15", "title": "乙方享有单方解除权", "riskType": "termination", "riskLevel": "high", "clauseNumber": "第十三条", "clauseTitle": "合同解除", "riskReason": "乙方在甲方逾期付款超15日时可单方解除合同，甲方无对应解除权，权利义务失衡。", "reviewBasis": "《解除权规则 RR-TERM-001》：解除权应双方对等。", "suggestion": "增加甲方对等解除权（如乙方延期交付超15日），或设置协商解除机制。", "confidence": 0.87, "sourceType": "ai", "ruleId": "RR-011"},
    {"snippetKey": "R16", "title": "争议管辖地对我方不利", "riskType": "dispute", "riskLevel": "high", "clauseNumber": "第十四条", "clauseTitle": "争议解决", "riskReason": "争议由乙方所在地法院管辖，异地诉讼显著增加甲方维权成本与沟通成本。", "reviewBasis": "《争议管辖规则 RR-DIS-001》：管辖地应有利于我方。", "suggestion": "改为由甲方所在地或合同履行地有管辖权的法院管辖。", "confidence": 0.94, "sourceType": "ai", "ruleId": "RR-015"},
    {"snippetKey": "R17", "title": "发票类型与开票时间未约定", "riskType": "payment", "riskLevel": "medium", "clauseNumber": "第三条", "clauseTitle": "合同金额", "riskReason": "金额条款仅注明\"已含增值税\"，未约定发票类型（专票/普票）及开票时间，影响进项抵扣。", "reviewBasis": "《发票规则 RR-PAY-003》：应约定发票类型与开票节点。", "suggestion": "明确开具增值税专用发票（13%），并约定付款前开具。", "confidence": 0.65, "sourceType": "rule", "ruleId": "RR-005"},
    {"snippetKey": "R18", "title": "通知方式未明确约定", "riskType": "subject", "riskLevel": "low", "clauseNumber": "第十五条", "clauseTitle": "附则", "riskReason": "未约定双方通知送达方式与有效送达地址，争议时通知送达可能产生争议。", "reviewBasis": "常规合同条款完整性提示：建议约定通知送达条款。", "suggestion": "补充通知送达方式（书面/邮件）、有效送达地址及视为送达的情形。", "confidence": 0.7, "sourceType": "ai", "ruleId": ""},
]

# ===== 风险原文片段（key -> {paragraphId, originalText}）=====
RISK_SNIPPETS = {
    "R1": {"paragraphId": "p2", "originalText": "乙方（供应方）：星河软件有限公司\n统一社会信用代码：未提供\n法定代表人：刘星河\n联系地址：未提供"},
    "R2": {"paragraphId": "p4", "originalText": "580000元（大写：伍拾捌万捌仟元整）"},
    "R3": {"paragraphId": "p5", "originalText": "支付合同总额的80%作为预付款"},
    "R4": {"paragraphId": "p5", "originalText": "1.合同签订后7个工作日内，甲方应向乙方支付合同总额的80%作为预付款；"},
    "R5": {"paragraphId": "p6", "originalText": "尽快完成系统的交付与安装部署"},
    "R6": {"paragraphId": "p7", "originalText": "应符合甲方要求"},
    "R7": {"paragraphId": "p7", "originalText": "经甲方确认后签署验收报告，即视为验收合格"},
    "R8": {"paragraphId": "p8", "originalText": "全部归乙方所有，甲方仅享有非独占的使用权"},
    "R9": {"paragraphId": "p9", "originalText": "具体质保期限及响应时限由双方另行约定"},
    "R10": {"paragraphId": "p10", "originalText": "承担保密义务，未经对方书面同意不得向第三方披露"},
    "R11": {"paragraphId": "p11", "originalText": "因数据泄露造成的损失由双方共同承担"},
    "R12": {"paragraphId": "p12", "originalText": "期满后若需继续合作，自动续期"},
    "R13": {"paragraphId": "p13", "originalText": "每日按应付未付金额的千分之五支付违约金"},
    "R14": {"paragraphId": "p13", "originalText": "每日按合同总额的千分之一支付违约金，累计不超过合同总额的1%"},
    "R15": {"paragraphId": "p14", "originalText": "甲方逾期付款超过15日的，乙方有权单方解除本合同"},
    "R16": {"paragraphId": "p15", "originalText": "由乙方所在地有管辖权的人民法院管辖"},
    "R17": {"paragraphId": "p4", "originalText": "上述金额已含增值税"},
    "R18": {"paragraphId": "p16", "originalText": "未尽事宜由双方另行约定"},
}

# ===== 合同段落（用于计算风险原文位置）=====
DEMO_PARAGRAPHS = [
    {"id": "p1", "index": 1, "text": "软件系统采购合同"},
    {"id": "p2", "index": 2, "clauseNo": "第一条", "clauseTitle": "合同主体", "text": "第一条 合同主体\n甲方（采购方）：智远科技有限公司\n统一社会信用代码：91110108MA01ABC23X\n法定代表人：陈志远\n联系地址：北京市海淀区中关村大街1号\n乙方（供应方）：星河软件有限公司\n统一社会信用代码：未提供\n法定代表人：刘星河\n联系地址：未提供"},
    {"id": "p3", "index": 3, "clauseNo": "第二条", "clauseTitle": "采购标的", "text": "第二条 采购标的\n乙方为甲方提供“智远协同办公平台”软件系统一套，含系统授权许可、安装部署、基础培训及一年期技术支持服务。系统功能与技术规格以双方确认的附件为准。"},
    {"id": "p4", "index": 4, "clauseNo": "第三条", "clauseTitle": "合同金额", "text": "第三条 合同金额\n合同总金额为人民币580000元（大写：伍拾捌万捌仟元整）。上述金额已含增值税，不以其他费用另行收取。"},
    {"id": "p5", "index": 5, "clauseNo": "第四条", "clauseTitle": "付款方式", "text": "第四条 付款方式\n1.合同签订后7个工作日内，甲方应向乙方支付合同总额的80%作为预付款；\n2.系统验收合格后10个工作日内，甲方支付剩余20%尾款。"},
    {"id": "p6", "index": 6, "clauseNo": "第五条", "clauseTitle": "交付安排", "text": "第五条 交付安排\n乙方应在合同签订后尽快完成系统的交付与安装部署，并配合甲方完成上线准备。"},
    {"id": "p7", "index": 7, "clauseNo": "第六条", "clauseTitle": "验收标准", "text": "第六条 验收标准\n系统交付后应符合甲方要求，经甲方确认后签署验收报告，即视为验收合格。"},
    {"id": "p8", "index": 8, "clauseNo": "第七条", "clauseTitle": "知识产权", "text": "第七条 知识产权\n乙方为甲方定制开发的系统成果及相关知识产权，全部归乙方所有，甲方仅享有非独占的使用权。"},
    {"id": "p9", "index": 9, "clauseNo": "第八条", "clauseTitle": "质保服务", "text": "第八条 质保服务\n乙方对所提供的系统提供质保服务，具体质保期限及响应时限由双方另行约定。"},
    {"id": "p10", "index": 10, "clauseNo": "第九条", "clauseTitle": "保密条款", "text": "第九条 保密条款\n双方应对因履行本合同而知悉的对方商业信息承担保密义务，未经对方书面同意不得向第三方披露。"},
    {"id": "p11", "index": 11, "clauseNo": "第十条", "clauseTitle": "数据安全", "text": "第十条 数据安全\n双方应采取必要措施保障数据安全，因数据泄露造成的损失由双方共同承担。"},
    {"id": "p12", "index": 12, "clauseNo": "第十一条", "clauseTitle": "合同期限", "text": "第十一条 合同期限\n本合同自双方签字盖章之日起生效，有效期为2年。期满后若需继续合作，自动续期。"},
    {"id": "p13", "index": 13, "clauseNo": "第十二条", "clauseTitle": "违约责任", "text": "第十二条 违约责任\n1.甲方逾期付款的，每日按应付未付金额的千分之五支付违约金；\n2.乙方延期交付的，每日按合同总额的千分之一支付违约金，累计不超过合同总额的1%。"},
    {"id": "p14", "index": 14, "clauseNo": "第十三条", "clauseTitle": "合同解除", "text": "第十三条 合同解除\n甲方逾期付款超过15日的，乙方有权单方解除本合同，并要求甲方承担相应违约责任。"},
    {"id": "p15", "index": 15, "clauseNo": "第十四条", "clauseTitle": "争议解决", "text": "第十四条 争议解决\n因本合同产生的或与本合同有关的争议，由乙方所在地有管辖权的人民法院管辖。"},
    {"id": "p16", "index": 16, "clauseNo": "第十五条", "clauseTitle": "附则", "text": "第十五条 附则\n本合同一式两份，双方各执一份，自双方签字盖章之日起生效。未尽事宜由双方另行约定。"},
]

DEMO_PARAGRAPHS_BY_ID = {p["id"]: p for p in DEMO_PARAGRAPHS}

# ===== 预设审核任务（5 个）=====
DEMO_TASKS = [
    {
        "id": "RVT-DEMO-001", "contractId": "C-001", "contractName": "软件系统采购合同",
        "contractNo": "HT-CG-2026-001", "counterparty": "星河软件有限公司",
        "amount": 580000, "currency": "CNY", "contractType": "采购合同", "myRole": "buyer",
        "department": "采购部",
        "reviewFocus": ["subject", "payment", "delivery", "breach", "ip", "confidentiality", "termination", "dispute"],
        "reviewNote": "本次采购为协同办公平台，需重点关注预付款保障与知识产权归属。",
        "fileName": "软件系统采购合同.docx", "fileSize": 248 * 1024, "sampleId": None,
        "creatorId": "U-PURCHASER", "creatorName": "李明",
        "status": "pending_business", "riskLevelMax": "high",
        "riskCount": {"high": 10, "medium": 6, "low": 1, "notice": 1},
        "progress": 100, "currentStage": "result",
        "errorCode": None, "errorMsg": None, "fieldsConfirmed": False,
        "legalOpinion": None, "legalConclusion": None,
        "legalReviewerId": None, "legalReviewerName": None,
        "submittedAt": None, "completedAt": None,
        "createdAt": "2026-06-20T09:30:00.000Z", "updatedAt": "2026-06-20T09:42:00.000Z",
    },
    {
        "id": "RVT-DEMO-002", "contractId": "C-002", "contractName": "办公设备批量采购合同",
        "contractNo": "HT-CG-2026-002", "counterparty": "华盛办公设备有限公司",
        "amount": 320000, "currency": "CNY", "contractType": "采购合同", "myRole": "buyer",
        "department": "采购部",
        "reviewFocus": ["payment", "delivery", "breach"],
        "reviewNote": "办公设备批量采购，关注交付与验收。",
        "fileName": "办公设备采购合同.pdf", "fileSize": 512 * 1024, "sampleId": "sample-1",
        "creatorId": "U-PURCHASER", "creatorName": "李明",
        "status": "pending_legal", "riskLevelMax": "high",
        "riskCount": {"high": 3, "medium": 4, "low": 1, "notice": 0},
        "progress": 100, "currentStage": "result",
        "errorCode": None, "errorMsg": None, "fieldsConfirmed": True,
        "legalOpinion": None, "legalConclusion": None,
        "legalReviewerId": None, "legalReviewerName": None,
        "submittedAt": "2026-06-18T14:00:00.000Z", "completedAt": None,
        "createdAt": "2026-06-18T10:00:00.000Z", "updatedAt": "2026-06-18T14:00:00.000Z",
    },
    {
        "id": "RVT-DEMO-003", "contractId": "C-003", "contractName": "云服务采购合同",
        "contractNo": "HT-CG-2026-003", "counterparty": "云栈科技有限公司",
        "amount": 860000, "currency": "CNY", "contractType": "采购合同", "myRole": "buyer",
        "department": "信息技术部",
        "reviewFocus": ["payment", "confidentiality", "ip"],
        "reviewNote": "云服务采购，关注数据安全与保密。",
        "fileName": "云服务采购合同.docx", "fileSize": 320 * 1024, "sampleId": "sample-4",
        "creatorId": "U-PURCHASER", "creatorName": "李明",
        "status": "completed", "riskLevelMax": "medium",
        "riskCount": {"high": 0, "medium": 4, "low": 2, "notice": 1},
        "progress": 100, "currentStage": "result",
        "errorCode": None, "errorMsg": None, "fieldsConfirmed": True,
        "legalOpinion": "已按建议修改付款节点与数据安全条款，风险可控。",
        "legalConclusion": "sign_after_modify",
        "legalReviewerId": "U-LEGAL", "legalReviewerName": "王律师",
        "submittedAt": "2026-06-10T11:00:00.000Z", "completedAt": "2026-06-11T15:30:00.000Z",
        "createdAt": "2026-06-09T09:00:00.000Z", "updatedAt": "2026-06-11T15:30:00.000Z",
    },
    {
        "id": "RVT-DEMO-004", "contractId": "C-004", "contractName": "办公耗材采购合同",
        "contractNo": "HT-CG-2026-004", "counterparty": "日常文具商行",
        "amount": 28000, "currency": "CNY", "contractType": "采购合同", "myRole": "buyer",
        "department": "采购部",
        "reviewFocus": ["payment"],
        "reviewNote": "",
        "fileName": "耗材采购合同.pdf", "fileSize": 180 * 1024, "sampleId": None,
        "creatorId": "U-PURCHASER", "creatorName": "李明",
        "status": "failed", "riskLevelMax": None,
        "riskCount": {"high": 0, "medium": 0, "low": 0, "notice": 0},
        "progress": 35, "currentStage": "parse",
        "errorCode": "PARSE_FAILED", "errorMsg": "文档解析失败：检测到加密PDF，无法提取文本内容。",
        "fieldsConfirmed": False,
        "legalOpinion": None, "legalConclusion": None,
        "legalReviewerId": None, "legalReviewerName": None,
        "submittedAt": None, "completedAt": None,
        "createdAt": "2026-06-22T16:00:00.000Z", "updatedAt": "2026-06-22T16:05:00.000Z",
    },
    {"id": "RVT-DEMO-005", "contractId": "C-005", "contractName": "IT运维服务外包合同",
        "contractNo": "HT-CG-2026-005", "counterparty": "运维技术服务部",
        "amount": 150000, "currency": "CNY", "contractType": "采购合同", "myRole": "buyer",
        "department": "信息技术部",
        "reviewFocus": ["subject", "breach", "dispute"],
        "reviewNote": "运维外包，待补充附件。",
        "fileName": "IT运维服务外包合同.docx", "fileSize": 96 * 1024, "sampleId": "sample-2",
        "creatorId": "U-PURCHASER", "creatorName": "李明",
        "status": "draft", "riskLevelMax": None,
        "riskCount": {"high": 0, "medium": 0, "low": 0, "notice": 0},
        "progress": 0, "currentStage": "upload",
        "errorCode": None, "errorMsg": None, "fieldsConfirmed": False,
        "legalOpinion": None, "legalConclusion": None,
        "legalReviewerId": None, "legalReviewerName": None,
        "submittedAt": None, "completedAt": None,
        "createdAt": "2026-06-25T10:00:00.000Z", "updatedAt": "2026-06-25T10:00:00.000Z",
    },
]

# ===== 演示审计日志（操作时间轴数据）=====
# 按任务状态还原操作流程
# T1: 创建 → AI审核完成（待人工确认）
# T2: 创建 → AI审核完成 → 提交法务复核
# T3: 创建 → AI审核完成 → 提交法务复核 → 法务审核通过
# T4: 创建 → 解析失败
# T5: 创建（草稿，未开始审核）
DEMO_AUDIT_LOGS = [
    # --- T1: RVT-DEMO-001 ---
    {"id": "AL-001-001", "reviewTaskId": "RVT-DEMO-001", "objectType": "task",
     "objectId": "RVT-DEMO-001", "action": "创建审核任务",
     "operatorId": "U-PURCHASER", "operatorName": "李明",
     "beforeState": None, "afterState": "草稿",
     "remark": "合同名称：软件系统采购合同\n相对方：星河软件有限公司\n合同金额：580000 元",
     "createdAt": "2026-06-20T09:30:00.000Z"},
    {"id": "AL-001-002", "reviewTaskId": "RVT-DEMO-001", "objectType": "task",
     "objectId": "RVT-DEMO-001", "action": "开始AI审核",
     "operatorId": "U-PURCHASER", "operatorName": "李明",
     "beforeState": "草稿", "afterState": "解析中",
     "remark": "启动文档解析与AI审核流程",
     "createdAt": "2026-06-20T09:30:05.000Z"},
    {"id": "AL-001-003", "reviewTaskId": "RVT-DEMO-001", "objectType": "task",
     "objectId": "RVT-DEMO-001", "action": "AI审核完成",
     "operatorId": "system", "operatorName": "AI 系统（DeepSeek）",
     "beforeState": "AI审核中", "afterState": "待人工确认",
     "remark": "本次共识别 18 项风险，其中高风险 10 项、中风险 6 项、低风险 1 项、提示 1 项。规则库命中 8 项。",
     "createdAt": "2026-06-20T09:42:00.000Z"},

    # --- T2: RVT-DEMO-002 ---
    {"id": "AL-002-001", "reviewTaskId": "RVT-DEMO-002", "objectType": "task",
     "objectId": "RVT-DEMO-002", "action": "创建审核任务",
     "operatorId": "U-PURCHASER", "operatorName": "李明",
     "beforeState": None, "afterState": "草稿",
     "remark": "合同名称：办公设备批量采购合同\n相对方：华盛办公设备有限公司\n合同金额：320000 元",
     "createdAt": "2026-06-18T10:00:00.000Z"},
    {"id": "AL-002-002", "reviewTaskId": "RVT-DEMO-002", "objectType": "task",
     "objectId": "RVT-DEMO-002", "action": "开始AI审核",
     "operatorId": "U-PURCHASER", "operatorName": "李明",
     "beforeState": "草稿", "afterState": "解析中",
     "remark": "启动文档解析与AI审核流程",
     "createdAt": "2026-06-18T10:00:05.000Z"},
    {"id": "AL-002-003", "reviewTaskId": "RVT-DEMO-002", "objectType": "task",
     "objectId": "RVT-DEMO-002", "action": "AI审核完成",
     "operatorId": "system", "operatorName": "AI 系统（DeepSeek）",
     "beforeState": "AI审核中", "afterState": "待人工确认",
     "remark": "本次共识别 8 项风险，其中高风险 3 项、中风险 4 项、低风险 1 项。",
     "createdAt": "2026-06-18T11:00:00.000Z"},
    {"id": "AL-002-004", "reviewTaskId": "RVT-DEMO-002", "objectType": "task",
     "objectId": "RVT-DEMO-002", "action": "提交法务复核",
     "operatorId": "U-PURCHASER", "operatorName": "李明",
     "beforeState": "待人工确认", "afterState": "待法务复核",
     "remark": "风险处理汇总：共 8 项，已接受 3 项、已编辑 2 项、已忽略 2 项、转人工 1 项",
     "createdAt": "2026-06-18T14:00:00.000Z"},

    # --- T3: RVT-DEMO-003 ---
    {"id": "AL-003-001", "reviewTaskId": "RVT-DEMO-003", "objectType": "task",
     "objectId": "RVT-DEMO-003", "action": "创建审核任务",
     "operatorId": "U-PURCHASER", "operatorName": "李明",
     "beforeState": None, "afterState": "草稿",
     "remark": "合同名称：云服务采购合同\n相对方：云栈科技有限公司\n合同金额：860000 元",
     "createdAt": "2026-06-09T09:00:00.000Z"},
    {"id": "AL-003-002", "reviewTaskId": "RVT-DEMO-003", "objectType": "task",
     "objectId": "RVT-DEMO-003", "action": "开始AI审核",
     "operatorId": "U-PURCHASER", "operatorName": "李明",
     "beforeState": "草稿", "afterState": "解析中",
     "remark": "启动文档解析与AI审核流程",
     "createdAt": "2026-06-09T09:00:05.000Z"},
    {"id": "AL-003-003", "reviewTaskId": "RVT-DEMO-003", "objectType": "task",
     "objectId": "RVT-DEMO-003", "action": "AI审核完成",
     "operatorId": "system", "operatorName": "AI 系统（DeepSeek）",
     "beforeState": "AI审核中", "afterState": "待人工确认",
     "remark": "本次共识别 7 项风险，其中高风险 0 项、中风险 4 项、低风险 2 项、提示 1 项。",
     "createdAt": "2026-06-09T10:00:00.000Z"},
    {"id": "AL-003-004", "reviewTaskId": "RVT-DEMO-003", "objectType": "task",
     "objectId": "RVT-DEMO-003", "action": "提交法务复核",
     "operatorId": "U-PURCHASER", "operatorName": "李明",
     "beforeState": "待人工确认", "afterState": "待法务复核",
     "remark": "风险处理汇总：共 7 项，已确认 7 项",
     "createdAt": "2026-06-10T11:00:00.000Z"},
    {"id": "AL-003-005", "reviewTaskId": "RVT-DEMO-003", "objectType": "task",
     "objectId": "RVT-DEMO-003", "action": "法务审核通过",
     "operatorId": "U-LEGAL", "operatorName": "王律师",
     "beforeState": "待法务复核", "afterState": "已完成",
     "remark": "审核结论：建议修改后签署\n法务意见：已按建议修改付款节点与数据安全条款，风险可控。\n法务审核人：王律师（法务部）\n风险处理汇总：共 7 项，已确认 7 项",
     "createdAt": "2026-06-11T15:30:00.000Z"},

    # --- T4: RVT-DEMO-004 ---
    {"id": "AL-004-001", "reviewTaskId": "RVT-DEMO-004", "objectType": "task",
     "objectId": "RVT-DEMO-004", "action": "创建审核任务",
     "operatorId": "U-PURCHASER", "operatorName": "李明",
     "beforeState": None, "afterState": "草稿",
     "remark": "合同名称：生产设备采购合同\n相对方：精密机械有限公司\n合同金额：450000 元",
     "createdAt": "2026-06-22T16:00:00.000Z"},
    {"id": "AL-004-002", "reviewTaskId": "RVT-DEMO-004", "objectType": "task",
     "objectId": "RVT-DEMO-004", "action": "解析失败",
     "operatorId": "system", "operatorName": "系统",
     "beforeState": "解析中", "afterState": "失败",
     "remark": "文档解析失败：检测到加密PDF，无法提取文本内容。",
     "createdAt": "2026-06-22T16:05:00.000Z"},

    # --- T5: RVT-DEMO-005（仅创建） ---
    {"id": "AL-005-001", "reviewTaskId": "RVT-DEMO-005", "objectType": "task",
     "objectId": "RVT-DEMO-005", "action": "创建审核任务",
     "operatorId": "U-PURCHASER", "operatorName": "李明",
     "beforeState": None, "afterState": "草稿",
     "remark": "合同名称：IT运维服务外包合同\n相对方：运维技术服务部\n合同金额：150000 元",
     "createdAt": "2026-06-25T10:00:00.000Z"},
]

# ===== 抽取字段模板（T1/T2/T3 各一套）=====
DEMO_EXTRACTED_FIELDS = [
    {"fieldKey": "contractName", "fieldLabel": "合同名称", "fieldValue": "软件系统采购合同", "confidence": 0.98, "lowConfidence": False, "sourceText": "软件系统采购合同"},
    {"fieldKey": "buyer", "fieldLabel": "甲方", "fieldValue": "智远科技有限公司", "confidence": 0.97, "lowConfidence": False, "sourceText": "甲方（采购方）：智远科技有限公司"},
    {"fieldKey": "seller", "fieldLabel": "乙方", "fieldValue": "星河软件有限公司", "confidence": 0.88, "lowConfidence": False, "sourceText": "乙方（供应方）：星河软件有限公司"},
    {"fieldKey": "contractNo", "fieldLabel": "合同编号", "fieldValue": "RVT-2026-001", "confidence": 0.55, "lowConfidence": True, "sourceText": "（系统生成编号）"},
    {"fieldKey": "amount", "fieldLabel": "合同金额", "fieldValue": "580000", "confidence": 0.95, "lowConfidence": False, "sourceText": "合同总金额为人民币580000元"},
    {"fieldKey": "currency", "fieldLabel": "币种", "fieldValue": "CNY", "confidence": 0.99, "lowConfidence": False, "sourceText": "人民币"},
    {"fieldKey": "taxRate", "fieldLabel": "税率", "fieldValue": "13%", "confidence": 0.72, "lowConfidence": True, "sourceText": "上述金额已含增值税"},
    {"fieldKey": "signDate", "fieldLabel": "签约日期", "fieldValue": "2026-06-15", "confidence": 0.65, "lowConfidence": True, "sourceText": "（未在正文明确，依据创建时间推断）"},
    {"fieldKey": "effectiveDate", "fieldLabel": "生效日期", "fieldValue": "2026-06-15", "confidence": 0.9, "lowConfidence": False, "sourceText": "本合同自双方签字盖章之日起生效"},
    {"fieldKey": "term", "fieldLabel": "合同期限", "fieldValue": "2年", "confidence": 0.96, "lowConfidence": False, "sourceText": "有效期为2年"},
    {"fieldKey": "paymentMethod", "fieldLabel": "付款方式", "fieldValue": "签约后付80%，验收后付20%", "confidence": 0.94, "lowConfidence": False, "sourceText": "支付合同总额的80%作为预付款"},
    {"fieldKey": "deliveryDate", "fieldLabel": "交付时间", "fieldValue": "尽快", "confidence": 0.4, "lowConfidence": True, "sourceText": "尽快完成系统的交付与安装部署"},
    {"fieldKey": "acceptanceMethod", "fieldLabel": "验收方式", "fieldValue": "符合甲方要求并签署验收报告", "confidence": 0.6, "lowConfidence": True, "sourceText": "应符合甲方要求，经甲方确认后签署验收报告"},
    {"fieldKey": "warrantyPeriod", "fieldLabel": "质保期限", "fieldValue": "未约定", "confidence": 0.3, "lowConfidence": True, "sourceText": "具体质保期限及响应时限由双方另行约定"},
    {"fieldKey": "jurisdiction", "fieldLabel": "争议管辖", "fieldValue": "乙方所在地法院", "confidence": 0.93, "lowConfidence": False, "sourceText": "由乙方所在地有管辖权的人民法院管辖"},
]

# ===== 预设报告（1 个，关联 T3）=====
DEMO_REPORTS = [
    {
        "id": "RPT-DEMO-001",
        "reviewTaskId": "RVT-DEMO-003",
        "reportNo": "QSZK-RPT-2026-001",
        "versionNo": 1,
        "snapshot": None,  # 运行时由前端 services 基于 T3 风险生成快照
        "status": "generated",
        "errorMsg": None,
        "createdAt": "2026-06-11T15:30:00.000Z",
    },
]


# ============================================================
# 工具函数
# ============================================================

def camel_to_snake(name: str) -> str:
    """camelCase → snake_case"""
    s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def to_snake_row(data: dict) -> dict:
    """转换 dict 的所有 key 为 snake_case（与 data.py _to_db_row 一致）"""
    return {camel_to_snake(k): v for k, v in data.items()}


def calc_risk_positions(risks: list) -> list:
    """计算 startPosition/endPosition（与 db.ts calcRiskPositions 一致）

    用段落原文 indexOf 计算，定位不到则保持 0。
    """
    result = []
    for r in risks:
        para = DEMO_PARAGRAPHS_BY_ID.get(r["paragraphId"])
        if not para:
            result.append(r)
            continue
        text = para["text"]
        start = text.find(r["originalText"])
        if start < 0:
            result.append(r)
            continue
        r2 = dict(r)
        r2["startPosition"] = start
        r2["endPosition"] = start + len(r["originalText"])
        result.append(r2)
    return result


def build_risks_for_task(review_task_id: str, status_config, created_at: str) -> list:
    """为任务生成风险项（复刻 seedData.ts buildRisksForTask）"""
    risks = []
    for idx, tpl in enumerate(DEMO_RISK_TEMPLATES):
        snippet = RISK_SNIPPETS[tpl["snippetKey"]]
        status = status_config(idx, tpl)
        risk = {
            "id": f"RISK-{review_task_id}-{str(idx + 1).zfill(3)}",
            "reviewTaskId": review_task_id,
            "title": tpl["title"],
            "riskType": tpl["riskType"],
            "riskLevel": tpl["riskLevel"],
            "clauseNumber": tpl["clauseNumber"],
            "clauseTitle": tpl["clauseTitle"],
            "originalText": snippet["originalText"],
            "paragraphId": snippet["paragraphId"],
            "startPosition": 0,  # 运行时由 calc_risk_positions 计算
            "endPosition": 0,
            "riskReason": tpl["riskReason"],
            "reviewBasis": tpl["reviewBasis"],
            "suggestion": tpl["suggestion"],
            "editedSuggestion": None,
            "confidence": tpl["confidence"],
            "sourceType": tpl["sourceType"],
            "ruleId": tpl["ruleId"] if tpl["ruleId"] else None,
            "status": status,
            "handler": None if status == "pending" else "李明",
            "handleComment": None,
            "ignoreReason": None,
            "version": 1,
            "createdAt": created_at,
            "updatedAt": created_at,
        }
        risks.append(risk)
    return risks


def build_all_demo_risks() -> list:
    """生成所有预设风险（复刻 seedData.ts buildAllDemoRisks）

    T1：18 个，全部 pending
    T2：8 个，混合已处理（已提交法务）
    T3：7 个，全部 confirmed（已完成）
    """
    risks = []
    # T1：18 个，全部 pending（主演示任务）
    risks.extend(build_risks_for_task(
        "RVT-DEMO-001", lambda idx, tpl: "pending", "2026-06-20T09:40:00.000Z",
    ))
    # T2：8 个，混合已处理
    t2_statuses = ["accepted", "edited", "accepted", "ignored",
                   "accepted", "edited", "accepted", "manual_review"]

    def t2_config(idx, tpl):
        if idx >= 8:
            return "ignored"
        return t2_statuses[idx] if idx < len(t2_statuses) else "accepted"

    risks.extend(build_risks_for_task(
        "RVT-DEMO-002", t2_config, "2026-06-18T11:00:00.000Z",
    )[:8])
    # T3：7 个，全部 confirmed
    risks.extend(build_risks_for_task(
        "RVT-DEMO-003", lambda idx, tpl: "confirmed", "2026-06-09T11:00:00.000Z",
    )[:7])
    return risks


def build_rule_versions() -> list:
    """为每条规则生成初始版本记录 v1（复刻 db.ts initDB 中 rule_versions 逻辑）"""
    versions = []
    for rule in DEMO_RULES:
        versions.append({
            "id": f"RV-{rule['id']}",  # 稳定 ID，保证幂等
            "ruleId": rule["id"],
            "version": rule["version"],
            "snapshot": dict(rule),  # 完整规则快照
            "changeNote": "初始版本",
            "operatorName": "系统",
            "createdAt": rule["updatedAt"],
        })
    return versions


def build_all_fields() -> list:
    """生成所有抽取字段（T1/T2/T3 各一套）

    复刻 db.ts initDB：T1 未确认（confirmed=false），T2/T3 已确认。
    """
    fields = []
    for tid in ["RVT-DEMO-001", "RVT-DEMO-002", "RVT-DEMO-003"]:
        confirmed = tid != "RVT-DEMO-001"
        for f in DEMO_EXTRACTED_FIELDS:
            fields.append({
                "id": f"EF-{tid}-{f['fieldKey']}",
                "reviewTaskId": tid,
                "fieldKey": f["fieldKey"],
                "fieldLabel": f["fieldLabel"],
                "fieldValue": f["fieldValue"],
                "confidence": f["confidence"],
                "confirmedValue": f["fieldValue"] if confirmed else None,
                "lowConfidence": f["lowConfidence"],
                "sourceText": f["sourceText"],
                "confirmed": confirmed,
            })
    return fields


def _delete_all(sb, table: str, id_col: str = "id"):
    """删除表内所有数据（supabase-py 需要一个 filter）

    用 neq 匹配所有非空 id（业务表 id 均为非空文本）。
    """
    sb.table(table).delete().neq(id_col, "").execute()


# ============================================================
# seed 函数
# ============================================================

def seed_users(sb):
    """写入 3 个演示用户（auth_uid 留空，登录时自动补写）"""
    _delete_all(sb, "users")
    rows = []
    for u in DEMO_USERS:
        row = to_snake_row(u)
        row["auth_uid"] = None  # 显式置空，登录时由 auth 流程补写
        rows.append(row)
    sb.table("users").insert(rows).execute()
    print(f"  ✓ users: 写入 {len(rows)} 条")


def seed_rules(sb):
    """写入 16 条规则 + 每条规则的初始版本记录（v1）"""
    # 先删子表 rule_versions，再删 rules（FK 级联也会处理，这里显式删除保证干净）
    _delete_all(sb, "rule_versions", "id")
    _delete_all(sb, "rules")

    rule_rows = [to_snake_row(r) for r in DEMO_RULES]
    sb.table("rules").insert(rule_rows).execute()

    version_rows = [to_snake_row(v) for v in build_rule_versions()]
    sb.table("rule_versions").insert(version_rows).execute()
    print(f"  ✓ rules: 写入 {len(rule_rows)} 条 + rule_versions: 写入 {len(version_rows)} 条")


def seed_tasks(sb):
    """写入 5 个演示任务"""
    # review_tasks 的删除会级联删除 risks/fields/reports，但为了 seed_risks 等函数可独立运行，
    # 这里只删 review_tasks，子表由各自 seed 函数负责清理
    _delete_all(sb, "review_tasks")
    rows = [to_snake_row(t) for t in DEMO_TASKS]
    sb.table("review_tasks").insert(rows).execute()
    print(f"  ✓ review_tasks: 写入 {len(rows)} 条")


def seed_risks(sb):
    """写入所有风险（T1 18 个 pending、T2 8 个混合状态、T3 7 个 confirmed）"""
    _delete_all(sb, "risks")
    all_risks = calc_risk_positions(build_all_demo_risks())
    rows = [to_snake_row(r) for r in all_risks]
    if rows:
        sb.table("risks").insert(rows).execute()
    print(f"  ✓ risks: 写入 {len(rows)} 条")


def seed_fields(sb):
    """写入抽取字段（T1/T2/T3 各一套 DEMO_EXTRACTED_FIELDS）"""
    _delete_all(sb, "extracted_fields")
    all_fields = build_all_fields()
    rows = [to_snake_row(f) for f in all_fields]
    if rows:
        sb.table("extracted_fields").insert(rows).execute()
    print(f"  ✓ extracted_fields: 写入 {len(rows)} 条")


def seed_reports(sb):
    """写入 1 个演示报告（RPT-DEMO-001，关联 T3）

    snapshot 字段留 null，由前端运行时补全（与现有逻辑一致）。
    """
    _delete_all(sb, "reports")
    rows = [to_snake_row(r) for r in DEMO_REPORTS]
    if rows:
        sb.table("reports").insert(rows).execute()
    print(f"  ✓ reports: 写入 {len(rows)} 条")


def seed_audit_logs(sb):
    """写入演示审计日志（操作时间轴数据）"""
    _delete_all(sb, "audit_logs")
    rows = [to_snake_row(log) for log in DEMO_AUDIT_LOGS]
    if rows:
        sb.table("audit_logs").insert(rows).execute()
    print(f"  ✓ audit_logs: 写入 {len(rows)} 条")


def _check_permissions(sb):
    """检查 service_role 是否有表权限。

    若 schema.sql 未执行授权段（GRANT），service_role 会无任何权限，
    此处提前检测并打印修复指引，避免逐表报错。
    """
    GRANT_SQL = """-- 在 Supabase Dashboard → SQL Editor 中执行以下语句后重新运行 seed.py
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;"""
    try:
        sb.table("users").select("id").limit(1).execute()
        return True
    except Exception as e:
        msg = str(e)
        if "42501" in msg or "permission denied" in msg:
            print("\n" + "=" * 64)
            print("ERROR: service_role 缺少表权限（permission denied）")
            print("原因：schema.sql 的授权段未执行，或表创建后未授予 service_role 权限。")
            print("修复方法：在 Supabase Dashboard → SQL Editor 中执行以下 SQL：")
            print("-" * 64)
            print(GRANT_SQL)
            print("-" * 64)
            print("执行完成后，重新运行：python supabase/seed.py")
            print("=" * 64 + "\n")
            return False
        # 其他错误（如表不存在）也在此提示
        print(f"\nERROR: 数据库检查失败 - {msg[:200]}")
        print("请确认 schema.sql 已在 Supabase Dashboard 中执行。")
        return False


def seed_all():
    """调用以上所有函数，按依赖顺序写入种子数据"""
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        print("ERROR: SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY 未配置")
        print("请在 backend/.env 中设置后重试")
        sys.exit(1)

    print(f"连接 Supabase: {SUPABASE_URL}")
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    # 前置权限检查
    if not _check_permissions(sb):
        sys.exit(1)

    print("开始写入种子数据（幂等：先清空后插入）...")
    # 删除顺序：子表 → 父表（避免 FK 冲突，虽然 ON DELETE CASCADE 会处理，这里显式控制）
    # 插入顺序：父表 → 子表（保证 FK 引用存在）
    seed_users(sb)
    seed_rules(sb)
    seed_tasks(sb)
    seed_risks(sb)
    seed_fields(sb)
    seed_reports(sb)
    seed_audit_logs(sb)
    print("种子数据写入完成！")

    # 统计校验
    print("\n数据统计：")
    for table in ["users", "rules", "rule_versions", "review_tasks",
                  "risks", "extracted_fields", "reports", "audit_logs"]:
        resp = sb.table(table).select("id", count="exact").execute()
        print(f"  {table}: {resp.count} 条")


if __name__ == "__main__":
    seed_all()
