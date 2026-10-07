-- ============================================================================
-- Ringo Connect - security (Phase 6): two simultaneous payout requests can both succeed against the same balance
--
-- REQUIRES OWNER APPROVAL AND MANUAL APPLICATION. Additive: two trigger functions and two BEFORE INSERT triggers. No function, policy, grant, column or row is
-- changed. Roll back with supabase/support/2026-10-07c_payout_request_concurrency_guard.rollback.sql and check it with
-- supabase/support/2026-10-07c_payout_request_concurrency_guard.verify.sql (read-only; it also lists any payout that has ALREADY been requested without
-- earnings behind it, which is how you would find a past occurrence).
--
-- THE PROBLEM (confirmed from the repository)
--   request_music_payout(text) and request_affiliate_payout(text) are SECURITY DEFINER functions the signed-in earner calls themselves (REST /rpc, or the
--   /api/music/payouts and /api/affiliate/payouts routes). Each one does, in this order, with NO lock:
--       1. SELECT sum(amount) of the caller's pending earnings                -> v_available
--       2. INSERT INTO <payouts> (amount = v_available, status = 'requested')
--       3. UPDATE <earnings> SET status = 'requested', payout_id = ... WHERE status = 'pending' AND payout_id IS NULL
--   Under READ COMMITTED two concurrent calls both run step 1 before either commits step 3, so both read the full balance. Both INSERT a payout for it.
--   The second UPDATE then finds the rows already 'requested' and updates nothing - but its payout row already exists, 'requested', for the full amount,
--   with no earnings attached. The route comments say two rapid clicks "can never both succeed"; that is only true of the shop version
--   (request_commerce_payout), which locks the rows first (2026-11-05_shop_payouts.sql explains exactly this race).
--   The admin send routes pay payout.amount as stored (Math.round(payout.amount) to Fapshi) and never compare it with the earnings linked to the payout, so
--   an unbacked payout is paid in full: N parallel requests = up to N times the real balance, withdrawn as real Mobile Money.
--
-- THE FIX - serialise per earner, then re-check the balance under the lock, inside the database
--   A BEFORE INSERT trigger on each payouts table, for a signed-in caller (auth.uid() is not null: the RPC runs as the caller; the service role has no user and is
--   unaffected, as in the Phase 2 / 3 guards):
--       a. takes pg_advisory_xact_lock for (program, earner) - a second request for the same earner waits here until the first transaction has committed;
--       b. recomputes the earner's pending, unlinked, matured earnings in the payout's currency with a fresh statement (so it sees the first request's committed
--          update) and refuses a 'requested' payout whose amount is larger.
--   The first request is unchanged (it sees its own full balance and proceeds). A second concurrent request now finds 0 available and fails with
--   payout_exceeds_available instead of creating an unbacked payout. Nothing else changes: an earner can still request a later payout when NEW earnings
--   mature, even while an older payout is still waiting for the admin. The RPC bodies are not redefined (their search_path pinning from 2026-10-06c stays).
-- ============================================================================

create or replace function public.music_payout_concurrency_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_available numeric;
begin
  if auth.uid() is null then return new; end if;                      -- the service role / direct database access: no end-user identity
  if new.status is distinct from 'requested' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('payout_request:music:' || new.artist_user_id::text, 0));
  select coalesce(sum(e.artist_amount), 0) into v_available
    from public.music_sale_earnings e
   where e.artist_user_id = new.artist_user_id and e.currency = new.currency and e.status = 'pending' and e.payout_id is null and e.available_at <= now();
  if new.amount > v_available then
    raise exception 'payout_exceeds_available' using errcode = '23514', detail = 'requested ' || new.amount || ' but only ' || v_available || ' is available';
  end if;
  return new;
end;
$$;

create or replace function public.affiliate_payout_concurrency_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_available numeric;
begin
  if auth.uid() is null then return new; end if;
  if new.status is distinct from 'requested' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('payout_request:affiliate:' || new.affiliate_user_id::text, 0));
  select coalesce(sum(c.amount), 0) into v_available
    from public.affiliate_commissions c
   where c.affiliate_user_id = new.affiliate_user_id and c.currency = new.currency and c.status = 'pending' and c.payout_id is null and c.available_at <= now();
  if new.amount > v_available then
    raise exception 'payout_exceeds_available' using errcode = '23514', detail = 'requested ' || new.amount || ' but only ' || v_available || ' is available';
  end if;
  return new;
end;
$$;

revoke all on function public.music_payout_concurrency_guard() from public, anon, authenticated, service_role;
revoke all on function public.affiliate_payout_concurrency_guard() from public, anon, authenticated, service_role;

drop trigger if exists music_payout_concurrency_guard_trg on public.music_payouts;
create trigger music_payout_concurrency_guard_trg before insert on public.music_payouts
  for each row execute function public.music_payout_concurrency_guard();
drop trigger if exists affiliate_payout_concurrency_guard_trg on public.affiliate_payouts;
create trigger affiliate_payout_concurrency_guard_trg before insert on public.affiliate_payouts
  for each row execute function public.affiliate_payout_concurrency_guard();

-- Postconditions (structure only: this migration writes to no live row, so there is nothing to undo).
do $$
declare
  v_bad text;
begin
  select string_agg(t.tgname, ', ') into v_bad
    from (values ('public.music_payouts'::regclass, 'music_payout_concurrency_guard_trg'),
                 ('public.affiliate_payouts'::regclass, 'affiliate_payout_concurrency_guard_trg')) t(rel, tgname)
   where not exists (select 1 from pg_trigger g where g.tgrelid = t.rel and g.tgname = t.tgname and g.tgenabled = 'O' and not g.tgisinternal);
  if v_bad is not null then
    raise exception 'postcondition failed: trigger missing or disabled: %', v_bad;
  end if;
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.pronamespace = 'public'::regnamespace and p.proname in ('music_payout_concurrency_guard', 'affiliate_payout_concurrency_guard')
     and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'));
  if v_bad is not null then
    raise exception 'postcondition failed: an API role can EXECUTE: %', v_bad;
  end if;
end $$;
