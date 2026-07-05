import os
from dotenv import load_dotenv
from supabase import create_client
from pathlib import Path

load_dotenv(Path(__file__).parent / "backend" / ".env")
url = os.getenv("SUPABASE_URL", "").strip()
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
sb = create_client(url, key)
resp = sb.table("review_tasks").select("id,contract_name,status,risk_count,risk_level_max").order("created_at", desc=True).execute()
for t in resp.data:
    print(t["id"], t["contract_name"], t["status"], t.get("risk_count"), t.get("risk_level_max"))
