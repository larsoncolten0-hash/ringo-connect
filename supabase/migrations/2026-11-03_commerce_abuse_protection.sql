-- ============================================================================
-- Commerce abuse protection (rate limiting) for the product checkout lane.
--
-- *** DRAFT — FOR REVIEW — NOT EXECUTED. Do not run until approved. ***
--
-- WHY: orders and payment prompts can currently only be limited per contact number (3 open orders) and
-- per order (5 attempts). Both are sidestepped by rotating numbers, which allows (a) reserving all
-- finite stock over and over and (b) firing mobile-money prompts at strangers' phones. This adds a
-- small counter the server consults before creating an order or starting a payment.
--
-- PRIVACY: the table never stores an IP address or a phone number. The server sends only a keyed
-- HMAC-SHA256 (hex, 64 chars) of the subject, keyed from a server-side secret, so a leaked table cannot
-- be reversed to an IP or number. Rows are pruned automatically after 2 days.
--
-- PURELY ADDITIVE: one new table and one new function. No existing table, column, row, trigger,
-- function or policy is touched. Deleting this feature (see ROLLBACK) leaves no trace on anything that
-- existed before it. Until it is applied the application fails OPEN (limits not enforced, the failure
-- is logged) and checkout behaves exactly as it did.
--
-- Rules live in the application (src/lib/productCheckout/constants.ts RATE_RULES) and are passed in per
-- call, so changing a limit needs no SQL. Current values: order_ip 10 / 10 min, pay_ip 10 / 10 min,
-- pay_phone 3 / 10 min, pay_phone_day 10 / 24 h.
-- ============================================================================

begin;

create table if not exists commerce_rate_events (
  id bigserial primary key,
  kind text not null check (kind in ('order_ip', 'pay_ip', 'pay_phone', 'pay_phone_day')),
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),   -- keyed HMAC, never a raw value
  created_at timestamptz not null default now()
);
create index if not exists commerce_rate_events_lookup_idx on commerce_rate_events (kind, subject_hash, created_at desc);
create index if not exists commerce_rate_events_created_idx on commerce_rate_events (created_at);

-- Server-only, like customer_payments: RLS on, no policy, no client grant.
alter table commerce_rate_events enable row level security;
revoke all on commerce_rate_events from anon, authenticated;
grant select, insert, delete on commerce_rate_events to service_role;
grant usage, select on sequence commerce_rate_events_id_seq to service_role;

-- ----------------------------------------------------------------------------
-- commerce_rate_limit_hit(kind, subject_hash, window_seconds, max)
--   true  -> under the limit; the event was recorded (the caller may proceed)
--   false -> at or over the limit; NOTHING was recorded (so a blocked caller cannot extend their own block)
-- Count + insert run under a per-(kind, subject) advisory lock, so concurrent requests cannot slip past
-- the limit together. security definer + fixed search_path; executable by the service role only.
-- ----------------------------------------------------------------------------
create or replace function commerce_rate_limit_hit(
  p_kind text, p_subject_hash text, p_window_seconds int, p_max int)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count int;
begin
  if p_kind is null or p_kind not in ('order_ip', 'pay_ip', 'pay_phone', 'pay_phone_day')
     or p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$'
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 172800
     or p_max is null or p_max < 1 or p_max > 1000 then
    raise exception 'invalid_rate_limit_args';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('commerce_rate:' || p_kind || ':' || p_subject_hash, 0));

  select count(*) into v_count
    from commerce_rate_events
   where kind = p_kind and subject_hash = p_subject_hash
     and created_at > now() - make_interval(secs => p_window_seconds);

  if v_count >= p_max then
    return false;
  end if;

  insert into commerce_rate_events (kind, subject_hash) values (p_kind, p_subject_hash);

  -- Housekeeping without a cron: about 2% of allowed calls prune up to 500 rows older than 2 days.
  if random() < 0.02 then
    delete from commerce_rate_events
     where id in (select id from commerce_rate_events where created_at < now() - interval '2 days' limit 500);
  end if;

  return true;
end $$;

revoke all on function commerce_rate_limit_hit(text, text, int, int) from public, anon, authenticated;
grant execute on function commerce_rate_limit_hit(text, text, int, int) to service_role;

commit;

-- ============================================================================
-- ROLLBACK (documented only; NOT part of the migration). Safe at any time: the table holds only
-- short-lived counters, and the application fails open without it.
-- ============================================================================
--   begin;
--   drop function if exists commerce_rate_limit_hit(text, text, int, int);
--   drop table if exists commerce_rate_events;
--   commit;
