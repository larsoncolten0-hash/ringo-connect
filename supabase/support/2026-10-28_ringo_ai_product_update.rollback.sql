-- Rollback for 2026-10-28_ringo_ai_product_update.sql.
-- Removes ONLY the objects that migration created. Nothing else is touched —
-- any product changes an owner already confirmed from a product.update draft
-- are ordinary Ringo data and stay exactly as they are.
-- Any pending 'product.update' drafts become permanently un-appliable
-- (their draft_type is no longer accepted) — discard them first if possible.
--
-- IMPORTANT: run this only together with reverting the Phase 3 code; the
-- deployed code's update_product_draft tool and apply path need this
-- function, and the draft_type CHECK narrowed back here will reject any
-- 'product.update' row still awaiting confirmation.

drop function if exists public.ai_apply_product_update(uuid, uuid, jsonb, jsonb);

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
    check (draft_type in ('profile.update', 'product.create', 'event.create'));
end $$;
