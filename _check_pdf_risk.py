import os
from dotenv import load_dotenv
from supabase import create_client
from pathlib import Path

load_dotenv(Path(__file__).parent / "backend" / ".env")
url = os.getenv("SUPABASE_URL", "").strip()
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
sb = create_client(url, key)

# 找 HT-CG-2026-006 的任务
task = sb.table("review_tasks").select("id,contract_name,contract_no,sample_id").eq("contract_no", "HT-CG-2026-006").single().execute()
print("任务:", task.data)

# 找风险
risks = sb.table("risks").select("id,title,original_text,paragraph_id,risk_level,start_position,end_position").eq("review_task_id", task.data["id"]).execute()
for r in risks.data:
    print(f"  {r['id']} | {r['risk_level']} | para={r['paragraph_id']} | start={r['start_position']} end={r['end_position']}")
    print(f"    原文: {repr(r['original_text'])}")

# 找段落
doc = sb.table("parsed_documents").select("paragraphs").eq("review_task_id", task.data["id"]).single().execute()
print("\n段落:")
paras = doc.data["paragraphs"]
print(type(paras), len(paras))
for p in paras:
    if isinstance(p, dict):
        print(f"  {p['id']} | idx={p.get('index')} | type={p.get('type')} | text={repr(p['text'][:120])}")
    else:
        print(f"  {repr(p)}")
