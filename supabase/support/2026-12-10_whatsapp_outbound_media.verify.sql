-- VERIFY for 2026-12-10_whatsapp_outbound_media.sql — READ-ONLY (a single SELECT). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true. (No semicolon appears inside any label: the Supabase SQL editor can split a script on semicolons.)
-- Run it right after applying THIS migration (checks 07 and 10 count objects as they stand before the later Phase 10 migration adds its own).

with
f2(f) as (values ('inbox_prepare_outbound_media'), ('inbox_complete_outbound_media')),
t6(t) as (values ('wa_accounts'), ('inbox_contacts'), ('inbox_conversations'), ('inbox_messages'), ('inbox_message_media'), ('inbox_status_events')),
fn as (select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc, pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as res
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (select f from f2)),
checks(label, expect, actual) as (
  select '01 the two functions exist exactly once each (2|2)', '2|2', ((select count(*)::text from fn) || '|' || (select count(distinct proname)::text from fn))
  union all select '02 prepare signature', 'p_actor_user_id uuid, p_conversation_id uuid, p_client_request_id uuid, p_kind text, p_caption text -> jsonb',
         (select coalesce(max(args || ' -> ' || res), '') from fn where proname = 'inbox_prepare_outbound_media')
  union all select '02b complete signature', 'p_actor_user_id uuid, p_message_id uuid, p_provider_message_id text, p_media_id text, p_mime_type text, p_filename text, p_sha256 text -> text',
         (select coalesce(max(args || ' -> ' || res), '') from fn where proname = 'inbox_complete_outbound_media')
  union all select '03 both are SECURITY DEFINER with a pinned search_path', '2', (select count(*)::text from fn where prosecdef and proconfig::text like '%search_path=public, pg_temp%')
  union all select '04 service_role CAN execute both', '2', (select count(*)::text from fn where has_function_privilege('service_role', oid, 'execute'))
  union all select '04b NO function is executable by anon, authenticated or public', '0', (select count(*)::text from fn where has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute'))
  union all select '05 no function takes a recipient, phone number, WABA, token, URL or profile parameter', '0', (select count(*)::text from fn where args ~* '(recipient|phone|waba|token|url|profile|p_to )')
  union all select '06 Phase 4 tables unchanged: still 6, and no client or service role write grant on any', '6|0',
         ((select count(*)::text from pg_tables where schemaname = 'public' and tablename in (select t from t6)) || '|' ||
          (select count(*)::text from pg_tables t cross join (values ('anon'), ('authenticated'), ('service_role')) ro(role) cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
            where t.schemaname = 'public' and t.tablename in (select t6.t from t6) and has_table_privilege(ro.role::name, ('public.' || t.tablename)::regclass, p.priv)))
  union all select '07 no new table: the inbox/wa table count is unchanged (6 Phase 4 + saved replies = 7)', '7',
         (select count(*)::text from pg_tables where schemaname = 'public' and (tablename like 'inbox\_%' or tablename = 'wa_accounts'))
  union all select '08 behaviour markers in prepare: ownership from the actor, idempotent insert, 24-hour window, audio has no caption, conflict on a changed request', 'true',
         (select coalesce(bool_and(prosrc like '%p.user_id = p_actor_user_id%' and prosrc like '%on conflict (profile_id, client_request_id) where client_request_id is not null do nothing%'
                  and prosrc like '%interval ''24 hours''%' and prosrc like '%p_kind = ''audio''%' and prosrc like '%''conflict''%' and prosrc like '%''image'', ''video'', ''audio'', ''document''%'), false)::text from fn where proname = 'inbox_prepare_outbound_media')
  union all select '08b behaviour markers in complete: ownership from the actor, delegates to the audited Phase 7 function, one media row per message', 'true',
         (select coalesce(bool_and(prosrc like '%p.user_id = p_actor_user_id%' and prosrc like '%public.inbox_complete_outbound(%' and prosrc like '%on conflict (message_id) do nothing%' and prosrc like '%not_downloaded%'), false)::text from fn where proname = 'inbox_complete_outbound_media')
  union all select '09 the functions write only inbox_* tables', '0',
         (select count(*)::text from fn where prosrc ~* '(insert into|update|delete from)[[:space:]]+((public[.])(?!inbox_)|(?!public[.])(?!inbox_))[a-z_]+')
  union all select '10 the inbox/wa function set is exactly Phase 4 (9) + Phase 7 (3) + Phase 8 (4) + Phase 9 (2) = 18', '18',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'inbox\_%' or p.proname like 'wa\_%'))
  union all select '10b the Phase 7 functions this migration relies on are still callable by service_role only', '3|0',
         ((select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('inbox_prepare_outbound_text', 'inbox_complete_outbound', 'inbox_fail_outbound') and has_function_privilege('service_role', p.oid, 'execute')) || '|' ||
          (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('inbox_prepare_outbound_text', 'inbox_complete_outbound', 'inbox_fail_outbound') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))))
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
