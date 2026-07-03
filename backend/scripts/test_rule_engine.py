"""测试规则引擎关键词匹配"""
import sys, os, re
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.chdir(os.path.join(os.path.dirname(__file__), ".."))

from app.services.rule_service import _extract_keywords, rule_service
from app.schemas.review import ContractParagraph

# 1. 检查 _extract_keywords 的关键词
rules = rule_service.get_enabled_rules()
print(f"= 已加载 {len(rules)} 条启用规则 =\n")

for r in rules:
    kw = _extract_keywords(r.triggerCondition, r.name)
    print(f"  {r.code:>12} ({r.name[:20]:20s}): {kw}")

print("\n" + "=" * 70)

# 2. 读取测试合同 TXT
txt_path = "test-contract.txt"
with open(txt_path, "r", encoding="utf-8") as f:
    text = f.read()

raw_paras = [p.strip() for p in re.split(r"\n\s*\n|\n", text) if p.strip()]
paragraphs = []
for i, raw in enumerate(raw_paras, 1):
    if raw:
        paragraphs.append(ContractParagraph(id=f"p{i}", index=i, text=raw, clauseNo="", clauseTitle=""))

print(f"测试合同段落数: {len(paragraphs)}\n")

hits = rule_service.keyword_match(paragraphs, "采购合同")
print(f"keyword_match 命中: {len(hits)} 项\n")
for h in hits:
    print(f"  {h['ruleId']:>10} | {h['title']:<24s} | {h['originalText'][:60]}...")

# 3. 检查未命中的规则
hit_ids = {h["ruleId"] for h in hits}
print("\n--- 未命中规则分析 ---")
for r in rules:
    if r.id not in hit_ids:
        kws = _extract_keywords(r.triggerCondition, r.name)
        found_any = False
        for kw in kws:
            for p in paragraphs:
                if kw in p.text:
                    found_any = True
                    break
            if found_any:
                break
        status = "可匹配" if found_any else "不可匹配"
        print(f"  [{status}] {r.code} {r.name}")
