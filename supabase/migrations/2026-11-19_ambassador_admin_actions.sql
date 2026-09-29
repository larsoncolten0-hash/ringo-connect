-- Ringo Ambassador Program — audit log. NOT YET RUN.
--
-- Created early in the migration sequence (before sales/commission
-- tables) because the attribution RPC in the next migration needs
-- somewhere to log rejected self-referral/invalid-code attempts for
-- Management to review — logging is part of the attribution mechanism
-- itself, not an afterthought bolted on later.
--
-- Purely additive. Admin-only read; every write is server-side
-- (service-role), from the specific Ambassador routes/functions that
-- perform the corresponding action.

create table if not exists public.ambassador_admin_actions (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: some log entries are written by a SECURITY DEFINER function
  -- reacting to an unauthenticated public signup submission (e.g. an
  -- invalid ambassador code, or a self-referral attempt) — there is no
  -- admin "actor" for those, only a system event. A real admin action
  -- (override, reversal, deactivation) always sets this.
  actor_user_id uuid references public.users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  target_table text not null,
  target_id uuid,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists ambassador_admin_actions_target_idx on public.ambassador_admin_actions (target_table, target_id);
create index if not exists ambassador_admin_actions_created_idx on public.ambassador_admin_actions (created_at desc);

alter table public.ambassador_admin_actions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ambassador_admin_actions' and policyname = 'ambassador_admin_actions admin read') then
    create policy "ambassador_admin_actions admin read" on public.ambassador_admin_actions for select using (is_admin());
  end if;
end $$;

-- Small helper so every future Ambassador function logs the same shape
-- rather than each writing its own insert — service-role/SECURITY DEFINER
-- callers only (see the revoke block below).
create or replace function public.ambassador_log_action(
  p_actor_user_id uuid,
  p_action text,
  p_target_table text,
  p_target_id uuid,
  p_before jsonb,
  p_after jsonb,
  p_reason text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.ambassador_admin_actions (actor_user_id, action, target_table, target_id, before, after, reason)
  values (p_actor_user_id, p_action, p_target_table, p_target_id, p_before, p_after, p_reason);
$$;

revoke all on function public.ambassador_log_action(uuid, text, text, uuid, jsonb, jsonb, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ambassador_log_action(uuid, text, text, uuid, jsonb, jsonb, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.ambassador_log_action(uuid, text, text, uuid, jsonb, jsonb, text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ambassador_log_action(uuid, text, text, uuid, jsonb, jsonb, text) to service_role';
  end if;
end $$;
