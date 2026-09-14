-- Home-screen notification badge (additive) — a per-subscription (i.e.
-- per installed device) counter, NOT a new read/unread inbox. Incremented
-- server-side every time a push is actually delivered to that
-- subscription (see src/lib/push/send.ts's deliverAndLog), reset to 0
-- client-side the moment that installed app is opened (see
-- /api/push/reset-badge + AppBadgeReset.tsx). The service worker's own
-- push handler reads the current value back off each payload
-- (payload.badgeCount) and calls the Badging API with it — no separate
-- query needed at delivery time.
alter table push_subscriptions add column if not exists badge_count int not null default 0;

-- Atomic increment-and-return for however many subscription rows a given
-- send targets (one push -> one or many subscriptions, e.g. every admin's
-- devices at once) — a plain client-side `.update({ badge_count: x + 1 })`
-- can't express a real increment, and a read-then-write from the app
-- would race with a concurrent send to the same device.
create or replace function increment_push_badge_count(sub_ids uuid[])
returns table(id uuid, badge_count int)
language sql
as $$
  update push_subscriptions
  set badge_count = badge_count + 1
  where id = any(sub_ids)
  returning id, badge_count;
$$;
