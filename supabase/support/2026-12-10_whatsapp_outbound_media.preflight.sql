-- PREFLIGHT for 2026-12-10_whatsapp_outbound_media.sql — READ-ONLY (only SELECTs). FOR OWNER REVIEW; do not run until the migration is approved.
-- Every row must say ok = true. Any ok = false means STOP and report it before applying the migration.
-- (Do not run this after applying: its "nothing exists yet" row is expected to fail once the migration is applied.)

with checks(label, expect, actual) as (
  select 'Phase 4 tables exist (6)', '6', (select count(*)::text from pg_tables where schemaname = 'public' and tablename in
         ('wa_accounts', 'inbox_contacts', 'inbox_conversations', 'inbox_messages', 'inbox_message_media', 'inbox_status_events'))
  union all select 'Phase 7 functions exist (3)', '3', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('inbox_prepare_outbound_text', 'inbox_complete_outbound', 'inbox_fail_outbound'))
  union all select 'inbox_complete_outbound has the audited signature (uuid, uuid, text)', 'true', (to_regprocedure('public.inbox_complete_outbound(uuid,uuid,text)') is not null)::text
  union all select 'inbox_fail_outbound has the audited signature (uuid, uuid, integer[])', 'true', (to_regprocedure('public.inbox_fail_outbound(uuid,uuid,integer[])') is not null)::text
  union all select 'inbox_message_media.message_id is its primary key (one metadata row per message)', 'true', (exists (select 1 from pg_constraint where conrelid = 'public.inbox_message_media'::regclass and contype = 'p' and pg_get_constraintdef(oid) = 'PRIMARY KEY (message_id)'))::text
  union all select 'inbox_message_media.kind allows image, video, audio, document', 'true', (exists (select 1 from pg_constraint where conrelid = 'public.inbox_message_media'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%image%' and pg_get_constraintdef(oid) like '%video%' and pg_get_constraintdef(oid) like '%audio%' and pg_get_constraintdef(oid) like '%document%'))::text
  union all select 'inbox_message_media.storage_status allows not_downloaded', 'true', (exists (select 1 from pg_constraint where conrelid = 'public.inbox_message_media'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%not_downloaded%'))::text
  union all select 'inbox_messages.type accepts the media kinds (pattern check, not a fixed list)', 'true', (exists (select 1 from pg_constraint where conrelid = 'public.inbox_messages'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%type%' and pg_get_constraintdef(oid) like '%a-z_%'))::text
  union all select 'outbound idempotency index exists (profile_id, client_request_id)', 'true', (exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'inbox_messages_request_idx' and indexdef like 'CREATE UNIQUE INDEX%(profile_id, client_request_id)%WHERE (client_request_id IS NOT NULL)%'))::text
  union all select 'roles anon, authenticated, service_role exist', '3', (select count(*)::text from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))
  -- nothing this migration creates exists yet
  union all select 'no Phase 9 function exists yet', '0', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('inbox_prepare_outbound_media', 'inbox_complete_outbound_media'))
)
select label, expect, actual, (expect = actual) as ok from checks;
