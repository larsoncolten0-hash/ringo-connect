-- VERIFY for 2026-12-13_whatsapp_inbox_team_permission_guard.sql and 2026-12-14_whatsapp_inbox_staff.sql — READ-ONLY (a single SELECT).
-- FOR OWNER REVIEW; run once AFTER both migrations are applied. Every row must show ok = true.

with
fn as (select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc, p.prokind from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
staff_fn(f) as (values ('inbox_member_can'), ('inbox_actor_relation'), ('inbox_actor_access'), ('inbox_member_workspaces'), ('inbox_staff_can_read'),
                       ('inbox_member_prepare_outbound_text'), ('inbox_member_prepare_outbound_media'), ('inbox_member_complete_outbound'), ('inbox_member_complete_outbound_media'),
                       ('inbox_member_fail_outbound'), ('inbox_member_set_conversation_status'), ('inbox_member_mark_conversation_read'), ('inbox_member_saved_reply_save')),
guard_fn(f) as (values ('team_role_has_inbox'), ('team_inbox_grant_allowed'), ('organization_roles_inbox_guard'), ('organization_members_inbox_guard'), ('organization_invitations_inbox_guard')),
checks(label, expect, actual) as (
  select '01 all 13 staff functions exist', '13', (select count(*)::text from fn where proname in (select f from staff_fn))
  union all select '02 all 5 definer-side guard functions exist', '5', (select count(*)::text from fn where proname in (select f from guard_fn))
  union all select '03 every staff and guard function is SECURITY DEFINER with a pinned search_path', '18',
         (select count(*)::text from fn where proname in (select f from staff_fn union all select f from guard_fn) and prosecdef and proconfig::text like '%search_path=public, pg_temp%')
  union all select '04 service_role can execute every staff function', '13', (select count(*)::text from fn where proname in (select f from staff_fn) and has_function_privilege('service_role', oid, 'execute'))
  union all select '05 anon and public cannot execute any of them', '0', (select count(*)::text from fn where proname in (select f from staff_fn union all select f from guard_fn) and (has_function_privilege('anon', oid, 'execute') or has_function_privilege('public', oid, 'execute')))
  union all select '06 authenticated can execute ONLY inbox_staff_can_read (RLS helper)', 'inbox_staff_can_read',
         (select coalesce(string_agg(proname, ',' order by proname), '') from fn where proname in (select f from staff_fn union all select f from guard_fn) and has_function_privilege('authenticated', oid, 'execute'))
  union all select '07 the three Team guard triggers are installed', '3',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname in ('organization_roles_inbox_guard_trg', 'organization_members_inbox_guard_trg', 'organization_invitations_inbox_guard_trg'))
  union all select '08 six staff read policies exist, all SELECT for authenticated', '6',
         (select count(*)::text from pg_policies where schemaname = 'public' and policyname like '% staff read' and cmd = 'SELECT' and roles = '{authenticated}')
  union all select '09 no staff policy exists on wa_accounts, inbox_settings or inbox_conversation_state', '0',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('wa_accounts', 'inbox_settings', 'inbox_conversation_state') and policyname like '%staff%')
  union all select '10 no policy for any client role can write an inbox table', '0',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename like 'inbox\_%' and cmd <> 'SELECT')
  union all select '11 no client or service role holds INSERT / UPDATE / DELETE on the six history tables', '0',
         (select count(*)::text from (values ('anon'), ('authenticated'), ('service_role')) ro(role)
            cross join (values ('inbox_contacts'), ('inbox_conversations'), ('inbox_messages'), ('inbox_message_media'), ('inbox_status_events'), ('wa_accounts')) t(tbl)
            cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
           where has_table_privilege(ro.role::name, ('public.' || t.tbl)::regclass, p.priv))
  union all select '12 no function in the Inbox namespace deletes customer history (the only inbox delete is the owner-only saved reply)', '1',
         (select count(*)::text from fn where proname like 'inbox\_%' and prosrc ~* 'delete[[:space:]]+from')
  union all select '13 staff functions never mention delete, and there is no member delete function', '0',
         (select count(*)::text from fn where (proname like 'inbox\_member\_%' or proname in ('inbox_actor_access', 'inbox_actor_relation', 'inbox_staff_can_read')) and (prosrc ~* 'delete[[:space:]]+from' or proname like '%delete%'))
  union all select '14 the permission check knows exactly the seven inbox permissions (no delete permission)', '7|0',
         ((select (array_length(regexp_split_to_array(prosrc, 'when ''inbox[.]'), 1) - 1)::text from fn where proname = 'inbox_member_can') || '|' ||
          (select count(*)::text from fn where proname = 'inbox_member_can' and prosrc ~* 'delet'))
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
