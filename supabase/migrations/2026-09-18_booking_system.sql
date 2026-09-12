-- Universal booking system — one reusable request → review → status engine
-- for every category (Music "Book Artist", Restaurant "Book a Table", Real
-- Estate "Request Viewing", Professional Services "Book Consultation", …),
-- not a per-category feature. See src/lib/categories.ts for how each
-- category's button label and visible form fields are derived; the schema
-- itself stays generic.
--
-- Design notes (why this looks the way it does):
--
-- * Booking SETTINGS (bookings_enabled, button text, description) live as
--   plain columns on `profiles`, exactly like every other category's
--   settings (dine_in_enabled, music_role, ordering_enabled) — there is no
--   separate "settings" table anywhere else in this schema, so booking
--   doesn't get one either.
--
-- * `bookings` mirrors the restaurant `orders` table's shape and RLS
--   posture almost exactly: no anon policy at all. Every public read/write
--   goes through an admin-client API route keyed by the row's own
--   unguessable UUID (see /api/bookings and /api/bookings/[id]) — the same
--   reasoning as orders/order_items/restaurant_customers.
--
-- * `booking_status_history` mirrors `order_status_history` — a booking's
--   status is never silently overwritten without a trace.
--
-- * `service_id` is nullable and paired with `service_name_snapshot`, the
--   same pattern as `order_items.item_name_snapshot`: if a service is later
--   renamed or deleted, past bookings keep showing what the customer
--   actually picked at the time.
--
-- * `details jsonb` holds the long tail of category-specific extras (event
--   type, meeting type, preferred contact method, …) instead of a growing
--   list of nullable columns — the same reasoning `profiles.opening_hours`
--   already uses jsonb for.
--
-- * Deliberately NOT built here (documented instead, per the brief this was
--   built from — "don't overbuild the first version"):
--     - Payment: no columns exist yet. When it's wanted, it would attach to
--       `bookings` the same way `payment_status`/`payment_method` already
--       attach to `orders`.
--     - Real availability/calendar: bookings don't check for conflicts —
--       multiple requests for the same slot are allowed, and the owner
--       decides. A future "working days/hours" structure would most
--       naturally follow `profiles.opening_hours`'s jsonb-on-profiles
--       pattern rather than a new table.
--
-- Additive/idempotent throughout, same reasoning as every migration since
-- 2026-09-12 (this repo's migration history is incomplete relative to the
-- live schema).

-- ============================================================================
-- 1. PROFILE-LEVEL BOOKING SETTINGS
-- ============================================================================
alter table profiles add column if not exists bookings_enabled boolean not null default false;
alter table profiles add column if not exists booking_button_text text;
alter table profiles add column if not exists booking_description text;

-- ============================================================================
-- 2. BOOKING SERVICES — an owner-managed list a visitor can pick from
--    (e.g. "Live Performance", "Wedding Photography", "Business
--    Consultation"). Optional: a booking can omit a service entirely.
-- ============================================================================
create table if not exists booking_services (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists booking_services_profile_id_idx on booking_services (profile_id);

-- ============================================================================
-- 3. BOOKINGS
-- ============================================================================
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  service_id uuid references booking_services(id) on delete set null,
  service_name_snapshot text,
  customer_name text not null,
  customer_email text,
  customer_phone text not null,
  booking_date date,
  booking_time text,
  party_size int,
  location text,
  budget text,
  -- Category-specific extras that don't earn their own column yet:
  -- { event_type, meeting_type, preferred_contact_method, ... }
  details jsonb not null default '{}'::jsonb,
  notes text,
  status text not null default 'pending' check (
    status in ('pending', 'confirmed', 'declined', 'cancelled', 'completed')
  ),
  -- Explicit, opt-in only — a booking never auto-subscribes anyone to
  -- anything (see the "stay connected" checkboxes on the booking form).
  consent_email_updates boolean not null default false,
  consent_whatsapp_updates boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bookings_profile_id_idx on bookings (profile_id, created_at desc);
create index if not exists bookings_status_idx on bookings (profile_id, status);

create table if not exists booking_status_history (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  status text not null,
  changed_by uuid references public.users(id),
  changed_at timestamptz not null default now()
);
create index if not exists booking_status_history_booking_id_idx on booking_status_history (booking_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- booking_services is public-readable (shown on the public booking form,
-- same as menu_categories) — everything else here is owner/admin only, with
-- NO anon policy on bookings/booking_status_history at all: public
-- submission, status polling, and confirmation all go through server routes
-- using the admin client (see /api/bookings, /api/bookings/[id]), never a
-- direct client-side table read/write. This is what makes "profile A can't
-- see profile B's bookings" actually true — there's no anon policy to
-- misconfigure in the first place.
alter table booking_services enable row level security;
alter table bookings enable row level security;
alter table booking_status_history enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'booking_services' and policyname = 'booking_services public read') then
    create policy "booking_services public read" on booking_services for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'booking_services' and policyname = 'booking_services owner write') then
    create policy "booking_services owner write" on booking_services for all using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'bookings' and policyname = 'bookings owner all') then
    create policy "bookings owner all" on bookings for all using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'booking_status_history' and policyname = 'booking_status_history owner all') then
    create policy "booking_status_history owner all" on booking_status_history for all using (
      exists (select 1 from bookings b join profiles p on p.id = b.profile_id where b.id = booking_id and (p.user_id = auth.uid() or is_admin()))
    );
  end if;
end $$;
