-- Multiple ticket types per event (Standard/VIP/VVIP/Platinum/etc, fully
-- artist-defined — see src/lib/ticketTypes.ts) + real digital tickets with
-- QR passes. Extends the existing single-price ticket model on `events`
-- (2026-09-16_music_commerce.sql) rather than replacing it: an event with
-- zero rows in event_ticket_types keeps working exactly as it does today
-- (events.price/ticket_type/ticket_capacity/tickets_sold, the legacy
-- WhatsApp/ticket_url fallback, the existing checkout path) — this
-- migration is purely additive, nothing about an existing event changes
-- until an artist actually adds a ticket type to it.
--
-- Design notes:
--
-- * event_ticket_types.price/benefits/etc. are the *current* configuration
--   only. Every purchase still snapshots name/price onto
--   music_order_items (name_snapshot/price_snapshot, already existed) —
--   editing a ticket type's price or benefits later never rewrites a past
--   purchase. ticket_type_id on music_order_items is just a pointer back
--   to "which tier was this", nullable because every pre-existing order
--   item (and every future legacy single-price ticket purchase) has none.
--
-- * Inventory (sold_quantity) is updated through reserve_event_ticket_type()
--   below — a single atomic UPDATE, not a read-then-write — specifically
--   because the existing events.tickets_sold/products.inventory_count
--   updates in /api/music/orders are explicitly best-effort/non-atomic
--   (see that route's own comment); tickets need the real guarantee so two
--   fans can never both win the last seat. Locked to service_role only
--   (see the revoke/grant at the bottom) — it does no ownership check of
--   its own, so it must never be callable directly from the browser.
--
-- * digital_tickets gets its own short, random, unguessable ticket_code —
--   not the row's own uuid — mirroring restaurant_tables.public_code
--   (2026-09-15_restaurant_food.sql) exactly, for the same reason: this
--   code ends up in a QR a fan may screenshot or show at a door, so it
--   should never double as a leak of the raw internal id.
--
-- Additive/idempotent throughout, same reasoning as every migration since
-- 2026-09-12.

-- ============================================================================
-- 1. EVENTS — event-level additions
-- ============================================================================
-- Ticket sales must respect the event itself being open for sale, not just
-- the profile being published — 'published' is the default so every
-- existing event keeps selling exactly as before.
alter table events add column if not exists status text not null default 'published';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_status_check') then
    alter table events add constraint events_status_check check (status in ('draft', 'published', 'cancelled', 'completed'));
  end if;
end $$;

-- Null = no limit. Applies across every ticket type on this event; see
-- event_ticket_types.max_per_customer below for the additional, optional
-- per-type cap layered on top of this one.
alter table events add column if not exists max_tickets_per_customer int;

-- ============================================================================
-- 2. EVENT TICKET TYPES — unlimited, fully custom tiers per event
-- ============================================================================
create table if not exists event_ticket_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  description text,
  -- One bullet per array element — optional, an artist never has to fill
  -- this in (see EventTicketTypesEditor.tsx).
  benefits text[] not null default '{}'::text[],
  price numeric(10,2) not null default 0,
  total_quantity int,                 -- null = unlimited
  sold_quantity int not null default 0,
  sales_start_at timestamptz,         -- null = on sale immediately
  sales_end_at timestamptz,           -- null = never automatically closes
  max_per_customer int,               -- null = only events.max_tickets_per_customer applies
  is_active boolean not null default true,
  is_primary boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists event_ticket_types_event_id_idx on event_ticket_types (event_id, sort_order);

-- Exactly one primary ticket type per event — enforced here, not just in
-- application code, so a race between two saves can never leave two
-- ticket types both marked primary.
create unique index if not exists event_ticket_types_one_primary_idx on event_ticket_types (event_id) where is_primary;

alter table event_ticket_types enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'event_ticket_types' and policyname = 'event_ticket_types public read') then
    create policy "event_ticket_types public read" on event_ticket_types for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'event_ticket_types' and policyname = 'event_ticket_types owner write') then
    create policy "event_ticket_types owner write" on event_ticket_types for all using (
      exists (
        select 1 from events e join profiles p on p.id = e.profile_id
        where e.id = event_id and (p.user_id = auth.uid() or is_admin())
      )
    );
  end if;
end $$;

-- ============================================================================
-- 3. MUSIC ORDER ITEMS — point a purchased ticket at the tier it was for
-- ============================================================================
-- Null for every non-ticket line, and for a legacy single-price ticket
-- purchase (an event with no event_ticket_types rows) — event_id alone
-- already identifies those exactly as it always has.
alter table music_order_items add column if not exists ticket_type_id uuid references event_ticket_types(id) on delete set null;
create index if not exists music_order_items_ticket_type_id_idx on music_order_items (ticket_type_id);

-- ============================================================================
-- 4. DIGITAL TICKETS — one row per physical ticket (a quantity-3 purchase
--    of one tier produces 3 independently valid/used/cancelled rows)
-- ============================================================================
create table if not exists digital_tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references music_orders(id) on delete cascade,
  order_item_id uuid not null references music_order_items(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  ticket_type_id uuid references event_ticket_types(id) on delete set null,
  ticket_code text not null unique,
  attendee_name text not null,
  status text not null default 'valid' check (status in ('valid', 'used', 'cancelled', 'refunded')),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists digital_tickets_order_id_idx on digital_tickets (order_id);
create index if not exists digital_tickets_profile_id_idx on digital_tickets (profile_id, created_at desc);
create index if not exists digital_tickets_event_id_idx on digital_tickets (event_id);
create index if not exists digital_tickets_ticket_code_idx on digital_tickets (ticket_code);

-- Same generator as restaurant_tables.public_code — see that migration's
-- own comment for why a QR-facing code is never the row's raw id.
create or replace function set_digital_ticket_code() returns trigger as $$
declare
  candidate text;
  attempts int := 0;
begin
  if new.ticket_code is not null then
    return new;
  end if;
  loop
    candidate := upper(encode(gen_random_bytes(6), 'hex'));
    attempts := attempts + 1;
    exit when not exists (select 1 from digital_tickets where ticket_code = candidate);
    if attempts > 20 then
      candidate := upper(replace(new.id::text, '-', '')) || attempts::text;
      exit;
    end if;
  end loop;
  new.ticket_code := candidate;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_set_digital_ticket_code on digital_tickets;
create trigger trg_set_digital_ticket_code
before insert on digital_tickets
for each row execute function set_digital_ticket_code();

alter table digital_tickets enable row level security;
do $$
begin
  -- Owner/admin only — no anon policy, same posture as music_orders/
  -- music_order_items. A fan's own tickets are read through the ticket-pass
  -- page (src/app/m/[username]/ticket-pass/[code]/page.tsx), which uses the
  -- admin client keyed by the unguessable ticket_code, never a direct
  -- client-side table read.
  if not exists (select 1 from pg_policies where tablename = 'digital_tickets' and policyname = 'digital_tickets owner all') then
    create policy "digital_tickets owner all" on digital_tickets for all using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
    );
  end if;
end $$;

-- ============================================================================
-- 5. ATOMIC INVENTORY RESERVATION
-- ============================================================================
-- A single UPDATE's WHERE clause is evaluated under that row's own lock —
-- two concurrent reservations for the last ticket can never both succeed,
-- the second only proceeds once the first has committed, at which point
-- sold_quantity already reflects it. Returns the updated row, or null if
-- unavailable (inactive, outside its sales window, or not enough
-- remaining inventory) — the caller treats null as "sold out".
--
-- Deliberately does no ownership/authorization check of its own (it isn't
-- given an auth.uid() to check against — a guest checkout has none) — see
-- the revoke/grant below, which is what actually keeps this from being
-- callable by anything other than the trusted server route.
create or replace function reserve_event_ticket_type(p_ticket_type_id uuid, p_quantity int)
returns event_ticket_types as $$
declare
  v_row event_ticket_types;
begin
  if p_quantity is null or p_quantity < 1 then
    return null;
  end if;

  update event_ticket_types
  set sold_quantity = sold_quantity + p_quantity,
      updated_at = now()
  where id = p_ticket_type_id
    and is_active
    and (sales_start_at is null or sales_start_at <= now())
    and (sales_end_at is null or sales_end_at >= now())
    and (total_quantity is null or sold_quantity + p_quantity <= total_quantity)
  returning * into v_row;

  return v_row;
end;
$$ language plpgsql security definer;

revoke all on function reserve_event_ticket_type(uuid, int) from public, anon, authenticated;
grant execute on function reserve_event_ticket_type(uuid, int) to service_role;

-- Mirror image of the above — used when an order fails to complete after
-- a reservation already succeeded, so a dropped request never
-- permanently locks a ticket away from sale. Always succeeds (there is no
-- availability condition to release inventory back).
create or replace function release_event_ticket_type(p_ticket_type_id uuid, p_quantity int)
returns void as $$
begin
  if p_quantity is null or p_quantity < 1 then
    return;
  end if;
  update event_ticket_types
  set sold_quantity = greatest(0, sold_quantity - p_quantity),
      updated_at = now()
  where id = p_ticket_type_id;
end;
$$ language plpgsql security definer;

revoke all on function release_event_ticket_type(uuid, int) from public, anon, authenticated;
grant execute on function release_event_ticket_type(uuid, int) to service_role;
