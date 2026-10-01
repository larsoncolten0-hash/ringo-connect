-- PREFLIGHT for 2026-12-03_debtors_reminders.sql — READ-ONLY (only SELECTs). Safe to run in the Supabase SQL editor at any time.
-- Every row must say ok = true; any ok = false means STOP and report it before applying the migration.

with checks(label, expect, actual) as (
  -- 1. Phase 1 + Phase 2 are applied (this migration reads them and aborts without them)
  select 'Phase 2 tables exist (8)', '8', (select count(*)::text from pg_tables where schemaname = 'public' and tablename in
         ('bk_business_profiles','bk_documents','bk_document_lines','bk_document_counters','bk_document_payments','bk_document_events','bk_document_shares','bk_document_rate_events'))
  union all select 'bk_doc_gate(uuid,uuid) exists', 'true', (to_regprocedure('public.bk_doc_gate(uuid,uuid)') is not null)::text
  union all select 'bk_doc_seller_snapshot(uuid) exists', 'true', (to_regprocedure('public.bk_doc_seller_snapshot(uuid)') is not null)::text
  union all select 'bk_truncate_guard() exists', 'true', (to_regprocedure('public.bk_truncate_guard()') is not null)::text
  union all select 'doc_record_payment / doc_void_payment exist', '2', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('doc_record_payment','doc_void_payment'))
  union all select 'bk_entries exists (Phase 1)', 'true', (to_regclass('public.bk_entries') is not null)::text
  -- 2. things the new SQL reads
  union all select 'email_suppressions(email) exists', 'true', (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'email_suppressions' and column_name = 'email'))::text
  union all select 'profiles(id,user_id,is_demo,category,categories)', '5', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name in ('id','user_id','is_demo','category','categories'))
  union all select 'profiles.categories is text[]', 'true', (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'categories' and data_type = 'ARRAY'))::text
  union all select 'users(id,plan_id)', '2', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name in ('id','plan_id'))
  union all select 'plans.business_toolkit_enabled exists', 'true', (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'plans' and column_name = 'business_toolkit_enabled'))::text
  -- 3. nothing this migration creates exists yet
  union all select 'no Phase 3 table exists', '0', (select count(*)::text from pg_tables where schemaname = 'public' and tablename in ('bk_customers','bk_document_customer_links','bk_customer_events','bk_reminder_settings','bk_reminders'))
  union all select 'no Phase 3 function exists', '0', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (
         'bk_norm_phone','bk_norm_email','bk_rem_mask_email','bk_customer_event','bk_rem_problem','bk_rem_email_problem','bk_rem_today','bk_rem_day_start','bk_rem_email_count','bk_rem_context',
         'bk_customer_save','bk_customer_set_archived','bk_customer_set_auto_paused','doc_set_document_customer','doc_suggest_customers','doc_receivables_summary','doc_receivable_invoices',
         'doc_customer_statement','doc_check_share','doc_upsert_reminder_settings','doc_record_manual_reminder','doc_complete_reminder','doc_expire_stale_reminder_claims','doc_claim_due_reminders',
         'bk_customers_guard','bk_document_customer_links_guard','bk_customer_events_guard','bk_reminder_settings_guard','bk_reminders_guard'))
  union all select 'roles anon,authenticated,service_role', '3', (select count(*)::text from pg_roles where rolname in ('anon','authenticated','service_role'))
)
select label, expect, actual, (expect = actual) as ok from checks;
