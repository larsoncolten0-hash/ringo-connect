-- WhatsApp Inbox: mark a conversation as read — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Purely additive: ONE new server-side function. No table, column, index, constraint, trigger, policy or existing function is created, altered
-- or dropped, and no row is touched when this file is applied.
--
--   NEW FUNCTION  inbox_mark_conversation_read(p_actor_user_id, p_conversation_id) returns text
--                 SECURITY DEFINER, search_path = public, pg_temp, EXECUTE for service_role only (revoked from public, anon, authenticated).
--
-- WHY: inbox_conversations.unread_count is incremented by every inbound message (Phase 4 ingestion) and, until now, nothing ever cleared it, so
-- the Inbox badge could never go back to 0 (Phase 8 documented that "mark as read" was not implemented).
--
-- AUTHORIZATION (same model as inbox_set_conversation_status): the Next.js route passes the signed-in user as p_actor_user_id; the database
-- re-derives ownership itself (conversation -> profile -> profiles.user_id = actor) and answers 'not_found' otherwise, so another owner's
-- conversation is indistinguishable from a missing one. Nothing here accepts a profile id, recipient, phone number id, WABA id, token or URL.
--
-- EFFECT: sets inbox_conversations.unread_count = 0 and NOTHING else (no message, status, last_*_at, identity column or provider status is
-- written). The table's existing guard trigger maintains updated_at on any update; that is the only other column that changes. Idempotent:
-- when the count is already 0 no row is written at all.
-- Returns text: 'ok' (cleared) | 'noop' (already read) | 'not_found' | 'invalid'.
--
-- NOT touched: ingestion (a new inbound message still adds 1), close / reopen (still never changes unread_count), outbound replies (a reply still
-- does not clear it), the 24-hour window, ranking, automation, notifications, media, AI.
--
-- Depends on: 2026-12-07_whatsapp_inbox_foundation.sql (inbox_conversations, its guard trigger), profiles.
-- Rollback: supabase/support/2026-12-12_whatsapp_inbox_mark_read.rollback.sql (drops the function; counts already cleared stay cleared).

begin;

create or replace function public.inbox_mark_conversation_read(p_actor_user_id uuid, p_conversation_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_unread integer;
begin
  if p_actor_user_id is null or p_conversation_id is null then return 'invalid'; end if;

  select cv.unread_count into v_unread
    from public.inbox_conversations cv
    join public.profiles p on p.id = cv.profile_id
   where cv.id = p_conversation_id and p.user_id = p_actor_user_id;
  if not found then return 'not_found'; end if;
  if v_unread = 0 then return 'noop'; end if;

  update public.inbox_conversations cv set unread_count = 0 where cv.id = p_conversation_id;
  return 'ok';
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('inbox_mark_conversation_read')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

commit;
