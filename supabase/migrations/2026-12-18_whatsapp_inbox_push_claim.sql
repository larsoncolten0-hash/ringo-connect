-- WhatsApp Inbox push notifications: per-conversation 60-second throttle — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Purely additive: ONE new tiny table and ONE new server-side function. No existing table, column, index, constraint, trigger, policy or function
-- is created, altered or dropped (inbox_automation_inbound is only mirrored, never changed), and no row is touched when this file is applied.
--
--   NEW TABLE     inbox_push_throttle   one row per conversation: when a push notification was last claimed for it.
--                                       RLS on, no policy, no grant: only the SECURITY DEFINER function below ever touches it.
--   NEW FUNCTION  inbox_push_claim(p_phone_number_id, p_provider_message_id) returns jsonb
--                 SECURITY DEFINER, search_path = public, pg_temp, EXECUTE for service_role only (revoked from public, anon, authenticated).
--
-- WHY: inbox_automation_inbound only reports notify_new for the FIRST message of a brand-new conversation (the state row was just created AND the
-- conversation is under 2 minutes old), so later messages never produced a notification. The webhook now calls this function after every NEW inbound
-- message is stored; it answers who to notify and whether a push is due, at most ONE per conversation per 60 seconds.
--
-- THROTTLE: one atomic statement (insert ... on conflict do update ... where last_push_at <= now() - 60 seconds). Two concurrent webhook deliveries
-- can never both pass. Only the PUSH is throttled: every message is still stored by ingestion, and the Inbox shows all of them.
--
-- OWNERSHIP: the owner is derived here from phone_number_id -> wa_accounts -> profiles.user_id, exactly as inbox_automation_inbound does. Nothing
-- from the request is trusted as an owner, and no message text, name or number is read or returned.
-- Returns jsonb { result: 'skip' } (unknown or disabled account, unknown message, no owner), { result: 'throttled' } (a push went out within the
-- last 60 seconds) or { result: 'ok', conversation_id, owner_user_id, locale }.
--
-- Depends on: 2026-12-07_whatsapp_inbox_foundation.sql (wa_accounts, inbox_conversations, inbox_messages), 2026-12-11_whatsapp_inbox_automation.sql
-- (inbox_settings.notification_locale, read only), profiles.
-- Rollback: supabase/support/2026-12-18_whatsapp_inbox_push_claim.rollback.sql (drops the function and the table; only throttle timestamps are lost).

begin;

create table if not exists public.inbox_push_throttle (
  conversation_id uuid primary key,
  profile_id uuid not null,
  last_push_at timestamptz not null default now(),
  foreign key (profile_id, conversation_id) references public.inbox_conversations (profile_id, id) on delete cascade
);

create or replace function public.inbox_push_claim(p_phone_number_id text, p_provider_message_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acct public.wa_accounts%rowtype;
  v_msg public.inbox_messages%rowtype;
  v_owner uuid;
  v_locale text;
  v_claimed uuid;
begin
  if p_phone_number_id is null or p_provider_message_id is null then return jsonb_build_object('result', 'skip'); end if;

  select * into v_acct from public.wa_accounts a where a.phone_number_id = p_phone_number_id;
  if not found or v_acct.status <> 'active' then return jsonb_build_object('result', 'skip'); end if;

  select * into v_msg from public.inbox_messages m
   where m.profile_id = v_acct.profile_id and m.provider_message_id = p_provider_message_id and m.direction = 'inbound';
  if not found then return jsonb_build_object('result', 'skip'); end if;

  perform 1 from public.inbox_conversations cv where cv.id = v_msg.conversation_id and cv.profile_id = v_acct.profile_id;
  if not found then return jsonb_build_object('result', 'skip'); end if;

  select p.user_id into v_owner from public.profiles p where p.id = v_acct.profile_id;
  if v_owner is null then return jsonb_build_object('result', 'skip'); end if;

  insert into public.inbox_push_throttle as t (conversation_id, profile_id, last_push_at)
  values (v_msg.conversation_id, v_acct.profile_id, now())
  on conflict (conversation_id) do update set last_push_at = now()
   where t.last_push_at <= now() - interval '60 seconds'
  returning t.conversation_id into v_claimed;
  if v_claimed is null then return jsonb_build_object('result', 'throttled'); end if;

  select coalesce((select s.notification_locale from public.inbox_settings s where s.profile_id = v_acct.profile_id), 'fr') into v_locale;
  return jsonb_build_object('result', 'ok', 'conversation_id', v_msg.conversation_id, 'owner_user_id', v_owner, 'locale', v_locale);
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('inbox_push_claim')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

alter table public.inbox_push_throttle enable row level security;
revoke all on public.inbox_push_throttle from anon, authenticated, service_role;

commit;
