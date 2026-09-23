-- Ringo AI — atomic quota reservations (Phase 1 hardening).
-- Run this once in the Supabase SQL editor, AFTER 2026-10-25_ringo_ai_foundation.sql.
--
-- Problem it fixes: the chat route checked limits (ai_quota_snapshot) at the
-- start of a request but ai_usage_events is only written at the end, so N
-- simultaneous requests (tabs, devices, scripts) all saw the same remaining
-- quota and could collectively exceed the daily message limit, the monthly
-- user token limit and the global monthly budget.
--
-- Fix: before calling the model, the server RESERVES quota through
-- ai_reserve_quota(), which runs the existing limit checks under one
-- transaction-scoped advisory lock and counts every still-in-flight
-- reservation as if it were already used. Concurrent reservations therefore
-- queue on the lock and each one sees the ones admitted before it. When the
-- request ends (success, error, timeout or abort) the server writes the real
-- provider-reported usage to ai_usage_events as before and deletes its
-- reservation, so the final accounting is the actual usage, never the
-- estimate. A reservation whose request died without cleaning up expires
-- on its own (expires_at) and stops counting.
--
-- Purely additive: one NEW table and one NEW function. Touches no existing
-- table, column, constraint, trigger, policy or function — including the
-- Ringo AI foundation objects: ai_quota_snapshot() is CALLED, not changed,
-- so there is still exactly one definition of "used". Rollback:
-- supabase/support/2026-10-26_ringo_ai_quota_reservations.rollback.sql.

-- ============================================================================
-- 1. IN-FLIGHT RESERVATIONS
-- ============================================================================
create table if not exists public.ai_quota_reservations (
  id uuid primary key default gen_random_uuid(),
  -- Always the server-resolved caller (guard.ts), never client/model input.
  user_id uuid not null references public.users(id) on delete cascade,
  -- Upper-bound estimate for one request (all tool rounds); replaced by the
  -- real usage row when the request ends.
  reserved_tokens bigint not null check (reserved_tokens >= 0),
  -- null when pricing isn't configured (the budget isn't enforced then).
  reserved_cost_usd numeric(12,6) check (reserved_cost_usd is null or reserved_cost_usd >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);
create index if not exists ai_quota_reservations_user_idx on public.ai_quota_reservations (user_id, expires_at);
create index if not exists ai_quota_reservations_expires_idx on public.ai_quota_reservations (expires_at);

alter table public.ai_quota_reservations enable row level security;

-- Admin read only (support/debugging). No insert/update/delete policies:
-- every write goes through the server with the service-role client.
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ai_quota_reservations' and policyname = 'ai_quota_reservations admin read') then
    create policy "ai_quota_reservations admin read" on public.ai_quota_reservations for select using (is_admin());
  end if;
end $$;

-- ============================================================================
-- 2. ATOMIC CHECK-AND-RESERVE
-- ============================================================================
-- Same limit semantics as src/lib/ai/guard.ts checkAiQuota (a request is
-- refused once what's already used reaches the limit), except that
-- "already used" now also includes every other live reservation.
--
-- Returns exactly one row: reservation_id is set when the request may
-- proceed; otherwise deny_reason is 'daily_limit' | 'monthly_limit' |
-- 'budget_reached'. p_global_budget_usd = null means "don't enforce the
-- budget" (pricing not configured), matching the existing behaviour.
--
-- Concurrency: one global transaction-scoped advisory lock serializes the
-- check+insert (a few indexed aggregates — milliseconds). The global budget
-- is shared by every user, so a per-user lock alone would not protect it.
-- Under READ COMMITTED each statement after the lock takes a fresh snapshot,
-- so it sees every reservation committed by the previous lock holder.
create or replace function public.ai_reserve_quota(
  p_user_id uuid,
  p_daily_limit int,
  p_monthly_token_limit bigint,
  p_global_budget_usd numeric,
  p_reserve_tokens bigint,
  p_reserve_cost_usd numeric,
  p_ttl_seconds int
)
returns table (reservation_id uuid, deny_reason text, remaining_today int)
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_snap record;
  v_live_requests int;
  v_live_tokens bigint;
  v_live_cost numeric;
  v_used_today int;
  v_id uuid;
begin
  if p_user_id is null
     or p_daily_limit is null or p_daily_limit < 0
     or p_monthly_token_limit is null or p_monthly_token_limit < 0
     or (p_global_budget_usd is not null and p_global_budget_usd < 0)
     or p_reserve_tokens is null or p_reserve_tokens < 0
     or (p_reserve_cost_usd is not null and p_reserve_cost_usd < 0)
     or p_ttl_seconds is null or p_ttl_seconds not between 1 and 600 then
    raise exception 'ai_reserve_quota: invalid arguments' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ringo_ai_quota', 0));

  -- Reservations of requests that died without releasing stop counting.
  delete from public.ai_quota_reservations where expires_at <= now();

  -- Completed usage: the one existing definition (foundation migration).
  select * into v_snap from public.ai_quota_snapshot(p_user_id);

  select count(*)::int, coalesce(sum(r.reserved_tokens), 0)::bigint
    into v_live_requests, v_live_tokens
    from public.ai_quota_reservations r
   where r.user_id = p_user_id;

  select coalesce(sum(r.reserved_cost_usd), 0)::numeric
    into v_live_cost
    from public.ai_quota_reservations r;

  v_used_today := coalesce(v_snap.user_requests_24h, 0) + v_live_requests;

  if v_used_today >= p_daily_limit then
    return query select null::uuid, 'daily_limit'::text, 0;
    return;
  end if;

  if coalesce(v_snap.user_tokens_month, 0) + v_live_tokens >= p_monthly_token_limit then
    return query select null::uuid, 'monthly_limit'::text, p_daily_limit - v_used_today;
    return;
  end if;

  if p_global_budget_usd is not null and coalesce(v_snap.global_cost_month, 0) + v_live_cost >= p_global_budget_usd then
    return query select null::uuid, 'budget_reached'::text, p_daily_limit - v_used_today;
    return;
  end if;

  insert into public.ai_quota_reservations (user_id, reserved_tokens, reserved_cost_usd, expires_at)
  values (p_user_id, p_reserve_tokens, p_reserve_cost_usd, now() + make_interval(secs => p_ttl_seconds))
  returning id into v_id;

  return query select v_id, null::text, greatest(0, p_daily_limit - v_used_today - 1);
end;
$$;

-- Service-role only, like ai_quota_snapshot: a signed-in user must not be
-- able to reserve (or probe) quota for an arbitrary user id.
revoke all on function public.ai_reserve_quota(uuid, int, bigint, numeric, bigint, numeric, int) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ai_reserve_quota(uuid, int, bigint, numeric, bigint, numeric, int) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.ai_reserve_quota(uuid, int, bigint, numeric, bigint, numeric, int) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ai_reserve_quota(uuid, int, bigint, numeric, bigint, numeric, int) to service_role';
  end if;
end $$;
