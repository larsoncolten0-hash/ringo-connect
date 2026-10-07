-- READ-ONLY check for 2026-10-07c_payout_request_concurrency_guard.sql. One SELECT; changes nothing.
-- P1..P4: the guard is installed and no API role can execute it (all should say PASS).
-- D1..D4 (INFO): payouts that were requested WITHOUT earnings behind them, i.e. a past occurrence of the race. For each payout still in
--   requested / processing / paid, compare its amount with the earnings linked to it (payout_id). "unbacked" = rows where the linked earnings are LESS
--   than the payout amount; "excess" = the total over-payment candidate. Both should be 0. A non-zero count is not proof of fraud (look at the payout in the admin
--   screen, and at whether its twin was paid), but it is exactly the footprint of the race and worth checking before any further payout is sent.
with g as (
  select 'music_payout_concurrency_guard_trg' trg, 'public.music_payouts'::regclass rel
  union all select 'affiliate_payout_concurrency_guard_trg', 'public.affiliate_payouts'::regclass
),
music as (
  select p.id, p.amount, coalesce((select sum(e.artist_amount) from public.music_sale_earnings e where e.payout_id = p.id), 0) backed
    from public.music_payouts p where p.status in ('requested', 'processing', 'paid')
),
aff as (
  select p.id, p.amount, coalesce((select sum(c.amount) from public.affiliate_commissions c where c.payout_id = p.id), 0) backed
    from public.affiliate_payouts p where p.status in ('requested', 'paid')
)
select 'P1' grp, g.trg item, case when exists (select 1 from pg_trigger t where t.tgrelid = g.rel and t.tgname = g.trg and t.tgenabled = 'O' and not t.tgisinternal) then 'present+enabled' else 'MISSING' end value,
       case when exists (select 1 from pg_trigger t where t.tgrelid = g.rel and t.tgname = g.trg and t.tgenabled = 'O' and not t.tgisinternal) then 'PASS' else 'FAIL' end status
  from g
union all
select 'P2', 'both guard functions have a pinned search_path',
       (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('music_payout_concurrency_guard', 'affiliate_payout_concurrency_guard') and p.proconfig::text like '%search_path%') || ' of 2',
       case when (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('music_payout_concurrency_guard', 'affiliate_payout_concurrency_guard') and p.proconfig::text like '%search_path%') = 2 then 'PASS' else 'FAIL' end
union all
select 'P3', 'no API role can EXECUTE the guard functions',
       coalesce((select string_agg(distinct p.proname, ',')
                   from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where p.pronamespace = 'public'::regnamespace and p.proname in ('music_payout_concurrency_guard', 'affiliate_payout_concurrency_guard') and a.privilege_type = 'EXECUTE'
                    and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))), 'none'),
       case when exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                          where p.pronamespace = 'public'::regnamespace and p.proname in ('music_payout_concurrency_guard', 'affiliate_payout_concurrency_guard') and a.privilege_type = 'EXECUTE'
                            and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))) then 'FAIL' else 'PASS' end
union all
select 'D1', 'music payouts whose linked earnings are less than the amount (unbacked)', (select count(*)::text from music where backed < amount), 'INFO'
union all
select 'D2', 'music: total amount without earnings behind it', (select coalesce(sum(amount - backed), 0)::text from music where backed < amount), 'INFO'
union all
select 'D3', 'affiliate payouts whose linked commissions are less than the amount (unbacked)', (select count(*)::text from aff where backed < amount), 'INFO'
union all
select 'D4', 'affiliate: total amount without commissions behind it', (select coalesce(sum(amount - backed), 0)::text from aff where backed < amount), 'INFO'
order by 1, 2;
