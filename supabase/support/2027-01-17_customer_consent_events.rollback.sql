-- ROLLBACK for 2027-01-17_customer_consent_events.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Removes exactly what that migration created: public.customer_consent_events (its indexes and triggers go with it) and the three functions customer_consent_set(), customer_consent_events_immutable() and customer_consent_events_no_truncate().
-- It touches no existing table, row or policy. customer_connections.marketing_consent and marketing_consent_at keep whatever value they hold now (a withdrawal already cleared them; a grant already set them).
--
-- DATA SAFETY: the ledger is the record of who agreed to what and when. This file REFUSES to run while any row exists. To drop it anyway, export what you need and then confirm the loss explicitly by
-- adding this line as the FIRST statement inside the transaction (same script, same transaction):
--     select set_config('customer_consent_events.allow_data_loss', 'yes', true);
-- Dropping a table is irreversible. Safe to re-run: every drop is "if exists".
begin;

set local lock_timeout = '5s';

do $$
declare
  v_marker constant text := 'managed by 2027-01-17_customer_consent_events.sql';
  v_bad text;
  v_rows bigint := 0;
begin
  if to_regclass('public.customer_consent_events') is not null and coalesce(obj_description(to_regclass('public.customer_consent_events'), 'pg_class'), '') <> v_marker then
    raise exception 'rollback refused: public.customer_consent_events exists but is not managed by this migration';
  end if;
  if to_regclass('public.customer_consent_events') is not null then
    select count(*) into v_rows from public.customer_consent_events;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('customer_consent_set', 'customer_consent_events_immutable', 'customer_consent_events_no_truncate') and coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker;
  if v_bad is not null then raise exception 'rollback refused: function(s) % exist but are not managed by this migration', v_bad; end if;

  if v_rows > 0 and coalesce(current_setting('customer_consent_events.allow_data_loss', true), '') <> 'yes' then
    raise exception 'rollback refused: the ledger holds % row(s). Export what you need, then confirm the loss with: select set_config(''customer_consent_events.allow_data_loss'', ''yes'', true);', v_rows;
  end if;

  perform set_config('customer_consent_events.pre', jsonb_build_object(
    'connections', (select count(*) from public.customer_connections),
    'consenting',  (select count(*) from public.customer_connections where marketing_consent)
  )::text, true);
end $$;

drop table if exists public.customer_consent_events;
drop function if exists public.customer_consent_set(uuid, uuid, text, text, text);
drop function if exists public.customer_consent_events_immutable();
drop function if exists public.customer_consent_events_no_truncate();

do $$
declare
  v_pre jsonb := current_setting('customer_consent_events.pre')::jsonb;
begin
  if to_regclass('public.customer_consent_events') is not null then raise exception 'rollback failed: the table is still there'; end if;
  if to_regprocedure('public.customer_consent_set(uuid, uuid, text, text, text)') is not null then raise exception 'rollback failed: the writer is still there'; end if;
  if (select count(*) from public.customer_connections) <> (v_pre->>'connections')::bigint or (select count(*) from public.customer_connections where marketing_consent) <> (v_pre->>'consenting')::bigint then
    raise exception 'rollback failed: existing connections changed';
  end if;
end $$;

commit;
