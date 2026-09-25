-- Shop seller payouts. A close structural mirror of the existing music payout system
-- (2026-09-20_music_payments.sql: music_payouts / music_sale_earnings / request_music_payout()),
-- same shape, same reasoning, just against commerce_sale_earnings (Increment 5A) instead of
-- music_sale_earnings. commerce_payouts reuses users.affiliate_payout_method/
-- affiliate_payout_details as the payout destination, exactly like music_payouts already does —
-- one creator, one payout destination, for every kind of Ringo earnings. Shop is XAF-only (the
-- same SUPPORTED_CURRENCY gate every checkout eligibility check already enforces), so unlike
-- music this has no USD branch at all.
--
-- commerce_sale_earnings (5A) remains the ONLY earnings ledger — no second ledger is created.
-- Two new nullable columns are added to it (available_at, payout_id), and its existing status
-- CHECK is widened from ('recorded','reversed') to also allow 'requested'/'paid'. Neither change
-- touches the existing commerce_sale_earnings_guard trigger (it already only restricts a fixed
-- list of columns and always allowed `status` to change) or anything settlement.ts writes today
-- — settlement.ts's insertEarning() call is untouched and keeps working unmodified, because the
-- new available_at column is filled in by a BEFORE INSERT trigger below, not by the application.
--
-- Additive/idempotent throughout, same convention as every migration since 2026-09-12.

-- ============================================================================
-- 1. PLATFORM SETTINGS — Shop payout policy (mirrors music_payout_hold_days / music_min_payout_xaf).
--    commerce_enabled / commerce_commission_rate already exist (see the Commerce Admin Settings
--    increment) and are untouched here.
-- ============================================================================
alter table platform_settings add column if not exists commerce_payout_hold_days int not null default 3;
alter table platform_settings add column if not exists commerce_min_payout_xaf numeric(10,2) not null default 5000;

-- ============================================================================
-- 2. PAYOUTS (must exist before the FK on commerce_sale_earnings.payout_id)
-- ============================================================================
create table if not exists commerce_payouts (
  id uuid primary key default gen_random_uuid(),
  creator_user_id uuid not null references public.users(id) on delete cascade,
  amount numeric(12,2) not null,
  currency text not null,
  status text not null default 'requested' check (status in ('requested', 'processing', 'paid', 'rejected')),
  payout_method text,
  payout_details jsonb,          -- snapshot of the destination at request time
  admin_note text,
  fapshi_trans_id text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references public.users(id)
);
create index if not exists commerce_payouts_creator_user_id_idx on commerce_payouts (creator_user_id, status);
create index if not exists commerce_payouts_status_idx on commerce_payouts (status, requested_at);

-- ============================================================================
-- 3. commerce_sale_earnings ADDITIONS — payout tracking/availability only. gross_amount,
--    commission_rate, platform_fee, net_amount, currency and every other existing column are
--    untouched; the existing "only status may change" guard trigger is untouched too (payout_id
--    and available_at were never in its checked list, so updating them was never blocked by it —
--    no trigger function edit needed).
-- ============================================================================
alter table commerce_sale_earnings add column if not exists available_at timestamptz;
alter table commerce_sale_earnings add column if not exists payout_id uuid references commerce_payouts(id) on delete set null;
create index if not exists commerce_sale_earnings_payout_id_idx on commerce_sale_earnings (payout_id);

-- Existing rows recorded before this migration get no retroactive hold — they become
-- immediately eligible (available_at = their own created_at, already in the past) rather than
-- being stuck with a NULL available_at the payout RPC's "available_at <= now()" could never satisfy.
update commerce_sale_earnings set available_at = created_at where available_at is null;

-- New rows: filled in automatically from the CURRENT commerce_payout_hold_days setting at the
-- moment of insert (never by the application) — this is the one and only reason settlement.ts's
-- existing insertEarning() call, which never mentions available_at, keeps working unmodified.
create or replace function commerce_sale_earnings_set_available_at() returns trigger language plpgsql as $$
declare
  v_hold_days int;
begin
  if new.available_at is null then
    select coalesce(commerce_payout_hold_days, 0) into v_hold_days from platform_settings limit 1;
    new.available_at := new.created_at + (coalesce(v_hold_days, 0) || ' days')::interval;
  end if;
  return new;
end $$;
drop trigger if exists commerce_sale_earnings_set_available_at_trg on commerce_sale_earnings;
create trigger commerce_sale_earnings_set_available_at_trg before insert on commerce_sale_earnings
  for each row execute function commerce_sale_earnings_set_available_at();

-- Widen the existing status CHECK to add 'requested'/'paid' alongside the existing
-- 'recorded'/'reversed' — 'recorded' stays the default and its existing meaning is unchanged;
-- every existing reader (sellerOrders.ts's summariseEarnings()) already only special-cases
-- 'reversed' and sums everything else, so 'requested'/'paid' earnings keep counting correctly
-- toward the existing lifetime gross/commission/net stat cards with no code change there.
alter table commerce_sale_earnings drop constraint if exists commerce_sale_earnings_status_check;
alter table commerce_sale_earnings add constraint commerce_sale_earnings_status_check
  check (status in ('recorded', 'requested', 'paid', 'reversed'));

-- ============================================================================
-- 4. PAYOUT REQUEST — callable by the seller themselves. Stronger than
--    request_music_payout()/request_affiliate_payout()'s own "sum, then insert, then
--    UPDATE ... WHERE payout_id is null" shape (which those two rely on purely for "an earning
--    can never be linked to two payouts" — still true there, via UPDATE's own row-lock re-check —
--    but leaves a narrow window where a losing concurrent call can still INSERT a payout row
--    before its own UPDATE discovers it claimed nothing, so that row's `amount` would not match
--    any earnings actually linked to it).
--
--    Here the eligible rows are locked FIRST, with `for update` inside a CTE, before anything is
--    summed or inserted. Postgres re-checks a `for update` row's qualifying WHERE clause once the
--    lock is actually acquired (the same re-check UPDATE itself relies on) — so a second,
--    concurrent call to this function blocks on the SAME rows the first call is holding, and once
--    the first call commits, the second call's lock attempt resumes and finds NONE of those rows
--    still match `payout_id is null` any more. Its locked set is then genuinely empty, v_available
--    is 0, and it raises the same "below minimum" exception BEFORE ever inserting a payout row —
--    never after. The payout is then linked by the EXACT id list that was locked and summed
--    (`where id = any(v_ids)`), not by re-running the WHERE clause a second time, so the row this
--    function returns and the earnings it claims can never drift apart.
--
--    No currency parameter: Shop orders are XAF-only today (the same SUPPORTED_CURRENCY gate
--    checkCommerceEligibility already enforces), so there is no second-currency branch to carry.
--    Does not touch request_music_payout()/request_affiliate_payout() — those keep their existing
--    shape unchanged.
-- ============================================================================
create or replace function request_commerce_payout()
returns commerce_payouts as $$
declare
  v_user_id uuid := auth.uid();
  v_method text;
  v_details jsonb;
  v_available numeric(12,2);
  v_min numeric(10,2);
  v_payout commerce_payouts;
  v_ids uuid[];
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select affiliate_payout_method, affiliate_payout_details
  into v_method, v_details
  from public.users where id = v_user_id;

  if v_method is null then
    raise exception 'Add a payout method before requesting a payout.';
  end if;

  -- Lock the exact candidate rows before computing anything from them (a plain aggregate query
  -- cannot itself carry FOR UPDATE, hence locking inside this CTE and aggregating over it after).
  with locked as (
    select id, net_amount
    from commerce_sale_earnings
    where creator_user_id = v_user_id
      and currency = 'XAF'
      and status = 'recorded'
      and payout_id is null
      and available_at <= now()
    for update
  )
  select coalesce(array_agg(id), '{}'), coalesce(sum(net_amount), 0)
  into v_ids, v_available
  from locked;

  select commerce_min_payout_xaf into v_min from platform_settings limit 1;

  if v_available <= 0 or v_available < coalesce(v_min, 0) then
    raise exception 'Your available balance (% XAF) is below the XAF minimum payout of % XAF.',
      v_available, coalesce(v_min, 0);
  end if;

  insert into commerce_payouts (creator_user_id, amount, currency, status, payout_method, payout_details)
  values (v_user_id, v_available, 'XAF', 'requested', v_method, v_details)
  returning * into v_payout;

  -- The SAME locked id list, not a fresh WHERE-based re-select — the payout's amount and its
  -- linked earnings are therefore always exactly the same set, by construction.
  update commerce_sale_earnings
  set status = 'requested', payout_id = v_payout.id
  where id = any(v_ids);

  return v_payout;
end;
$$ language plpgsql security definer;

-- ============================================================================
-- ROW LEVEL SECURITY — owner/admin only, no anon policy. Mirrors music_payouts exactly: RLS
-- enable + policies only, no explicit grant/revoke (this project's existing default table grants
-- already cover authenticated/anon the same way they already do for music_payouts).
-- ============================================================================
alter table commerce_payouts enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'commerce_payouts' and policyname = 'commerce_payouts read own') then
    create policy "commerce_payouts read own" on commerce_payouts for select using (auth.uid() = creator_user_id or is_admin());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'commerce_payouts' and policyname = 'commerce_payouts admin write') then
    create policy "commerce_payouts admin write" on commerce_payouts for update using (is_admin());
  end if;
end $$;

-- Rollback notes (manual, not executed):
--   drop function if exists request_commerce_payout();
--   drop trigger if exists commerce_sale_earnings_set_available_at_trg on commerce_sale_earnings;
--   drop function if exists commerce_sale_earnings_set_available_at();
--   alter table commerce_sale_earnings drop constraint if exists commerce_sale_earnings_status_check;
--   alter table commerce_sale_earnings add constraint commerce_sale_earnings_status_check check (status in ('recorded','reversed'));
--   alter table commerce_sale_earnings drop column if exists payout_id;
--   alter table commerce_sale_earnings drop column if exists available_at;
--   drop table if exists commerce_payouts;
