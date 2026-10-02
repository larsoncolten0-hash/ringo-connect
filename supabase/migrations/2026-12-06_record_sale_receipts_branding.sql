-- Business Toolkit — Record Sale, standalone receipts, invoice branding and payment details — PROPOSED, NOT APPLIED.
-- Run this once in the Supabase SQL editor, AFTER 2026-12-01 .. 2026-12-05 (the Business Toolkit Phases 1-4). Rollback: supabase/support/2026-12-06_record_sale_receipts_branding.rollback.sql.
--
-- What it adds (nothing is duplicated: every write goes through the EXISTING tables and functions)
--   1. sale_record(...)  ONE atomic operation: validates the products, decrements TRACKED stock through the existing inv_adjust_stock (kind sold_elsewhere, so the
--      movement lands in the existing bk_stock_movements ledger), records ONE bookkeeping sale through the existing bk_record_entry, issues ONE standalone receipt
--      through the existing bk_doc_issue_core, and links the optional customer. All of it runs in a single transaction: any failure undoes all of it. It is
--      idempotent on client_request_id.
--   2. A standalone receipt: a receipt may now exist WITHOUT a parent invoice, but only when it is a "sale" receipt (source_type = 'sale', source_id = the one
--      bookkeeping entry it belongs to). The existing unique index on (profile, type, source_type, source_id) guarantees one receipt per sale. An invoice-payment
--      receipt is unchanged (it still requires its invoice).
--   3. bk_business_profiles.payment_details (jsonb, nullable): structured payment instructions (bank, account, mobile money, other) printed on invoices.
--      Free text stays in the existing default_terms. Nothing here reuses the ambassador payout destinations.
--   4. Branding on NEW documents: the seller snapshot frozen at issue now also carries the accent colour (profiles.theme_color), the payment details and a
--      reference to an IMMUTABLE copy of the logo (bk_brand_assets: the image bytes themselves, content-addressed and append-only), and NEW documents are stamped
--      template_version 2. The logo is never referenced by its live URL: replacing or deleting the profile picture, or the file behind it, cannot change an
--      issued document. Documents already issued keep template_version 1 and their frozen snapshot, so they render exactly as before.
--   5. sale_void(...)  voids a recorded sale ATOMICALLY: the receipt is marked void (never deleted), the bookkeeping sale is voided through the existing
--      bk_void_entry (never deleted, no new revenue), and the exact quantity the sale took from a still-tracked product is put back through the existing
--      inv_adjust_stock. All or nothing, idempotent, serialised per receipt.
--
-- What it changes in existing objects (all by CREATE OR REPLACE / constraint replacement; no existing row is modified)
--   * bk_documents: the receipt-shape CHECK and the source_type CHECK are replaced by the widened equivalents described above.
--   * bk_document_customer_links_guard(): additionally allows linking a sale receipt (invoices as before).
--   * bk_doc_issue_core(): identical to the Phase 2 body except that it stamps template_version 2 on the document it issues.
--   * bk_doc_seller_snapshot(): identical keys plus logo_asset_id, logo_sha256, accent_color, payment_details.
--   * doc_upsert_business_profile(): ONE new overload with a 14th argument (p_payment_details); the original 13-argument function is untouched.
-- New objects: tables bk_brand_assets (immutable logo copies) and bk_brand_logo_current (which copy is current for a business), functions doc_set_brand_logo,
-- doc_get_brand_asset, sale_record, sale_void. No table is dropped, no column is dropped, no existing row is changed, no RLS policy or grant on an existing object is changed.
-- Idempotent: safe to run twice. Whole file is one transaction.

begin;

-- ============================================================================
-- 0. DEPENDENCY CHECK
-- ============================================================================
do $$
begin
  if to_regclass('public.bk_documents') is null or to_regclass('public.bk_entries') is null or to_regclass('public.bk_stock_settings') is null
     or to_regclass('public.bk_customers') is null or to_regclass('public.bk_document_customer_links') is null or to_regclass('public.products') is null
     or to_regprocedure('public.bk_doc_gate(uuid,uuid)') is null or to_regprocedure('public.bk_doc_issue_core(bk_documents,uuid,jsonb,jsonb,date)') is null
     or to_regprocedure('public.bk_record_entry(uuid,uuid,text,numeric,date,text,text,boolean,text,uuid,uuid,uuid)') is null
     or to_regprocedure('public.inv_adjust_stock(uuid,uuid,uuid,text,integer,text,text,text,uuid,numeric,uuid)') is null
     or to_regprocedure('public.bk_void_entry(uuid,uuid,uuid,text)') is null then
    raise exception 'Record Sale requires the Business Toolkit Phase 1-4 migrations (2026-12-01 .. 2026-12-04)';
  end if;
end $$;

-- ============================================================================
-- 1. bk_documents: a receipt may be a standalone SALE receipt
-- ============================================================================
do $$
declare v_name text;
begin
  -- 1a. the receipt shape: parent invoice required -> required UNLESS it is a sale receipt
  if not exists (select 1 from pg_constraint where conrelid = 'public.bk_documents'::regclass and conname = 'bk_documents_receipt_shape_check') then
    select con.conname into v_name from pg_constraint con
     where con.conrelid = 'public.bk_documents'::regclass and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%doc_type <> ''receipt''%' and pg_get_constraintdef(con.oid) ilike '%parent_document_id IS NOT NULL%'
       and pg_get_constraintdef(con.oid) ilike '%due_date IS NULL%';
    if v_name is null then raise exception 'bk_documents: could not find the receipt-shape CHECK constraint — inspect the table before proceeding'; end if;
    execute format('alter table public.bk_documents drop constraint %I', v_name);
    alter table public.bk_documents add constraint bk_documents_receipt_shape_check
      check (doc_type <> 'receipt' or (status in ('draft', 'issued', 'void') and amount_paid = 0 and due_date is null
             and (parent_document_id is not null or (source_type = 'sale' and source_id is not null))));
  end if;

  -- 1b. source_type: product_order (reserved) -> product_order or sale
  select con.conname into v_name from pg_constraint con
   where con.conrelid = 'public.bk_documents'::regclass and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%source_type%' and pg_get_constraintdef(con.oid) ilike '%product_order%'
     and pg_get_constraintdef(con.oid) not ilike '%sale%';
  if v_name is not null then
    execute format('alter table public.bk_documents drop constraint %I', v_name);
    alter table public.bk_documents add constraint bk_documents_source_type_check
      check (source_type is null or source_type in ('product_order', 'sale'));
  elsif not exists (select 1 from pg_constraint con where con.conrelid = 'public.bk_documents'::regclass and con.contype = 'c'
                       and pg_get_constraintdef(con.oid) ilike '%source_type%' and pg_get_constraintdef(con.oid) ilike '%sale%') then
    raise exception 'bk_documents: could not find the source_type CHECK constraint — inspect the table before proceeding';
  end if;
end $$;

-- ============================================================================
-- 2. a customer link may point at a sale receipt (invoices as before)
-- ============================================================================
create or replace function bk_document_customer_links_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'bk_document_customer_links: links are never deleted; unlink by clearing the customer'; end if;
  if tg_op = 'INSERT' then
    perform 1 from bk_documents d where d.id = new.document_id and d.profile_id = new.profile_id
        and (d.doc_type = 'invoice' or (d.doc_type = 'receipt' and d.source_type = 'sale'));
    if not found then raise exception 'bk_document_customer_links: only an invoice or a sale receipt of the same business can be linked'; end if;
    return new;
  end if;
  if new.document_id <> old.document_id or new.profile_id <> old.profile_id then
    raise exception 'bk_document_customer_links: only the customer may change';
  end if;
  return new;
end $$;

-- ============================================================================
-- 3. payment details on the business profile
-- ============================================================================
alter table bk_business_profiles
  add column if not exists payment_details jsonb check (payment_details is null or (jsonb_typeof(payment_details) = 'object' and pg_column_size(payment_details) <= 2048));

-- Whitelists and bounds-checks the payment-details object; blank values are dropped; an empty result is NULL.
create or replace function bk_doc_clean_payment_details(p_details jsonb) returns jsonb
language plpgsql immutable as $$
declare v_out jsonb := '{}'::jsonb; v_key text; v_val jsonb; v_max int; v_text text;
begin
  if p_details is null or jsonb_typeof(p_details) = 'null' then return null; end if;
  if jsonb_typeof(p_details) <> 'object' then raise exception 'invalid_payment_details'; end if;
  for v_key, v_val in select key, value from jsonb_each(p_details) loop
    if v_key not in ('bank_name', 'account_name', 'account_number', 'momo_provider', 'momo_number', 'instructions') then continue; end if;
    if jsonb_typeof(v_val) = 'null' then continue; end if;
    if jsonb_typeof(v_val) <> 'string' then raise exception 'invalid_payment_details'; end if;
    v_text := v_val #>> '{}';
    v_max := case v_key when 'instructions' then 500 else 120 end;
    if char_length(v_text) > v_max then raise exception 'invalid_payment_details'; end if;
    if btrim(v_text) = '' then continue; end if;
    v_out := v_out || jsonb_build_object(v_key, btrim(v_text));
  end loop;
  if v_out = '{}'::jsonb then return null; end if;
  return v_out;
end $$;

-- The original 13-argument doc_upsert_business_profile is left exactly as it is; this overload also stores the payment details.
create or replace function doc_upsert_business_profile(
  p_profile_id uuid, p_actor_user_id uuid, p_display_name text, p_legal_name text, p_address text, p_phone text, p_email text,
  p_tax_id text, p_registration_no text, p_default_terms text, p_default_due_days int, p_tax_label text, p_tax_rate_bp int, p_payment_details jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row bk_business_profiles; v_pay jsonb;
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_display_name is null or btrim(p_display_name) = '' or char_length(p_display_name) > 120 then raise exception 'invalid_display_name'; end if;
  if (bk_doc_blank_null(p_tax_label) is null) <> (p_tax_rate_bp is null) then raise exception 'tax_incomplete'; end if;
  if p_tax_rate_bp is not null and (p_tax_rate_bp < 0 or p_tax_rate_bp > 10000) then raise exception 'invalid_tax_rate'; end if;
  if p_default_due_days is not null and (p_default_due_days < 0 or p_default_due_days > 365) then raise exception 'invalid_due_days'; end if;
  v_pay := bk_doc_clean_payment_details(p_payment_details);
  insert into bk_business_profiles as b (profile_id, display_name, legal_name, address, phone, email, tax_id, registration_no, default_terms,
                                         default_due_days, tax_label, tax_rate_bp, payment_details, updated_by)
  values (p_profile_id, p_display_name, bk_doc_blank_null(p_legal_name), bk_doc_blank_null(p_address), bk_doc_blank_null(p_phone),
          bk_doc_blank_null(p_email), bk_doc_blank_null(p_tax_id), bk_doc_blank_null(p_registration_no), bk_doc_blank_null(p_default_terms),
          p_default_due_days, bk_doc_blank_null(p_tax_label), p_tax_rate_bp, v_pay, p_actor_user_id)
  on conflict (profile_id) do update set display_name = excluded.display_name, legal_name = excluded.legal_name, address = excluded.address,
    phone = excluded.phone, email = excluded.email, tax_id = excluded.tax_id, registration_no = excluded.registration_no,
    default_terms = excluded.default_terms, default_due_days = excluded.default_due_days, tax_label = excluded.tax_label,
    tax_rate_bp = excluded.tax_rate_bp, payment_details = excluded.payment_details, updated_by = excluded.updated_by
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

-- ============================================================================
-- 4. branding frozen on NEW documents (template version 2)
-- ============================================================================
-- 4a. IMMUTABLE logo copies. The bytes are stored once per distinct image (content-addressed by sha256) and can never be updated or deleted, so a document that
-- references one renders the same logo forever, whatever happens to the live profile picture or to the file behind it. Capped at 256 KB, PNG or JPEG only.
create table if not exists bk_brand_assets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete restrict,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  content_type text not null check (content_type in ('image/png', 'image/jpeg')),
  bytes bytea not null check (octet_length(bytes) between 1 and 262144),
  created_at timestamptz not null default now(),
  unique (profile_id, sha256),
  unique (profile_id, id)
);
-- 4b. which copy is the CURRENT logo of a business, and the profile picture URL it was made from. A document only takes the copy while the picture is still the
-- one it was copied from (so an out-of-date copy is never frozen into a new document).
create table if not exists bk_brand_logo_current (
  profile_id uuid primary key references profiles(id) on delete restrict,
  source_url text check (source_url is null or (source_url ~ '^https://[^[:space:]]+$' and char_length(source_url) <= 500)),
  asset_id uuid,
  updated_at timestamptz not null default now(),
  foreign key (profile_id, asset_id) references bk_brand_assets (profile_id, id) on delete restrict,
  check ((source_url is null) = (asset_id is null))
);

create or replace function bk_brand_assets_guard() returns trigger language plpgsql as $$
begin
  raise exception 'bk_brand_assets: logo copies are immutable (never updated or deleted)';
end $$;
drop trigger if exists bk_brand_assets_guard_trg on bk_brand_assets;
create trigger bk_brand_assets_guard_trg before update or delete on bk_brand_assets for each row execute function bk_brand_assets_guard();
drop trigger if exists bk_brand_assets_truncate_guard_trg on bk_brand_assets;
create trigger bk_brand_assets_truncate_guard_trg before truncate on bk_brand_assets for each statement execute function bk_truncate_guard();

-- Records (or clears) the current logo. p_b64 is the image as base64; the server has already fetched it from the business's own storage. The format is verified
-- here by its magic bytes, never by the claimed type alone.
create or replace function doc_set_brand_logo(p_profile_id uuid, p_actor_user_id uuid, p_source_url text, p_content_type text, p_b64 text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_bytes bytea; v_sha text; v_id uuid;
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_source_url is null then
    insert into bk_brand_logo_current as c (profile_id, source_url, asset_id) values (p_profile_id, null, null)
      on conflict (profile_id) do update set source_url = null, asset_id = null, updated_at = now();
    return jsonb_build_object('asset_id', null, 'sha256', null);
  end if;
  if p_source_url !~ '^https://[^[:space:]]+$' or char_length(p_source_url) > 500 then raise exception 'invalid_logo'; end if;
  if p_content_type is null or p_content_type not in ('image/png', 'image/jpeg') or p_b64 is null or char_length(p_b64) > 400000 then raise exception 'invalid_logo'; end if;
  v_bytes := decode(p_b64, 'base64');
  if octet_length(v_bytes) not between 8 and 262144 then raise exception 'invalid_logo'; end if;
  if not ((p_content_type = 'image/png' and substring(v_bytes from 1 for 4) = '\x89504e47'::bytea) or (p_content_type = 'image/jpeg' and substring(v_bytes from 1 for 3) = '\xffd8ff'::bytea)) then
    raise exception 'invalid_logo';
  end if;
  v_sha := encode(sha256(v_bytes), 'hex');
  insert into bk_brand_assets (profile_id, sha256, content_type, bytes) values (p_profile_id, v_sha, p_content_type, v_bytes)
    on conflict (profile_id, sha256) do nothing;
  select id into v_id from bk_brand_assets where profile_id = p_profile_id and sha256 = v_sha;
  insert into bk_brand_logo_current as c (profile_id, source_url, asset_id) values (p_profile_id, p_source_url, v_id)
    on conflict (profile_id) do update set source_url = excluded.source_url, asset_id = excluded.asset_id, updated_at = now();
  return jsonb_build_object('asset_id', v_id, 'sha256', v_sha);
end $$;

-- The frozen copy of a logo (as base64) for rendering: only for the business that owns it.
create or replace function doc_get_brand_asset(p_profile_id uuid, p_asset_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('content_type', a.content_type, 'b64', encode(a.bytes, 'base64'), 'sha256', a.sha256)
    from bk_brand_assets a where a.id = p_asset_id and a.profile_id = p_profile_id
$$;

-- The seller snapshot frozen into a document at issue. The logo is taken ONLY as a reference to the immutable copy, and only while the copy still matches the
-- current profile picture. The accent colour and payment details are plain values frozen in the snapshot itself.
create or replace function bk_doc_seller_snapshot(p_profile_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
           'display_name', coalesce(bp.display_name, nullif(btrim(p.name), ''), p.username),
           'legal_name', bp.legal_name, 'address', bp.address, 'phone', bp.phone, 'email', bp.email,
           'tax_id', bp.tax_id, 'registration_no', bp.registration_no,
           'logo_asset_id', lg.asset_id, 'logo_sha256', lg.sha256,
           'accent_color', case when p.theme_color ~ '^#[0-9a-fA-F]{6}$' then lower(p.theme_color) else null end,
           'payment_details', bp.payment_details)
    from profiles p
    left join bk_business_profiles bp on bp.profile_id = p.id
    left join lateral (select c.asset_id, a.sha256 from bk_brand_logo_current c join bk_brand_assets a on a.id = c.asset_id and a.profile_id = c.profile_id
                        where c.profile_id = p.id and c.source_url is not distinct from p.avatar_url and c.asset_id is not null) lg on true
   where p.id = p_profile_id
$$;

-- Identical to the Phase 2 body except for `template_version := 2` (documents issued from now on use template v2; issued documents keep their stamped version).
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
  v_doc.template_version := 2;
  v_doc.content_hash := bk_doc_hash_of(v_doc);
  update bk_documents set status = v_doc.status, number = v_doc.number, number_year = v_doc.number_year, number_seq = v_doc.number_seq,
         issue_date = v_doc.issue_date, due_date = v_doc.due_date, seller_snapshot = v_doc.seller_snapshot, type_snapshot = v_doc.type_snapshot,
         issued_at = v_doc.issued_at, issued_by = v_doc.issued_by, template_version = v_doc.template_version, content_hash = v_doc.content_hash
   where id = v_doc.id returning * into v_doc;
  perform bk_doc_event(v_doc.id, v_doc.profile_id, 'issued', p_actor, jsonb_build_object('number', v_doc.number, 'type', v_doc.doc_type, 'total', v_doc.total));
  return v_doc;
end $$;

-- ============================================================================
-- 5. RECORD SALE: one atomic operation
-- ============================================================================
-- p_lines: 1..20 elements. A catalogue line: {"product_id": uuid, "quantity": "2", "unit_price": "5000"?} (unit_price defaults to the product's own price;
-- whole quantities only). A custom line: {"description": "Website design", "quantity": "1", "unit_price": "150000"} (never touches stock).
-- Idempotent on p_client_request_id: a replay returns the first receipt and writes nothing.
create or replace function sale_record(
  p_profile_id uuid, p_actor_user_id uuid, p_locale text, p_lines jsonb, p_customer_id uuid, p_method text, p_sold_on date, p_notes text, p_client_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_currency text; v_digits int; v_today date; v_existing bk_documents; v_elem jsonb; v_ord bigint; v_txt text; v_pid uuid; v_prod record; v_qty numeric;
  v_unit numeric; v_calc record; v_desc text; v_rows jsonb[] := '{}'; v_total numeric := 0; v_summary text := ''; v_cust record; v_customer jsonb := '{}'::jsonb;
  v_entry jsonb; v_entry_id uuid; v_receipt bk_documents; v_moves jsonb := '[]'::jsonb; v_mv jsonb; r jsonb; v_sold_on date;
begin
  v_currency := bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_client_request_id is null then raise exception 'request_id_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('sale:' || p_profile_id::text || ':' || p_client_request_id::text, 0));
  select * into v_existing from bk_documents where profile_id = p_profile_id and client_request_id = p_client_request_id;
  if found then
    if v_existing.doc_type <> 'receipt' or v_existing.source_type is distinct from 'sale' then raise exception 'request_id_conflict'; end if;
    return bk_doc_bundle(v_existing.id) || jsonb_build_object('duplicate', true, 'entry_id', v_existing.source_id, 'movements', '[]'::jsonb);
  end if;

  if p_locale is null or p_locale not in ('en', 'fr') then raise exception 'invalid_locale'; end if;
  if p_method is null or p_method not in ('cash', 'mobile_money', 'bank_transfer', 'card', 'other') then raise exception 'invalid_method'; end if;
  if p_notes is not null and char_length(p_notes) > 1000 then raise exception 'invalid_notes'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 then raise exception 'invalid_lines'; end if;
  if jsonb_array_length(p_lines) > 20 then raise exception 'too_many_lines'; end if;
  v_digits := bk_currency_digits(v_currency);
  v_today := (now() at time zone 'Africa/Douala')::date;
  v_sold_on := coalesce(p_sold_on, v_today);
  if v_sold_on > v_today or v_sold_on < date '2000-01-01' then raise exception 'invalid_sold_on'; end if;

  if p_customer_id is not null then
    select name, phone, email into v_cust from bk_customers where id = p_customer_id and profile_id = p_profile_id and archived_at is null;
    if not found then raise exception 'customer_not_found'; end if;
    v_customer := bk_doc_clean_customer(jsonb_build_object('name', v_cust.name, 'phone', v_cust.phone, 'email', v_cust.email));
  end if;

  -- validate and price every line first; nothing is written until all are valid
  for v_elem, v_ord in select e, o from jsonb_array_elements(p_lines) with ordinality as t(e, o) loop
    if jsonb_typeof(v_elem) <> 'object' then raise exception 'invalid_line'; end if;
    v_pid := null;
    if v_elem ? 'product_id' and jsonb_typeof(v_elem -> 'product_id') <> 'null' then
      v_txt := v_elem ->> 'product_id';
      if jsonb_typeof(v_elem -> 'product_id') <> 'string' or v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'invalid_product'; end if;
      v_pid := v_txt::uuid;
      select id, name, price into v_prod from products where id = v_pid and profile_id = p_profile_id;
      if not found then raise exception 'product_not_found'; end if;
      v_desc := left(btrim(v_prod.name), 300);
    else
      if jsonb_typeof(v_elem -> 'description') is distinct from 'string' then raise exception 'invalid_description'; end if;
      v_desc := v_elem ->> 'description';
      if char_length(btrim(v_desc)) not between 1 and 300 then raise exception 'invalid_description'; end if;
    end if;
    v_txt := v_elem ->> 'quantity';
    if v_pid is not null then
      if v_txt is null or v_txt !~ '^[0-9]{1,9}$' or v_txt::numeric < 1 then raise exception 'invalid_quantity'; end if;
    elsif v_txt is null or v_txt !~ '^[0-9]{1,9}(\.[0-9]{1,3})?$' then raise exception 'invalid_quantity';
    end if;
    v_qty := v_txt::numeric;
    v_txt := v_elem ->> 'unit_price';
    if v_txt is null and v_pid is not null then
      if v_prod.price is not null then v_txt := v_prod.price::text; end if;
    end if;
    if v_txt is null or v_txt !~ '^[0-9]{1,10}(\.[0-9]{1,3})?$' then raise exception 'invalid_unit_price'; end if;
    v_unit := v_txt::numeric;
    if v_unit <> round(v_unit, v_digits) then raise exception 'amount_too_precise'; end if;
    select * into v_calc from bk_doc_compute_line(v_qty, v_unit, 0, null, v_digits);
    v_total := v_total + v_calc.total;
    v_rows := v_rows || jsonb_build_object('position', v_ord, 'description', v_desc, 'quantity', v_qty, 'unit_price', v_unit, 'gross', v_calc.gross, 'total', v_calc.total, 'product_id', v_pid);
    if char_length(v_summary) < 440 then
      v_txt := v_qty::text;
      if position('.' in v_txt) > 0 then v_txt := trim(trailing '.' from trim(trailing '0' from v_txt)); end if;
      v_summary := v_summary || case when v_summary = '' then '' else ', ' end || left(v_desc, 60) || ' x' || v_txt;
    end if;
  end loop;
  if v_total <= 0 then raise exception 'zero_total'; end if;
  if v_total > 9999999999.999 then raise exception 'amount_too_large'; end if;

  -- 1. stock: only TRACKED products move (an untracked product has no count to invent). A shortage raises and undoes everything.
  for r in select x from unnest(v_rows) as x where x ->> 'product_id' is not null order by (x ->> 'position')::int loop
    if exists (select 1 from bk_stock_settings where product_id = (r ->> 'product_id')::uuid and profile_id = p_profile_id and active) then
      v_mv := inv_adjust_stock(p_profile_id, p_actor_user_id, (r ->> 'product_id')::uuid, 'sold_elsewhere', (r ->> 'quantity')::int, 'Recorded sale', null, null, null, null,
                               md5(p_client_request_id::text || ':' || (r ->> 'position'))::uuid);
      v_moves := v_moves || jsonb_build_array(v_mv -> 'movement');
    end if;
  end loop;

  -- 2. the ONE bookkeeping sale (its description carries product names only, never a customer)
  v_entry := bk_record_entry(p_profile_id, p_actor_user_id, 'sale', v_total, v_sold_on, null, left(v_summary, 500), true, null, null, null, p_client_request_id);
  if (v_entry ->> 'duplicate')::boolean is true then raise exception 'sale_conflict'; end if;
  v_entry_id := (v_entry -> 'entry' ->> 'id')::uuid;

  -- 3. the standalone receipt, issued through the same core as every other document
  insert into bk_documents (profile_id, doc_type, status, locale, currency, customer_snapshot, subtotal, discount_total, tax_total, total, notes,
                            source_type, source_id, client_request_id, created_by)
  values (p_profile_id, 'receipt', 'draft', p_locale, v_currency, v_customer, v_total, 0, 0, v_total, bk_doc_blank_null(p_notes),
          'sale', v_entry_id, p_client_request_id, p_actor_user_id)
  returning * into v_receipt;
  insert into bk_document_lines (document_id, position, description, quantity, unit_price, gross_amount, discount_amount, tax_amount, line_total, product_id)
  select v_receipt.id, (x ->> 'position')::int, x ->> 'description', (x ->> 'quantity')::numeric, (x ->> 'unit_price')::numeric, (x ->> 'gross')::numeric, 0, 0,
         (x ->> 'total')::numeric, nullif(x ->> 'product_id', '')::uuid
    from unnest(v_rows) as x;
  v_receipt := bk_doc_issue_core(v_receipt, p_actor_user_id, bk_doc_seller_snapshot(p_profile_id),
    jsonb_build_object('kind', 'sale', 'method', p_method, 'paid_on', v_sold_on, 'amount', v_total, 'entry_id', v_entry_id), null);

  -- 4. the optional customer
  if p_customer_id is not null then
    insert into bk_document_customer_links (document_id, profile_id, customer_id, linked_by) values (v_receipt.id, p_profile_id, p_customer_id, p_actor_user_id);
  end if;

  return bk_doc_bundle(v_receipt.id) || jsonb_build_object('duplicate', false, 'entry_id', v_entry_id, 'movements', v_moves);
end $$;

-- ============================================================================
-- 5b. VOID A RECORDED SALE: one atomic operation, never a deletion
-- ============================================================================
-- Voids a Record Sale receipt: (1) the receipt is marked void (its lines, snapshot and number stay readable), (2) the ONE bookkeeping sale is voided through the
-- existing bk_void_entry (the entry is kept, marked void, so revenue and cash drop out of the reports exactly once), (3) for each line whose sale took stock from a
-- product that is STILL tracked, the exact quantity is put back through the existing inv_adjust_stock (kind increase, reason 'Sale voided'). Serialised per receipt
-- (row lock), so concurrent voids produce one reversal; a second void answers already_voided and changes nothing. Any failure undoes all three steps.
-- Products whose tracking was stopped (or that were deleted) after the sale have no count to restore: they are reported in `not_restored`, never invented.
create or replace function sale_void(p_profile_id uuid, p_actor_user_id uuid, p_receipt_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reason text; v_doc bk_documents; v_ln record; v_mv bk_stock_movements; v_back jsonb := '[]'::jsonb; v_skip jsonb := '[]'::jsonb; v_res jsonb; v_entry jsonb;
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_reason is null or btrim(p_reason) = '' or char_length(p_reason) > 300 then raise exception 'reason_required'; end if;
  v_reason := left(btrim(p_reason), 300);
  perform pg_advisory_xact_lock(hashtextextended('salevoid:' || p_profile_id::text || ':' || coalesce(p_receipt_id::text, ''), 0));
  select * into v_doc from bk_documents where id = p_receipt_id and profile_id = p_profile_id for update;
  if not found or v_doc.doc_type <> 'receipt' or v_doc.source_type is distinct from 'sale' then raise exception 'document_not_found'; end if;
  if v_doc.status = 'void' then
    return bk_doc_bundle(v_doc.id) || jsonb_build_object('already_voided', true, 'restored', '[]'::jsonb, 'not_restored', '[]'::jsonb, 'entry_id', v_doc.source_id);
  end if;

  -- 1. the bookkeeping sale (existing void: kept, marked void, an event is written)
  v_entry := bk_void_entry(p_profile_id, p_actor_user_id, v_doc.source_id, 'Sale voided: ' || v_doc.number);

  -- 2. the stock the sale took (found through the movement's own idempotency key, so only what THIS sale moved is put back)
  for v_ln in select position, product_id, quantity from bk_document_lines where document_id = v_doc.id and product_id is not null order by position loop
    select * into v_mv from bk_stock_movements
     where profile_id = p_profile_id and client_request_id = md5(v_doc.client_request_id::text || ':' || v_ln.position::text)::uuid and kind = 'sold_elsewhere';
    if not found then continue; end if;         -- the product was not tracked when it was sold: nothing was taken
    if exists (select 1 from bk_stock_settings where product_id = v_ln.product_id and profile_id = p_profile_id and active)
       and exists (select 1 from products where id = v_ln.product_id and profile_id = p_profile_id and inventory_count is not null) then
      v_res := inv_adjust_stock(p_profile_id, p_actor_user_id, v_ln.product_id, 'increase', (-v_mv.qty_delta)::int, 'Sale voided', v_doc.number, null, null, null,
                                md5('salevoid:' || v_doc.id::text || ':' || v_ln.position::text)::uuid);
      v_back := v_back || jsonb_build_array(v_res -> 'movement');
    else
      v_skip := v_skip || jsonb_build_array(jsonb_build_object('product_id', v_ln.product_id, 'quantity', -v_mv.qty_delta));
    end if;
  end loop;

  -- 3. the receipt itself (kept, marked void; the document guard allows exactly this transition)
  update bk_documents set status = 'void', voided_at = now(), voided_by = p_actor_user_id, void_reason = v_reason where id = v_doc.id;
  perform bk_doc_event(v_doc.id, p_profile_id, 'voided', p_actor_user_id, jsonb_build_object('number', v_doc.number, 'kind', 'sale'));
  return bk_doc_bundle(v_doc.id) || jsonb_build_object('already_voided', false, 'restored', v_back, 'not_restored', v_skip, 'entry_id', v_doc.source_id);
end $$;

-- ============================================================================
-- 6. EXECUTE PRIVILEGES: only the trusted server routes (service_role) call the entry points
-- ============================================================================
revoke all on function sale_record(uuid, uuid, text, jsonb, uuid, text, date, text, uuid) from public, anon, authenticated, service_role;
grant execute on function sale_record(uuid, uuid, text, jsonb, uuid, text, date, text, uuid) to service_role;
revoke all on function sale_void(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function sale_void(uuid, uuid, uuid, text) to service_role;
revoke all on function doc_set_brand_logo(uuid, uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function doc_set_brand_logo(uuid, uuid, text, text, text) to service_role;
revoke all on function doc_get_brand_asset(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function doc_get_brand_asset(uuid, uuid) to service_role;
revoke all on function bk_brand_assets_guard() from public, anon, authenticated, service_role;
revoke all on function bk_doc_clean_payment_details(jsonb) from public, anon, authenticated, service_role;
revoke all on function doc_upsert_business_profile(uuid, uuid, text, text, text, text, text, text, text, text, int, text, int, jsonb) from public, anon, authenticated, service_role;
grant execute on function doc_upsert_business_profile(uuid, uuid, text, text, text, text, text, text, text, text, int, text, int, jsonb) to service_role;

-- ============================================================================
-- 7. ROW LEVEL SECURITY AND TABLE PRIVILEGES for the two new tables
-- ============================================================================
alter table bk_brand_assets enable row level security;
alter table bk_brand_logo_current enable row level security;
revoke all on bk_brand_assets, bk_brand_logo_current from anon, authenticated, service_role;
-- the image bytes are never selectable by a client or by a plain table read: only doc_get_brand_asset (service role) returns them
grant select (id, profile_id, sha256, content_type, created_at) on bk_brand_assets to service_role;
grant select on bk_brand_logo_current to service_role;

commit;
