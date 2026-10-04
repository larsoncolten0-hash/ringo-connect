-- WhatsApp Inbox tools (Phase 8) — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Purely additive: ONE new table (owner-managed saved replies), its guard trigger, one RLS read policy and FOUR server-side functions.
-- No existing table, column, index, constraint, trigger, function or policy is modified; the Phase 4/7 objects are only READ or called.
-- Dropping everything below leaves no trace on anything that existed before.
--
--   NEW TABLE  inbox_saved_replies  (id, profile_id, title <=60, body <=4096, created_at, updated_at)
--       UNIQUE (profile_id, lower(title)); at most 50 per profile (enforced in the save function); CASCADE from the owning profile.
--       RLS: owner READ only (profiles.user_id = auth.uid(), reading only `profiles`: no recursion). No write policy, no write grant:
--       every write goes through the functions below, exactly like the Phase 4/7 inbox tables.
--   NEW FUNCTIONS (SECURITY DEFINER, search_path = public, pg_temp, EXECUTE for service_role only):
--       inbox_saved_reply_save(actor, profile, reply_id, title, body)   create (reply_id null) or update
--       inbox_saved_reply_delete(actor, profile, reply_id)              delete one saved reply
--       inbox_set_conversation_status(actor, conversation, status)      close / reopen ('closed' | 'open')
--
-- AUTHORIZATION (same model as Phase 7): the Next.js route passes the signed-in user as p_actor_user_id; the database re-derives
-- ownership itself and answers 'not_found' otherwise (a guessed id is indistinguishable from a missing one).
--   * saved replies: p_profile_id must be a profile OWNED by the actor that also owns a WhatsApp account (the same rule that admits a user
--     to the Inbox). A reply is only ever touched through (id, profile_id) of that profile.
--   * conversation status: conversation -> profile -> profiles.user_id = actor.
-- Nothing here accepts a recipient, phone number id, WABA id or token.
--
-- NOT touched, by design: unread_count (there is no read-state design yet, so "mark as read" is not implemented), provider status
-- semantics, messages, the 24-hour window, idempotency, ranking. Closing a conversation changes ONLY its status; a new inbound message
-- reopens it (existing Phase 4 behaviour). Nothing is ever deleted except a saved reply the owner deletes.
--
-- Depends on: 2026-12-07_whatsapp_inbox_foundation.sql (wa_accounts, inbox_conversations), profiles, gen_random_uuid().
-- Rollback: supabase/support/2026-12-09_whatsapp_inbox_tools.rollback.sql (DESTROYS saved replies; conversation statuses already changed stay).

begin;

-- ============================================================================
-- 1. TABLE
-- ============================================================================
create table if not exists public.inbox_saved_replies (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  body text not null check (char_length(body) between 1 and 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One title per profile (case-insensitive). Its leading profile_id column also serves "the saved replies of a profile".
create unique index if not exists inbox_saved_replies_title_idx on public.inbox_saved_replies (profile_id, lower(title));

create or replace function public.inbox_saved_replies_guard() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.profile_id <> old.profile_id or new.created_at <> old.created_at then
    raise exception 'inbox_saved_replies: identity columns are immutable';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists inbox_saved_replies_guard_trg on public.inbox_saved_replies;
create trigger inbox_saved_replies_guard_trg before update on public.inbox_saved_replies for each row execute function public.inbox_saved_replies_guard();

-- ============================================================================
-- 2. SAVE (create or update)
--    Returns jsonb { result: 'created' | 'updated' | 'not_found' | 'invalid' | 'duplicate_title' | 'limit_reached', id? }
-- ============================================================================
create or replace function public.inbox_saved_reply_save(p_actor_user_id uuid, p_profile_id uuid, p_reply_id uuid, p_title text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if p_actor_user_id is null or p_profile_id is null then return jsonb_build_object('result', 'invalid'); end if;

  -- Ownership, from the database: the profile belongs to the actor AND owns a WhatsApp account (it is an Inbox owner).
  perform 1 from public.profiles p
   where p.id = p_profile_id and p.user_id = p_actor_user_id
     and exists (select 1 from public.wa_accounts a where a.profile_id = p.id);
  if not found then return jsonb_build_object('result', 'not_found'); end if;

  if v_title = '' or char_length(v_title) > 60 or v_body = '' or char_length(v_body) > 4096 then
    return jsonb_build_object('result', 'invalid');
  end if;

  if p_reply_id is null then
    perform pg_advisory_xact_lock(hashtext('inbox_saved_replies:' || p_profile_id::text));   -- serialises the 50-reply limit per profile
    if (select count(*) from public.inbox_saved_replies r where r.profile_id = p_profile_id) >= 50 then
      return jsonb_build_object('result', 'limit_reached');
    end if;
    begin
      insert into public.inbox_saved_replies (profile_id, title, body) values (p_profile_id, v_title, v_body) returning id into v_id;
    exception when unique_violation then
      return jsonb_build_object('result', 'duplicate_title');
    end;
    return jsonb_build_object('result', 'created', 'id', v_id);
  end if;

  begin
    update public.inbox_saved_replies r set title = v_title, body = v_body
     where r.id = p_reply_id and r.profile_id = p_profile_id
    returning r.id into v_id;
  exception when unique_violation then
    return jsonb_build_object('result', 'duplicate_title');
  end;
  if v_id is null then return jsonb_build_object('result', 'not_found'); end if;
  return jsonb_build_object('result', 'updated', 'id', v_id);
end;
$$;

-- ============================================================================
-- 3. DELETE one saved reply.   Returns text: 'ok' | 'not_found' | 'invalid'
-- ============================================================================
create or replace function public.inbox_saved_reply_delete(p_actor_user_id uuid, p_profile_id uuid, p_reply_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_actor_user_id is null or p_profile_id is null or p_reply_id is null then return 'invalid'; end if;
  delete from public.inbox_saved_replies r
   using public.profiles p
   where r.id = p_reply_id and r.profile_id = p_profile_id and p.id = r.profile_id and p.user_id = p_actor_user_id;
  return case when found then 'ok' else 'not_found' end;
end;
$$;

-- ============================================================================
-- 4. CLOSE / REOPEN a conversation.   Returns text: 'ok' | 'noop' (already in that status) | 'not_found' | 'invalid'
--    Changes ONLY conversations.status. unread_count, timestamps, messages and provider statuses are untouched.
-- ============================================================================
create or replace function public.inbox_set_conversation_status(p_actor_user_id uuid, p_conversation_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current text;
begin
  if p_actor_user_id is null or p_conversation_id is null or p_status is null or p_status not in ('open', 'closed') then return 'invalid'; end if;

  select cv.status into v_current
    from public.inbox_conversations cv
    join public.profiles p on p.id = cv.profile_id
   where cv.id = p_conversation_id and p.user_id = p_actor_user_id;
  if not found then return 'not_found'; end if;
  if v_current = p_status then return 'noop'; end if;

  update public.inbox_conversations cv set status = p_status where cv.id = p_conversation_id;
  return 'ok';
end;
$$;

-- ============================================================================
-- 5. FUNCTION GRANTS (service_role only) AND TABLE RLS / PRIVILEGES (owner read only)
-- ============================================================================
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('inbox_saved_replies_guard', 'inbox_saved_reply_save', 'inbox_saved_reply_delete', 'inbox_set_conversation_status')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.name <> 'inbox_saved_replies_guard' then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end $$;

alter table public.inbox_saved_replies enable row level security;
revoke all on public.inbox_saved_replies from anon, authenticated, service_role;
grant select on public.inbox_saved_replies to authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'inbox_saved_replies' and policyname = 'inbox_saved_replies owner read') then
    create policy "inbox_saved_replies owner read" on public.inbox_saved_replies for select to authenticated
      using (exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = auth.uid()));
  end if;
end $$;

commit;
