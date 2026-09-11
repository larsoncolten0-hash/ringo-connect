-- Community / Audience system — lets any Ringo profile build a private
-- subscriber list (email primary, phone optional) and send them manual
-- Announcements or an explicit per-product "notify" email. See
-- src/app/dashboard/community/*, src/app/[username]/community/page.tsx,
-- src/app/community/manage/[token]/page.tsx.
--
-- Design notes (why this looks the way it does):
--
-- * Mirrors the bookings system (2026-09-18_booking_system.sql) almost
--   exactly: a per-profile child entity, NO anon RLS policy anywhere in
--   this group, every public read/write mediated by a server route using
--   the admin client keyed off an unguessable id/token. That's what makes
--   "creator A can never see creator B's subscribers" and "subscribers
--   can't see other subscribers" structurally true rather than merely
--   policy-configured.
--
-- * community_subscription_preferences is its own table, not columns on
--   community_subscribers — same reasoning restaurant_food's
--   customer_marketing_consent already uses: consent is a separate,
--   explicit fact, never inferred from "an email/phone was submitted."
--   email_updates/whatsapp_updates each default false and are set ONLY
--   from what the subscriber actually checked on the form.
--
-- * notify_products/notify_music/notify_events/notify_announcements/
--   notify_offers default TRUE (unlike the channel flags) — these are
--   content-type filters that only ever matter once a channel is already
--   opted into; defaulting them open means a new subscriber gets
--   everything relevant to the channel they chose, and can narrow later
--   from /community/manage/[token], rather than having to re-discover and
--   turn on five toggles just to get what they already signed up for.
--
-- * community_delivery_logs has a unique (announcement_id, subscriber_id,
--   channel) — re-running a send (retry after a partial failure) can never
--   double-email the same person, the same idempotency reasoning
--   order_status_history/booking_status_history already rely on for their
--   own append-only logs.
--
-- * products.community_notified_at (nullable, single timestamp) gates the
--   one-shot "📣 Notify community" action in ProductRow — see that
--   component and /api/community/notify. Deliberately not a bulk-save
--   checkbox: CatalogCard's saveAll() batches every product's field edits
--   at once, so there is no single "this product just got published"
--   moment to hang a checkbox on.
--
-- Additive/idempotent throughout, same reasoning as every migration since
-- 2026-09-12 (this repo's migration history is incomplete relative to the
-- live schema).

-- ============================================================================
-- 1. PROFILE-LEVEL COMMUNITY SETTINGS
-- ============================================================================
alter table profiles add column if not exists community_enabled boolean not null default false;
-- Flexible CTA wording (see spec: "Join My Community" / "Stay Connected" /
-- "Get Updates" / ...) — null means the UI falls back to a built-in default,
-- the same override precedence booking_button_text/default_whatsapp_message
-- already use.
alter table profiles add column if not exists community_label text;

-- ============================================================================
-- 2. SUBSCRIBERS
-- ============================================================================
create table if not exists community_subscribers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  name text,
  email text,
  phone text,
  source text not null default 'ringo_profile' check (
    source in ('ringo_profile', 'qr_code', 'nfc', 'product', 'music', 'event', 'restaurant', 'other')
  ),
  status text not null default 'active' check (status in ('active', 'unsubscribed', 'removed')),
  -- Unguessable public key for /community/manage/[token] — never the row's
  -- own id, same reasoning restaurant_tables.public_code already uses for
  -- its QR links.
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists community_subscribers_profile_id_idx on community_subscribers (profile_id, created_at desc);
create unique index if not exists community_subscribers_profile_email_idx
  on community_subscribers (profile_id, lower(email)) where email is not null;

-- ============================================================================
-- 3. SUBSCRIPTION PREFERENCES (separate table — see header note above)
-- ============================================================================
create table if not exists community_subscription_preferences (
  subscriber_id uuid primary key references community_subscribers(id) on delete cascade,
  email_updates boolean not null default false,
  whatsapp_updates boolean not null default false,
  notify_products boolean not null default true,
  notify_music boolean not null default true,
  notify_events boolean not null default true,
  notify_announcements boolean not null default true,
  notify_offers boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 4. ANNOUNCEMENTS
-- ============================================================================
create table if not exists community_announcements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  message text not null,
  image_url text,
  link_type text not null default 'none' check (link_type in ('none', 'custom', 'product', 'music', 'event', 'booking')),
  link_url text,
  -- Polymorphic on purpose (points at products/tracks/events depending on
  -- link_type) — the same no-strict-FK pattern profiles.pinned_id/
  -- pinned_type already uses for the same reason.
  link_ref_id uuid,
  audience text not null default 'all' check (audience in ('all', 'email', 'whatsapp')),
  -- Which notify_* preference this announcement is gated by. 'product' is
  -- what /api/community/notify always sets; the manual composer lets the
  -- owner pick this for a hand-written Announcement.
  notification_category text not null default 'announcement' check (
    notification_category in ('announcement', 'product', 'music', 'event', 'offer')
  ),
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'failed')),
  recipient_count int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists community_announcements_profile_id_idx on community_announcements (profile_id, created_at desc);

-- ============================================================================
-- 5. DELIVERY LOGS
-- ============================================================================
create table if not exists community_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references community_announcements(id) on delete cascade,
  subscriber_id uuid not null references community_subscribers(id) on delete cascade,
  channel text not null default 'email' check (channel in ('email', 'whatsapp')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (announcement_id, subscriber_id, channel)
);
create index if not exists community_delivery_logs_announcement_id_idx on community_delivery_logs (announcement_id);

-- ============================================================================
-- 6. PRODUCT NOTIFY GATE
-- ============================================================================
alter table products add column if not exists community_notified_at timestamptz;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- No anon policy anywhere in this group. Every public interaction
-- (subscribe, manage/unsubscribe by token, sending an announcement, the
-- product-notify action) goes through a server route using the admin
-- client — see /api/community/*. This is deliberate: it's what makes
-- subscriber emails/phones and other creators' subscriber lists actually
-- unreachable, not just policy-guarded.
alter table community_subscribers enable row level security;
alter table community_subscription_preferences enable row level security;
alter table community_announcements enable row level security;
alter table community_delivery_logs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'community_subscribers' and policyname = 'community_subscribers owner all') then
    create policy "community_subscribers owner all" on community_subscribers for all using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'community_subscription_preferences' and policyname = 'community_subscription_preferences owner all') then
    create policy "community_subscription_preferences owner all" on community_subscription_preferences for all using (
      exists (
        select 1 from community_subscribers s
        join profiles p on p.id = s.profile_id
        where s.id = subscriber_id and (p.user_id = auth.uid() or is_admin())
      )
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'community_announcements' and policyname = 'community_announcements owner all') then
    create policy "community_announcements owner all" on community_announcements for all using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'community_delivery_logs' and policyname = 'community_delivery_logs owner read') then
    -- Read-only for the owner (delivery logs are written exclusively by
    -- the admin-client send route, never edited by hand).
    create policy "community_delivery_logs owner read" on community_delivery_logs for select using (
      exists (
        select 1 from community_announcements a
        join profiles p on p.id = a.profile_id
        where a.id = announcement_id and (p.user_id = auth.uid() or is_admin())
      )
    );
  end if;
end $$;
