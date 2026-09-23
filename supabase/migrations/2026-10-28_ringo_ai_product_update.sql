-- Ringo AI — Phase 3, increment 1: product.update drafts.
-- Run this once in the Supabase SQL editor, AFTER 2026-10-27_ringo_ai_drafts.sql.
--
-- Adds the ability to PREPARE a draft edit of an EXISTING product (name,
-- description, price, cover image). Same posture as the rest of the draft
-- system: Ringo AI only ever prepares; the owner's own "Confirm & Apply"
-- click applies it, through their own Supabase session (RLS "products owner
-- write" stays the authorization boundary).
--
-- Purely additive: widens the ai_drafts.draft_type CHECK to also allow
-- 'product.update' (the documented, intended extension path for that
-- constraint — see registry.ts), and adds ONE new function
-- (ai_apply_product_update), mirroring ai_apply_profile_update exactly.
-- Touches no existing row, no existing draft type's behaviour, and no other
-- table, column, trigger or policy. Rollback:
-- supabase/support/2026-10-28_ringo_ai_product_update.rollback.sql.

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
    check (draft_type in ('profile.update', 'product.create', 'event.create', 'product.update'));
end $$;

-- ============================================================================
-- 2. APPLY WRITE — atomic compare-and-set, run AS THE OWNER (SECURITY INVOKER)
-- ============================================================================
-- Mirrors ai_apply_profile_update exactly (see 2026-10-27_ringo_ai_drafts.sql
-- for the full explanation of this pattern). The draft stored `base` = the
-- values of exactly the columns it changes, as they were when it was
-- prepared:
--   * every patched column already equals the patch → 'already_applied';
--   * any base column differs from the row now → 'stale', nothing written;
--   * the product doesn't exist / isn't owned by this caller → 'not_found';
--   * otherwise updates only the whitelisted columns → 'updated'.
-- Only these columns can be changed: name, description, price, image_url —
-- the same ones CatalogCard's saveAll() writes. Never image_urls (the
-- multi-photo gallery stays Dashboard-only).
create or replace function public.ai_apply_product_update(
  p_product_id uuid,
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
  v_allowed constant text[] := array['name', 'description', 'price', 'image_url'];
  v_row public.products%rowtype;
  v_now jsonb;
  k text;
begin
  if v_uid is null or p_product_id is null or p_profile_id is null
     or p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
     or p_base is null or jsonb_typeof(p_base) <> 'object' then
    raise exception 'ai_apply_product_update: invalid arguments' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) key where key <> all (v_allowed))
     or exists (select 1 from jsonb_object_keys(p_base) key where key <> all (v_allowed)) then
    raise exception 'ai_apply_product_update: column not allowed' using errcode = '42501';
  end if;

  select p.* into v_row
    from public.products p
    join public.profiles pr on pr.id = p.profile_id
   where p.id = p_product_id and p.profile_id = p_profile_id and pr.user_id = v_uid
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

  update public.products p
     set name = x.name,
         description = x.description,
         price = x.price,
         image_url = x.image_url
    from jsonb_populate_record(v_row, p_patch) x
   where p.id = v_row.id and p.profile_id = p_profile_id;
  if not found then
    return 'not_found';
  end if;
  return 'updated';
end;
$$;

-- Callable by the signed-in owner's session (RLS applies), never anonymously.
revoke all on function public.ai_apply_product_update(uuid, uuid, jsonb, jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ai_apply_product_update(uuid, uuid, jsonb, jsonb) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.ai_apply_product_update(uuid, uuid, jsonb, jsonb) to authenticated';
  end if;
end $$;
