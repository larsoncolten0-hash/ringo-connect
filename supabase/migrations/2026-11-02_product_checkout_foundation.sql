-- Universal Product Checkout + Customer Payment — Increment 1: schema + atomic order/stock RPCs.
--
-- Purely additive. The ONLY change to an existing table is two NEW platform_settings columns.
-- No existing table, column, row, policy, function or trigger is modified. Nothing in the app
-- calls any of this yet, and commerce_enabled defaults to false (create_product_order refuses to
-- run while it is false), so applying this migration changes no behaviour.
--
-- Design notes:
--   * create_product_order is ONE transaction: validate -> atomically reserve stock -> snapshot the
--     database price -> insert order + item. Any error rolls all of it back, so stock can never be
--     reserved without an order.
--   * There is deliberately NO generic "add stock back" function. Stock returns only through
--     release_product_order_stock, which acts on an existing order, exactly once.
--   * Money tables use ON DELETE RESTRICT so financial history cannot be silently destroyed by a
--     profile or user deletion.
--   * XAF-only and Fapshi-only (V1) are enforced INSIDE create_product_order as well as in the
--     application eligibility gate (defence in depth): it refuses non-XAF profiles and refuses to
--     run while fapshi_enabled is not true.
--   * The settlement function (payment success -> order paid -> earnings) is NOT part of this
--     migration; it arrives with the payment increment.

begin;

-- ============================================================================
-- 1. PLATFORM SETTINGS — commerce kill switch + commission (no hard-coded rate)
-- ============================================================================
alter table platform_settings add column if not exists commerce_enabled boolean not null default false;
alter table platform_settings add column if not exists commerce_commission_rate numeric(5,4)
  check (commerce_commission_rate is null or (commerce_commission_rate >= 0 and commerce_commission_rate <= 1));

-- ============================================================================
-- 2. PRODUCT ORDERS
-- ============================================================================
create table if not exists product_orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigserial not null unique,
  profile_id uuid not null references profiles(id) on delete restrict,
  customer_id uuid references ringo_customers(id) on delete set null,
  customer_name text not null check (char_length(btrim(customer_name)) between 1 and 120),
  customer_phone text not null check (char_length(btrim(customer_phone)) between 6 and 40),
  customer_email text check (customer_email is null or char_length(customer_email) <= 200),
  customer_note text check (customer_note is null or char_length(customer_note) <= 500),
  currency text not null check (currency = upper(currency) and char_length(currency) = 3),
  subtotal numeric(12,2) not null check (subtotal > 0),
  total numeric(12,2) not null check (total > 0 and total >= subtotal),
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment','paid','fulfilled','cancelled','expired','refunded','payment_review')),
  expires_at timestamptz not null,
  paid_at timestamptz,
  stock_released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('paid','fulfilled','refunded') or paid_at is not null)
);
create index if not exists product_orders_profile_idx on product_orders (profile_id, created_at desc);
create index if not exists product_orders_customer_idx on product_orders (customer_id, created_at desc) where customer_id is not null;
create index if not exists product_orders_open_expiry_idx on product_orders (expires_at) where status = 'awaiting_payment';
create index if not exists product_orders_open_phone_idx on product_orders (profile_id, customer_phone) where status = 'awaiting_payment';

-- ============================================================================
-- 3. PRODUCT ORDER ITEMS (immutable snapshots)
-- ============================================================================
create table if not exists product_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references product_orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  name_snapshot text not null check (char_length(name_snapshot) between 1 and 300),
  image_snapshot text,
  unit_price_snapshot numeric(12,2) not null check (unit_price_snapshot > 0),
  quantity int not null check (quantity >= 1),
  line_total numeric(12,2) not null,
  created_at timestamptz not null default now(),
  check (line_total = unit_price_snapshot * quantity)
);
create index if not exists product_order_items_order_idx on product_order_items (order_id);
create index if not exists product_order_items_product_idx on product_order_items (product_id) where product_id is not null;

-- ============================================================================
-- 4. CUSTOMER PAYMENTS (generic attempt/intent layer; only product_order is used for now)
-- ============================================================================
create table if not exists customer_payments (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('fapshi')),
  provider_transaction_id text,
  external_id text not null unique,               -- reference sent to the provider; one per attempt
  target_type text not null check (target_type in ('product_order')),
  target_id uuid not null,                        -- polymorphic, deliberately no foreign key
  profile_id uuid not null references profiles(id) on delete restrict,
  customer_id uuid references ringo_customers(id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null check (currency = upper(currency) and char_length(currency) = 3),
  payer_medium text check (payer_medium in ('mobile money','orange money')),
  status text not null default 'initiated'
    check (status in ('initiated','pending','succeeded','failed','expired','cancelled')),
  provider_status text,
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'succeeded' or confirmed_at is not null)
);
create unique index if not exists customer_payments_provider_txn_idx on customer_payments (provider, provider_transaction_id) where provider_transaction_id is not null;
create unique index if not exists customer_payments_one_live_idx on customer_payments (target_type, target_id) where status in ('initiated','pending');
create index if not exists customer_payments_target_idx on customer_payments (target_type, target_id, created_at desc);
create index if not exists customer_payments_live_expiry_idx on customer_payments (expires_at) where status in ('initiated','pending');
create index if not exists customer_payments_profile_idx on customer_payments (profile_id, created_at desc);

-- ============================================================================
-- 5. COMMERCE EARNINGS LEDGER (records only — no payouts, holds or withdrawals)
-- ============================================================================
create table if not exists commerce_sale_earnings (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references product_orders(id) on delete restrict,
  payment_id uuid not null unique references customer_payments(id) on delete restrict,
  profile_id uuid not null references profiles(id) on delete restrict,
  creator_user_id uuid not null references public.users(id) on delete restrict,  -- the profile owner, same identity music_sale_earnings uses
  gross_amount numeric(12,2) not null check (gross_amount > 0),
  commission_rate numeric(5,4) not null check (commission_rate >= 0 and commission_rate <= 1),  -- snapshot at sale
  platform_fee numeric(12,2) not null check (platform_fee >= 0),
  net_amount numeric(12,2) not null check (net_amount >= 0),
  currency text not null check (currency = upper(currency) and char_length(currency) = 3),
  status text not null default 'recorded' check (status in ('recorded','reversed')),
  created_at timestamptz not null default now(),
  check (gross_amount = platform_fee + net_amount)
);
create index if not exists commerce_sale_earnings_creator_idx on commerce_sale_earnings (creator_user_id, created_at desc);
create index if not exists commerce_sale_earnings_profile_idx on commerce_sale_earnings (profile_id, created_at desc);

-- ============================================================================
-- 6. INTEGRITY GUARDS (fire for every writer, including the service role)
-- ============================================================================
create or replace function product_orders_guard() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.order_number <> old.order_number or new.profile_id <> old.profile_id
     or new.currency <> old.currency or new.subtotal <> old.subtotal or new.total <> old.total
     or new.customer_name <> old.customer_name or new.customer_phone <> old.customer_phone
     or new.customer_email is distinct from old.customer_email
     or new.customer_note is distinct from old.customer_note
     or new.created_at <> old.created_at then
    raise exception 'product_orders: immutable column changed';
  end if;
  if new.status <> old.status and not (
        (old.status = 'awaiting_payment' and new.status in ('paid','expired','cancelled','payment_review'))
     or (old.status = 'expired'          and new.status in ('paid','payment_review'))
     or (old.status = 'cancelled'        and new.status = 'payment_review')
     or (old.status = 'payment_review'   and new.status in ('paid','refunded','cancelled'))
     or (old.status = 'paid'             and new.status in ('fulfilled','refunded','payment_review'))
     or (old.status = 'fulfilled'        and new.status = 'refunded')) then
    raise exception 'product_orders: illegal status transition % -> %', old.status, new.status;
  end if;
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists product_orders_guard_trg on product_orders;
create trigger product_orders_guard_trg before update on product_orders
  for each row execute function product_orders_guard();

create or replace function product_order_items_guard() returns trigger language plpgsql as $$
begin
  raise exception 'product_order_items are immutable snapshots';
end $$;
drop trigger if exists product_order_items_guard_trg on product_order_items;
create trigger product_order_items_guard_trg before update on product_order_items
  for each row execute function product_order_items_guard();

create or replace function customer_payments_guard() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.provider <> old.provider or new.external_id <> old.external_id
     or new.target_type <> old.target_type or new.target_id <> old.target_id
     or new.profile_id <> old.profile_id or new.amount <> old.amount or new.currency <> old.currency
     or new.expires_at <> old.expires_at or new.created_at <> old.created_at
     or (old.provider_transaction_id is not null and new.provider_transaction_id is distinct from old.provider_transaction_id) then
    raise exception 'customer_payments: immutable column changed';
  end if;
  if new.status <> old.status and not (
        (old.status = 'initiated' and new.status in ('pending','succeeded','failed','expired','cancelled'))
     or (old.status = 'pending'   and new.status in ('succeeded','failed','expired','cancelled'))
     or (old.status = 'expired'   and new.status = 'succeeded')       -- provider confirms after our local expiry
     or (old.status = 'cancelled' and new.status = 'succeeded')) then -- customer approves the prompt after abandoning
    raise exception 'customer_payments: illegal status transition % -> %', old.status, new.status;
  end if;
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists customer_payments_guard_trg on customer_payments;
create trigger customer_payments_guard_trg before update on customer_payments
  for each row execute function customer_payments_guard();

create or replace function commerce_sale_earnings_guard() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.order_id <> old.order_id or new.payment_id <> old.payment_id
     or new.profile_id <> old.profile_id or new.creator_user_id <> old.creator_user_id
     or new.gross_amount <> old.gross_amount or new.commission_rate <> old.commission_rate
     or new.platform_fee <> old.platform_fee or new.net_amount <> old.net_amount
     or new.currency <> old.currency or new.created_at <> old.created_at then
    raise exception 'commerce_sale_earnings: only status may change';
  end if;
  return new;
end $$;
drop trigger if exists commerce_sale_earnings_guard_trg on commerce_sale_earnings;
create trigger commerce_sale_earnings_guard_trg before update on commerce_sale_earnings
  for each row execute function commerce_sale_earnings_guard();

-- ============================================================================
-- 7. RPC: exactly-once release of an EXISTING order's stock
--    (defined before create_product_order, which calls it for lazy expiry)
-- ============================================================================
-- One conditional UPDATE claims the order (awaiting_payment -> expired|cancelled, stock not yet
-- released); a concurrent second caller waits on the row lock, sees the claim and returns false.
-- The stock is returned in the same transaction, so it can be neither applied twice nor half-applied.
-- Refuses while a payment attempt is still live. Cannot add stock to anything but an order's own items.
create or replace function release_product_order_stock(p_order_id uuid, p_new_status text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_claimed uuid;
begin
  if p_new_status not in ('expired','cancelled') then
    raise exception 'release_product_order_stock: invalid status %', p_new_status;
  end if;
  update product_orders set status = p_new_status, stock_released_at = now()
   where id = p_order_id and status = 'awaiting_payment' and stock_released_at is null
     and (p_new_status <> 'expired' or expires_at <= now())
     and not exists (select 1 from customer_payments cp
                      where cp.target_type = 'product_order' and cp.target_id = p_order_id
                        and cp.status in ('initiated','pending') and cp.expires_at > now())
  returning id into v_claimed;
  if v_claimed is null then return false; end if;
  update products p set inventory_count = p.inventory_count + s.qty
    from (select product_id, sum(quantity)::int as qty from product_order_items
           where order_id = p_order_id and product_id is not null group by product_id) s
   where p.id = s.product_id and p.inventory_count is not null;   -- NULL inventory = unlimited, untouched
  return true;
end $$;

-- ============================================================================
-- 8. RPC: ATOMIC create order + reserve stock + snapshot (single transaction)
-- ============================================================================
-- Any error below (including a table CHECK, e.g. an empty customer name) rolls back the stock
-- decrement and both inserts together. The caller supplies only ids, quantity and contact details;
-- the price, name, image, currency and totals all come from the database rows read here.
create or replace function create_product_order(
  p_profile_id uuid, p_product_id uuid, p_quantity int, p_customer_id uuid,
  p_customer_name text, p_customer_phone text, p_customer_email text, p_customer_note text,
  p_reservation_minutes int default 30)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c_max_quantity constant int := 10;      -- change with `create or replace`; no schema change needed
  c_max_open_orders constant int := 3;
  v_settings record; v_profile record; v_product products;
  v_order product_orders; v_item product_order_items;
  v_phone text := btrim(coalesce(p_customer_phone, ''));
  v_currency text; v_subtotal numeric(12,2); v_expired uuid; v_reserved boolean := false;
begin
  if p_quantity is null or p_quantity < 1 then raise exception 'invalid_quantity'; end if;
  if p_quantity > c_max_quantity then raise exception 'quantity_exceeds_max'; end if;
  if p_reservation_minutes is null or p_reservation_minutes < 5 or p_reservation_minutes > 120 then
    raise exception 'invalid_reservation_window';
  end if;

  -- platform gates (defence in depth; the route checks too): commerce switched on, a commission rate
  -- set, and Fapshi (the only V1 provider) enabled
  select commerce_enabled, commerce_commission_rate, fapshi_enabled into v_settings from platform_settings limit 1;
  if not found or v_settings.commerce_enabled is not true or v_settings.commerce_commission_rate is null then
    raise exception 'commerce_disabled';
  end if;
  if v_settings.fapshi_enabled is not true then
    raise exception 'payment_provider_unavailable';
  end if;

  select id, published, is_demo, currency, category, categories into v_profile from profiles where id = p_profile_id;
  if not found or v_profile.published is not true or v_profile.is_demo is true then
    raise exception 'profile_unavailable';
  end if;
  -- Music profiles keep their own commerce/payment system; never touch their stock from here.
  if v_profile.category = 'music_entertainment' or 'music_entertainment' = any(coalesce(v_profile.categories, '{}')) then
    raise exception 'music_profile_not_supported';
  end if;
  v_currency := upper(coalesce(nullif(btrim(v_profile.currency), ''), 'USD'));
  -- V1 accepts XAF only (Fapshi moves nothing else). Enforced here, not only in the application gate.
  if v_currency <> 'XAF' then
    raise exception 'commerce_currency_unsupported';
  end if;

  -- serialise per (profile, phone) so the open-order cap cannot be raced
  perform pg_advisory_xact_lock(hashtextextended(p_profile_id::text || ':' || v_phone, 0));
  if (select count(*) from product_orders
       where profile_id = p_profile_id and customer_phone = v_phone
         and status = 'awaiting_payment' and expires_at > now()) >= c_max_open_orders then
    raise exception 'too_many_open_orders';
  end if;

  -- Atomic stock reservation; inventory_count NULL = unlimited. On a miss, lazily free expired unpaid
  -- reservations for this product (authoritative expiry, no cron needed) and retry once.
  for attempt in 1..2 loop
    update products
       set inventory_count = case when inventory_count is null then null else inventory_count - p_quantity end
     where id = p_product_id and profile_id = p_profile_id
       and available is not false
       and name is not null and btrim(name) <> ''
       and price is not null and price > 0
       and (inventory_count is null or inventory_count >= p_quantity)
    returning * into v_product;
    if found then v_reserved := true; exit; end if;
    if attempt = 1 then
      for v_expired in
        select o.id from product_orders o join product_order_items i on i.order_id = o.id
         where i.product_id = p_product_id and o.status = 'awaiting_payment'
           and o.stock_released_at is null and o.expires_at <= now()
         order by o.expires_at limit 25
      loop
        perform release_product_order_stock(v_expired, 'expired');
      end loop;
    end if;
  end loop;

  if not v_reserved then
    if exists (select 1 from products where id = p_product_id and profile_id = p_profile_id
                and available is not false and name is not null and btrim(name) <> ''
                and price is not null and price > 0) then
      raise exception 'insufficient_stock';
    end if;
    raise exception 'product_unavailable';
  end if;

  v_subtotal := v_product.price * p_quantity;   -- authoritative: database price x validated quantity

  insert into product_orders (profile_id, customer_id, customer_name, customer_phone, customer_email,
                              customer_note, currency, subtotal, total, expires_at)
  values (p_profile_id, p_customer_id, btrim(coalesce(p_customer_name, '')), v_phone,
          nullif(btrim(coalesce(p_customer_email, '')), ''), nullif(btrim(coalesce(p_customer_note, '')), ''),
          v_currency, v_subtotal, v_subtotal, now() + make_interval(mins => p_reservation_minutes))
  returning * into v_order;

  insert into product_order_items (order_id, product_id, name_snapshot, image_snapshot,
                                   unit_price_snapshot, quantity, line_total)
  values (v_order.id, v_product.id, left(v_product.name, 300),
          coalesce(nullif(v_product.image_urls[1], ''), nullif(v_product.image_url, '')),
          v_product.price, p_quantity, v_subtotal)
  returning * into v_item;

  return jsonb_build_object('order', to_jsonb(v_order), 'item', to_jsonb(v_item));
end $$;

-- Server-only: no public, anon or signed-in access; the trusted server route (service role) calls these.
revoke all on function release_product_order_stock(uuid, text) from public, anon, authenticated;
revoke all on function create_product_order(uuid, uuid, int, uuid, text, text, text, text, int) from public, anon, authenticated;
grant execute on function release_product_order_stock(uuid, text) to service_role;
grant execute on function create_product_order(uuid, uuid, int, uuid, text, text, text, text, int) to service_role;

-- ============================================================================
-- 9. ROW LEVEL SECURITY
-- ============================================================================
alter table product_orders enable row level security;
alter table product_order_items enable row level security;
alter table customer_payments enable row level security;
alter table commerce_sale_earnings enable row level security;

revoke all on product_orders, product_order_items, customer_payments, commerce_sale_earnings from anon, authenticated;
grant select, insert, update, delete on product_orders, product_order_items, customer_payments, commerce_sale_earnings to service_role;
grant usage, select on sequence product_orders_order_number_seq to service_role;
-- Creators may READ their own orders, items and earnings; nothing is writable from the client.
grant select on product_orders, product_order_items, commerce_sale_earnings to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'product_orders' and policyname = 'product_orders owner read') then
    create policy "product_orders owner read" on product_orders for select to authenticated using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin())));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'product_order_items' and policyname = 'product_order_items owner read') then
    create policy "product_order_items owner read" on product_order_items for select to authenticated using (
      exists (select 1 from product_orders o join profiles p on p.id = o.profile_id
               where o.id = order_id and (p.user_id = auth.uid() or is_admin())));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'commerce_sale_earnings' and policyname = 'commerce_sale_earnings owner read') then
    create policy "commerce_sale_earnings owner read" on commerce_sale_earnings for select to authenticated using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin())));
  end if;
end $$;
-- customer_payments: RLS enabled, no policy and no client grant — server (service role) only.

commit;

-- ============================================================================
-- ROLLBACK (documented only; NOT part of the migration. Safe only while these tables hold no real data,
-- because dropping them deletes orders, payments and earnings.)
-- ============================================================================
--   begin;
--   drop function if exists create_product_order(uuid, uuid, int, uuid, text, text, text, text, int);
--   drop function if exists release_product_order_stock(uuid, text);
--   drop table if exists commerce_sale_earnings;
--   drop table if exists customer_payments;
--   drop table if exists product_order_items;
--   drop table if exists product_orders;
--   drop function if exists commerce_sale_earnings_guard();
--   drop function if exists customer_payments_guard();
--   drop function if exists product_order_items_guard();
--   drop function if exists product_orders_guard();
--   alter table platform_settings drop column if exists commerce_commission_rate;
--   alter table platform_settings drop column if exists commerce_enabled;
--   commit;
