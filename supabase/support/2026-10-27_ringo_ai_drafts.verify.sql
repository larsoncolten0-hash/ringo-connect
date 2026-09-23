-- Read-only verification for 2026-10-27_ringo_ai_drafts.sql.
-- Run after the migration. Every row should say ok = true.

select 'table ai_drafts' as check_name,
       exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'ai_drafts') as ok
union all
select 'table ai_draft_events',
       exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'ai_draft_events')
union all
select 'rls enabled ai_drafts',
       coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relname = 'ai_drafts'), false)
union all
select 'rls enabled ai_draft_events',
       coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relname = 'ai_draft_events'), false)
union all
select 'no insert/update/delete policies on draft tables',
       not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename in ('ai_drafts', 'ai_draft_events')
                   and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL'))
union all
select 'terminal-state guard trigger present',
       exists (select 1 from pg_trigger where tgname = 'trg_ai_drafts_guard_terminal' and not tgisinternal)
union all
select 'ai_claim_draft exists',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'ai_claim_draft')
union all
select 'ai_claim_draft not executable by anon/authenticated',
       not has_function_privilege('anon', 'public.ai_claim_draft(uuid, uuid, uuid, int, int)', 'execute')
       and not has_function_privilege('authenticated', 'public.ai_claim_draft(uuid, uuid, uuid, int, int)', 'execute')
union all
select 'ai_claim_draft executable by service_role',
       has_function_privilege('service_role', 'public.ai_claim_draft(uuid, uuid, uuid, int, int)', 'execute')
union all
select 'ai_create_product_within_limit is SECURITY INVOKER (RLS applies)',
       coalesce((select not p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'ai_create_product_within_limit'), false)
union all
select 'ai_apply_profile_update is SECURITY INVOKER (RLS applies)',
       coalesce((select not p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'ai_apply_profile_update'), false)
union all
select 'apply writes callable by authenticated, not anon',
       has_function_privilege('authenticated', 'public.ai_create_product_within_limit(uuid, uuid, text, text, numeric)', 'execute')
       and has_function_privilege('authenticated', 'public.ai_apply_profile_update(uuid, jsonb, jsonb)', 'execute')
       and not has_function_privilege('anon', 'public.ai_create_product_within_limit(uuid, uuid, text, text, numeric)', 'execute')
       and not has_function_privilege('anon', 'public.ai_apply_profile_update(uuid, jsonb, jsonb)', 'execute')
union all
select 'foundation tables still present (dependency)',
       exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'ai_conversations');
