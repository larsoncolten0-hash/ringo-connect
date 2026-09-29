-- Ringo Ambassador Program — activation engine + commission ledger. NOT YET RUN.
--
-- Purely additive. No existing table touched.
--
-- Money is never computed in JavaScript anywhere in this system — every
-- commission_amount is `round(base_amount * percentage, 2)` evaluated
-- inside ambassador_record_commission() itself, the exact round(numeric,2)
-- convention the existing affiliate trigger already uses
-- (handle_payment_transaction_commission() in 2026-09-06_affiliate_system.sql).
--
-- Activation is an explicit server-side BUSINESS RULE, not a copy of the
-- client-side ProfileCompletionCard.tsx checklist. Confirmed by direct
-- audit of src/lib/categories.ts: catalog/products is shared, relabeled
-- infrastructure every category gets (Listings for real_estate, Services
-- for professional_services, Courses for education_training, Products for
-- agriculture_agribusiness, etc — see that file's own header comment,
-- "every category still gets the same links/catalog/WhatsApp/about
-- toolkit... a category only changes how that toolkit is labeled"). Only
-- restaurant_food and music_entertainment have their OWN dedicated
-- systems (menu_items; tracks/music_releases) that structurally REPLACE
-- catalog's role for those two categories specifically (per those
-- categories' own catalogLabel comments). Requiring a generic product row
-- for every other category would be exactly the artificial, business-rule
-- requirement this migration deliberately avoids — a real_estate,
-- professional_services, transport_logistics, education_training, or
-- agriculture_agribusiness profile activates on the universal essentials
-- alone, with no catalog-row gate at all.

-- ============================================================================
-- 1. ACTIVATION READINESS — one central, idempotent, server-side check.
--    Takes a `users.id`, not a client-asserted status of any kind.
-- ============================================================================
create or replace function public.ambassador_is_activation_ready(p_user_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user record;
  v_profile record;
begin
  select id, pwa_installed_at, last_active_standalone into v_user from public.users where id = p_user_id;
  if v_user.id is null then
    return false;
  end if;

  select * into v_profile from public.profiles where user_id = p_user_id;
  if v_profile.id is null then
    return false;
  end if;

  -- Demo/test activity must never create activation commissions.
  if coalesce(v_profile.is_demo, false) then
    return false;
  end if;

  -- Universal essentials (mirrors the same fields the editor's own
  -- completion checklist highlights, but evaluated server-side against
  -- the real row — never trusted from a client flag).
  if v_profile.avatar_url is null then return false; end if;
  if v_profile.bio is null or trim(v_profile.bio) = '' then return false; end if;
  if v_profile.category is null then return false; end if;
  if v_profile.username is null or trim(v_profile.username) = '' then return false; end if;

  if not (
    (v_profile.whatsapp_number is not null and trim(v_profile.whatsapp_number) <> '')
    or (v_profile.about_email is not null and trim(v_profile.about_email) <> '')
    or exists (select 1 from public.social_links sl where sl.profile_id = v_profile.id)
  ) then
    return false;
  end if;

  if not exists (select 1 from public.links l where l.profile_id = v_profile.id) then
    return false;
  end if;

  -- Category-specific: ONLY for the two categories whose primary listing
  -- mechanism is genuinely not catalog/products — see the header comment.
  if v_profile.category = 'restaurant_food' or (v_profile.categories is not null and v_profile.categories @> array['restaurant_food']) then
    if not exists (select 1 from public.menu_items mi where mi.profile_id = v_profile.id) then
      return false;
    end if;
  elsif v_profile.category = 'music_entertainment' or (v_profile.categories is not null and v_profile.categories @> array['music_entertainment']) then
    if not exists (select 1 from public.tracks t where t.profile_id = v_profile.id)
       and not exists (select 1 from public.music_releases mr where mr.profile_id = v_profile.id)
    then
      return false;
    end if;
  end if;

  -- PWA installed — Chrome/Edge/Android via the real appinstalled-event
  -- column, iOS via the documented standalone-mode fallback. Push
  -- subscription is never consulted (confirmed not a valid install proxy).
  if not (v_user.pwa_installed_at is not null or coalesce(v_user.last_active_standalone, false) = true) then
    return false;
  end if;

  return true;
end;
$$;

-- ============================================================================
-- 2. COMMISSION LEDGER
-- ============================================================================
-- entry_type distinguishes an ordinary earned commission from a reversal/
-- recovery accounting entry. This is what makes the reversal design
-- possible at all: a reversal of an already-PAID row must retain the SAME
-- sale_id/recipient_type/milestone as the original (full traceability —
-- "why did this recovery exist" must point at exactly what it reverses),
-- which a single unqualified UNIQUE(sale_id, recipient_type, milestone)
-- would have rejected outright. Ordinary commission idempotency is NOT
-- weakened by this — see the partial unique index below, which still
-- guarantees at most one 'commission'-type row per (sale, recipient,
-- milestone), exactly as before.
--
-- A reversal row is a recovery/accounting entry, never a second earned
-- commission: it always has entry_type='reversal', a NEGATIVE
-- commission_amount, and status='reversed' from the moment it's created.
-- Any dashboard/report total must SUM(commission_amount) across ledger
-- rows (both entry_types) rather than reading ambassador_sales.status
-- alone, so a reversed-after-paid sale's true net total is ever correctly
-- reduced, not just cosmetically marked done.
create table if not exists public.ambassador_commission_ledger (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.ambassador_sales(id) on delete restrict,
  recipient_type text not null check (recipient_type in ('ambassador', 'team_leader')),
  recipient_user_id uuid not null references public.users(id) on delete restrict,
  milestone text not null check (milestone in ('sale_registration', 'activation')),
  entry_type text not null default 'commission' check (entry_type in ('commission', 'reversal')),
  percentage numeric(5, 4) not null check (percentage > 0),
  base_amount numeric(12, 2) not null,
  commission_amount numeric(12, 2) not null,
  currency text not null default 'XAF',
  status text not null default 'earned' check (status in (
    'pending', 'earned', 'eligible_for_payout', 'paid', 'reversed', 'cancelled'
  )),
  source_event text not null,
  payout_id uuid,
  reversed_ledger_id uuid references public.ambassador_commission_ledger(id) on delete set null,
  reversal_reason text,
  created_at timestamptz not null default now(),
  earned_at timestamptz not null default now(),
  eligible_at timestamptz,
  paid_at timestamptz,
  reversed_at timestamptz,
  check (
    (entry_type = 'commission' and commission_amount > 0)
    or (entry_type = 'reversal' and commission_amount < 0)
  )
);
create index if not exists ambassador_commission_ledger_recipient_idx on public.ambassador_commission_ledger (recipient_user_id, status);
create index if not exists ambassador_commission_ledger_sale_idx on public.ambassador_commission_ledger (sale_id);
create index if not exists ambassador_commission_ledger_status_idx on public.ambassador_commission_ledger (status);

-- Ordinary commission idempotency — UNCHANGED in spirit, only now scoped
-- to entry_type='commission' rows so a reversal row (entry_type='reversal')
-- sharing the same (sale_id, recipient_type, milestone) is never blocked
-- by it. This is still exactly "one earned commission per sale per
-- recipient per milestone, ever" — the guarantee is not weakened.
create unique index if not exists ambassador_commission_ledger_commission_unique_idx
  on public.ambassador_commission_ledger (sale_id, recipient_type, milestone)
  where entry_type = 'commission';

-- Reversal idempotency — a given commission row can be reversed at most
-- once, DB-enforced (not just app-checked): a second reversal attempt for
-- the same original ledger row can never insert a second recovery row.
create unique index if not exists ambassador_commission_ledger_reversal_unique_idx
  on public.ambassador_commission_ledger (reversed_ledger_id)
  where entry_type = 'reversal';

alter table public.ambassador_commission_ledger enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ambassador_commission_ledger' and policyname = 'ambassador_commission_ledger own or admin read') then
    create policy "ambassador_commission_ledger own or admin read" on public.ambassador_commission_ledger for select using (
      recipient_user_id = auth.uid()
      or is_admin()
      or exists (
        select 1 from public.ambassador_sales s
        join public.ambassador_teams t on t.id = s.team_id
        where s.id = ambassador_commission_ledger.sale_id and t.team_leader_user_id = auth.uid()
      )
    );
  end if;
end $$;

-- ============================================================================
-- 3. COMMISSION RECORDING — the only way a row ever enters the ledger.
--    Computes the money in SQL (round(numeric,2), never JS float), and the
--    UNIQUE(sale_id, recipient_type, milestone) constraint makes a repeat
--    call for the same event a guaranteed no-op rather than a duplicate.
-- ============================================================================
create or replace function public.ambassador_record_commission(
  p_sale_id uuid,
  p_recipient_type text,
  p_recipient_user_id uuid,
  p_milestone text,
  p_percentage numeric,
  p_base_amount numeric,
  p_source_event text
)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  insert into public.ambassador_commission_ledger (
    sale_id, recipient_type, recipient_user_id, milestone, entry_type, percentage, base_amount, commission_amount, source_event, status
  ) values (
    p_sale_id, p_recipient_type, p_recipient_user_id, p_milestone, 'commission', p_percentage, p_base_amount,
    round(p_base_amount * p_percentage, 2), p_source_event, 'earned'
  )
  on conflict (sale_id, recipient_type, milestone) where entry_type = 'commission' do nothing
  returning jsonb_build_object('ok', true, 'ledger_id', id, 'amount', commission_amount);
$$;

-- ============================================================================
-- 4. MILESTONE 1 — sale + registration. Only fires once: payment is
--    already independently Fapshi-verified (ambassador_lock_sale already
--    ran, off the existing signup_requests.customer_paid confirmation),
--    and registration is this exact call (the account was just created).
--    If the ambassador has no team_id snapshotted, NO team_leader row is
--    created and Ringo Connect simply retains that portion — never a
--    pending/placeholder team_leader row, and never backfilled later if
--    the ambassador joins a team afterward (team_id here is the
--    attribution-time snapshot, permanently).
-- ============================================================================
create or replace function public.ambassador_evaluate_milestone_1(p_sale_id uuid, p_customer_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale record;
  v_ambassador_user_id uuid;
  v_leader_user_id uuid;
begin
  select * into v_sale from public.ambassador_sales where id = p_sale_id and status = 'locked';
  if v_sale.id is null then
    return jsonb_build_object('ok', false, 'reason', 'sale_not_locked');
  end if;

  update public.ambassador_sales
  set customer_user_id = p_customer_user_id, status = 'milestone_1_earned'
  where id = p_sale_id;

  select user_id into v_ambassador_user_id from public.ambassador_profiles where id = v_sale.ambassador_id;
  perform public.ambassador_record_commission(p_sale_id, 'ambassador', v_ambassador_user_id, 'sale_registration', 0.0750, v_sale.selling_price, 'signup_request_approved');

  if v_sale.team_id is not null then
    select team_leader_user_id into v_leader_user_id from public.ambassador_teams where id = v_sale.team_id;
    if v_leader_user_id is not null then
      perform public.ambassador_record_commission(p_sale_id, 'team_leader', v_leader_user_id, 'sale_registration', 0.0250, v_sale.selling_price, 'signup_request_approved');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'sale_id', p_sale_id);
end;
$$;

-- ============================================================================
-- 5. MILESTONE 2 — activation. Safely callable from multiple trigger
--    points (profile save, PWA install, admin approval, the safety-net
--    cron) — idempotent via the same unique-constraint backstop, and a
--    no-op whenever ambassador_is_activation_ready() is still false.
-- ============================================================================
create or replace function public.ambassador_evaluate_milestone_2(p_sale_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale record;
  v_ambassador_user_id uuid;
  v_leader_user_id uuid;
begin
  select * into v_sale from public.ambassador_sales where id = p_sale_id and status = 'milestone_1_earned';
  if v_sale.id is null or v_sale.customer_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_ready_for_evaluation');
  end if;

  if not public.ambassador_is_activation_ready(v_sale.customer_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'activation_not_ready');
  end if;

  update public.ambassador_sales set status = 'milestone_2_earned' where id = p_sale_id;

  select user_id into v_ambassador_user_id from public.ambassador_profiles where id = v_sale.ambassador_id;
  perform public.ambassador_record_commission(p_sale_id, 'ambassador', v_ambassador_user_id, 'activation', 0.0750, v_sale.selling_price, 'activation_verified');

  if v_sale.team_id is not null then
    select team_leader_user_id into v_leader_user_id from public.ambassador_teams where id = v_sale.team_id;
    if v_leader_user_id is not null then
      perform public.ambassador_record_commission(p_sale_id, 'team_leader', v_leader_user_id, 'activation', 0.0250, v_sale.selling_price, 'activation_verified');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'sale_id', p_sale_id);
end;
$$;

-- ============================================================================
-- 6. FUNCTION PERMISSIONS — service-role only.
-- ============================================================================
revoke all on function public.ambassador_is_activation_ready(uuid) from public;
revoke all on function public.ambassador_record_commission(uuid, text, uuid, text, numeric, numeric, text) from public;
revoke all on function public.ambassador_evaluate_milestone_1(uuid, uuid) from public;
revoke all on function public.ambassador_evaluate_milestone_2(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ambassador_is_activation_ready(uuid) from anon';
    execute 'revoke all on function public.ambassador_record_commission(uuid, text, uuid, text, numeric, numeric, text) from anon';
    execute 'revoke all on function public.ambassador_evaluate_milestone_1(uuid, uuid) from anon';
    execute 'revoke all on function public.ambassador_evaluate_milestone_2(uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.ambassador_is_activation_ready(uuid) from authenticated';
    execute 'revoke all on function public.ambassador_record_commission(uuid, text, uuid, text, numeric, numeric, text) from authenticated';
    execute 'revoke all on function public.ambassador_evaluate_milestone_1(uuid, uuid) from authenticated';
    execute 'revoke all on function public.ambassador_evaluate_milestone_2(uuid) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ambassador_is_activation_ready(uuid) to service_role';
    execute 'grant execute on function public.ambassador_record_commission(uuid, text, uuid, text, numeric, numeric, text) to service_role';
    execute 'grant execute on function public.ambassador_evaluate_milestone_1(uuid, uuid) to service_role';
    execute 'grant execute on function public.ambassador_evaluate_milestone_2(uuid) to service_role';
  end if;
end $$;
