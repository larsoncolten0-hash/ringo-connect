-- Community: push as a third notification channel, plus "connected customers are
-- community members".
-- Purely additive: two new defaulted/nullable columns and a data backfill. Nothing
-- existing is altered, renamed, dropped, or re-constrained.
--
-- 1. community_subscription_preferences.push_updates
--    The subscriber's own opt-in for push, alongside email_updates / whatsapp_updates.
--    Defaults TRUE so every existing subscriber keeps receiving push exactly as they
--    do today (push was previously gated only by the notify_* content filter).
alter table public.community_subscription_preferences
  add column if not exists push_updates boolean not null default true;

-- 2. community_announcements.channels
--    Which channels the creator picked for one announcement ('email', 'push').
--    NULL = legacy behaviour (decided by the existing `audience` column), so every
--    announcement written before this migration behaves as it always did.
alter table public.community_announcements
  add column if not exists channels text[];

-- 3. Backfill: an active My Ringo connection that never got a community row (Connect
--    only created one when the marketing box was ticked) gets one now, so the creator's
--    community list and community push reach them.
--    - never touches an existing community_subscribers row (matched on profile + email,
--      any status, so an unsubscribed person is NOT re-added)
--    - email_updates/whatsapp_updates stay false: no email consent is implied
--    - push_updates is true (the default); the customer must still have enabled push on a
--      device in My Ringo for anything to be delivered
with new_rows as (
  insert into public.community_subscribers (profile_id, name, email, phone, source)
  select cc.profile_id, rc.name, rc.email, rc.phone, 'ringo_profile'
  from public.customer_connections cc
  join public.ringo_customers rc on rc.id = cc.customer_id
  where cc.status = 'active'
    and cc.community_subscriber_id is null
    and rc.email is not null
    and not exists (
      select 1 from public.community_subscribers s
      where s.profile_id = cc.profile_id and lower(s.email) = lower(rc.email)
    )
  on conflict do nothing
  returning id, profile_id, lower(email) as email_key
),
new_prefs as (
  insert into public.community_subscription_preferences (subscriber_id, email_updates, whatsapp_updates)
  select id, false, false from new_rows
  on conflict (subscriber_id) do nothing
  returning subscriber_id
)
-- Link ONLY the rows created above (a pre-existing row is never linked or touched).
update public.customer_connections cc
set community_subscriber_id = n.id, updated_at = now()
from new_rows n
join public.ringo_customers rc on lower(rc.email) = n.email_key
where cc.customer_id = rc.id
  and cc.profile_id = n.profile_id
  and cc.status = 'active'
  and cc.community_subscriber_id is null;
