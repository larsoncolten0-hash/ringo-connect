-- Customer Retention (Phase 3 B-E): customer segments, promotions and offers, reviews and ratings — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Loyalty and rewards already exist (2026-10-21_ringo_loyalty.sql) and are REUSED unchanged: nothing here duplicates programs, rewards or packages. Consent already exists
-- (2027-01-17_customer_consent_events.sql) and is the ONLY thing that lets a promotion be sent: nothing in this file reads, copies or infers consent.
--
--   NEW  function customer_segments(profile, customer?)   a customer's segment for one profile, COMPUTED on demand from data that already exists (no segment table to go stale):
--                                                          inactive  last seen more than 60 days ago (last interaction, or the connection date when there is none)
--                                                          vip       seen within 60 days and at least 6 interactions in the last 90 days
--                                                          returning seen within 60 days and at least 2 interactions in all
--                                                          new       seen within 60 days and at most 1 interaction
--                                                          An "interaction" is a loyalty record the business made, or a booking / restaurant order / music order the customer linked to this profile.
--                                                          Church attendance, membership, giving and testimonies are NEVER read.
--   NEW  function customer_has_interaction(customer, profile)   the same interactions, as a yes/no (what makes a review "verified")
--   NEW  public.promotions            a business's offers: percent or fixed discount (XAF has no decimals; whole numbers only), a code, a window, an audience (all or one segment), a limit
--   NEW  public.promotion_deliveries  one row per promotion, customer and channel actually SENT (unique: nobody is sent the same offer twice on a channel)
--   NEW  public.promotion_redemptions one row per offer applied at the till, recorded by staff after they looked the customer up (no POS: the amount is typed in)
--   NEW  function promotion_redeem(...)  atomic: checks the window, the audience, the connection and the limits under a lock; idempotent per key
--   NEW  public.profile_reviews       one rating (1-5) and optional comment per customer and profile; the owner can hide it and reply once
--   NEW  function review_save(...)     only a customer with an ACTIVE connection and a real interaction can review; refused for Churches & Ministries
--
-- PRIVACY: every table and function is closed to every API role (RLS on, no policy, no privilege). Only the service role - the routes after they checked the business's loyalty permission or the
-- visitor's My Ringo cookie - can use them. A business never receives a customer id: it works with connection ids, as loyalty already does.
--
-- Nothing existing is changed: no existing column, constraint, policy, trigger or function is altered, and no row is read or written by this file.
-- SELF-VERIFYING, one transaction: preconditions first, postconditions last. Any RAISE rolls everything back. Re-runnable.
--
-- Depends on: 2026-10-17 (ringo_customers, customer_connections), 2026-10-19 (customer_order_links), 2026-10-21 (loyalty_activities), bookings, orders, music_orders, profiles, users.
-- Verify (read-only, run AFTER): supabase/support/2027-01-18_customer_retention.verify.sql
-- Rollback: supabase/support/2027-01-18_customer_retention.rollback.sql (refuses to run while any row exists unless data loss is explicitly confirmed).

begin;

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS
-- ----------------------------------------------------------------------------
do $$
declare
  v_marker constant text := 'managed by 2027-01-18_customer_retention.sql';
  v_missing text;
  v_have int := (select count(*) from unnest(array['promotions', 'promotion_deliveries', 'promotion_redemptions', 'profile_reviews']) t where to_regclass('public.' || t) is not null);
begin
  select string_agg(t, ', ') into v_missing
    from unnest(array['profiles', 'users', 'ringo_customers', 'customer_connections', 'customer_order_links', 'loyalty_activities', 'bookings', 'orders', 'music_orders']) t where to_regclass('public.' || t) is null;
  if v_missing is not null then raise exception 'precondition failed: missing tables: %', v_missing; end if;

  select string_agg(r, ', ') into v_missing from unnest(array['anon', 'authenticated', 'service_role']) r where not exists (select 1 from pg_roles where rolname = r);
  if v_missing is not null then raise exception 'precondition failed: missing database roles: %', v_missing; end if;

  if v_have not in (0, 4) then raise exception 'precondition failed: only some of this file''s tables exist (half-applied or foreign change)'; end if;
  if v_have = 4 and exists (select 1 from unnest(array['promotions', 'promotion_deliveries', 'promotion_redemptions', 'profile_reviews']) t where coalesce(obj_description(to_regclass('public.' || t), 'pg_class'), '') <> v_marker) then
    raise exception 'precondition failed: a table named like one of this file''s exists and is not managed by it';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('customer_segments', 'customer_has_interaction', 'promotion_redeem', 'review_save')
               and coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker) then
    raise exception 'precondition failed: a function named like one of this file''s exists and is not managed by it';
  end if;

  perform set_config('customer_retention.pre', jsonb_build_object(
    'connections', (select count(*) from public.customer_connections),
    'activities',  (select count(*) from public.loyalty_activities),
    'links',       (select count(*) from public.customer_order_links)
  )::text, true);
end $$;

-- ----------------------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------------------
create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  kind text not null,
  -- percent: 1-100; amount: a whole number of the currency (XAF has no decimals)
  value integer not null,
  currency text,
  -- what staff ask for at the till: upper-case letters and digits
  code text not null,
  audience text not null default 'all',
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions integer,
  per_customer_limit smallint not null default 1,
  status text not null default 'draft',
  -- set once, when the offer was announced to the customers who agreed to receive it
  sent_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, profile_id),
  constraint promotions_title_check check (char_length(btrim(title)) between 1 and 80),
  constraint promotions_description_check check (description is null or char_length(description) <= 400),
  constraint promotions_kind_check check (kind in ('percent', 'amount')),
  constraint promotions_value_check check ((kind = 'percent' and value between 1 and 100) or (kind = 'amount' and value between 1 and 100000000)),
  constraint promotions_currency_check check ((kind = 'percent' and currency is null) or (kind = 'amount' and currency ~ '^[A-Z]{3}$')),
  constraint promotions_code_check check (code ~ '^[A-Z0-9]{4,16}$'),
  constraint promotions_audience_check check (audience in ('all', 'new', 'returning', 'vip', 'inactive')),
  constraint promotions_window_check check (starts_at is null or ends_at is null or ends_at > starts_at),
  constraint promotions_max_check check (max_redemptions is null or max_redemptions between 1 and 1000000),
  constraint promotions_per_customer_check check (per_customer_limit between 1 and 10),
  constraint promotions_status_check check (status in ('draft', 'active', 'ended'))
);
create unique index if not exists promotions_profile_code_key on public.promotions (profile_id, code);
create index if not exists promotions_profile_idx on public.promotions (profile_id, status, created_at desc);
comment on table public.promotions is 'managed by 2027-01-18_customer_retention.sql';

create table if not exists public.promotion_deliveries (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null,
  profile_id uuid not null,
  customer_id uuid not null references public.ringo_customers(id) on delete cascade,
  channel text not null,
  -- how the consent that allowed the send was established at that moment: a ledger grant or legacy consent
  basis text not null,
  created_at timestamptz not null default now(),
  foreign key (promotion_id, profile_id) references public.promotions (id, profile_id) on delete cascade,
  constraint promotion_deliveries_channel_check check (channel in ('email', 'push')),
  constraint promotion_deliveries_basis_check check (basis in ('ledger', 'legacy')),
  unique (promotion_id, customer_id, channel)
);
create index if not exists promotion_deliveries_customer_idx on public.promotion_deliveries (customer_id, created_at desc);
comment on table public.promotion_deliveries is 'managed by 2027-01-18_customer_retention.sql';

create table if not exists public.promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null,
  profile_id uuid not null,
  customer_id uuid not null references public.ringo_customers(id) on delete cascade,
  amount integer not null,
  discount integer not null,
  currency text,
  redeemed_by uuid references public.users(id) on delete set null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  foreign key (promotion_id, profile_id) references public.promotions (id, profile_id) on delete cascade,
  constraint promotion_redemptions_amount_check check (amount > 0 and discount between 0 and amount),
  constraint promotion_redemptions_key_check check (char_length(idempotency_key) between 8 and 100),
  unique (profile_id, idempotency_key)
);
create index if not exists promotion_redemptions_promotion_idx on public.promotion_redemptions (promotion_id, customer_id);
comment on table public.promotion_redemptions is 'managed by 2027-01-18_customer_retention.sql';

create table if not exists public.profile_reviews (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  customer_id uuid not null references public.ringo_customers(id) on delete cascade,
  rating smallint not null,
  body text,
  -- always true today: a review exists only after a real interaction; kept so the rule can be relaxed or tightened without a schema change
  verified boolean not null default true,
  status text not null default 'published',
  owner_reply text,
  owner_replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, customer_id),
  constraint profile_reviews_rating_check check (rating between 1 and 5),
  constraint profile_reviews_body_check check (body is null or char_length(body) <= 1000),
  constraint profile_reviews_status_check check (status in ('published', 'hidden')),
  constraint profile_reviews_reply_check check (owner_reply is null or char_length(owner_reply) between 1 and 500)
);
create index if not exists profile_reviews_profile_idx on public.profile_reviews (profile_id, status, created_at desc);
comment on table public.profile_reviews is 'managed by 2027-01-18_customer_retention.sql';

-- ----------------------------------------------------------------------------
-- 2. FUNCTIONS
-- ----------------------------------------------------------------------------
-- Interactions of one customer (or every customer) with one profile: loyalty records the business made, and orders / bookings the customer linked to this profile.
create or replace function public.customer_segments(p_profile uuid, p_customer uuid default null)
returns table (customer_id uuid, segment text)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  with c as (
    select cc.customer_id, cc.connected_at
      from public.customer_connections cc
     where cc.profile_id = p_profile and cc.status = 'active' and (p_customer is null or cc.customer_id = p_customer)
  ),
  a as (
    select la.customer_id, la.created_at from public.loyalty_activities la
     where la.profile_id = p_profile and la.kind = 'record' and (p_customer is null or la.customer_id = p_customer)
    union all
    select l.customer_id, l.created_at from public.customer_order_links l join public.bookings b on l.order_kind = 'booking' and b.id = l.order_id
     where b.profile_id = p_profile and (p_customer is null or l.customer_id = p_customer)
    union all
    select l.customer_id, l.created_at from public.customer_order_links l join public.orders o on l.order_kind = 'restaurant_order' and o.id = l.order_id
     where o.profile_id = p_profile and (p_customer is null or l.customer_id = p_customer)
    union all
    select l.customer_id, l.created_at from public.customer_order_links l join public.music_orders m on l.order_kind = 'music_order' and m.id = l.order_id
     where m.profile_id = p_profile and (p_customer is null or l.customer_id = p_customer)
  ),
  agg as (
    select a.customer_id, count(*) as total, count(*) filter (where a.created_at >= now() - interval '90 days') as n90, max(a.created_at) as last_at
      from a group by a.customer_id
  )
  select c.customer_id,
         case
           when coalesce(agg.last_at, c.connected_at) < now() - interval '60 days' then 'inactive'
           when coalesce(agg.n90, 0) >= 6 then 'vip'
           when coalesce(agg.total, 0) >= 2 then 'returning'
           else 'new'
         end
    from c left join agg on agg.customer_id = c.customer_id;
$$;
comment on function public.customer_segments(uuid, uuid) is 'managed by 2027-01-18_customer_retention.sql';
revoke all on function public.customer_segments(uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_segments(uuid, uuid) to service_role;

create or replace function public.customer_has_interaction(p_customer uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (select 1 from public.loyalty_activities la where la.profile_id = p_profile and la.customer_id = p_customer and la.kind = 'record')
      or exists (select 1 from public.customer_order_links l join public.bookings b on l.order_kind = 'booking' and b.id = l.order_id where l.customer_id = p_customer and b.profile_id = p_profile)
      or exists (select 1 from public.customer_order_links l join public.orders o on l.order_kind = 'restaurant_order' and o.id = l.order_id where l.customer_id = p_customer and o.profile_id = p_profile)
      or exists (select 1 from public.customer_order_links l join public.music_orders m on l.order_kind = 'music_order' and m.id = l.order_id where l.customer_id = p_customer and m.profile_id = p_profile);
$$;
comment on function public.customer_has_interaction(uuid, uuid) is 'managed by 2027-01-18_customer_retention.sql';
revoke all on function public.customer_has_interaction(uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_has_interaction(uuid, uuid) to service_role;

-- Applies one offer at the till. The business typed the bill amount; the discount is computed here. Outcomes are stable words the application translates.
create or replace function public.promotion_redeem(p_profile uuid, p_promotion uuid, p_customer uuid, p_staff uuid, p_amount integer, p_key text)
returns table (out_outcome text, out_redemption_id uuid, out_discount integer)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_p public.promotions%rowtype;
  v_seg text;
  v_n integer;
  v_discount integer;
  v_id uuid;
begin
  if p_profile is null or p_promotion is null or p_customer is null or p_key is null or char_length(p_key) not between 8 and 100 then
    out_outcome := 'invalid_request'; return next; return;
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 1000000000 then
    out_outcome := 'invalid_amount'; return next; return;
  end if;

  -- a repeated request (same key) answers with the original result
  select r.id, r.discount into v_id, v_discount from public.promotion_redemptions r where r.profile_id = p_profile and r.idempotency_key = p_key;
  if found then
    out_outcome := 'already_recorded'; out_redemption_id := v_id; out_discount := v_discount; return next; return;
  end if;

  select * into v_p from public.promotions where id = p_promotion and profile_id = p_profile for update;
  if not found then out_outcome := 'not_found'; return next; return; end if;
  if v_p.status <> 'active' then out_outcome := 'not_active'; return next; return; end if;
  if v_p.starts_at is not null and v_p.starts_at > now() then out_outcome := 'not_started'; return next; return; end if;
  if v_p.ends_at is not null and v_p.ends_at <= now() then out_outcome := 'expired'; return next; return; end if;

  select s.segment into v_seg from public.customer_segments(p_profile, p_customer) s limit 1;
  if v_seg is null then out_outcome := 'not_connected'; return next; return; end if;
  if v_p.audience <> 'all' and v_p.audience <> v_seg then out_outcome := 'not_eligible'; return next; return; end if;

  if v_p.max_redemptions is not null and (select count(*) from public.promotion_redemptions r where r.promotion_id = v_p.id) >= v_p.max_redemptions then
    out_outcome := 'limit_reached'; return next; return;
  end if;
  select count(*) into v_n from public.promotion_redemptions r where r.promotion_id = v_p.id and r.customer_id = p_customer;
  if v_n >= v_p.per_customer_limit then out_outcome := 'customer_limit_reached'; return next; return; end if;

  v_discount := case when v_p.kind = 'percent' then (p_amount::bigint * v_p.value / 100)::integer else least(v_p.value, p_amount) end;
  insert into public.promotion_redemptions (promotion_id, profile_id, customer_id, amount, discount, currency, redeemed_by, idempotency_key)
  values (v_p.id, p_profile, p_customer, p_amount, v_discount, v_p.currency, p_staff, p_key) returning id into v_id;
  out_outcome := 'redeemed'; out_redemption_id := v_id; out_discount := v_discount; return next; return;
end;
$$;
comment on function public.promotion_redeem(uuid, uuid, uuid, uuid, integer, text) is 'managed by 2027-01-18_customer_retention.sql';
revoke all on function public.promotion_redeem(uuid, uuid, uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.promotion_redeem(uuid, uuid, uuid, uuid, integer, text) to service_role;

-- Saves (creates or edits) a customer's own review. A hidden review stays hidden after an edit; the owner's reply is kept.
create or replace function public.review_save(p_customer uuid, p_profile uuid, p_rating integer, p_body text)
returns table (out_outcome text, out_review_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_prof record;
  v_id uuid;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  if p_customer is null or p_profile is null or p_rating is null or p_rating not between 1 and 5 or (v_body is not null and char_length(v_body) > 1000) then
    out_outcome := 'invalid_request'; return next; return;
  end if;
  select category, categories, published into v_prof from public.profiles where id = p_profile;
  if not found or v_prof.published is not true then out_outcome := 'not_available'; return next; return; end if;
  -- reviewing a church or ministry is not offered
  if v_prof.category = 'church_ministries' or 'church_ministries' = any (coalesce(v_prof.categories, '{}'::text[])) then out_outcome := 'not_available'; return next; return; end if;
  if not exists (select 1 from public.customer_connections cc where cc.customer_id = p_customer and cc.profile_id = p_profile and cc.status = 'active') then
    out_outcome := 'not_connected'; return next; return;
  end if;
  if not public.customer_has_interaction(p_customer, p_profile) then out_outcome := 'no_interaction'; return next; return; end if;

  insert into public.profile_reviews (profile_id, customer_id, rating, body)
  values (p_profile, p_customer, p_rating, v_body)
  on conflict (profile_id, customer_id) do update set rating = excluded.rating, body = excluded.body, updated_at = now()
  returning id into v_id;
  out_outcome := 'saved'; out_review_id := v_id; return next; return;
end;
$$;
comment on function public.review_save(uuid, uuid, integer, text) is 'managed by 2027-01-18_customer_retention.sql';
revoke all on function public.review_save(uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.review_save(uuid, uuid, integer, text) to service_role;

-- ----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY AND PRIVILEGES: closed to every API role; the service role only
-- ----------------------------------------------------------------------------
alter table public.promotions enable row level security;
alter table public.promotion_deliveries enable row level security;
alter table public.promotion_redemptions enable row level security;
alter table public.profile_reviews enable row level security;
revoke all on public.promotions, public.promotion_deliveries, public.promotion_redemptions, public.profile_reviews from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.promotions to service_role;
grant select, insert on public.promotion_deliveries to service_role;
grant select, insert on public.promotion_redemptions to service_role;
grant select, insert, update, delete on public.profile_reviews to service_role;

-- ----------------------------------------------------------------------------
-- 4. POSTCONDITIONS (any failure rolls the whole file back)
-- ----------------------------------------------------------------------------
do $$
declare
  v_pre jsonb := current_setting('customer_retention.pre')::jsonb;
  v_marker constant text := 'managed by 2027-01-18_customer_retention.sql';
  v_t text;
  v_r text;
begin
  foreach v_t in array array['promotions', 'promotion_deliveries', 'promotion_redemptions', 'profile_reviews'] loop
    if coalesce(obj_description(to_regclass('public.' || v_t), 'pg_class'), '') <> v_marker then raise exception 'postcondition failed: % marker', v_t; end if;
    if not (select relrowsecurity from pg_class where oid = to_regclass('public.' || v_t)) then raise exception 'postcondition failed: row-level security is off on %', v_t; end if;
    if exists (select 1 from pg_policy where polrelid = to_regclass('public.' || v_t)) then raise exception 'postcondition failed: % must have no policy', v_t; end if;
    foreach v_r in array array['public', 'anon', 'authenticated'] loop
      if has_any_column_privilege(v_r, 'public.' || v_t, 'select') or has_any_column_privilege(v_r, 'public.' || v_t, 'insert') or has_any_column_privilege(v_r, 'public.' || v_t, 'update') or has_table_privilege(v_r, 'public.' || v_t, 'delete') then
        raise exception 'postcondition failed: % can reach %', v_r, v_t;
      end if;
    end loop;
  end loop;
  if has_table_privilege('service_role', 'public.promotion_deliveries', 'update') or has_table_privilege('service_role', 'public.promotion_deliveries', 'delete')
     or has_table_privilege('service_role', 'public.promotion_redemptions', 'update') or has_table_privilege('service_role', 'public.promotion_redemptions', 'delete') then
    raise exception 'postcondition failed: deliveries and redemptions must be append-only for the service role';
  end if;
  foreach v_t in array array['customer_segments(uuid, uuid)', 'customer_has_interaction(uuid, uuid)', 'promotion_redeem(uuid, uuid, uuid, uuid, integer, text)', 'review_save(uuid, uuid, integer, text)'] loop
    foreach v_r in array array['public', 'anon', 'authenticated'] loop
      if has_function_privilege(v_r, 'public.' || v_t, 'execute') then raise exception 'postcondition failed: % can call %', v_r, v_t; end if;
    end loop;
    if not has_function_privilege('service_role', 'public.' || v_t, 'execute') then raise exception 'postcondition failed: the service role cannot call %', v_t; end if;
  end loop;
  if (select count(*) from public.customer_connections) <> (v_pre->>'connections')::bigint or (select count(*) from public.loyalty_activities) <> (v_pre->>'activities')::bigint
     or (select count(*) from public.customer_order_links) <> (v_pre->>'links')::bigint then
    raise exception 'postcondition failed: a row count of an existing table changed';
  end if;
end $$;

commit;
