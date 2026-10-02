-- Ringo AI x Business Toolkit, Phase B/C: Business Toolkit drafts.
-- Run this once in the Supabase SQL editor, AFTER 2026-10-30_ringo_ai_menu_item_create.sql (and the Business Toolkit migrations 2026-12-01 .. 2026-12-04
-- if you want the drafts to be applicable; the draft types themselves do not depend on them).
--
-- Ringo AI may PREPARE a Business Toolkit action (record a bookkeeping entry, create a DRAFT invoice, record a payment on an invoice, add a customer, adjust
-- stock); it never applies one. The owner's own "Confirm & Apply" click applies it, and applying calls the Business Toolkit's OWN server functions (the same
-- RPCs the Toolkit screens use) behind the Toolkit's access gate. This migration only teaches the existing ai_drafts table the five new draft types.
--
-- Purely additive: it widens the ai_drafts.draft_type CHECK (looked up by its real name, not assumed) to also allow
--   'bk.entry.create', 'bk.invoice.create', 'bk.invoice.payment', 'bk.customer.create', 'bk.stock.adjust'
-- and nothing else: no new table, no new column, no new function, no change to any existing row, to any existing draft type's behaviour, or to any Business
-- Toolkit table or function. Idempotent (safe to run twice). Rollback: supabase/support/2026-12-05_ringo_ai_business_drafts.rollback.sql.

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
      'event.update', 'track.update', 'menu_item.update', 'menu_item.create',
      'bk.entry.create', 'bk.invoice.create', 'bk.invoice.payment', 'bk.customer.create', 'bk.stock.adjust'
    ));
end $$;
