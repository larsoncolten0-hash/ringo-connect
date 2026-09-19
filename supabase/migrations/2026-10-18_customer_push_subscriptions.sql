-- One Ringo push subscription per customer device. Separate from the legacy
-- push_subscriptions table, whose one-owner constraint is deliberately left untouched.

create table if not exists public.customer_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.ringo_customers(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) <= 2000),
  p256dh text not null,
  auth text not null,
  user_agent text,
  badge_count int not null default 0 check (badge_count >= 0),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists customer_push_subscriptions_customer_idx
  on public.customer_push_subscriptions (customer_id);

alter table public.customer_push_subscriptions enable row level security;
revoke all on public.customer_push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.customer_push_subscriptions to service_role;
