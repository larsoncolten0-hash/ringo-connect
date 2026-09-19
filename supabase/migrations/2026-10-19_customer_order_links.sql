-- Links a Ringo customer to the guest purchase records they made while signed in.
-- Purely additive: touches no existing table, column, constraint, policy or function.
-- Service-role access only (same posture as the other customer_* tables).
--
-- Why a separate table instead of a column on music_orders / orders / bookings:
--   * those tables are guest records owned by other features; a mapping table leaves
--     them (and their RLS, triggers and receipt/audio access rules) completely untouched
--   * one table serves every purchase kind, and dropping it leaves zero trace
--   * unique (order_kind, order_id) guarantees a record belongs to AT MOST one customer
--
-- A row is written only by server code, from the authenticated customer SESSION, at the
-- moment a signed-in customer places the order. Nothing here is client-supplied.
--
-- order_id is deliberately NOT a foreign key: it points at different tables depending on
-- order_kind (same polymorphic pattern as community_announcements.link_ref_id).

create table if not exists public.customer_order_links (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.ringo_customers(id) on delete cascade,
  order_kind text not null check (order_kind in ('music_order', 'restaurant_order', 'booking')),
  order_id uuid not null,
  link_source text not null default 'checkout_session' check (char_length(link_source) <= 40),
  created_at timestamptz not null default now(),
  unique (order_kind, order_id)
);
create index if not exists customer_order_links_customer_idx
  on public.customer_order_links (customer_id, order_kind, created_at desc);

alter table public.customer_order_links enable row level security;
revoke all on public.customer_order_links from anon, authenticated;
grant select, insert, update, delete on public.customer_order_links to service_role;
