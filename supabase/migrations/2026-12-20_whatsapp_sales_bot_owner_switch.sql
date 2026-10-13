-- WhatsApp Smart Card sales bot: the account OWNER's ON/OFF switch — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Purely additive: TWO new tables and THREE new server-side functions. No existing table, column, index, constraint, trigger, policy or function is created,
-- altered, replaced or dropped (2026-12-19_whatsapp_sales_bot.sql is untouched), and no row is written when this file is applied. Every account starts with the bot OFF.
--
--   NEW TABLE  wa_sales_settings      one row per owner profile that has ever saved the switch: enabled (default false), who saved it last and when.
--   NEW TABLE  wa_sales_settings_log  append-only audit trail: one row per CHANGE of the switch (profile, the signed-in actor, the new value, when).
--       Both: row level security ON, no policy, no grant for anon / authenticated / service_role. Only the SECURITY DEFINER functions below touch them.
--   NEW FUNCTIONS (SECURITY DEFINER, search_path = public, pg_temp, EXECUTE for service_role only):
--       wa_sales_enabled(phone_number_id)                 the bot's gate, asked BEFORE it claims or answers any message: true only for an active WhatsApp account whose
--                                                         owner switched the bot ON. No row, or an unknown or disabled account, = false; the caller also treats any error as OFF (the bot stays silent).
--       wa_sales_settings_get(actor, profile)             the owner's current switch, for the settings page. Ownership is re-derived from the actor.
--       wa_sales_settings_set(actor, profile, enabled)    the owner flips the switch; records a log row when the value actually changes.
--
-- WHAT THIS DOES NOT DO: it never touches a conversation, an order, a payment, a message or a notification. Switching the bot OFF only means the bot stops sending its own
-- conversational replies; inbound storage, push, hand-off, payments and the paid-order confirmation are unaffected. It accepts no owner or profile from the browser:
-- the Next.js route passes the session's user and profile and the database checks that the profile belongs to that user and has a WhatsApp account.
-- The WHATSAPP_SALES_BOT_PHONE_NUMBER_ID environment gate is NOT replaced: the bot answers only when that gate matches AND this switch is on.
--
-- Depends on: 2026-12-07_whatsapp_inbox_foundation.sql (wa_accounts), profiles.
-- Rollback: supabase/support/2026-12-20_whatsapp_sales_bot_owner_switch.rollback.sql (drops the three functions and the two tables).

begin;

create table if not exists public.wa_sales_settings (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  enabled boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.wa_sales_settings_log (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  actor_user_id uuid not null,
  enabled boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists wa_sales_settings_log_profile_idx on public.wa_sales_settings_log (profile_id, created_at desc);

-- 1. THE BOT'S GATE.  Returns boolean (never null, never raises for a bad key).
create or replace function public.wa_sales_enabled(p_phone_number_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select s.enabled
      from public.wa_accounts a
      join public.wa_sales_settings s on s.profile_id = a.profile_id
     where a.phone_number_id = p_phone_number_id and a.status = 'active'
     limit 1
  ), false);
$$;

-- 2. THE OWNER READS THE SWITCH.  Returns jsonb { result: 'ok', enabled } | { result: 'not_found' }
--    The profile must belong to the actor AND have a WhatsApp account; anything else is indistinguishable from a missing profile.
create or replace function public.wa_sales_settings_get(p_actor_user_id uuid, p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_enabled boolean;
begin
  if p_actor_user_id is null or p_profile_id is null then return jsonb_build_object('result', 'not_found'); end if;
  perform 1 from public.profiles p
    where p.id = p_profile_id and p.user_id = p_actor_user_id
      and exists (select 1 from public.wa_accounts a where a.profile_id = p.id);
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  select s.enabled into v_enabled from public.wa_sales_settings s where s.profile_id = p_profile_id;
  return jsonb_build_object('result', 'ok', 'enabled', coalesce(v_enabled, false));
end;
$$;

-- 3. THE OWNER FLIPS THE SWITCH.   Returns text: 'ok' | 'noop' (same value already saved) | 'not_found' | 'invalid'
create or replace function public.wa_sales_settings_set(p_actor_user_id uuid, p_profile_id uuid, p_enabled boolean)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current boolean;
begin
  if p_actor_user_id is null or p_profile_id is null or p_enabled is null then return 'invalid'; end if;
  perform 1 from public.profiles p
    where p.id = p_profile_id and p.user_id = p_actor_user_id
      and exists (select 1 from public.wa_accounts a where a.profile_id = p.id);
  if not found then return 'not_found'; end if;

  select s.enabled into v_current from public.wa_sales_settings s where s.profile_id = p_profile_id for update;
  if found and v_current = p_enabled then return 'noop'; end if;
  if not found and p_enabled = false then return 'noop'; end if;

  insert into public.wa_sales_settings (profile_id, enabled, updated_by, updated_at) values (p_profile_id, p_enabled, p_actor_user_id, now())
  on conflict (profile_id) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.wa_sales_settings_log (profile_id, actor_user_id, enabled) values (p_profile_id, p_actor_user_id, p_enabled);
  return 'ok';
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('wa_sales_enabled', 'wa_sales_settings_get', 'wa_sales_settings_set')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

alter table public.wa_sales_settings enable row level security;
alter table public.wa_sales_settings_log enable row level security;
revoke all on public.wa_sales_settings, public.wa_sales_settings_log from anon, authenticated, service_role;

commit;
