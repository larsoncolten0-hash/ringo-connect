-- PREFLIGHT for 2026-12-07_whatsapp_inbox_foundation.sql — READ-ONLY (only SELECTs). FOR OWNER REVIEW; do not run until the migration is approved.
-- Every row must say ok = true; any ok = false means STOP and report it before applying the migration.
-- (Do not run this after applying: its "nothing exists yet" rows are expected to fail once the migration is applied.)

with checks(label, expect, actual) as (
  -- 1. what the migration references
  select 'profiles exists with (id, user_id)', '2', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name in ('id', 'user_id'))
  union all select 'profiles.id is its primary key', 'true', (exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'p' and pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'))::text
  union all select 'public.users exists with (id)', '1', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'id')
  union all select 'bk_customers exists (Business Toolkit Phase 3 applied)', 'true', (to_regclass('public.bk_customers') is not null)::text
  union all select 'bk_customers has UNIQUE (profile_id, id) (composite FK target)', 'true',
         (exists (select 1 from pg_constraint where conrelid = to_regclass('public.bk_customers') and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (profile_id, id)'))::text
  union all select 'roles anon, authenticated, service_role exist', '3', (select count(*)::text from pg_roles where rolname in ('anon', 'authenticated', 'service_role'))
  union all select 'gen_random_uuid() is available', 'true', (to_regprocedure('gen_random_uuid()') is not null)::text
  -- 2. nothing this migration creates exists yet
  union all select 'no Phase 4 table exists', '0', (select count(*)::text from pg_tables where schemaname = 'public' and tablename in
         ('wa_accounts', 'inbox_contacts', 'inbox_conversations', 'inbox_messages', 'inbox_message_media', 'inbox_status_events'))
  union all select 'no Phase 4 function exists', '0', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in
         ('wa_accounts_guard', 'inbox_contacts_guard', 'inbox_conversations_guard', 'inbox_messages_guard', 'inbox_message_media_guard',
          'inbox_status_events_guard', 'inbox_status_rank', 'inbox_ingest_whatsapp_message', 'inbox_ingest_whatsapp_status'))
)
select label, expect, actual, (expect = actual) as ok from checks;

-- Informational (not pass/fail): the migration inserts NO wa_accounts row. The Ringo-owned platform profile must be identified separately
-- (this query only helps a human look; it does not choose one).
select count(*) as profiles_total from public.profiles;
