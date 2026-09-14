-- Admin Users analytics: activity + PWA install tracking (additive).
--
-- last_active_at: updated on real dashboard/admin activity (not just
-- login) via src/middleware.ts, which already runs on every /dashboard
-- and /admin request. Throttled to at most once per 5 minutes per user
-- (cookie-gated in middleware, not a DB read) to keep write volume down —
-- see the ACTIVITY_THROTTLE_SECONDS comment there for the full rationale.
-- This single column backs two admin-facing metrics:
--   "Daily active"     = last_active_at within the last 24 hours
--   "Active recently"  = last_active_at within the last 15 minutes
--                        (there is no real presence/websocket system in
--                        this app — this is a polling-based proxy, always
--                        labeled as such in the admin UI, never as "live").
--
-- last_active_standalone: per-session signal set by the client
-- (src/components/ActivitySignals.tsx -> POST /api/activity/session)
-- alongside last_active_at, recording whether that session was running
-- as an installed PWA (window.matchMedia('(display-mode: standalone)')).
-- This is the proxy for "currently using as installed app" and is what
-- catches iOS home-screen installs, since iOS Safari never fires the
-- `appinstalled` event pwa_installed_at below relies on.
--
-- pwa_installed_at: set once, the first time the browser's `appinstalled`
-- event fires for that user (src/components/ActivitySignals.tsx -> POST
-- /api/pwa/install). This event does NOT fire on iOS Safari at all, so
-- this column structurally undercounts iOS users who added the app to
-- their home screen via the share-sheet flow instead — the admin UI this
-- feeds must surface that caveat, never present this as a complete count.
alter table public.users add column if not exists last_active_at timestamptz;
alter table public.users add column if not exists last_active_standalone boolean not null default false;
alter table public.users add column if not exists pwa_installed_at timestamptz;

-- Both the "daily active" count and the "active in the last N minutes"
-- count filter on this column on every admin Users page load.
create index if not exists idx_users_last_active_at on public.users (last_active_at);
