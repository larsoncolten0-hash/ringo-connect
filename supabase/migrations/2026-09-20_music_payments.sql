-- Automatic, verified music payments + artist payouts.
--
-- Design notes:
--
-- * Mobile Money checkout for music now collects a REAL Fapshi charge (see
--   /api/music/orders/[id]/pay + pay-status), rather than the declared-only
--   "artist marks it paid by hand" model cash/card orders still use. That
--   charge lands in Ringo Connect's own Fapshi account (the only kind of
--   Fapshi account this codebase has ever had — see platform_settings) —
--   so unlike a cash/card sale, where the artist already holds the money
--   directly and Ringo Connect is never involved, an automatically-
--   collected mobile money sale means Ringo Connect now owes the artist
--   their share. That's what music_sale_earnings/music_payouts exist for.
--
-- * This is a close structural mirror of the existing affiliate payout
--   system (2026-09-06_affiliate_system.sql: affiliate_commissions /
--   affiliate_payouts / request_affiliate_payout()) — same shape, same
--   reasoning, just a different source of money owed. music_payouts reuses
--   users.affiliate_payout_method/affiliate_payout_details as the payout
--   destination rather than duplicating a second "how do we pay you" field
--   — one creator, one payout destination, for every kind of Ringo
--   earnings.
--
-- * The earnings ledger is created in EXACTLY ONE place — the Fapshi
--   pay-status confirmation route — never by a generic trigger on
--   music_orders.payment_status. That's deliberate: a cash/card order
--   marked paid by the artist must never create a "Ringo owes you 90%"
--   entry, because Ringo never touched that money.
--
-- Additive/idempotent throughout, same reasoning as every migration since
-- 2026-09-12.

-- ============================================================================
-- 1. FAPSHI COLLECTION TRACKING ON MUSIC ORDERS
-- ============================================================================
alter table music_orders add column if not exists pending_fapshi_trans_id text;

-- ============================================================================
-- 2. PLATFORM SETTINGS — music payout policy (not secret, same table as
--    the rest of platform_settings, alongside the affiliate_* fields it
--    already carries)
-- ============================================================================
alter table platform_settings add column if not exists music_commission_rate numeric(5,4) not null default 0.1000;
alter table platform_settings add column if not exists music_payout_hold_days int not null default 3;
alter table platform_settings add column if not exists music_min_payout_xaf numeric(10,2) not null default 5000;

-- ============================================================================
-- 3. PAYOUTS (must exist before earnings, which reference it)
-- ============================================================================
create table if not exists music_payouts (
  id uuid primary key default gen_random_uuid(),
  artist_user_id uuid not null references public.users(id) on delete cascade,
  amount numeric(10,2) not null,
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
create index if not exists music_payouts_artist_user_id_idx on music_payouts (artist_user_id, status);
create index if not exists music_payouts_status_idx on music_payouts (status, requested_at);

-- ============================================================================
-- 4. SALE EARNINGS
-- ============================================================================
create table if not exists music_sale_earnings (
  id uuid primary key default gen_random_uuid(),
  artist_user_id uuid not null references public.users(id) on delete cascade,
  order_id uuid not null unique references music_orders(id) on delete cascade,
  gross_amount numeric(10,2) not null,
  commission_rate numeric(5,4) not null,   -- snapshotted at time of sale
  platform_fee numeric(10,2) not null,
  artist_amount numeric(10,2) not null,    -- gross_amount - platform_fee; what the artist actually earns
  currency text not null,
  status text not null default 'pending' check (status in ('pending', 'requested', 'paid', 'reversed')),
  available_at timestamptz not null,       -- now() + music_payout_hold_days at creation time
  payout_id uuid references music_payouts(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists music_sale_earnings_artist_user_id_idx on music_sale_earnings (artist_user_id, status);
create index if not exists music_sale_earnings_payout_id_idx on music_sale_earnings (payout_id);

-- ============================================================================
-- 5. PAYOUT REQUEST — atomic sum + lock, callable by the artist themselves.
--    Near-verbatim copy of request_affiliate_payout().
-- ============================================================================
create or replace function request_music_payout(p_currency text)
returns music_payouts as $$
declare
  v_user_id uuid := auth.uid();
  v_method text;
  v_details jsonb;
  v_available numeric(10,2);
  v_min numeric(10,2);
  v_payout music_payouts;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  p_currency := upper(trim(p_currency));

  select affiliate_payout_method, affiliate_payout_details
  into v_method, v_details
  from public.users where id = v_user_id;

  if v_method is null then
    raise exception 'Add a payout method before requesting a payout.';
  end if;

  select coalesce(sum(artist_amount), 0) into v_available
  from music_sale_earnings
  where artist_user_id = v_user_id
    and currency = p_currency
    and status = 'pending'
    and payout_id is null
    and available_at <= now();

  select music_min_payout_xaf into v_min from platform_settings limit 1;
  if p_currency <> 'XAF' then
    v_min := 0; -- Fapshi (and therefore this whole flow) only ever deals in XAF today
  end if;

  if v_available < coalesce(v_min, 0) then
    raise exception 'Your available balance (% %) is below the % minimum payout of % %.',
      v_available, p_currency, p_currency, coalesce(v_min, 0), p_currency;
  end if;

  insert into music_payouts (artist_user_id, amount, currency, status, payout_method, payout_details)
  values (v_user_id, v_available, upper(p_currency), 'requested', v_method, v_details)
  returning * into v_payout;

  update music_sale_earnings
  set status = 'requested', payout_id = v_payout.id
  where artist_user_id = v_user_id
    and currency = p_currency
    and status = 'pending'
    and payout_id is null
    and available_at <= now();

  return v_payout;
end;
$$ language plpgsql security definer;

-- ============================================================================
-- ROW LEVEL SECURITY — owner/admin only, no anon policy on either table.
-- Earnings are keyed directly by artist_user_id (denormalized at insert
-- time from profiles.user_id), so RLS needs no join — same pattern
-- affiliate_commissions.affiliate_user_id already uses.
-- ============================================================================
alter table music_payouts enable row level security;
alter table music_sale_earnings enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'music_payouts' and policyname = 'music_payouts read own') then
    create policy "music_payouts read own" on music_payouts for select using (auth.uid() = artist_user_id or is_admin());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'music_payouts' and policyname = 'music_payouts admin write') then
    create policy "music_payouts admin write" on music_payouts for update using (is_admin());
  end if;

  if not exists (select 1 from pg_policies where tablename = 'music_sale_earnings' and policyname = 'music_sale_earnings read own') then
    create policy "music_sale_earnings read own" on music_sale_earnings for select using (auth.uid() = artist_user_id or is_admin());
  end if;
end $$;
