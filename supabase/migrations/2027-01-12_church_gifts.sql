-- Churches & Ministries: church gifts (donations), the church earnings ledger, church payouts and refund requests — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- THIS FILE KEEPS COLLECTION CLOSED. church_giving_collection_open() (2027-01-10) is NOT replaced here, so the guard below still refuses every new gift, every fund opening and every giving switch.
-- Turning collection on is a separate, later step (supabase/support/2027-01-13_church_giving_activate.PROPOSED.sql) that the owner runs only after the pilot checklist is done.
--
--   NEW  platform_settings columns (church-only; the Shop columns are untouched):
--          church_giving_commission_rate 0.05, church_care_commission_rate 0.05, church_min_gift_xaf 500, church_payout_hold_days 3, church_min_payout_xaf 5000, church_gift_refund_window_hours 48, church_giving_pilot_profiles (empty: NO church is allowed yet).
--   NEW  church_gifts                 one row per gift attempt (fund, church, amount, payer, anonymous flag, Fapshi reference, status). Written by the server only. Never mixed with product_orders / customer_payments.
--   NEW  church_gift_earnings         the church ledger: gross, commission snapshot, platform fee, net, recorded | requested | paid | reversed. One per gift.
--   NEW  church_payouts               payout requests of a church (owner only), same shape as commerce_payouts.
--   NEW  church_gift_refund_requests  a record of a refund request and the administrative decision. NO money moves here: Fapshi refunds are not supported by this code.
--   NEW  functions church_gifts_guard, church_gift_earnings_guard (immutability and state machines), church_settle_gift (atomic, idempotent settlement), request_church_payout (owner), church_payout_finish and
--        church_gift_refund_decide (service role only).
--   NEW  views church_gift_ledger (staff, donor details only when the gift is not anonymous, never the payer phone, email or token) and church_gift_earnings_ledger (owner).
--
-- The Fapshi fee is ABSORBED BY RINGO: net = gross - Ringo's commission, nothing else is deducted from the church.
-- Anonymous gift: the church sees no name and no contact (the table forbids storing them); Ringo keeps the payer phone and the Fapshi reference for reconciliation.
--
-- The Shop ledger (product_orders, customer_payments, commerce_sale_earnings, commerce_payouts) is NOT touched. users.affiliate_payout_method/details are only READ (one payout destination per person, like the Shop).
-- Nothing existing is changed. SELF-VERIFYING, one transaction: preconditions first, postconditions last. Any RAISE rolls everything back. Re-runnable.
--
-- Depends on: 2026-12-27 (church_has_permission, church_is_owner, is_church_profile, is_admin), 2027-01-07 (church_features), 2027-01-10 (church_giving_funds, church_giving_collection_open), 2027-01-11 (the lock).
-- Preflight (read-only, BEFORE): supabase/support/2027-01-12_church_gifts.preflight.sql
-- Verify    (read-only, AFTER):  supabase/support/2027-01-12_church_gifts.verify.sql
-- Rollback: supabase/support/2027-01-12_church_gifts.rollback.sql (refuses to run while any gift, earning, payout or refund request exists unless the loss is explicitly confirmed).

begin;

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS
-- ----------------------------------------------------------------------------
do $$
declare
  v_t text;
begin
  foreach v_t in array array['profiles', 'users', 'platform_settings', 'church_features', 'church_giving_funds'] loop
    if to_regclass('public.' || v_t) is null then raise exception 'precondition failed: public.% is missing', v_t; end if;
  end loop;
  foreach v_t in array array['church_has_permission(uuid,text)', 'church_is_owner(uuid)', 'is_church_profile(uuid)', 'is_admin()', 'church_giving_collection_open()'] loop
    if to_regprocedure('public.' || v_t) is null then raise exception 'precondition failed: function public.% is missing (apply the earlier church migrations first)', v_t; end if;
  end loop;
  if to_regprocedure('public.church_features_giving_lock()') is null then raise exception 'precondition failed: the 2027-01-11 giving lock is missing; apply it first'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name in ('affiliate_payout_method', 'affiliate_payout_details') having count(*) = 2) then
    raise exception 'precondition failed: users.affiliate_payout_method / affiliate_payout_details are missing';
  end if;
  if public.church_giving_collection_open() then raise exception 'precondition failed: collection is already open; this migration is meant to land while it is closed'; end if;
  foreach v_t in array array['church_gifts', 'church_gift_earnings', 'church_payouts', 'church_gift_refund_requests'] loop
    if to_regclass('public.' || v_t) is not null and coalesce(obj_description(to_regclass('public.' || v_t), 'pg_class'), '') <> 'managed by 2027-01-12_church_gifts.sql' then
      raise exception 'precondition failed: % exists and is not managed by this migration', v_t;
    end if;
  end loop;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_gifts_guard', 'church_gift_earnings_guard', 'church_settle_gift', 'request_church_payout', 'church_payout_finish', 'church_gift_refund_decide', 'church_gift_refund_guard', 'church_payout_guard', 'church_giving_profile_allowed')
               and coalesce(obj_description(oid, 'pg_proc'), '') <> 'managed by 2027-01-12_church_gifts.sql') then
    raise exception 'precondition failed: a function named like one of this file''s exists and is not managed by it';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1. CHURCH-ONLY PLATFORM SETTINGS (new columns; the Shop columns are not touched)
-- ----------------------------------------------------------------------------
alter table public.platform_settings add column if not exists church_giving_commission_rate numeric(5,4) not null default 0.05 check (church_giving_commission_rate >= 0 and church_giving_commission_rate <= 1);
alter table public.platform_settings add column if not exists church_care_commission_rate numeric(5,4) not null default 0.05 check (church_care_commission_rate >= 0 and church_care_commission_rate <= 1);
alter table public.platform_settings add column if not exists church_min_gift_xaf integer not null default 500 check (church_min_gift_xaf >= 100);
alter table public.platform_settings add column if not exists church_payout_hold_days integer not null default 3 check (church_payout_hold_days >= 0 and church_payout_hold_days <= 90);
alter table public.platform_settings add column if not exists church_min_payout_xaf numeric(10,2) not null default 5000 check (church_min_payout_xaf >= 0);
alter table public.platform_settings add column if not exists church_gift_refund_window_hours integer not null default 48 check (church_gift_refund_window_hours between 1 and 720);

-- THE PILOT LIST: only churches whose profile id is in this array may take gifts (the gift guard asks church_giving_profile_allowed). It starts EMPTY, so even after collection is opened no church
-- can collect until the owner of the platform adds its profile id on purpose. General availability is a later, explicit change of this one function.
alter table public.platform_settings add column if not exists church_giving_pilot_profiles uuid[] not null default '{}';

create or replace function public.church_giving_profile_allowed(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$ select coalesce((select p_profile_id = any (church_giving_pilot_profiles) from public.platform_settings limit 1), false) $$;
comment on function public.church_giving_profile_allowed(uuid) is 'managed by 2027-01-12_church_gifts.sql';
revoke all on function public.church_giving_profile_allowed(uuid) from public, anon, authenticated;
grant execute on function public.church_giving_profile_allowed(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 2. GIFTS
-- ----------------------------------------------------------------------------
create sequence if not exists public.church_gift_receipt_seq;

create table if not exists public.church_gifts (
  id uuid primary key default gen_random_uuid(),
  receipt_number bigint not null unique default nextval('public.church_gift_receipt_seq'),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  fund_id uuid not null references public.church_giving_funds(id) on delete restrict,
  fund_kind text not null,
  amount_xaf integer not null,
  currency text not null default 'XAF',
  is_anonymous boolean not null default false,
  donor_name text,
  donor_contact text,
  donor_email text,
  payer_phone text not null,
  payer_medium text,
  language text not null default 'en',
  provider text not null default 'fapshi',
  external_id text not null unique,
  provider_transaction_id text,
  status text not null default 'initiated',
  provider_status text,
  failure_reason text,
  access_token_hash text not null,
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  receipt_emailed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint church_gifts_kind_check check (fund_kind in ('giving', 'care')),
  constraint church_gifts_amount_check check (amount_xaf >= 100 and amount_xaf <= 10000000),
  constraint church_gifts_currency_check check (currency = 'XAF'),
  constraint church_gifts_provider_check check (provider = 'fapshi'),
  constraint church_gifts_status_check check (status in ('initiated', 'pending', 'succeeded', 'failed', 'expired', 'cancelled', 'payment_review', 'refunded')),
  constraint church_gifts_medium_check check (payer_medium is null or payer_medium in ('mobile money', 'orange money')),
  constraint church_gifts_language_check check (language in ('en', 'fr')),
  constraint church_gifts_name_check check (donor_name is null or char_length(btrim(donor_name)) between 1 and 120),
  constraint church_gifts_contact_check check (donor_contact is null or char_length(btrim(donor_contact)) between 1 and 120),
  constraint church_gifts_email_check check (donor_email is null or char_length(donor_email) between 3 and 200),
  constraint church_gifts_phone_check check (char_length(btrim(payer_phone)) between 6 and 40),
  constraint church_gifts_reason_check check (failure_reason is null or char_length(failure_reason) <= 500),
  constraint church_gifts_anonymous_check check (not is_anonymous or (donor_name is null and donor_contact is null)),
  constraint church_gifts_confirmed_check check ((status <> 'succeeded' or confirmed_at is not null) and (status not in ('initiated', 'pending') or confirmed_at is null))
);
create unique index if not exists church_gifts_provider_txn_idx on public.church_gifts (provider, provider_transaction_id) where provider_transaction_id is not null;
create index if not exists church_gifts_profile_idx on public.church_gifts (profile_id, created_at desc);
create index if not exists church_gifts_fund_idx on public.church_gifts (fund_id, status);
create index if not exists church_gifts_open_idx on public.church_gifts (created_at) where status in ('initiated', 'pending');
create index if not exists church_gifts_phone_open_idx on public.church_gifts (payer_phone, created_at) where status in ('initiated', 'pending');
comment on table public.church_gifts is 'managed by 2027-01-12_church_gifts.sql';

-- ----------------------------------------------------------------------------
-- 3. EARNINGS, PAYOUTS AND REFUND REQUESTS
-- ----------------------------------------------------------------------------
create table if not exists public.church_payouts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  creator_user_id uuid not null references public.users(id) on delete restrict,
  amount numeric(12,2) not null,
  currency text not null default 'XAF',
  status text not null default 'requested',
  payout_method text,
  payout_details jsonb,
  admin_note text,
  fapshi_trans_id text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references public.users(id),
  constraint church_payouts_status_check check (status in ('requested', 'processing', 'paid', 'rejected')),
  constraint church_payouts_amount_check check (amount > 0),
  constraint church_payouts_currency_check check (currency = 'XAF'),
  constraint church_payouts_note_check check (admin_note is null or char_length(admin_note) <= 500)
);
create index if not exists church_payouts_profile_idx on public.church_payouts (profile_id, status);
comment on table public.church_payouts is 'managed by 2027-01-12_church_gifts.sql';

create table if not exists public.church_gift_earnings (
  id uuid primary key default gen_random_uuid(),
  gift_id uuid not null unique references public.church_gifts(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  creator_user_id uuid not null references public.users(id) on delete restrict,
  gross_amount numeric(12,2) not null,
  commission_rate numeric(5,4) not null,
  platform_fee numeric(12,2) not null,
  net_amount numeric(12,2) not null,
  currency text not null default 'XAF',
  status text not null default 'recorded',
  available_at timestamptz,
  payout_id uuid references public.church_payouts(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint church_earnings_rate_check check (commission_rate >= 0 and commission_rate <= 1),
  constraint church_earnings_amounts_check check (gross_amount > 0 and platform_fee >= 0 and net_amount >= 0 and gross_amount = platform_fee + net_amount),
  constraint church_earnings_currency_check check (currency = 'XAF'),
  constraint church_earnings_status_check check (status in ('recorded', 'requested', 'paid', 'reversed')),
  constraint church_earnings_payout_check check ((status in ('requested', 'paid')) = (payout_id is not null))
);
create index if not exists church_gift_earnings_profile_idx on public.church_gift_earnings (profile_id, created_at desc);
create index if not exists church_gift_earnings_payout_idx on public.church_gift_earnings (payout_id) where payout_id is not null;
comment on table public.church_gift_earnings is 'managed by 2027-01-12_church_gifts.sql';

create table if not exists public.church_gift_refund_requests (
  id uuid primary key default gen_random_uuid(),
  gift_id uuid not null references public.church_gifts(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null,
  status text not null default 'requested',
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.users(id),
  decision_note text,
  constraint church_refund_status_check check (status in ('requested', 'approved', 'declined', 'refunded')),
  constraint church_refund_reason_check check (char_length(btrim(reason)) between 1 and 500),
  constraint church_refund_note_check check (decision_note is null or char_length(decision_note) <= 500),
  constraint church_refund_decided_check check ((status = 'requested') = (decided_at is null))
);
create unique index if not exists church_refund_one_open_idx on public.church_gift_refund_requests (gift_id) where status in ('requested', 'approved');
create index if not exists church_refund_profile_idx on public.church_gift_refund_requests (profile_id, status);
comment on table public.church_gift_refund_requests is 'managed by 2027-01-12_church_gifts.sql';

-- ----------------------------------------------------------------------------
-- 4. GUARDS (fire for every writer, the service role included)
-- ----------------------------------------------------------------------------
create or replace function public.church_gifts_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_kind text;
  v_status text;
  v_published boolean;
  v_min integer;
begin
  if tg_op = 'INSERT' then
    if not public.church_giving_collection_open() then
      raise exception 'giving_collection_not_available' using errcode = '23514', detail = 'collecting money is not available yet';
    end if;
    if not public.is_church_profile(new.profile_id) then raise exception 'church_profile_required' using errcode = '23514'; end if;
    if not public.church_giving_profile_allowed(new.profile_id) then raise exception 'giving_collection_not_available' using errcode = '23514', detail = 'this church is not in the giving pilot'; end if;
    select f.kind, f.status, f.is_published into v_kind, v_status, v_published from public.church_giving_funds f where f.id = new.fund_id and f.profile_id = new.profile_id;
    if not found or v_status <> 'open' or not v_published then raise exception 'gift_fund_not_open' using errcode = '23514', detail = 'the fund is not open for gifts'; end if;
    if new.fund_kind is distinct from v_kind then raise exception 'gift_fund_kind_mismatch' using errcode = '23514'; end if;
    if not exists (select 1 from public.church_features cf where cf.profile_id = new.profile_id and cf.giving) then raise exception 'gift_giving_not_enabled' using errcode = '23514'; end if;
    select coalesce(church_min_gift_xaf, 500) into v_min from public.platform_settings limit 1;
    if new.amount_xaf < coalesce(v_min, 500) then raise exception 'gift_below_minimum' using errcode = '23514', detail = 'the amount is below the minimum gift'; end if;
    if new.status <> 'initiated' or new.confirmed_at is not null or new.provider_transaction_id is not null then raise exception 'gift_must_start_initiated' using errcode = '23514'; end if;
    return new;
  end if;

  if new.id is distinct from old.id or new.receipt_number is distinct from old.receipt_number or new.profile_id is distinct from old.profile_id or new.fund_id is distinct from old.fund_id
     or new.fund_kind is distinct from old.fund_kind or new.amount_xaf is distinct from old.amount_xaf or new.currency is distinct from old.currency or new.is_anonymous is distinct from old.is_anonymous
     or new.donor_name is distinct from old.donor_name or new.donor_contact is distinct from old.donor_contact or new.donor_email is distinct from old.donor_email
     or new.payer_phone is distinct from old.payer_phone or new.language is distinct from old.language or new.provider is distinct from old.provider or new.external_id is distinct from old.external_id
     or new.access_token_hash is distinct from old.access_token_hash or new.expires_at is distinct from old.expires_at or new.created_at is distinct from old.created_at
     or (old.provider_transaction_id is not null and new.provider_transaction_id is distinct from old.provider_transaction_id)
     or (old.confirmed_at is not null and new.confirmed_at is distinct from old.confirmed_at) then
    raise exception 'church_gifts: immutable column changed' using errcode = '42501';
  end if;
  if new.status <> old.status and not (
        (old.status = 'initiated' and new.status in ('pending', 'succeeded', 'failed', 'expired', 'cancelled', 'payment_review'))
     or (old.status = 'pending' and new.status in ('succeeded', 'failed', 'expired', 'cancelled', 'payment_review'))
     or (old.status = 'expired' and new.status in ('succeeded', 'payment_review'))
     or (old.status = 'cancelled' and new.status in ('succeeded', 'payment_review'))
     or (old.status = 'failed' and new.status = 'payment_review')
     or (old.status = 'payment_review' and new.status in ('succeeded', 'failed', 'refunded'))
     or (old.status = 'succeeded' and new.status in ('refunded', 'payment_review'))) then
    raise exception 'church_gifts: illegal status transition % -> %', old.status, new.status using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
comment on function public.church_gifts_guard() is 'managed by 2027-01-12_church_gifts.sql';
revoke all on function public.church_gifts_guard() from public, anon, authenticated;
drop trigger if exists church_gifts_guard_trg on public.church_gifts;
create trigger church_gifts_guard_trg before insert or update on public.church_gifts for each row execute function public.church_gifts_guard();
comment on trigger church_gifts_guard_trg on public.church_gifts is 'managed by 2027-01-12_church_gifts.sql';

-- A gift record is history: it is never deleted.
create or replace function public.church_gift_no_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'church_gifts: records are never deleted' using errcode = '42501';
end;
$$;
comment on function public.church_gift_no_delete() is 'managed by 2027-01-12_church_gifts.sql';
revoke all on function public.church_gift_no_delete() from public, anon, authenticated;
drop trigger if exists church_gifts_no_delete_trg on public.church_gifts;
create trigger church_gifts_no_delete_trg before delete on public.church_gifts for each row execute function public.church_gift_no_delete();
drop trigger if exists church_gift_earnings_no_delete_trg on public.church_gift_earnings;
create trigger church_gift_earnings_no_delete_trg before delete on public.church_gift_earnings for each row execute function public.church_gift_no_delete();
drop trigger if exists church_gift_refund_no_delete_trg on public.church_gift_refund_requests;
create trigger church_gift_refund_no_delete_trg before delete on public.church_gift_refund_requests for each row execute function public.church_gift_no_delete();

create or replace function public.church_gift_earnings_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_status text;
  v_amount integer;
  v_profile uuid;
begin
  if tg_op = 'INSERT' then
    select g.status, g.amount_xaf, g.profile_id into v_status, v_amount, v_profile from public.church_gifts g where g.id = new.gift_id;
    if not found or v_status <> 'succeeded' then raise exception 'church_gift_earnings: the gift must be succeeded' using errcode = '23514'; end if;
    if new.gross_amount <> v_amount or new.profile_id <> v_profile then raise exception 'church_gift_earnings: the earning must match the gift' using errcode = '23514'; end if;
    if new.status <> 'recorded' or new.payout_id is not null then raise exception 'church_gift_earnings: an earning starts recorded' using errcode = '23514'; end if;
    if new.available_at is null then
      new.available_at := now() + make_interval(days => coalesce((select church_payout_hold_days from public.platform_settings limit 1), 0));
    end if;
    return new;
  end if;
  if new.id is distinct from old.id or new.gift_id is distinct from old.gift_id or new.profile_id is distinct from old.profile_id or new.creator_user_id is distinct from old.creator_user_id
     or new.gross_amount is distinct from old.gross_amount or new.commission_rate is distinct from old.commission_rate or new.platform_fee is distinct from old.platform_fee
     or new.net_amount is distinct from old.net_amount or new.currency is distinct from old.currency or new.available_at is distinct from old.available_at or new.created_at is distinct from old.created_at then
    raise exception 'church_gift_earnings: immutable column changed' using errcode = '42501';
  end if;
  if new.status <> old.status and not (
        (old.status = 'recorded' and new.status in ('requested', 'reversed'))
     or (old.status = 'requested' and new.status in ('paid', 'recorded'))) then
    raise exception 'church_gift_earnings: illegal status transition % -> %', old.status, new.status using errcode = '23514';
  end if;
  return new;
end;
$$;
comment on function public.church_gift_earnings_guard() is 'managed by 2027-01-12_church_gifts.sql';
revoke all on function public.church_gift_earnings_guard() from public, anon, authenticated;
drop trigger if exists church_gift_earnings_guard_trg on public.church_gift_earnings;
create trigger church_gift_earnings_guard_trg before insert or update on public.church_gift_earnings for each row execute function public.church_gift_earnings_guard();

create or replace function public.church_gift_refund_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_status text;
  v_profile uuid;
  v_confirmed timestamptz;
  v_hours integer;
begin
  if tg_op = 'INSERT' then
    select g.status, g.profile_id, g.confirmed_at into v_status, v_profile, v_confirmed from public.church_gifts g where g.id = new.gift_id;
    if not found or v_status <> 'succeeded' or new.profile_id <> v_profile then raise exception 'refund_gift_not_refundable' using errcode = '23514'; end if;
    select coalesce(church_gift_refund_window_hours, 48) into v_hours from public.platform_settings limit 1;
    if now() > v_confirmed + make_interval(hours => coalesce(v_hours, 48)) then raise exception 'refund_window_closed' using errcode = '23514'; end if;
    if new.status <> 'requested' then raise exception 'refund_must_start_requested' using errcode = '23514'; end if;
    return new;
  end if;
  if new.id is distinct from old.id or new.gift_id is distinct from old.gift_id or new.profile_id is distinct from old.profile_id or new.reason is distinct from old.reason or new.requested_at is distinct from old.requested_at then
    raise exception 'church_gift_refund_requests: immutable column changed' using errcode = '42501';
  end if;
  if new.status <> old.status and not ((old.status = 'requested' and new.status in ('approved', 'declined', 'refunded')) or (old.status = 'approved' and new.status in ('refunded', 'declined'))) then
    raise exception 'church_gift_refund_requests: illegal status transition % -> %', old.status, new.status using errcode = '23514';
  end if;
  return new;
end;
$$;
comment on function public.church_gift_refund_guard() is 'managed by 2027-01-12_church_gifts.sql';
revoke all on function public.church_gift_refund_guard() from public, anon, authenticated;
drop trigger if exists church_gift_refund_guard_trg on public.church_gift_refund_requests;
create trigger church_gift_refund_guard_trg before insert or update on public.church_gift_refund_requests for each row execute function public.church_gift_refund_guard();

-- ----------------------------------------------------------------------------
-- 5. SETTLEMENT (atomic and idempotent): a provider-confirmed gift -> succeeded -> one earning
-- ----------------------------------------------------------------------------
-- Called by the server ONLY after it asked Fapshi itself and was told SUCCESSFUL. p_provider_amount is what Fapshi reported (null when unknown). A reported amount that differs from the gift sends it to
-- payment_review instead of paying it. Safe to call any number of times: the second call changes nothing.
create or replace function public.church_settle_gift(p_gift_id uuid, p_provider_amount numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  g public.church_gifts;
  v_rate numeric;
  v_fee numeric;
  v_owner uuid;
  v_now boolean := false;
  v_inserted integer;
begin
  select * into g from public.church_gifts where id = p_gift_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  if g.status in ('failed', 'payment_review', 'refunded') then
    if g.status = 'failed' then update public.church_gifts set status = 'payment_review', failure_reason = 'late_success_after_failure' where id = g.id; end if;
    return jsonb_build_object('status', 'review');
  end if;

  if g.status in ('initiated', 'pending', 'expired', 'cancelled') then
    if p_provider_amount is not null and p_provider_amount <> g.amount_xaf then
      update public.church_gifts set status = 'payment_review', failure_reason = 'provider_amount_mismatch' where id = g.id;
      return jsonb_build_object('status', 'review');
    end if;
    update public.church_gifts set status = 'succeeded', confirmed_at = now(), provider_status = 'SUCCESSFUL', failure_reason = null where id = g.id;
    v_now := true;
  end if;

  if exists (select 1 from public.church_gift_earnings e where e.gift_id = g.id) then
    return jsonb_build_object('status', 'succeeded', 'settled_now', v_now, 'earning', true);
  end if;

  select case when g.fund_kind = 'care' then church_care_commission_rate else church_giving_commission_rate end into v_rate from public.platform_settings limit 1;
  select p.user_id into v_owner from public.profiles p where p.id = g.profile_id;
  if v_rate is null or v_owner is null then return jsonb_build_object('status', 'succeeded', 'settled_now', v_now, 'earning', false); end if;
  v_fee := floor(g.amount_xaf * v_rate + 0.5);
  insert into public.church_gift_earnings (gift_id, profile_id, creator_user_id, gross_amount, commission_rate, platform_fee, net_amount)
  values (g.id, g.profile_id, v_owner, g.amount_xaf, v_rate, v_fee, g.amount_xaf - v_fee)
  on conflict (gift_id) do nothing;
  get diagnostics v_inserted = row_count;
  return jsonb_build_object('status', 'succeeded', 'settled_now', v_now, 'earning', true);
end;
$$;
comment on function public.church_settle_gift(uuid, numeric) is 'managed by 2027-01-12_church_gifts.sql';
revoke all on function public.church_settle_gift(uuid, numeric) from public, anon, authenticated;
grant execute on function public.church_settle_gift(uuid, numeric) to service_role;

-- ----------------------------------------------------------------------------
-- 6. PAYOUTS (owner requests; Ringo administration finishes) AND REFUND DECISIONS (Ringo administration)
-- ----------------------------------------------------------------------------
create or replace function public.request_church_payout(p_profile_id uuid)
returns public.church_payouts
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_method text;
  v_details jsonb;
  v_available numeric(12,2);
  v_min numeric(10,2);
  v_ids uuid[];
  v_payout public.church_payouts;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not public.church_is_owner(p_profile_id) or not public.is_church_profile(p_profile_id) then raise exception 'church_owner_required' using errcode = '42501'; end if;
  select affiliate_payout_method, affiliate_payout_details into v_method, v_details from public.users where id = v_user;
  if v_method is null then raise exception 'payout_method_missing' using errcode = '23514'; end if;
  with locked as (
    select id, net_amount from public.church_gift_earnings where profile_id = p_profile_id and status = 'recorded' and payout_id is null and available_at <= now() for update
  )
  select coalesce(array_agg(id), '{}'), coalesce(sum(net_amount), 0) into v_ids, v_available from locked;
  select church_min_payout_xaf into v_min from public.platform_settings limit 1;
  if v_available <= 0 or v_available < coalesce(v_min, 0) then raise exception 'payout_below_minimum' using errcode = '23514', detail = v_available::text; end if;
  insert into public.church_payouts (profile_id, creator_user_id, amount, currency, status, payout_method, payout_details)
  values (p_profile_id, v_user, v_available, 'XAF', 'requested', v_method, v_details) returning * into v_payout;
  update public.church_gift_earnings set status = 'requested', payout_id = v_payout.id where id = any(v_ids);
  return v_payout;
end;
$$;
comment on function public.request_church_payout(uuid) is 'managed by 2027-01-12_church_gifts.sql';
revoke all on function public.request_church_payout(uuid) from public, anon;
grant execute on function public.request_church_payout(uuid) to authenticated, service_role;

create or replace function public.church_payout_finish(p_payout_id uuid, p_outcome text, p_actor uuid, p_note text default null)
returns public.church_payouts
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_payout public.church_payouts;
begin
  if p_outcome not in ('paid', 'rejected') then raise exception 'invalid_outcome' using errcode = '22023'; end if;
  select * into v_payout from public.church_payouts where id = p_payout_id for update;
  if not found then raise exception 'payout_not_found' using errcode = 'P0002'; end if;
  if v_payout.status not in ('requested', 'processing') then raise exception 'payout_already_finished' using errcode = '23514'; end if;
  update public.church_payouts set status = p_outcome, processed_at = now(), processed_by = p_actor, admin_note = left(p_note, 500) where id = p_payout_id returning * into v_payout;
  if p_outcome = 'paid' then
    update public.church_gift_earnings set status = 'paid' where payout_id = p_payout_id and status = 'requested';
  else
    update public.church_gift_earnings set status = 'recorded', payout_id = null where payout_id = p_payout_id and status = 'requested';
  end if;
  return v_payout;
end;
$$;
comment on function public.church_payout_finish(uuid, text, uuid, text) is 'managed by 2027-01-12_church_gifts.sql';
revoke all on function public.church_payout_finish(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.church_payout_finish(uuid, text, uuid, text) to service_role;

-- Records the administrative decision on a refund request. NOTHING IS SENT TO FAPSHI: when the outcome is 'refunded' the administrator has already returned the money by hand; this only records it and
-- reverses the church's earning, and only while that earning is not part of a payout (otherwise the church balance would silently go negative).
create or replace function public.church_gift_refund_decide(p_request_id uuid, p_decision text, p_actor uuid, p_note text default null)
returns public.church_gift_refund_requests
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  r public.church_gift_refund_requests;
  v_earning_status text;
begin
  if p_decision not in ('approved', 'declined', 'refunded') then raise exception 'invalid_decision' using errcode = '22023'; end if;
  select * into r from public.church_gift_refund_requests where id = p_request_id for update;
  if not found then raise exception 'refund_not_found' using errcode = 'P0002'; end if;
  if r.status in ('declined', 'refunded') then raise exception 'refund_already_decided' using errcode = '23514'; end if;
  if p_decision = 'refunded' then
    select status into v_earning_status from public.church_gift_earnings where gift_id = r.gift_id for update;
    if v_earning_status in ('requested', 'paid') then raise exception 'refund_earning_in_payout' using errcode = '23514'; end if;
    if v_earning_status = 'recorded' then update public.church_gift_earnings set status = 'reversed' where gift_id = r.gift_id; end if;
    update public.church_gifts set status = 'refunded' where id = r.gift_id and status in ('succeeded', 'payment_review');
  end if;
  update public.church_gift_refund_requests set status = p_decision, decided_at = now(), decided_by = p_actor, decision_note = left(p_note, 500) where id = p_request_id returning * into r;
  return r;
end;
$$;
comment on function public.church_gift_refund_decide(uuid, text, uuid, text) is 'managed by 2027-01-12_church_gifts.sql';
revoke all on function public.church_gift_refund_decide(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.church_gift_refund_decide(uuid, text, uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 7. ROW-LEVEL SECURITY, PRIVILEGES AND THE STAFF VIEWS
-- ----------------------------------------------------------------------------
alter table public.church_gifts enable row level security;
alter table public.church_gift_earnings enable row level security;
alter table public.church_payouts enable row level security;
alter table public.church_gift_refund_requests enable row level security;
revoke all on public.church_gifts, public.church_gift_earnings, public.church_payouts, public.church_gift_refund_requests from public, anon, authenticated;
revoke all on sequence public.church_gift_receipt_seq from public, anon, authenticated;
grant all on public.church_gifts, public.church_gift_earnings, public.church_payouts, public.church_gift_refund_requests to service_role;
grant usage, select on sequence public.church_gift_receipt_seq to service_role;

-- The church owner reads its own payouts and refund requests directly (no write policy exists for any API role).
grant select on public.church_payouts, public.church_gift_refund_requests to authenticated;
drop policy if exists church_payouts_owner_select on public.church_payouts;
create policy church_payouts_owner_select on public.church_payouts for select to authenticated using (public.church_is_owner(profile_id));
drop policy if exists church_refund_staff_select on public.church_gift_refund_requests;
create policy church_refund_staff_select on public.church_gift_refund_requests for select to authenticated using (public.church_has_permission(profile_id, 'church.giving.manage'));

-- Staff with church.giving.manage see the gift ledger: a donor's name and contact only when the gift is not anonymous (the table forbids storing them for an anonymous gift), never the payer phone, the email or the token.
create or replace view public.church_gift_ledger with (security_barrier = true) as
  select g.id, g.receipt_number, g.profile_id, g.fund_id, g.fund_kind, g.amount_xaf, g.currency, g.is_anonymous, g.donor_name, g.donor_contact, g.status, g.provider_status,
         g.external_id, g.provider_transaction_id, g.failure_reason, g.created_at, g.confirmed_at
    from public.church_gifts g
   where public.church_has_permission(g.profile_id, 'church.giving.manage');
revoke all on public.church_gift_ledger from public, anon, authenticated;
grant select on public.church_gift_ledger to authenticated;
grant all on public.church_gift_ledger to service_role;

-- Money belongs to the owner: the earnings ledger is owner-only.
create or replace view public.church_gift_earnings_ledger with (security_barrier = true) as
  select e.id, e.gift_id, e.profile_id, e.gross_amount, e.commission_rate, e.platform_fee, e.net_amount, e.currency, e.status, e.available_at, e.payout_id, e.created_at
    from public.church_gift_earnings e
   where public.church_is_owner(e.profile_id);
revoke all on public.church_gift_earnings_ledger from public, anon, authenticated;
grant select on public.church_gift_earnings_ledger to authenticated;
grant all on public.church_gift_earnings_ledger to service_role;

-- ----------------------------------------------------------------------------
-- 8. POSTCONDITIONS (any failure rolls the whole file back)
-- ----------------------------------------------------------------------------
do $$
declare
  v_t text;
begin
  foreach v_t in array array['church_gifts', 'church_gift_earnings', 'church_payouts', 'church_gift_refund_requests'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || v_t)::regclass) then raise exception 'postcondition failed: RLS is off on %', v_t; end if;
    if has_table_privilege('anon', 'public.' || v_t, 'select') or has_table_privilege('anon', 'public.' || v_t, 'insert') or has_table_privilege('authenticated', 'public.' || v_t, 'insert')
       or has_table_privilege('authenticated', 'public.' || v_t, 'update') or has_table_privilege('authenticated', 'public.' || v_t, 'delete') then
      raise exception 'postcondition failed: an API role has direct access it should not have on %', v_t;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.church_gifts', 'select') or has_table_privilege('authenticated', 'public.church_gift_earnings', 'select') then raise exception 'postcondition failed: the raw gift or earning tables are readable'; end if;
  if has_function_privilege('anon', 'public.church_settle_gift(uuid,numeric)', 'execute') or has_function_privilege('authenticated', 'public.church_settle_gift(uuid,numeric)', 'execute')
     or has_function_privilege('authenticated', 'public.church_payout_finish(uuid,text,uuid,text)', 'execute') or has_function_privilege('authenticated', 'public.church_gift_refund_decide(uuid,text,uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.request_church_payout(uuid)', 'execute') then
    raise exception 'postcondition failed: a financial function is callable by an API role';
  end if;
  if public.church_giving_collection_open() then raise exception 'postcondition failed: collection must still be closed'; end if;
  if exists (select 1 from public.church_features where giving) then raise exception 'postcondition failed: a church has giving switched on'; end if;
end $$;

commit;
