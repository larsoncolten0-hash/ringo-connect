-- Churches & Ministries expansion, Phase 6: counselling requests — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- A visitor asks to meet a pastor or counsellor from the church page: a name, a phone number, an optional e-mail and the reason. Authorised church staff see the request, then APPROVE it (they will get in
-- touch) or DECLINE it. The reason a person gives is among the most private things a church holds, so everything here is closed by default.
--
--   NEW  church_counselling_requests   the request. The visitor needs no account; the page's server route (service role) is the ONLY way a request is created. No API role can insert.
--   NEW  church_counselling_history    one note per change of decision (who, when, from, to): never the reason, never contact details.
--   NEW  functions church_counselling_guard(), church_counselling_audit(), church_counselling_history_guard() and their triggers.
--
-- WHO: church.counselling.view reads the requests (with the reason and the contact details); church.counselling.manage approves, declines, notes and deletes. Both are OWNER-ONLY to grant (any church.*
-- string the earlier guards do not list is sensitive). A platform admin who does not own the church sees nothing. Another church's staff see nothing. A group leader is not staff and sees nothing.
--
-- WHAT STAYS PRIVATE: the reason, the name, the phone and the e-mail are readable only by those staff. They never reach analytics, reports, push, e-mail, logs or Ringo AI (nothing in this file writes or
-- reads them anywhere else). The history holds no personal text. The public (anon) role has no right of any kind on these tables.
--
-- WHAT A REQUEST CAN CHANGE: staff can change only the decision and their own private note. The person's words, contact details and the church can never be edited by anyone who is signed in.
--
-- Nothing existing is changed. SELF-VERIFYING, one transaction: preconditions first, postconditions last. Any RAISE rolls everything back. Re-runnable.
--
-- Depends on: 2026-12-27_church_people_groups.sql (church_has_permission, is_church_profile, church_is_owner, is_admin).
-- Preflight (read-only, run BEFORE): supabase/support/2027-01-09_church_counselling.preflight.sql
-- Verify    (read-only, run AFTER):  supabase/support/2027-01-09_church_counselling.verify.sql
-- Rollback: supabase/support/2027-01-09_church_counselling.rollback.sql (refuses to run while any request exists unless the loss is explicitly confirmed).

begin;

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS
-- ----------------------------------------------------------------------------
do $$
declare
  v_t text;
begin
  if to_regclass('public.profiles') is null or to_regclass('public.users') is null then raise exception 'precondition failed: profiles or users is missing'; end if;
  foreach v_t in array array['church_has_permission(uuid,text)', 'church_is_owner(uuid)', 'is_church_profile(uuid)', 'is_admin()'] loop
    if to_regprocedure('public.' || v_t) is null then raise exception 'precondition failed: function public.% is missing (apply the earlier church migrations first)', v_t; end if;
  end loop;
  if not exists (select 1 from pg_roles where rolname = 'anon') or not exists (select 1 from pg_roles where rolname = 'authenticated') or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'precondition failed: the database roles anon, authenticated and service_role must exist';
  end if;
  if (select count(*) from unnest(array['church_counselling_requests', 'church_counselling_history']) t where to_regclass('public.' || t) is not null) not in (0, 2) then
    raise exception 'precondition failed: only some of this file''s tables exist (half-applied or foreign change)';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_counselling_guard', 'church_counselling_audit', 'church_counselling_history_guard')
               and coalesce(obj_description(oid, 'pg_proc'), '') <> 'managed by 2027-01-09_church_counselling.sql') then
    raise exception 'precondition failed: a function named like one of this file''s exists and is not managed by it';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------------------
create table if not exists public.church_counselling_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  submission_key uuid not null,
  full_name text not null,
  phone text not null,
  email text,
  reason text not null,
  lang text not null default 'en',
  status text not null default 'pending',
  decision_note text,
  decided_at timestamptz,
  decided_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint church_counselling_key_key unique (profile_id, submission_key),
  constraint church_counselling_name_check check (char_length(btrim(full_name)) between 2 and 120),
  constraint church_counselling_phone_check check (phone ~ '^[0-9]{8,15}$'),
  constraint church_counselling_email_check check (email is null or (email = lower(email) and char_length(email) between 3 and 200 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  constraint church_counselling_reason_check check (char_length(btrim(reason)) between 10 and 1000),
  constraint church_counselling_lang_check check (lang in ('en', 'fr')),
  constraint church_counselling_status_check check (status in ('pending', 'approved', 'declined')),
  constraint church_counselling_note_check check (decision_note is null or char_length(decision_note) between 1 and 500),
  constraint church_counselling_decided_check check ((status = 'pending') = (decided_at is null))
);
create index if not exists church_counselling_profile_idx on public.church_counselling_requests (profile_id, status, created_at desc);

create table if not exists public.church_counselling_history (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null references public.church_counselling_requests(id) on delete cascade,
  from_status text not null,
  to_status text not null,
  changed_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists church_counselling_history_request_idx on public.church_counselling_history (request_id, created_at);

comment on table public.church_counselling_requests is 'managed by 2027-01-09_church_counselling.sql';
comment on table public.church_counselling_history is 'managed by 2027-01-09_church_counselling.sql';

-- ----------------------------------------------------------------------------
-- 2. FUNCTIONS AND TRIGGERS
-- ----------------------------------------------------------------------------
-- A request is only for a church page. The person's words never change; the church never changes; the decision stamps follow the status and come from the database, never from the client.
create or replace function public.church_counselling_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_church_profile(new.profile_id) then
      raise exception 'church_profile_required' using errcode = '23514', detail = 'requests can only be made to a profile with the Churches & Ministries category';
    end if;
    new.status := 'pending';
    new.decided_at := null;
    new.decided_by := null;
    new.decision_note := null;
  else
    if new.profile_id is distinct from old.profile_id or new.submission_key is distinct from old.submission_key or new.full_name is distinct from old.full_name
       or new.phone is distinct from old.phone or new.email is distinct from old.email or new.reason is distinct from old.reason or new.lang is distinct from old.lang or new.created_at is distinct from old.created_at then
      raise exception 'counselling_original_immutable' using errcode = '42501', detail = 'the words and details of a request can never be changed';
    end if;
    if new.status is distinct from old.status then
      if new.status = 'pending' then
        new.decided_at := null;
        new.decided_by := null;
      else
        new.decided_at := now();
        new.decided_by := auth.uid();
      end if;
    else
      new.decided_at := old.decided_at;
      new.decided_by := old.decided_by;
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.church_counselling_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    insert into public.church_counselling_history (profile_id, request_id, from_status, to_status, changed_by) values (new.profile_id, new.id, old.status, new.status, auth.uid());
  end if;
  return null;
end;
$$;

create or replace function public.church_counselling_history_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'counselling_history_immutable' using errcode = '42501', detail = 'the history of a request cannot be changed';
end;
$$;

comment on function public.church_counselling_guard() is 'managed by 2027-01-09_church_counselling.sql';
comment on function public.church_counselling_audit() is 'managed by 2027-01-09_church_counselling.sql';
comment on function public.church_counselling_history_guard() is 'managed by 2027-01-09_church_counselling.sql';
revoke all on function public.church_counselling_guard() from public, anon, authenticated;
revoke all on function public.church_counselling_audit() from public, anon, authenticated;
revoke all on function public.church_counselling_history_guard() from public, anon, authenticated;

drop trigger if exists church_counselling_guard_trg on public.church_counselling_requests;
create trigger church_counselling_guard_trg before insert or update on public.church_counselling_requests for each row execute function public.church_counselling_guard();
drop trigger if exists church_counselling_audit_trg on public.church_counselling_requests;
create trigger church_counselling_audit_trg after update on public.church_counselling_requests for each row execute function public.church_counselling_audit();
drop trigger if exists church_counselling_history_guard_trg on public.church_counselling_history;
create trigger church_counselling_history_guard_trg before update on public.church_counselling_history for each row execute function public.church_counselling_history_guard();
comment on trigger church_counselling_guard_trg on public.church_counselling_requests is 'managed by 2027-01-09_church_counselling.sql';
comment on trigger church_counselling_audit_trg on public.church_counselling_requests is 'managed by 2027-01-09_church_counselling.sql';
comment on trigger church_counselling_history_guard_trg on public.church_counselling_history is 'managed by 2027-01-09_church_counselling.sql';

-- ----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY AND PRIVILEGES
-- ----------------------------------------------------------------------------
alter table public.church_counselling_requests enable row level security;
alter table public.church_counselling_history enable row level security;
revoke all on public.church_counselling_requests, public.church_counselling_history from public, anon, authenticated;

-- signed-in staff read the request and change ONLY the decision and their private note; nobody signed in creates one; delete is by policy
grant select (id, profile_id, full_name, phone, email, reason, lang, status, decision_note, decided_at, created_at, updated_at) on public.church_counselling_requests to authenticated;
grant update (status, decision_note) on public.church_counselling_requests to authenticated;
grant delete on public.church_counselling_requests to authenticated;
grant select (id, profile_id, request_id, from_status, to_status, created_at) on public.church_counselling_history to authenticated;
grant all on public.church_counselling_requests, public.church_counselling_history to service_role;

drop policy if exists church_counselling_staff_select on public.church_counselling_requests;
create policy church_counselling_staff_select on public.church_counselling_requests for select to authenticated
  using (public.church_has_permission(profile_id, 'church.counselling.view') or public.church_has_permission(profile_id, 'church.counselling.manage'));
drop policy if exists church_counselling_staff_update on public.church_counselling_requests;
create policy church_counselling_staff_update on public.church_counselling_requests for update to authenticated
  using (public.church_has_permission(profile_id, 'church.counselling.manage')) with check (public.church_has_permission(profile_id, 'church.counselling.manage'));
drop policy if exists church_counselling_staff_delete on public.church_counselling_requests;
create policy church_counselling_staff_delete on public.church_counselling_requests for delete to authenticated using (public.church_has_permission(profile_id, 'church.counselling.manage'));
drop policy if exists church_counselling_no_platform_admin on public.church_counselling_requests;
create policy church_counselling_no_platform_admin on public.church_counselling_requests as restrictive for all to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id)) with check (not public.is_admin() or public.church_is_owner(profile_id));

drop policy if exists church_counselling_history_staff_select on public.church_counselling_history;
create policy church_counselling_history_staff_select on public.church_counselling_history for select to authenticated
  using (public.church_has_permission(profile_id, 'church.counselling.view') or public.church_has_permission(profile_id, 'church.counselling.manage'));
drop policy if exists church_counselling_history_no_platform_admin on public.church_counselling_history;
create policy church_counselling_history_no_platform_admin on public.church_counselling_history as restrictive for all to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id)) with check (not public.is_admin() or public.church_is_owner(profile_id));

-- ----------------------------------------------------------------------------
-- 4. POSTCONDITIONS (any failure rolls the whole file back)
-- ----------------------------------------------------------------------------
do $$
declare
  v_t text;
  v_f text;
begin
  foreach v_t in array array['church_counselling_requests', 'church_counselling_history'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || v_t)::regclass) then raise exception 'postcondition failed: RLS is off on %', v_t; end if;
    if has_table_privilege('anon', 'public.' || v_t, 'select') or has_table_privilege('anon', 'public.' || v_t, 'insert') or has_table_privilege('anon', 'public.' || v_t, 'update') or has_table_privilege('anon', 'public.' || v_t, 'delete')
       or has_table_privilege('public', 'public.' || v_t, 'select') then
      raise exception 'postcondition failed: anon or PUBLIC has rights on %', v_t;
    end if;
    if has_table_privilege('authenticated', 'public.' || v_t, 'insert') then raise exception 'postcondition failed: a signed-in user can insert into %', v_t; end if;
  end loop;
  if has_column_privilege('authenticated', 'public.church_counselling_requests', 'reason', 'update') or has_column_privilege('authenticated', 'public.church_counselling_requests', 'full_name', 'update')
     or has_column_privilege('authenticated', 'public.church_counselling_requests', 'phone', 'update') or has_column_privilege('authenticated', 'public.church_counselling_requests', 'decided_by', 'update') then
    raise exception 'postcondition failed: staff can edit a request''s words or the decision stamps';
  end if;
  if has_column_privilege('authenticated', 'public.church_counselling_requests', 'decided_by', 'select') or has_column_privilege('authenticated', 'public.church_counselling_requests', 'submission_key', 'select') then
    raise exception 'postcondition failed: staff can read internal columns';
  end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgname in ('church_counselling_guard_trg', 'church_counselling_audit_trg', 'church_counselling_history_guard_trg')) <> 3 then raise exception 'postcondition failed: triggers'; end if;
  foreach v_f in array array['church_counselling_guard()', 'church_counselling_audit()', 'church_counselling_history_guard()'] loop
    if has_function_privilege('anon', 'public.' || v_f, 'execute') or has_function_privilege('authenticated', 'public.' || v_f, 'execute') or has_function_privilege('public', 'public.' || v_f, 'execute') then
      raise exception 'postcondition failed: % is callable by an API role', v_f;
    end if;
  end loop;
end $$;

commit;
