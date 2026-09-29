-- Ringo Ambassador Program — private payout destinations. NOT YET RUN.
--
-- WHY: the foundation migration (2026-11-18) put payout_method/payout_details
-- on ambassador_profiles, whose RLS SELECT policy lets a Team Leader read every
-- column of their team's Ambassador rows. Team Leaders also had nowhere to
-- store a destination at all. This migration:
--   1. creates ambassador_payout_destinations — one CURRENT destination per
--      (user, role) — locked away from PostgREST entirely;
--   2. removes the obsolete, never-used ambassador_profiles columns (verified
--      unused by any application code before this migration was written);
--   3. stops payout owners from reading raw destinations through PostgREST via
--      ambassador_payouts (the payout row keeps a snapshot for audit; only
--      admins/service role may read it).
--
-- Access model: RLS is ENABLED on the new table with NO policies, and all table
-- privileges are revoked from anon/authenticated — ordinary PostgREST access is
-- impossible. Only the service-role server code (which resolves the caller's
-- identity from their session first) can read or write it. The browser only
-- ever receives masked_label.
--
-- 24-hour cooldown: changing an EXISTING destination stamps usable_after =
-- now() + 24h using DATABASE time (never client time). The new destination is
-- stored immediately but ambassador_request_payout() refuses to use it until
-- usable_after has passed. A first-ever destination has nothing to hijack, so
-- it is usable immediately. Re-saving an identical destination changes nothing
-- and never restarts the cooldown. Existing commission balances are untouched.
--
-- Audit: every change is logged to ambassador_admin_actions with the MASKED
-- label only — never the raw destination.
--
-- Depends on: 2026-11-18 (profiles/teams), 2026-11-19 (ambassador_log_action),
-- 2026-11-22 (ambassador_payouts).

-- ============================================================================
-- 1. MASKING — a display-only label (e.g. "MTN ••• 456"). Never reversible.
-- ============================================================================
create or replace function public.ambassador_mask_destination(p_method text, p_details jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_method
    when 'mobile_money' then upper(coalesce(p_details->>'provider', '')) || ' ••• ' || right(coalesce(p_details->>'phone', ''), 3)
    when 'bank' then coalesce(p_details->>'bankName', '') || ' ••• ' || right(coalesce(p_details->>'accountNumber', ''), 3)
    else '•••'
  end;
$$;

-- ============================================================================
-- 2. THE TABLE
-- ============================================================================
create table if not exists public.ambassador_payout_destinations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  recipient_type text not null check (recipient_type in ('ambassador', 'team_leader')),
  method text not null check (method in ('mobile_money', 'bank')),
  details jsonb not null check (jsonb_typeof(details) = 'object'),
  masked_label text not null,
  usable_after timestamptz not null default now(),
  change_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, recipient_type)
);

alter table public.ambassador_payout_destinations enable row level security;
-- Deliberately NO policy: with RLS on and nothing to match, anon/authenticated
-- get zero rows and zero writes. Belt and braces — also revoke the privileges.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.ambassador_payout_destinations from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.ambassador_payout_destinations from authenticated';
  end if;
end $$;

-- ============================================================================
-- 3. SET / CHANGE — the only write path. Service role only.
-- ============================================================================
create or replace function public.ambassador_set_payout_destination(
  p_user_id uuid,
  p_recipient_type text,
  p_method text,
  p_details jsonb,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_existing record;
  v_new_id uuid;
  v_masked text;
  v_usable timestamptz;
begin
  if p_recipient_type not in ('ambassador', 'team_leader')
     or p_method not in ('mobile_money', 'bank')
     or p_details is null or jsonb_typeof(p_details) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_destination');
  end if;

  -- The owner must actually hold the role they are setting a destination for.
  if p_recipient_type = 'ambassador' then
    if not exists (select 1 from public.ambassador_profiles where user_id = p_user_id and status <> 'suspended') then
      return jsonb_build_object('ok', false, 'reason', 'not_a_recipient');
    end if;
  else
    if not exists (select 1 from public.ambassador_teams where team_leader_user_id = p_user_id) then
      return jsonb_build_object('ok', false, 'reason', 'not_a_recipient');
    end if;
  end if;

  v_masked := public.ambassador_mask_destination(p_method, p_details);

  -- First-ever destination: usable immediately (nothing existing to hijack).
  insert into public.ambassador_payout_destinations (user_id, recipient_type, method, details, masked_label, usable_after)
  values (p_user_id, p_recipient_type, p_method, p_details, v_masked, now())
  on conflict (user_id, recipient_type) do nothing
  returning id into v_new_id;

  if v_new_id is not null then
    perform public.ambassador_log_action(p_actor_user_id, 'payout_destination_set', 'ambassador_payout_destinations', v_new_id, null,
      jsonb_build_object('masked', v_masked, 'method', p_method, 'recipient_type', p_recipient_type), null);
    return jsonb_build_object('ok', true, 'changed', true, 'first_time', true, 'masked', v_masked, 'usable_after', now());
  end if;

  select * into v_existing from public.ambassador_payout_destinations
  where user_id = p_user_id and recipient_type = p_recipient_type
  for update;

  -- Identical to what is already stored: no change, no cooldown restart.
  if v_existing.method = p_method and v_existing.details = p_details then
    return jsonb_build_object('ok', true, 'changed', false, 'first_time', false, 'masked', v_existing.masked_label, 'usable_after', v_existing.usable_after);
  end if;

  v_usable := now() + interval '24 hours';
  update public.ambassador_payout_destinations
  set method = p_method, details = p_details, masked_label = v_masked,
      usable_after = v_usable, change_count = change_count + 1, updated_at = now()
  where id = v_existing.id;

  perform public.ambassador_log_action(p_actor_user_id, 'payout_destination_changed', 'ambassador_payout_destinations', v_existing.id,
    jsonb_build_object('masked', v_existing.masked_label),
    jsonb_build_object('masked', v_masked, 'method', p_method, 'usable_after', v_usable), null);

  return jsonb_build_object('ok', true, 'changed', true, 'first_time', false, 'masked', v_masked, 'usable_after', v_usable);
end;
$$;

-- ============================================================================
-- 4. REMOVE THE OBSOLETE, LEAKY PROFILE COLUMNS (verified unused).
-- ============================================================================
alter table public.ambassador_profiles drop column if exists payout_method;
alter table public.ambassador_profiles drop column if exists payout_details;

-- ============================================================================
-- 5. PAYOUT SNAPSHOTS — admin-only read. Owners see their payouts through the
--    server (which returns only amount/status/dates), never raw destinations
--    straight from PostgREST.
-- ============================================================================
drop policy if exists "ambassador_payouts own or admin read" on public.ambassador_payouts;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ambassador_payouts' and policyname = 'ambassador_payouts admin read') then
    create policy "ambassador_payouts admin read" on public.ambassador_payouts for select using (is_admin());
  end if;
end $$;

-- ============================================================================
-- 6. FUNCTION PERMISSIONS — service-role only.
-- ============================================================================
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.ambassador_mask_destination(text, jsonb)',
    'public.ambassador_set_payout_destination(uuid, text, text, jsonb, uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;
