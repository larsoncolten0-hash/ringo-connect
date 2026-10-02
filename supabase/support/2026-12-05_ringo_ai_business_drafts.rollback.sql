-- Rollback for 2026-12-05_ringo_ai_business_drafts.sql: restores the draft_type CHECK to the eight pre-Business-Toolkit draft types.
-- It REFUSES to run while any Business Toolkit draft row exists (it never deletes or edits a draft): discard or let them expire first, then delete those rows
-- deliberately if you really want to roll back.
do $$
declare
  v_conname text;
begin
  if exists (select 1 from public.ai_drafts where draft_type like 'bk.%') then
    raise exception 'ai_drafts still contains Business Toolkit drafts (draft_type like bk.%%); resolve them before rolling back';
  end if;
  select con.conname into v_conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'public' and rel.relname = 'ai_drafts' and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%draft_type%';
  if v_conname is null then raise exception 'ai_drafts: could not find the draft_type CHECK constraint'; end if;
  execute format('alter table public.ai_drafts drop constraint %I', v_conname);
  alter table public.ai_drafts
    add constraint ai_drafts_draft_type_check
    check (draft_type in (
      'profile.update', 'product.create', 'event.create', 'product.update',
      'event.update', 'track.update', 'menu_item.update', 'menu_item.create'
    ));
end $$;
