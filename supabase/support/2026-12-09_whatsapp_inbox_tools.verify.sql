-- VERIFY for 2026-12-09_whatsapp_inbox_tools.sql — READ-ONLY (a single SELECT). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true.

with
f3(f) as (values ('inbox_saved_reply_save'), ('inbox_saved_reply_delete'), ('inbox_set_conversation_status')),
fall(f) as (select f from f3 union all select 'inbox_saved_replies_guard'),
t_cols(c) as (values ('id'), ('profile_id'), ('title'), ('body'), ('created_at'), ('updated_at')),
fn as (select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc, pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as res
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (select f from fall)),
rel as (select c.oid, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname = 'inbox_saved_replies'),
checks(label, expect, actual) as (
  select '01 the saved-replies table exists with RLS enabled', '1|1', ((select count(*)::text from rel) || '|' || (select count(*)::text from rel where relrowsecurity))
  union all select '02 exactly the expected columns (6 present, 0 unexpected)', '6|0',
         ((select count(*)::text from information_schema.columns i where i.table_schema = 'public' and i.table_name = 'inbox_saved_replies' and i.column_name in (select c from t_cols)) || '|' ||
          (select count(*)::text from information_schema.columns i where i.table_schema = 'public' and i.table_name = 'inbox_saved_replies' and i.column_name not in (select c from t_cols)))
  union all select '03 owner-read policy only: one SELECT policy for authenticated, no write policy', '1|0',
         ((select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'inbox_saved_replies' and cmd = 'SELECT' and roles = '{authenticated}' and policyname = 'inbox_saved_replies owner read') || '|' ||
          (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'inbox_saved_replies' and cmd <> 'SELECT'))
  union all select '03b the policy reads only profiles (no recursion)', '0', (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'inbox_saved_replies' and (qual ~* '(from|join)[ (]+(public[.])?inbox_' or qual !~* 'from (public[.])?profiles'))
  union all select '04 no client or service role holds a write privilege on the table', '0',
         (select count(*)::text from rel r cross join (values ('anon'), ('authenticated'), ('service_role')) ro(role) cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv) where has_table_privilege(ro.role::name, r.oid, p.priv))
  union all select '04b anon has no SELECT, authenticated and service_role have SELECT (1 table)', '1',
         (select count(*)::text from rel r where has_table_privilege('authenticated'::name, r.oid, 'SELECT') and has_table_privilege('service_role'::name, r.oid, 'SELECT') and not has_table_privilege('anon'::name, r.oid, 'SELECT'))
  union all select '05 profile_id references profiles ON DELETE CASCADE', 'true', (exists (select 1 from pg_constraint where conrelid = 'public.inbox_saved_replies'::regclass and contype = 'f' and replace(pg_get_constraintdef(oid), 'public.', '') = 'FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE'))::text
  union all select '05b no table outside this one has a foreign key into it', '0', (select count(*)::text from pg_constraint where contype = 'f' and confrelid = 'public.inbox_saved_replies'::regclass)
  union all select '06 unique title per profile (case-insensitive) index', 'true', (exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'inbox_saved_replies_title_idx' and indexdef like 'CREATE UNIQUE INDEX%(profile_id, lower(title))%'))::text
  union all select '06b length checks present (title 60, body 4096)', '2', (select count(*)::text from pg_constraint where conrelid = 'public.inbox_saved_replies'::regclass and contype = 'c' and (pg_get_constraintdef(oid) like '%char_length(title)%60%' or pg_get_constraintdef(oid) like '%char_length(body)%4096%'))
  union all select '07 the guard trigger is on the table, BEFORE UPDATE FOR EACH ROW, calling its own function', '1',
         (select count(*)::text from pg_trigger t join pg_proc p on p.oid = t.tgfoid where not t.tgisinternal and t.tgname = 'inbox_saved_replies_guard_trg' and t.tgrelid = 'public.inbox_saved_replies'::regclass and p.proname = 'inbox_saved_replies_guard' and t.tgtype = 19)
  union all select '08 the four functions exist exactly once each (4|4)', '4|4', ((select count(*)::text from fn) || '|' || (select count(distinct proname)::text from fn))
  union all select '08b save signature', 'p_actor_user_id uuid, p_profile_id uuid, p_reply_id uuid, p_title text, p_body text -> jsonb', (select coalesce(max(args || ' -> ' || res), '') from fn where proname = 'inbox_saved_reply_save')
  union all select '08c delete signature', 'p_actor_user_id uuid, p_profile_id uuid, p_reply_id uuid -> text', (select coalesce(max(args || ' -> ' || res), '') from fn where proname = 'inbox_saved_reply_delete')
  union all select '08d status signature', 'p_actor_user_id uuid, p_conversation_id uuid, p_status text -> text', (select coalesce(max(args || ' -> ' || res), '') from fn where proname = 'inbox_set_conversation_status')
  union all select '09 the three callable functions are SECURITY DEFINER with a pinned search_path', '3', (select count(*)::text from fn where proname in (select f from f3) and prosecdef and proconfig::text like '%search_path=public, pg_temp%')
  union all select '09b service_role CAN execute the three, and nobody can execute the guard directly', '3|0',
         ((select count(*)::text from fn where proname in (select f from f3) and has_function_privilege('service_role', oid, 'execute')) || '|' ||
          (select count(*)::text from fn where proname = 'inbox_saved_replies_guard' and (has_function_privilege('service_role', oid, 'execute') or has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute'))))
  union all select '09c NO function is executable by anon, authenticated or public', '0', (select count(*)::text from fn where has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute'))
  union all select '10 no function takes a recipient, phone number, WABA or token parameter', '0', (select count(*)::text from fn where args ~* '(recipient|phone|waba|token|p_to )')
  union all select '11 behaviour markers: ownership from the actor, WhatsApp-account owners only, 50-reply limit, unique-title handling', 'true',
         (select coalesce(bool_and(prosrc like '%p.user_id = p_actor_user_id%' and prosrc like '%wa_accounts%' and prosrc like '%>= 50%' and prosrc like '%duplicate_title%' and prosrc like '%not_found%'), false)::text from fn where proname = 'inbox_saved_reply_save')
  union all select '11b delete / status derive ownership from the actor and only change what they should', 'true',
         (select (coalesce(bool_and(prosrc like '%p.user_id = p_actor_user_id%' and prosrc like '%not_found%'), false) and bool_or(proname = 'inbox_set_conversation_status' and prosrc like '%set status = p_status%' and prosrc not like '%unread_count%'))::text from fn where proname in ('inbox_saved_reply_delete', 'inbox_set_conversation_status'))
  union all select '12 the functions write only inbox_* tables', '0',
         (select count(*)::text from fn where prosrc ~* '(insert into|update|delete from)[[:space:]]+((public[.])(?!inbox_)|(?!public[.])(?!inbox_))[a-z_]+')
  union all select '13 Phase 4 and Phase 7 objects unchanged in kind: 6 Phase 4 tables, 12 inbox/wa functions plus the 4 new ones = 16', '6|16',
         ((select count(*)::text from pg_tables where schemaname = 'public' and tablename in ('wa_accounts', 'inbox_contacts', 'inbox_conversations', 'inbox_messages', 'inbox_message_media', 'inbox_status_events')) || '|' ||
          (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'inbox\_%' or p.proname like 'wa\_%')))
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
