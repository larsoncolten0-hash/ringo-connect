-- ============================================================================
-- ROLLBACK for supabase/migrations/2026-10-06c_security_definer_search_path.sql
-- (a) removes the pinned search_path from the 16 functions (bodies were never changed), and
-- (b) restores protect_affiliate_fields to its previous definition from 2026-09-09_affiliate_trigger_hardening.sql, INCLUDING
--     its fail-open `exception when others then null` handler. Only roll back (b) if the fail-closed version is proven to block a
--     legitimate flow.
-- ============================================================================
begin;
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('public.attribute_referral()'), ('public.checkin_ticket(uuid, text, text)'), ('public.handle_payment_transaction_commission()'),
      ('public.has_org_permission(uuid, text)'), ('public.is_admin()'), ('public.is_org_member(uuid)'), ('public.org_team_enabled(uuid)'),
      ('public.release_event_ticket_type(uuid, integer)'), ('public.request_affiliate_payout(text)'), ('public.request_commerce_payout()'),
      ('public.request_music_payout(text)'), ('public.reserve_event_ticket_type(uuid, integer)'), ('public.set_affiliate_code()'),
      ('public.set_digital_ticket_code()'), ('public.set_scanner_session_token()'), ('public.set_table_public_code()'),
      ('public.protect_affiliate_fields()')
    ) as t(sig)
  loop
    if to_regprocedure(r.sig) is not null then
      execute format('alter function %s reset search_path', r.sig);
    end if;
  end loop;
end $$;

create or replace function public.protect_affiliate_fields() returns trigger as $$
begin
  begin
    if auth.uid() is not null and not is_admin() then
      new.affiliate_code := old.affiliate_code;
      new.referred_by := old.referred_by;
      new.affiliate_suspended := old.affiliate_suspended;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$ language plpgsql security definer;
commit;
