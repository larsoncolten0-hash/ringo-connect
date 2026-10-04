-- VERIFY for 2026-12-08_whatsapp_outbound_replies.sql — READ-ONLY (a single SELECT). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true.

with
f3(f) as (values ('inbox_prepare_outbound_text'), ('inbox_complete_outbound'), ('inbox_fail_outbound')),
t6(t) as (values ('wa_accounts'), ('inbox_contacts'), ('inbox_conversations'), ('inbox_messages'), ('inbox_message_media'), ('inbox_status_events')),
fn as (select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc, pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as res
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (select f from f3)),
checks(label, expect, actual) as (
  select '01 the three functions exist exactly once each (3|3)', '3|3', ((select count(*)::text from fn) || '|' || (select count(distinct proname)::text from fn))
  union all select '02 prepare signature', 'p_actor_user_id uuid, p_conversation_id uuid, p_client_request_id uuid, p_body text -> jsonb',
         (select coalesce(max(args || ' -> ' || res), '') from fn where proname = 'inbox_prepare_outbound_text')
  union all select '02b complete signature', 'p_actor_user_id uuid, p_message_id uuid, p_provider_message_id text -> text',
         (select coalesce(max(args || ' -> ' || res), '') from fn where proname = 'inbox_complete_outbound')
  union all select '02c fail signature', 'p_actor_user_id uuid, p_message_id uuid, p_error_codes integer[] -> text',
         (select coalesce(max(args || ' -> ' || res), '') from fn where proname = 'inbox_fail_outbound')
  union all select '03 all three are SECURITY DEFINER and pin search_path', '3', (select count(*)::text from fn where prosecdef and proconfig::text like '%search_path=public, pg_temp%')
  union all select '04 service_role CAN execute all three', '3', (select count(*)::text from fn where has_function_privilege('service_role', oid, 'execute'))
  union all select '04b NO function is executable by anon, authenticated or public', '0', (select count(*)::text from fn where has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute'))
  union all select '05 no function takes a recipient, phone number, WABA or profile parameter', '0', (select count(*)::text from fn where args ~* '(recipient|phone|waba|profile|p_to )')
  union all select '06 Phase 4 tables unchanged: still 6, and no client or service role write grant on any', '6|0',
         ((select count(*)::text from pg_tables where schemaname = 'public' and tablename in (select t from t6)) || '|' ||
          (select count(*)::text from pg_tables t cross join (values ('anon'), ('authenticated'), ('service_role')) ro(role) cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
            where t.schemaname = 'public' and t.tablename in (select t6.t from t6)
              and has_table_privilege(ro.role::name, ('public.' || t.tablename)::regclass, p.priv)))
  union all select '07 the outbound idempotency index is still in place', 'true',
         (exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'inbox_messages_request_idx' and indexdef like 'CREATE UNIQUE INDEX%(profile_id, client_request_id)%WHERE (client_request_id IS NOT NULL)%'))::text
  union all select '08 the functions write only inbox_* tables (no bookkeeping, plans, profiles or auth writes)', '0',
         (select count(*)::text from fn where prosrc ~* '(insert into|update|delete from)[[:space:]]+((public[.])(?!inbox_)|(?!public[.])(?!inbox_))[a-z_]+')
  -- behaviour markers read from the stored function source (this script is read-only, so it cannot run the functions): they catch a function
  -- that was edited or replaced by something weaker. The behaviour itself is proven by supabase/support/tests/whatsapp_outbound_replies.test.mjs.
  union all select '09 every function derives ownership from the actor (profiles.user_id = p_actor_user_id) and returns not_found otherwise (3)', '3',
         (select count(*)::text from fn where prosrc like '%p.user_id = p_actor_user_id%' and prosrc like '%not_found%')
  union all select '09b prepare: idempotent insert on (profile_id, client_request_id), 24-hour window, replay conflict check, trimmed 4096-char body', 'true',
         (select coalesce(bool_and(prosrc like '%on conflict (profile_id, client_request_id) where client_request_id is not null do nothing%' and prosrc like '%interval ''24 hours''%'
                  and prosrc like '%last_inbound_at%' and prosrc like '%''conflict''%' and prosrc like '%char_length(v_body) > 4096%' and prosrc like '%btrim%'), false)::text from fn where proname = 'inbox_prepare_outbound_text')
  union all select '09c complete: wamid uniqueness handled, early events attached, status via the Phase 4 ranking, conversation timestamps, never downgrades', 'true',
         (select coalesce(bool_and(prosrc like '%unique_violation%' and prosrc like '%inbox_status_events%' and prosrc like '%inbox_status_rank(v_status) > public.inbox_status_rank(m.status)%'
                  and prosrc like '%last_outbound_at%' and prosrc like '%last_message_at%'), false)::text from fn where proname = 'inbox_complete_outbound')
  union all select '09d fail: only while no wamid exists, only upward in the Phase 4 ranking', 'true',
         (select coalesce(bool_and(prosrc like '%m.provider_message_id is null%' and prosrc like '%inbox_status_rank(''failed'') > public.inbox_status_rank(m.status)%'), false)::text from fn where proname = 'inbox_fail_outbound')
  -- no unexpected schema objects
  union all select '10 the inbox/wa function set is exactly Phase 4 (9) + Phase 7 (3) = 12', '12',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'inbox\_%' or p.proname like 'wa\_%'))
  union all select '10b the six tables still carry exactly the six Phase 4 guard triggers and no others', '6',
         (select count(*)::text from pg_trigger tg where not tg.tgisinternal and tg.tgrelid in (select ('public.' || t6.t)::regclass::oid from t6))
  union all select '10c no Phase 7 object lives outside the public schema', '0',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname in (select f from f3) and n.nspname <> 'public')
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
