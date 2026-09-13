-- Ringo Connect — generic transactional email delivery log.
--
-- WHY A NEW TABLE, NOT REUSE: community_delivery_logs already exists
-- (2026-09-19_community_system.sql) and logs email sends too, but its
-- shape is specific to that one feature — it hard-references
-- announcement_id and subscriber_id, both FKs into community_* tables.
-- A restaurant order receipt, a music/ticket receipt, a booking email, or
-- a platform admin email (payment/approval) has none of those — the
-- "resource" being emailed about is a different table every time (orders,
-- music_orders, bookings, signup_requests, users), and there is no single
-- FK column that could point at all of them. This table intentionally
-- uses a loose (resource_type text, resource_id uuid) pair instead —
-- same "no hard FK, just a labeled pointer" shape the existing
-- `notifications` table already uses for its own `type`/`link` columns —
-- rather than a fifth polymorphic-owner-column table. Community mail
-- keeps using community_delivery_logs exactly as it does today; this
-- table is additive alongside it, not a replacement.
--
-- One row per (attempted send, recipient) — a fan-out to N admin
-- addresses in one Resend call becomes N rows, mirroring
-- community_delivery_logs' own one-row-per-subscriber granularity, so a
-- single bounce among several recipients is visible precisely.
--
-- Deliberately does NOT store the email subject or HTML body — only the
-- metadata needed to answer "did this send, to whom, and if not why,"
-- per this feature's own instruction not to retain unnecessary email
-- content.
create table if not exists email_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  -- A short caller-chosen label, e.g. 'restaurant_order_receipt',
  -- 'music_order_receipt', 'booking_received', 'signup_approved',
  -- 'subscription_payment' — free text, not an enum, so a new email type
  -- never needs a migration to start logging (same posture as
  -- notifications.type).
  email_type text not null,
  resource_type text,
  resource_id uuid,
  recipient_email text not null,
  -- 'sent' = Resend accepted the API call (provider.ts's own doing, the
  -- moment a send is attempted). 'delivered'/'bounced'/'complained' are
  -- later, more specific outcomes the PHASE 4 webhook advances a 'sent'
  -- row to once Resend reports what actually happened at the recipient's
  -- mail server — never set anywhere except that webhook route. 'pending'
  -- exists for a future retry queue (PHASE 7) and is never produced by
  -- today's synchronous send path.
  status text not null default 'pending' check (status in ('pending', 'sent', 'delivered', 'bounced', 'complained', 'failed')),
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists email_delivery_logs_type_idx on email_delivery_logs (email_type, created_at desc);
create index if not exists email_delivery_logs_resource_idx on email_delivery_logs (resource_type, resource_id) where resource_id is not null;
-- Not unique — see this migration's header note on a multi-recipient send
-- sharing one Resend message id across several rows; a webhook event
-- (PHASE 4) matches on this AND recipient_email together.
create index if not exists email_delivery_logs_provider_message_id_idx on email_delivery_logs (provider_message_id) where provider_message_id is not null;

-- ============================================================================
-- SUPPRESSION LIST — PHASE 4 groundwork
-- ============================================================================
-- A bounced/complained address gets a row here; future sends can check it
-- before attempting delivery (not wired into the send path yet — this
-- migration only lays the table down, per this feature's own "prepare the
-- architecture" instruction). Deliberately separate from marketing
-- unsubscribe (community_subscription_preferences.email_updates): a
-- hard-bounced address should stop receiving marketing AND transactional
-- mail (nothing to deliver to), but marketing opt-out must never suppress
-- transactional mail — keeping this its own table, rather than folding
-- into either existing consent mechanism, is what keeps those two
-- questions ("can we market to X" vs "does X's inbox even work") from
-- ever being conflated by a future change to one and not the other.
create table if not exists email_suppressions (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  reason text not null check (reason in ('bounced', 'complained', 'manual')),
  -- The raw Resend event type that caused this (e.g. 'email.bounced'),
  -- kept for debugging — never used for logic, only display.
  source_event text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- No anon policy on either table — every write goes through the
-- service-role client (sendEmail() in src/lib/email/provider.ts, and the
-- Resend webhook route), same posture as push_delivery_logs/
-- community_delivery_logs. Admin-only read, for the same debugging
-- purpose those tables serve.
alter table email_delivery_logs enable row level security;
alter table email_suppressions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'email_delivery_logs' and policyname = 'email_delivery_logs admin read') then
    create policy "email_delivery_logs admin read" on email_delivery_logs for select using (is_admin());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'email_suppressions' and policyname = 'email_suppressions admin read') then
    create policy "email_suppressions admin read" on email_suppressions for select using (is_admin());
  end if;
end $$;
