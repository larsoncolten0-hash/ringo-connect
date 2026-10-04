-- VERIFY for 2026-12-07_whatsapp_inbox_foundation.sql — READ-ONLY (a single SELECT). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true.

with
t6(t) as (values ('wa_accounts'),('inbox_contacts'),('inbox_conversations'),('inbox_messages'),('inbox_message_media'),('inbox_status_events')),
f_rpc(f) as (values ('inbox_ingest_whatsapp_message'),('inbox_ingest_whatsapp_status')),
f_other(f) as (values ('wa_accounts_guard'),('inbox_contacts_guard'),('inbox_conversations_guard'),('inbox_messages_guard'),('inbox_message_media_guard'),('inbox_status_events_guard'),('inbox_status_rank')),
f_all(f) as (select f from f_rpc union all select f from f_other),
rel as (select c.oid, c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname in (select t from t6)),
fn as (select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (select f from f_all)),
cols(t, c) as (values
  ('wa_accounts','id'),('wa_accounts','profile_id'),('wa_accounts','phone_number_id'),('wa_accounts','waba_id'),('wa_accounts','display_phone'),('wa_accounts','status'),('wa_accounts','created_at'),('wa_accounts','updated_at'),
  ('inbox_contacts','id'),('inbox_contacts','profile_id'),('inbox_contacts','channel'),('inbox_contacts','external_id'),('inbox_contacts','display_name'),('inbox_contacts','bk_customer_id'),('inbox_contacts','first_seen_at'),('inbox_contacts','last_seen_at'),('inbox_contacts','created_at'),('inbox_contacts','updated_at'),
  ('inbox_conversations','id'),('inbox_conversations','profile_id'),('inbox_conversations','channel'),('inbox_conversations','account_id'),('inbox_conversations','contact_id'),('inbox_conversations','status'),('inbox_conversations','unread_count'),('inbox_conversations','last_message_at'),('inbox_conversations','last_inbound_at'),('inbox_conversations','last_outbound_at'),('inbox_conversations','assigned_to_user_id'),('inbox_conversations','created_at'),('inbox_conversations','updated_at'),
  ('inbox_messages','id'),('inbox_messages','profile_id'),('inbox_messages','conversation_id'),('inbox_messages','channel'),('inbox_messages','direction'),('inbox_messages','provider_message_id'),('inbox_messages','type'),('inbox_messages','body'),('inbox_messages','reply_to_provider_message_id'),('inbox_messages','provider_timestamp'),('inbox_messages','received_at'),('inbox_messages','status'),('inbox_messages','status_updated_at'),('inbox_messages','error_codes'),('inbox_messages','sent_by_user_id'),('inbox_messages','client_request_id'),('inbox_messages','created_at'),
  ('inbox_message_media','message_id'),('inbox_message_media','profile_id'),('inbox_message_media','kind'),('inbox_message_media','media_id'),('inbox_message_media','mime_type'),('inbox_message_media','sha256'),('inbox_message_media','filename'),('inbox_message_media','caption'),('inbox_message_media','storage_status'),('inbox_message_media','storage_ref'),('inbox_message_media','created_at'),
  ('inbox_status_events','id'),('inbox_status_events','profile_id'),('inbox_status_events','channel'),('inbox_status_events','provider_message_id'),('inbox_status_events','message_id'),('inbox_status_events','status'),('inbox_status_events','provider_timestamp'),('inbox_status_events','error_codes'),('inbox_status_events','received_at')),
checks(label, expect, actual) as (
  select '01 Phase 4 tables exist (6)', '6', (select count(*)::text from rel)
  union all select '02 no expected column is missing (0)', '0', (select count(*)::text from cols x where not exists (select 1 from information_schema.columns i where i.table_schema = 'public' and i.table_name = x.t and i.column_name = x.c))
  union all select '02b NO UNEXPECTED column exists in any Phase 4 table, e.g. redacted_at (0)', '0', (select count(*)::text from information_schema.columns i where i.table_schema = 'public' and i.table_name in (select t from t6) and not exists (select 1 from cols x where x.t = i.table_name and x.c = i.column_name))
  union all select '02c exact column total of the six tables, read from the catalog and compared to a fixed contract (68)', '68', (select count(*)::text from information_schema.columns i where i.table_schema = 'public' and i.table_name in (select t from t6))
  union all select '03 functions exist exactly once each (9)', '9|9', ((select count(*)::text from fn) || '|' || (select count(distinct proname)::text from fn))
  union all select '04 each guard trigger is on its own table, calls its own function, and is BEFORE UPDATE FOR EACH ROW (6)', '6',
         (select count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace join pg_proc p on p.oid = t.tgfoid
           join (values ('wa_accounts_guard_trg', 'wa_accounts', 'wa_accounts_guard'), ('inbox_contacts_guard_trg', 'inbox_contacts', 'inbox_contacts_guard'),
                        ('inbox_conversations_guard_trg', 'inbox_conversations', 'inbox_conversations_guard'), ('inbox_messages_guard_trg', 'inbox_messages', 'inbox_messages_guard'),
                        ('inbox_message_media_guard_trg', 'inbox_message_media', 'inbox_message_media_guard'), ('inbox_status_events_guard_trg', 'inbox_status_events', 'inbox_status_events_guard'))
                 e(trg, tbl, fn) on e.trg = t.tgname and e.tbl = c.relname and e.fn = p.proname
           where not t.tgisinternal and n.nspname = 'public' and t.tgtype = 19 and t.tgenabled = 'O')
  union all select '04b the six tables carry no trigger other than those six', '0', (select count(*)::text from pg_trigger t where not t.tgisinternal and t.tgrelid in (select oid from rel) and t.tgname not like '%_guard_trg')
  union all select '05 RLS enabled on all 6 tables', '6', (select count(*)::text from rel where relrowsecurity)
  union all select '05b owner-read policies exist (6), SELECT-only for authenticated', '6', (select count(*)::text from pg_policies where schemaname = 'public' and tablename in (select t from t6) and policyname = tablename || ' owner read' and cmd = 'SELECT' and roles = '{authenticated}')
  union all select '05c no write policy on any Phase 4 table', '0', (select count(*)::text from pg_policies where schemaname = 'public' and tablename in (select t from t6) and cmd <> 'SELECT')
  union all select '05d no policy reads another inbox/wa table (no recursion): every policy references only profiles', '0',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename in (select t from t6) and (qual ~* '(from|join)[ (]+(public.)?(inbox_|wa_accounts)' or qual !~* 'from (public.)?profiles'))
  -- foreign keys
  union all select '06a conversations -> wa_accounts: composite FK, ON DELETE CASCADE', 'true', (exists (select 1 from pg_constraint where contype = 'f' and conrelid = 'public.inbox_conversations'::regclass and replace(pg_get_constraintdef(oid), 'public.', '') = 'FOREIGN KEY (profile_id, account_id) REFERENCES wa_accounts(profile_id, id) ON DELETE CASCADE'))::text
  union all select '06b conversations -> inbox_contacts: composite FK, ON DELETE CASCADE', 'true', (exists (select 1 from pg_constraint where contype = 'f' and conrelid = 'public.inbox_conversations'::regclass and replace(pg_get_constraintdef(oid), 'public.', '') = 'FOREIGN KEY (profile_id, contact_id) REFERENCES inbox_contacts(profile_id, id) ON DELETE CASCADE'))::text
  union all select '06c messages -> inbox_conversations: composite FK, ON DELETE CASCADE', 'true', (exists (select 1 from pg_constraint where contype = 'f' and conrelid = 'public.inbox_messages'::regclass and replace(pg_get_constraintdef(oid), 'public.', '') = 'FOREIGN KEY (profile_id, conversation_id) REFERENCES inbox_conversations(profile_id, id) ON DELETE CASCADE'))::text
  union all select '06d media -> inbox_messages: composite FK, ON DELETE CASCADE', 'true', (exists (select 1 from pg_constraint where contype = 'f' and conrelid = 'public.inbox_message_media'::regclass and replace(pg_get_constraintdef(oid), 'public.', '') = 'FOREIGN KEY (profile_id, message_id) REFERENCES inbox_messages(profile_id, id) ON DELETE CASCADE'))::text
  union all select '06e status events -> inbox_messages: composite FK, ON DELETE CASCADE', 'true', (exists (select 1 from pg_constraint where contype = 'f' and conrelid = 'public.inbox_status_events'::regclass and replace(pg_get_constraintdef(oid), 'public.', '') = 'FOREIGN KEY (profile_id, message_id) REFERENCES inbox_messages(profile_id, id) ON DELETE CASCADE'))::text
  union all select '06f contacts -> bk_customers: composite FK, ON DELETE RESTRICT', 'true', (exists (select 1 from pg_constraint where contype = 'f' and conrelid = 'public.inbox_contacts'::regclass and replace(pg_get_constraintdef(oid), 'public.', '') = 'FOREIGN KEY (profile_id, bk_customer_id) REFERENCES bk_customers(profile_id, id) ON DELETE RESTRICT'))::text
  union all select '06g every profile_id FK to profiles is ON DELETE CASCADE (5 single-column FKs: accounts, contacts, conversations, messages, events)', '5',
         (select count(*)::text from pg_constraint where contype = 'f' and confrelid = 'public.profiles'::regclass and conrelid in (select oid from rel) and confdeltype = 'c')
  union all select '06h the only FK into bk_customers is the optional contact link, and it is RESTRICT (inbox cleanup can never delete a bookkeeping customer)', '1|r',
         ((select count(*)::text from pg_constraint where contype = 'f' and confrelid = to_regclass('public.bk_customers') and conrelid in (select oid from rel)) || '|' ||
          (select coalesce(min(confdeltype::text), '') from pg_constraint where contype = 'f' and confrelid = to_regclass('public.bk_customers') and conrelid in (select oid from rel)))
  union all select '06i no table outside Phase 4 has a foreign key into a Phase 4 table', '0', (select count(*)::text from pg_constraint where contype = 'f' and confrelid in (select oid from rel) and conrelid not in (select oid from rel))
  -- idempotency / uniqueness
  union all select '07 UNIQUE (phone_number_id) on wa_accounts', 'true', (exists (select 1 from pg_constraint where conrelid = 'public.wa_accounts'::regclass and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (phone_number_id)'))::text
  union all select '07b UNIQUE (profile_id, channel, external_id) on inbox_contacts', 'true', (exists (select 1 from pg_constraint where conrelid = 'public.inbox_contacts'::regclass and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (profile_id, channel, external_id)'))::text
  union all select '07c UNIQUE (account_id, contact_id) on inbox_conversations (one rolling thread)', 'true', (exists (select 1 from pg_constraint where conrelid = 'public.inbox_conversations'::regclass and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (account_id, contact_id)'))::text
  union all select '07d UNIQUE (channel, provider_message_id) WHERE provider_message_id IS NOT NULL on inbox_messages', 'true',
         (exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'inbox_messages_provider_idx' and indexdef like 'CREATE UNIQUE INDEX%(channel, provider_message_id)%WHERE (provider_message_id IS NOT NULL)%'))::text
  union all select '07e UNIQUE (profile_id, client_request_id) WHERE client_request_id IS NOT NULL on inbox_messages', 'true',
         (exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'inbox_messages_request_idx' and indexdef like 'CREATE UNIQUE INDEX%(profile_id, client_request_id)%WHERE (client_request_id IS NOT NULL)%'))::text
  union all select '07f UNIQUE (channel, provider_message_id, status) on inbox_status_events', 'true', (exists (select 1 from pg_constraint where conrelid = 'public.inbox_status_events'::regclass and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (channel, provider_message_id, status)'))::text
  union all select '08 named indexes exist (3)', '3', (select count(*)::text from pg_indexes where schemaname = 'public' and indexname in ('inbox_conversations_list_idx', 'inbox_messages_thread_idx', 'inbox_status_events_message_idx'))
  -- privileges
  union all select '09 NO client role holds INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on any Phase 4 table (anon, authenticated, service_role)', '0',
         (select count(*)::text from rel r cross join (values ('anon'), ('authenticated'), ('service_role')) ro(role) cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
           where has_table_privilege(ro.role::name, r.oid, p.priv))
  union all select '09b anon has no SELECT, authenticated + service_role have SELECT on all 6 (12 grants)', '12',
         (select (count(*) filter (where has_table_privilege('authenticated'::name, r.oid, 'SELECT') and not has_table_privilege('anon'::name, r.oid, 'SELECT')) +
                  count(*) filter (where has_table_privilege('service_role'::name, r.oid, 'SELECT') and not has_table_privilege('anon'::name, r.oid, 'SELECT')))::text from rel r)
  union all select '10 the two ingest RPCs: service_role CAN execute (2)', '2', (select count(*)::text from fn where proname in (select f from f_rpc) and has_function_privilege('service_role', oid, 'execute'))
  union all select '10b NO function grants execute to anon / authenticated / public (all 9)', '0', (select count(*)::text from fn where has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute'))
  union all select '10c guards and the rank helper: service_role can NOT execute (7)', '7', (select count(*)::text from fn where proname in (select f from f_other) and not has_function_privilege('service_role', oid, 'execute'))
  union all select '10d the ingest RPCs are SECURITY DEFINER and pin search_path', '2', (select count(*)::text from fn where proname in (select f from f_rpc) and prosecdef and proconfig::text like '%search_path=public, pg_temp%')
  union all select '10e no RPC takes a profile_id / user id parameter (the owner is derived from wa_accounts)', '0',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (select f from f_rpc) and (pg_get_function_arguments(p.oid) ~* 'profile_id|user_id'))
  union all select '10g RPC signatures: inbox_ingest_whatsapp_message(15 named arguments) returns text', 'true',
         (exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'inbox_ingest_whatsapp_message'
                   and pg_get_function_arguments(p.oid) = 'p_phone_number_id text, p_waba_id text, p_message_id text, p_from text, p_timestamp timestamp with time zone, p_type text, p_text text, p_contact_name text, p_reply_to_message_id text, p_media_kind text, p_media_id text, p_media_mime_type text, p_media_sha256 text, p_media_filename text, p_media_caption text'
                   and pg_get_function_result(p.oid) = 'text'))::text
  union all select '10h RPC signatures: inbox_ingest_whatsapp_status(6 named arguments) returns text', 'true',
         (exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'inbox_ingest_whatsapp_status'
                   and pg_get_function_arguments(p.oid) = 'p_phone_number_id text, p_waba_id text, p_message_id text, p_status text, p_timestamp timestamp with time zone, p_error_codes integer[]'
                   and pg_get_function_result(p.oid) = 'text'))::text
  union all select '10f guards are trigger functions and none is SECURITY DEFINER', '0', (select count(*)::text from fn where proname like '%\_guard' and prosecdef)
  -- status model
  union all select '11 status rank: queued<sent<failed<delivered<read, others null', '0|1|2|3|4||',
         (coalesce(public.inbox_status_rank('queued')::text, '') || '|' || coalesce(public.inbox_status_rank('sent')::text, '') || '|' || coalesce(public.inbox_status_rank('failed')::text, '') || '|' ||
          coalesce(public.inbox_status_rank('delivered')::text, '') || '|' || coalesce(public.inbox_status_rank('read')::text, '') || '|' || coalesce(public.inbox_status_rank('deleted')::text, '') || '|' || coalesce(public.inbox_status_rank('received')::text, ''))
  -- additivity
  union all select '12 no existing table has a trigger that calls a Phase 4 function', '0', (select count(*)::text from pg_trigger t where not t.tgisinternal and t.tgfoid in (select oid from fn) and t.tgrelid not in (select oid from rel))
  union all select '12b plans has no inbox/whatsapp column (no plan flag added)', '0', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'plans' and (column_name ilike '%inbox%' or column_name ilike '%whatsapp%'))
  union all select '12c no Phase 4 function mentions bookkeeping writes', '0', (select count(*)::text from fn where prosrc ~* '(insert into|update|delete from)\s+(public\.)?bk_')
)
select label, expect, actual, (expect = actual) as ok from checks order by label;

-- Informational (not pass/fail): the migration seeds nothing, so wa_accounts is empty until the separately approved account-mapping step.
select (select count(*) from public.wa_accounts) as wa_accounts_rows, (select count(*) from public.inbox_messages) as inbox_messages_rows;
