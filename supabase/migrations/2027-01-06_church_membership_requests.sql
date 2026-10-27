-- Churches & Ministries expansion, Phase 4: membership requests from the church page and their approval — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- A visitor who has CONNECTED to a church may ask to become a member (Adult or Youth only; a child is never self-registered, staff add a child under a guardian). The request becomes a roster row
-- with status 'pending' and source 'join_request' (both already allowed by Phase 2A). Church staff with church.members.manage approve (-> 'active') or decline (-> 'removed') it.
--
--   NEW  church_members.decided_at, church_members.decided_by      who settled a pending row, and when (set by a trigger, never by the client)
--   NEW  function church_member_decision_guard() + trigger          stamps the decision; a join request's origin (source, account link, church) can never be changed by anyone who is signed in
--   NEW  policy church_members_update_requests                     an ADDITIONAL permissive update policy for rows with source = 'join_request' (the Phase 2A update policy only covers manual and invite rows,
--                                                                  so without this staff could not approve a request). The restrictive policies of Phase 2A (children only with children rights, no platform
--                                                                  admin) still apply on top of it.
--   NEW  function church_request_membership(customer, church, age group)   the ONLY way a request is created. Callable by the service role alone (the app calls it after it has verified the visitor's
--                                                                  cookie). It checks: adult or youth; the church is a published, non-demo Churches & Ministries page; the visitor exists and is
--                                                                  connected to it; no live row exists yet (asking again is harmless); a declined person waits 30 days; at most 300 open requests per church
--                                                                  and 10 per visitor. The name, phone, e-mail and language come from the visitor's own account, never from the request.
--
-- Nothing existing is changed: no existing column, constraint, policy, trigger or function is altered or replaced, and no row is read or written by this file.
-- PRIVACY: the roster is religious-affiliation data. Nothing in this file reaches analytics, logs, push or Ringo AI; the new function returns a status word and an id, never a name or contact detail.
--
-- SELF-VERIFYING, one transaction: preconditions first, postconditions last. Any RAISE rolls everything back. Re-runnable.
--
-- Depends on: 2026-12-27_church_people_groups.sql and the customer tables (ringo_customers, customer_connections).
-- Preflight (read-only, run BEFORE): supabase/support/2027-01-06_church_membership_requests.preflight.sql
-- Verify    (read-only, run AFTER):  supabase/support/2027-01-06_church_membership_requests.verify.sql
-- Rollback: supabase/support/2027-01-06_church_membership_requests.rollback.sql (keeps every member row; only the approval stamps are lost).

begin;

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS
-- ----------------------------------------------------------------------------
do $$
declare
  v_t text;
begin
  foreach v_t in array array['church_members', 'ringo_customers', 'customer_connections', 'profiles'] loop
    if to_regclass('public.' || v_t) is null then raise exception 'precondition failed: public.% does not exist', v_t; end if;
  end loop;
  foreach v_t in array array['church_has_permission(uuid,text)', 'is_church_profile(uuid)', 'church_is_owner(uuid)', 'is_admin()'] loop
    if to_regprocedure('public.' || v_t) is null then raise exception 'precondition failed: function public.% is missing', v_t; end if;
  end loop;
  select string_agg(c, ', ') into v_t from unnest(array['name', 'email', 'phone', 'preferred_language']) c
   where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ringo_customers' and column_name = c);
  if v_t is not null then raise exception 'precondition failed: ringo_customers is missing columns: %', v_t; end if;
  select string_agg(c, ', ') into v_t from unnest(array['customer_id', 'profile_id', 'status']) c
   where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_connections' and column_name = c);
  if v_t is not null then raise exception 'precondition failed: customer_connections is missing columns: %', v_t; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') or not exists (select 1 from pg_roles where rolname = 'authenticated') or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'precondition failed: the database roles anon, authenticated and service_role must exist';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_member_decision_guard', 'church_request_membership')
               and coalesce(obj_description(oid, 'pg_proc'), '') <> 'managed by 2027-01-06_church_membership_requests.sql') then
    raise exception 'precondition failed: a function named like one of this file''s exists and is not managed by it';
  end if;
  perform set_config('church_requests.pre', jsonb_build_object('members', (select count(*) from public.church_members))::text, true);
end $$;

-- ----------------------------------------------------------------------------
-- 1. COLUMNS
-- ----------------------------------------------------------------------------
alter table public.church_members add column if not exists decided_at timestamptz;
alter table public.church_members add column if not exists decided_by uuid references public.users(id) on delete set null;
comment on column public.church_members.decided_at is 'managed by 2027-01-06_church_membership_requests.sql';
comment on column public.church_members.decided_by is 'managed by 2027-01-06_church_membership_requests.sql';

-- ----------------------------------------------------------------------------
-- 2. FUNCTIONS AND TRIGGER
-- ----------------------------------------------------------------------------
-- A pending row settles exactly once: decided_at / decided_by are stamped by the database when it leaves 'pending' for 'active' or 'removed'. A join request keeps its origin: nobody who is signed in can
-- change its source or its account link (the service role is the only writer of those).
create or replace function public.church_member_decision_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.source = 'join_request' and auth.uid() is not null then
    if new.source is distinct from old.source or new.customer_id is distinct from old.customer_id or new.user_id is distinct from old.user_id then
      raise exception 'church_request_link_immutable' using errcode = '42501', detail = 'the origin of a membership request cannot be changed';
    end if;
  end if;
  if old.status = 'pending' and new.status in ('active', 'removed') then
    new.decided_at := now();
    new.decided_by := auth.uid();
  elsif new.status = old.status or new.status = 'pending' then
    new.decided_at := old.decided_at;
    new.decided_by := old.decided_by;
  end if;
  return new;
end;
$$;

create or replace function public.church_request_membership(p_customer_id uuid, p_profile_id uuid, p_age_group text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_cust record;
  v_live record;
  v_new uuid;
begin
  if p_age_group is null or p_age_group not in ('adult', 'youth') then
    raise exception 'church_request_age_group' using errcode = '22023', detail = 'only an adult or a youth can ask to join; a child is added by church staff under a guardian';
  end if;
  if p_customer_id is null or p_profile_id is null then
    raise exception 'church_request_unavailable' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_profile_id and p.published = true and coalesce(p.is_demo, false) = false) or not public.is_church_profile(p_profile_id) then
    raise exception 'church_request_unavailable' using errcode = '22023', detail = 'the page does not accept membership requests';
  end if;
  select c.id, c.name, c.email, c.phone, c.preferred_language into v_cust from public.ringo_customers c where c.id = p_customer_id;
  if not found then
    raise exception 'church_request_unavailable' using errcode = '22023';
  end if;
  if not exists (select 1 from public.customer_connections cc where cc.customer_id = p_customer_id and cc.profile_id = p_profile_id and cc.status = 'active') then
    raise exception 'church_request_not_connected' using errcode = '22023', detail = 'connect to the church first';
  end if;

  select m.id, m.status into v_live from public.church_members m where m.profile_id = p_profile_id and m.customer_id = p_customer_id and m.status <> 'removed' limit 1;
  if found then
    return jsonb_build_object('status', v_live.status, 'created', false);
  end if;
  if exists (select 1 from public.church_members m where m.profile_id = p_profile_id and m.customer_id = p_customer_id and m.source = 'join_request' and m.status = 'removed' and m.removed_at > now() - interval '30 days') then
    raise exception 'church_request_cooldown' using errcode = '23514', detail = 'a declined request can be made again after 30 days';
  end if;
  if (select count(*) from public.church_members m where m.profile_id = p_profile_id and m.source = 'join_request' and m.status = 'pending') >= 300 then
    raise exception 'church_request_limit' using errcode = '23514', detail = 'too many open requests for this church';
  end if;
  if (select count(*) from public.church_members m where m.customer_id = p_customer_id and m.status = 'pending') >= 10 then
    raise exception 'church_request_limit' using errcode = '23514', detail = 'too many open requests for this person';
  end if;

  insert into public.church_members (profile_id, customer_id, full_name, phone, email, preferred_language, status, source, age_group)
  values (p_profile_id, p_customer_id, btrim(v_cust.name), nullif(btrim(coalesce(v_cust.phone, '')), ''), v_cust.email, v_cust.preferred_language, 'pending', 'join_request', p_age_group)
  returning id into v_new;
  return jsonb_build_object('status', 'pending', 'created', true);
end;
$$;

comment on function public.church_member_decision_guard() is 'managed by 2027-01-06_church_membership_requests.sql';
comment on function public.church_request_membership(uuid, uuid, text) is 'managed by 2027-01-06_church_membership_requests.sql';
revoke all on function public.church_member_decision_guard() from public, anon, authenticated;
revoke all on function public.church_request_membership(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.church_request_membership(uuid, uuid, text) to service_role;

drop trigger if exists church_members_decision_guard_trg on public.church_members;
create trigger church_members_decision_guard_trg before update on public.church_members for each row execute function public.church_member_decision_guard();
comment on trigger church_members_decision_guard_trg on public.church_members is 'managed by 2027-01-06_church_membership_requests.sql';

-- ----------------------------------------------------------------------------
-- 3. POLICY (additional, permissive): staff settle a join request
-- ----------------------------------------------------------------------------
drop policy if exists church_members_update_requests on public.church_members;
create policy church_members_update_requests on public.church_members for update to authenticated
  using (source = 'join_request' and public.church_has_permission(profile_id, 'church.members.manage'))
  with check (source = 'join_request' and public.church_has_permission(profile_id, 'church.members.manage'));

-- ----------------------------------------------------------------------------
-- 4. POSTCONDITIONS (any failure rolls the whole file back)
-- ----------------------------------------------------------------------------
do $$
declare
  v_pre jsonb := current_setting('church_requests.pre')::jsonb;
begin
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'church_members' and column_name in ('decided_at', 'decided_by')) <> 2 then raise exception 'postcondition failed: decision columns'; end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgname = 'church_members_decision_guard_trg') <> 1 then raise exception 'postcondition failed: decision trigger'; end if;
  if (select count(*) from pg_policy where polname = 'church_members_update_requests' and polrelid = 'public.church_members'::regclass and polpermissive) <> 1 then raise exception 'postcondition failed: request policy'; end if;
  if has_function_privilege('anon', 'public.church_request_membership(uuid, uuid, text)', 'execute') or has_function_privilege('authenticated', 'public.church_request_membership(uuid, uuid, text)', 'execute') or has_function_privilege('public', 'public.church_request_membership(uuid, uuid, text)', 'execute') then
    raise exception 'postcondition failed: the request function is callable by an API role';
  end if;
  if not has_function_privilege('service_role', 'public.church_request_membership(uuid, uuid, text)', 'execute') then raise exception 'postcondition failed: the service role cannot call the request function'; end if;
  if has_function_privilege('anon', 'public.church_member_decision_guard()', 'execute') or has_function_privilege('authenticated', 'public.church_member_decision_guard()', 'execute') or has_function_privilege('public', 'public.church_member_decision_guard()', 'execute') then
    raise exception 'postcondition failed: the decision guard is callable by an API role';
  end if;
  if has_table_privilege('anon', 'public.church_members', 'select') then raise exception 'postcondition failed: anon can read the roster'; end if;
  if (select count(*) from public.church_members) <> (v_pre->>'members')::bigint then raise exception 'postcondition failed: a row count changed'; end if;
end $$;

commit;
