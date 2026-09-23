-- Ringo AI — Phase 3, increment 2: event/track/menu item update drafts.
-- Run this once in the Supabase SQL editor, AFTER 2026-10-28_ringo_ai_product_update.sql.
--
-- Adds the ability to PREPARE a draft edit of an EXISTING event, music
-- track or restaurant menu item. Same posture as every prior Ringo AI
-- migration: Ringo AI only ever prepares; the owner's own "Confirm & Apply"
-- click applies it, through their own Supabase session (the existing
-- "events owner write" / "tracks owner write" / "menu_items owner write"
-- RLS policies stay the authorization boundary).
--
-- Purely additive:
--   1. Two new nullable columns: events.description, tracks.description.
--   2. Widens the ai_drafts.draft_type CHECK (looked up by its real name,
--      not assumed) to also allow 'event.update', 'track.update',
--      'menu_item.update' — the documented, intended extension path for
--      that constraint.
--   3. Three new SECURITY INVOKER functions, mirroring
--      ai_apply_product_update exactly (row-locked, owner-checked,
--      compare-and-set against a captured base).
-- Touches no existing row, no existing draft type's behaviour, and no
-- order/payment table. Rollback:
-- supabase/support/2026-10-29_ringo_ai_content_actions.rollback.sql.

-- ============================================================================
-- 1. NEW COLUMNS — additive, nullable, no default-value backfill needed.
-- ============================================================================
alter table public.events add column if not exists description text;
alter table public.tracks add column if not exists description text;

-- ============================================================================
-- 2. WIDEN draft_type — looked up by its real name, not assumed.
-- ============================================================================
do $$
declare
  v_conname text;
begin
  select con.conname into v_conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'public' and rel.relname = 'ai_drafts' and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%draft_type%';

  if v_conname is null then
    raise exception 'ai_drafts: could not find the draft_type CHECK constraint — inspect the table before proceeding';
  end if;

  execute format('alter table public.ai_drafts drop constraint %I', v_conname);
  alter table public.ai_drafts
    add constraint ai_drafts_draft_type_check
    check (draft_type in ('profile.update', 'product.create', 'event.create', 'product.update', 'event.update', 'track.update', 'menu_item.update'));
end $$;

-- ============================================================================
-- 3. APPLY WRITES — atomic compare-and-set, run AS THE OWNER (SECURITY INVOKER)
-- ============================================================================
-- Each mirrors ai_apply_product_update (2026-10-28_ringo_ai_product_update.sql):
--   * every patched column already equals the patch → 'already_applied';
--   * any base column differs from the row now → 'stale', nothing written;
--   * the row doesn't exist / isn't owned by this caller → 'not_found';
--   * otherwise updates only the whitelisted columns → 'updated'.

-- 3a. event.update — title, description, event_date, event_time, location,
-- price. price is ambiguous once an event has tiered ticket types (which
-- tier?) — refused atomically, in the SAME transaction as the read that
-- decides it, so this can never race with a tier being added mid-flight.
-- outcome: 'updated' | 'already_applied' | 'stale' | 'not_found' | 'price_locked'
create or replace function public.ai_apply_event_update(
  p_event_id uuid,
  p_profile_id uuid,
  p_patch jsonb,
  p_base jsonb
)
returns text
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_allowed constant text[] := array['title', 'description', 'event_date', 'event_time', 'location', 'price'];
  v_row public.events%rowtype;
  v_now jsonb;
  k text;
begin
  if v_uid is null or p_event_id is null or p_profile_id is null
     or p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
     or p_base is null or jsonb_typeof(p_base) <> 'object' then
    raise exception 'ai_apply_event_update: invalid arguments' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) key where key <> all (v_allowed))
     or exists (select 1 from jsonb_object_keys(p_base) key where key <> all (v_allowed)) then
    raise exception 'ai_apply_event_update: column not allowed' using errcode = '42501';
  end if;

  select e.* into v_row
    from public.events e
    join public.profiles pr on pr.id = e.profile_id
   where e.id = p_event_id and e.profile_id = p_profile_id and pr.user_id = v_uid
   for update;
  if not found then
    return 'not_found';
  end if;

  if p_patch ? 'price' and exists (select 1 from public.event_ticket_types ett where ett.event_id = v_row.id) then
    return 'price_locked';
  end if;

  v_now := to_jsonb(v_row);
  if not exists (select 1 from jsonb_object_keys(p_patch) key where (v_now -> key) is distinct from (p_patch -> key)) then
    return 'already_applied';
  end if;
  for k in select jsonb_object_keys(p_base) loop
    if (v_now -> k) is distinct from (p_base -> k) then
      return 'stale';
    end if;
  end loop;

  update public.events e
     set title = x.title,
         description = x.description,
         event_date = x.event_date,
         event_time = x.event_time,
         location = x.location,
         price = x.price
    from jsonb_populate_record(v_row, p_patch) x
   where e.id = v_row.id and e.profile_id = p_profile_id;
  if not found then
    return 'not_found';
  end if;
  return 'updated';
end;
$$;

-- 3b. track.update — title, description, price. price is meaningless once a
-- track belongs to a release (release_id set) — refused atomically.
-- outcome: 'updated' | 'already_applied' | 'stale' | 'not_found' | 'release_locked'
create or replace function public.ai_apply_track_update(
  p_track_id uuid,
  p_profile_id uuid,
  p_patch jsonb,
  p_base jsonb
)
returns text
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_allowed constant text[] := array['title', 'description', 'price'];
  v_row public.tracks%rowtype;
  v_now jsonb;
  k text;
begin
  if v_uid is null or p_track_id is null or p_profile_id is null
     or p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
     or p_base is null or jsonb_typeof(p_base) <> 'object' then
    raise exception 'ai_apply_track_update: invalid arguments' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) key where key <> all (v_allowed))
     or exists (select 1 from jsonb_object_keys(p_base) key where key <> all (v_allowed)) then
    raise exception 'ai_apply_track_update: column not allowed' using errcode = '42501';
  end if;

  select t.* into v_row
    from public.tracks t
    join public.profiles pr on pr.id = t.profile_id
   where t.id = p_track_id and t.profile_id = p_profile_id and pr.user_id = v_uid
   for update;
  if not found then
    return 'not_found';
  end if;

  if p_patch ? 'price' and v_row.release_id is not null then
    return 'release_locked';
  end if;

  v_now := to_jsonb(v_row);
  if not exists (select 1 from jsonb_object_keys(p_patch) key where (v_now -> key) is distinct from (p_patch -> key)) then
    return 'already_applied';
  end if;
  for k in select jsonb_object_keys(p_base) loop
    if (v_now -> k) is distinct from (p_base -> k) then
      return 'stale';
    end if;
  end loop;

  update public.tracks t
     set title = x.title,
         description = x.description,
         price = x.price
    from jsonb_populate_record(v_row, p_patch) x
   where t.id = v_row.id and t.profile_id = p_profile_id;
  if not found then
    return 'not_found';
  end if;
  return 'updated';
end;
$$;

-- 3c. menu_item.update — name, description, price, available, featured,
-- prep_time_minutes. Never image_url/image_urls (gallery stays
-- Dashboard-only) or menu_category_id.
-- outcome: 'updated' | 'already_applied' | 'stale' | 'not_found'
create or replace function public.ai_apply_menu_item_update(
  p_menu_item_id uuid,
  p_profile_id uuid,
  p_patch jsonb,
  p_base jsonb
)
returns text
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_allowed constant text[] := array['name', 'description', 'price', 'available', 'featured', 'prep_time_minutes'];
  v_row public.menu_items%rowtype;
  v_now jsonb;
  k text;
begin
  if v_uid is null or p_menu_item_id is null or p_profile_id is null
     or p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
     or p_base is null or jsonb_typeof(p_base) <> 'object' then
    raise exception 'ai_apply_menu_item_update: invalid arguments' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) key where key <> all (v_allowed))
     or exists (select 1 from jsonb_object_keys(p_base) key where key <> all (v_allowed)) then
    raise exception 'ai_apply_menu_item_update: column not allowed' using errcode = '42501';
  end if;

  select m.* into v_row
    from public.menu_items m
    join public.profiles pr on pr.id = m.profile_id
   where m.id = p_menu_item_id and m.profile_id = p_profile_id and pr.user_id = v_uid
   for update;
  if not found then
    return 'not_found';
  end if;

  v_now := to_jsonb(v_row);
  if not exists (select 1 from jsonb_object_keys(p_patch) key where (v_now -> key) is distinct from (p_patch -> key)) then
    return 'already_applied';
  end if;
  for k in select jsonb_object_keys(p_base) loop
    if (v_now -> k) is distinct from (p_base -> k) then
      return 'stale';
    end if;
  end loop;

  update public.menu_items m
     set name = x.name,
         description = x.description,
         price = x.price,
         available = x.available,
         featured = x.featured,
         prep_time_minutes = x.prep_time_minutes
    from jsonb_populate_record(v_row, p_patch) x
   where m.id = v_row.id and m.profile_id = p_profile_id;
  if not found then
    return 'not_found';
  end if;
  return 'updated';
end;
$$;

-- Callable by the signed-in owner's session (RLS applies), never anonymously.
revoke all on function public.ai_apply_event_update(uuid, uuid, jsonb, jsonb) from public;
revoke all on function public.ai_apply_track_update(uuid, uuid, jsonb, jsonb) from public;
revoke all on function public.ai_apply_menu_item_update(uuid, uuid, jsonb, jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ai_apply_event_update(uuid, uuid, jsonb, jsonb) from anon';
    execute 'revoke all on function public.ai_apply_track_update(uuid, uuid, jsonb, jsonb) from anon';
    execute 'revoke all on function public.ai_apply_menu_item_update(uuid, uuid, jsonb, jsonb) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.ai_apply_event_update(uuid, uuid, jsonb, jsonb) to authenticated';
    execute 'grant execute on function public.ai_apply_track_update(uuid, uuid, jsonb, jsonb) to authenticated';
    execute 'grant execute on function public.ai_apply_menu_item_update(uuid, uuid, jsonb, jsonb) to authenticated';
  end if;
end $$;
