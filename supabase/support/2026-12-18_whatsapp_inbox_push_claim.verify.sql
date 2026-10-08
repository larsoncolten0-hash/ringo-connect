-- VERIFY for 2026-12-18_whatsapp_inbox_push_claim.sql — READ-ONLY (a single SELECT). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true.

with
fn as (select p.oid, p.prosecdef, p.proconfig, p.prosrc, pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as res
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'inbox_push_claim'),
checks(label, expect, actual) as (
  select '01 the function exists exactly once', '1', (select count(*)::text from fn)
  union all select '02 signature', 'p_phone_number_id text, p_provider_message_id text -> jsonb', (select coalesce(max(args || ' -> ' || res), '') from fn)
  union all select '03 SECURITY DEFINER with a pinned search_path', '1', (select count(*)::text from fn where prosecdef and proconfig::text like '%search_path=public, pg_temp%')
  union all select '04 service_role can execute it', '1', (select count(*)::text from fn where has_function_privilege('service_role', oid, 'execute'))
  union all select '05 anon, authenticated and public cannot execute it', '0', (select count(*)::text from fn where has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('public', oid, 'execute'))
  union all select '06 the throttle table exists with row level security on', '1', (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'inbox_push_throttle' and c.relrowsecurity)
  union all select '07 no role other than the owner can read or write the throttle table', '0', (select count(*)::text from (values ('anon'), ('authenticated'), ('service_role')) r(role) where has_table_privilege(r.role, 'public.inbox_push_throttle', 'select,insert,update,delete'))
  union all select '08 the 60 second claim is one atomic upsert and no message text is read', 'true',
         (select coalesce(bool_and(prosrc like '%on conflict (conversation_id) do update%' and prosrc like '%interval ''60 seconds''%' and prosrc not like '%body%' and prosrc not like '%display_name%'), false)::text from fn)
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
