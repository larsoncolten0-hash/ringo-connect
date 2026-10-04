-- PREFLIGHT for 2026-12-09_whatsapp_inbox_tools.sql — READ-ONLY (only SELECTs). FOR OWNER REVIEW; do not run until the migration is approved.
-- Every row must say ok = true; any ok = false means STOP and report it before applying the migration.
-- (Do not run this after applying: its "nothing exists yet" rows are expected to fail once the migration is applied.)

with checks(label, expect, actual) as (
  select 'Phase 4 tables exist (6)', '6', (select count(*)::text from pg_tables where schemaname = 'public' and tablename in
         ('wa_accounts', 'inbox_contacts', 'inbox_conversations', 'inbox_messages', 'inbox_message_media', 'inbox_status_events'))
  union all select 'Phase 7 functions exist (3)', '3', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('inbox_prepare_outbound_text', 'inbox_complete_outbound', 'inbox_fail_outbound'))
  union all select 'inbox_conversations.status check allows open and closed', 'true', (exists (select 1 from pg_constraint where conrelid = 'public.inbox_conversations'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%open%' and pg_get_constraintdef(oid) like '%closed%'))::text
  union all select 'inbox_conversations_guard exists and does not freeze status (identity columns only)', 'true',
         (exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'inbox_conversations_guard' and p.prosrc not like '%new.status <> old.status%'))::text
  union all select 'profiles(id, user_id) exist', '2', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name in ('id', 'user_id'))
  union all select 'wa_accounts(profile_id) exists', 'true', (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'wa_accounts' and column_name = 'profile_id'))::text
  union all select 'roles anon, authenticated, service_role exist', '3', (select count(*)::text from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))
  union all select 'gen_random_uuid() and hashtext() are available', 'true', (to_regprocedure('gen_random_uuid()') is not null and to_regprocedure('hashtext(text)') is not null)::text
  -- nothing this migration creates exists yet
  union all select 'no inbox_saved_replies table exists yet', '0', (select count(*)::text from pg_tables where schemaname = 'public' and tablename = 'inbox_saved_replies')
  union all select 'no Phase 8 function exists yet', '0', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('inbox_saved_replies_guard', 'inbox_saved_reply_save', 'inbox_saved_reply_delete', 'inbox_set_conversation_status'))
)
select label, expect, actual, (expect = actual) as ok from checks;
