-- PREFLIGHT for 2026-12-11_whatsapp_inbox_automation.sql — READ-ONLY (only SELECTs). FOR OWNER REVIEW; do not run until the migration is approved.
-- Every row must say ok = true. Any ok = false means STOP and report it before applying the migration.
-- (Do not run this after applying: its "nothing exists yet" rows are expected to fail once the migration is applied.)
-- Apply order: 2026-12-10_whatsapp_outbound_media.sql (and its verify) FIRST, then this one. This migration does not depend on the media functions,
-- but the checks below describe the state of a project that has Phases 4, 7, 8 and 9.

with checks(label, expect, actual) as (
  select 'Phase 4 tables exist (6)', '6', (select count(*)::text from pg_tables where schemaname = 'public' and tablename in
         ('wa_accounts', 'inbox_contacts', 'inbox_conversations', 'inbox_messages', 'inbox_message_media', 'inbox_status_events'))
  union all select 'profiles and users tables exist', '2', (select count(*)::text from pg_tables where schemaname = 'public' and tablename in ('profiles', 'users'))
  union all select 'inbox_conversations has the unique (profile_id, id) key the new table references', 'true',
         (exists (select 1 from pg_constraint where conrelid = 'public.inbox_conversations'::regclass and contype in ('u', 'p') and pg_get_constraintdef(oid) = 'UNIQUE (profile_id, id)'))::text
  union all select 'inbox_conversations has last_inbound_at and last_outbound_at', '2', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'inbox_conversations' and column_name in ('last_inbound_at', 'last_outbound_at'))
  union all select 'Phase 7 sender functions exist (3)', '3', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('inbox_prepare_outbound_text', 'inbox_complete_outbound', 'inbox_fail_outbound'))
  union all select 'time zone names are available to the database (Africa/Douala)', 'true', (exists (select 1 from pg_timezone_names where name = 'Africa/Douala'))::text
  union all select 'roles anon, authenticated, service_role exist', '3', (select count(*)::text from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))
  -- nothing this migration creates exists yet
  union all select 'no Phase 10 table exists yet', '0', (select count(*)::text from pg_tables where schemaname = 'public' and tablename in ('inbox_settings', 'inbox_conversation_state'))
  union all select 'no Phase 10 function exists yet', '0', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in
         ('inbox_hours_valid', 'inbox_within_hours', 'inbox_settings_guard', 'inbox_conversation_state_guard', 'inbox_settings_save', 'inbox_automation_inbound', 'inbox_automation_record_ack', 'inbox_automation_failed', 'inbox_claim_follow_ups'))
)
select label, expect, actual, (expect = actual) as ok from checks;
