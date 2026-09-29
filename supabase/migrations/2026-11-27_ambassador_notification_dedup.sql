-- Ringo Ambassador Program — durable notification de-duplication. NOT YET RUN.
--
-- WHY: the Ambassador/Team Leader notifications were de-duplicated with a
-- check-then-insert against the recipient's bell rows, which two truly
-- simultaneous callers can both pass. This adds a database-enforced claim:
-- a notification event may be CLAIMED exactly once (primary key), and the
-- application sends (through the existing sendPushAndBellToUser) only if it won
-- the claim — claim first, send second.
--
-- Smallest safe additive design: ONE new table and ONE new function. The
-- existing `notifications` table, withBell.ts and every other notification
-- category are untouched.
--
-- WHAT THIS DOES AND DOES NOT GUARANTEE
--   * At most ONE claim per dedupe_key, ever — enforced by the primary key, so
--     concurrent callers cannot both win.
--   * The in-app bell row and the push are then attempted once by that winner.
--   * It is NOT an exactly-once delivery guarantee: sendPushAndBellToUser
--     swallows delivery errors, and a push service may retry or drop. A claimed
--     event whose send fails is not re-sent (deliberate: at-most-once is safer
--     than a duplicate for a money-related message).
--
-- Rows are tiny and append-only; a retention clean-up (delete rows older than
-- some months) can be added later without affecting correctness.
--
-- Depends on: public.users (existing). Independent of the other Ambassador
-- migrations, but shipped with them.

create table if not exists public.ambassador_notification_events (
  dedupe_key text primary key check (char_length(dedupe_key) between 1 and 300),
  user_id uuid not null references public.users(id) on delete cascade,
  category text not null,
  claimed_at timestamptz not null default now()
);
create index if not exists ambassador_notification_events_claimed_idx on public.ambassador_notification_events (claimed_at);

-- Service-role only: RLS on with NO policy, and privileges revoked.
alter table public.ambassador_notification_events enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.ambassador_notification_events from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.ambassador_notification_events from authenticated';
  end if;
end $$;

-- Atomically claims an event. `claimed` is true for exactly one caller per key.
create or replace function public.ambassador_claim_notification(p_user_id uuid, p_category text, p_dedupe_key text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_claimed text;
begin
  if p_user_id is null or p_category is null or p_dedupe_key is null or btrim(p_dedupe_key) = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;
  insert into public.ambassador_notification_events (dedupe_key, user_id, category)
  values (p_dedupe_key, p_user_id, p_category)
  on conflict (dedupe_key) do nothing
  returning dedupe_key into v_claimed;
  return jsonb_build_object('ok', true, 'claimed', v_claimed is not null);
end;
$$;

revoke all on function public.ambassador_claim_notification(uuid, text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ambassador_claim_notification(uuid, text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.ambassador_claim_notification(uuid, text, text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ambassador_claim_notification(uuid, text, text) to service_role';
  end if;
end $$;
