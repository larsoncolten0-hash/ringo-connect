-- VERIFY for 2026-12-12_whatsapp_inbox_mark_read.sql — READ-ONLY (a single SELECT). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true.

with
fn as (select p.oid, p.prosecdef, p.proconfig, p.prosrc, pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as res
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'inbox_mark_conversation_read'),
checks(label, expect, actual) as (
  select '01 the function exists exactly once', '1', (select count(*)::text from fn)
  union all select '02 signature', 'p_actor_user_id uuid, p_conversation_id uuid -> text', (select coalesce(max(args || ' -> ' || res), '') from fn)
  union all select '03 SECURITY DEFINER with a pinned search_path', '1', (select count(*)::text from fn where prosecdef and proconfig::text like '%search_path=public, pg_temp%')
  union all select '04 service_role can execute it', '1', (select count(*)::text from fn where has_function_privilege('service_role', oid, 'execute'))
  union all select '05 anon, authenticated and public cannot execute it', '0', (select count(*)::text from fn where has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('public', oid, 'execute'))
  union all select '06 ownership comes from the actor and only unread_count is written', 'true',
         (select coalesce(bool_and(prosrc like '%p.user_id = p_actor_user_id%' and prosrc like '%not_found%' and prosrc like '%set unread_count = 0%' and prosrc not like '%set status%' and prosrc not like '%last_%'), false)::text from fn)
  union all select '07 it writes only inbox_conversations', '0', (select count(*)::text from fn where prosrc ~* '(insert into|delete from)' or prosrc ~* 'update[[:space:]]+((public[.])(?!inbox_conversations)|(?!public[.])(?!inbox_conversations))')
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
