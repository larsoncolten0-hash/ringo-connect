-- Web Push subscriptions — lets the server wake a signed-in user's
-- installed app (dashboard or admin console) with a native push
-- notification even while it isn't open, via the Web Push API (see
-- src/lib/push/send.ts and public/pwa-sw.js's `push` handler).
--
-- One row per browser/device a user has granted notification permission
-- on and subscribed from (see src/lib/push/client.ts) — a person signed
-- in on both their phone and laptop gets two rows, and both receive every
-- notification sent to their user_id. `endpoint` (the push service URL
-- the browser hands back from PushManager.subscribe()) is globally unique
-- by construction — reused as the natural conflict target for the
-- subscribe route's upsert, so re-subscribing the same browser (e.g.
-- after clearing the permission and re-granting it) updates the same row
-- instead of accumulating duplicates.
--
-- `p256dh`/`auth` are the subscription's public key and auth secret,
-- required by the Web Push protocol to encrypt each message for that
-- specific browser — not application secrets, but still only ever read
-- server-side via the service-role client (src/lib/push/send.ts), never
-- selected back to a client.
--
-- Additive/idempotent, same convention as every migration since 2026-09-12.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  -- Diagnostics only (which browser/device this is) — never relied on for
  -- anything functional.
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx on push_subscriptions (user_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- Same owner-or-admin posture as ringo_cards above: a signed-in user only
-- ever manages their own subscriptions (subscribe/unsubscribe routes use
-- the regular per-request client, scoped by auth.uid()), and admins can
-- see the full table from the dashboard's own admin client. Sending a
-- push, though, always goes through the service-role client
-- (src/lib/push/send.ts needs to read every recipient's subscriptions
-- regardless of who's logged in when a webhook or API route fires) — RLS
-- here exists for any direct client access, not for that send path.
alter table push_subscriptions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'push_subscriptions' and policyname = 'push_subscriptions owner all') then
    create policy "push_subscriptions owner all" on push_subscriptions for all using (
      user_id = auth.uid() or is_admin()
    ) with check (
      user_id = auth.uid() or is_admin()
    );
  end if;
end $$;
