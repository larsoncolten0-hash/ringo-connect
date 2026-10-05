-- WhatsApp Inbox — STAFF ROLES & PERMISSIONS (STEP 2).  PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Lets members of an organization work in its Inbox from THEIR OWN Ringo account, using the existing Team system (organization_members /
-- organization_roles). Permissions are ordinary role permission strings (organization_roles.permissions is text[]; no schema change):
--     inbox.view  inbox.reply  inbox.media  inbox.saved_replies  inbox.ai  inbox.mark_read  inbox.close
-- Dependencies (enforced HERE, not just in the UI):  reply -> view;  media -> view + reply;  saved_replies / ai / mark_read / close -> view.
-- There is NO delete permission and NO staff delete function or policy: staff get SELECT only (plus the member functions below). Saved-reply
-- deletion, Inbox settings, automation and the WhatsApp account stay owner-only (their existing functions are not touched and have no member variant).
-- Only the organization OWNER can grant or revoke any `inbox.*` permission: see 2026-12-13_whatsapp_inbox_team_permission_guard.sql (REQUIRED FIRST).
--
-- AUTHORIZATION CHAIN, re-derived inside the database on every call (nothing comes from the browser):
--     actor user id (from the session, passed by the trusted server route)
--       -> conversation (or the profile the SERVER resolved) -> the profile that OWNS it
--       -> owner? (profiles.user_id = actor)  OR  an ACTIVE organization_members row of THAT profile
--       -> the member's role must belong to THAT profile (a role of another organization grants nothing)
--       -> the Team plan gate: org_team_enabled(profile)            (owners are not gated here, exactly as before)
--       -> the exact permission, plus its dependencies.
-- A guessed or foreign conversation id, an inactive/removed member, a downgraded organization and a missing permission all answer 'not_found'
-- (indistinguishable); the trusted route may additionally call inbox_actor_access to answer 403 'forbidden' to a real member.
--
-- NEW FUNCTIONS (SECURITY DEFINER, search_path = public, pg_temp, EXECUTE for service_role only unless stated):
--   inbox_member_can(actor, profile, permission) boolean             the explicit-actor permission check used by everything below
--   inbox_actor_relation(actor, profile, permission) text            'owner' | 'member' | 'forbidden' | 'not_found'
--   inbox_actor_access(actor, conversation, permission) text         same, starting from a conversation id
--   inbox_member_workspaces(actor) jsonb                             the organizations whose Inbox the actor may view, with their Inbox permissions
--   inbox_staff_can_read(profile, permission) boolean                for RLS only: uses auth.uid(); EXECUTE for authenticated + service_role
--   inbox_member_prepare_outbound_text / _media, inbox_member_complete_outbound / _media, inbox_member_fail_outbound,
--   inbox_member_set_conversation_status, inbox_member_mark_conversation_read, inbox_member_saved_reply_save
--       Each: check permission (-> 'not_found' / {result:'not_found'} when missing), then run the EXISTING, audited owner function for the
--       conversation's owner and record the REAL staff user (inbox_messages.sent_by_user_id) — the owner function is reused unchanged, so the send
--       lifecycle, idempotency (client_request_id), 24-hour window and validation are byte-for-byte the same. The staff member is NEVER the owner:
--       the owner id is used only inside the database call, and the message row is re-attributed to the staff actor in the same transaction.
--       A staff member can only complete or fail a message THEY created.
--
-- NEW POLICIES (SELECT only, to authenticated; additive, beside the existing owner-read policies):
--   inbox_conversations / inbox_contacts / inbox_messages / inbox_message_media / inbox_status_events   "<table> staff read"   (inbox.view)
--   inbox_saved_replies                                                                              "inbox_saved_replies staff read"  (inbox.saved_replies)
--   NOT granted: wa_accounts (WABA / phone number ids), inbox_settings, inbox_conversation_state, and every write.
--
-- Depends on: 2026-12-07 .. 2026-12-12 Inbox migrations, 2026-10-01/02/03 Team migrations (organization_members, organization_roles, org_team_enabled),
--             2026-12-13_whatsapp_inbox_team_permission_guard.sql.
-- Rollback: supabase/support/2026-12-14_whatsapp_inbox_staff.rollback.sql

begin;

-- ============================================================================
-- 1. PERMISSION CHECK
-- ============================================================================
create or replace function public.inbox_member_can(p_actor_user_id uuid, p_profile_id uuid, p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_required text[];
  v_perms text[];
begin
  if p_actor_user_id is null or p_profile_id is null or p_permission is null then return false; end if;

  v_required := case p_permission
    when 'inbox.view' then array['inbox.view']
    when 'inbox.reply' then array['inbox.view', 'inbox.reply']
    when 'inbox.media' then array['inbox.view', 'inbox.reply', 'inbox.media']
    when 'inbox.saved_replies' then array['inbox.view', 'inbox.saved_replies']
    when 'inbox.ai' then array['inbox.view', 'inbox.ai']
    when 'inbox.mark_read' then array['inbox.view', 'inbox.mark_read']
    when 'inbox.close' then array['inbox.view', 'inbox.close']
    else null
  end;
  if v_required is null then return false; end if;   -- any name outside the seven above is never granted

  -- the owner of the profile is unrestricted by Inbox permissions and by the Team gate (exactly as before)
  if exists (select 1 from public.profiles p where p.id = p_profile_id and p.user_id = p_actor_user_id) then return true; end if;

  -- Team plan gate (the existing Team convention: the ORGANIZATION's plan)
  if not coalesce(public.org_team_enabled(p_profile_id), false) then return false; end if;

  -- an ACTIVE membership of THIS organization, through a role that belongs to THIS organization
  select r.permissions into v_perms
    from public.organization_members m
    join public.organization_roles r on r.id = m.role_id and r.profile_id = m.profile_id
   where m.profile_id = p_profile_id and m.user_id = p_actor_user_id and m.status = 'active';
  if not found then return false; end if;

  return coalesce(v_perms, '{}'::text[]) @> v_required;
end;
$$;

-- 'owner' | 'member' (allowed) | 'forbidden' (a real member of the organization who lacks the permission) | 'not_found' (anyone else)
create or replace function public.inbox_actor_relation(p_actor_user_id uuid, p_profile_id uuid, p_permission text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_actor_user_id is null or p_profile_id is null then return 'not_found'; end if;
  if exists (select 1 from public.profiles p where p.id = p_profile_id and p.user_id = p_actor_user_id) then return 'owner'; end if;
  if not coalesce(public.org_team_enabled(p_profile_id), false) then return 'not_found'; end if;
  if not exists (select 1 from public.organization_members m join public.organization_roles r on r.id = m.role_id and r.profile_id = m.profile_id
                  where m.profile_id = p_profile_id and m.user_id = p_actor_user_id and m.status = 'active') then
    return 'not_found';
  end if;
  return case when public.inbox_member_can(p_actor_user_id, p_profile_id, p_permission) then 'member' else 'forbidden' end;
end;
$$;

create or replace function public.inbox_actor_access(p_actor_user_id uuid, p_conversation_id uuid, p_permission text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
begin
  if p_actor_user_id is null or p_conversation_id is null then return 'not_found'; end if;
  select cv.profile_id into v_profile from public.inbox_conversations cv where cv.id = p_conversation_id;
  if not found then return 'not_found'; end if;
  return public.inbox_actor_relation(p_actor_user_id, v_profile, p_permission);
end;
$$;

-- The organizations whose Inbox the actor may VIEW as a team member (not as owner), with the Inbox permissions that actually work for them.
-- Only organizations that have a WhatsApp account are listed.
create or replace function public.inbox_member_workspaces(p_actor_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_out jsonb;
begin
  if p_actor_user_id is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'profile_id', m.profile_id,
           'permissions', (select coalesce(jsonb_agg(x.p order by x.p), '[]'::jsonb)
                             from unnest(array['inbox.view', 'inbox.reply', 'inbox.media', 'inbox.saved_replies', 'inbox.ai', 'inbox.mark_read', 'inbox.close']) as x(p)
                            where public.inbox_member_can(p_actor_user_id, m.profile_id, x.p))
         ) order by m.created_at), '[]'::jsonb)
    into v_out
    from public.organization_members m
   where m.user_id = p_actor_user_id and m.status = 'active'
     and exists (select 1 from public.wa_accounts a where a.profile_id = m.profile_id)
     and public.inbox_member_can(p_actor_user_id, m.profile_id, 'inbox.view');
  return v_out;
end;
$$;

-- For RLS ONLY: the signed-in user (auth.uid()). It only ever answers about the CALLER, so exposing it to `authenticated` leaks nothing.
create or replace function public.inbox_staff_can_read(p_profile_id uuid, p_permission text default 'inbox.view')
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.inbox_member_can(auth.uid(), p_profile_id, p_permission)
$$;

-- ============================================================================
-- 2. MEMBER-AWARE MUTATIONS (reuse the existing owner functions; re-attribute to the real actor)
-- ============================================================================
-- Resolves the conversation's profile and that profile's owner; null profile when the conversation does not exist.
create or replace function public.inbox_member_prepare_outbound_text(p_actor_user_id uuid, p_conversation_id uuid, p_client_request_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
  v_owner uuid;
  v_res jsonb;
  v_sender uuid;
begin
  if p_actor_user_id is null or p_conversation_id is null or p_client_request_id is null then return jsonb_build_object('result', 'invalid'); end if;
  select cv.profile_id, p.user_id into v_profile, v_owner
    from public.inbox_conversations cv join public.profiles p on p.id = cv.profile_id where cv.id = p_conversation_id;
  if not found or not public.inbox_member_can(p_actor_user_id, v_profile, 'inbox.reply') then return jsonb_build_object('result', 'not_found'); end if;

  v_res := public.inbox_prepare_outbound_text(v_owner, p_conversation_id, p_client_request_id, p_body);
  if v_res->>'result' = 'created' then
    update public.inbox_messages m set sent_by_user_id = p_actor_user_id where m.id = (v_res->>'message_id')::uuid and m.profile_id = v_profile;
  elsif v_res->>'result' = 'existing' then
    -- a replay is only honoured for the member who made the original request
    select m.sent_by_user_id into v_sender from public.inbox_messages m where m.id = (v_res->>'message_id')::uuid and m.profile_id = v_profile;
    if v_sender is distinct from p_actor_user_id then return jsonb_build_object('result', 'conflict'); end if;
  end if;
  return v_res;
end;
$$;

create or replace function public.inbox_member_prepare_outbound_media(p_actor_user_id uuid, p_conversation_id uuid, p_client_request_id uuid, p_kind text, p_caption text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
  v_owner uuid;
  v_res jsonb;
  v_sender uuid;
begin
  if p_actor_user_id is null or p_conversation_id is null or p_client_request_id is null then return jsonb_build_object('result', 'invalid'); end if;
  select cv.profile_id, p.user_id into v_profile, v_owner
    from public.inbox_conversations cv join public.profiles p on p.id = cv.profile_id where cv.id = p_conversation_id;
  if not found or not public.inbox_member_can(p_actor_user_id, v_profile, 'inbox.media') then return jsonb_build_object('result', 'not_found'); end if;

  v_res := public.inbox_prepare_outbound_media(v_owner, p_conversation_id, p_client_request_id, p_kind, p_caption);
  if v_res->>'result' = 'created' then
    update public.inbox_messages m set sent_by_user_id = p_actor_user_id where m.id = (v_res->>'message_id')::uuid and m.profile_id = v_profile;
  elsif v_res->>'result' = 'existing' then
    select m.sent_by_user_id into v_sender from public.inbox_messages m where m.id = (v_res->>'message_id')::uuid and m.profile_id = v_profile;
    if v_sender is distinct from p_actor_user_id then return jsonb_build_object('result', 'conflict'); end if;
  end if;
  return v_res;
end;
$$;

-- A member may only complete / fail an outbound message THEY created.
create or replace function public.inbox_member_complete_outbound(p_actor_user_id uuid, p_message_id uuid, p_provider_message_id text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
  v_owner uuid;
  v_sender uuid;
begin
  if p_actor_user_id is null or p_message_id is null then return 'invalid'; end if;
  select m.profile_id, p.user_id, m.sent_by_user_id into v_profile, v_owner, v_sender
    from public.inbox_messages m join public.profiles p on p.id = m.profile_id where m.id = p_message_id and m.direction = 'outbound';
  if not found or v_sender is distinct from p_actor_user_id or not public.inbox_member_can(p_actor_user_id, v_profile, 'inbox.reply') then return 'not_found'; end if;
  return public.inbox_complete_outbound(v_owner, p_message_id, p_provider_message_id);
end;
$$;

create or replace function public.inbox_member_complete_outbound_media(
  p_actor_user_id uuid, p_message_id uuid, p_provider_message_id text, p_media_id text, p_mime_type text, p_filename text, p_sha256 text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
  v_owner uuid;
  v_sender uuid;
begin
  if p_actor_user_id is null or p_message_id is null then return 'invalid'; end if;
  select m.profile_id, p.user_id, m.sent_by_user_id into v_profile, v_owner, v_sender
    from public.inbox_messages m join public.profiles p on p.id = m.profile_id where m.id = p_message_id and m.direction = 'outbound';
  if not found or v_sender is distinct from p_actor_user_id or not public.inbox_member_can(p_actor_user_id, v_profile, 'inbox.media') then return 'not_found'; end if;
  return public.inbox_complete_outbound_media(v_owner, p_message_id, p_provider_message_id, p_media_id, p_mime_type, p_filename, p_sha256);
end;
$$;

create or replace function public.inbox_member_fail_outbound(p_actor_user_id uuid, p_message_id uuid, p_error_codes integer[])
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
  v_owner uuid;
  v_sender uuid;
begin
  if p_actor_user_id is null or p_message_id is null then return 'invalid'; end if;
  select m.profile_id, p.user_id, m.sent_by_user_id into v_profile, v_owner, v_sender
    from public.inbox_messages m join public.profiles p on p.id = m.profile_id where m.id = p_message_id and m.direction = 'outbound';
  if not found or v_sender is distinct from p_actor_user_id or not public.inbox_member_can(p_actor_user_id, v_profile, 'inbox.reply') then return 'not_found'; end if;
  return public.inbox_fail_outbound(v_owner, p_message_id, p_error_codes);
end;
$$;

create or replace function public.inbox_member_set_conversation_status(p_actor_user_id uuid, p_conversation_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
  v_owner uuid;
begin
  if p_actor_user_id is null or p_conversation_id is null or p_status is null then return 'invalid'; end if;
  select cv.profile_id, p.user_id into v_profile, v_owner
    from public.inbox_conversations cv join public.profiles p on p.id = cv.profile_id where cv.id = p_conversation_id;
  if not found or not public.inbox_member_can(p_actor_user_id, v_profile, 'inbox.close') then return 'not_found'; end if;
  return public.inbox_set_conversation_status(v_owner, p_conversation_id, p_status);
end;
$$;

create or replace function public.inbox_member_mark_conversation_read(p_actor_user_id uuid, p_conversation_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
  v_owner uuid;
begin
  if p_actor_user_id is null or p_conversation_id is null then return 'invalid'; end if;
  select cv.profile_id, p.user_id into v_profile, v_owner
    from public.inbox_conversations cv join public.profiles p on p.id = cv.profile_id where cv.id = p_conversation_id;
  if not found or not public.inbox_member_can(p_actor_user_id, v_profile, 'inbox.mark_read') then return 'not_found'; end if;
  return public.inbox_mark_conversation_read(v_owner, p_conversation_id);
end;
$$;

-- Create / edit ONLY. There is deliberately no member variant of inbox_saved_reply_delete.
create or replace function public.inbox_member_saved_reply_save(p_actor_user_id uuid, p_profile_id uuid, p_reply_id uuid, p_title text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  if p_actor_user_id is null or p_profile_id is null then return jsonb_build_object('result', 'invalid'); end if;
  if not public.inbox_member_can(p_actor_user_id, p_profile_id, 'inbox.saved_replies') then return jsonb_build_object('result', 'not_found'); end if;
  select p.user_id into v_owner from public.profiles p where p.id = p_profile_id;
  if v_owner is null then return jsonb_build_object('result', 'not_found'); end if;
  return public.inbox_saved_reply_save(v_owner, p_profile_id, p_reply_id, p_title, p_body);
end;
$$;

-- ============================================================================
-- 3. FUNCTION GRANTS
-- ============================================================================
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('inbox_member_can', 'inbox_actor_relation', 'inbox_actor_access', 'inbox_member_workspaces', 'inbox_staff_can_read',
                                                         'inbox_member_prepare_outbound_text', 'inbox_member_prepare_outbound_media', 'inbox_member_complete_outbound',
                                                         'inbox_member_complete_outbound_media', 'inbox_member_fail_outbound', 'inbox_member_set_conversation_status',
                                                         'inbox_member_mark_conversation_read', 'inbox_member_saved_reply_save')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- the ONE function the database itself calls on behalf of a signed-in browser session (inside the staff read policies below)
grant execute on function public.inbox_staff_can_read(uuid, text) to authenticated;

-- ============================================================================
-- 4. STAFF READ POLICIES (SELECT only; the tables stay write-protected for everyone: no INSERT / UPDATE / DELETE privilege exists for any role)
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array['inbox_contacts', 'inbox_conversations', 'inbox_messages', 'inbox_message_media', 'inbox_status_events']
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || ' staff read') then
      execute format('create policy %I on public.%I for select to authenticated using (public.inbox_staff_can_read(profile_id, ''inbox.view''))', t || ' staff read', t);
    end if;
  end loop;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'inbox_saved_replies' and policyname = 'inbox_saved_replies staff read') then
    create policy "inbox_saved_replies staff read" on public.inbox_saved_replies for select to authenticated
      using (public.inbox_staff_can_read(profile_id, 'inbox.saved_replies'));
  end if;
end $$;

commit;
