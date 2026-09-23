-- Rollback for 2026-10-30_ringo_ai_menu_item_create.sql.
-- Removes ONLY the objects that migration created. Nothing else is touched —
-- any menu item an owner already confirmed from a menu_item.create draft is
-- ordinary Ringo data and stays exactly as it is.
-- Any pending 'menu_item.create' drafts become permanently un-appliable
-- (their draft_type is no longer accepted) — discard them first if possible.
--
-- IMPORTANT: run this only together with reverting the Phase 4 Increment 1
-- code; the deployed code's create_menu_item_draft tool and apply path
-- need this function.

drop function if exists public.ai_create_menu_item(uuid, uuid, uuid, text, text, numeric, boolean, boolean, int);

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

  if v_conname is not null then
    execute format('alter table public.ai_drafts drop constraint %I', v_conname);
  end if;

  alter table public.ai_drafts
    add constraint ai_drafts_draft_type_check
    check (draft_type in (
      'profile.update', 'product.create', 'event.create', 'product.update',
      'event.update', 'track.update', 'menu_item.update'
    ));
end $$;
