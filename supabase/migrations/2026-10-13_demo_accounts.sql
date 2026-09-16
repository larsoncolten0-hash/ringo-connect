-- "Try the dashboard" demo accounts — a fresh, throwaway, isolated Business
-- Pro account created via anonymous auth (supabase.auth.signInAnonymously),
-- auto-expiring after 7 days. See src/app/demo/page.tsx,
-- src/app/api/demo/create/route.ts, and
-- src/app/api/cron/cleanup-demo-accounts/route.ts.
--
-- Purely additive: two new nullable/defaulted columns on `profiles`, one
-- new table for rate-limiting demo creation, no existing column/table
-- touched or changed.

alter table profiles add column if not exists is_demo boolean not null default false;
alter table profiles add column if not exists demo_expires_at timestamptz;

-- Lets the daily cleanup cron find expired demo accounts without a full
-- table scan (see cleanup-demo-accounts/route.ts). Partial index: real
-- accounts (the overwhelming majority of rows) never enter it at all.
create index if not exists profiles_demo_expiry_idx on profiles (demo_expires_at) where is_demo = true;

-- Minimal, narrowly-scoped rate limiting for demo account creation only —
-- this app has no general-purpose rate-limiting infrastructure (a known
-- gap noted in an earlier review), and this isn't meant to become one. One
-- row per successfully created demo account, keyed by the creating IP; the
-- create route counts rows from the last 24h before allowing another.
create table if not exists demo_signup_attempts (
  id uuid primary key default gen_random_uuid(),
  ip text not null,
  created_at timestamptz not null default now()
);
create index if not exists demo_signup_attempts_ip_created_idx on demo_signup_attempts (ip, created_at);

alter table demo_signup_attempts enable row level security;
-- No policies defined on purpose — this table is only ever read/written by
-- the service-role client in src/app/api/demo/create, which bypasses RLS
-- entirely. With RLS enabled and zero policies, the anon/authenticated
-- keys get zero access to it, which is exactly the intent.
