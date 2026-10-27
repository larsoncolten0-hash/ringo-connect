-- Churches & Ministries Phase 2: optional pictures on events, announcements and care cases, and a fuller testimonies read for the landing pages — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Adds FOUR nullable / defaulted COLUMNS to three tables of earlier phases, one trigger function with one trigger, and one public read function. Nothing existing is changed: no existing column,
-- constraint, policy, trigger or function is altered or replaced, and no row is read or written. The columns are new, nullable (or defaulted) and only gain their own constraints and grants.
--
--   NEW  ministry_events.image_url          an optional picture of an event (a web address, https)
--   NEW  ministry_announcements.image_url   an optional picture of an announcement
--   NEW  ministry_care_cases.image_url      an optional picture of a care case — see the care rules below
--   NEW  ministry_care_cases.image_consent  the church's recorded confirmation that the person agreed the picture may be shown publicly; the database refuses a picture without it
--   NEW  function ministry_care_image_guard() + trigger ministry_care_cases_image_trg
--   NEW  function ministry_testimonies_public_week(profile, since, limit)   the SAME door as ministry_testimonies_public (approved + published + consented, name only with name consent), from a
--                                                                           chosen moment on, up to 100: it is what the "all testimonies of this week" landing page reads
--
-- CARE AND PICTURES (the existing rule is "no name, no photo": a picture of the person IS an identity, so it is held to the same consent standard as the case itself)
--   * a care picture can only exist while image_consent is true (check constraint ministry_care_cases_image_consent_check: image_url is null or image_consent);
--   * removing the picture clears image_consent (so adding another one needs the confirmation again);
--   * WITHDRAWING the case's consent clears the picture and image_consent in the same statement (a trigger on the case row), on top of the existing rule that withdrawal unpublishes the case;
--   * the public (anon) read policy of a case is unchanged: published + consent_state = 'granted' + published church. image_consent itself is readable by signed-in staff only, never by anon.
--
-- PICTURES IN GENERAL: the database checks the SHAPE (https, a real host, no spaces, at most 500 characters). WHICH addresses are accepted (only this platform's own storage) is checked by the
-- application on write and again before it shows anything, because the database cannot know the storage address.
--
-- GRANTS (these tables use column-level grants, so a new column is invisible until granted): image_url is readable by anon and authenticated and writable by authenticated (the row-level policies still decide
-- who may write which row, exactly as for every other content column); image_consent is readable and writable by authenticated only.
--
-- SELF-VERIFYING, one transaction: preconditions first, postconditions last. Any RAISE rolls everything back. Re-runnable.
--
-- Depends on: 2026-12-29_ministry_events_announcements.sql, 2027-01-02_ministry_care_cases.sql, 2027-01-03_ministry_testimonies.sql.
-- Preflight (read-only, run BEFORE): supabase/support/2027-01-04_church_landing_images.preflight.sql
-- Verify    (read-only, run AFTER):  supabase/support/2027-01-04_church_landing_images.verify.sql
-- Rollback: supabase/support/2027-01-04_church_landing_images.rollback.sql (refuses to run while any picture exists unless the loss is explicitly confirmed).

begin;

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS
-- ----------------------------------------------------------------------------
do $$
declare
  v_t text;
begin
  foreach v_t in array array['ministry_events', 'ministry_announcements', 'ministry_care_cases', 'ministry_testimonies'] loop
    if to_regclass('public.' || v_t) is null then raise exception 'precondition failed: public.% does not exist (apply the earlier church migrations first)', v_t; end if;
  end loop;
  if to_regprocedure('public.ministry_testimonies_public(uuid)') is null then raise exception 'precondition failed: ministry_testimonies_public(uuid) does not exist'; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') or not exists (select 1 from pg_roles where rolname = 'authenticated') or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'precondition failed: the database roles anon, authenticated and service_role must exist';
  end if;
  -- a foreign object of the same name must not be here
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('ministry_testimonies_public_week', 'ministry_care_image_guard')
               and coalesce(obj_description(oid, 'pg_proc'), '') <> 'managed by 2027-01-04_church_landing_images.sql') then
    raise exception 'precondition failed: a function named like one of this file''s exists and is not managed by it';
  end if;
  perform set_config('church_landing.pre', jsonb_build_object(
    'events', (select count(*) from public.ministry_events),
    'announcements', (select count(*) from public.ministry_announcements),
    'care', (select count(*) from public.ministry_care_cases),
    'testimonies', (select count(*) from public.ministry_testimonies)
  )::text, true);
end $$;

-- ----------------------------------------------------------------------------
-- 1. COLUMNS AND THEIR CONSTRAINTS (new, nullable or defaulted)
-- ----------------------------------------------------------------------------
alter table public.ministry_events add column if not exists image_url text;
alter table public.ministry_announcements add column if not exists image_url text;
alter table public.ministry_care_cases add column if not exists image_url text;
alter table public.ministry_care_cases add column if not exists image_consent boolean not null default false;

do $$
declare
  v_shape constant text := '^https://[^\s/@?#]+\.[^\s/@?#]+(/[^\s]*)?$';
begin
  if not exists (select 1 from pg_constraint where conname = 'ministry_events_image_url_check' and conrelid = 'public.ministry_events'::regclass) then
    execute format('alter table public.ministry_events add constraint ministry_events_image_url_check check (image_url is null or (char_length(image_url) between 12 and 500 and image_url ~ %L))', v_shape);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ministry_announcements_image_url_check' and conrelid = 'public.ministry_announcements'::regclass) then
    execute format('alter table public.ministry_announcements add constraint ministry_announcements_image_url_check check (image_url is null or (char_length(image_url) between 12 and 500 and image_url ~ %L))', v_shape);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ministry_care_cases_image_url_check' and conrelid = 'public.ministry_care_cases'::regclass) then
    execute format('alter table public.ministry_care_cases add constraint ministry_care_cases_image_url_check check (image_url is null or (char_length(image_url) between 12 and 500 and image_url ~ %L))', v_shape);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ministry_care_cases_image_consent_check' and conrelid = 'public.ministry_care_cases'::regclass) then
    alter table public.ministry_care_cases add constraint ministry_care_cases_image_consent_check check (image_url is null or image_consent);
  end if;
end $$;

comment on column public.ministry_events.image_url is 'managed by 2027-01-04_church_landing_images.sql';
comment on column public.ministry_announcements.image_url is 'managed by 2027-01-04_church_landing_images.sql';
comment on column public.ministry_care_cases.image_url is 'managed by 2027-01-04_church_landing_images.sql';
comment on column public.ministry_care_cases.image_consent is 'managed by 2027-01-04_church_landing_images.sql';

-- ----------------------------------------------------------------------------
-- 2. FUNCTIONS AND THE TRIGGER
-- ----------------------------------------------------------------------------
-- A care picture never outlives the person's consent: removing it clears the confirmation, and withdrawing the case's consent clears both. (The existing guard already unpublishes the case.)
create or replace function public.ministry_care_image_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.consent_state = 'withdrawn' and old.consent_state is distinct from 'withdrawn' then
    new.image_url := null;
    new.image_consent := false;
  end if;
  if new.image_url is null then
    new.image_consent := false;
  end if;
  return new;
end;
$$;

-- The testimonies of one church from a chosen moment on, for the landing page: the SAME conditions as ministry_testimonies_public (approved AND published AND publication consent held, on a published
-- church page; the name only with name consent; never a phone number, group, note or status), newest first, at most 100 (a missing or silly limit becomes 50 / 1..100).
create or replace function public.ministry_testimonies_public_week(p_profile_id uuid, p_since timestamptz, p_limit integer default 50)
returns table (id uuid, display_name text, body text, lang text, published_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select t.id,
         case when t.name_consent then t.full_name else null end,
         coalesce(t.public_body, t.body),
         t.lang,
         t.published_at
    from public.ministry_testimonies t
    join public.profiles p on p.id = t.profile_id
   where t.profile_id = p_profile_id
     and p.published = true
     and t.review_status = 'approved'
     and t.publication_status = 'published'
     and t.publish_consent = true
     and t.published_at >= p_since
   order by t.published_at desc, t.id
   limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

comment on function public.ministry_care_image_guard() is 'managed by 2027-01-04_church_landing_images.sql';
comment on function public.ministry_testimonies_public_week(uuid, timestamptz, integer) is 'managed by 2027-01-04_church_landing_images.sql';

revoke all on function public.ministry_care_image_guard() from public, anon, authenticated;
revoke all on function public.ministry_testimonies_public_week(uuid, timestamptz, integer) from public;
grant execute on function public.ministry_testimonies_public_week(uuid, timestamptz, integer) to anon, authenticated, service_role;

drop trigger if exists ministry_care_cases_image_trg on public.ministry_care_cases;
create trigger ministry_care_cases_image_trg before update on public.ministry_care_cases for each row execute function public.ministry_care_image_guard();
comment on trigger ministry_care_cases_image_trg on public.ministry_care_cases is 'managed by 2027-01-04_church_landing_images.sql';

-- ----------------------------------------------------------------------------
-- 3. PRIVILEGES (column level, like the rest of these tables)
-- ----------------------------------------------------------------------------
grant select (image_url) on public.ministry_events to anon, authenticated;
grant select (image_url) on public.ministry_announcements to anon, authenticated;
grant select (image_url) on public.ministry_care_cases to anon, authenticated;
grant select (image_consent) on public.ministry_care_cases to authenticated;

grant insert (image_url), update (image_url) on public.ministry_events to authenticated;
grant insert (image_url), update (image_url) on public.ministry_announcements to authenticated;
grant insert (image_url, image_consent), update (image_url, image_consent) on public.ministry_care_cases to authenticated;

-- ----------------------------------------------------------------------------
-- 4. POSTCONDITIONS (any failure rolls the whole file back)
-- ----------------------------------------------------------------------------
do $$
declare
  v_pre jsonb := current_setting('church_landing.pre')::jsonb;
  v_marker constant text := 'managed by 2027-01-04_church_landing_images.sql';
  v_bad text;
begin
  -- the four columns exist, with the right shape
  if (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'image_url' and data_type = 'text'
         and table_name in ('ministry_events', 'ministry_announcements', 'ministry_care_cases')) <> 3 then raise exception 'postcondition failed: image_url columns'; end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ministry_care_cases' and column_name = 'image_consent' and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false') <> 1 then
    raise exception 'postcondition failed: image_consent column'; end if;
  if (select count(*) from pg_constraint where conname in ('ministry_events_image_url_check', 'ministry_announcements_image_url_check', 'ministry_care_cases_image_url_check', 'ministry_care_cases_image_consent_check')) <> 4 then
    raise exception 'postcondition failed: constraints'; end if;
  -- a picture on a care case needs the confirmation: the database itself says so
  begin
    perform 1 from public.ministry_care_cases where image_url is not null and not image_consent;
    if found then raise exception 'postcondition failed: a care picture without consent exists'; end if;
  end;
  -- anon: may read the pictures, may NOT read the care confirmation, may write nothing
  if not (has_column_privilege('anon', 'public.ministry_events', 'image_url', 'select') and has_column_privilege('anon', 'public.ministry_announcements', 'image_url', 'select') and has_column_privilege('anon', 'public.ministry_care_cases', 'image_url', 'select')) then
    raise exception 'postcondition failed: anon cannot read a picture'; end if;
  if has_column_privilege('anon', 'public.ministry_care_cases', 'image_consent', 'select') then raise exception 'postcondition failed: anon can read image_consent'; end if;
  select string_agg(t || '.' || c || '.' || k, ', ') into v_bad
    from (values ('ministry_events', 'image_url'), ('ministry_announcements', 'image_url'), ('ministry_care_cases', 'image_url'), ('ministry_care_cases', 'image_consent')) x(t, c), unnest(array['insert', 'update']) k
   where has_column_privilege('anon', 'public.' || t, c, k) or has_column_privilege('public', 'public.' || t, c, k);
  if v_bad is not null then raise exception 'postcondition failed: anon or PUBLIC can write: %', v_bad; end if;
  if not (has_column_privilege('authenticated', 'public.ministry_care_cases', 'image_consent', 'select') and has_column_privilege('authenticated', 'public.ministry_care_cases', 'image_consent', 'update')) then
    raise exception 'postcondition failed: staff cannot record the picture confirmation'; end if;
  -- the trigger and the functions
  if (select count(*) from pg_trigger where not tgisinternal and tgname = 'ministry_care_cases_image_trg') <> 1 then raise exception 'postcondition failed: the care picture trigger'; end if;
  if has_function_privilege('anon', 'public.ministry_care_image_guard()', 'execute') or has_function_privilege('authenticated', 'public.ministry_care_image_guard()', 'execute') or has_function_privilege('public', 'public.ministry_care_image_guard()', 'execute') then
    raise exception 'postcondition failed: the guard function is callable by an API role'; end if;
  if not (has_function_privilege('anon', 'public.ministry_testimonies_public_week(uuid, timestamptz, integer)', 'execute') and has_function_privilege('authenticated', 'public.ministry_testimonies_public_week(uuid, timestamptz, integer)', 'execute'))
     or has_function_privilege('public', 'public.ministry_testimonies_public_week(uuid, timestamptz, integer)', 'execute') then raise exception 'postcondition failed: the week function privileges'; end if;
  if coalesce(obj_description('public.ministry_testimonies_public_week(uuid, timestamptz, integer)'::regprocedure, 'pg_proc'), '') <> v_marker then raise exception 'postcondition failed: function marker'; end if;
  -- no money, anywhere
  select string_agg(c.table_name || '.' || c.column_name, ', ') into v_bad from information_schema.columns c
   where c.table_schema = 'public' and c.table_name in ('ministry_events', 'ministry_announcements', 'ministry_care_cases') and c.column_name ~* '(amount|price|currency|money|fee|commission|payment|payout|refund|receipt|balance)';
  if v_bad is not null then raise exception 'postcondition failed: a money-like column exists: %', v_bad; end if;
  -- nothing was written
  if (select count(*) from public.ministry_events) <> (v_pre->>'events')::bigint or (select count(*) from public.ministry_announcements) <> (v_pre->>'announcements')::bigint
     or (select count(*) from public.ministry_care_cases) <> (v_pre->>'care')::bigint or (select count(*) from public.ministry_testimonies) <> (v_pre->>'testimonies')::bigint then
    raise exception 'postcondition failed: a row count changed';
  end if;
end $$;

commit;
