-- Ringo Ambassador Program — sales attribution. NOT YET RUN.
--
-- ONE additive nullable column on an existing table (signup_requests),
-- otherwise entirely new objects. This is the one intentional touch of an
-- existing table this whole program makes, and it is a pure additive
-- column with a default of null — every existing signup_requests row and
-- every existing code path that reads/writes that table is completely
-- unaffected; nothing here changes referral_code's behavior, the
-- attribute_referral()/protect_affiliate_fields() triggers, or
-- canReviewerAccessRequest()'s reviewer-routing logic in any way.
--
-- Confirmed by direct code audit (src/lib/assertAdmin.ts,
-- src/app/api/admin/requests/[id]/approve/route.ts): referral_code is
-- already load-bearing for BOTH super-creator reviewer-routing access
-- control AND users.referred_by attribution via the existing
-- attribute_referral() trigger. It is not safe to repurpose, so
-- ambassador_code is a wholly separate column with its own separate
-- meaning, validated and resolved independently.
alter table public.signup_requests add column if not exists ambassador_code text;

-- ============================================================================
-- 1. SALES — one row per qualifying attribution. V1 scope: only sales that
--    go through the signup_requests flow (new-customer Smart Card
--    signups) are ever attributed — existing-user card-bundle upgrades
--    via /api/ringo-cards/bundle/initiate never create a row here, by
--    design (see the Ambassador Program audit's V1 scope decision). This
--    is what keeps this system fully isolated from
--    payment_transactions and the legacy affiliate trigger that already
--    lives on that table.
-- ============================================================================
create table if not exists public.ambassador_sales (
  id uuid primary key default gen_random_uuid(),
  signup_request_id uuid not null unique references public.signup_requests(id) on delete restrict,
  ambassador_id uuid not null references public.ambassador_profiles(id) on delete restrict,
  -- Snapshotted at attribution-capture time, not re-read later — if the
  -- Ambassador changes teams afterward, this historical sale must keep
  -- pointing at the team that was actually in place when it happened (see
  -- the approved "preserve historical attribution" decision). Nullable:
  -- an Ambassador with no team at the time of the sale simply has no
  -- team_id here, permanently — reassigning them to a team later never
  -- backfills this column for past sales.
  team_id uuid references public.ambassador_teams(id) on delete restrict,
  -- Null until the real account is created at admin approval
  -- (registration happens strictly after payment for this flow — see the
  -- Ambassador Program audit's payment-flow findings).
  customer_user_id uuid references public.users(id) on delete restrict,
  card_type text not null,
  selling_price numeric(12, 2) not null check (selling_price > 0),
  payment_reference text,
  status text not null default 'attributed' check (status in (
    'attributed', 'locked', 'milestone_1_earned', 'milestone_2_earned', 'disputed', 'voided', 'refunded'
  )),
  self_referral_checked boolean not null default false,
  attributed_at timestamptz not null default now(),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ambassador_sales_ambassador_idx on public.ambassador_sales (ambassador_id);
create index if not exists ambassador_sales_team_idx on public.ambassador_sales (team_id);
create index if not exists ambassador_sales_status_idx on public.ambassador_sales (status);
create index if not exists ambassador_sales_customer_idx on public.ambassador_sales (customer_user_id);

-- ============================================================================
-- 2. IMMUTABILITY — once a sale is past 'attributed', its attribution
--    facts are locked against any session-authenticated write. Belt and
--    suspenders alongside RLS (which already has no write policy for
--    `authenticated` at all) — same reasoning as the existing
--    protect_affiliate_fields() trigger on `users`. Service-role code
--    (the lock/milestone functions, or an explicit logged management
--    override) is the only way these fields ever change past this point.
-- ============================================================================
create or replace function public.protect_ambassador_sale_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status <> 'attributed' and auth.uid() is not null and not is_admin() then
    if new.ambassador_id is distinct from old.ambassador_id
      or new.team_id is distinct from old.team_id
      or new.customer_user_id is distinct from old.customer_user_id
      or new.selling_price is distinct from old.selling_price
      or new.card_type is distinct from old.card_type
      or new.signup_request_id is distinct from old.signup_request_id
    then
      raise exception 'ambassador_sales attribution fields are locked once a sale is past attributed';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ambassador_sales_protect_fields on public.ambassador_sales;
create trigger ambassador_sales_protect_fields
  before update on public.ambassador_sales
  for each row execute function public.protect_ambassador_sale_fields();

-- ============================================================================
-- 3. ATTRIBUTION CAPTURE — one atomic, service-role-only entry point.
--    Validates the code, runs self-referral protection (Ambassador AND
--    Team Leader, server-side raw-value comparison — see the function
--    body for exactly what "raw-value" means and why), and only then
--    inserts the sale. An invalid code or a self-referral attempt is
--    logged via ambassador_log_action and produces NO ambassador_sales
--    row — signup_requests.ambassador_code may still hold the
--    as-submitted value for investigation, but that alone is never
--    treated as authoritative attribution anywhere else in this system;
--    only a real ambassador_sales row is.
-- ============================================================================
create or replace function public.ambassador_attribute_sale(
  p_signup_request_id uuid,
  p_ambassador_code text,
  p_signup_email text,
  p_signup_whatsapp text,
  p_card_type text,
  p_selling_price numeric,
  p_payment_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ambassador record;
  v_team record;
  v_ambassador_email text;
  v_ambassador_whatsapp text;
  v_leader_email text;
  v_leader_whatsapp text;
  v_norm_signup_whatsapp text := regexp_replace(coalesce(p_signup_whatsapp, ''), '[^0-9]', '', 'g');
  v_sale_id uuid;
begin
  if p_ambassador_code is null or trim(p_ambassador_code) = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_code');
  end if;

  select * into v_ambassador
  from public.ambassador_profiles
  where sales_code = upper(trim(p_ambassador_code)) and status = 'active';

  if v_ambassador.id is null then
    perform public.ambassador_log_action(null, 'invalid_ambassador_code', 'signup_requests', p_signup_request_id, null, jsonb_build_object('submitted_code', p_ambassador_code), 'no active ambassador_profiles row matches this code');
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;

  -- Ambassador self-referral: raw stored-value comparison against the
  -- ambassador's own auth email and their own profile's WhatsApp number.
  -- This codebase has no independent identity-verification step for this
  -- population (confirmed by audit: email_confirm is force-set true by
  -- staff at admin-approval time, never proven by the customer) — this is
  -- therefore honestly a same-value check, not a cryptographic identity
  -- proof, and is documented as such rather than overclaimed.
  select email into v_ambassador_email from auth.users where id = v_ambassador.user_id;
  select whatsapp_number into v_ambassador_whatsapp from public.profiles where user_id = v_ambassador.user_id;

  if (p_signup_email is not null and lower(trim(p_signup_email)) = lower(trim(coalesce(v_ambassador_email, '__none__'))))
    or (v_norm_signup_whatsapp <> '' and v_norm_signup_whatsapp = regexp_replace(coalesce(v_ambassador_whatsapp, ''), '[^0-9]', '', 'g'))
  then
    perform public.ambassador_log_action(null, 'self_referral_rejected', 'signup_requests', p_signup_request_id, null, jsonb_build_object('ambassador_id', v_ambassador.id), 'signup email/whatsapp matched the ambassador''s own account');
    return jsonb_build_object('ok', false, 'reason', 'self_referral');
  end if;

  -- Team Leader self-referral: same check against the resolved team's leader.
  if v_ambassador.team_id is not null then
    select * into v_team from public.ambassador_teams where id = v_ambassador.team_id;
    if v_team.id is not null then
      select email into v_leader_email from auth.users where id = v_team.team_leader_user_id;
      select whatsapp_number into v_leader_whatsapp from public.profiles where user_id = v_team.team_leader_user_id;

      if (p_signup_email is not null and lower(trim(p_signup_email)) = lower(trim(coalesce(v_leader_email, '__none__'))))
        or (v_norm_signup_whatsapp <> '' and v_norm_signup_whatsapp = regexp_replace(coalesce(v_leader_whatsapp, ''), '[^0-9]', '', 'g'))
      then
        perform public.ambassador_log_action(null, 'team_leader_self_referral_rejected', 'signup_requests', p_signup_request_id, null, jsonb_build_object('ambassador_id', v_ambassador.id, 'team_id', v_team.id), 'signup email/whatsapp matched the team leader''s own account');
        return jsonb_build_object('ok', false, 'reason', 'team_leader_self_referral');
      end if;
    end if;
  end if;

  insert into public.ambassador_sales (
    signup_request_id, ambassador_id, team_id, card_type, selling_price, payment_reference, status, self_referral_checked
  ) values (
    p_signup_request_id, v_ambassador.id, v_ambassador.team_id, p_card_type, p_selling_price, p_payment_reference, 'attributed', true
  )
  on conflict (signup_request_id) do nothing
  returning id into v_sale_id;

  if v_sale_id is null then
    -- Already attributed (idempotent re-call, e.g. a retried request) — return the existing row.
    select id into v_sale_id from public.ambassador_sales where signup_request_id = p_signup_request_id;
    return jsonb_build_object('ok', true, 'sale_id', v_sale_id, 'already_existed', true);
  end if;

  return jsonb_build_object('ok', true, 'sale_id', v_sale_id);
end;
$$;

-- ============================================================================
-- 4. LOCK — called once the original signup_requests payment is
--    Fapshi-confirmed (the existing customer_paid atomic-claim event).
--    Idempotent: only ever transitions 'attributed' -> 'locked'; a second
--    call for an already-locked (or nonexistent) sale is a harmless no-op.
-- ============================================================================
create or replace function public.ambassador_lock_sale(p_signup_request_id uuid)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  update public.ambassador_sales
  set status = 'locked', locked_at = now()
  where signup_request_id = p_signup_request_id and status = 'attributed'
  returning jsonb_build_object('ok', true, 'sale_id', id);
$$;

-- ============================================================================
-- 5. RLS — read-only for the ambassador / their team leader / admin.
-- ============================================================================
alter table public.ambassador_sales enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ambassador_sales' and policyname = 'ambassador_sales own or admin read') then
    create policy "ambassador_sales own or admin read" on public.ambassador_sales for select using (
      exists (select 1 from public.ambassador_profiles p where p.id = ambassador_sales.ambassador_id and p.user_id = auth.uid())
      or exists (select 1 from public.ambassador_teams t where t.id = ambassador_sales.team_id and t.team_leader_user_id = auth.uid())
      or is_admin()
    );
  end if;
end $$;

-- ============================================================================
-- 6. FUNCTION PERMISSIONS — service-role only, same posture as every
--    other Ambassador/AI-subsystem RPC in this codebase.
-- ============================================================================
revoke all on function public.ambassador_attribute_sale(uuid, text, text, text, text, numeric, text) from public;
revoke all on function public.ambassador_lock_sale(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ambassador_attribute_sale(uuid, text, text, text, text, numeric, text) from anon';
    execute 'revoke all on function public.ambassador_lock_sale(uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.ambassador_attribute_sale(uuid, text, text, text, text, numeric, text) from authenticated';
    execute 'revoke all on function public.ambassador_lock_sale(uuid) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ambassador_attribute_sale(uuid, text, text, text, text, numeric, text) to service_role';
    execute 'grant execute on function public.ambassador_lock_sale(uuid) to service_role';
  end if;
end $$;
