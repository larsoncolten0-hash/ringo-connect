-- Rollback for 2026-12-06_record_sale_receipts_branding.sql. It restores the Phase 2/3 definitions it replaced and removes what it added.
-- It REFUSES to run (and changes nothing) while any of these exist, because removing the objects would orphan or misrender real records:
--   * a sale receipt (bk_documents.source_type = 'sale', voided ones included), or a customer link to one
--   * a document issued with template_version 2 (it was issued by the new code and carries branding, including a reference to an immutable logo copy, in its frozen snapshot)
--   * saved payment details (bk_business_profiles.payment_details is not null)
-- Bookkeeping entries and stock movements created by Record Sale are ordinary Phase 1 / Phase 4 rows and are never touched.
-- Resolve those deliberately first (this script never deletes or edits a document, entry or movement).
begin;

do $$
begin
  if exists (select 1 from bk_documents where source_type = 'sale') then
    raise exception 'sale receipts exist (bk_documents.source_type = sale); they must be resolved before rolling back';
  end if;
  if exists (select 1 from bk_documents where template_version >= 2) then
    raise exception 'documents issued with template version 2 exist; they must be resolved before rolling back';
  end if;
  if exists (select 1 from bk_business_profiles where payment_details is not null) then
    raise exception 'saved payment details exist (bk_business_profiles.payment_details); clear them before rolling back';
  end if;
end $$;

drop function if exists sale_void(uuid, uuid, uuid, text);
drop function if exists sale_record(uuid, uuid, text, jsonb, uuid, text, date, text, uuid);
drop function if exists doc_set_brand_logo(uuid, uuid, text, text, text);
drop function if exists doc_get_brand_asset(uuid, uuid);
drop function if exists doc_upsert_business_profile(uuid, uuid, text, text, text, text, text, text, text, text, int, text, int, jsonb);
drop function if exists bk_doc_clean_payment_details(jsonb);

-- the Phase 3 link guard: invoices only
create or replace function bk_document_customer_links_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'bk_document_customer_links: links are never deleted; unlink by clearing the customer'; end if;
  if tg_op = 'INSERT' then
    perform 1 from bk_documents d where d.id = new.document_id and d.profile_id = new.profile_id and d.doc_type = 'invoice';
    if not found then raise exception 'bk_document_customer_links: only an invoice of the same business can be linked'; end if;
    return new;
  end if;
  if new.document_id <> old.document_id or new.profile_id <> old.profile_id then
    raise exception 'bk_document_customer_links: only the customer may change';
  end if;
  return new;
end $$;

-- the Phase 2 seller snapshot and issue core (template version 1)
create or replace function bk_doc_seller_snapshot(p_profile_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
           'display_name', coalesce(bp.display_name, nullif(btrim(p.name), ''), p.username),
           'legal_name', bp.legal_name, 'address', bp.address, 'phone', bp.phone, 'email', bp.email,
           'tax_id', bp.tax_id, 'registration_no', bp.registration_no)
    from profiles p left join bk_business_profiles bp on bp.profile_id = p.id where p.id = p_profile_id
$$;

create or replace function bk_doc_issue_core(p_doc bk_documents, p_actor uuid, p_seller jsonb, p_type_snapshot jsonb, p_due date) returns bk_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_doc bk_documents := p_doc; v_today date; v_year int; v_seq int;
begin
  v_today := (now() at time zone 'Africa/Douala')::date;
  v_year := extract(year from v_today)::int;
  insert into bk_document_counters as c (profile_id, doc_type, year, last_number) values (v_doc.profile_id, v_doc.doc_type, v_year, 1)
    on conflict (profile_id, doc_type, year) do update set last_number = c.last_number + 1, updated_at = now()
    returning c.last_number into v_seq;
  v_doc.number_year := v_year;
  v_doc.number_seq := v_seq;
  v_doc.number := bk_doc_number(v_doc.doc_type, v_year, v_seq);
  v_doc.issue_date := v_today;
  v_doc.due_date := p_due;
  v_doc.seller_snapshot := p_seller;
  v_doc.type_snapshot := p_type_snapshot;
  v_doc.issued_at := now();
  v_doc.issued_by := p_actor;
  v_doc.status := 'issued';
  v_doc.template_version := 1;
  v_doc.content_hash := bk_doc_hash_of(v_doc);
  update bk_documents set status = v_doc.status, number = v_doc.number, number_year = v_doc.number_year, number_seq = v_doc.number_seq,
         issue_date = v_doc.issue_date, due_date = v_doc.due_date, seller_snapshot = v_doc.seller_snapshot, type_snapshot = v_doc.type_snapshot,
         issued_at = v_doc.issued_at, issued_by = v_doc.issued_by, template_version = v_doc.template_version, content_hash = v_doc.content_hash
   where id = v_doc.id returning * into v_doc;
  perform bk_doc_event(v_doc.id, v_doc.profile_id, 'issued', p_actor, jsonb_build_object('number', v_doc.number, 'type', v_doc.doc_type, 'total', v_doc.total));
  return v_doc;
end $$;

-- the original constraints
alter table bk_documents drop constraint if exists bk_documents_receipt_shape_check;
alter table bk_documents add constraint bk_documents_receipt_shape_check
  check (doc_type <> 'receipt' or (status in ('draft', 'issued', 'void') and parent_document_id is not null and amount_paid = 0 and due_date is null));
alter table bk_documents drop constraint if exists bk_documents_source_type_check;
alter table bk_documents add constraint bk_documents_source_type_check check (source_type is null or source_type = 'product_order');

alter table bk_business_profiles drop column if exists payment_details;

-- the logo copies (only reachable now that no v2 document exists; their guard blocks row updates and deletes, not dropping the table)
drop table if exists bk_brand_logo_current;
drop table if exists bk_brand_assets;
drop function if exists bk_brand_assets_guard();

commit;
