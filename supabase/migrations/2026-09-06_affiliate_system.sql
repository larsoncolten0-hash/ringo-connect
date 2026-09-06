-- Ringo Connect — Affiliate program
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New
-- query → paste → Run) against the live project. It's additive only —
-- nothing here touches existing tables' data, and every new trigger is a
-- SEPARATE trigger on an existing table (users, payment_transactions),
-- so it runs alongside whatever triggers already exist there without
-- replacing them.
--
-- What this does, end to end:
--   1. Every user gets a short, unique affiliate_code (backfilled for
--      existing rows, auto-set for new ones).
--   2. A new signup can be attributed to the affiliate whose code it
--      carries in auth.users.raw_user_meta_data->>'ref' (set by the app
--      when someone lands on ringoconnectltd.com with ?ref=CODE — see
--      src/lib/referral.ts). First-touch, permanent once set.
--   3. Every time an existing payment_transactions row is marked
--      'success' (insert OR update — covers both Stripe's one-shot
--      insert and Fapshi's pending→success update), and the paying user
--      was referred, a commission row is created automatically. Fully
--      idempotent: re-running the same transaction to 'success' never
--      double-credits.
--   4. Commissions sit on a hold (platform_settings.affiliate_hold_days)
--      before they're payable — protects against refunds/chargebacks.
--   5. An affiliate requests a payout for their available balance in one
--      currency via the request_affiliate_payout() RPC, which atomically
--      sums + locks the eligible commissions into a single payout row.
--      An admin marks that payout paid or rejected from /admin/affiliates.
--
-- NOTE ON RECURRING COMMISSIONS: this fires on every payment_transactions
-- row the platform already records as successful. For Fapshi (Mobile
-- Money), that's every renewal, since Fapshi has no auto-renew — so
-- affiliates do earn on renewals there. For Stripe, only the initial
-- checkout.session.completed inserts a payment_transactions row (see
-- src/app/api/billing/stripe/webhook/route.ts) — monthly Stripe renewals
-- don't. That's an existing instrumentation gap in the billing code, not
-- something this migration works around; extending it would mean
-- listening for Stripe's invoice.paid webhook, which is a billing change
-- outside this feature's scope.

-- gen_random_bytes() (used below to generate affiliate codes) comes from
-- pgcrypto, not core Postgres — gen_random_uuid() elsewhere in this schema
-- is built in, but this one extension needs to actually be enabled.
-- Supabase ships pgcrypto as a trusted extension any project owner can
-- turn on; this is a no-op if it's already there.
create extension if not exists pgcrypto;

-- ============================================================================
-- 1. PLATFORM SETTINGS — affiliate program configuration
-- ============================================================================
alter table platform_settings add column if not exists affiliate_enabled boolean not null default true;
-- Fraction, not percentage — 0.2000 = 20%. The admin UI edits this as a
-- 0-100 percentage and converts both ways (see src/lib/affiliateSettings.ts).
alter table platform_settings add column if not exists affiliate_commission_rate numeric(5,4) not null default 0.2000;
alter table platform_settings add column if not exists affiliate_hold_days int not null default 14;
alter table platform_settings add column if not exists affiliate_min_payout_xaf numeric(10,2) not null default 10000;
alter table platform_settings add column if not exists affiliate_min_payout_usd numeric(10,2) not null default 20;

-- Carries an affiliate code from the public /get-started form through to
-- account creation at admin approval time (that flow has no Supabase Auth
-- session to attach metadata to until the admin actually creates the
-- account — see src/app/api/admin/requests/[id]/approve/route.ts).
alter table signup_requests add column if not exists referral_code text;

-- ============================================================================
-- 2. USERS — affiliate identity + attribution + payout destination
-- ============================================================================
alter table public.users add column if not exists affiliate_code text unique;
alter table public.users add column if not exists referred_by uuid references public.users(id) on delete set null;
-- Lets an admin cut off ONE affiliate's ability to earn (fraud, abuse)
-- without touching their account's own status/plan.
alter table public.users add column if not exists affiliate_suspended boolean not null default false;
alter table public.users add column if not exists affiliate_payout_method text check (affiliate_payout_method in ('mobile_money', 'paypal', 'bank'));
alter table public.users add column if not exists affiliate_payout_details jsonb;

create index if not exists users_referred_by_idx on public.users (referred_by);
create index if not exists users_affiliate_code_idx on public.users (affiliate_code);

-- Backfill: every existing user gets a code derived from their own id —
-- already-unique by construction, no collision possible.
update public.users
set affiliate_code = upper(substr(replace(id::text, '-', ''), 1, 8))
where affiliate_code is null;

-- --- BEFORE INSERT: assign a code to every new row -------------------------
create or replace function set_affiliate_code() returns trigger as $$
declare
  candidate text;
  attempts int := 0;
begin
  if new.affiliate_code is not null then
    return new;
  end if;

  loop
    candidate := upper(encode(gen_random_bytes(5), 'hex'));
    attempts := attempts + 1;
    exit when not exists (select 1 from public.users where affiliate_code = candidate);
    if attempts > 20 then
      -- Astronomically unlikely, but never loop forever.
      candidate := upper(substr(replace(new.id::text, '-', ''), 1, 8)) || attempts::text;
      exit;
    end if;
  end loop;

  new.affiliate_code := candidate;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_set_affiliate_code on public.users;
create trigger trg_set_affiliate_code
before insert on public.users
for each row execute function set_affiliate_code();

-- --- AFTER INSERT: attribute the referral, if any ---------------------------
-- Reads the 'ref' code out of the NEW auth user's metadata (set by
-- supabase.auth.signUp({ options: { data: { ref } } }) on the client, or
-- by the admin approve route for assisted/get-started signups) and, if it
-- matches a real affiliate's code, links this new user to them. First-touch
-- and permanent: only runs when referred_by is still null.
create or replace function attribute_referral() returns trigger as $$
declare
  ref_code text;
  referrer_id uuid;
begin
  if new.referred_by is not null then
    return new;
  end if;

  select raw_user_meta_data->>'ref' into ref_code from auth.users where id = new.id;
  if ref_code is null or length(trim(ref_code)) = 0 then
    return new;
  end if;

  select id into referrer_id
  from public.users
  where affiliate_code = upper(trim(ref_code)) and id <> new.id;

  if referrer_id is not null then
    update public.users set referred_by = referrer_id where id = new.id;
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_attribute_referral on public.users;
create trigger trg_attribute_referral
after insert on public.users
for each row execute function attribute_referral();

-- --- BEFORE UPDATE: lock down the affiliate-identity columns ----------------
-- The app lets a creator update their OWN row (whatsapp number, theme,
-- etc. all go through the same "users update own row" policy), and now
-- also their own payout method/details. affiliate_code, referred_by, and
-- affiliate_suspended must never be settable that way — only by triggers
-- running outside a real user session (auth.uid() is null: GoTrue signup,
-- the admin API, or the service-role key) or by an admin.
create or replace function protect_affiliate_fields() returns trigger as $$
begin
  if auth.uid() is not null and not is_admin() then
    new.affiliate_code := old.affiliate_code;
    new.referred_by := old.referred_by;
    new.affiliate_suspended := old.affiliate_suspended;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_protect_affiliate_fields on public.users;
create trigger trg_protect_affiliate_fields
before update on public.users
for each row execute function protect_affiliate_fields();

-- ============================================================================
-- 3. PAYOUTS (must exist before commissions, which reference it)
-- ============================================================================
create table if not exists affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null references public.users(id) on delete cascade,
  amount numeric(10,2) not null,
  currency text not null,
  status text not null default 'requested' check (status in ('requested', 'paid', 'rejected')),
  payout_method text,
  payout_details jsonb,          -- snapshot of the destination at request time
  admin_note text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references public.users(id)
);
create index if not exists affiliate_payouts_affiliate_user_id_idx on affiliate_payouts (affiliate_user_id, status);
create index if not exists affiliate_payouts_status_idx on affiliate_payouts (status, requested_at);

-- ============================================================================
-- 4. COMMISSIONS
-- ============================================================================
create table if not exists affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null references public.users(id) on delete cascade,
  referred_user_id uuid not null references public.users(id) on delete cascade,
  payment_transaction_id uuid not null unique references payment_transactions(id) on delete cascade,
  amount numeric(10,2) not null,
  currency text not null,
  commission_rate numeric(5,4) not null,
  status text not null default 'pending' check (status in ('pending', 'requested', 'paid', 'reversed')),
  available_at timestamptz not null,
  payout_id uuid references affiliate_payouts(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists affiliate_commissions_affiliate_user_id_idx on affiliate_commissions (affiliate_user_id, status);
create index if not exists affiliate_commissions_payout_id_idx on affiliate_commissions (payout_id);

-- --- AFTER INSERT OR UPDATE OF status ON payment_transactions ---------------
create or replace function handle_payment_transaction_commission() returns trigger as $$
declare
  referrer_id uuid;
  referrer_suspended boolean;
  settings record;
begin
  if new.status is distinct from 'success' then
    return new;
  end if;

  select referred_by, affiliate_suspended into referrer_id, referrer_suspended
  from public.users where id = new.user_id;

  if referrer_id is null or referrer_suspended then
    return new;
  end if;

  select affiliate_enabled, affiliate_commission_rate, affiliate_hold_days
  into settings
  from platform_settings limit 1;

  if settings is null or not settings.affiliate_enabled then
    return new;
  end if;

  insert into affiliate_commissions (
    affiliate_user_id, referred_user_id, payment_transaction_id,
    amount, currency, commission_rate, available_at
  )
  values (
    referrer_id, new.user_id, new.id,
    round(new.amount * settings.affiliate_commission_rate, 2), new.currency, settings.affiliate_commission_rate,
    now() + (settings.affiliate_hold_days || ' days')::interval
  )
  on conflict (payment_transaction_id) do nothing;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_payment_transaction_commission on payment_transactions;
create trigger trg_payment_transaction_commission
after insert or update of status on payment_transactions
for each row execute function handle_payment_transaction_commission();

-- ============================================================================
-- 5. PAYOUT REQUEST — atomic sum + lock, callable by the affiliate themselves
-- ============================================================================
create or replace function request_affiliate_payout(p_currency text)
returns affiliate_payouts as $$
declare
  v_user_id uuid := auth.uid();
  v_method text;
  v_details jsonb;
  v_available numeric(10,2);
  v_min numeric(10,2);
  v_payout affiliate_payouts;
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

  select coalesce(sum(amount), 0) into v_available
  from affiliate_commissions
  where affiliate_user_id = v_user_id
    and currency = p_currency
    and status = 'pending'
    and payout_id is null
    and available_at <= now();

  select case upper(p_currency) when 'XAF' then affiliate_min_payout_xaf else affiliate_min_payout_usd end
  into v_min
  from platform_settings limit 1;

  if v_available < coalesce(v_min, 0) then
    -- RAISE's "%" placeholder is a plain substitution, not printf-style —
    -- v_available/v_min are already numeric(10,2), so they render with a
    -- fixed 2 decimals on their own without any format specifier.
    raise exception 'Your available balance (% %) is below the % minimum payout of % %.',
      v_available, p_currency, p_currency, coalesce(v_min, 0), p_currency;
  end if;

  insert into affiliate_payouts (affiliate_user_id, amount, currency, status, payout_method, payout_details)
  values (v_user_id, v_available, upper(p_currency), 'requested', v_method, v_details)
  returning * into v_payout;

  update affiliate_commissions
  set status = 'requested', payout_id = v_payout.id
  where affiliate_user_id = v_user_id
    and currency = p_currency
    and status = 'pending'
    and payout_id is null
    and available_at <= now();

  return v_payout;
end;
$$ language plpgsql security definer;

revoke all on function request_affiliate_payout(text) from public, anon;
grant execute on function request_affiliate_payout(text) to authenticated;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table affiliate_commissions enable row level security;
alter table affiliate_payouts enable row level security;

create policy "affiliate_commissions read own" on affiliate_commissions for select using (
  affiliate_user_id = auth.uid() or is_admin()
);
create policy "affiliate_payouts read own" on affiliate_payouts for select using (
  affiliate_user_id = auth.uid() or is_admin()
);
-- No insert/update/delete policies for authenticated/anon on either table —
-- writes only ever happen via the SECURITY DEFINER trigger/RPC above, or
-- the service-role key from admin routes (which bypasses RLS entirely).
create policy "affiliate_payouts admin write" on affiliate_payouts for update using (is_admin());

-- A referring affiliate can see the users/profiles rows of the people they
-- referred (name, plan, joined date) — scoped strictly to rows where THAT
-- specific relationship exists, additive to the existing owner/admin
-- policies on these tables.
create policy "users read own referrals" on public.users for select using (
  referred_by = auth.uid()
);
create policy "profiles read own referrals" on profiles for select using (
  exists (select 1 from public.users u where u.id = profiles.user_id and u.referred_by = auth.uid())
);
