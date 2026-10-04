-- PREFLIGHT for 2026-12-08_whatsapp_outbound_replies.sql — READ-ONLY (only SELECTs). FOR OWNER REVIEW; do not run until the migration is approved.
-- Every row must say ok = true; any ok = false means STOP and report it before applying the migration.
-- (Do not run this after applying: its "nothing exists yet" rows are expected to fail once the migration is applied.)

with checks(label, expect, actual) as (
  -- the Phase 4 objects the functions read and write must exist exactly as audited
  select 'Phase 4 tables exist (6)', '6', (select count(*)::text from pg_tables where schemaname = 'public' and tablename in
         ('wa_accounts', 'inbox_contacts', 'inbox_conversations', 'inbox_messages', 'inbox_message_media', 'inbox_status_events'))
  union all select 'inbox_status_rank(text) exists', 'true', (to_regprocedure('public.inbox_status_rank(text)') is not null)::text
  union all select 'Phase 4 ingestion functions exist (2)', '2', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('inbox_ingest_whatsapp_message', 'inbox_ingest_whatsapp_status'))
  union all select 'inbox_messages has the outbound columns', '4', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'inbox_messages' and column_name in ('client_request_id', 'sent_by_user_id', 'provider_message_id', 'status'))
  union all select 'UNIQUE (profile_id, client_request_id) index exists (outbound idempotency)', 'true', (exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'inbox_messages_request_idx' and indexdef like 'CREATE UNIQUE INDEX%(profile_id, client_request_id)%WHERE (client_request_id IS NOT NULL)%'))::text
  union all select 'inbox_conversations has last_outbound_at, last_inbound_at', '2', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'inbox_conversations' and column_name in ('last_outbound_at', 'last_inbound_at'))
  union all select 'inbox_messages status check allows queued/failed (outbound lifecycle)', 'true', (exists (select 1 from pg_constraint where conrelid = 'public.inbox_messages'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%queued%' and pg_get_constraintdef(oid) like '%failed%'))::text
  union all select 'Phase 4 guards exist (inbox_messages_guard, inbox_status_events_guard) with their triggers', '4', (select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('inbox_messages_guard', 'inbox_status_events_guard')) + (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname in ('inbox_messages_guard_trg', 'inbox_status_events_guard_trg')))::text
  union all select 'sent_by_user_id references public.users (the actor must be a real user)', 'true', (exists (select 1 from pg_constraint where conrelid = 'public.inbox_messages'::regclass and contype = 'f' and pg_get_constraintdef(oid) like '%sent_by_user_id%REFERENCES users(id)%'))::text
  union all select 'profiles(id, user_id) exist', '2', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name in ('id', 'user_id'))
  union all select 'service_role exists', 'true', (exists (select 1 from pg_roles where rolname = 'service_role'))::text
  -- nothing this migration creates exists yet
  union all select 'no Phase 7 function exists yet', '0', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('inbox_prepare_outbound_text', 'inbox_complete_outbound', 'inbox_fail_outbound'))
)
select label, expect, actual, (expect = actual) as ok from checks;
