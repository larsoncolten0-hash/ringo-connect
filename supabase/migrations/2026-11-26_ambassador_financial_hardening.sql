-- Ringo Ambassador Program — financial hardening. NOT YET RUN.
--
-- Closes every race/integrity gap found in the pre-apply audit of
-- 2026-11-21/22. Because those migrations have not been applied, this file is
-- written to run AFTER them and simply replaces/extends their objects; nothing
-- here edits an earlier file.
--
-- WHAT CHANGES
--  1. ambassador_payouts gains a real disbursement state machine:
--       requested -> processing -> paid
--       processing -> reconciliation_required   (UNCERTAIN Fapshi outcome)
--       reconciliation_required -> paid  (Fapshi-confirmed / admin-confirmed with a transaction id)
--       processing / reconciliation_required -> requested (proven not sent / Fapshi FAILED)
--       requested -> rejected (management declines; commissions are released)
--     plus disbursement_key / attempts / claimed_at / uncertain_since, a UNIQUE
--     index on fapshi_trans_id (one Fapshi transaction can never be attached to
--     two payouts) and a UNIQUE index on disbursement_key.
--  2. ambassador_request_payout is replaced: it now reads the owner's private
--     destination itself (enforcing the 24h cooldown), verifies the caller holds
--     the role, and ENFORCES platform_settings.ambassador_min_payout_xaf in SQL.
--  3. ambassador_reverse_commission locks the ledger row FIRST and refuses a
--     commission that is paid-in-flight or attached to any active payout — the
--     "paid in place" race is closed.
--  4. ambassador_process_payout is strengthened: locks payout + linked rows,
--     verifies the rows still qualify and sum to the payout amount, and never
--     reports ok:true unless it really paid something.
--  5. New state-machine functions: claim / record accepted / release claim /
--     fail disbursement / mark uncertain / resolve uncertain / reject.
--  6. Triggers make the ledger and payouts tamper-resistant even against the
--     service role: paid ledger rows are fully immutable, core financial fields
--     never change, status transitions are whitelisted, and financial history
--     cannot be deleted.
--
-- LOCK ORDER (used by every function below, so none can deadlock):
--   payout row FIRST, then its ledger rows in id order. ambassador_reverse_commission
--   only ever holds ONE ledger row and merely READS the payout status (MVCC — no
--   lock), so it cannot form a cycle with the others.
--
-- IMPORTANT RULE: an UNCERTAIN disbursement never triggers another disbursement
-- and never releases its commission rows. The rows stay linked to the payout
-- (invisible to a new payout request) until a human/Fapshi-confirmed resolution.
--
-- Depends on: 2026-11-21, 2026-11-22, 2026-11-24, 2026-11-25.

-- ============================================================================
-- 1. PAYOUT STATE MACHINE COLUMNS + CONSTRAINTS
-- ============================================================================
alter table public.ambassador_payouts add column if not exists disbursement_key text;
alter table public.ambassador_payouts add column if not exists disbursement_attempts int not null default 0;
alter table public.ambassador_payouts add column if not exists claimed_at timestamptz;
alter table public.ambassador_payouts add column if not exists uncertain_since timestamptz;

alter table public.ambassador_payouts drop constraint if exists ambassador_payouts_status_check;
alter table public.ambassador_payouts
  add constraint ambassador_payouts_status_check
  check (status in ('requested', 'processing', 'reconciliation_required', 'paid', 'rejected'));

create unique index if not exists ambassador_payouts_fapshi_trans_unique_idx
  on public.ambassador_payouts (fapshi_trans_id) where fapshi_trans_id is not null;
create unique index if not exists ambassador_payouts_disbursement_key_unique_idx
  on public.ambassador_payouts (disbursement_key) where disbursement_key is not null;

-- ============================================================================
-- 2. TAMPER RESISTANCE
-- ============================================================================
create or replace function public.ambassador_ledger_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ambassador_commission_ledger rows are permanent financial records and cannot be deleted';
  end if;

  -- A paid row is fully immutable: amount, recipient, milestone, sale, paid
  -- state, payout association, paid timestamp — everything.
  if old.status = 'paid' and new is distinct from old then
    raise exception 'a paid ambassador_commission_ledger row is immutable (use ambassador_reverse_commission, which records a separate reversal entry)';
  end if;

  -- Core financial fields never change on ANY row.
  if new.sale_id is distinct from old.sale_id
     or new.recipient_type is distinct from old.recipient_type
     or new.recipient_user_id is distinct from old.recipient_user_id
     or new.milestone is distinct from old.milestone
     or new.entry_type is distinct from old.entry_type
     or new.percentage is distinct from old.percentage
     or new.base_amount is distinct from old.base_amount
     or new.commission_amount is distinct from old.commission_amount
     or new.currency is distinct from old.currency
     or new.source_event is distinct from old.source_event
     or new.reversed_ledger_id is distinct from old.reversed_ledger_id
     or new.created_at is distinct from old.created_at
     or new.earned_at is distinct from old.earned_at then
    raise exception 'core financial fields of an ambassador_commission_ledger row cannot be changed';
  end if;

  if new.status is distinct from old.status then
    if (old.status, new.status) not in (
      ('pending', 'earned'), ('pending', 'cancelled'),
      ('earned', 'eligible_for_payout'), ('earned', 'reversed'), ('earned', 'cancelled'),
      ('eligible_for_payout', 'paid'), ('eligible_for_payout', 'reversed')
    ) then
      raise exception 'illegal ambassador_commission_ledger status transition % -> %', old.status, new.status;
    end if;
    if new.status = 'paid' and (new.paid_at is null or new.payout_id is null) then
      raise exception 'a commission can only become paid with a paid_at and its payout';
    end if;
    -- A commission attached to a payout can never be reversed in place.
    if new.status = 'reversed' and old.payout_id is not null then
      raise exception 'a commission attached to a payout cannot be reversed in place';
    end if;
  end if;

  -- Payout association: set once from null; only an unpaid eligible row may be released; never re-pointed.
  if new.payout_id is distinct from old.payout_id then
    if old.payout_id is not null and new.payout_id is not null then
      raise exception 'a commission cannot be moved between payouts';
    end if;
    if old.payout_id is not null and new.payout_id is null and old.status <> 'eligible_for_payout' then
      raise exception 'only an unpaid eligible commission can be released from a payout';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists ambassador_ledger_guard_update on public.ambassador_commission_ledger;
create trigger ambassador_ledger_guard_update
  before update on public.ambassador_commission_ledger
  for each row execute function public.ambassador_ledger_guard();
drop trigger if exists ambassador_ledger_guard_delete on public.ambassador_commission_ledger;
create trigger ambassador_ledger_guard_delete
  before delete on public.ambassador_commission_ledger
  for each row execute function public.ambassador_ledger_guard();

create or replace function public.ambassador_payout_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ambassador_payouts rows are permanent financial records and cannot be deleted';
  end if;
  if old.status = 'paid' and new is distinct from old then
    raise exception 'a paid ambassador_payouts row is immutable';
  end if;
  if new.recipient_type is distinct from old.recipient_type
     or new.recipient_user_id is distinct from old.recipient_user_id
     or new.amount is distinct from old.amount
     or new.currency is distinct from old.currency
     or new.payout_method is distinct from old.payout_method
     or new.payout_details is distinct from old.payout_details
     or new.requested_at is distinct from old.requested_at then
    raise exception 'core fields of an ambassador_payouts row cannot be changed';
  end if;
  if new.status is distinct from old.status and (old.status, new.status) not in (
    ('requested', 'processing'), ('requested', 'rejected'),
    ('processing', 'requested'), ('processing', 'paid'), ('processing', 'reconciliation_required'),
    ('reconciliation_required', 'requested'), ('reconciliation_required', 'paid')
  ) then
    raise exception 'illegal ambassador_payouts status transition % -> %', old.status, new.status;
  end if;
  return new;
end;
$$;

drop trigger if exists ambassador_payout_guard_update on public.ambassador_payouts;
create trigger ambassador_payout_guard_update
  before update on public.ambassador_payouts
  for each row execute function public.ambassador_payout_guard();
drop trigger if exists ambassador_payout_guard_delete on public.ambassador_payouts;
create trigger ambassador_payout_guard_delete
  before delete on public.ambassador_payouts
  for each row execute function public.ambassador_payout_guard();

-- ============================================================================
-- 3. SHARED HELPERS
-- ============================================================================
-- Actor rule: an admin, or (only where a function says so) the system (null).
create or replace function public.ambassador_actor_is_admin(p_actor_user_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_actor_user_id is not null and exists (select 1 from public.users where id = p_actor_user_id and role = 'admin');
$$;

-- Locks EVERY ledger row linked to the payout (id order) and reports whether
-- they all still qualify and sum exactly to the payout amount.
create or replace function public.ambassador_payout_ledger_check(p_payout_id uuid, p_expected numeric)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int;
  v_sum numeric;
  v_ok boolean;
begin
  select count(*), coalesce(sum(commission_amount), 0), coalesce(bool_and(status = 'eligible_for_payout' and entry_type = 'commission'), false)
  into v_count, v_sum, v_ok
  from (
    select id, commission_amount, status, entry_type
    from public.ambassador_commission_ledger
    where payout_id = p_payout_id
    order by id
    for update
  ) l;
  return jsonb_build_object('ok', v_count > 0 and v_ok and v_sum = p_expected, 'count', v_count, 'sum', v_sum);
end;
$$;

-- ============================================================================
-- 4. REQUEST PAYOUT — replaces the 4-argument version. The destination comes
--    from the owner's PRIVATE row (never from the caller), the cooldown and
--    the minimum are enforced here, and the rows are locked-then-summed exactly
--    as before (payout_id is null + FOR UPDATE stops two requests claiming one row).
-- ============================================================================
drop function if exists public.ambassador_request_payout(text, uuid, text, jsonb);

create or replace function public.ambassador_request_payout(p_recipient_type text, p_recipient_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_dest record;
  v_min numeric;
  v_total numeric(12, 2);
  v_ledger_ids uuid[];
  v_payout_id uuid;
begin
  if p_recipient_type not in ('ambassador', 'team_leader') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_recipient');
  end if;
  if p_recipient_type = 'ambassador' then
    if not exists (select 1 from public.ambassador_profiles where user_id = p_recipient_user_id and status <> 'suspended') then
      return jsonb_build_object('ok', false, 'reason', 'not_a_recipient');
    end if;
  else
    if not exists (select 1 from public.ambassador_teams where team_leader_user_id = p_recipient_user_id) then
      return jsonb_build_object('ok', false, 'reason', 'not_a_recipient');
    end if;
  end if;

  -- Locks the destination row, so a concurrent change waits for this request.
  select * into v_dest from public.ambassador_payout_destinations
  where user_id = p_recipient_user_id and recipient_type = p_recipient_type
  for update;
  if v_dest.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_destination');
  end if;
  if v_dest.usable_after > now() then
    return jsonb_build_object('ok', false, 'reason', 'destination_cooling_down', 'usable_after', v_dest.usable_after);
  end if;

  with locked_rows as (
    select id, commission_amount
    from public.ambassador_commission_ledger
    where recipient_user_id = p_recipient_user_id
      and recipient_type = p_recipient_type
      and status = 'eligible_for_payout'
      and entry_type = 'commission'
      and payout_id is null
      and currency = 'XAF'
    for update
  )
  select coalesce(sum(commission_amount), 0), coalesce(array_agg(id), array[]::uuid[])
  into v_total, v_ledger_ids
  from locked_rows;

  if v_total <= 0 or array_length(v_ledger_ids, 1) is null then
    return jsonb_build_object('ok', false, 'reason', 'nothing_eligible');
  end if;

  select ambassador_min_payout_xaf into v_min from public.platform_settings limit 1;
  if v_min is null then
    -- Fail CLOSED: never pay out if the configured minimum cannot be read.
    return jsonb_build_object('ok', false, 'reason', 'settings_unavailable');
  end if;
  if v_total < v_min then
    return jsonb_build_object('ok', false, 'reason', 'below_minimum', 'minimum', v_min, 'available', v_total);
  end if;

  insert into public.ambassador_payouts (recipient_type, recipient_user_id, amount, currency, payout_method, payout_details)
  values (p_recipient_type, p_recipient_user_id, v_total, 'XAF', v_dest.method, v_dest.details)
  returning id into v_payout_id;

  update public.ambassador_commission_ledger set payout_id = v_payout_id where id = any(v_ledger_ids);

  return jsonb_build_object('ok', true, 'payout_id', v_payout_id, 'amount', v_total);
end;
$$;

-- ============================================================================
-- 5. PAYOUT STATE MACHINE FUNCTIONS
-- ============================================================================

-- requested -> processing. Exactly one caller can win; verifies the linked rows.
create or replace function public.ambassador_claim_payout(p_payout_id uuid, p_actor_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_p record;
  v_check jsonb;
  v_attempt int;
begin
  if not public.ambassador_actor_is_admin(p_actor_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_authorized');
  end if;
  select * into v_p from public.ambassador_payouts where id = p_payout_id for update;
  if v_p.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_p.status <> 'requested' then
    return jsonb_build_object('ok', false, 'reason', 'not_claimable', 'status', v_p.status);
  end if;
  v_check := public.ambassador_payout_ledger_check(p_payout_id, v_p.amount);
  if not (v_check->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'ledger_mismatch');
  end if;
  v_attempt := v_p.disbursement_attempts + 1;
  update public.ambassador_payouts
  set status = 'processing', claimed_at = now(), disbursement_attempts = v_attempt,
      disbursement_key = 'ambassador-payout-' || v_p.id::text || '-' || v_attempt::text, uncertain_since = null
  where id = p_payout_id;
  return jsonb_build_object('ok', true, 'disbursement_key', 'ambassador-payout-' || v_p.id::text || '-' || v_attempt::text, 'attempt', v_attempt);
end;
$$;

-- Fapshi ACCEPTED the disbursement and returned a transaction id.
create or replace function public.ambassador_record_disbursement_accepted(p_payout_id uuid, p_fapshi_trans_id text, p_actor_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_p record;
begin
  if not public.ambassador_actor_is_admin(p_actor_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_authorized');
  end if;
  if p_fapshi_trans_id is null or btrim(p_fapshi_trans_id) = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transaction_id');
  end if;
  select * into v_p from public.ambassador_payouts where id = p_payout_id for update;
  if v_p.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_p.status not in ('processing', 'reconciliation_required') or v_p.fapshi_trans_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_recordable', 'status', v_p.status);
  end if;
  begin
    update public.ambassador_payouts set fapshi_trans_id = btrim(p_fapshi_trans_id) where id = p_payout_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'transaction_id_in_use');
  end;
  return jsonb_build_object('ok', true);
end;
$$;

-- processing -> requested: Fapshi DEFINITIVELY rejected before executing anything
-- (or the request was provably never sent). Refuses if a transaction id exists.
create or replace function public.ambassador_release_payout_claim(p_payout_id uuid, p_actor_user_id uuid, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_p record;
begin
  if not public.ambassador_actor_is_admin(p_actor_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_authorized');
  end if;
  select * into v_p from public.ambassador_payouts where id = p_payout_id for update;
  if v_p.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_p.status <> 'processing' or v_p.fapshi_trans_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_releasable', 'status', v_p.status);
  end if;
  update public.ambassador_payouts set status = 'requested', claimed_at = null, admin_note = left(coalesce(p_reason, ''), 500) where id = p_payout_id;
  perform public.ambassador_log_action(p_actor_user_id, 'payout_claim_released', 'ambassador_payouts', p_payout_id, null, jsonb_build_object('attempt', v_p.disbursement_attempts), left(p_reason, 500));
  return jsonb_build_object('ok', true);
end;
$$;

-- processing/reconciliation_required -> requested: Fapshi ITSELF reported the
-- known transaction FAILED/EXPIRED. Actor null = the system reconciler.
create or replace function public.ambassador_fail_disbursement(p_payout_id uuid, p_actor_user_id uuid, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_p record;
begin
  if p_actor_user_id is not null and not public.ambassador_actor_is_admin(p_actor_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_authorized');
  end if;
  select * into v_p from public.ambassador_payouts where id = p_payout_id for update;
  if v_p.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_p.status not in ('processing', 'reconciliation_required') or v_p.fapshi_trans_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_failable', 'status', v_p.status);
  end if;
  update public.ambassador_payouts
  set status = 'requested', fapshi_trans_id = null, claimed_at = null, uncertain_since = null, admin_note = left(coalesce(p_reason, ''), 500)
  where id = p_payout_id;
  perform public.ambassador_log_action(p_actor_user_id, 'payout_disbursement_failed', 'ambassador_payouts', p_payout_id, null,
    jsonb_build_object('failed_fapshi_trans_id', v_p.fapshi_trans_id, 'attempt', v_p.disbursement_attempts), left(p_reason, 500));
  return jsonb_build_object('ok', true);
end;
$$;

-- processing -> reconciliation_required: outcome UNKNOWN. Rows stay linked.
create or replace function public.ambassador_mark_payout_uncertain(p_payout_id uuid, p_actor_user_id uuid, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_p record;
begin
  if p_actor_user_id is not null and not public.ambassador_actor_is_admin(p_actor_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_authorized');
  end if;
  select * into v_p from public.ambassador_payouts where id = p_payout_id for update;
  if v_p.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_p.status <> 'processing' then
    return jsonb_build_object('ok', false, 'reason', 'not_markable', 'status', v_p.status);
  end if;
  update public.ambassador_payouts
  set status = 'reconciliation_required', uncertain_since = now(), admin_note = left(coalesce(p_reason, ''), 500)
  where id = p_payout_id;
  perform public.ambassador_log_action(p_actor_user_id, 'payout_disbursement_uncertain', 'ambassador_payouts', p_payout_id, null,
    jsonb_build_object('attempt', v_p.disbursement_attempts, 'had_transaction_id', v_p.fapshi_trans_id is not null), left(p_reason, 500));
  return jsonb_build_object('ok', true);
end;
$$;

-- processing -> paid. Strengthened: locks payout + rows, verifies everything,
-- and only reports ok:true when it really paid.
create or replace function public.ambassador_process_payout(p_payout_id uuid, p_fapshi_trans_id text, p_actor_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_p record;
  v_check jsonb;
  v_updated int;
  v_trans text;
begin
  select * into v_p from public.ambassador_payouts where id = p_payout_id for update;
  if v_p.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  -- Authorization: an admin, OR the system finalizing a transaction that Fapshi
  -- itself confirmed (the id passed must equal the one stored on the payout).
  if not public.ambassador_actor_is_admin(p_actor_user_id) then
    if not (p_actor_user_id is null and p_fapshi_trans_id is not null and v_p.fapshi_trans_id = p_fapshi_trans_id) then
      return jsonb_build_object('ok', false, 'reason', 'not_authorized');
    end if;
  end if;

  if v_p.status = 'paid' then return jsonb_build_object('ok', false, 'reason', 'already_paid'); end if;
  if v_p.status not in ('processing', 'reconciliation_required') then
    return jsonb_build_object('ok', false, 'reason', 'not_processable', 'status', v_p.status);
  end if;
  if p_fapshi_trans_id is not null and v_p.fapshi_trans_id is not null and v_p.fapshi_trans_id <> p_fapshi_trans_id then
    return jsonb_build_object('ok', false, 'reason', 'transaction_mismatch');
  end if;
  -- An uncertain payout may only be finalized against a known transaction id.
  if v_p.status = 'reconciliation_required' and coalesce(v_p.fapshi_trans_id, nullif(btrim(coalesce(p_fapshi_trans_id, '')), '')) is null then
    return jsonb_build_object('ok', false, 'reason', 'transaction_id_required');
  end if;

  v_check := public.ambassador_payout_ledger_check(p_payout_id, v_p.amount);
  if not (v_check->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'ledger_mismatch');
  end if;

  update public.ambassador_commission_ledger
  set status = 'paid', paid_at = now()
  where payout_id = p_payout_id and status = 'eligible_for_payout' and entry_type = 'commission';
  get diagnostics v_updated = row_count;
  if v_updated <> (v_check->>'count')::int then
    raise exception 'ambassador_process_payout: paid % rows but expected %', v_updated, v_check->>'count';
  end if;

  v_trans := coalesce(v_p.fapshi_trans_id, nullif(btrim(coalesce(p_fapshi_trans_id, '')), ''));
  begin
    update public.ambassador_payouts
    set status = 'paid', fapshi_trans_id = v_trans, processed_at = now(), processed_by = p_actor_user_id, uncertain_since = null
    where id = p_payout_id;
  exception when unique_violation then
    raise exception 'ambassador_process_payout: transaction id already attached to another payout';
  end;
  return jsonb_build_object('ok', true, 'payout_id', p_payout_id);
end;
$$;

-- reconciliation_required -> requested ('not_sent') or -> paid ('sent'). An
-- admin decision that REQUIRES a note (and, for 'sent', the Fapshi transaction id).
create or replace function public.ambassador_resolve_uncertain_payout(p_payout_id uuid, p_actor_user_id uuid, p_outcome text, p_fapshi_trans_id text, p_note text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_p record;
  v_result jsonb;
begin
  if not public.ambassador_actor_is_admin(p_actor_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_authorized');
  end if;
  if p_outcome not in ('sent', 'not_sent') or p_note is null or char_length(btrim(p_note)) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;
  select * into v_p from public.ambassador_payouts where id = p_payout_id for update;
  if v_p.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_p.status <> 'reconciliation_required' then
    return jsonb_build_object('ok', false, 'reason', 'not_reconcilable', 'status', v_p.status);
  end if;

  if p_outcome = 'not_sent' then
    if v_p.fapshi_trans_id is not null then
      -- A known transaction id exists: only Fapshi's own FAILED/EXPIRED status
      -- (ambassador_fail_disbursement) may return this payout to requested.
      return jsonb_build_object('ok', false, 'reason', 'has_transaction');
    end if;
    update public.ambassador_payouts set status = 'requested', claimed_at = null, uncertain_since = null, admin_note = left(btrim(p_note), 500) where id = p_payout_id;
    perform public.ambassador_log_action(p_actor_user_id, 'payout_uncertain_resolved_not_sent', 'ambassador_payouts', p_payout_id, null, jsonb_build_object('attempt', v_p.disbursement_attempts), left(btrim(p_note), 500));
    return jsonb_build_object('ok', true, 'outcome', 'not_sent');
  end if;

  -- 'sent': the admin confirmed the disbursement in Fapshi; the transaction id is mandatory.
  if coalesce(nullif(btrim(coalesce(p_fapshi_trans_id, '')), ''), v_p.fapshi_trans_id) is null then
    return jsonb_build_object('ok', false, 'reason', 'transaction_id_required');
  end if;
  v_result := public.ambassador_process_payout(p_payout_id, coalesce(nullif(btrim(coalesce(p_fapshi_trans_id, '')), ''), v_p.fapshi_trans_id), p_actor_user_id);
  if not (v_result->>'ok')::boolean then
    return v_result;
  end if;
  perform public.ambassador_log_action(p_actor_user_id, 'payout_uncertain_resolved_sent', 'ambassador_payouts', p_payout_id, null, jsonb_build_object('attempt', v_p.disbursement_attempts), left(btrim(p_note), 500));
  return jsonb_build_object('ok', true, 'outcome', 'sent');
end;
$$;

-- requested -> rejected: Management declines; commissions return to the
-- ordinary eligible balance (payout_id cleared, status unchanged).
create or replace function public.ambassador_reject_payout(p_payout_id uuid, p_actor_user_id uuid, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_p record;
  v_released int;
begin
  if not public.ambassador_actor_is_admin(p_actor_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_authorized');
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;
  select * into v_p from public.ambassador_payouts where id = p_payout_id for update;
  if v_p.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_p.status <> 'requested' or v_p.fapshi_trans_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_rejectable', 'status', v_p.status);
  end if;
  perform 1 from public.ambassador_commission_ledger where payout_id = p_payout_id order by id for update;
  update public.ambassador_commission_ledger set payout_id = null where payout_id = p_payout_id and status = 'eligible_for_payout';
  get diagnostics v_released = row_count;
  update public.ambassador_payouts
  set status = 'rejected', processed_at = now(), processed_by = p_actor_user_id, admin_note = left(btrim(p_reason), 500)
  where id = p_payout_id;
  perform public.ambassador_log_action(p_actor_user_id, 'payout_rejected', 'ambassador_payouts', p_payout_id, null, jsonb_build_object('released_rows', v_released), left(btrim(p_reason), 500));
  return jsonb_build_object('ok', true, 'released', v_released);
end;
$$;

-- ============================================================================
-- 6. REVERSAL — locks the ledger row FIRST, then decides.
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
  if not public.ambassador_actor_is_admin(p_actor_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_authorized');
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_reason');
  end if;

  -- The lock is taken BEFORE any state is inspected. A concurrent payout
  -- request / process either finished first (we then see its result) or waits
  -- for us and re-evaluates against our result.
  select * into v_row from public.ambassador_commission_ledger where id = p_ledger_id and entry_type = 'commission' for update;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select id into v_existing_reversal_id from public.ambassador_commission_ledger where reversed_ledger_id = p_ledger_id and entry_type = 'reversal';
  if v_existing_reversal_id is not null then
    return jsonb_build_object('ok', true, 'already_reversed', true, 'recovery_ledger_id', v_existing_reversal_id);
  end if;
  if v_row.status in ('reversed', 'cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'already_reversed');
  end if;

  -- An unpaid commission attached to a payout is part of that payout's amount
  -- (requested / processing / reconciliation_required): never reversible here.
  if v_row.status <> 'paid' and v_row.payout_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'payout_in_progress');
  end if;

  if v_row.status = 'paid' then
    -- Never mutate the paid row: record a separate, negative recovery entry.
    insert into public.ambassador_commission_ledger (
      sale_id, recipient_type, recipient_user_id, milestone, entry_type, percentage, base_amount, commission_amount,
      currency, status, source_event, reversed_ledger_id, reversal_reason, reversed_at
    ) values (
      v_row.sale_id, v_row.recipient_type, v_row.recipient_user_id, v_row.milestone, 'reversal', v_row.percentage, v_row.base_amount,
      -v_row.commission_amount, v_row.currency, 'reversed', 'refund_reversal', v_row.id, btrim(p_reason), now()
    )
    on conflict (reversed_ledger_id) where entry_type = 'reversal' do nothing
    returning id into v_recovery_id;
    if v_recovery_id is null then
      select id into v_recovery_id from public.ambassador_commission_ledger where reversed_ledger_id = p_ledger_id and entry_type = 'reversal';
    end if;
  else
    update public.ambassador_commission_ledger
    set status = 'reversed', reversed_at = now(), reversal_reason = btrim(p_reason)
    where id = p_ledger_id;
  end if;

  perform public.ambassador_log_action(p_actor_user_id, 'commission_reversed', 'ambassador_commission_ledger', p_ledger_id, to_jsonb(v_row), jsonb_build_object('recovery_ledger_id', v_recovery_id), btrim(p_reason));
  return jsonb_build_object('ok', true, 'ledger_id', p_ledger_id, 'recovery_ledger_id', v_recovery_id);
end;
$$;

-- ============================================================================
-- 7. FUNCTION PERMISSIONS — service-role only.
-- ============================================================================
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.ambassador_ledger_guard()',
    'public.ambassador_payout_guard()',
    'public.ambassador_actor_is_admin(uuid)',
    'public.ambassador_payout_ledger_check(uuid, numeric)',
    'public.ambassador_request_payout(text, uuid)',
    'public.ambassador_claim_payout(uuid, uuid)',
    'public.ambassador_record_disbursement_accepted(uuid, text, uuid)',
    'public.ambassador_release_payout_claim(uuid, uuid, text)',
    'public.ambassador_fail_disbursement(uuid, uuid, text)',
    'public.ambassador_mark_payout_uncertain(uuid, uuid, text)',
    'public.ambassador_process_payout(uuid, text, uuid)',
    'public.ambassador_resolve_uncertain_payout(uuid, uuid, text, text, text)',
    'public.ambassador_reject_payout(uuid, uuid, text)',
    'public.ambassador_reverse_commission(uuid, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;
