-- OS-level push notifications (standard Web Push API — see src/lib/push/).
-- Two new tables, additive/idempotent like every migration since
-- 2026-09-12 — see that recurring header note elsewhere for why: this
-- repo's tracked migrations are incomplete relative to the actual live
-- schema, so every statement here is written to be safe to run against a
-- database that already has things in it we don't know about.
--
-- That caution is exactly why this migration builds each table as
-- `create table if not exists <name> (id ...)` followed by
-- `alter table <name> add column if not exists ...` per column, instead
-- of one full column list inside create table: if a table by this name
-- already exists for any reason, `create table if not exists` silently
-- no-ops the WHOLE statement (this is what actually happened on first
-- run here — a pre-existing, differently-shaped `notifications` table
-- elsewhere in the live schema swallowed the original version of this
-- migration's `create table notifications (...)`, leaving it without the
-- columns this feature needs). The alter-per-column form still lands
-- every column this feature needs even in that scenario, and is a no-op
-- per-column on a second run either way. The delivery log below is also
-- named push_delivery_logs, not the generic "notifications" — deliberately
-- distinct from whatever that pre-existing table turned out to be, so
-- this migration can never again silently collide with it or anything
-- else using that common a name.
--
-- Design notes:
--
-- * push_subscriptions has three nullable owner columns + a check
--   constraint (exactly one non-null), the same "who does this belong to"
--   shape profiles.pinned_id/pinned_type uses polymorphically — but with
--   real FKs instead, since there are only ever three concrete owner
--   kinds and each already has its own table:
--     - user_id        → a Ringo Connect creator or admin (authenticated)
--     - subscriber_id   → a fan (community_subscribers row, identified by
--                          their own unsubscribe_token — no Ringo account)
--     - order_id        → a guest restaurant customer tracking one order,
--                          no account and no subscriber row either. Same
--                          "the UUID itself is the access control" pattern
--                          GET /api/orders/[id] already relies on.
--
-- * No anon RLS policy for subscriber_id/order_id rows, on purpose — same
--   reasoning as community_subscribers/orders themselves: every write for
--   those two owner kinds goes through a server route using the admin
--   client, keyed off an unguessable token/id, never a client-side insert
--   under RLS. Only the user_id case gets a real "owner" RLS policy,
--   because that's the one case with an actual authenticated identity.
--
-- * push_delivery_logs is an append-only delivery log — same shape/
--   reasoning as community_delivery_logs and admin_audit_log: one row per
--   attempted send, `delivered`/`error` recording what actually happened,
--   so a silent push failure is debuggable instead of invisible. Also
--   doubles as the foundation for an in-app notification center later,
--   for free.

-- ============================================================================
-- 1. PUSH SUBSCRIPTIONS
-- ============================================================================
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid()
);
alter table push_subscriptions add column if not exists user_id uuid references public.users(id) on delete cascade;
alter table push_subscriptions add column if not exists subscriber_id uuid references community_subscribers(id) on delete cascade;
alter table push_subscriptions add column if not exists order_id uuid references orders(id) on delete cascade;
alter table push_subscriptions add column if not exists endpoint text;
alter table push_subscriptions add column if not exists p256dh text;
alter table push_subscriptions add column if not exists auth text;
alter table push_subscriptions add column if not exists user_agent text;
alter table push_subscriptions add column if not exists created_at timestamptz not null default now();
alter table push_subscriptions add column if not exists last_seen_at timestamptz not null default now();

-- Both a hard uniqueness rule and the ON CONFLICT target the app's own
-- upsert calls rely on (see src/app/api/push/subscribe*/route.ts) — added
-- separately, and guarded, so a second run of this migration never fails
-- on "constraint already exists" the way a plain `unique` inline on the
-- column would if this table already had one from elsewhere.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'push_subscriptions_endpoint_key') then
    alter table push_subscriptions add constraint push_subscriptions_endpoint_key unique (endpoint);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'push_subscriptions_one_owner') then
    alter table push_subscriptions add constraint push_subscriptions_one_owner check (
      (case when user_id is not null then 1 else 0 end)
      + (case when subscriber_id is not null then 1 else 0 end)
      + (case when order_id is not null then 1 else 0 end) = 1
    );
  end if;
end $$;

create index if not exists push_subscriptions_user_id_idx on push_subscriptions (user_id) where user_id is not null;
create index if not exists push_subscriptions_subscriber_id_idx on push_subscriptions (subscriber_id) where subscriber_id is not null;
create index if not exists push_subscriptions_order_id_idx on push_subscriptions (order_id) where order_id is not null;

-- ============================================================================
-- 2. PUSH DELIVERY LOG
-- ============================================================================
create table if not exists push_delivery_logs (
  id uuid primary key default gen_random_uuid()
);
alter table push_delivery_logs add column if not exists user_id uuid references public.users(id) on delete cascade;
alter table push_delivery_logs add column if not exists subscriber_id uuid references community_subscribers(id) on delete cascade;
alter table push_delivery_logs add column if not exists order_id uuid references orders(id) on delete cascade;
alter table push_delivery_logs add column if not exists category text;
alter table push_delivery_logs add column if not exists title text;
alter table push_delivery_logs add column if not exists body text;
alter table push_delivery_logs add column if not exists url text;
alter table push_delivery_logs add column if not exists data jsonb;
alter table push_delivery_logs add column if not exists delivered boolean not null default false;
alter table push_delivery_logs add column if not exists error text;
alter table push_delivery_logs add column if not exists created_at timestamptz not null default now();

create index if not exists push_delivery_logs_user_id_idx on push_delivery_logs (user_id, created_at desc) where user_id is not null;
create index if not exists push_delivery_logs_subscriber_id_idx on push_delivery_logs (subscriber_id, created_at desc) where subscriber_id is not null;
create index if not exists push_delivery_logs_order_id_idx on push_delivery_logs (order_id, created_at desc) where order_id is not null;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table push_subscriptions enable row level security;
alter table push_delivery_logs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'push_subscriptions' and policyname = 'push_subscriptions owner all') then
    create policy "push_subscriptions owner all" on push_subscriptions for all using (
      (user_id is not null and (auth.uid() = user_id or is_admin())) or is_admin()
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'push_delivery_logs' and policyname = 'push_delivery_logs owner read') then
    -- Read-only for the owner — every row here is written exclusively by
    -- the admin-client send helpers (src/lib/push/send.ts), never by hand.
    create policy "push_delivery_logs owner read" on push_delivery_logs for select using (
      (user_id is not null and (auth.uid() = user_id or is_admin())) or is_admin()
    );
  end if;
end $$;
