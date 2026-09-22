-- Read-only verification for 2026-10-25_ringo_ai_foundation.sql.
-- Run after the migration. Every row should say ok = true.

with expected_tables(name) as (
  values ('ai_settings'), ('ai_beta_access'), ('ai_conversations'), ('ai_messages'), ('ai_usage_events'), ('ai_feedback')
),
tables as (
  select 'table ' || e.name as check_name,
         exists (select 1 from information_schema.tables t where t.table_schema = 'public' and t.table_name = e.name) as ok
  from expected_tables e
),
rls as (
  select 'rls enabled ' || e.name as check_name,
         coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = e.name), false) as ok
  from expected_tables e
),
no_write_policies as (
  -- Writes are server-only: no INSERT/UPDATE/ALL policy may exist on these tables.
  select 'no insert/update policies on ai_* tables' as check_name,
         not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename like 'ai\_%'
                     and p.cmd in ('INSERT', 'UPDATE', 'ALL')) as ok
),
settings_row as (
  select 'ai_settings singleton row present' as check_name,
         (select count(*) = 1 from public.ai_settings) as ok
),
fn as (
  select 'ai_quota_snapshot exists' as check_name,
         exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'ai_quota_snapshot') as ok
),
fn_not_public as (
  select 'ai_quota_snapshot not executable by anon/authenticated' as check_name,
         not has_function_privilege('anon', 'public.ai_quota_snapshot(uuid)', 'execute')
         and not has_function_privilege('authenticated', 'public.ai_quota_snapshot(uuid)', 'execute') as ok
)
select * from tables
union all select * from rls
union all select * from no_write_policies
union all select * from settings_row
union all select * from fn
union all select * from fn_not_public;

-- Informational (not a pass/fail): current settings.
select enabled, access_mode, provider, model_chat, effort, daily_message_limit,
       monthly_user_token_limit, monthly_global_budget_usd, max_tool_rounds, max_output_tokens, history_message_limit
from public.ai_settings;
