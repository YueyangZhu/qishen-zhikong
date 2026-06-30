-- ============================================================
-- 契审智控｜AI采购合同审核平台 - Supabase 表结构
-- 在 Supabase Dashboard → SQL Editor 中执行此文件
-- ============================================================

-- ===== 枚举类型 =====
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('purchaser', 'legal', 'admin');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE risk_level AS ENUM ('high', 'medium', 'low', 'notice');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE risk_status AS ENUM ('pending', 'accepted', 'edited', 'ignored', 'manual_review', 'confirmed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE review_status AS ENUM ('draft', 'parsing', 'ai_reviewing', 'pending_business', 'pending_legal', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE risk_category AS ENUM ('subject', 'amount', 'payment', 'delivery', 'acceptance', 'warranty', 'breach', 'termination', 'ip', 'confidentiality', 'data_security', 'dispute', 'term');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE risk_source AS ENUM ('rule', 'ai', 'manual');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE report_status AS ENUM ('generating', 'generated', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE legal_conclusion AS ENUM ('sign', 'sign_after_modify', 'defer', 'not_sign');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE rule_method AS ENUM ('field', 'keyword', 'ai');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE rule_status AS ENUM ('enabled', 'disabled', 'draft');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE my_role AS ENUM ('buyer', 'seller');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE audit_object_type AS ENUM ('task', 'risk', 'field', 'report', 'rule');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ===== 1. users（业务用户表，关联 auth.users）=====
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,                      -- 业务 ID（如 U-PURCHASER），与 auth.users.id 解耦
  auth_uid UUID REFERENCES auth.users(id) ON DELETE CASCADE,  -- 关联 Supabase Auth
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role user_role NOT NULL,
  department TEXT NOT NULL,
  position TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#1677ff',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===== 2. review_tasks（审核任务）=====
CREATE TABLE IF NOT EXISTS public.review_tasks (
  id TEXT PRIMARY KEY,
  contract_id TEXT,
  contract_name TEXT NOT NULL,
  contract_no TEXT NOT NULL,
  counterparty TEXT NOT NULL,
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CNY',
  contract_type TEXT NOT NULL,
  my_role my_role NOT NULL DEFAULT 'buyer',
  department TEXT NOT NULL,
  review_focus JSONB NOT NULL DEFAULT '[]',  -- 字符串数组
  review_note TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  file_size INTEGER NOT NULL DEFAULT 0,
  sample_id TEXT,
  creator_id TEXT NOT NULL,
  creator_name TEXT NOT NULL,
  status review_status NOT NULL DEFAULT 'draft',
  risk_level_max risk_level,
  risk_count JSONB NOT NULL DEFAULT '{"high":0,"medium":0,"low":0,"notice":0}',
  progress INTEGER NOT NULL DEFAULT 0,
  current_stage TEXT NOT NULL DEFAULT '',
  error_code TEXT,
  error_msg TEXT,
  fields_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  legal_opinion TEXT,
  legal_conclusion legal_conclusion,
  legal_reviewer_id TEXT,
  legal_reviewer_name TEXT,
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_review_tasks_creator ON public.review_tasks(creator_id);
CREATE INDEX IF NOT EXISTS idx_review_tasks_status ON public.review_tasks(status);

-- ===== 3. risks（风险项）=====
CREATE TABLE IF NOT EXISTS public.risks (
  id TEXT PRIMARY KEY,
  review_task_id TEXT NOT NULL REFERENCES public.review_tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  risk_type risk_category NOT NULL,
  risk_level risk_level NOT NULL,
  clause_number TEXT NOT NULL,
  clause_title TEXT NOT NULL,
  original_text TEXT NOT NULL,
  paragraph_id TEXT NOT NULL,
  start_position INTEGER NOT NULL DEFAULT 0,
  end_position INTEGER NOT NULL DEFAULT 0,
  risk_reason TEXT NOT NULL DEFAULT '',
  review_basis TEXT NOT NULL DEFAULT '',
  suggestion TEXT NOT NULL DEFAULT '',
  edited_suggestion TEXT,
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0,
  source_type risk_source NOT NULL DEFAULT 'ai',
  rule_id TEXT,
  status risk_status NOT NULL DEFAULT 'pending',
  handler TEXT,
  handle_comment TEXT,
  ignore_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_risks_task ON public.risks(review_task_id);
CREATE INDEX IF NOT EXISTS idx_risks_status ON public.risks(status);

-- ===== 4. extracted_fields（抽取字段）=====
CREATE TABLE IF NOT EXISTS public.extracted_fields (
  id TEXT PRIMARY KEY,
  review_task_id TEXT NOT NULL REFERENCES public.review_tasks(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  field_label TEXT NOT NULL,
  field_value TEXT NOT NULL DEFAULT '',
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0,
  confirmed_value TEXT,
  low_confidence BOOLEAN NOT NULL DEFAULT FALSE,
  source_text TEXT NOT NULL DEFAULT '',
  confirmed BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_fields_task ON public.extracted_fields(review_task_id);

-- ===== 5. parsed_documents（解析的合同文档，按 taskId 索引）=====
CREATE TABLE IF NOT EXISTS public.parsed_documents (
  review_task_id TEXT PRIMARY KEY REFERENCES public.review_tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sections JSONB NOT NULL DEFAULT '[]',
  paragraphs JSONB NOT NULL DEFAULT '[]',
  full_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===== 6. reports（审核报告）=====
CREATE TABLE IF NOT EXISTS public.reports (
  id TEXT PRIMARY KEY,
  review_task_id TEXT NOT NULL REFERENCES public.review_tasks(id) ON DELETE CASCADE,
  report_no TEXT NOT NULL UNIQUE,
  version_no INTEGER NOT NULL DEFAULT 1,
  snapshot JSONB,                          -- 不可变快照（含 fields/risks 副本）
  status report_status NOT NULL DEFAULT 'generating',
  error_msg TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reports_task ON public.reports(review_task_id);

-- ===== 7. rules（风险规则库）=====
CREATE TABLE IF NOT EXISTS public.rules (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contract_type TEXT NOT NULL,
  risk_type risk_category NOT NULL,
  risk_level risk_level NOT NULL,
  method rule_method NOT NULL,
  trigger_condition TEXT NOT NULL DEFAULT '',
  reason_template TEXT NOT NULL DEFAULT '',
  suggestion_template TEXT NOT NULL DEFAULT '',
  status rule_status NOT NULL DEFAULT 'enabled',
  version INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===== 8. rule_versions（规则历史版本）=====
CREATE TABLE IF NOT EXISTS public.rule_versions (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES public.rules(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,                  -- 完整规则快照
  change_note TEXT NOT NULL DEFAULT '',
  operator_name TEXT NOT NULL DEFAULT '系统',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rule_versions_rule ON public.rule_versions(rule_id);

-- ===== 9. audit_logs（审计日志）=====
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id TEXT PRIMARY KEY,
  review_task_id TEXT NOT NULL,
  object_type audit_object_type NOT NULL,
  object_id TEXT NOT NULL,
  action TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  before_state TEXT,
  after_state TEXT,
  remark TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_task ON public.audit_logs(review_task_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_logs(created_at);

-- ===== 触发器：自动更新 updated_at =====
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_review_tasks_updated ON public.review_tasks;
CREATE TRIGGER trg_review_tasks_updated
  BEFORE UPDATE ON public.review_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_risks_updated ON public.risks;
CREATE TRIGGER trg_risks_updated
  BEFORE UPDATE ON public.risks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_rules_updated ON public.rules;
CREATE TRIGGER trg_rules_updated
  BEFORE UPDATE ON public.rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- RLS 策略（演示阶段：登录用户可读写所有表）
-- 生产环境需收紧为按 creator_id / role 过滤
-- ============================================================

-- 启用 RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extracted_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parsed_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 通用策略：登录用户可读所有数据，可写所有数据（演示用）
-- 后端用 service_role key 会绕过 RLS
-- 幂等：先 DROP IF EXISTS 再 CREATE，避免重复执行报错
DROP POLICY IF EXISTS "authenticated_read_all" ON public.users;
DROP POLICY IF EXISTS "authenticated_write_all" ON public.users;
CREATE POLICY "authenticated_read_all" ON public.users
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_write_all" ON public.users
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_all_tasks" ON public.review_tasks;
CREATE POLICY "authenticated_all_tasks" ON public.review_tasks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_all_risks" ON public.risks;
CREATE POLICY "authenticated_all_risks" ON public.risks
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_all_fields" ON public.extracted_fields;
CREATE POLICY "authenticated_all_fields" ON public.extracted_fields
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_all_documents" ON public.parsed_documents;
CREATE POLICY "authenticated_all_documents" ON public.parsed_documents
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_all_reports" ON public.reports;
CREATE POLICY "authenticated_all_reports" ON public.reports
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_all_rules" ON public.rules;
CREATE POLICY "authenticated_all_rules" ON public.rules
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_all_rule_versions" ON public.rule_versions;
CREATE POLICY "authenticated_all_rule_versions" ON public.rule_versions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "authenticated_all_audit_logs" ON public.audit_logs;
CREATE POLICY "authenticated_all_audit_logs" ON public.audit_logs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 授权（service_role 用于后端绕过 RLS；anon/authenticated 用于前端直连）
-- 若执行 seed.py 报 "permission denied for table xxx"，请重新执行本段
-- ============================================================

-- service_role：后端服务角色，绕过 RLS，需要全部权限
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- authenticated：登录用户，受 RLS 策略保护
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- anon：未登录用户（用于公开接口），受 RLS 策略保护
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;

-- 默认权限：未来新建的表也自动授予（与 Supabase 默认行为一致）
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon;

-- ============================================================
-- 完成
-- ============================================================
