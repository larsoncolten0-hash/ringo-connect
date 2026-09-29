-- Ringo Ambassador & Team Leader Program — foundation (Ambassadors, Teams).
-- NOT YET RUN. Purely additive: two new tables, no existing table/column/
-- policy/function touched.
--
-- Deliberately separate from the legacy affiliate system
-- (2026-09-06_affiliate_system.sql and its follow-ups): that system is
-- single-tier (one flat referred_by/affiliate_code per user, one flat
-- commission_rate) and is proven, via direct code audit, to already be
-- wired into other product surfaces (payment_transactions triggers,
-- signup_requests.referral_code driving reviewer routing). The Ambassador
-- program's two-tier (Ambassador + Team Leader), two-milestone,
-- per-sale-percentage-split model cannot be expressed by that schema
-- without corrupting its existing single-tier semantics — see the
-- Ambassador Program audit for the full reasoning. Nothing in this
-- migration (or the ones that follow it) reads, writes, or alters
-- affiliate_code, referred_by, affiliate_commissions, affiliate_payouts,
-- platform_settings.affiliate_*, users.affiliate_payout_method/details, or
-- the payment_transactions commission trigger.
--
-- Write posture mirrors the AI foundation tables and the Content Calendar
-- tables (ai_conversations, content_calendar_plans/items): RLS is
-- SELECT-only. There are deliberately no insert/update/delete policies for
-- `authenticated` anywhere in the Ambassador program's schema — every
-- write happens server-side (service-role client) after the caller's
-- identity/ownership has already been resolved from their own session.
--
-- Identity-anchoring foreign keys (user_id, team_leader_user_id) use
-- `on delete restrict`, not cascade: this codebase's own convention is to
-- deactivate people (affiliate_suspended, is_demo, can_approve_requests —
-- boolean status flags, never a hard DELETE on `users`), so a person who
-- carries live commission history should never be silently cascade-deleted
-- out from under that history. Deactivation here is `status = 'inactive'`,
-- exactly like every comparable flag elsewhere in this codebase.

-- ============================================================================
-- 1. TEAMS — one row per Team Leader.
-- ============================================================================
create table if not exists public.ambassador_teams (
  id uuid primary key default gen_random_uuid(),
  team_leader_user_id uuid not null unique references public.users(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 80),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 2. AMBASSADORS — one row per Ambassador.
-- ============================================================================
create table if not exists public.ambassador_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete restrict,
  team_id uuid references public.ambassador_teams(id) on delete set null,
  -- Own generator, own column — never touches users.affiliate_code. See
  -- the trigger below for the generation algorithm (mirrors
  -- set_affiliate_code()'s shape: short random code, collision-retried,
  -- long fallback if that ever fails — but writes to sales_code, not
  -- affiliate_code, and is triggered by this table's own insert, not by
  -- any change to `users`).
  sales_code text not null unique check (char_length(sales_code) between 4 and 20),
  status text not null default 'active' check (status in ('active', 'inactive', 'suspended')),
  -- Per the approved decision: Ambassador payout destination data is fully
  -- separate from users.affiliate_payout_method/affiliate_payout_details —
  -- the legacy affiliate program's financial records are never touched or
  -- reused here.
  payout_method text check (payout_method is null or payout_method in ('mobile_money', 'bank')),
  payout_details jsonb,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz,
  created_by uuid references public.users(id) on delete set null
);
create index if not exists ambassador_profiles_team_idx on public.ambassador_profiles (team_id);
create index if not exists ambassador_profiles_status_idx on public.ambassador_profiles (status);

-- ============================================================================
-- 3. sales_code GENERATION — mirrors set_affiliate_code()'s own approach
--    (short random code, collision-checked, upper-cased) without touching
--    that function or its table at all.
-- ============================================================================
create or replace function public.set_ambassador_sales_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate text;
  attempts int := 0;
begin
  if new.sales_code is not null and new.sales_code <> '' then
    new.sales_code := upper(new.sales_code);
    return new;
  end if;

  loop
    attempts := attempts + 1;
    -- 7 chars from a hex digest, upper-cased — short enough to read off a
    -- shared link, long enough that collisions are rare; the retry loop
    -- (and the eventual full-id fallback) makes correctness independent of
    -- how rare "rare" actually is.
    candidate := upper(substr(md5(gen_random_uuid()::text), 1, 7));
    if attempts > 20 then
      -- Exhausted short-code attempts — fall back to the row's own id,
      -- guaranteed unique, same "never fail the insert" reasoning
      -- set_affiliate_code() uses for its own fallback path.
      candidate := upper(replace(gen_random_uuid()::text, '-', ''));
    end if;
    exit when not exists (select 1 from public.ambassador_profiles where sales_code = candidate);
    exit when attempts > 25;
  end loop;

  new.sales_code := candidate;
  return new;
end;
$$;

drop trigger if exists ambassador_profiles_set_sales_code on public.ambassador_profiles;
create trigger ambassador_profiles_set_sales_code
  before insert on public.ambassador_profiles
  for each row execute function public.set_ambassador_sales_code();

-- ============================================================================
-- 4. ROW LEVEL SECURITY — read-only for the owner / their team leader /
--    admin. No write policy for `authenticated` anywhere.
-- ============================================================================
alter table public.ambassador_teams enable row level security;
alter table public.ambassador_profiles enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ambassador_teams' and policyname = 'ambassador_teams own or admin read') then
    create policy "ambassador_teams own or admin read" on public.ambassador_teams for select using (
      team_leader_user_id = auth.uid()
      or is_admin()
      or exists (select 1 from public.ambassador_profiles p where p.user_id = auth.uid() and p.team_id = ambassador_teams.id)
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'ambassador_profiles' and policyname = 'ambassador_profiles own or admin read') then
    create policy "ambassador_profiles own or admin read" on public.ambassador_profiles for select using (
      user_id = auth.uid()
      or is_admin()
      or exists (select 1 from public.ambassador_teams t where t.team_leader_user_id = auth.uid() and t.id = ambassador_profiles.team_id)
    );
  end if;
end $$;
