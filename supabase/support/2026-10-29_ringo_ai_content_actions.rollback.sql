-- Rollback for 2026-10-29_ringo_ai_content_actions.sql.
-- Removes ONLY the objects that migration created. Nothing else is touched —
-- any event/track/menu item changes an owner already confirmed from a
-- draft are ordinary Ringo data and stay exactly as they are.
-- Any pending 'event.update'/'track.update'/'menu_item.update' drafts
-- become permanently un-appliable (their draft_type is no longer accepted)
-- — discard them first if possible.
-- The new events.description / tracks.description columns are left in
-- place (dropping a column the Dashboard or other code may have started
-- writing to would be destructive) — this rollback only removes the
-- draft_type CHECK entries and the three new apply functions.
--
-- IMPORTANT: run this only together with reverting the Phase 3 Increment 2
-- code; the deployed code's update_event_draft/update_track_draft/
-- update_menu_item_draft tools and apply path need these functions.

drop function if exists public.ai_apply_event_update(uuid, uuid, jsonb, jsonb);
drop function if exists public.ai_apply_track_update(uuid, uuid, jsonb, jsonb);
drop function if exists public.ai_apply_menu_item_update(uuid, uuid, jsonb, jsonb);

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
    check (draft_type in ('profile.update', 'product.create', 'event.create', 'product.update'));
end $$;
