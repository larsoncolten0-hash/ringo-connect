-- My Ringo notification inbox (the customer's bell). Purely additive: one new table, nothing
-- existing is altered.
--
-- Every push a Ringo customer is sent (community announcements, loyalty, bookings) is also
-- stored here so it can still be found in the bell if the push was swiped away or missed, and so
-- the bell and the app-icon badge can show an unread count. Written by server code only, and
-- always keyed by a customer id the SERVER resolved; never client-supplied. Service-role access
-- only, same posture as the other customer_* tables.

create table if not exists public.customer_notifications (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.ringo_customers(id) on delete cascade,
  -- Which creator it came from, when there is one (community announcements, loyalty, bookings).
  profile_id uuid references public.profiles(id) on delete set null,
  category text not null check (char_length(category) <= 60),
  title text not null check (char_length(title) <= 300),
  body text check (char_length(body) <= 1500),
  url text check (char_length(url) <= 2000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists customer_notifications_customer_idx
  on public.customer_notifications (customer_id, created_at desc);
create index if not exists customer_notifications_unread_idx
  on public.customer_notifications (customer_id) where read_at is null;

alter table public.customer_notifications enable row level security;
revoke all on public.customer_notifications from anon, authenticated;
grant select, insert, update, delete on public.customer_notifications to service_role;
