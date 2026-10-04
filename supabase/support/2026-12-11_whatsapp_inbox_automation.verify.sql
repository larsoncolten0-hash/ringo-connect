-- VERIFY for 2026-12-11_whatsapp_inbox_automation.sql — READ-ONLY (a single SELECT). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true. (No semicolon appears inside any label: the Supabase SQL editor can split a script on semicolons.)

with
f9(f) as (values ('inbox_hours_valid'), ('inbox_within_hours'), ('inbox_settings_guard'), ('inbox_conversation_state_guard'), ('inbox_settings_save'),
                 ('inbox_automation_inbound'), ('inbox_automation_record_ack'), ('inbox_automation_failed'), ('inbox_claim_follow_ups')),
t2(t) as (values ('inbox_settings'), ('inbox_conversation_state')),
fn as (select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc, pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as res
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (select f from f9)),
checks(label, expect, actual) as (
  select '01 the nine functions exist exactly once each (9|9)', '9|9', ((select count(*)::text from fn) || '|' || (select count(distinct proname)::text from fn))
  union all select '02 the two tables exist with row level security on', '2|2',
         ((select count(*)::text from pg_tables where schemaname = 'public' and tablename in (select t from t2)) || '|' ||
          (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in (select t from t2) and c.relrowsecurity))
  union all select '03 the owner read policies exist (one per table)', '2', (select count(*)::text from pg_policies where schemaname = 'public' and tablename in (select t from t2) and cmd = 'SELECT' and roles = '{authenticated}')
  union all select '03b no other policy exists on the two tables', '2', (select count(*)::text from pg_policies where schemaname = 'public' and tablename in (select t from t2))
  union all select '04 clients never write: no INSERT, UPDATE, DELETE or TRUNCATE for anon, authenticated or service_role on the two tables', '0',
         (select count(*)::text from pg_tables t cross join (values ('anon'), ('authenticated'), ('service_role')) ro(role) cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
           where t.schemaname = 'public' and t.tablename in (select t2.t from t2) and has_table_privilege(ro.role::name, ('public.' || t.tablename)::regclass, p.priv))
  union all select '04b anon has no access at all to the two tables', '0',
         (select count(*)::text from pg_tables t where t.schemaname = 'public' and t.tablename in (select t2.t from t2) and has_table_privilege('anon', ('public.' || t.tablename)::regclass, 'SELECT'))
  union all select '05 the five callable write functions are SECURITY DEFINER with a pinned search_path', '5',
         (select count(*)::text from fn where proname in ('inbox_settings_save', 'inbox_automation_inbound', 'inbox_automation_record_ack', 'inbox_automation_failed', 'inbox_claim_follow_ups') and prosecdef and proconfig::text like '%search_path=public, pg_temp%')
  union all select '06 service_role can execute the seven callable functions (five write functions and the two pure helpers)', '7',
         (select count(*)::text from fn where proname not like '%\_guard' and has_function_privilege('service_role', oid, 'execute'))
  union all select '06b nothing is executable by anon or authenticated (guards included)', '0',
         (select count(*)::text from fn where has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute'))
  union all select '07 no function takes a recipient, WABA, token or URL parameter', '0',
         (select count(*)::text from fn where args ~* '(recipient|waba|token|url|p_to )')
  union all select '08 settings_save derives ownership from the actor and requires a WhatsApp account', 'true',
         (select coalesce(bool_and(prosrc like '%p.user_id = p_actor_user_id%' and prosrc like '%wa_accounts%' and prosrc like '%pg_timezone_names%' and prosrc like '%inbox_hours_valid%'), false)::text from fn where proname = 'inbox_settings_save')
  union all select '08b inbound automation: atomic 12-hour acknowledgement claim, off unless configured, inbound messages only', 'true',
         (select coalesce(bool_and(prosrc like '%interval ''12 hours''%' and prosrc like '%last_auto_ack_at%' and prosrc like '%m.direction = ''inbound''%' and prosrc like '%auto_ack_mode <> ''off''%'), false)::text from fn where proname = 'inbox_automation_inbound')
  union all select '08c follow-up claim: one reminder per unanswered message, skip locked, automatic replies never count as a human reply', 'true',
         (select coalesce(bool_and(prosrc like '%follow_up_notified_for is distinct from%' and prosrc like '%skip locked%' and prosrc like '%auto_ack_message_ids%' and prosrc like '%interval ''7 days''%'), false)::text from fn where proname = 'inbox_claim_follow_ups')
  union all select '09 the functions write only the two new tables', '0',
         (select count(*)::text from fn where prosrc ~* '(insert into|update|delete from)[[:space:]]+((public[.])(?!inbox_settings|inbox_conversation_state)|(?!public[.])(?!inbox_settings|inbox_conversation_state)(?!set[[:space:]]|of[[:space:]]))[a-z_]+')
  union all select '10 the Phase 4 tables are unchanged: still 6 with no write grant for any role', '6|0',
         ((select count(*)::text from pg_tables where schemaname = 'public' and tablename in ('wa_accounts', 'inbox_contacts', 'inbox_conversations', 'inbox_messages', 'inbox_message_media', 'inbox_status_events')) || '|' ||
          (select count(*)::text from pg_tables t cross join (values ('anon'), ('authenticated'), ('service_role')) ro(role) cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
            where t.schemaname = 'public' and t.tablename in ('wa_accounts', 'inbox_contacts', 'inbox_conversations', 'inbox_messages', 'inbox_message_media', 'inbox_status_events') and has_table_privilege(ro.role::name, ('public.' || t.tablename)::regclass, p.priv)))
  union all select '11 the pure helpers behave (hours validation and the open/closed decision)', 'true|true|false|false',
         (public.inbox_hours_valid('{"mon":[["09:00","18:00"]]}'::jsonb)::text || '|' ||
          public.inbox_within_hours('{"mon":[["09:00","18:00"]]}'::jsonb, 'Africa/Douala', timestamptz '2026-10-05 10:00:00+00')::text || '|' ||
          public.inbox_within_hours('{"mon":[["09:00","18:00"]]}'::jsonb, 'Africa/Douala', timestamptz '2026-10-05 20:00:00+00')::text || '|' ||
          public.inbox_hours_valid('{"mon":[["18:00","09:00"]]}'::jsonb)::text)
  union all select '12 the inbox/wa table count is now 9 (6 Phase 4 + saved replies + the two new tables)', '9',
         (select count(*)::text from pg_tables where schemaname = 'public' and (tablename like 'inbox\_%' or tablename = 'wa_accounts'))
  union all select '13 the inbox/wa function count is now 27 (Phase 4: 9, 7: 3, 8: 4, 9: 2, 10: 9)', '27',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'inbox\_%' or p.proname like 'wa\_%'))
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
