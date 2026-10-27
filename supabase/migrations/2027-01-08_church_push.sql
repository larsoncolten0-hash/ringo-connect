-- Churches & Ministries expansion, Phase 5B: push notifications from a church to the people connected with it — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- A visitor who is CONNECTED to a church may opt in, per topic, to notifications from it (new announcement, event, testimony, daily word, Bible-in-one-year reading, care need, new product, a group
-- notice). Opting in is the visitor's own choice and can be changed or withdrawn at any time; nothing is sent to anyone who did not opt in to that topic. The device itself is registered by the existing
-- customer push subscription (customer_push_subscriptions, Web Push), which this file does not touch.
--
--   NEW  church_push_prefs         one row per visitor and church: the topics the visitor chose. Empty = nothing. Needs an active connection (a trigger refuses otherwise).
--   NEW  church_push_outbox        one row per notification to send: church, kind, a reference (the id of the announcement / event / ... or the date for the daily Bible reading), when it may be sent, and a SMALL
--                                  payload of public text (a title and a body in English and French, and a page address). UNIQUE (church, kind, reference): the same item can never be queued twice.
--   NEW  church_push_deliveries    one row per recipient and notification: it makes a retry or an overlapping run harmless (nobody is notified twice) and keeps the daily cap.
--   NEW  functions (service role ONLY):
--          church_push_enqueue(...)    queue one notification (a no-op when it is already queued)
--          church_push_claim(limit)    atomically take the notifications that are due (and release ones whose sender stalled for 10 minutes)
--          church_push_recipients(outbox, limit)   who to notify for a claimed notification: opted in to THAT topic, still connected, not yet notified, and under the daily cap of 5 church messages
--          church_push_record(outbox, customer, delivered)   note one delivery
--          church_push_finish(outbox, status)       close a notification
--
-- WHAT A MESSAGE MAY CONTAIN: public text only. The payload is limited to a few hundred characters and the sender builds the message from it; it never holds a name, a phone number, a roster or a
-- testimony's words. A testimony notice says only that a new testimony was shared. A group notice goes only to people who are active members of the group's roster group; the roster is read INSIDE
-- church_push_recipients and nothing about it is returned except the visitor id and language.
--
-- PRIVACY: all five tables/functions are closed to every API role. Only the service role (the cron job and the visitor's own routes, after they verified the visitor's cookie) can use them. Church staff
-- cannot see who opted in. Nothing here reaches analytics, logs or Ringo AI.
--
-- Nothing existing is changed. SELF-VERIFYING, one transaction: preconditions first, postconditions last. Any RAISE rolls everything back. Re-runnable.
--
-- Depends on: 2026-12-27_church_people_groups.sql, 2027-01-05_church_groups_pastors.sql, 2027-01-07_church_bible_year.sql, the customer tables (ringo_customers, customer_connections).
-- Preflight (read-only, run BEFORE): supabase/support/2027-01-08_church_push.preflight.sql
-- Verify    (read-only, run AFTER):  supabase/support/2027-01-08_church_push.verify.sql
-- Rollback: supabase/support/2027-01-08_church_push.rollback.sql (refuses to run while any row exists unless the loss is explicitly confirmed).

begin;

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS
-- ----------------------------------------------------------------------------
do $$
declare
  v_t text;
begin
  foreach v_t in array array['profiles', 'ringo_customers', 'customer_connections', 'church_members', 'church_group_members', 'church_public_groups', 'bible_year_enrollments'] loop
    if to_regclass('public.' || v_t) is null then raise exception 'precondition failed: public.% does not exist (apply the earlier church migrations first)', v_t; end if;
  end loop;
  foreach v_t in array array['is_church_profile(uuid)', 'ministry_today()'] loop
    if to_regprocedure('public.' || v_t) is null then raise exception 'precondition failed: function public.% is missing', v_t; end if;
  end loop;
  if not exists (select 1 from pg_roles where rolname = 'anon') or not exists (select 1 from pg_roles where rolname = 'authenticated') or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'precondition failed: the database roles anon, authenticated and service_role must exist';
  end if;
  if (select count(*) from unnest(array['church_push_prefs', 'church_push_outbox', 'church_push_deliveries']) t where to_regclass('public.' || t) is not null) not in (0, 3) then
    raise exception 'precondition failed: only some of this file''s tables exist (half-applied or foreign change)';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_push_prefs_guard', 'church_push_enqueue', 'church_push_claim', 'church_push_recipients', 'church_push_record', 'church_push_finish')
               and coalesce(obj_description(oid, 'pg_proc'), '') <> 'managed by 2027-01-08_church_push.sql') then
    raise exception 'precondition failed: a function named like one of this file''s exists and is not managed by it';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------------------
create table if not exists public.church_push_prefs (
  customer_id uuid not null references public.ringo_customers(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  topics text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (customer_id, profile_id),
  constraint church_push_prefs_topics_check check (topics <@ array['announcements', 'events', 'testimonies', 'daily_word', 'bible_day', 'care', 'store', 'groups']::text[] and cardinality(topics) <= 8)
);
create index if not exists church_push_prefs_profile_idx on public.church_push_prefs (profile_id) where cardinality(topics) > 0;

create table if not exists public.church_push_outbox (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  ref text not null,
  run_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  claimed_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint church_push_outbox_once_key unique (profile_id, kind, ref),
  constraint church_push_outbox_kind_check check (kind in ('announcement', 'group_announcement', 'event', 'testimony', 'daily_word', 'bible_day', 'care', 'product')),
  constraint church_push_outbox_ref_check check (char_length(ref) between 1 and 100),
  constraint church_push_outbox_status_check check (status in ('pending', 'sending', 'sent', 'skipped')),
  constraint church_push_outbox_payload_check check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 2000)
);
create index if not exists church_push_outbox_due_idx on public.church_push_outbox (run_at) where status in ('pending', 'sending');

create table if not exists public.church_push_deliveries (
  outbox_id uuid not null references public.church_push_outbox(id) on delete cascade,
  customer_id uuid not null references public.ringo_customers(id) on delete cascade,
  delivered boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (outbox_id, customer_id)
);
create index if not exists church_push_deliveries_customer_idx on public.church_push_deliveries (customer_id, created_at desc);

comment on table public.church_push_prefs is 'managed by 2027-01-08_church_push.sql';
comment on table public.church_push_outbox is 'managed by 2027-01-08_church_push.sql';
comment on table public.church_push_deliveries is 'managed by 2027-01-08_church_push.sql';

-- ----------------------------------------------------------------------------
-- 2. FUNCTIONS
-- ----------------------------------------------------------------------------
-- A visitor can hold topics only for a church page they are connected to; the topics are kept sorted and without duplicates.
create or replace function public.church_push_prefs_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if not public.is_church_profile(new.profile_id) then
    raise exception 'church_profile_required' using errcode = '23514', detail = 'notifications are only for a Churches & Ministries page';
  end if;
  if tg_op = 'UPDATE' and (new.customer_id is distinct from old.customer_id or new.profile_id is distinct from old.profile_id) then
    raise exception 'church_push_prefs_immutable' using errcode = '23514';
  end if;
  new.topics := coalesce((select array_agg(distinct t order by t) from unnest(new.topics) t), '{}');
  if cardinality(new.topics) > 0 and not exists (select 1 from public.customer_connections cc where cc.customer_id = new.customer_id and cc.profile_id = new.profile_id and cc.status = 'active') then
    raise exception 'church_push_not_connected' using errcode = '23514', detail = 'connect with the church first';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.church_push_enqueue(p_profile_id uuid, p_kind text, p_ref text, p_run_at timestamptz, p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.is_church_profile(p_profile_id) or not exists (select 1 from public.profiles p where p.id = p_profile_id and p.published = true and coalesce(p.is_demo, false) = false) then
    return false;
  end if;
  insert into public.church_push_outbox (profile_id, kind, ref, run_at, payload)
  values (p_profile_id, p_kind, p_ref, p_run_at, coalesce(p_payload, '{}'::jsonb))
  on conflict (profile_id, kind, ref) do nothing
  returning id into v_id;
  return v_id is not null;
end;
$$;

create or replace function public.church_push_claim(p_limit integer default 20)
returns setof public.church_push_outbox
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  update public.church_push_outbox o
     set status = 'sending', claimed_at = now()
   where o.id in (
     select x.id from public.church_push_outbox x
      where (x.status = 'pending' and x.run_at <= now()) or (x.status = 'sending' and x.claimed_at < now() - interval '10 minutes')
      order by x.run_at, x.id
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
      for update skip locked)
  returning o.*
$$;

-- Who to notify for one claimed notification. Returns the visitor id, their language and (for the daily Bible reading) the start date of their plan: nothing else.
create or replace function public.church_push_recipients(p_outbox_id uuid, p_limit integer default 200)
returns table (customer_id uuid, lang text, start_date date)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  o public.church_push_outbox;
  v_topic text;
begin
  select * into o from public.church_push_outbox where id = p_outbox_id;
  if not found then return; end if;
  v_topic := case o.kind
    when 'announcement' then 'announcements' when 'group_announcement' then 'groups' when 'event' then 'events' when 'testimony' then 'testimonies'
    when 'daily_word' then 'daily_word' when 'bible_day' then 'bible_day' when 'care' then 'care' when 'product' then 'store' end;
  return query
    select c.id, case when c.preferred_language = 'fr' then 'fr' else 'en' end, e.start_date
      from public.church_push_prefs pr
      join public.ringo_customers c on c.id = pr.customer_id
      join public.customer_connections cc on cc.customer_id = pr.customer_id and cc.profile_id = o.profile_id and cc.status = 'active'
      left join public.bible_year_enrollments e on o.kind = 'bible_day' and e.customer_id = pr.customer_id and e.profile_id = o.profile_id and e.ended_at is null
     where pr.profile_id = o.profile_id
       and v_topic = any (pr.topics)
       and (o.kind <> 'bible_day' or e.id is not null)
       and (o.kind <> 'group_announcement' or exists (
             select 1 from public.church_public_groups g
               join public.church_group_members gm on gm.group_id = g.roster_group_id and gm.profile_id = g.profile_id
               join public.church_members m on m.id = gm.member_id and m.profile_id = gm.profile_id
              where g.id = nullif(o.payload ->> 'group_id', '')::uuid and g.profile_id = o.profile_id and g.is_published = true
                and m.customer_id = pr.customer_id and m.status = 'active'))
       and not exists (select 1 from public.church_push_deliveries d where d.outbox_id = o.id and d.customer_id = pr.customer_id)
       and (select count(*) from public.church_push_deliveries d2 where d2.customer_id = pr.customer_id and d2.delivered and d2.created_at > now() - interval '24 hours') < 5
     order by c.id
     limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;

create or replace function public.church_push_record(p_outbox_id uuid, p_customer_id uuid, p_delivered boolean)
returns void
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  insert into public.church_push_deliveries (outbox_id, customer_id, delivered) values (p_outbox_id, p_customer_id, coalesce(p_delivered, false)) on conflict (outbox_id, customer_id) do nothing
$$;

create or replace function public.church_push_finish(p_outbox_id uuid, p_status text)
returns void
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  update public.church_push_outbox set status = case when p_status = 'skipped' then 'skipped' else 'sent' end, processed_at = now() where id = p_outbox_id
$$;

comment on function public.church_push_prefs_guard() is 'managed by 2027-01-08_church_push.sql';
comment on function public.church_push_enqueue(uuid, text, text, timestamptz, jsonb) is 'managed by 2027-01-08_church_push.sql';
comment on function public.church_push_claim(integer) is 'managed by 2027-01-08_church_push.sql';
comment on function public.church_push_recipients(uuid, integer) is 'managed by 2027-01-08_church_push.sql';
comment on function public.church_push_record(uuid, uuid, boolean) is 'managed by 2027-01-08_church_push.sql';
comment on function public.church_push_finish(uuid, text) is 'managed by 2027-01-08_church_push.sql';

revoke all on function public.church_push_prefs_guard() from public, anon, authenticated;
revoke all on function public.church_push_enqueue(uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.church_push_claim(integer) from public, anon, authenticated;
revoke all on function public.church_push_recipients(uuid, integer) from public, anon, authenticated;
revoke all on function public.church_push_record(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.church_push_finish(uuid, text) from public, anon, authenticated;
grant execute on function public.church_push_enqueue(uuid, text, text, timestamptz, jsonb) to service_role;
grant execute on function public.church_push_claim(integer) to service_role;
grant execute on function public.church_push_recipients(uuid, integer) to service_role;
grant execute on function public.church_push_record(uuid, uuid, boolean) to service_role;
grant execute on function public.church_push_finish(uuid, text) to service_role;

drop trigger if exists church_push_prefs_guard_trg on public.church_push_prefs;
create trigger church_push_prefs_guard_trg before insert or update on public.church_push_prefs for each row execute function public.church_push_prefs_guard();
comment on trigger church_push_prefs_guard_trg on public.church_push_prefs is 'managed by 2027-01-08_church_push.sql';

-- ----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY AND PRIVILEGES: the service role alone
-- ----------------------------------------------------------------------------
alter table public.church_push_prefs enable row level security;
alter table public.church_push_outbox enable row level security;
alter table public.church_push_deliveries enable row level security;
revoke all on public.church_push_prefs, public.church_push_outbox, public.church_push_deliveries from public, anon, authenticated;
grant all on public.church_push_prefs, public.church_push_outbox, public.church_push_deliveries to service_role;

-- ----------------------------------------------------------------------------
-- 4. POSTCONDITIONS (any failure rolls the whole file back)
-- ----------------------------------------------------------------------------
do $$
declare
  v_t text;
  v_f text;
begin
  foreach v_t in array array['church_push_prefs', 'church_push_outbox', 'church_push_deliveries'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || v_t)::regclass) then raise exception 'postcondition failed: RLS is off on %', v_t; end if;
    if exists (select 1 from pg_policy where polrelid = ('public.' || v_t)::regclass) then raise exception 'postcondition failed: % has a policy', v_t; end if;
    if has_table_privilege('anon', 'public.' || v_t, 'select') or has_table_privilege('authenticated', 'public.' || v_t, 'select') or has_table_privilege('authenticated', 'public.' || v_t, 'insert')
       or has_table_privilege('public', 'public.' || v_t, 'select') then
      raise exception 'postcondition failed: an API role can reach %', v_t;
    end if;
  end loop;
  foreach v_f in array array['church_push_prefs_guard()', 'church_push_enqueue(uuid, text, text, timestamptz, jsonb)', 'church_push_claim(integer)', 'church_push_recipients(uuid, integer)', 'church_push_record(uuid, uuid, boolean)', 'church_push_finish(uuid, text)'] loop
    if has_function_privilege('anon', 'public.' || v_f, 'execute') or has_function_privilege('authenticated', 'public.' || v_f, 'execute') or has_function_privilege('public', 'public.' || v_f, 'execute') then
      raise exception 'postcondition failed: % is callable by an API role', v_f;
    end if;
  end loop;
  foreach v_f in array array['church_push_enqueue(uuid, text, text, timestamptz, jsonb)', 'church_push_claim(integer)', 'church_push_recipients(uuid, integer)', 'church_push_record(uuid, uuid, boolean)', 'church_push_finish(uuid, text)'] loop
    if not has_function_privilege('service_role', 'public.' || v_f, 'execute') then raise exception 'postcondition failed: the service role cannot call %', v_f; end if;
  end loop;
  if (select count(*) from pg_trigger where not tgisinternal and tgname = 'church_push_prefs_guard_trg') <> 1 then raise exception 'postcondition failed: trigger'; end if;
end $$;

commit;
