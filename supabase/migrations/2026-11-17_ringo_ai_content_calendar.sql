-- Ringo AI Content Calendar V1 — plan a month, review, approve, get reminded,
-- publish to the EXISTING Ringo Community. NOT YET RUN.
--
-- Purely additive: two new tables and one new function. Touches no existing
-- table, column, RLS policy or function. Publishing reuses
-- community_announcements / sendAnnouncementToSubscribers() as-is — no
-- second posting/fan-out mechanism. No per-user timezone column existed
-- anywhere in this codebase before this migration (confirmed by audit); a
-- `timezone` column is added here per explicit instruction, defaulting to
-- 'UTC' (the safe fallback this codebase already uses everywhere else
-- date-sensitive — see src/lib/ai/tools/period.ts) since no real per-user
-- timezone data exists yet to seed it from.
--
-- Write posture mirrors the AI foundation tables (ai_conversations,
-- ai_messages, ai_drafts), not community_announcements' own RLS: every
-- WRITE goes through the server (src/lib/ai/calendar/**) with the
-- service-role client after resolveAiAccess() has resolved the caller from
-- their own session — there are deliberately no insert/update/delete
-- policies for `authenticated`. Owners can still edit/approve/postpone/
-- delete everything; it just happens through an API route, exactly like
-- ai_drafts and the community announcement composer already work.

-- ============================================================================
-- 1. PLANS — one calendar per profile per month.
-- ============================================================================
create table if not exists public.content_calendar_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  year int not null check (year between 2020 and 2100),
  month smallint not null check (month between 1 and 12),
  title text check (title is null or char_length(title) <= 120),
  -- The quick-choice from "Plan My Month" (e.g. "grow_community",
  -- "promote_products") — informational only, shown back to the owner.
  focus text check (focus is null or char_length(focus) <= 60),
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 60),
  -- No per-user/per-profile locale column exists anywhere in this codebase
  -- today (confirmed by audit) — the existing cron-driven notifications
  -- (downgrade-expired) are English-only for exactly that reason. Rather
  -- than copy that gap, this captures the AI conversation's own locale at
  -- planning time (ctx.locale — the same signal the chat reply itself was
  -- already written in) so the day-of reminder can be sent in the right
  -- language via the existing translation system, without inventing a new
  -- general user-locale-preference system.
  locale text not null default 'en' check (locale in ('en', 'fr')),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, year, month)
);
create index if not exists content_calendar_plans_profile_idx on public.content_calendar_plans (profile_id, year, month);

-- ============================================================================
-- 2. ITEMS — one planned post.
-- ============================================================================
create table if not exists public.content_calendar_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.content_calendar_plans(id) on delete cascade,
  -- Denormalized (also reachable via plan_id) so ownership/RLS/queries never
  -- need a join — same reasoning as ai_usage_events' own user_id/profile_id.
  user_id uuid not null references public.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  scheduled_date date not null,
  scheduled_time time,
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 60),
  title text check (title is null or char_length(title) <= 120),
  content text not null check (char_length(content) between 1 and 3000),
  cta text check (cta is null or char_length(cta) <= 80),
  image_url text check (image_url is null or char_length(image_url) <= 500),
  content_type text not null default 'other' check (content_type in (
    'announcement', 'promotion', 'product', 'service', 'educational', 'engagement',
    'event', 'music', 'behind_the_scenes', 'reminder', 'seasonal', 'community', 'other'
  )),
  -- Mirrors community_announcements.link_type/link_ref_id exactly (same
  -- values, same "no FK, polymorphic" shape) for a direct pass-through on
  -- publish — never a second linking concept.
  link_type text not null default 'none' check (link_type in ('none', 'product', 'music', 'event', 'booking')),
  link_ref_id uuid,
  status text not null default 'draft' check (status in (
    'draft', 'planned', 'approved', 'published', 'postponed', 'skipped', 'cancelled'
  )),
  reminder_enabled boolean not null default true,
  -- The cron's atomic idempotency guard (see content_calendar_claim_due_reminders below).
  reminder_sent_at timestamptz,
  published_at timestamptz,
  -- Set null (not cascade): a deleted announcement shouldn't take the
  -- calendar item's publish history with it.
  community_post_id uuid references public.community_announcements(id) on delete set null,
  ai_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists content_calendar_items_profile_date_idx on public.content_calendar_items (profile_id, scheduled_date);
create index if not exists content_calendar_items_plan_idx on public.content_calendar_items (plan_id);
-- The cron's exact daily query shape (status/reminder_enabled/reminder_sent_at IS NULL).
create index if not exists content_calendar_items_reminder_idx on public.content_calendar_items (scheduled_date, status, reminder_enabled) where reminder_sent_at is null;

-- ============================================================================
-- 3. ROW LEVEL SECURITY — own-or-admin read only, matching ai_conversations/
--    ai_drafts. No write policy for `authenticated`: every write is
--    server-side, service-role, after ownership is re-verified in code.
-- ============================================================================
alter table public.content_calendar_plans enable row level security;
alter table public.content_calendar_items enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'content_calendar_plans' and policyname = 'content_calendar_plans own or admin read') then
    create policy "content_calendar_plans own or admin read" on public.content_calendar_plans for select using (user_id = auth.uid() or is_admin());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'content_calendar_items' and policyname = 'content_calendar_items own or admin read') then
    create policy "content_calendar_items own or admin read" on public.content_calendar_items for select using (user_id = auth.uid() or is_admin());
  end if;
end $$;

-- ============================================================================
-- 4. DUE-REMINDER CLAIM — atomic (single UPDATE...RETURNING; Postgres's own
--    row-level locking makes this race-safe under a concurrently-retried or
--    overlapping cron run without needing an advisory lock, unlike the
--    cross-user aggregate budget check in the image-generation migration).
--    "Today" is computed PER ROW in that item's own timezone (falls back to
--    UTC), not the server's — see the migration's header comment.
-- ============================================================================
create or replace function public.content_calendar_claim_due_reminders()
returns setof public.content_calendar_items
language sql
volatile
security invoker
set search_path = public
as $$
  update public.content_calendar_items
  set reminder_sent_at = now()
  where status = 'approved'
    and reminder_enabled = true
    and reminder_sent_at is null
    and scheduled_date = (now() at time zone coalesce(nullif(timezone, ''), 'UTC'))::date
  returning *;
$$;

-- Service-role only, like every other AI-subsystem RPC: nothing about "which
-- reminders are due right now, across every user" should be callable by an
-- ordinary signed-in user.
revoke all on function public.content_calendar_claim_due_reminders() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.content_calendar_claim_due_reminders() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.content_calendar_claim_due_reminders() from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.content_calendar_claim_due_reminders() to service_role';
  end if;
end $$;
