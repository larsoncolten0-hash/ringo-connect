-- Churches & Ministries Phase 3: public groups (Men, Women, Youths, Children), group photos, group-only announcements and the Pastors page — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Adds FOUR tables, ONE nullable column and three trigger functions. Nothing existing is changed: no existing column, constraint, policy, trigger or function is altered or replaced, and no row is read or written.
--
--   NEW  church_public_groups              the public face of a group: its kind (men | women | youths | children), the name and photo of its leader, a short description in English and French. It is a PRESENTATION
--                                          table: it holds no member, no count and no link a visitor can follow into the roster. roster_group_id is an optional link to the private roster group (staff-side only; it is
--                                          never granted to the public) so a later phase can address a group-only notice to that group's connected members.
--   NEW  church_group_photos               the photos of one public group (the slideshow). A photo of the CHILDREN group can carry no caption, so no child can be named publicly through it.
--   NEW  church_pastors                    one row per pastor: name, photo, a short word and a biography, in English and French.
--   NEW  church_about                      one row per church: vision and mission, in English and French (they belong to the church, not to one pastor).
--   NEW  ministry_announcements.public_group_id   an announcement addressed to ONE public group only (it appears on that group's page and not on the church-wide list).
--   NEW  functions church_phase3_guard(), church_group_photo_guard(), ministry_announcement_group_guard() and their triggers.
--
-- CHILDREN: the children group exists as a group only. It has an adult leader's name and photo, a description and photos without captions. No child's name, age, guardian or any roster row is reachable
-- from these tables, and the public (anon) role can read ONLY the columns granted below.
--
-- WHO MAY WRITE: public groups and their photos need church.groups.manage (the existing ordinary permission); pastors and the about text need church.pastors.manage (new; any church.* string the earlier
-- guards do not list is OWNER-ONLY to grant, so no earlier object changes); a group-only announcement is an ordinary announcement (church.events.*). A platform admin who does not own the church is refused.
-- WHO MAY READ: the public sees a row only while it is published AND its church page is published; staff see every row they may manage (people who write announcements also see the list of public groups, to choose an audience); nobody reads another church's rows.
--
-- SELF-VERIFYING, one transaction: preconditions first, postconditions last. Any RAISE rolls everything back. Re-runnable.
--
-- Depends on: 2026-12-27_church_people_groups.sql, 2026-12-29_ministry_events_announcements.sql, 2027-01-04_church_landing_images.sql.
-- Preflight (read-only, run BEFORE): supabase/support/2027-01-05_church_groups_pastors.preflight.sql
-- Verify    (read-only, run AFTER):  supabase/support/2027-01-05_church_groups_pastors.verify.sql
-- Rollback: supabase/support/2027-01-05_church_groups_pastors.rollback.sql (refuses to run while any row exists unless the loss is explicitly confirmed).

begin;

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS
-- ----------------------------------------------------------------------------
do $$
declare
  v_t text;
begin
  foreach v_t in array array['church_groups', 'ministry_announcements', 'profiles'] loop
    if to_regclass('public.' || v_t) is null then raise exception 'precondition failed: public.% does not exist (apply the earlier church migrations first)', v_t; end if;
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ministry_announcements' and column_name = 'image_url') then
    raise exception 'precondition failed: ministry_announcements.image_url is missing (apply 2027-01-04_church_landing_images.sql first)';
  end if;
  foreach v_t in array array['church_has_permission(uuid,text)', 'church_is_owner(uuid)', 'is_church_profile(uuid)', 'is_admin()'] loop
    if to_regprocedure('public.' || v_t) is null then raise exception 'precondition failed: function public.% is missing', v_t; end if;
  end loop;
  if not exists (select 1 from pg_roles where rolname = 'anon') or not exists (select 1 from pg_roles where rolname = 'authenticated') or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'precondition failed: the database roles anon, authenticated and service_role must exist';
  end if;
  -- unknown-state guard: none of the four tables exists (first run) or all four do (re-run)
  if (select count(*) from unnest(array['church_public_groups', 'church_group_photos', 'church_pastors', 'church_about']) t where to_regclass('public.' || t) is not null) not in (0, 4) then
    raise exception 'precondition failed: only some of this file''s tables exist (half-applied or foreign change)';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_phase3_guard', 'church_group_photo_guard', 'ministry_announcement_group_guard')
               and coalesce(obj_description(oid, 'pg_proc'), '') <> 'managed by 2027-01-05_church_groups_pastors.sql') then
    raise exception 'precondition failed: a function named like one of this file''s exists and is not managed by it';
  end if;
  perform set_config('church_phase3.pre', jsonb_build_object('announcements', (select count(*) from public.ministry_announcements), 'groups', (select count(*) from public.church_groups))::text, true);
end $$;

-- ----------------------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------------------
create table if not exists public.church_public_groups (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  leader_name text,
  leader_photo_url text,
  description_en text,
  description_fr text,
  roster_group_id uuid,
  is_published boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint church_public_groups_id_profile_key unique (id, profile_id),
  constraint church_public_groups_kind_key unique (profile_id, kind),
  constraint church_public_groups_roster_fk foreign key (roster_group_id, profile_id) references public.church_groups (id, profile_id) on delete set null (roster_group_id),
  constraint church_public_groups_kind_check check (kind in ('men', 'women', 'youths', 'children')),
  constraint church_public_groups_leader_name_check check (leader_name is null or char_length(btrim(leader_name)) between 1 and 80),
  constraint church_public_groups_leader_photo_check check (leader_photo_url is null or (char_length(leader_photo_url) between 12 and 500 and leader_photo_url ~ '^https://[^\s/@?#]+\.[^\s/@?#]+(/[^\s]*)?$')),
  constraint church_public_groups_description_en_check check (description_en is null or char_length(description_en) between 1 and 600),
  constraint church_public_groups_description_fr_check check (description_fr is null or char_length(description_fr) between 1 and 600)
);

create table if not exists public.church_group_photos (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  public_group_id uuid not null,
  image_url text not null,
  caption_en text,
  caption_fr text,
  sort_order integer not null default 0,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint church_group_photos_group_fk foreign key (public_group_id, profile_id) references public.church_public_groups (id, profile_id) on delete cascade,
  constraint church_group_photos_image_check check (char_length(image_url) between 12 and 500 and image_url ~ '^https://[^\s/@?#]+\.[^\s/@?#]+(/[^\s]*)?$'),
  constraint church_group_photos_caption_en_check check (caption_en is null or char_length(caption_en) between 1 and 160),
  constraint church_group_photos_caption_fr_check check (caption_fr is null or char_length(caption_fr) between 1 and 160),
  constraint church_group_photos_sort_check check (sort_order between 0 and 1000)
);
create index if not exists church_group_photos_group_idx on public.church_group_photos (public_group_id, sort_order, created_at);

create table if not exists public.church_pastors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  photo_url text,
  word_en text,
  word_fr text,
  bio_en text,
  bio_fr text,
  sort_order integer not null default 0,
  is_published boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint church_pastors_name_check check (char_length(btrim(name)) between 1 and 80),
  constraint church_pastors_photo_check check (photo_url is null or (char_length(photo_url) between 12 and 500 and photo_url ~ '^https://[^\s/@?#]+\.[^\s/@?#]+(/[^\s]*)?$')),
  constraint church_pastors_word_en_check check (word_en is null or char_length(word_en) between 1 and 300),
  constraint church_pastors_word_fr_check check (word_fr is null or char_length(word_fr) between 1 and 300),
  constraint church_pastors_bio_en_check check (bio_en is null or char_length(bio_en) between 1 and 3000),
  constraint church_pastors_bio_fr_check check (bio_fr is null or char_length(bio_fr) between 1 and 3000),
  constraint church_pastors_sort_check check (sort_order between 0 and 1000)
);
create index if not exists church_pastors_profile_idx on public.church_pastors (profile_id, sort_order, created_at);

create table if not exists public.church_about (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  vision_en text,
  vision_fr text,
  mission_en text,
  mission_fr text,
  is_published boolean not null default false,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint church_about_vision_en_check check (vision_en is null or char_length(vision_en) between 1 and 1500),
  constraint church_about_vision_fr_check check (vision_fr is null or char_length(vision_fr) between 1 and 1500),
  constraint church_about_mission_en_check check (mission_en is null or char_length(mission_en) between 1 and 1500),
  constraint church_about_mission_fr_check check (mission_fr is null or char_length(mission_fr) between 1 and 1500)
);

comment on table public.church_public_groups is 'managed by 2027-01-05_church_groups_pastors.sql';
comment on table public.church_group_photos is 'managed by 2027-01-05_church_groups_pastors.sql';
comment on table public.church_pastors is 'managed by 2027-01-05_church_groups_pastors.sql';
comment on table public.church_about is 'managed by 2027-01-05_church_groups_pastors.sql';

-- a notice addressed to one public group only
alter table public.ministry_announcements add column if not exists public_group_id uuid references public.church_public_groups(id) on delete cascade;
comment on column public.ministry_announcements.public_group_id is 'managed by 2027-01-05_church_groups_pastors.sql';
create index if not exists ministry_announcements_group_idx on public.ministry_announcements (public_group_id) where public_group_id is not null;

-- ----------------------------------------------------------------------------
-- 2. FUNCTIONS AND TRIGGERS
-- ----------------------------------------------------------------------------
-- Integrity and bookkeeping for the four tables (the service role included): rows only for a church profile, the church can never change, the audit columns come from the signed-in caller.
create or replace function public.church_phase3_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_church_profile(new.profile_id) then
      raise exception 'church_profile_required' using errcode = '23514', detail = 'rows can only be created for a profile with the Churches & Ministries category';
    end if;
    if tg_table_name = 'church_pastors' and (select count(*) from public.church_pastors p where p.profile_id = new.profile_id) >= 12 then
      raise exception 'church_pastor_limit' using errcode = '23514', detail = 'a church shows at most 12 pastors';
    end if;
    if auth.uid() is not null then
      if tg_table_name <> 'church_about' then new.created_by := auth.uid(); end if;
      if tg_table_name in ('church_public_groups', 'church_pastors', 'church_about') then new.updated_by := auth.uid(); end if;
    end if;
  else
    if new.profile_id is distinct from old.profile_id then
      raise exception 'church_tenant_immutable' using errcode = '42501', detail = 'a row can never be moved to another church';
    end if;
    if tg_table_name = 'church_public_groups' then
      if to_jsonb(new) ->> 'kind' is distinct from to_jsonb(old) ->> 'kind' then
        raise exception 'church_group_kind_immutable' using errcode = '23514', detail = 'the kind of a public group cannot change';
      end if;
    end if;
    if auth.uid() is not null then
      if tg_table_name <> 'church_about' then new.created_by := old.created_by; end if;
      if tg_table_name in ('church_public_groups', 'church_pastors', 'church_about') then new.updated_by := auth.uid(); end if;
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- Photos: at most 12 per group, and a photo of the CHILDREN group has no caption (a caption is how a child could be named).
create or replace function public.church_group_photo_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_kind text;
begin
  select g.kind into v_kind from public.church_public_groups g where g.id = new.public_group_id and g.profile_id = new.profile_id;
  if v_kind = 'children' and (new.caption_en is not null or new.caption_fr is not null) then
    raise exception 'church_children_photo_caption' using errcode = '23514', detail = 'a photo of the children group carries no caption';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.church_group_photos p where p.public_group_id = new.public_group_id) >= 12 then
    raise exception 'church_group_photo_limit' using errcode = '23514', detail = 'a group shows at most 12 photos';
  end if;
  return new;
end;
$$;

-- A group-only announcement must name a public group of THE SAME church.
create or replace function public.ministry_announcement_group_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.public_group_id is not null then
    if not exists (select 1 from public.church_public_groups g where g.id = new.public_group_id and g.profile_id = new.profile_id) then
      raise exception 'church_group_mismatch' using errcode = '23514', detail = 'the group belongs to another church';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.public_group_id is distinct from old.public_group_id and old.status = 'published' then
    raise exception 'church_group_locked' using errcode = '23514', detail = 'unpublish a notice before moving it to another audience';
  end if;
  return new;
end;
$$;

comment on function public.church_phase3_guard() is 'managed by 2027-01-05_church_groups_pastors.sql';
comment on function public.church_group_photo_guard() is 'managed by 2027-01-05_church_groups_pastors.sql';
comment on function public.ministry_announcement_group_guard() is 'managed by 2027-01-05_church_groups_pastors.sql';
revoke all on function public.church_phase3_guard() from public, anon, authenticated;
revoke all on function public.church_group_photo_guard() from public, anon, authenticated;
revoke all on function public.ministry_announcement_group_guard() from public, anon, authenticated;

drop trigger if exists church_public_groups_guard_trg on public.church_public_groups;
create trigger church_public_groups_guard_trg before insert or update on public.church_public_groups for each row execute function public.church_phase3_guard();
drop trigger if exists church_group_photos_guard_trg on public.church_group_photos;
create trigger church_group_photos_guard_trg before insert or update on public.church_group_photos for each row execute function public.church_phase3_guard();
drop trigger if exists church_group_photos_rules_trg on public.church_group_photos;
create trigger church_group_photos_rules_trg before insert or update on public.church_group_photos for each row execute function public.church_group_photo_guard();
drop trigger if exists church_pastors_guard_trg on public.church_pastors;
create trigger church_pastors_guard_trg before insert or update on public.church_pastors for each row execute function public.church_phase3_guard();
drop trigger if exists church_about_guard_trg on public.church_about;
create trigger church_about_guard_trg before insert or update on public.church_about for each row execute function public.church_phase3_guard();
drop trigger if exists ministry_announcements_group_trg on public.ministry_announcements;
create trigger ministry_announcements_group_trg before insert or update on public.ministry_announcements for each row execute function public.ministry_announcement_group_guard();
comment on trigger church_public_groups_guard_trg on public.church_public_groups is 'managed by 2027-01-05_church_groups_pastors.sql';
comment on trigger church_group_photos_guard_trg on public.church_group_photos is 'managed by 2027-01-05_church_groups_pastors.sql';
comment on trigger church_group_photos_rules_trg on public.church_group_photos is 'managed by 2027-01-05_church_groups_pastors.sql';
comment on trigger church_pastors_guard_trg on public.church_pastors is 'managed by 2027-01-05_church_groups_pastors.sql';
comment on trigger church_about_guard_trg on public.church_about is 'managed by 2027-01-05_church_groups_pastors.sql';
comment on trigger ministry_announcements_group_trg on public.ministry_announcements is 'managed by 2027-01-05_church_groups_pastors.sql';

-- ----------------------------------------------------------------------------
-- 3. ROW-LEVEL SECURITY AND PRIVILEGES
-- ----------------------------------------------------------------------------
alter table public.church_public_groups enable row level security;
alter table public.church_group_photos enable row level security;
alter table public.church_pastors enable row level security;
alter table public.church_about enable row level security;

revoke all on public.church_public_groups, public.church_group_photos, public.church_pastors, public.church_about from public, anon, authenticated;

-- READ: only the display columns (never the audit columns or the private roster link)
grant select (id, profile_id, kind, leader_name, leader_photo_url, description_en, description_fr, is_published, updated_at) on public.church_public_groups to anon, authenticated;
grant select (roster_group_id, created_at) on public.church_public_groups to authenticated;
grant select (id, profile_id, public_group_id, image_url, caption_en, caption_fr, sort_order, created_at, updated_at) on public.church_group_photos to anon, authenticated;
grant select (id, profile_id, name, photo_url, word_en, word_fr, bio_en, bio_fr, sort_order, is_published, created_at, updated_at) on public.church_pastors to anon, authenticated;
grant select (profile_id, vision_en, vision_fr, mission_en, mission_fr, is_published, updated_at) on public.church_about to anon, authenticated;
-- WRITE (signed-in only; the policies decide which rows)
grant insert (id, profile_id, kind, leader_name, leader_photo_url, description_en, description_fr, roster_group_id, is_published), update (leader_name, leader_photo_url, description_en, description_fr, roster_group_id, is_published), delete on public.church_public_groups to authenticated;
grant insert (id, profile_id, public_group_id, image_url, caption_en, caption_fr, sort_order), update (image_url, caption_en, caption_fr, sort_order), delete on public.church_group_photos to authenticated;
grant insert (id, profile_id, name, photo_url, word_en, word_fr, bio_en, bio_fr, sort_order, is_published), update (name, photo_url, word_en, word_fr, bio_en, bio_fr, sort_order, is_published), delete on public.church_pastors to authenticated;
grant insert (profile_id, vision_en, vision_fr, mission_en, mission_fr, is_published), update (vision_en, vision_fr, mission_en, mission_fr, is_published) on public.church_about to authenticated;
grant all on public.church_public_groups, public.church_group_photos, public.church_pastors, public.church_about to service_role;

-- announcements: the new column
grant select (public_group_id) on public.ministry_announcements to anon, authenticated;
grant insert (public_group_id), update (public_group_id) on public.ministry_announcements to authenticated;

-- church_public_groups
drop policy if exists church_public_groups_public_select on public.church_public_groups;
create policy church_public_groups_public_select on public.church_public_groups for select to anon, authenticated
  using (is_published = true and exists (select 1 from public.profiles p where p.id = profile_id and p.published = true));
drop policy if exists church_public_groups_staff_select on public.church_public_groups;
create policy church_public_groups_staff_select on public.church_public_groups for select to authenticated
  using (public.church_has_permission(profile_id, 'church.groups.view') or public.church_has_permission(profile_id, 'church.groups.manage')
         or public.church_has_permission(profile_id, 'church.events.manage') or public.church_has_permission(profile_id, 'church.events.publish'));
drop policy if exists church_public_groups_insert on public.church_public_groups;
create policy church_public_groups_insert on public.church_public_groups for insert to authenticated with check (public.church_has_permission(profile_id, 'church.groups.manage'));
drop policy if exists church_public_groups_update on public.church_public_groups;
create policy church_public_groups_update on public.church_public_groups for update to authenticated
  using (public.church_has_permission(profile_id, 'church.groups.manage')) with check (public.church_has_permission(profile_id, 'church.groups.manage'));
drop policy if exists church_public_groups_delete on public.church_public_groups;
create policy church_public_groups_delete on public.church_public_groups for delete to authenticated using (public.church_has_permission(profile_id, 'church.groups.manage'));
drop policy if exists church_public_groups_no_platform_admin on public.church_public_groups;
create policy church_public_groups_no_platform_admin on public.church_public_groups as restrictive for all to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id)) with check (not public.is_admin() or public.church_is_owner(profile_id));

-- church_group_photos
drop policy if exists church_group_photos_public_select on public.church_group_photos;
create policy church_group_photos_public_select on public.church_group_photos for select to anon, authenticated
  using (exists (select 1 from public.church_public_groups g join public.profiles p on p.id = g.profile_id where g.id = public_group_id and g.is_published = true and p.published = true));
drop policy if exists church_group_photos_staff_select on public.church_group_photos;
create policy church_group_photos_staff_select on public.church_group_photos for select to authenticated
  using (public.church_has_permission(profile_id, 'church.groups.view') or public.church_has_permission(profile_id, 'church.groups.manage'));
drop policy if exists church_group_photos_insert on public.church_group_photos;
create policy church_group_photos_insert on public.church_group_photos for insert to authenticated with check (public.church_has_permission(profile_id, 'church.groups.manage'));
drop policy if exists church_group_photos_update on public.church_group_photos;
create policy church_group_photos_update on public.church_group_photos for update to authenticated
  using (public.church_has_permission(profile_id, 'church.groups.manage')) with check (public.church_has_permission(profile_id, 'church.groups.manage'));
drop policy if exists church_group_photos_delete on public.church_group_photos;
create policy church_group_photos_delete on public.church_group_photos for delete to authenticated using (public.church_has_permission(profile_id, 'church.groups.manage'));
drop policy if exists church_group_photos_no_platform_admin on public.church_group_photos;
create policy church_group_photos_no_platform_admin on public.church_group_photos as restrictive for all to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id)) with check (not public.is_admin() or public.church_is_owner(profile_id));

-- church_pastors
drop policy if exists church_pastors_public_select on public.church_pastors;
create policy church_pastors_public_select on public.church_pastors for select to anon, authenticated
  using (is_published = true and exists (select 1 from public.profiles p where p.id = profile_id and p.published = true));
drop policy if exists church_pastors_staff_select on public.church_pastors;
create policy church_pastors_staff_select on public.church_pastors for select to authenticated using (public.church_has_permission(profile_id, 'church.pastors.manage'));
drop policy if exists church_pastors_insert on public.church_pastors;
create policy church_pastors_insert on public.church_pastors for insert to authenticated with check (public.church_has_permission(profile_id, 'church.pastors.manage'));
drop policy if exists church_pastors_update on public.church_pastors;
create policy church_pastors_update on public.church_pastors for update to authenticated
  using (public.church_has_permission(profile_id, 'church.pastors.manage')) with check (public.church_has_permission(profile_id, 'church.pastors.manage'));
drop policy if exists church_pastors_delete on public.church_pastors;
create policy church_pastors_delete on public.church_pastors for delete to authenticated using (public.church_has_permission(profile_id, 'church.pastors.manage'));
drop policy if exists church_pastors_no_platform_admin on public.church_pastors;
create policy church_pastors_no_platform_admin on public.church_pastors as restrictive for all to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id)) with check (not public.is_admin() or public.church_is_owner(profile_id));

-- church_about
drop policy if exists church_about_public_select on public.church_about;
create policy church_about_public_select on public.church_about for select to anon, authenticated
  using (is_published = true and exists (select 1 from public.profiles p where p.id = profile_id and p.published = true));
drop policy if exists church_about_staff_select on public.church_about;
create policy church_about_staff_select on public.church_about for select to authenticated using (public.church_has_permission(profile_id, 'church.pastors.manage'));
drop policy if exists church_about_insert on public.church_about;
create policy church_about_insert on public.church_about for insert to authenticated with check (public.church_has_permission(profile_id, 'church.pastors.manage'));
drop policy if exists church_about_update on public.church_about;
create policy church_about_update on public.church_about for update to authenticated
  using (public.church_has_permission(profile_id, 'church.pastors.manage')) with check (public.church_has_permission(profile_id, 'church.pastors.manage'));
drop policy if exists church_about_no_platform_admin on public.church_about;
create policy church_about_no_platform_admin on public.church_about as restrictive for all to authenticated
  using (not public.is_admin() or public.church_is_owner(profile_id)) with check (not public.is_admin() or public.church_is_owner(profile_id));

-- ----------------------------------------------------------------------------
-- 4. POSTCONDITIONS (any failure rolls the whole file back)
-- ----------------------------------------------------------------------------
do $$
declare
  v_pre jsonb := current_setting('church_phase3.pre')::jsonb;
  v_t text;
  v_bad text;
begin
  foreach v_t in array array['church_public_groups', 'church_group_photos', 'church_pastors', 'church_about'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || v_t)::regclass) then raise exception 'postcondition failed: RLS is off on %', v_t; end if;
    if has_table_privilege('anon', 'public.' || v_t, 'insert') or has_table_privilege('anon', 'public.' || v_t, 'update') or has_table_privilege('anon', 'public.' || v_t, 'delete') or has_table_privilege('public', 'public.' || v_t, 'select') then
      raise exception 'postcondition failed: anon or PUBLIC has table-level rights on %', v_t;
    end if;
  end loop;
  -- the public cannot read the audit columns or the roster link
  if has_column_privilege('anon', 'public.church_public_groups', 'roster_group_id', 'select') or has_column_privilege('anon', 'public.church_public_groups', 'created_by', 'select')
     or has_column_privilege('anon', 'public.church_pastors', 'created_by', 'select') or has_column_privilege('anon', 'public.church_group_photos', 'created_by', 'select') then
    raise exception 'postcondition failed: anon can read an internal column';
  end if;
  if not has_column_privilege('anon', 'public.ministry_announcements', 'public_group_id', 'select') then raise exception 'postcondition failed: anon cannot read public_group_id'; end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgname in ('church_public_groups_guard_trg', 'church_group_photos_guard_trg', 'church_group_photos_rules_trg', 'church_pastors_guard_trg', 'church_about_guard_trg', 'ministry_announcements_group_trg')) <> 6 then
    raise exception 'postcondition failed: triggers';
  end if;
  foreach v_t in array array['church_phase3_guard()', 'church_group_photo_guard()', 'ministry_announcement_group_guard()'] loop
    if has_function_privilege('anon', 'public.' || v_t, 'execute') or has_function_privilege('authenticated', 'public.' || v_t, 'execute') or has_function_privilege('public', 'public.' || v_t, 'execute') then
      raise exception 'postcondition failed: % is callable by an API role', v_t;
    end if;
  end loop;
  -- no money, anywhere in the new tables
  select string_agg(c.table_name || '.' || c.column_name, ', ') into v_bad from information_schema.columns c
   where c.table_schema = 'public' and c.table_name in ('church_public_groups', 'church_group_photos', 'church_pastors', 'church_about') and c.column_name ~* '(amount|price|currency|money|fee|commission|payment|payout|refund|receipt|balance|phone|email|birth)';
  if v_bad is not null then raise exception 'postcondition failed: a money-like or personal column exists: %', v_bad; end if;
  -- nothing was written
  if (select count(*) from public.ministry_announcements) <> (v_pre->>'announcements')::bigint or (select count(*) from public.church_groups) <> (v_pre->>'groups')::bigint then
    raise exception 'postcondition failed: a row count changed';
  end if;
end $$;

commit;
