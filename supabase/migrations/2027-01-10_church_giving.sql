-- Churches & Ministries expansion, Phase 7: giving and care funds (the DEFINITIONS only) — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- THIS FILE COLLECTS NO MONEY AND HOLDS NO MONEY. It stores what a church wants to raise money FOR: a giving fund (tithes, offerings, a building project) or a care fund (help for people in need), with a
-- title, a short description and an optional goal. Collecting real money (through the Shop ledger and Fapshi) needs five business decisions that are still open (Ringo's percentage, who pays Fapshi's fee,
-- receipts, refunds, closing a care fund early). See docs/church-giving-decisions.md. Until they are made and a LATER migration replaces church_giving_collection_open(), the database itself refuses a
-- fund that is "open" for collection, so nothing here can start collecting by accident.
--
--   NEW  church_giving_funds       a fund: kind (giving | care), bilingual title and description, optional goal in XAF, a status (draft | open | closed), and whether it is published.
--   NEW  functions church_giving_collection_open() (returns false until the decisions are made), church_giving_guard() and its trigger.
--
-- WHO: church.giving.manage writes the funds (OWNER-ONLY to grant: any church.* string the earlier guards do not list is sensitive). A platform admin who does not own the church sees nothing.
-- The public reads a fund only when it is published AND the owner switched giving on (church_features.giving, which stays impossible to switch on while the application's GIVING_AVAILABLE is false).
--
-- WHAT IS NOT HERE ON PURPOSE: no amount received, no donor, no payment, no payout, no receipt, no refund, no link from a fund to one person's care case (a fund is never tied to a named person).
-- The existing Shop ledger (product_orders, customer_payments, commerce_sale_earnings, commerce_payouts) and platform_settings are NOT touched.
--
-- Nothing existing is changed. SELF-VERIFYING, one transaction: preconditions first, postconditions last. Any RAISE rolls everything back. Re-runnable.
--
-- Depends on: 2026-12-27_church_people_groups.sql (church_has_permission, is_church_profile, church_is_owner, is_admin) and 2027-01-07_church_bible_year.sql (church_features).
-- Preflight (read-only, run BEFORE): supabase/support/2027-01-10_church_giving.preflight.sql
-- Verify    (read-only, run AFTER):  supabase/support/2027-01-10_church_giving.verify.sql
-- Rollback: supabase/support/2027-01-10_church_giving.rollback.sql (refuses to run while any fund exists unless the loss is explicitly confirmed).

begin;

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS
-- ----------------------------------------------------------------------------
do $$
declare
  v_t text;
begin
  if to_regclass('public.profiles') is null or to_regclass('public.users') is null or to_regclass('public.church_features') is null then raise exception 'precondition failed: profiles, users or church_features is missing'; end if;
  foreach v_t in array array['church_has_permission(uuid,text)', 'church_is_owner(uuid)', 'is_church_profile(uuid)', 'is_admin()'] loop
    if to_regprocedure('public.' || v_t) is null then raise exception 'precondition failed: function public.% is missing (apply the earlier church migrations first)', v_t; end if;
  end loop;
  if not exists (select 1 from pg_roles where rolname = 'anon') or not exists (select 1 from pg_roles where rolname = 'authenticated') or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'precondition failed: the database roles anon, authenticated and service_role must exist';
  end if;
  if to_regclass('public.church_giving_funds') is not null and coalesce(obj_description(to_regclass('public.church_giving_funds'), 'pg_class'), '') <> 'managed by 2027-01-10_church_giving.sql' then
    raise exception 'precondition failed: church_giving_funds exists and is not managed by this migration';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_giving_collection_open', 'church_giving_guard')
               and coalesce(obj_description(oid, 'pg_proc'), '') <> 'managed by 2027-01-10_church_giving.sql') then
    raise exception 'precondition failed: a function named like one of this file''s exists and is not managed by it';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1. THE SWITCH THAT KEEPS COLLECTION OFF
-- ----------------------------------------------------------------------------
-- A later migration, written only after the five decisions are made, replaces this body. Until then no fund can be "open".
create or replace function public.church_giving_collection_open()
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$ select false $$;
comment on function public.church_giving_collection_open() is 'managed by 2027-01-10_church_giving.sql';
revoke all on function public.church_giving_collection_open() from public, anon, authenticated;
grant execute on function public.church_giving_collection_open() to service_role;

-- ----------------------------------------------------------------------------
-- 2. TABLE
-- ----------------------------------------------------------------------------
create table if not exists public.church_giving_funds (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title_en text not null,
  title_fr text not null,
  description_en text,
  description_fr text,
  goal_xaf integer,
  status text not null default 'draft',
  closed_at timestamptz,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint church_giving_kind_check check (kind in ('giving', 'care')),
  constraint church_giving_title_en_check check (char_length(btrim(title_en)) between 1 and 120),
  constraint church_giving_title_fr_check check (char_length(btrim(title_fr)) between 1 and 120),
  constraint church_giving_desc_en_check check (description_en is null or char_length(description_en) between 1 and 600),
  constraint church_giving_desc_fr_check check (description_fr is null or char_length(description_fr) between 1 and 600),
  constraint church_giving_goal_check check (goal_xaf is null or (goal_xaf >= 1000 and goal_xaf <= 1000000000)),
  constraint church_giving_status_check check (status in ('draft', 'open', 'closed')),
  constraint church_giving_closed_check check ((status = 'closed') = (closed_at is not null))
);
create index if not exists church_giving_funds_profile_idx on public.church_giving_funds (profile_id, kind, created_at);
comment on table public.church_giving_funds is 'managed by 2027-01-10_church_giving.sql';

-- ----------------------------------------------------------------------------
-- 3. GUARD
-- ----------------------------------------------------------------------------
-- A fund is only for a church page. The kind and the church never change. No fund can be "open" while church_giving_collection_open() is false. The closing time comes from the database.
create or replace function public.church_giving_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_church_profile(new.profile_id) then
      raise exception 'church_profile_required' using errcode = '23514', detail = 'funds can only be made for a profile with the Churches & Ministries category';
    end if;
  else
    if new.profile_id is distinct from old.profile_id or new.kind is distinct from old.kind or new.created_at is distinct from old.created_at then
      raise exception 'giving_fund_original_immutable' using errcode = '42501', detail = 'the church and the kind of a fund can never be changed';
    end if;
    new.updated_at := now();
  end if;
  if new.status = 'open' and not public.church_giving_collection_open() then
    raise exception 'giving_collection_not_available' using errcode = '23514', detail = 'collecting money is not available yet; a fund cannot be opened';
  end if;
  if new.status = 'closed' then
    new.closed_at := case when tg_op = 'UPDATE' and old.status = 'closed' then old.closed_at else now() end;
  else
    new.closed_at := null;
  end if;
  return new;
end;
$$;
comment on function public.church_giving_guard() is 'managed by 2027-01-10_church_giving.sql';
revoke all on function public.church_giving_guard() from public, anon, authenticated;

drop trigger if exists church_giving_guard_trg on public.church_giving_funds;
create trigger church_giving_guard_trg before insert or update on public.church_giving_funds for each row execute function public.church_giving_guard();
comment on trigger church_giving_guard_trg on public.church_giving_funds is 'managed by 2027-01-10_church_giving.sql';

-- ----------------------------------------------------------------------------
-- 4. ROW-LEVEL SECURITY AND PRIVILEGES
-- ----------------------------------------------------------------------------
alter table public.church_giving_funds enable row level security;
revoke all on public.church_giving_funds from public, anon, authenticated;

grant select (id, profile_id, kind, title_en, title_fr, description_en, description_fr, goal_xaf, status, closed_at, is_published, created_at, updated_at) on public.church_giving_funds to anon, authenticated;
grant insert (id, profile_id, kind, title_en, title_fr, description_en, description_fr, goal_xaf, is_published) on public.church_giving_funds to authenticated;
grant update (title_en, title_fr, description_en, description_fr, goal_xaf, status, is_published) on public.church_giving_funds to authenticated;
grant delete on public.church_giving_funds to authenticated;
grant all on public.church_giving_funds to service_role;

drop policy if exists church_giving_staff_select on public.church_giving_funds;
create policy church_giving_staff_select on public.church_giving_funds for select to authenticated using (public.church_has_permission(profile_id, 'church.giving.manage'));
drop policy if exists church_giving_public_select on public.church_giving_funds;
create policy church_giving_public_select on public.church_giving_funds for select to anon, authenticated
  using (is_published and exists (select 1 from public.church_features f where f.profile_id = church_giving_funds.profile_id and f.giving));
drop policy if exists church_giving_staff_insert on public.church_giving_funds;
create policy church_giving_staff_insert on public.church_giving_funds for insert to authenticated with check (public.church_has_permission(profile_id, 'church.giving.manage'));
drop policy if exists church_giving_staff_update on public.church_giving_funds;
create policy church_giving_staff_update on public.church_giving_funds for update to authenticated
  using (public.church_has_permission(profile_id, 'church.giving.manage')) with check (public.church_has_permission(profile_id, 'church.giving.manage'));
drop policy if exists church_giving_staff_delete on public.church_giving_funds;
create policy church_giving_staff_delete on public.church_giving_funds for delete to authenticated using (public.church_has_permission(profile_id, 'church.giving.manage'));
drop policy if exists church_giving_no_platform_admin on public.church_giving_funds;
create policy church_giving_no_platform_admin on public.church_giving_funds as restrictive for all to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id)) with check (not public.is_admin() or public.church_is_owner(profile_id));

-- ----------------------------------------------------------------------------
-- 5. POSTCONDITIONS (any failure rolls the whole file back)
-- ----------------------------------------------------------------------------
do $$
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.church_giving_funds'::regclass) then raise exception 'postcondition failed: RLS is off on church_giving_funds'; end if;
  if has_table_privilege('anon', 'public.church_giving_funds', 'insert') or has_table_privilege('anon', 'public.church_giving_funds', 'update') or has_table_privilege('anon', 'public.church_giving_funds', 'delete') then
    raise exception 'postcondition failed: anon can write church_giving_funds';
  end if;
  if has_column_privilege('authenticated', 'public.church_giving_funds', 'closed_at', 'update') or has_column_privilege('authenticated', 'public.church_giving_funds', 'kind', 'update') or has_column_privilege('authenticated', 'public.church_giving_funds', 'profile_id', 'update') then
    raise exception 'postcondition failed: a signed-in user can edit the closing time, the kind or the church';
  end if;
  if public.church_giving_collection_open() then raise exception 'postcondition failed: collection must be closed'; end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgname = 'church_giving_guard_trg') <> 1 then raise exception 'postcondition failed: trigger'; end if;
  if has_function_privilege('anon', 'public.church_giving_guard()', 'execute') or has_function_privilege('authenticated', 'public.church_giving_guard()', 'execute') or has_function_privilege('public', 'public.church_giving_guard()', 'execute')
     or has_function_privilege('anon', 'public.church_giving_collection_open()', 'execute') or has_function_privilege('authenticated', 'public.church_giving_collection_open()', 'execute') then
    raise exception 'postcondition failed: a function is callable by an API role';
  end if;
end $$;

commit;
