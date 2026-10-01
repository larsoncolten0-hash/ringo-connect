-- PREFLIGHT for 2026-12-02_documents_invoices_receipts.sql — READ-ONLY (only SELECTs). Safe to run in the Supabase SQL editor at any
-- time. Every row must say ok = true; any ok = false means STOP and report it before applying the migration.

with checks(label, expect, actual) as (
  -- 1. Phase 1 (bookkeeping) is applied: this migration depends on it and aborts without it
  select 'bk_entries exists', 'true', (to_regclass('public.bk_entries') is not null)::text
  union all select 'bk_record_entry exists', 'true', (to_regprocedure('public.bk_record_entry(uuid,uuid,text,numeric,date,text,text,boolean,text,uuid,uuid,uuid)') is not null)::text
  union all select 'bk_void_entry exists', 'true', (to_regprocedure('public.bk_void_entry(uuid,uuid,uuid,text)') is not null)::text
  union all select 'bk_currency_digits exists', 'true', (to_regprocedure('public.bk_currency_digits(text)') is not null)::text
  union all select 'bk_truncate_guard exists', 'true', (to_regprocedure('public.bk_truncate_guard()') is not null)::text
  union all select 'plans.business_toolkit_enabled exists', 'true', (exists (select 1 from information_schema.columns where table_schema='public' and table_name='plans' and column_name='business_toolkit_enabled'))::text
  -- 2. nothing this migration creates exists yet (so "if not exists" cannot silently skip a different shape)
  union all select 'no Phase 2 table exists', '0', (select count(*)::text from pg_tables where schemaname='public' and tablename in ('bk_business_profiles','bk_documents','bk_document_lines','bk_document_counters','bk_document_payments','bk_document_events','bk_document_shares','bk_document_rate_events'))
  union all select 'no Phase 2 function exists', '0', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname in ('bk_doc_number','bk_doc_compute_line','bk_doc_blank_null','bk_doc_gate','bk_doc_event','bk_doc_clean_customer','bk_doc_seller_snapshot','bk_doc_hash_of','bk_doc_bundle','bk_doc_payment_bundle','bk_doc_issue_core','doc_upsert_business_profile','doc_save_draft','doc_issue','doc_record_payment','doc_void_payment','doc_void_document','doc_create_share','doc_revoke_share','doc_resolve_share','bk_doc_hash','bk_doc_rate_limit_hit','bk_business_profiles_guard','bk_documents_guard','bk_document_lines_guard','bk_document_counters_guard','bk_document_payments_guard','bk_document_events_guard','bk_document_shares_guard'))
  -- 3. existing tables the migration references, with the columns it uses
  union all select 'profiles(id,user_id,name,username,currency,is_demo)', '6', (select count(*)::text from information_schema.columns where table_schema='public' and table_name='profiles' and column_name in ('id','user_id','name','username','currency','is_demo'))
  union all select 'users(id,plan_id)', '2', (select count(*)::text from information_schema.columns where table_schema='public' and table_name='users' and column_name in ('id','plan_id'))
  union all select 'plans(id)', '1', (select count(*)::text from information_schema.columns where table_schema='public' and table_name='plans' and column_name='id')
  union all select 'products(id,profile_id)', '2', (select count(*)::text from information_schema.columns where table_schema='public' and table_name='products' and column_name in ('id','profile_id'))
  -- 4. uuid keys the new foreign keys point at
  union all select 'profiles.id / users.id / bk_entries.id are uuid', '3', (select count(*)::text from information_schema.columns where table_schema='public' and data_type='uuid' and ((table_name='profiles' and column_name='id') or (table_name='users' and column_name='id') or (table_name='bk_entries' and column_name='id')))
  -- 5. built-ins used by the content hash (PostgreSQL 11+; no extension needed)
  union all select 'sha256(bytea) available', 'true', (to_regprocedure('sha256(bytea)') is not null)::text
  -- 6. roles named by the GRANT/REVOKE statements
  union all select 'roles anon,authenticated,service_role', '3', (select count(*)::text from pg_roles where rolname in ('anon','authenticated','service_role'))
)
select label, expect, actual, (expect = actual) as ok from checks;

-- Informational: triggers that fire on deleting a profile or user (the new foreign keys are ON DELETE RESTRICT).
select event_object_table, trigger_name, event_manipulation from information_schema.triggers
 where event_object_schema='public' and event_object_table in ('profiles','users') and event_manipulation='DELETE';
