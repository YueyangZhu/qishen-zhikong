import importlib.util
from collections import Counter

spec = importlib.util.spec_from_file_location('seed', 'supabase/seed.py')
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)

risks = seed.build_all_demo_risks()
print(f'总风险数: {len(risks)}')

by_task = Counter(r['reviewTaskId'] for r in risks)
print('各任务风险数:')
for tid in sorted(by_task):
    print(f'  {tid}: {by_task[tid]}')

# 检查重复风险（同任务同 title）
dup = {}
for r in risks:
    key = (r['reviewTaskId'], r['title'])
    dup.setdefault(key, 0)
    dup[key] += 1
dups = [(k, v) for k, v in dup.items() if v > 1]
print(f'完全重复风险（同任务同 title）: {len(dups)} 组')
for k, v in dups[:20]:
    print(f'  {k[0]} - {k[1]}: {v} 次')

# 检查 sample-1 任务的风险定位
sample1_risks = [r for r in risks if r['reviewTaskId'] == 'RVT-DEMO-002']
para_by_id = {p['id']: p for p in seed.SAMPLE_CONTRACTS['sample-1']['paragraphs']}
located = 0
for r in sample1_risks:
    para = para_by_id.get(r['paragraphId'])
    if para and r['originalText'] in para['text']:
        located += 1
    else:
        print(f'  定位失败: {r["title"]} -> {r["paragraphId"]}')
print(f'sample-1 (RVT-DEMO-002) 风险可定位: {located}/{len(sample1_risks)}')

# 检查各 sample 任务的风险定位
for tid, sample_id in [(t['id'], t.get('sampleId')) for t in seed.DEMO_TASKS if t.get('sampleId')]:
    task_risks = [r for r in risks if r['reviewTaskId'] == tid]
    if not task_risks:
        continue
    paragraphs = seed.SAMPLE_CONTRACTS[sample_id]['paragraphs']
    para_by_id = {p['id']: p for p in paragraphs}
    located = 0
    for r in task_risks:
        para = para_by_id.get(r['paragraphId'])
        if para and r['originalText'] in para['text']:
            located += 1
    print(f'{tid} ({sample_id}) 风险可定位: {located}/{len(task_risks)}')
