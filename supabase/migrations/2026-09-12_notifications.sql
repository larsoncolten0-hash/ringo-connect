-- Ringo Connect — in-app notifications
-- Run this once in the Supabase SQL editor.
--
-- Backs the notification bell shown to full admins (AdminShell) and to
-- every signed-in user (DashboardShell) — including "super creators", who
-- share the exact same per-user channel a regular creator would eventually
-- use. Two independent "audiences" live in one table rather than two:
--   - 'admin'  — broadcast to every full admin at once (role = 'admin').
--     No user_id; visibility is entirely role-based (is_admin()).
--   - 'user'   — targeted at exactly one account via user_id. Used today
--     for a super creator's "someone signed up through your link" alert
--     and a new creator's "you're approved" welcome, but the shape works
--     for any future per-user notification without another migration.
--
-- Rows are only ever inserted by server code holding the service-role
-- client (see src/lib/notifications.ts) — signup submission and request
-- approval/rejection are the only writers today. The RLS insert policy
-- below exists only so an admin session could write one directly (e.g.
-- from the SQL editor or a future admin-authored broadcast), not because
-- the app's own code path relies on it.
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('admin', 'user')),
  -- Required when audience = 'user', null when audience = 'admin' — not a
  -- check constraint because Postgres check constraints can't easily
  -- express "required unless X" alongside a foreign key; the app is the
  -- only writer and always sets this correctly for each audience.
  user_id uuid references public.users(id) on delete cascade,
  type text not null,                      -- 'signup_request' | 'request_approved' | ...
  title text not null,
  body text,
  link text,                               -- e.g. '/admin/requests/{id}' or '/dashboard/requests/{id}'
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_admin_unread_idx
  on notifications (created_at desc) where audience = 'admin';
create index if not exists notifications_user_idx
  on notifications (user_id, created_at desc) where audience = 'user';

alter table notifications enable row level security;

-- Every full admin sees every 'admin' notification; a user only ever sees
-- their own 'user' notifications (admins can see those too, for support).
create policy "notifications read" on notifications for select using (
  (audience = 'admin' and is_admin())
  or (audience = 'user' and (user_id = auth.uid() or is_admin()))
);

-- The only client-side write today is marking one's own notification read
-- (or an admin triaging on someone's behalf) — nothing here lets a user
-- edit the title/body/link of a row they didn't write.
create policy "notifications mark read" on notifications for update using (
  (audience = 'admin' and is_admin())
  or (audience = 'user' and (user_id = auth.uid() or is_admin()))
);

create policy "notifications insert by admin" on notifications for insert with check (is_admin());
