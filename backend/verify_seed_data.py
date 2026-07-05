# -*- coding: utf-8 -*-
"""验证 seed.py 风险原文定位准确性"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'supabase'))
import seed

errors = []

# 1. 验证 RISK_SNIPPETS 在 DEMO_PARAGRAPHS 中可定位
for k, v in seed.RISK_SNIPPETS.items():
    para = seed.DEMO_PARAGRAPHS_BY_ID.get(v["paragraphId"])
    if not para:
        errors.append(f"Snippet {k}: paragraphId {v['paragraphId']} 不存在")
        continue
    if v["originalText"] not in para["text"]:
        errors.append(f"Snippet {k}: originalText 在 {v['paragraphId']} 中未找到")

# 2. 验证样例合同 riskTemplates 的 originalText 可定位
for sid, s in seed.SAMPLE_CONTRACTS.items():
    paras = {p["id"]: p for p in s["paragraphs"]}
    for i, r in enumerate(s["riskTemplates"]):
        para = paras.get(r["paragraphId"])
        if not para:
            errors.append(f"Sample {sid} risk {i}: paragraphId {r['paragraphId']} 不存在")
            continue
        if r["originalText"] not in para["text"]:
            errors.append(f"Sample {sid} risk {i}: originalText 在 {r['paragraphId']} 中未找到")

# 3. 验证所有任务的 riskCount 与实际 risks 数量一致
all_risks = seed.build_all_demo_risks()
for t in seed.DEMO_TASKS:
    tid = t["id"]
    task_risks = [r for r in all_risks if r["reviewTaskId"] == tid]
    if task_risks:
        actual = {"high": 0, "medium": 0, "low": 0, "notice": 0}
        for r in task_risks:
            actual[r["riskLevel"]] += 1
        if actual != t["riskCount"]:
            errors.append(f"Task {tid}: riskCount 不一致，任务={t['riskCount']}，实际={actual}")

# 4. 验证报告关联的任务确实是 completed 状态
completed_tasks = {t["id"] for t in seed.DEMO_TASKS if t["status"] == "completed"}
for rpt in seed.DEMO_REPORTS:
    if rpt["reviewTaskId"] not in completed_tasks:
        errors.append(f"Report {rpt['id']}: 关联任务 {rpt['reviewTaskId']} 不是 completed 状态")

print(f"验证完成，共 {len(errors)} 个错误")
for e in errors[:20]:
    print(f"  ✗ {e}")
if not errors:
    print("  ✓ 所有风险原文定位准确")
    print("  ✓ 所有任务 riskCount 与实际一致")
    print("  ✓ 所有报告关联已完成任务")
