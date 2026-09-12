-- Restaurant & Food category — Phase 1 (menu, tables/QR, guest ordering,
-- kitchen/order lifecycle, receipts, sales). See src/lib/categories.ts for
-- the restaurant_food category and RESTAURANT_SUBCATEGORIES.
--
-- Design notes (why the schema looks the way it does):
--
-- * No "organizations"/staff tables. Ringo has no multi-user-per-account
--   concept anywhere today (one Supabase Auth user = one `users` row = one
--   `profiles` row), and building one is explicitly Phase 2 in the spec
--   this was built from. Every table below is scoped by `profile_id`,
--   exactly like every other per-creator table (links, products, tracks).
--
-- * No `receipts` or `sales` tables. `orders`/`order_items` already store
--   an immutable snapshot (item name/price at time of purchase, via
--   item_name_snapshot/item_price_snapshot) — a receipt is just that data
--   rendered, and daily sales are just an aggregate query over `orders`.
--   Adding separate tables for either would be duplicate architecture for
--   data that already exists and already can't change retroactively.
--
-- * No `menu_item_options` (add-ons/variations) yet. order_items.notes
--   (free text, e.g. "no onions") covers simple preferences for now.
--   Structured add-ons with prices are a clean additive migration later —
--   deliberately not built now per "do not overcomplicate the first
--   implementation."
--
-- * Public/guest access (menu browsing, cart, checkout, order-status
--   polling, receipts) is NEVER done via a client-side anon Supabase
--   call against these tables — there is no anon RLS policy on orders/
--   order_items/restaurant_customers at all. It's all mediated through
--   server routes using the admin client, keyed by unguessable UUIDs,
--   the same pattern /api/signup-requests already uses. This is what
--   makes "restaurant A can't see restaurant B's orders" actually true:
--   there's no anon policy to misconfigure in the first place.
--
-- Additive/idempotent throughout, same reasoning as every migration since
-- 2026-09-12 (this repo's migration history is incomplete relative to the
-- live schema).

-- ============================================================================
-- 1. PROFILE-LEVEL RESTAURANT SETTINGS
-- ============================================================================
alter table profiles add column if not exists restaurant_subcategory text;
alter table profiles add column if not exists opening_hours jsonb not null default '{}'::jsonb;
alter table profiles add column if not exists dine_in_enabled boolean not null default true;
alter table profiles add column if not exists takeaway_enabled boolean not null default true;
alter table profiles add column if not exists delivery_enabled boolean not null default false;
alter table profiles add column if not exists delivery_fee numeric(10,2) not null default 0;
-- Master switch — lets a restaurant profile exist without ordering turned
-- on yet (e.g. menu still being set up) without hiding the whole category.
alter table profiles add column if not exists ordering_enabled boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_restaurant_subcategory_check') then
    alter table profiles add constraint profiles_restaurant_subcategory_check check (
      restaurant_subcategory is null or restaurant_subcategory in (
        'restaurant', 'fast_food', 'cafe', 'bakery', 'catering', 'food_vendor', 'bar_lounge', 'other'
      )
    );
  end if;
end $$;

-- ============================================================================
-- 2. MENU
-- ============================================================================
create table if not exists menu_categories (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  menu_category_id uuid references menu_categories(id) on delete set null,
  name text not null,
  description text,
  price numeric(10,2) not null default 0,
  image_url text,
  available boolean not null default true,
  featured boolean not null default false,
  prep_time_minutes int,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists menu_items_profile_id_idx on menu_items (profile_id);
create index if not exists menu_items_category_id_idx on menu_items (menu_category_id);

-- ============================================================================
-- 3. TABLES + QR
-- ============================================================================
-- public_code is what the QR/URL actually carries (/r/username?table=CODE)
-- — short, random, unguessable, and never the row's own uuid id, so a
-- printed QR code never leaks a raw database identifier.
create table if not exists restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  label text not null,
  public_code text not null unique,
  enabled boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists restaurant_tables_public_code_idx on restaurant_tables (public_code);

create or replace function set_table_public_code() returns trigger as $$
declare
  candidate text;
  attempts int := 0;
begin
  if new.public_code is not null then
    return new;
  end if;
  loop
    candidate := upper(encode(gen_random_bytes(5), 'hex'));
    attempts := attempts + 1;
    exit when not exists (select 1 from restaurant_tables where public_code = candidate);
    if attempts > 20 then
      candidate := upper(replace(new.id::text, '-', '')) || attempts::text;
      exit;
    end if;
  end loop;
  new.public_code := candidate;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_set_table_public_code on restaurant_tables;
create trigger trg_set_table_public_code
before insert on restaurant_tables
for each row execute function set_table_public_code();

-- ============================================================================
-- 4. CUSTOMERS + MARKETING CONSENT (kept in a separate table on purpose —
--    never assume consent just because a customer/order record exists)
-- ============================================================================
create table if not exists restaurant_customers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  name text,
  phone text not null,
  total_orders int not null default 0,
  total_spent numeric(10,2) not null default 0,
  last_order_at timestamptz,
  created_at timestamptz not null default now(),
  unique (profile_id, phone)
);

create table if not exists customer_marketing_consent (
  customer_id uuid primary key references restaurant_customers(id) on delete cascade,
  opted_in boolean not null default false,
  opted_in_at timestamptz,
  opted_out_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 5. ORDERS
-- ============================================================================
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigserial unique,
  profile_id uuid not null references profiles(id) on delete cascade,
  table_id uuid references restaurant_tables(id) on delete set null,
  customer_id uuid references restaurant_customers(id) on delete set null,
  order_type text not null check (order_type in ('dine_in', 'takeaway', 'delivery')),
  status text not null default 'pending' check (
    status in ('pending', 'accepted', 'preparing', 'ready', 'served', 'completed', 'cancelled', 'refunded')
  ),
  customer_name text not null,
  customer_phone text not null,
  delivery_address text,
  delivery_fee numeric(10,2) not null default 0,
  payment_method text not null default 'cash' check (payment_method in ('cash', 'mobile_money', 'card', 'other')),
  -- Declared intent only in this phase, not a real charge — see the
  -- migration header and /api/orders/route.ts. Never set to 'paid' by
  -- anything other than the restaurant explicitly marking it so, or a
  -- real provider confirmation once that's built.
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  notes text,
  subtotal numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_profile_id_idx on orders (profile_id, created_at desc);
create index if not exists orders_table_id_idx on orders (table_id);
create index if not exists orders_status_idx on orders (profile_id, status);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  menu_item_id uuid references menu_items(id) on delete set null,
  item_name_snapshot text not null,
  item_price_snapshot numeric(10,2) not null,
  quantity int not null default 1,
  line_total numeric(10,2) not null,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists order_items_order_id_idx on order_items (order_id);

create table if not exists order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  status text not null,
  changed_by uuid references public.users(id),
  changed_at timestamptz not null default now()
);
create index if not exists order_status_history_order_id_idx on order_status_history (order_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- Menu content is public-readable (it's shown on the public page/menu, no
-- different from products/links) — everything else here is owner/admin
-- only. There is deliberately no anon policy on orders/order_items/
-- restaurant_customers/order_status_history: guest ordering, order-status
-- polling, and receipts all go through server routes using the admin
-- client (see /api/orders/*), never a direct client-side table read.
alter table menu_categories enable row level security;
alter table menu_items enable row level security;
alter table restaurant_tables enable row level security;
alter table restaurant_customers enable row level security;
alter table customer_marketing_consent enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_status_history enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'menu_categories' and policyname = 'menu_categories public read') then
    create policy "menu_categories public read" on menu_categories for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'menu_categories' and policyname = 'menu_categories owner write') then
    create policy "menu_categories owner write" on menu_categories for all using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'menu_items' and policyname = 'menu_items public read') then
    create policy "menu_items public read" on menu_items for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'menu_items' and policyname = 'menu_items owner write') then
    create policy "menu_items owner write" on menu_items for all using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
    );
  end if;

  -- Tables are NOT publicly listable (a competitor shouldn't be able to
  -- enumerate a restaurant's table count/layout) — owner/admin only.
  -- Resolving a public_code from a QR scan goes through /api/restaurant/
  -- table/[code] (admin client), same reasoning as orders below.
  if not exists (select 1 from pg_policies where tablename = 'restaurant_tables' and policyname = 'restaurant_tables owner all') then
    create policy "restaurant_tables owner all" on restaurant_tables for all using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'restaurant_customers' and policyname = 'restaurant_customers owner all') then
    create policy "restaurant_customers owner all" on restaurant_customers for all using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'customer_marketing_consent' and policyname = 'customer_marketing_consent owner all') then
    create policy "customer_marketing_consent owner all" on customer_marketing_consent for all using (
      exists (
        select 1 from restaurant_customers c
        join profiles p on p.id = c.profile_id
        where c.id = customer_id and (p.user_id = auth.uid() or is_admin())
      )
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'orders' and policyname = 'orders owner all') then
    create policy "orders owner all" on orders for all using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'order_items' and policyname = 'order_items owner all') then
    create policy "order_items owner all" on order_items for all using (
      exists (select 1 from orders o join profiles p on p.id = o.profile_id where o.id = order_id and (p.user_id = auth.uid() or is_admin()))
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'order_status_history' and policyname = 'order_status_history owner all') then
    create policy "order_status_history owner all" on order_status_history for all using (
      exists (select 1 from orders o join profiles p on p.id = o.profile_id where o.id = order_id and (p.user_id = auth.uid() or is_admin()))
    );
  end if;
end $$;
