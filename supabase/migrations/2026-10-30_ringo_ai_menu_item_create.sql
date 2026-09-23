-- Ringo AI — Phase 4, increment 1: menu_item.create drafts.
-- Run this once in the Supabase SQL editor, AFTER 2026-10-29_ringo_ai_content_actions.sql.
--
-- Adds the ability to PREPARE a draft for a NEW restaurant menu item inside
-- an EXISTING menu category. Same posture as every prior Ringo AI
-- migration: Ringo AI only ever prepares; the owner's own "Confirm & Apply"
-- click applies it, through their own Supabase session (the existing
-- "menu_items owner write" RLS policy stays the authorization boundary).
--
-- Purely additive: widens the ai_drafts.draft_type CHECK (looked up by its
-- real name, not assumed) to also allow 'menu_item.create', and adds ONE
-- new SECURITY INVOKER function, ai_create_menu_item, mirroring
-- ai_create_product_within_limit's owner-checked-insert shape (2026-10-27_
-- ringo_ai_drafts.sql) — minus the advisory lock / plan-limit check, since
-- there is no plan limit on menu items today (unlike products). Touches no
-- existing row, no existing draft type's behaviour, no menu_categories row,
-- and no order/payment table. Rollback:
-- supabase/support/2026-10-30_ringo_ai_menu_item_create.rollback.sql.

-- ============================================================================
-- 1. WIDEN draft_type — looked up by its real name, not assumed.
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
    check (draft_type in (
      'profile.update', 'product.create', 'event.create', 'product.update',
      'event.update', 'track.update', 'menu_item.update', 'menu_item.create'
    ));
end $$;

-- ============================================================================
-- 2. INSERT — atomic owner-checked create, run AS THE OWNER (SECURITY INVOKER)
-- ============================================================================
-- outcome: 'inserted' | 'already_exists' (retry: this id is already this
--          page's menu item) | 'category_not_found' (deleted or never
--          belonged to this profile) | 'not_owner'
create or replace function public.ai_create_menu_item(
  p_id uuid,
  p_profile_id uuid,
  p_menu_category_id uuid,
  p_name text,
  p_description text,
  p_price numeric,
  p_available boolean,
  p_featured boolean,
  p_prep_time_minutes int
)
returns table (outcome text, menu_item_id uuid)
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owned boolean;
  v_count int;
begin
  if v_uid is null or p_id is null or p_profile_id is null or p_menu_category_id is null
     or p_name is null or btrim(p_name) = '' or p_available is null or p_featured is null then
    raise exception 'ai_create_menu_item: invalid arguments' using errcode = '22023';
  end if;

  -- Owner only (RLS also applies to every statement below).
  select true into v_owned from public.profiles p where p.id = p_profile_id and p.user_id = v_uid;
  if v_owned is null then
    return query select 'not_owner'::text, null::uuid;
    return;
  end if;

  -- Idempotent retry: the draft's pre-assigned id already exists on this page.
  if exists (select 1 from public.menu_items where id = p_id and profile_id = p_profile_id) then
    return query select 'already_exists'::text, p_id;
    return;
  end if;

  if not exists (select 1 from public.menu_categories c where c.id = p_menu_category_id and c.profile_id = p_profile_id) then
    return query select 'category_not_found'::text, null::uuid;
    return;
  end if;

  select count(*)::int into v_count from public.menu_items where menu_category_id = p_menu_category_id;

  insert into public.menu_items (id, profile_id, menu_category_id, name, description, price, available, featured, prep_time_minutes, sort_order)
  values (p_id, p_profile_id, p_menu_category_id, p_name, p_description, coalesce(p_price, 0), p_available, p_featured, p_prep_time_minutes, v_count);

  return query select 'inserted'::text, p_id;
end;
$$;

-- Callable by the signed-in owner's session (that's the point: RLS applies),
-- never anonymously.
revoke all on function public.ai_create_menu_item(uuid, uuid, uuid, text, text, numeric, boolean, boolean, int) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ai_create_menu_item(uuid, uuid, uuid, text, text, numeric, boolean, boolean, int) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.ai_create_menu_item(uuid, uuid, uuid, text, text, numeric, boolean, boolean, int) to authenticated';
  end if;
end $$;
