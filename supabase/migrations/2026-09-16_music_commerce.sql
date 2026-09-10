-- Music & Entertainment commerce — songs/EPs/albums, merch (reusing
-- `products`), tickets (reusing `events`), Support Artist, protected
-- 10-second-preview audio, and sales/order records. See src/lib/categories.ts
-- for the music_entertainment category.
--
-- Design notes:
--
-- * Restaurant's "orders" architecture does NOT include real payment
--   collection, a balance, or a withdrawal system — payment_method is a
--   customer-declared label, payment_status is only ever set by the
--   restaurant owner marking an order paid by hand. There is nothing to
--   extend there beyond the *pattern* (snapshot-at-purchase-time order +
--   order_items, owner-scoped RLS, admin-client-mediated guest access).
--   music_orders/music_order_items follow that same pattern rather than
--   literally sharing restaurant's tables, which have restaurant-specific
--   concerns (table_id, dine-in/takeaway/delivery) that don't fit digital
--   goods. "Balance" here is a reporting figure computed from completed
--   orders, not a custodied ledger — there is deliberately no withdrawal
--   table in this migration.
--
-- * Merch reuses the existing `products` table (already the mechanism
--   music_entertainment's catalog uses — see categories.ts's "Shop"/
--   "Merch" label) and tickets reuse the existing `events` table (already
--   music's "Upcoming" section) — both just get a few additive commerce
--   columns, per "reuse existing tables wherever possible."
--
-- * Protected audio: a track only becomes a real, gated purchase once the
--   artist uploads a file to the new PRIVATE `protected-audio` storage
--   bucket (protected_audio_path). Existing tracks with only the original
--   `audio_url` (public bucket) keep working exactly as before — free,
--   ungated playback — this is purely additive and opt-in per track, nothing
--   about existing tracks/profiles changes. The preview is a genuinely
--   separate, short (artist-uploaded, client-validated ≤10s) public file,
--   not the full file truncated by JavaScript — the full file is never
--   sent to a browser that hasn't purchased it; access is only ever a
--   short-lived signed URL minted server-side after verifying payment
--   (see /api/music/tracks/[id]/audio).

-- ============================================================================
-- 1. MUSIC RELEASES (EPs/Albums — a bundle of tracks sold as one unit)
-- ============================================================================
create table if not exists music_releases (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  release_type text not null check (release_type in ('ep', 'album')),
  cover_image_url text,
  description text,
  price numeric(10,2) not null default 0,
  available boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists music_releases_profile_id_idx on music_releases (profile_id);

alter table music_releases enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'music_releases' and policyname = 'music_releases public read') then
    create policy "music_releases public read" on music_releases for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'music_releases' and policyname = 'music_releases owner write') then
    create policy "music_releases owner write" on music_releases for all using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
    );
  end if;
end $$;

-- ============================================================================
-- 2. TRACKS — extended for real commerce (songs, and EP/album membership)
-- ============================================================================
alter table tracks add column if not exists genre text;
-- Null = a standalone single (or, if protected_audio_path is also null, the
-- original free/ungated "Latest Music" teaser track — unchanged behavior).
alter table tracks add column if not exists release_id uuid references music_releases(id) on delete set null;
-- Path within the private `protected-audio` bucket — never a public URL.
-- Null means this track isn't sold as a real gated purchase (the pre-existing
-- audio_url/external_url behavior applies, exactly as before this migration).
alter table tracks add column if not exists protected_audio_path text;
-- A genuinely separate, short public clip (uploaded to the existing public
-- "uploads" bucket, duration-checked client-side before upload) — not a
-- truncation of the protected file.
alter table tracks add column if not exists preview_audio_url text;
alter table tracks add column if not exists download_enabled boolean not null default true;
alter table tracks add column if not exists email_delivery_enabled boolean not null default true;
alter table tracks add column if not exists available boolean not null default true;
create index if not exists tracks_release_id_idx on tracks (release_id);

-- ============================================================================
-- 3. MERCH — additive columns on the existing `products` table
-- ============================================================================
alter table products add column if not exists available boolean not null default true;
alter table products add column if not exists inventory_count int; -- null = unlimited

-- ============================================================================
-- 4. TICKETS — additive columns on the existing `events` table
-- ============================================================================
alter table events add column if not exists price numeric(10,2);
alter table events add column if not exists ticket_type text; -- e.g. 'general', 'vip' — free text, artist's own label
alter table events add column if not exists ticket_capacity int; -- null = unlimited
alter table events add column if not exists tickets_sold int not null default 0;

-- ============================================================================
-- 5. SUPPORT ARTIST — a customizable message (the toggle already exists:
--    profiles.hub_support_enabled, added in 2026-09-14)
-- ============================================================================
alter table profiles add column if not exists support_message text;

-- ============================================================================
-- 6. CUSTOMERS (fans) — mirrors restaurant_customers exactly
-- ============================================================================
create table if not exists music_customers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  name text,
  email text,
  phone text,
  total_orders int not null default 0,
  total_spent numeric(10,2) not null default 0,
  last_order_at timestamptz,
  created_at timestamptz not null default now(),
  unique (profile_id, phone)
);

-- ============================================================================
-- 7. ORDERS — same snapshot-at-purchase-time pattern as restaurant orders
-- ============================================================================
create table if not exists music_orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigserial unique,
  profile_id uuid not null references profiles(id) on delete cascade,
  customer_id uuid references music_customers(id) on delete set null,
  customer_name text not null,
  customer_email text,
  customer_phone text not null,
  -- Declared at checkout, same as restaurant — not a real charge. See the
  -- migration header: there is no payment gateway integration here yet.
  payment_method text not null default 'cash' check (payment_method in ('cash', 'mobile_money', 'card', 'other')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled', 'refunded')),
  subtotal numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists music_orders_profile_id_idx on music_orders (profile_id, created_at desc);

create table if not exists music_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references music_orders(id) on delete cascade,
  item_type text not null check (item_type in ('song', 'release', 'merch', 'ticket', 'support')),
  -- Exactly one of these is set, matching item_type — enforced in
  -- application code (POST /api/music/orders), not a DB constraint, to
  -- keep this additive/simple.
  track_id uuid references tracks(id) on delete set null,
  release_id uuid references music_releases(id) on delete set null,
  product_id uuid references products(id) on delete set null,
  event_id uuid references events(id) on delete set null,
  name_snapshot text not null,
  price_snapshot numeric(10,2) not null,
  quantity int not null default 1,
  line_total numeric(10,2) not null,
  variant_snapshot text,
  created_at timestamptz not null default now()
);
create index if not exists music_order_items_order_id_idx on music_order_items (order_id);
create index if not exists music_order_items_track_id_idx on music_order_items (track_id);
create index if not exists music_order_items_release_id_idx on music_order_items (release_id);

-- ============================================================================
-- ROW LEVEL SECURITY — same posture as restaurant: owner/admin only, no
-- anon policy at all. Guest checkout, order-status polling, receipts, and
-- protected-audio access are all mediated through server routes using the
-- admin client, keyed by unguessable order/track ids — never a direct
-- client-side table read for a guest.
-- ============================================================================
alter table music_customers enable row level security;
alter table music_orders enable row level security;
alter table music_order_items enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'music_customers' and policyname = 'music_customers owner all') then
    create policy "music_customers owner all" on music_customers for all using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'music_orders' and policyname = 'music_orders owner all') then
    create policy "music_orders owner all" on music_orders for all using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'music_order_items' and policyname = 'music_order_items owner all') then
    create policy "music_order_items owner all" on music_order_items for all using (
      exists (select 1 from music_orders o join profiles p on p.id = o.profile_id where o.id = order_id and (p.user_id = auth.uid() or is_admin()))
    );
  end if;
end $$;

-- ============================================================================
-- 8. PROTECTED AUDIO STORAGE — a private bucket. Uploading (INSERT) is
--    allowed for a profile owner writing under their own user-id path
--    prefix (mirrors the existing "uploads" bucket's path convention:
--    <userId>/...); there is deliberately NO select/read policy at all —
--    reads only ever happen via the admin (service-role) client from
--    /api/music/tracks/[id]/audio, which bypasses storage RLS entirely
--    after verifying the requester actually purchased the track.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('protected-audio', 'protected-audio', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'protected-audio owner upload'
  ) then
    create policy "protected-audio owner upload" on storage.objects for insert
    with check (bucket_id = 'protected-audio' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'protected-audio owner manage'
  ) then
    create policy "protected-audio owner manage" on storage.objects for all
    using (bucket_id = 'protected-audio' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;
