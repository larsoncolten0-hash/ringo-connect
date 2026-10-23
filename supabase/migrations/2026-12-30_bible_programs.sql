-- Churches & Ministries Phase 5: Bible Programs / My Bible Journey (database foundation) — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Adds FOUR tables, six functions. Nothing existing is changed: no table, column, constraint, policy, trigger or function of Phase 0, Phase 2A, Phase 3, Phase 4, Team, the visitor accounts
-- (ringo_customers) or anything else is altered, and no row is read or written. It CALLS (never modifies) the Phase 2A helpers is_church_profile(), church_is_owner() and
-- church_has_permission(), and the platform's is_admin().
--
--   NEW  public.bible_programs          a reading programme of a church (a title and a description in English and/or French), draft -> published, like an event
--   NEW  public.bible_program_sessions  its ordered days / readings: a title, a scripture REFERENCE the church types (no Bible text is stored or supplied), an optional note
--   NEW  public.bible_enrollments       a visitor (ringo_customers) who joined a published programme                       PRIVATE
--   NEW  public.bible_session_progress  which sessions that visitor marked done                                            PRIVATE
--   NEW  functions bible_program_guard(), bible_session_guard(), bible_enrollment_guard(), bible_progress_guard(), bible_program_stats(), bible_session_move()
--
-- TWO KINDS OF DATA, TWO KINDS OF PROTECTION
--   * PROGRAMMES and SESSIONS are content the church publishes. They follow the Phase 3 / Phase 4 pattern: staff read with church.bible.view|manage|publish, manage = drafts only, publish = anything,
--     RESTRICTIVE policies refuse a platform admin who is not the church's owner, the public (anon and authenticated) reads only a PUBLISHED programme of a published profile and its sessions, audit
--     columns are hidden from every API role, and the guard triggers fill the audit and publication stamps.
--   * ENROLMENTS and PROGRESS are a person's private spiritual practice. Row-level security is on and there is NO policy and NO privilege for PUBLIC, anon or authenticated: they are reachable only by the
--     service role, which the application uses ONLY behind the visitor's own signed-in session (the My Ringo customer cookie), always filtered by that visitor's id. Church staff never read a row of them:
--     they get counts through bible_program_stats(), which returns the number enrolled and, once at least 3 people are enrolled, how many completed each session. With fewer than 3 enrolled the per-session
--     numbers are withheld (null), so a small cohort cannot be traced to one person. Deleting a visitor identity deletes their enrolment and progress with it.
--
-- WHAT THE DATABASE REFUSES (for every writer, the service role included): publishing a programme with no session; more than 400 sessions in a programme; an enrolment in a programme that is not
-- published (or whose church page is not published); progress on a programme that is not published; a session or an enrolment of another church (composite foreign keys); a second enrolment of the same
-- visitor in the same programme; a second tick of the same session; changing the church or the programme of a row; editing an enrolment. A programme that has participants cannot be deleted (NO ACTION
-- foreign key): unpublish it instead.
--
-- NAMING: no church_ prefix on purpose (Phase 0 verify row 10 expects no church_* table other than the four Phase 2A ones).
--
-- PERMISSIONS (strings stored in organization_roles.permissions like every other permission; church_has_permission() already answers for any string)
--   church.bible.view     read every programme and session of the church, drafts included, and the participant counts
--   church.bible.manage   create, edit and delete DRAFT programmes and their sessions
--   church.bible.publish  publish, unpublish, and edit or delete a LIVE programme and its sessions
--   The owner of a church implicitly holds all three. The Phase 2A grant guards treat every church.* string they do not list as SENSITIVE (OWNER-ONLY to grant), so no Phase 2A object changes.
--
-- SELF-VERIFYING, one transaction: preconditions first, postconditions last. Any RAISE rolls everything back. Re-runnable.
--
-- Depends on: 2026-12-27_church_people_groups.sql (is_church_profile, church_is_owner, church_has_permission), is_admin(), public.ringo_customers (the visitor identity).
-- Preflight (read-only, run BEFORE): supabase/support/2026-12-30_bible_programs.preflight.sql
-- Verify    (read-only, run AFTER):  supabase/support/2026-12-30_bible_programs.verify.sql
-- Rollback: supabase/support/2026-12-30_bible_programs.rollback.sql (refuses to run while any row exists unless data loss is explicitly confirmed).

begin;

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS + a snapshot of the objects this file must leave untouched
-- ----------------------------------------------------------------------------
do $$
declare
  v_marker constant text := 'managed by 2026-12-30_bible_programs.sql';
  v_missing text;
  v_bad text;
  v_have int := (select count(*) from unnest(array['bible_programs', 'bible_program_sessions', 'bible_enrollments', 'bible_session_progress']) t where to_regclass('public.' || t) is not null);
begin
  select string_agg(t, ', ') into v_missing from unnest(array['profiles', 'users', 'ringo_customers']) t where to_regclass('public.' || t) is null;
  if v_missing is not null then raise exception 'precondition failed: missing tables: %', v_missing; end if;

  select string_agg(f, ', ') into v_missing
    from unnest(array['public.is_admin()', 'public.is_church_profile(uuid)', 'public.church_is_owner(uuid)', 'public.church_has_permission(uuid, text)']) f
   where to_regprocedure(f) is null;
  if v_missing is not null then raise exception 'precondition failed: missing functions (is Phase 2A applied?): %', v_missing; end if;

  select string_agg(c, ', ') into v_missing from unnest(array['published']) c
   where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = c);
  if v_missing is not null then raise exception 'precondition failed: public.profiles is missing columns: %', v_missing; end if;

  select string_agg(r, ', ') into v_missing from unnest(array['anon', 'authenticated', 'service_role']) r where not exists (select 1 from pg_roles where rolname = r);
  if v_missing is not null then raise exception 'precondition failed: missing database roles: %', v_missing; end if;

  -- the Phase 2A policy helpers must be the real ones (the marker proves they were created by that migration)
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('is_church_profile', 'church_is_owner', 'church_has_permission')
     and coalesce(obj_description(p.oid, 'pg_proc'), '') <> 'managed by 2026-12-27_church_people_groups.sql';
  if v_bad is not null then raise exception 'precondition failed: % is not managed by the Phase 2A migration', v_bad; end if;

  -- half-applied guard: either none of the four tables exists (first run) or all do (re-run)
  if v_have not in (0, 4) then raise exception 'precondition failed: only % of the 4 Bible tables exist (half-applied state); resolve it before running this file', v_have; end if;
  if v_have = 4 then
    select string_agg(t, ', ') into v_bad from unnest(array['bible_programs', 'bible_program_sessions', 'bible_enrollments', 'bible_session_progress']) t
     where coalesce(obj_description(to_regclass('public.' || t), 'pg_class'), '') <> v_marker;
    if v_bad is not null then raise exception 'precondition failed: table(s) % already exist but are not managed by this migration; refusing to adopt or re-mark them', v_bad; end if;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('bible_program_guard', 'bible_session_guard', 'bible_enrollment_guard', 'bible_progress_guard', 'bible_program_stats', 'bible_session_move')
     and (v_have = 0 or coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker);
  if v_bad is not null then raise exception 'precondition failed: a function with one of this file''s names already exists and is not managed by it: %', v_bad; end if;
  if v_have = 0 then
    select string_agg(c.relname, ', ') into v_bad from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'bible\_%';
    if v_bad is not null then raise exception 'precondition failed: relations named bible_* already exist: %', v_bad; end if;
  end if;

  perform set_config('bible_programs.pre', jsonb_build_object(
    'profiles',     (select count(*) from public.profiles),
    'users',        (select count(*) from public.users),
    'customers',    (select count(*) from public.ringo_customers),
    'org_roles',    (select count(*) from public.organization_roles),
    'org_members',  (select count(*) from public.organization_members),
    'policies',     (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
                       from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass, 'public.ringo_customers'::regclass,
                                                              'public.church_members'::regclass, 'public.church_groups'::regclass, 'public.church_group_members'::regclass, 'public.church_leadership'::regclass)
                          or p.polrelid = to_regclass('public.daily_words') or p.polrelid = to_regclass('public.ministry_events') or p.polrelid = to_regclass('public.ministry_announcements')),
    'fn_defs',      (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
                       from pg_proc f where f.pronamespace = 'public'::regnamespace
                        and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'daily\_word%' or f.proname like 'ministry\_%' or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile')))
  )::text, true);
end $$;

-- ----------------------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------------------
create table if not exists public.bible_programs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'draft',
  title_en text,
  title_fr text,
  description_en text,
  description_fr text,
  published_at timestamptz,
  -- audit columns: filled by bible_program_guard from auth.uid(); NOT readable or writable by any API role (see the column grants)
  published_by uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- target of the composite foreign keys below: a session or an enrolment can only ever point at a programme of the SAME church
  constraint bible_programs_id_profile_key unique (id, profile_id),
  constraint bible_programs_status_check check (status in ('draft', 'published')),
  constraint bible_programs_published_at_check check ((status = 'published') = (published_at is not null)),
  constraint bible_programs_title_en_check check (title_en is null or char_length(title_en) between 1 and 120),
  constraint bible_programs_title_fr_check check (title_fr is null or char_length(title_fr) between 1 and 120),
  constraint bible_programs_description_en_check check (description_en is null or char_length(description_en) between 1 and 2000),
  constraint bible_programs_description_fr_check check (description_fr is null or char_length(description_fr) between 1 and 2000),
  -- a published programme is readable in at least one language: it needs a title in English or in French
  constraint bible_programs_publish_content_check check (status <> 'published' or nullif(btrim(title_en), '') is not null or nullif(btrim(title_fr), '') is not null)
);
create index if not exists bible_programs_profile_idx on public.bible_programs (profile_id, created_at desc);

create table if not exists public.bible_program_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  program_id uuid not null,
  position integer not null,
  title_en text,
  title_fr text,
  -- a reference the church types ("Psalm 23", "Jean 3:16-21"): no Bible text is stored or supplied by Ringo
  scripture_ref_en text,
  scripture_ref_fr text,
  note_en text,
  note_fr text,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bible_program_sessions_program_fk foreign key (program_id, profile_id) references public.bible_programs (id, profile_id) on delete cascade,
  -- target of the composite foreign key of the progress table
  constraint bible_program_sessions_id_program_key unique (id, program_id),
  -- one session per position; deferrable so two sessions can swap places in ONE statement (bible_session_move)
  constraint bible_program_sessions_position_key unique (program_id, position) deferrable initially deferred,
  constraint bible_program_sessions_position_check check (position between 1 and 1000),
  constraint bible_program_sessions_title_en_check check (title_en is null or char_length(title_en) between 1 and 120),
  constraint bible_program_sessions_title_fr_check check (title_fr is null or char_length(title_fr) between 1 and 120),
  constraint bible_program_sessions_ref_en_check check (scripture_ref_en is null or char_length(scripture_ref_en) between 1 and 120),
  constraint bible_program_sessions_ref_fr_check check (scripture_ref_fr is null or char_length(scripture_ref_fr) between 1 and 120),
  constraint bible_program_sessions_note_en_check check (note_en is null or char_length(note_en) between 1 and 1000),
  constraint bible_program_sessions_note_fr_check check (note_fr is null or char_length(note_fr) between 1 and 1000),
  -- a session is always named, in at least one language
  constraint bible_program_sessions_title_check check (nullif(btrim(title_en), '') is not null or nullif(btrim(title_fr), '') is not null)
);
create index if not exists bible_program_sessions_program_idx on public.bible_program_sessions (program_id, position);

-- PRIVATE: no policy, no privilege for PUBLIC / anon / authenticated (section 3). Service role only, behind the visitor's own session.
create table if not exists public.bible_enrollments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  program_id uuid not null,
  customer_id uuid not null references public.ringo_customers(id) on delete cascade,
  joined_at timestamptz not null default now(),
  -- NO ACTION (checked after cascades): a programme that has participants cannot be deleted, but deleting the whole church (profile cascade) still works
  constraint bible_enrollments_program_fk foreign key (program_id, profile_id) references public.bible_programs (id, profile_id),
  constraint bible_enrollments_program_customer_key unique (program_id, customer_id),
  constraint bible_enrollments_id_program_key unique (id, program_id)
);
create index if not exists bible_enrollments_customer_idx on public.bible_enrollments (customer_id);

create table if not exists public.bible_session_progress (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null,
  program_id uuid not null,
  session_id uuid not null,
  completed_at timestamptz not null default now(),
  -- the enrolment and the session must belong to the SAME programme; deleting the enrolment (or the visitor) or the session removes the tick
  constraint bible_session_progress_enrollment_fk foreign key (enrollment_id, program_id) references public.bible_enrollments (id, program_id) on delete cascade,
  constraint bible_session_progress_session_fk foreign key (session_id, program_id) references public.bible_program_sessions (id, program_id) on delete cascade,
  constraint bible_session_progress_enrollment_session_key unique (enrollment_id, session_id)
);
create index if not exists bible_session_progress_session_idx on public.bible_session_progress (session_id);

comment on table public.bible_programs is 'managed by 2026-12-30_bible_programs.sql';
comment on table public.bible_program_sessions is 'managed by 2026-12-30_bible_programs.sql';
comment on table public.bible_enrollments is 'managed by 2026-12-30_bible_programs.sql';
comment on table public.bible_session_progress is 'managed by 2026-12-30_bible_programs.sql';

-- ----------------------------------------------------------------------------
-- 2. FUNCTIONS
-- ----------------------------------------------------------------------------
-- Programme: the same bookkeeping as the Phase 4 content guard (church can never change, only a church profile, audit from auth.uid(), publication stamps follow the status), plus: a programme
-- cannot be published without at least one session. Applies to every writer, the service role included.
create or replace function public.bible_program_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_church_profile(new.profile_id) then
      raise exception 'bible_profile_required' using errcode = '23514', detail = 'programmes can only be created for a profile with the Churches & Ministries category';
    end if;
    if auth.uid() is not null then
      new.created_by := auth.uid();
      new.updated_by := auth.uid();
    end if;
  else
    if new.profile_id is distinct from old.profile_id then
      raise exception 'bible_tenant_immutable' using errcode = '42501', detail = 'a programme can never be moved to another church';
    end if;
    if auth.uid() is not null then
      new.created_by := old.created_by;
      new.updated_by := auth.uid();
    end if;
    new.updated_at := now();
  end if;

  if new.status = 'published' then
    if tg_op = 'INSERT' or old.status <> 'published' then
      if tg_op = 'INSERT' or not exists (select 1 from public.bible_program_sessions s where s.program_id = new.id) then
        raise exception 'bible_program_needs_sessions' using errcode = '23514', detail = 'a programme needs at least one session before it can be published';
      end if;
      new.published_at := now();
      new.published_by := coalesce(auth.uid(), new.published_by);
    else
      new.published_at := old.published_at;
      new.published_by := old.published_by;
    end if;
  else
    new.published_at := null;
    new.published_by := null;
  end if;
  return new;
end;
$$;

-- Session: the church and the programme never change; at most 400 sessions per programme; audit and updated_at are bookkept here.
create or replace function public.bible_session_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.bible_program_sessions s where s.program_id = new.program_id) >= 400 then
      raise exception 'bible_session_limit' using errcode = '23514', detail = 'a programme holds at most 400 sessions';
    end if;
    if auth.uid() is not null then
      new.created_by := auth.uid();
      new.updated_by := auth.uid();
    end if;
  else
    if new.profile_id is distinct from old.profile_id or new.program_id is distinct from old.program_id then
      raise exception 'bible_tenant_immutable' using errcode = '42501', detail = 'a session can never be moved to another programme or church';
    end if;
    if auth.uid() is not null then
      new.created_by := old.created_by;
      new.updated_by := auth.uid();
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- Enrolment: only in a PUBLISHED programme of a PUBLISHED church page; never edited.
create or replace function public.bible_enrollment_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'bible_enrollment_immutable' using errcode = '42501', detail = 'an enrolment is made or ended, never edited';
  end if;
  if not exists (
    select 1 from public.bible_programs p join public.profiles pr on pr.id = p.profile_id
     where p.id = new.program_id and p.profile_id = new.profile_id and p.status = 'published' and pr.published = true and public.is_church_profile(p.profile_id)
  ) then
    raise exception 'bible_program_unavailable' using errcode = '23514', detail = 'only a published programme of a published church page can be joined';
  end if;
  return new;
end;
$$;

-- Progress: only while the programme is published; a tick is made or removed, never edited.
create or replace function public.bible_progress_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'bible_progress_immutable' using errcode = '42501', detail = 'a completed session is recorded or removed, never edited';
  end if;
  if not exists (select 1 from public.bible_programs p where p.id = new.program_id and p.status = 'published') then
    raise exception 'bible_program_unavailable' using errcode = '23514', detail = 'progress can only be recorded in a published programme';
  end if;
  return new;
end;
$$;

-- What church staff may know about participation: COUNTS ONLY. NULL when the caller holds no Bible permission for this church (never a platform admin who is not the owner).
-- The per-session completion numbers are withheld (null) while fewer than 3 people are enrolled, so a small cohort cannot be traced to a person.
create or replace function public.bible_program_stats(p_program_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_profile uuid;
  v_enrolled bigint;
begin
  select p.profile_id into v_profile from public.bible_programs p where p.id = p_program_id;
  if v_profile is null then return null; end if;
  if not (public.church_has_permission(v_profile, 'church.bible.view') or public.church_has_permission(v_profile, 'church.bible.manage') or public.church_has_permission(v_profile, 'church.bible.publish')) then
    return null;
  end if;
  select count(*) into v_enrolled from public.bible_enrollments e where e.program_id = p_program_id;
  return jsonb_build_object(
    'enrolled', v_enrolled,
    'detailed', v_enrolled >= 3,
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id,
               'position', s.position,
               'completed', case when v_enrolled >= 3 then (select count(*) from public.bible_session_progress sp where sp.session_id = s.id) else null end
             ) order by s.position)
        from public.bible_program_sessions s where s.program_id = p_program_id), '[]'::jsonb)
  );
end;
$$;

-- Swaps a session with its neighbour (up = earlier, down = later) in ONE statement, as the CALLER: row-level security decides, so a person who may not edit this programme's sessions changes nothing
-- (false). Returns true when the two sessions swapped places.
create or replace function public.bible_session_move(p_session_id uuid, p_direction text)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_program uuid;
  v_pos integer;
  v_other uuid;
  v_other_pos integer;
  v_n integer;
begin
  if p_direction not in ('up', 'down') then
    raise exception 'bible_move_direction' using errcode = '22023';
  end if;
  select s.program_id, s.position into v_program, v_pos from public.bible_program_sessions s where s.id = p_session_id;
  if v_program is null then return false; end if;
  if p_direction = 'up' then
    select s.id, s.position into v_other, v_other_pos from public.bible_program_sessions s where s.program_id = v_program and s.position < v_pos order by s.position desc limit 1;
  else
    select s.id, s.position into v_other, v_other_pos from public.bible_program_sessions s where s.program_id = v_program and s.position > v_pos order by s.position asc limit 1;
  end if;
  if v_other is null then return false; end if;
  update public.bible_program_sessions set position = case when id = p_session_id then v_other_pos else v_pos end where id in (p_session_id, v_other);
  get diagnostics v_n = row_count;
  return v_n = 2;
end;
$$;

comment on function public.bible_program_guard() is 'managed by 2026-12-30_bible_programs.sql';
comment on function public.bible_session_guard() is 'managed by 2026-12-30_bible_programs.sql';
comment on function public.bible_enrollment_guard() is 'managed by 2026-12-30_bible_programs.sql';
comment on function public.bible_progress_guard() is 'managed by 2026-12-30_bible_programs.sql';
comment on function public.bible_program_stats(uuid) is 'managed by 2026-12-30_bible_programs.sql';
comment on function public.bible_session_move(uuid, text) is 'managed by 2026-12-30_bible_programs.sql';

-- the two RPCs are for signed-in staff only; nothing here is callable by anon or PUBLIC (the guards are trigger functions and are never called directly)
revoke all on function public.bible_program_stats(uuid) from public, anon;
revoke all on function public.bible_session_move(uuid, text) from public, anon;
revoke all on function public.bible_program_guard() from public, anon, authenticated;
revoke all on function public.bible_session_guard() from public, anon, authenticated;
revoke all on function public.bible_enrollment_guard() from public, anon, authenticated;
revoke all on function public.bible_progress_guard() from public, anon, authenticated;
grant execute on function public.bible_program_stats(uuid) to authenticated, service_role;
grant execute on function public.bible_session_move(uuid, text) to authenticated, service_role;

drop trigger if exists bible_programs_guard_trg on public.bible_programs;
create trigger bible_programs_guard_trg before insert or update on public.bible_programs for each row execute function public.bible_program_guard();
comment on trigger bible_programs_guard_trg on public.bible_programs is 'managed by 2026-12-30_bible_programs.sql';
drop trigger if exists bible_program_sessions_guard_trg on public.bible_program_sessions;
create trigger bible_program_sessions_guard_trg before insert or update on public.bible_program_sessions for each row execute function public.bible_session_guard();
comment on trigger bible_program_sessions_guard_trg on public.bible_program_sessions is 'managed by 2026-12-30_bible_programs.sql';
drop trigger if exists bible_enrollments_guard_trg on public.bible_enrollments;
create trigger bible_enrollments_guard_trg before insert or update on public.bible_enrollments for each row execute function public.bible_enrollment_guard();
comment on trigger bible_enrollments_guard_trg on public.bible_enrollments is 'managed by 2026-12-30_bible_programs.sql';
drop trigger if exists bible_session_progress_guard_trg on public.bible_session_progress;
create trigger bible_session_progress_guard_trg before insert or update on public.bible_session_progress for each row execute function public.bible_progress_guard();
comment on trigger bible_session_progress_guard_trg on public.bible_session_progress is 'managed by 2026-12-30_bible_programs.sql';

-- ----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY AND PRIVILEGES
-- ----------------------------------------------------------------------------
alter table public.bible_programs enable row level security;
alter table public.bible_program_sessions enable row level security;
alter table public.bible_enrollments enable row level security;
alter table public.bible_session_progress enable row level security;

revoke all on public.bible_programs from public, anon, authenticated;
revoke all on public.bible_program_sessions from public, anon, authenticated;
revoke all on public.bible_enrollments from public, anon, authenticated;
revoke all on public.bible_session_progress from public, anon, authenticated;
-- READ: only the content columns (never the audit columns), for anon and signed-in users alike; the policies decide which ROWS.
grant select (id, profile_id, status, title_en, title_fr, description_en, description_fr, published_at, created_at, updated_at) on public.bible_programs to anon, authenticated;
grant select (id, profile_id, program_id, position, title_en, title_fr, scripture_ref_en, scripture_ref_fr, note_en, note_fr, created_at, updated_at) on public.bible_program_sessions to anon, authenticated;
-- WRITE (signed-in users only): content columns and the status; profile_id / program_id only on insert. No TRUNCATE / REFERENCES / TRIGGER.
grant insert (id, profile_id, status, title_en, title_fr, description_en, description_fr) on public.bible_programs to authenticated;
grant update (status, title_en, title_fr, description_en, description_fr) on public.bible_programs to authenticated;
grant delete on public.bible_programs to authenticated;
grant insert (id, profile_id, program_id, position, title_en, title_fr, scripture_ref_en, scripture_ref_fr, note_en, note_fr) on public.bible_program_sessions to authenticated;
grant update (position, title_en, title_fr, scripture_ref_en, scripture_ref_fr, note_en, note_fr) on public.bible_program_sessions to authenticated;
grant delete on public.bible_program_sessions to authenticated;
-- the private tables: service role only
grant all on public.bible_programs to service_role;
grant all on public.bible_program_sessions to service_role;
grant all on public.bible_enrollments to service_role;
grant all on public.bible_session_progress to service_role;

-- bible_programs
drop policy if exists bible_programs_staff_select on public.bible_programs;
create policy bible_programs_staff_select on public.bible_programs for select to authenticated
  using (public.church_has_permission(profile_id, 'church.bible.view') or public.church_has_permission(profile_id, 'church.bible.manage') or public.church_has_permission(profile_id, 'church.bible.publish'));

drop policy if exists bible_programs_public_select on public.bible_programs;
create policy bible_programs_public_select on public.bible_programs for select to anon, authenticated
  using (status = 'published' and exists (select 1 from public.profiles p where p.id = profile_id and p.published = true));

-- publish permission: anything. manage permission: drafts only, and the row must still be a draft afterwards (so manage alone can never publish).
drop policy if exists bible_programs_insert on public.bible_programs;
create policy bible_programs_insert on public.bible_programs for insert to authenticated
  with check (public.church_has_permission(profile_id, 'church.bible.publish') or (status = 'draft' and public.church_has_permission(profile_id, 'church.bible.manage')));
drop policy if exists bible_programs_update on public.bible_programs;
create policy bible_programs_update on public.bible_programs for update to authenticated
  using (public.church_has_permission(profile_id, 'church.bible.publish') or (status = 'draft' and public.church_has_permission(profile_id, 'church.bible.manage')))
  with check (public.church_has_permission(profile_id, 'church.bible.publish') or (status = 'draft' and public.church_has_permission(profile_id, 'church.bible.manage')));
drop policy if exists bible_programs_delete on public.bible_programs;
create policy bible_programs_delete on public.bible_programs for delete to authenticated
  using (public.church_has_permission(profile_id, 'church.bible.publish') or (status = 'draft' and public.church_has_permission(profile_id, 'church.bible.manage')));

drop policy if exists bible_programs_no_platform_admin_insert on public.bible_programs;
create policy bible_programs_no_platform_admin_insert on public.bible_programs as restrictive for insert to authenticated
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists bible_programs_no_platform_admin_update on public.bible_programs;
create policy bible_programs_no_platform_admin_update on public.bible_programs as restrictive for update to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id))
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists bible_programs_no_platform_admin_delete on public.bible_programs;
create policy bible_programs_no_platform_admin_delete on public.bible_programs as restrictive for delete to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id));

-- bible_program_sessions
drop policy if exists bible_program_sessions_staff_select on public.bible_program_sessions;
create policy bible_program_sessions_staff_select on public.bible_program_sessions for select to authenticated
  using (public.church_has_permission(profile_id, 'church.bible.view') or public.church_has_permission(profile_id, 'church.bible.manage') or public.church_has_permission(profile_id, 'church.bible.publish'));

-- the sessions of a PUBLISHED program of a published profile are the public reading plan
drop policy if exists bible_program_sessions_public_select on public.bible_program_sessions;
create policy bible_program_sessions_public_select on public.bible_program_sessions for select to anon, authenticated
  using (exists (select 1 from public.bible_programs bp join public.profiles pr on pr.id = bp.profile_id
                  where bp.id = program_id and bp.profile_id = bible_program_sessions.profile_id and bp.status = 'published' and pr.published = true));

drop policy if exists bible_program_sessions_insert on public.bible_program_sessions;
create policy bible_program_sessions_insert on public.bible_program_sessions for insert to authenticated
  with check (public.church_has_permission(profile_id, 'church.bible.publish') or (public.church_has_permission(profile_id, 'church.bible.manage') and exists (select 1 from public.bible_programs bp where bp.id = program_id and bp.profile_id = bible_program_sessions.profile_id and bp.status = 'draft')));
drop policy if exists bible_program_sessions_update on public.bible_program_sessions;
create policy bible_program_sessions_update on public.bible_program_sessions for update to authenticated
  using (public.church_has_permission(profile_id, 'church.bible.publish') or (public.church_has_permission(profile_id, 'church.bible.manage') and exists (select 1 from public.bible_programs bp where bp.id = program_id and bp.profile_id = bible_program_sessions.profile_id and bp.status = 'draft')))
  with check (public.church_has_permission(profile_id, 'church.bible.publish') or (public.church_has_permission(profile_id, 'church.bible.manage') and exists (select 1 from public.bible_programs bp where bp.id = program_id and bp.profile_id = bible_program_sessions.profile_id and bp.status = 'draft')));
drop policy if exists bible_program_sessions_delete on public.bible_program_sessions;
create policy bible_program_sessions_delete on public.bible_program_sessions for delete to authenticated
  using (public.church_has_permission(profile_id, 'church.bible.publish') or (public.church_has_permission(profile_id, 'church.bible.manage') and exists (select 1 from public.bible_programs bp where bp.id = program_id and bp.profile_id = bible_program_sessions.profile_id and bp.status = 'draft')));

drop policy if exists bible_program_sessions_no_platform_admin_insert on public.bible_program_sessions;
create policy bible_program_sessions_no_platform_admin_insert on public.bible_program_sessions as restrictive for insert to authenticated
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists bible_program_sessions_no_platform_admin_update on public.bible_program_sessions;
create policy bible_program_sessions_no_platform_admin_update on public.bible_program_sessions as restrictive for update to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id))
  with check (not public.is_admin() or public.church_is_owner(profile_id));
drop policy if exists bible_program_sessions_no_platform_admin_delete on public.bible_program_sessions;
create policy bible_program_sessions_no_platform_admin_delete on public.bible_program_sessions as restrictive for delete to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id));

-- bible_enrollments and bible_session_progress: row-level security is ON and there is deliberately NO policy and NO privilege for anon / authenticated.

-- ----------------------------------------------------------------------------
-- 4. POSTCONDITIONS (any failure rolls the whole file back)
-- ----------------------------------------------------------------------------
do $$
declare
  v_pre jsonb := current_setting('bible_programs.pre')::jsonb;
  v_marker constant text := 'managed by 2026-12-30_bible_programs.sql';
  v_t text;
  v_k text;
  v_n int;
  v_bad text;
begin
  foreach v_t in array array['bible_programs', 'bible_program_sessions', 'bible_enrollments', 'bible_session_progress'] loop
    if coalesce(obj_description(to_regclass('public.' || v_t), 'pg_class'), '') <> v_marker then raise exception 'postcondition failed: table marker on %', v_t; end if;
    if not (select relrowsecurity from pg_class where oid = to_regclass('public.' || v_t)) then raise exception 'postcondition failed: row-level security is off on %', v_t; end if;
    foreach v_k in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege('public', 'public.' || v_t, v_k) then raise exception 'postcondition failed: PUBLIC has % on %', v_k, v_t; end if;
      if has_table_privilege('anon', 'public.' || v_t, v_k) then raise exception 'postcondition failed: anon has a TABLE-level % on % (column SELECT only on the two content tables)', v_k, v_t; end if;
    end loop;
    if has_table_privilege('authenticated', 'public.' || v_t, 'truncate') or has_table_privilege('authenticated', 'public.' || v_t, 'references') or has_table_privilege('authenticated', 'public.' || v_t, 'trigger') then
      raise exception 'postcondition failed: authenticated can truncate, reference or trigger %', v_t;
    end if;
    select count(*) into v_n from pg_policy where polrelid = to_regclass('public.' || v_t) and polroles = array[0::oid];
    if v_n <> 0 then raise exception 'postcondition failed: a policy of % applies to PUBLIC', v_t; end if;
    select count(*) into v_n from pg_trigger where tgrelid = to_regclass('public.' || v_t) and not tgisinternal and tgname = v_t || '_guard_trg';
    if v_n <> 1 then raise exception 'postcondition failed: guard trigger on %', v_t; end if;
  end loop;

  -- the two content tables: audit columns out of reach, anon can read content and cannot write
  foreach v_t in array array['bible_programs', 'bible_program_sessions'] loop
    select string_agg(r || '.' || c || '.' || k, ', ') into v_bad
      from unnest(array['anon', 'authenticated']) r, unnest(array['created_by', 'updated_by', 'published_by']) c, unnest(array['select', 'insert', 'update']) k
     where exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.' || v_t) and a.attname = c and not a.attisdropped) and has_column_privilege(r, 'public.' || v_t, c, k);
    if v_bad is not null then raise exception 'postcondition failed: audit column reachable on %: %', v_t, v_bad; end if;
    if has_any_column_privilege('anon', 'public.' || v_t, 'insert') or has_any_column_privilege('anon', 'public.' || v_t, 'update') then raise exception 'postcondition failed: anon can write %', v_t; end if;
    if not has_column_privilege('anon', 'public.' || v_t, 'title_en', 'select') then raise exception 'postcondition failed: anon cannot read the public columns of %', v_t; end if;
    if has_column_privilege('authenticated', 'public.' || v_t, 'profile_id', 'update') then raise exception 'postcondition failed: profile_id is updatable on %', v_t; end if;
    select count(*) into v_n from pg_policy where polrelid = to_regclass('public.' || v_t) and polpermissive;
    if v_n <> 5 then raise exception 'postcondition failed: expected 5 permissive policies on %, found %', v_t, v_n; end if;
    select count(*) into v_n from pg_policy where polrelid = to_regclass('public.' || v_t) and not polpermissive;
    if v_n <> 3 then raise exception 'postcondition failed: expected 3 restrictive policies on %, found %', v_t, v_n; end if;
  end loop;

  -- the two private tables: not a single policy, not a single privilege for an API role
  foreach v_t in array array['bible_enrollments', 'bible_session_progress'] loop
    select count(*) into v_n from pg_policy where polrelid = to_regclass('public.' || v_t);
    if v_n <> 0 then raise exception 'postcondition failed: % must have no policy at all', v_t; end if;
    foreach v_k in array array['select', 'insert', 'update', 'delete'] loop
      if has_table_privilege('authenticated', 'public.' || v_t, v_k) or (v_k <> 'delete' and (has_any_column_privilege('authenticated', 'public.' || v_t, v_k) or has_any_column_privilege('anon', 'public.' || v_t, v_k))) then
        raise exception 'postcondition failed: an API role has % on %', v_k, v_t;
      end if;
    end loop;
    if not has_table_privilege('service_role', 'public.' || v_t, 'select') then raise exception 'postcondition failed: service_role cannot reach %', v_t; end if;
  end loop;

  -- the functions: the stats and the move are callable by signed-in users only; the guards by nobody
  foreach v_t in array array['bible_program_stats(uuid)', 'bible_session_move(uuid, text)'] loop
    if has_function_privilege('anon', 'public.' || v_t, 'execute') or has_function_privilege('public', 'public.' || v_t, 'execute') then raise exception 'postcondition failed: % is callable by anon or PUBLIC', v_t; end if;
    if not has_function_privilege('authenticated', 'public.' || v_t, 'execute') then raise exception 'postcondition failed: % is not callable by signed-in users', v_t; end if;
  end loop;
  foreach v_t in array array['bible_program_guard()', 'bible_session_guard()', 'bible_enrollment_guard()', 'bible_progress_guard()'] loop
    if has_function_privilege('anon', 'public.' || v_t, 'execute') or has_function_privilege('authenticated', 'public.' || v_t, 'execute') or has_function_privilege('public', 'public.' || v_t, 'execute') then raise exception 'postcondition failed: the guard % is callable', v_t; end if;
  end loop;

  select count(*) into v_n from pg_constraint where conname in ('bible_program_sessions_program_fk', 'bible_enrollments_program_fk', 'bible_session_progress_enrollment_fk', 'bible_session_progress_session_fk', 'bible_enrollments_program_customer_key', 'bible_session_progress_enrollment_session_key', 'bible_program_sessions_position_key') and convalidated;
  if v_n <> 7 then raise exception 'postcondition failed: expected the 7 keys of the Bible tables, found %', v_n; end if;

  -- nothing existing changed
  if (select count(*) from public.profiles) <> (v_pre->>'profiles')::bigint or (select count(*) from public.users) <> (v_pre->>'users')::bigint
     or (select count(*) from public.ringo_customers) <> (v_pre->>'customers')::bigint
     or (select count(*) from public.organization_roles) <> (v_pre->>'org_roles')::bigint or (select count(*) from public.organization_members) <> (v_pre->>'org_members')::bigint then
    raise exception 'postcondition failed: a row count of an existing table changed';
  end if;
  if (select coalesce(jsonb_agg(p.polname order by p.polrelid::regclass::text, p.polname), '[]'::jsonb)
        from pg_policy p where p.polrelid in ('public.profiles'::regclass, 'public.organization_roles'::regclass, 'public.organization_members'::regclass, 'public.ringo_customers'::regclass,
                                               'public.church_members'::regclass, 'public.church_groups'::regclass, 'public.church_group_members'::regclass, 'public.church_leadership'::regclass)
                           or p.polrelid = to_regclass('public.daily_words') or p.polrelid = to_regclass('public.ministry_events') or p.polrelid = to_regclass('public.ministry_announcements')) is distinct from v_pre->'policies' then
    raise exception 'postcondition failed: a policy of an existing table changed';
  end if;
  if (select jsonb_object_agg(f.proname, md5(pg_get_functiondef(f.oid)))
        from pg_proc f where f.pronamespace = 'public'::regnamespace
         and (f.proname like 'church\_%' or f.proname like 'team\_church\_%' or f.proname like 'daily\_word%' or f.proname like 'ministry\_%' or f.proname in ('is_admin', 'has_org_permission', 'is_org_member', 'is_church_profile'))) is distinct from v_pre->'fn_defs' then
    raise exception 'postcondition failed: an existing function changed';
  end if;
end $$;

commit;
