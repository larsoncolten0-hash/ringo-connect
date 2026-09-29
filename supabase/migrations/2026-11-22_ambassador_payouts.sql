-- Ringo Ambassador Program — payouts, eligibility, and reversal. NOT YET RUN.
--
-- Purely additive. Dedicated payout-destination data per the approved
-- decision: this table (and ambassador_profiles.payout_method/details)
-- are the ONLY place Ambassador/Team-Leader payout destinations live —
-- users.affiliate_payout_method/affiliate_payout_details (legacy
-- affiliate program) are never read or written by anything in this
-- migration or any other Ambassador file. Only the underlying Fapshi
-- disbursement *credentials* (platform_settings.fapshi_payout_*_encrypted)
-- are shared infrastructure — genuinely just API credentials, not a
-- financial record.

-- ============================================================================
-- 1. PAYOUTS
-- ============================================================================
create table if not exists public.ambassador_payouts (
  id uuid primary key default gen_random_uuid(),
  recipient_type text not null check (recipient_type in ('ambassador', 'team_leader')),
  recipient_user_id uuid not null references public.users(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'XAF',
  status text not null default 'requested' check (status in ('requested', 'processing', 'paid', 'rejected')),
  payout_method text not null check (payout_method in ('mobile_money', 'bank')),
  payout_details jsonb not null,
  fapshi_trans_id text,
  admin_note text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references public.users(id) on delete set null
);
create index if not exists ambassador_payouts_recipient_idx on public.ambassador_payouts (recipient_user_id, status);

alter table public.ambassador_payouts enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ambassador_payouts' and policyname = 'ambassador_payouts own or admin read') then
    -- Deliberately NOT opened to team leaders (unlike the ledger's broader
    -- team-visibility) — individual payout destination/amount detail is
    -- kept tighter than the aggregate commission view they get elsewhere.
    create policy "ambassador_payouts own or admin read" on public.ambassador_payouts for select using (
      recipient_user_id = auth.uid() or is_admin()
    );
  end if;
end $$;

alter table public.ambassador_commission_ledger
  add constraint ambassador_commission_ledger_payout_id_fkey
  foreign key (payout_id) references public.ambassador_payouts(id) on delete set null;

-- ============================================================================
-- 2. MARK ELIGIBLE — a deliberate management action, never automatic
--    (per the approved "no hold period" decision — 'earned' does not
--    become 'eligible_for_payout' on any timer).
-- ============================================================================
create or replace function public.ambassador_mark_commission_eligible(p_ledger_ids uuid[], p_actor_user_id uuid)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  update public.ambassador_commission_ledger
  set status = 'eligible_for_payout', eligible_at = now()
  where id = any(p_ledger_ids) and status = 'earned' and entry_type = 'commission';
  get diagnostics v_count = row_count;

  if v_count > 0 then
    perform public.ambassador_log_action(p_actor_user_id, 'commissions_marked_eligible', 'ambassador_commission_ledger', null, null, jsonb_build_object('ledger_ids', p_ledger_ids), null);
  end if;

  return v_count;
end;
$$;

-- ============================================================================
-- 3. REQUEST PAYOUT — atomic lock-and-sum.
--
--    Postgres rejects `SELECT sum(...) ... FOR UPDATE` outright (FOR
--    UPDATE cannot be combined directly with an aggregate function in the
--    same query) — so this locks the individual eligible rows FIRST in a
--    CTE (a plain row-selecting query, no aggregate), then aggregates
--    over the already-locked set in the outer query. This is the
--    standard, safe "lock then aggregate" pattern, and it's what makes
--    steps 1-6 below all happen atomically inside one function call.
--
--    `payout_id is null` in the lock predicate — not just FOR UPDATE — is
--    what prevents two concurrent requests from claiming the same rows
--    (point 7): a second concurrent call blocks on the row lock, and once
--    unblocked (after the first call's transaction commits), Postgres
--    re-checks this predicate against the now-committed row versions —
--    rows the first call already claimed (payout_id now set) are
--    excluded from the second call's result entirely, so the same
--    commission can never end up attached to two payouts.
--
--    entry_type = 'commission' (point 8) means a reversal row can never
--    be locked or paid out here; status = 'eligible_for_payout' (point 9)
--    means only rows Management has explicitly marked eligible — never
--    a bare 'earned' row — can ever reach a payout.
-- ============================================================================
create or replace function public.ambassador_request_payout(
  p_recipient_type text,
  p_recipient_user_id uuid,
  p_payout_method text,
  p_payout_details jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_total numeric(12, 2);
  v_ledger_ids uuid[];
  v_payout_id uuid;
begin
  -- 1 & 2: select and lock the individual eligible rows.
  with locked_rows as (
    select id, commission_amount
    from public.ambassador_commission_ledger
    where recipient_user_id = p_recipient_user_id
      and recipient_type = p_recipient_type
      and status = 'eligible_for_payout'
      and entry_type = 'commission'
      and payout_id is null
    for update
  )
  -- 3: calculate the total (and collect the exact row ids) from the locked set.
  select coalesce(sum(commission_amount), 0), coalesce(array_agg(id), array[]::uuid[])
  into v_total, v_ledger_ids
  from locked_rows;

  if v_total <= 0 or array_length(v_ledger_ids, 1) is null then
    return jsonb_build_object('ok', false, 'reason', 'nothing_eligible');
  end if;

  -- 4: create exactly one payout record.
  insert into public.ambassador_payouts (recipient_type, recipient_user_id, amount, payout_method, payout_details)
  values (p_recipient_type, p_recipient_user_id, v_total, p_payout_method, p_payout_details)
  returning id into v_payout_id;

  -- 5: associate EXACTLY the locked rows — by their captured ids, never
  -- by re-filtering on status/eligibility again, so nothing that became
  -- eligible in between locking and this update can be swept in by accident.
  update public.ambassador_commission_ledger
  set payout_id = v_payout_id
  where id = any(v_ledger_ids);

  return jsonb_build_object('ok', true, 'payout_id', v_payout_id, 'amount', v_total);
end;
$$;

-- ============================================================================
-- 4. PROCESS PAYOUT — marks a payout (and its linked ledger rows) paid,
--    only after real disbursement has actually happened — called from the
--    server route once Fapshi confirms, never on the admin's click alone.
-- ============================================================================
create or replace function public.ambassador_process_payout(p_payout_id uuid, p_fapshi_trans_id text, p_actor_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.ambassador_payouts
  set status = 'paid', fapshi_trans_id = p_fapshi_trans_id, processed_at = now(), processed_by = p_actor_user_id
  where id = p_payout_id and status in ('requested', 'processing');

  update public.ambassador_commission_ledger
  set status = 'paid', paid_at = now()
  where payout_id = p_payout_id and status = 'eligible_for_payout';

  return jsonb_build_object('ok', true, 'payout_id', p_payout_id);
end;
$$;

-- ============================================================================
-- 5. REVERSAL — never mutates an already-paid row, ever, under any
--    circumstance: a 'paid' original's status/amount/timestamps stay
--    exactly as they were forever. Instead, a NEW entry_type='reversal'
--    row is inserted with a NEGATIVE commission_amount, the SAME sale_id/
--    recipient_type/milestone as the original (full traceability — see
--    the ledger table's own header comment), and reversed_ledger_id
--    pointing back at it. An 'earned'/'eligible_for_payout' (not yet
--    paid) row still transitions status -> 'reversed' IN PLACE, since no
--    cash ever moved for it — there is nothing to "recover," so no
--    separate accounting entry is needed for that case.
--
--    Idempotent two ways: an application-level pre-check (fast path, a
--    clear "already_reversed" response) AND the DB-enforced partial
--    unique index on (reversed_ledger_id) where entry_type='reversal' —
--    a concurrently-replayed reversal request for the same row can never
--    insert a second recovery row, full stop, even under a race.
-- ============================================================================
create or replace function public.ambassador_reverse_commission(p_ledger_id uuid, p_actor_user_id uuid, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row record;
  v_existing_reversal_id uuid;
  v_recovery_id uuid;
begin
  select * into v_row from public.ambassador_commission_ledger where id = p_ledger_id and entry_type = 'commission';
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select id into v_existing_reversal_id
  from public.ambassador_commission_ledger
  where reversed_ledger_id = p_ledger_id and entry_type = 'reversal';
  if v_existing_reversal_id is not null then
    return jsonb_build_object('ok', true, 'already_reversed', true, 'recovery_ledger_id', v_existing_reversal_id);
  end if;
  if v_row.status = 'reversed' or v_row.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'reason', 'already_reversed');
  end if;

  if v_row.status = 'paid' then
    insert into public.ambassador_commission_ledger (
      sale_id, recipient_type, recipient_user_id, milestone, entry_type, percentage, base_amount, commission_amount,
      currency, status, source_event, reversed_ledger_id, reversal_reason, reversed_at
    ) values (
      v_row.sale_id, v_row.recipient_type, v_row.recipient_user_id, v_row.milestone, 'reversal', v_row.percentage, v_row.base_amount,
      -v_row.commission_amount, v_row.currency, 'reversed', 'refund_reversal', v_row.id, p_reason, now()
    )
    on conflict (reversed_ledger_id) where entry_type = 'reversal' do nothing
    returning id into v_recovery_id;

    if v_recovery_id is null then
      -- Lost a race with a concurrently-replayed reversal for the same
      -- row — the unique index blocked our insert; return the winner's.
      select id into v_recovery_id from public.ambassador_commission_ledger where reversed_ledger_id = p_ledger_id and entry_type = 'reversal';
    end if;
  else
    -- Not yet paid — nothing was disbursed, so the original row itself
    -- transitions to 'reversed'. It stays entry_type='commission'
    -- (it still IS the original commission event, just void) and no
    -- separate reversal row is created.
    update public.ambassador_commission_ledger
    set status = 'reversed', reversed_at = now(), reversal_reason = p_reason
    where id = p_ledger_id and status <> 'reversed';
  end if;

  perform public.ambassador_log_action(p_actor_user_id, 'commission_reversed', 'ambassador_commission_ledger', p_ledger_id, to_jsonb(v_row), jsonb_build_object('recovery_ledger_id', v_recovery_id), p_reason);

  return jsonb_build_object('ok', true, 'ledger_id', p_ledger_id, 'recovery_ledger_id', v_recovery_id);
end;
$$;

-- ============================================================================
-- 6. FUNCTION PERMISSIONS — service-role only.
-- ============================================================================
revoke all on function public.ambassador_mark_commission_eligible(uuid[], uuid) from public;
revoke all on function public.ambassador_request_payout(text, uuid, text, jsonb) from public;
revoke all on function public.ambassador_process_payout(uuid, text, uuid) from public;
revoke all on function public.ambassador_reverse_commission(uuid, uuid, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ambassador_mark_commission_eligible(uuid[], uuid) from anon';
    execute 'revoke all on function public.ambassador_request_payout(text, uuid, text, jsonb) from anon';
    execute 'revoke all on function public.ambassador_process_payout(uuid, text, uuid) from anon';
    execute 'revoke all on function public.ambassador_reverse_commission(uuid, uuid, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.ambassador_mark_commission_eligible(uuid[], uuid) from authenticated';
    execute 'revoke all on function public.ambassador_request_payout(text, uuid, text, jsonb) from authenticated';
    execute 'revoke all on function public.ambassador_process_payout(uuid, text, uuid) from authenticated';
    execute 'revoke all on function public.ambassador_reverse_commission(uuid, uuid, text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ambassador_mark_commission_eligible(uuid[], uuid) to service_role';
    execute 'grant execute on function public.ambassador_request_payout(text, uuid, text, jsonb) to service_role';
    execute 'grant execute on function public.ambassador_process_payout(uuid, text, uuid) to service_role';
    execute 'grant execute on function public.ambassador_reverse_commission(uuid, uuid, text) to service_role';
  end if;
end $$;
