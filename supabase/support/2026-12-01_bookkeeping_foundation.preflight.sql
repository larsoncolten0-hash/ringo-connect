-- PREFLIGHT for 2026-12-01_bookkeeping_foundation.sql — READ-ONLY (only SELECTs). Safe to run in the
-- Supabase SQL editor at any time. Expected result of every check is in the `expect` column; any row where
-- ok = false means STOP and report it before applying the migration.

with checks(label, expect, actual) as (
  -- 1. nothing this migration creates exists yet (so "if not exists" cannot silently skip a different shape)
  select 'bk_entries absent',            'true', (to_regclass('public.bk_entries') is null)::text
  union all select 'bk_entry_events absent', 'true', (to_regclass('public.bk_entry_events') is null)::text
  union all select 'bk_record_entry absent', 'true', (not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname in ('bk_record_entry','bk_void_entry','bk_currency_digits','bk_entries_guard','bk_entry_events_guard')))::text
  union all select 'plans.business_toolkit_enabled absent', 'true', (not exists (select 1 from information_schema.columns where table_schema='public' and table_name='plans' and column_name='business_toolkit_enabled'))::text
  -- 2. tables this migration references exist with the columns it uses
  union all select 'profiles(id,user_id,currency,is_demo)', '4', (select count(*)::text from information_schema.columns where table_schema='public' and table_name='profiles' and column_name in ('id','user_id','currency','is_demo'))
  union all select 'users(id,plan_id)', '2', (select count(*)::text from information_schema.columns where table_schema='public' and table_name='users' and column_name in ('id','plan_id'))
  union all select 'plans(id,name)', '2', (select count(*)::text from information_schema.columns where table_schema='public' and table_name='plans' and column_name in ('id','name'))
  union all select 'product_orders(id,profile_id)', '2', (select count(*)::text from information_schema.columns where table_schema='public' and table_name='product_orders' and column_name in ('id','profile_id'))
  union all select 'orders(id,profile_id)', '2', (select count(*)::text from information_schema.columns where table_schema='public' and table_name='orders' and column_name in ('id','profile_id'))
  union all select 'music_orders(id,profile_id)', '2', (select count(*)::text from information_schema.columns where table_schema='public' and table_name='music_orders' and column_name in ('id','profile_id'))
  -- 3. the roles the GRANT/REVOKE statements name exist
  union all select 'roles anon,authenticated,service_role', '3', (select count(*)::text from pg_roles where rolname in ('anon','authenticated','service_role'))
  -- 4. types the new tables foreign-key to match (uuid primary keys)
  union all select 'profiles.id / users.id are uuid', '2', (select count(*)::text from information_schema.columns where table_schema='public' and ((table_name='profiles' and column_name='id') or (table_name='users' and column_name='id')) and data_type='uuid')
)
select label, expect, actual, (expect = actual) as ok from checks;

-- Informational: current plan flags (the migration seeds business_toolkit_enabled = true for exactly the
-- names business_basic and business_pro; confirm these names exist and are the plans you intend).
select name, display_name, team_enabled, ai_enabled, commerce_enabled from plans order by price_xaf;

-- Informational: triggers that fire on deleting a profile or user (the new FKs are ON DELETE RESTRICT).
select event_object_table, trigger_name, event_manipulation from information_schema.triggers
 where event_object_schema='public' and event_object_table in ('profiles','users') and event_manipulation='DELETE';
