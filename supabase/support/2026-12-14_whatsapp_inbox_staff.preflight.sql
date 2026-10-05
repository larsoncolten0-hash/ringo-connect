-- PREFLIGHT for 2026-12-13_whatsapp_inbox_team_permission_guard.sql and 2026-12-14_whatsapp_inbox_staff.sql — READ-ONLY (a single SELECT).
-- FOR OWNER REVIEW; run BEFORE applying either migration. Every row must show ok = true.

with
fn(f) as (values ('is_admin'), ('org_team_enabled'), ('has_org_permission'), ('inbox_prepare_outbound_text'), ('inbox_prepare_outbound_media'), ('inbox_complete_outbound'),
                 ('inbox_complete_outbound_media'), ('inbox_fail_outbound'), ('inbox_set_conversation_status'), ('inbox_mark_conversation_read'), ('inbox_saved_reply_save')),
tb(t) as (values ('organization_roles'), ('organization_members'), ('organization_invitations'), ('inbox_conversations'), ('inbox_contacts'), ('inbox_messages'),
                 ('inbox_message_media'), ('inbox_status_events'), ('inbox_saved_replies'), ('wa_accounts'), ('profiles')),
checks(label, expect, actual) as (
  select '01 every prerequisite function exists (' || (select count(*)::text from fn) || ')', (select count(*)::text from fn),
         (select count(distinct p.proname)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (select f from fn))
  union all select '02 every prerequisite table exists (' || (select count(*)::text from tb) || ')', (select count(*)::text from tb),
         (select count(*)::text from pg_tables where schemaname = 'public' and tablename in (select t from tb))
  union all select '03 the new objects are not there yet (guard + staff functions, 0 expected)', '0',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'inbox_member_%' or p.proname in ('inbox_staff_can_read', 'inbox_actor_access', 'inbox_actor_relation') or p.proname like 'team_inbox_%' or p.proname like '%_inbox_guard'))
  union all select '04 no role, member or invitation already carries an inbox permission (0 expected)', '0',
         (select count(*)::text from public.organization_roles r where exists (select 1 from unnest(r.permissions) x where lower(btrim(x)) like 'inbox.%'))
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
