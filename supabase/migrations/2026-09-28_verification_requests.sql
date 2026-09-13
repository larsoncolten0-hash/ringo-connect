-- Ringo Connect — blue-tick verification requests
-- Run this once in the Supabase SQL editor.
--
-- A creator-facing request queue that feeds the existing `verified`
-- badge on profiles (see 2026-09-14_pin_and_verified.sql), which until
-- now was admin-granted only with no way for a creator to actually ask
-- for it (UserTable.tsx's manual toggle). This adds the missing "ask"
-- side: a small form (real name, phone, location — see
-- src/components/dashboard/VerificationRequestModal.tsx) a creator
-- submits from their profile menu, reviewed by an admin at
-- /admin/verification. Approving a request is the only thing that
-- actually flips profiles.verified (see
-- src/app/api/admin/verification/[id]/approve/route.ts) — this table
-- itself never grants the badge.
--
-- Additive/idempotent, same convention as every migration since
-- 2026-09-12.

create table if not exists verification_requests (
  id uuid primary key default gen_random_uuid()
);
alter table verification_requests add column if not exists user_id uuid references public.users(id) on delete cascade;
alter table verification_requests add column if not exists full_name text;
alter table verification_requests add column if not exists phone_number text;
alter table verification_requests add column if not exists location text;
alter table verification_requests add column if not exists status text not null default 'pending';
-- Optional context an admin can leave when rejecting — not shown to the
-- creator in this first pass (the rejection notification is a fixed,
-- friendly message), but recorded so a future admin reviewing history
-- can see why.
alter table verification_requests add column if not exists admin_note text;
alter table verification_requests add column if not exists reviewed_by uuid references public.users(id) on delete set null;
alter table verification_requests add column if not exists reviewed_at timestamptz;
alter table verification_requests add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'verification_requests_status_check') then
    alter table verification_requests add constraint verification_requests_status_check check (status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

-- One active (pending) request per creator at a time — stops someone
-- from spamming submissions while a request is already awaiting review.
-- A rejected request doesn't block a fresh resubmission since this index
-- only covers status = 'pending', so a new insert after a rejection is
-- always allowed.
create unique index if not exists verification_requests_one_pending_per_user
  on verification_requests (user_id) where status = 'pending';

create index if not exists verification_requests_status_idx on verification_requests (status, created_at desc);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- Reads/writes go through the API routes using each caller's own session
-- client (the creator-facing GET/POST) or the service-role client gated
-- by assertAdmin() (the admin review routes) — same posture as
-- support_conversations/support_messages.
alter table verification_requests enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'verification_requests' and policyname = 'verification_requests select own or admin') then
    create policy "verification_requests select own or admin" on verification_requests for select using (
      user_id = auth.uid() or is_admin()
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'verification_requests' and policyname = 'verification_requests insert own') then
    -- A creator can only ever create their own request, and only in the
    -- 'pending' state — approving/rejecting is admin-only (see the
    -- update policy below), never something the submitter can set.
    create policy "verification_requests insert own" on verification_requests for insert with check (
      user_id = auth.uid() and status = 'pending'
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'verification_requests' and policyname = 'verification_requests update admin only') then
    create policy "verification_requests update admin only" on verification_requests for update using (
      is_admin()
    );
  end if;
end $$;
