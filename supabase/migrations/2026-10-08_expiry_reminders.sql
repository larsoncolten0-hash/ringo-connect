-- Subscription expiry reminders + grace period (additive).
--
-- Scope: Fapshi/manual fixed-duration accounts ONLY — anyone with a real
-- plan_expires_at (payment_provider = 'fapshi' or 'manual'; Stripe never
-- sets plan_expires_at at all, since it renews itself via webhook, so it's
-- naturally excluded from every query here without a separate filter).
--
-- grace_period_days: once plan_expires_at passes, the account keeps full
-- access for this many extra days before /api/cron/downgrade-expired
-- actually downgrades it to Free — gives someone who's traveling or whose
-- Mobile Money renewal is delayed a buffer, rather than an instant cutoff.
--
-- expiring_soon_reminder_days / grace_ending_reminder_days: how many days
-- BEFORE the relevant deadline (plan_expires_at, and
-- plan_expires_at + grace_period_days respectively) each reminder fires.
-- Both admin-editable per the same "use your judgment or make it
-- configurable" allowance the grace period itself was given.
alter table platform_settings add column if not exists grace_period_days int not null default 5;
alter table platform_settings add column if not exists expiring_soon_reminder_days int not null default 3;
alter table platform_settings add column if not exists grace_ending_reminder_days int not null default 2;

-- One row per (user, stage, plan_expires_at) actually sent — the unique
-- constraint is what makes "exactly once per billing cycle" hold without
-- three easy-to-forget reset columns on `users`: a renewal changes
-- plan_expires_at to a new value, which makes every stage for the new
-- cycle unsent again automatically, and a stage that already fired for
-- the CURRENT plan_expires_at can never fire again for it. Written only
-- by the downgrade-expired cron job, via the service-role client — never
-- exposed to any client-side write path.
create table if not exists subscription_reminder_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  stage text not null check (stage in ('expiring_soon', 'grace_started', 'grace_ending_soon')),
  plan_expires_at timestamptz not null,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, stage, plan_expires_at)
);
create index if not exists subscription_reminder_log_user_id_idx on subscription_reminder_log (user_id);

alter table subscription_reminder_log enable row level security;

do $$
begin
  -- Admin-only read (debugging "did this user get their reminder"
  -- questions) — there's no self-service UI for a creator to browse their
  -- own reminder history, so no owner-read policy is added here, unlike
  -- community_delivery_logs' owner-read precedent.
  if not exists (select 1 from pg_policies where tablename = 'subscription_reminder_log' and policyname = 'subscription_reminder_log admin read') then
    create policy "subscription_reminder_log admin read" on subscription_reminder_log for select using (is_admin());
  end if;
end $$;
