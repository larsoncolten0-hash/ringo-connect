-- Business Toolkit — Phase 2 (Invoices & Professional Receipts) — PROPOSED, NOT APPLIED.
--
-- Canonical design: docs/business-toolkit-phase2-invoices-receipts.md. Applied manually in the Supabase SQL editor, like every
-- other file in this folder. 2026-12-02 is the next slot in this repo's running sequence (latest: 2026-12-01_bookkeeping_foundation.sql).
-- Run supabase/support/2026-12-02_documents_invoices_receipts.preflight.sql first.
--
-- What it changes
--   NEW   tables: bk_business_profiles, bk_documents, bk_document_lines, bk_document_counters, bk_document_payments,
--         bk_document_events, bk_document_shares, bk_document_rate_events
--   NEW   functions: the doc_* service-role functions and bk_doc_* helpers listed in section 9, plus the guard triggers.
--   NOTHING else. No existing table (not even `plans`), column, row, constraint, trigger, function or policy is modified.
--   customer_payments, product_orders, orders, music_orders, every payment/earnings/protection object, the existing rate
--   limiter and every Phase 1 object are only READ or CALLED (bk_record_entry, bk_void_entry, bk_currency_digits,
--   bk_truncate_guard), never altered.
--
-- Depends on (checked below; the migration aborts with a clear message and changes nothing if any is missing):
--   Phase 1 (2026-12-01): bk_entries, bk_record_entry, bk_void_entry, bk_currency_digits, bk_truncate_guard,
--   plans.business_toolkit_enabled; and the existing tables profiles, users, plans, products.
--
-- Design principles (same as Phase 1)
--   * Owner-only: the RLS read policy is the profile's owner; every function re-checks owner + plan flag + demo profile
--     through bk_doc_gate(). Staff permissions are NOT honoured. No client role may write; service_role holds SELECT only
--     (stricter than Phase 1): rows can change only through the guarded functions below.
--   * Money is numeric(14,3) with a per-currency scale CHECK (bk_currency_digits): never silently rounded. The only rounding
--     in the whole feature is half-up, in bk_doc_compute_line(), and its inputs are validated first.
--   * Text is stored EXACTLY as given (UTF-8: emoji, accents, U+202F ...). Nothing here sanitises it; only the PDF renderer
--     falls back for glyphs it cannot draw.
--   * Drafts have no number and never touch the counters. A number is allocated at issue from an atomic counter row, so a
--     failed transaction consumes none. Voided documents keep their number. No backdating: the server sets the issue date.
--   * Issued documents are immutable (guard triggers). Corrections void and re-issue. Payments and shares change only their
--     void/revoke/access fields. Events are append-only. Nothing is deleted; TRUNCATE is refused. Every FK is ON DELETE RESTRICT,
--     and same-business references are enforced by composite foreign keys, not just by function code.
--   * One recorded payment = one receipt + one payment row + exactly one Phase 1 bookkeeping 'sale' entry, in ONE function,
--     so one cannot exist without the others. No second accounting system. Issuing an invoice creates no entry.
--   * Idempotent to re-run: IF NOT EXISTS / CREATE OR REPLACE / guarded policies; triggers are dropped and recreated only on
--     the new tables. Single transaction.

begin;

-- ============================================================================
-- 0. DEPENDENCY CHECK (fails fast; nothing has been changed yet)
-- ============================================================================
do $$
begin
  if to_regclass('public.bk_entries') is null
     or to_regprocedure('public.bk_record_entry(uuid,uuid,text,numeric,date,text,text,boolean,text,uuid,uuid,uuid)') is null
     or to_regprocedure('public.bk_void_entry(uuid,uuid,uuid,text)') is null
     or to_regprocedure('public.bk_currency_digits(text)') is null
     or to_regprocedure('public.bk_truncate_guard()') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'plans' and column_name = 'business_toolkit_enabled')
     or to_regclass('public.profiles') is null or to_regclass('public.users') is null or to_regclass('public.plans') is null or to_regclass('public.products') is null then
    raise exception 'Phase 2 requires the Phase 1 bookkeeping migration (2026-12-01_bookkeeping_foundation.sql) and the existing profiles/users/plans/products tables';
  end if;
end $$;

-- ============================================================================
-- 1. PURE HELPERS
-- ============================================================================
-- INV-2026-0001 / RCT-2026-0001. Never truncates: lpad() would cut a 5-digit sequence, so it is only used below 4 digits.
create or replace function bk_doc_number(p_type text, p_year int, p_seq int) returns text
language sql immutable as $$
  select case p_type when 'invoice' then 'INV' when 'receipt' then 'RCT' end
         || '-' || p_year::text || '-'
         || case when length(p_seq::text) >= 4 then p_seq::text else lpad(p_seq::text, 4, '0') end
$$;

-- The one rounding rule: half-up (numeric round() is half away from zero; every input here is >= 0) to the currency's decimals.
create or replace function bk_doc_compute_line(
  p_qty numeric, p_unit numeric, p_discount numeric, p_rate_bp int, p_digits int,
  out gross numeric, out discount numeric, out tax numeric, out total numeric)
language plpgsql immutable as $$
begin
  if p_qty is null or p_qty <= 0 then raise exception 'invalid_quantity'; end if;
  if p_unit is null or p_unit < 0 then raise exception 'invalid_unit_price'; end if;
  if p_discount is null or p_discount < 0 then raise exception 'invalid_discount'; end if;
  if p_rate_bp is not null and (p_rate_bp < 0 or p_rate_bp > 10000) then raise exception 'invalid_tax_rate'; end if;
  gross := round(p_qty * p_unit, p_digits);
  if p_discount > gross then raise exception 'discount_exceeds_amount'; end if;
  discount := p_discount;
  tax := case when p_rate_bp is null then 0 else round((gross - p_discount) * p_rate_bp / 10000, p_digits) end;
  total := gross - discount + tax;
end $$;

create or replace function bk_doc_blank_null(p_text text) returns text
language sql immutable as $$ select case when p_text is null or btrim(p_text) = '' then null else p_text end $$;

-- ============================================================================
-- 2. TABLES
-- ============================================================================
create table if not exists bk_business_profiles (
  profile_id uuid primary key references profiles(id) on delete restrict,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  legal_name text check (legal_name is null or char_length(legal_name) <= 160),
  address text check (address is null or char_length(address) <= 300),
  phone text check (phone is null or char_length(phone) <= 40),
  email text check (email is null or (char_length(email) <= 200 and position('@' in email) > 1)),
  tax_id text check (tax_id is null or char_length(tax_id) <= 60),
  registration_no text check (registration_no is null or char_length(registration_no) <= 60),
  default_terms text check (default_terms is null or char_length(default_terms) <= 1000),
  default_due_days int check (default_due_days is null or default_due_days between 0 and 365),
  tax_label text check (tax_label is null or char_length(btrim(tax_label)) between 1 and 30),
  tax_rate_bp int check (tax_rate_bp is null or tax_rate_bp between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete restrict,
  check ((tax_label is null) = (tax_rate_bp is null))          -- tax is ON only when both are set; OFF by default
);

create table if not exists bk_documents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete restrict,
  doc_type text not null check (doc_type in ('invoice', 'receipt')),      -- a quotation type may be added later; not built
  status text not null default 'draft' check (status in ('draft', 'issued', 'partially_paid', 'paid', 'void')),
  locale text not null check (locale in ('en', 'fr')),
  currency text not null check (currency = upper(currency) and char_length(currency) = 3),
  number text,
  number_year int check (number_year is null or number_year between 2000 and 2999),
  number_seq int check (number_seq is null or number_seq >= 1),
  issue_date date,
  due_date date,
  customer_snapshot jsonb check (customer_snapshot is null or (jsonb_typeof(customer_snapshot) = 'object' and pg_column_size(customer_snapshot) <= 8192)),
  seller_snapshot jsonb check (seller_snapshot is null or (jsonb_typeof(seller_snapshot) = 'object' and pg_column_size(seller_snapshot) <= 8192)),
  type_snapshot jsonb check (type_snapshot is null or (jsonb_typeof(type_snapshot) = 'object' and pg_column_size(type_snapshot) <= 4096)),
  subtotal numeric(14,3) not null default 0,
  discount_total numeric(14,3) not null default 0,
  tax_label text check (tax_label is null or char_length(btrim(tax_label)) between 1 and 30),
  tax_rate_bp int check (tax_rate_bp is null or tax_rate_bp between 0 and 10000),
  tax_total numeric(14,3) not null default 0,
  total numeric(14,3) not null default 0,
  amount_paid numeric(14,3) not null default 0,
  notes text check (notes is null or char_length(notes) <= 1000),
  terms text check (terms is null or char_length(terms) <= 1000),
  parent_document_id uuid,
  replaces_document_id uuid,
  source_type text check (source_type is null or source_type = 'product_order'),   -- reserved; unused in Phase 2
  source_id uuid,
  template_version int not null default 1 check (template_version >= 1),
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  client_request_id uuid,
  created_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  issued_by uuid references public.users(id) on delete restrict,
  issued_at timestamptz,
  voided_by uuid references public.users(id) on delete restrict,
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(btrim(void_reason)) between 1 and 300),
  unique (profile_id, id),
  foreign key (profile_id, parent_document_id) references bk_documents (profile_id, id) on delete restrict,
  foreign key (profile_id, replaces_document_id) references bk_documents (profile_id, id) on delete restrict,
  -- money: exact, per-currency scale, one identity
  check (subtotal = round(subtotal, bk_currency_digits(currency)) and discount_total = round(discount_total, bk_currency_digits(currency))
         and tax_total = round(tax_total, bk_currency_digits(currency)) and total = round(total, bk_currency_digits(currency))
         and amount_paid = round(amount_paid, bk_currency_digits(currency))),
  check (subtotal >= 0 and discount_total >= 0 and tax_total >= 0 and total >= 0 and amount_paid >= 0 and amount_paid <= total
         and discount_total <= subtotal and total = subtotal - discount_total + tax_total),
  check ((tax_label is null) = (tax_rate_bp is null)),
  check (tax_rate_bp is not null or tax_total = 0),
  -- numbering: allocated only at issue; consistent with the printed date and with the formatter
  check ((issued_at is null) = (number is null) and (number is null) = (number_year is null) and (number is null) = (number_seq is null)
         and (issued_at is null) = (issue_date is null) and (issued_at is null) = (content_hash is null) and (issued_at is null) = (seller_snapshot is null)),
  check (number is null or number = bk_doc_number(doc_type, number_year, number_seq)),
  check (issue_date is null or number_year = extract(year from issue_date)::int),
  check (issued_at is null or customer_snapshot is not null),
  check (doc_type <> 'receipt' or issued_at is null or type_snapshot is not null),
  -- lifecycle
  check (status <> 'draft' or (issued_at is null and amount_paid = 0)),
  check (status not in ('issued', 'partially_paid', 'paid') or issued_at is not null),
  check (doc_type <> 'invoice' or status <> 'issued' or amount_paid = 0),
  check (doc_type <> 'invoice' or status <> 'partially_paid' or (amount_paid > 0 and amount_paid < total)),
  check (doc_type <> 'invoice' or status <> 'paid' or (amount_paid = total and total > 0)),
  check (status <> 'void' or issued_at is null or amount_paid = 0),                     -- void its payments first
  check (doc_type <> 'receipt' or (status in ('draft', 'issued', 'void') and parent_document_id is not null and amount_paid = 0 and due_date is null)),
  check (doc_type <> 'invoice' or parent_document_id is null),
  check (replaces_document_id is null or (doc_type = 'invoice' and replaces_document_id <> id)),
  check (due_date is null or (doc_type = 'invoice' and (issue_date is null or due_date >= issue_date))),
  check ((source_type is null) = (source_id is null)),
  check ((status = 'void') = (voided_at is not null) and (voided_at is null) = (void_reason is null) and (voided_at is null) = (voided_by is null))
);
create unique index if not exists bk_documents_number_idx on bk_documents (profile_id, doc_type, number_year, number_seq) where number is not null;
create unique index if not exists bk_documents_number_text_idx on bk_documents (profile_id, doc_type, number) where number is not null;
create unique index if not exists bk_documents_request_idx on bk_documents (profile_id, client_request_id) where client_request_id is not null;
create unique index if not exists bk_documents_one_replacement_idx on bk_documents (replaces_document_id) where replaces_document_id is not null and status <> 'void';
create unique index if not exists bk_documents_source_idx on bk_documents (profile_id, doc_type, source_type, source_id) where source_id is not null and status <> 'void';
create index if not exists bk_documents_list_idx on bk_documents (profile_id, status, created_at desc);
create index if not exists bk_documents_type_date_idx on bk_documents (profile_id, doc_type, issue_date desc);
create index if not exists bk_documents_parent_idx on bk_documents (parent_document_id) where parent_document_id is not null;

create table if not exists bk_document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references bk_documents(id) on delete restrict,
  position int not null check (position between 1 and 100),
  description text not null check (char_length(btrim(description)) between 1 and 300),
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price numeric(14,3) not null check (unit_price >= 0 and unit_price <= 9999999999.999),
  gross_amount numeric(14,3) not null,
  discount_amount numeric(14,3) not null default 0,
  tax_amount numeric(14,3) not null default 0,
  line_total numeric(14,3) not null,
  product_id uuid,                                  -- traceability only: deliberately NO foreign key, history must not depend on products
  created_at timestamptz not null default now(),
  unique (document_id, position),
  check (discount_amount >= 0 and discount_amount <= gross_amount and tax_amount >= 0),
  check (line_total = gross_amount - discount_amount + tax_amount)
);

create table if not exists bk_document_counters (
  profile_id uuid not null references profiles(id) on delete restrict,
  doc_type text not null check (doc_type in ('invoice', 'receipt')),
  year int not null check (year between 2000 and 2999),
  last_number int not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, doc_type, year)
);

create table if not exists bk_document_payments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete restrict,
  invoice_id uuid not null,
  receipt_document_id uuid not null unique,
  bk_entry_id uuid not null unique references bk_entries(id) on delete restrict,
  amount numeric(14,3) not null check (amount > 0),
  currency text not null check (currency = upper(currency) and char_length(currency) = 3),
  method text not null check (method in ('cash', 'mobile_money', 'bank_transfer', 'card', 'other')),
  reference text check (reference is null or char_length(reference) <= 100),
  paid_on date not null,
  balance_after numeric(14,3) not null check (balance_after >= 0),
  client_request_id uuid not null,
  created_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.users(id) on delete restrict,
  void_reason text check (void_reason is null or char_length(btrim(void_reason)) between 1 and 300),
  foreign key (profile_id, invoice_id) references bk_documents (profile_id, id) on delete restrict,
  foreign key (profile_id, receipt_document_id) references bk_documents (profile_id, id) on delete restrict,
  unique (profile_id, client_request_id),
  check (amount = round(amount, bk_currency_digits(currency)) and balance_after = round(balance_after, bk_currency_digits(currency))),
  check ((voided_at is null) = (void_reason is null) and (voided_at is null) = (voided_by is null))
);
create index if not exists bk_document_payments_invoice_idx on bk_document_payments (invoice_id, created_at);

create table if not exists bk_document_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  profile_id uuid not null references profiles(id) on delete restrict,
  event_type text not null check (event_type in ('created', 'issued', 'payment_recorded', 'payment_voided', 'voided', 'replaced', 'share_created', 'share_revoked')),
  actor_user_id uuid references public.users(id) on delete restrict,
  details jsonb check (details is null or pg_column_size(details) <= 4096),
  created_at timestamptz not null default now(),
  foreign key (profile_id, document_id) references bk_documents (profile_id, id) on delete restrict
);
create index if not exists bk_document_events_doc_idx on bk_document_events (document_id, created_at);
create index if not exists bk_document_events_profile_idx on bk_document_events (profile_id, created_at desc);

create table if not exists bk_document_shares (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  profile_id uuid not null references profiles(id) on delete restrict,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),      -- sha-256 of a server-generated token; the raw token is never stored
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.users(id) on delete restrict,
  created_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  last_accessed_at timestamptz,
  access_count int not null default 0 check (access_count >= 0),
  foreign key (profile_id, document_id) references bk_documents (profile_id, id) on delete restrict,
  check (expires_at > created_at and expires_at <= created_at + interval '90 days'),
  check ((revoked_at is null) = (revoked_by is null))
);
create index if not exists bk_document_shares_doc_idx on bk_document_shares (document_id, created_at desc);

create table if not exists bk_document_rate_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('share_ip')),
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index if not exists bk_document_rate_events_idx on bk_document_rate_events (kind, subject_hash, created_at);

-- ============================================================================
-- 3. INTEGRITY GUARDS (fire for every writer, including the table owner and the service role)
-- ============================================================================
create or replace function bk_business_profiles_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'bk_business_profiles: rows are never deleted'; end if;
  if new.profile_id <> old.profile_id or new.created_at <> old.created_at then raise exception 'bk_business_profiles: identity is immutable'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists bk_business_profiles_guard_trg on bk_business_profiles;
create trigger bk_business_profiles_guard_trg before update or delete on bk_business_profiles for each row execute function bk_business_profiles_guard();

create or replace function bk_documents_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'bk_documents: documents are never deleted; void them instead'; end if;
  if new.id <> old.id or new.profile_id <> old.profile_id or new.doc_type <> old.doc_type or new.currency <> old.currency
     or new.created_at <> old.created_at or new.created_by is distinct from old.created_by then
    raise exception 'bk_documents: identity columns are immutable';
  end if;
  if old.status = 'void' then raise exception 'bk_documents: a void document cannot be changed'; end if;
  if not (new.status = old.status
       or (old.status = 'draft' and new.status in ('issued', 'void'))
       or (old.status = 'issued' and new.status in ('partially_paid', 'paid', 'void'))
       or (old.status = 'partially_paid' and new.status in ('issued', 'paid'))
       or (old.status = 'paid' and new.status in ('partially_paid', 'issued'))) then
    raise exception 'bk_documents: illegal status transition % -> %', old.status, new.status;
  end if;
  -- once issued (or when voiding a draft) every content column is frozen; only status, amount_paid and the void fields may move
  if old.status <> 'draft' or new.status = 'void' then
    if new.locale <> old.locale or new.number is distinct from old.number or new.number_year is distinct from old.number_year
       or new.number_seq is distinct from old.number_seq or new.issue_date is distinct from old.issue_date or new.due_date is distinct from old.due_date
       or new.customer_snapshot is distinct from old.customer_snapshot or new.seller_snapshot is distinct from old.seller_snapshot
       or new.type_snapshot is distinct from old.type_snapshot or new.subtotal <> old.subtotal or new.discount_total <> old.discount_total
       or new.tax_label is distinct from old.tax_label or new.tax_rate_bp is distinct from old.tax_rate_bp or new.tax_total <> old.tax_total
       or new.total <> old.total or new.notes is distinct from old.notes or new.terms is distinct from old.terms
       or new.parent_document_id is distinct from old.parent_document_id or new.replaces_document_id is distinct from old.replaces_document_id
       or new.source_type is distinct from old.source_type or new.source_id is distinct from old.source_id
       or new.template_version <> old.template_version or new.content_hash is distinct from old.content_hash
       or new.issued_at is distinct from old.issued_at or new.issued_by is distinct from old.issued_by
       or new.client_request_id is distinct from old.client_request_id then
      raise exception 'bk_documents: issued documents are immutable';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists bk_documents_guard_trg on bk_documents;
create trigger bk_documents_guard_trg before update or delete on bk_documents for each row execute function bk_documents_guard();

create or replace function bk_document_lines_guard() returns trigger language plpgsql as $$
declare v_doc record; v_calc record; v_digits int; v_doc_id uuid;
begin
  v_doc_id := case when tg_op = 'DELETE' then old.document_id else new.document_id end;
  select d.status, d.currency, d.tax_rate_bp into v_doc from bk_documents d where d.id = v_doc_id;
  if not found then raise exception 'bk_document_lines: parent document missing'; end if;
  if v_doc.status <> 'draft' then raise exception 'bk_document_lines: lines are frozen once the document is issued'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and new.document_id <> old.document_id then raise exception 'bk_document_lines: a line cannot move between documents'; end if;
  v_digits := bk_currency_digits(v_doc.currency);
  if new.unit_price <> round(new.unit_price, v_digits) or new.gross_amount <> round(new.gross_amount, v_digits)
     or new.discount_amount <> round(new.discount_amount, v_digits) or new.tax_amount <> round(new.tax_amount, v_digits)
     or new.line_total <> round(new.line_total, v_digits) then
    raise exception 'amount_too_precise';
  end if;
  select * into v_calc from bk_doc_compute_line(new.quantity, new.unit_price, new.discount_amount, v_doc.tax_rate_bp, v_digits);
  if v_calc.gross <> new.gross_amount or v_calc.discount <> new.discount_amount or v_calc.tax <> new.tax_amount or v_calc.total <> new.line_total then
    raise exception 'bk_document_lines: line amounts are inconsistent with quantity, price, discount and tax';
  end if;
  return new;
end $$;
drop trigger if exists bk_document_lines_guard_trg on bk_document_lines;
create trigger bk_document_lines_guard_trg before insert or update or delete on bk_document_lines for each row execute function bk_document_lines_guard();

create or replace function bk_document_counters_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'bk_document_counters: counters are never deleted'; end if;
  if new.profile_id <> old.profile_id or new.doc_type <> old.doc_type or new.year <> old.year then raise exception 'bk_document_counters: key is immutable'; end if;
  if new.last_number <> old.last_number + 1 then raise exception 'bk_document_counters: a counter only ever advances by one'; end if;
  return new;
end $$;
drop trigger if exists bk_document_counters_guard_trg on bk_document_counters;
create trigger bk_document_counters_guard_trg before update or delete on bk_document_counters for each row execute function bk_document_counters_guard();

create or replace function bk_document_payments_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'bk_document_payments: payments are never deleted; void them instead'; end if;
  if tg_op = 'INSERT' then
    perform 1 from bk_documents i where i.id = new.invoice_id and i.profile_id = new.profile_id and i.doc_type = 'invoice' and i.currency = new.currency;
    if not found then raise exception 'bk_document_payments: a payment must reference an invoice of the same business and currency'; end if;
    perform 1 from bk_documents r where r.id = new.receipt_document_id and r.profile_id = new.profile_id and r.doc_type = 'receipt' and r.parent_document_id = new.invoice_id;
    if not found then raise exception 'bk_document_payments: the receipt must belong to the invoice'; end if;
    return new;
  end if;
  if new.id <> old.id or new.profile_id <> old.profile_id or new.invoice_id <> old.invoice_id or new.receipt_document_id <> old.receipt_document_id
     or new.bk_entry_id <> old.bk_entry_id or new.amount <> old.amount or new.currency <> old.currency or new.method <> old.method
     or new.reference is distinct from old.reference or new.paid_on <> old.paid_on or new.balance_after <> old.balance_after
     or new.client_request_id <> old.client_request_id or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'bk_document_payments: payments are immutable; only voiding is allowed';
  end if;
  if old.voided_at is not null then raise exception 'bk_document_payments: payment already voided'; end if;
  return new;
end $$;
drop trigger if exists bk_document_payments_guard_trg on bk_document_payments;
create trigger bk_document_payments_guard_trg before insert or update or delete on bk_document_payments for each row execute function bk_document_payments_guard();

create or replace function bk_document_events_guard() returns trigger language plpgsql as $$
begin
  raise exception 'bk_document_events is append-only';
end $$;
drop trigger if exists bk_document_events_guard_trg on bk_document_events;
create trigger bk_document_events_guard_trg before update or delete on bk_document_events for each row execute function bk_document_events_guard();

create or replace function bk_document_shares_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'bk_document_shares: shares are never deleted; revoke them instead'; end if;
  if new.id <> old.id or new.document_id <> old.document_id or new.profile_id <> old.profile_id or new.token_hash <> old.token_hash
     or new.expires_at <> old.expires_at or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'bk_document_shares: only revocation and access counters may change';
  end if;
  if old.revoked_at is not null then raise exception 'bk_document_shares: share already revoked'; end if;
  if new.access_count <> old.access_count and new.access_count <> old.access_count + 1 then raise exception 'bk_document_shares: access_count only advances by one'; end if;
  return new;
end $$;
drop trigger if exists bk_document_shares_guard_trg on bk_document_shares;
create trigger bk_document_shares_guard_trg before update or delete on bk_document_shares for each row execute function bk_document_shares_guard();

-- TRUNCATE does not fire row triggers: reuse the Phase 1 statement-level guard on every Phase 2 record table.
drop trigger if exists bk_business_profiles_truncate_guard_trg on bk_business_profiles;
create trigger bk_business_profiles_truncate_guard_trg before truncate on bk_business_profiles for each statement execute function bk_truncate_guard();
drop trigger if exists bk_documents_truncate_guard_trg on bk_documents;
create trigger bk_documents_truncate_guard_trg before truncate on bk_documents for each statement execute function bk_truncate_guard();
drop trigger if exists bk_document_lines_truncate_guard_trg on bk_document_lines;
create trigger bk_document_lines_truncate_guard_trg before truncate on bk_document_lines for each statement execute function bk_truncate_guard();
drop trigger if exists bk_document_counters_truncate_guard_trg on bk_document_counters;
create trigger bk_document_counters_truncate_guard_trg before truncate on bk_document_counters for each statement execute function bk_truncate_guard();
drop trigger if exists bk_document_payments_truncate_guard_trg on bk_document_payments;
create trigger bk_document_payments_truncate_guard_trg before truncate on bk_document_payments for each statement execute function bk_truncate_guard();
drop trigger if exists bk_document_events_truncate_guard_trg on bk_document_events;
create trigger bk_document_events_truncate_guard_trg before truncate on bk_document_events for each statement execute function bk_truncate_guard();
drop trigger if exists bk_document_shares_truncate_guard_trg on bk_document_shares;
create trigger bk_document_shares_truncate_guard_trg before truncate on bk_document_shares for each statement execute function bk_truncate_guard();

-- ============================================================================
-- 4. INTERNAL HELPERS (not callable by any client role)
-- ============================================================================
-- The same checks as Phase 1, in one place: profile exists, NOT a demo profile, the actor IS the owner, the owner's plan has the
-- toolkit. Returns the profile's currency (server-authoritative; never taken from the client).
create or replace function bk_doc_gate(p_profile_id uuid, p_actor_user_id uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_profile record; v_enabled boolean;
begin
  select p.user_id, p.is_demo, upper(coalesce(nullif(btrim(p.currency), ''), 'XAF')) as currency
    into v_profile from profiles p where p.id = p_profile_id;
  if not found then raise exception 'profile_unavailable'; end if;
  if v_profile.is_demo is true then raise exception 'demo_profile_not_supported'; end if;
  if p_actor_user_id is null or v_profile.user_id is distinct from p_actor_user_id then raise exception 'not_owner'; end if;
  select coalesce(pl.business_toolkit_enabled, false) into v_enabled
    from users u left join plans pl on pl.id = u.plan_id where u.id = v_profile.user_id;
  if v_enabled is not true then raise exception 'toolkit_not_enabled'; end if;
  return v_profile.currency;
end $$;

create or replace function bk_doc_event(p_document_id uuid, p_profile_id uuid, p_type text, p_actor uuid, p_details jsonb) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into bk_document_events (document_id, profile_id, event_type, actor_user_id, details) values (p_document_id, p_profile_id, p_type, p_actor, p_details)
$$;

-- Whitelists and bounds-checks the customer object; text is kept EXACTLY as given (only blank values are dropped).
create or replace function bk_doc_clean_customer(p_customer jsonb) returns jsonb
language plpgsql immutable as $$
declare v_out jsonb := '{}'::jsonb; v_key text; v_val jsonb; v_max int; v_text text;
begin
  if p_customer is null or jsonb_typeof(p_customer) = 'null' then return null; end if;
  if jsonb_typeof(p_customer) <> 'object' then raise exception 'invalid_customer'; end if;
  for v_key, v_val in select key, value from jsonb_each(p_customer) loop
    if v_key not in ('name', 'phone', 'email', 'address', 'tax_id') then continue; end if;
    if jsonb_typeof(v_val) = 'null' then continue; end if;
    if jsonb_typeof(v_val) <> 'string' then raise exception 'invalid_customer'; end if;
    v_text := v_val #>> '{}';
    v_max := case v_key when 'name' then 120 when 'phone' then 40 when 'email' then 200 when 'address' then 300 else 60 end;
    if char_length(v_text) > v_max then raise exception 'invalid_customer'; end if;
    if btrim(v_text) = '' then continue; end if;
    v_out := v_out || jsonb_build_object(v_key, v_val);
  end loop;
  return v_out;
end $$;

create or replace function bk_doc_seller_snapshot(p_profile_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
           'display_name', coalesce(bp.display_name, nullif(btrim(p.name), ''), p.username),
           'legal_name', bp.legal_name, 'address', bp.address, 'phone', bp.phone, 'email', bp.email,
           'tax_id', bp.tax_id, 'registration_no', bp.registration_no)
    from profiles p left join bk_business_profiles bp on bp.profile_id = p.id where p.id = p_profile_id
$$;

-- Canonical content hash of an ISSUED document (everything that is frozen at issue). jsonb text is deterministic.
create or replace function bk_doc_hash_of(p_doc bk_documents) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_lines jsonb; v_canon jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('position', l.position, 'description', l.description, 'quantity', l.quantity,
           'unit_price', l.unit_price, 'gross', l.gross_amount, 'discount', l.discount_amount, 'tax', l.tax_amount,
           'total', l.line_total, 'product_id', l.product_id) order by l.position), '[]'::jsonb)
    into v_lines from bk_document_lines l where l.document_id = p_doc.id;
  v_canon := jsonb_build_object('v', p_doc.template_version, 'id', p_doc.id, 'profile_id', p_doc.profile_id, 'type', p_doc.doc_type,
    'number', p_doc.number, 'currency', p_doc.currency, 'locale', p_doc.locale, 'issue_date', p_doc.issue_date, 'due_date', p_doc.due_date,
    'seller', p_doc.seller_snapshot, 'customer', p_doc.customer_snapshot, 'type_snapshot', p_doc.type_snapshot,
    'subtotal', p_doc.subtotal, 'discount', p_doc.discount_total, 'tax_label', p_doc.tax_label, 'tax_rate_bp', p_doc.tax_rate_bp,
    'tax', p_doc.tax_total, 'total', p_doc.total, 'notes', p_doc.notes, 'terms', p_doc.terms,
    'parent', p_doc.parent_document_id, 'replaces', p_doc.replaces_document_id, 'lines', v_lines);
  return encode(sha256(convert_to(v_canon::text, 'UTF8')), 'hex');
end $$;

create or replace function bk_doc_bundle(p_document_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('document', to_jsonb(d),
           'lines', coalesce((select jsonb_agg(to_jsonb(l) order by l.position) from bk_document_lines l where l.document_id = d.id), '[]'::jsonb))
    from bk_documents d where d.id = p_document_id
$$;

create or replace function bk_doc_payment_bundle(p_payment_id uuid, p_flag_name text, p_flag boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('payment', to_jsonb(p), 'receipt', bk_doc_bundle(p.receipt_document_id),
           'invoice', to_jsonb(i), p_flag_name, p_flag)
    from bk_document_payments p join bk_documents i on i.id = p.invoice_id where p.id = p_payment_id
$$;

-- Issues a DRAFT document: allocates the number from the atomic counter, stamps the server date, freezes the snapshots and the hash.
-- Shared by doc_issue (invoices) and doc_record_payment (receipts). The counter increment is part of the caller's transaction, so a
-- failure anywhere later undoes it (no number is consumed by a failed issue).
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

-- ============================================================================
-- 5. SERVICE-ROLE FUNCTIONS
-- ============================================================================
create or replace function doc_upsert_business_profile(
  p_profile_id uuid, p_actor_user_id uuid, p_display_name text, p_legal_name text, p_address text, p_phone text, p_email text,
  p_tax_id text, p_registration_no text, p_default_terms text, p_default_due_days int, p_tax_label text, p_tax_rate_bp int)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row bk_business_profiles;
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_display_name is null or btrim(p_display_name) = '' or char_length(p_display_name) > 120 then raise exception 'invalid_display_name'; end if;
  if (bk_doc_blank_null(p_tax_label) is null) <> (p_tax_rate_bp is null) then raise exception 'tax_incomplete'; end if;
  if p_tax_rate_bp is not null and (p_tax_rate_bp < 0 or p_tax_rate_bp > 10000) then raise exception 'invalid_tax_rate'; end if;
  if p_default_due_days is not null and (p_default_due_days < 0 or p_default_due_days > 365) then raise exception 'invalid_due_days'; end if;
  insert into bk_business_profiles as b (profile_id, display_name, legal_name, address, phone, email, tax_id, registration_no, default_terms,
                                         default_due_days, tax_label, tax_rate_bp, updated_by)
  values (p_profile_id, p_display_name, bk_doc_blank_null(p_legal_name), bk_doc_blank_null(p_address), bk_doc_blank_null(p_phone),
          bk_doc_blank_null(p_email), bk_doc_blank_null(p_tax_id), bk_doc_blank_null(p_registration_no), bk_doc_blank_null(p_default_terms),
          p_default_due_days, bk_doc_blank_null(p_tax_label), p_tax_rate_bp, p_actor_user_id)
  on conflict (profile_id) do update set display_name = excluded.display_name, legal_name = excluded.legal_name, address = excluded.address,
    phone = excluded.phone, email = excluded.email, tax_id = excluded.tax_id, registration_no = excluded.registration_no,
    default_terms = excluded.default_terms, default_due_days = excluded.default_due_days, tax_label = excluded.tax_label,
    tax_rate_bp = excluded.tax_rate_bp, updated_by = excluded.updated_by
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

-- Create (idempotent on client_request_id) or fully replace a DRAFT invoice. Totals are computed here, in SQL, and are authoritative.
create or replace function doc_save_draft(
  p_profile_id uuid, p_actor_user_id uuid, p_document_id uuid, p_doc_type text, p_locale text, p_customer jsonb, p_due_date date,
  p_notes text, p_terms text, p_tax_enabled boolean, p_lines jsonb, p_replaces_document_id uuid, p_client_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_currency text; v_doc bk_documents; v_digits int; v_bp record; v_label text; v_rate int; v_customer jsonb;
  v_elem jsonb; v_ord bigint; v_desc text; v_qty numeric; v_unit numeric; v_disc numeric; v_calc record; v_pid uuid; v_txt text;
  v_sub numeric := 0; v_dis numeric := 0; v_tax numeric := 0; v_tot numeric := 0; v_rows jsonb[] := '{}'; v_old bk_documents;
begin
  v_currency := bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_doc_type is distinct from 'invoice' then raise exception 'unsupported_document_type'; end if;
  if p_locale is null or p_locale not in ('en', 'fr') then raise exception 'invalid_locale'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'invalid_lines'; end if;
  if jsonb_array_length(p_lines) > 100 then raise exception 'too_many_lines'; end if;
  if p_notes is not null and char_length(p_notes) > 1000 then raise exception 'invalid_notes'; end if;
  if p_terms is not null and char_length(p_terms) > 1000 then raise exception 'invalid_terms'; end if;
  v_customer := bk_doc_clean_customer(p_customer);

  if p_document_id is null then
    if p_client_request_id is not null then
      perform pg_advisory_xact_lock(hashtextextended('docdraft:' || p_profile_id::text || ':' || p_client_request_id::text, 0));
      select * into v_doc from bk_documents where profile_id = p_profile_id and client_request_id = p_client_request_id;
      if found then return bk_doc_bundle(v_doc.id) || jsonb_build_object('duplicate', true); end if;
    end if;
  else
    select * into v_doc from bk_documents where id = p_document_id and profile_id = p_profile_id for update;
    if not found then raise exception 'document_not_found'; end if;
    if v_doc.doc_type <> 'invoice' or v_doc.status <> 'draft' then raise exception 'document_not_draft'; end if;
    v_currency := v_doc.currency;       -- a draft keeps the currency it was created in; doc_issue re-checks it against the profile
  end if;
  v_digits := bk_currency_digits(v_currency);

  if p_tax_enabled is true then
    select tax_label, tax_rate_bp into v_bp from bk_business_profiles where profile_id = p_profile_id;
    if not found or v_bp.tax_label is null or v_bp.tax_rate_bp is null then raise exception 'tax_not_configured'; end if;
    v_label := v_bp.tax_label; v_rate := v_bp.tax_rate_bp;
  end if;

  if p_replaces_document_id is not null then
    select * into v_old from bk_documents where id = p_replaces_document_id and profile_id = p_profile_id;
    if not found or v_old.doc_type <> 'invoice' or v_old.status <> 'void' or v_old.issued_at is null then raise exception 'invalid_replacement'; end if;
  end if;

  -- validate and compute every line first (nothing is written until all are valid)
  for v_elem, v_ord in select e, o from jsonb_array_elements(p_lines) with ordinality as t(e, o) loop
    if jsonb_typeof(v_elem) <> 'object' then raise exception 'invalid_line'; end if;
    if jsonb_typeof(v_elem -> 'description') is distinct from 'string' then raise exception 'invalid_description'; end if;
    v_desc := v_elem ->> 'description';
    if char_length(btrim(v_desc)) not between 1 and 300 then raise exception 'invalid_description'; end if;
    v_txt := v_elem ->> 'quantity';
    if v_txt is null or v_txt !~ '^[0-9]{1,9}(\.[0-9]{1,3})?$' then raise exception 'invalid_quantity'; end if;
    v_qty := v_txt::numeric;
    v_txt := v_elem ->> 'unit_price';
    if v_txt is null or v_txt !~ '^[0-9]{1,10}(\.[0-9]{1,3})?$' then raise exception 'invalid_unit_price'; end if;
    v_unit := v_txt::numeric;
    if v_unit <> round(v_unit, v_digits) then raise exception 'amount_too_precise'; end if;
    v_txt := coalesce(v_elem ->> 'discount_amount', '0');
    if v_txt !~ '^[0-9]{1,10}(\.[0-9]{1,3})?$' then raise exception 'invalid_discount'; end if;
    v_disc := v_txt::numeric;
    if v_disc <> round(v_disc, v_digits) then raise exception 'amount_too_precise'; end if;
    v_pid := null;
    if v_elem ? 'product_id' and jsonb_typeof(v_elem -> 'product_id') <> 'null' then
      v_txt := v_elem ->> 'product_id';
      if jsonb_typeof(v_elem -> 'product_id') <> 'string' or v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'invalid_product'; end if;
      v_pid := v_txt::uuid;
      if not exists (select 1 from products where id = v_pid and profile_id = p_profile_id) then raise exception 'product_not_found'; end if;
    end if;
    select * into v_calc from bk_doc_compute_line(v_qty, v_unit, v_disc, v_rate, v_digits);
    v_sub := v_sub + v_calc.gross; v_dis := v_dis + v_calc.discount; v_tax := v_tax + v_calc.tax; v_tot := v_tot + v_calc.total;
    v_rows := v_rows || jsonb_build_object('position', v_ord, 'description', v_desc, 'quantity', v_qty, 'unit_price', v_unit,
                'gross', v_calc.gross, 'discount', v_calc.discount, 'tax', v_calc.tax, 'total', v_calc.total, 'product_id', v_pid);
  end loop;
  if v_sub > 9999999999.999 or v_tot > 9999999999.999 then raise exception 'amount_too_large'; end if;

  if p_document_id is null then
    insert into bk_documents (profile_id, doc_type, status, locale, currency, customer_snapshot, due_date, notes, terms, tax_label, tax_rate_bp,
                              subtotal, discount_total, tax_total, total, replaces_document_id, client_request_id, created_by)
    values (p_profile_id, 'invoice', 'draft', p_locale, v_currency, v_customer, p_due_date, bk_doc_blank_null(p_notes), bk_doc_blank_null(p_terms),
            v_label, v_rate, v_sub, v_dis, v_tax, v_tot, p_replaces_document_id, p_client_request_id, p_actor_user_id)
    returning * into v_doc;
    perform bk_doc_event(v_doc.id, p_profile_id, 'created', p_actor_user_id, jsonb_build_object('type', 'invoice'));
  else
    delete from bk_document_lines where document_id = v_doc.id;
    update bk_documents set locale = p_locale, customer_snapshot = v_customer, due_date = p_due_date, notes = bk_doc_blank_null(p_notes),
           terms = bk_doc_blank_null(p_terms), tax_label = v_label, tax_rate_bp = v_rate, subtotal = v_sub, discount_total = v_dis,
           tax_total = v_tax, total = v_tot, replaces_document_id = p_replaces_document_id
     where id = v_doc.id returning * into v_doc;
  end if;

  insert into bk_document_lines (document_id, position, description, quantity, unit_price, gross_amount, discount_amount, tax_amount, line_total, product_id)
  select v_doc.id, (r ->> 'position')::int, r ->> 'description', (r ->> 'quantity')::numeric, (r ->> 'unit_price')::numeric, (r ->> 'gross')::numeric,
         (r ->> 'discount')::numeric, (r ->> 'tax')::numeric, (r ->> 'total')::numeric, nullif(r ->> 'product_id', '')::uuid
    from unnest(v_rows) as r;
  return bk_doc_bundle(v_doc.id) || jsonb_build_object('duplicate', false);
end $$;

create or replace function doc_issue(p_profile_id uuid, p_actor_user_id uuid, p_document_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_currency text; v_doc bk_documents; v_sum record; v_bp record; v_today date; v_due date;
begin
  v_currency := bk_doc_gate(p_profile_id, p_actor_user_id);
  select * into v_doc from bk_documents where id = p_document_id and profile_id = p_profile_id for update;
  if not found then raise exception 'document_not_found'; end if;
  if v_doc.doc_type <> 'invoice' then raise exception 'unsupported_document_type'; end if;
  if v_doc.status in ('issued', 'partially_paid', 'paid') then
    return bk_doc_bundle(v_doc.id) || jsonb_build_object('already_issued', true);
  end if;
  if v_doc.status = 'void' then raise exception 'document_void'; end if;
  if v_doc.currency <> v_currency then raise exception 'currency_changed'; end if;
  select count(*) as n, coalesce(sum(gross_amount), 0) as gross, coalesce(sum(discount_amount), 0) as disc, coalesce(sum(tax_amount), 0) as tax,
         coalesce(sum(line_total), 0) as total into v_sum from bk_document_lines where document_id = v_doc.id;
  if v_sum.n = 0 then raise exception 'no_lines'; end if;
  if v_sum.gross <> v_doc.subtotal or v_sum.disc <> v_doc.discount_total or v_sum.tax <> v_doc.tax_total or v_sum.total <> v_doc.total then raise exception 'totals_mismatch'; end if;
  if v_doc.total <= 0 then raise exception 'zero_total'; end if;
  if coalesce(btrim(v_doc.customer_snapshot ->> 'name'), '') = '' then raise exception 'customer_required'; end if;
  select default_due_days into v_bp from bk_business_profiles where profile_id = p_profile_id;
  v_today := (now() at time zone 'Africa/Douala')::date;
  v_due := v_doc.due_date;
  if v_due is null and v_bp.default_due_days is not null then v_due := v_today + v_bp.default_due_days; end if;
  if v_due is not null and v_due < v_today then raise exception 'invalid_due_date'; end if;
  v_doc := bk_doc_issue_core(v_doc, p_actor_user_id, bk_doc_seller_snapshot(p_profile_id), null, v_due);
  if v_doc.replaces_document_id is not null then
    perform bk_doc_event(v_doc.replaces_document_id, p_profile_id, 'replaced', p_actor_user_id, jsonb_build_object('replaced_by', v_doc.id, 'number', v_doc.number));
  end if;
  return bk_doc_bundle(v_doc.id) || jsonb_build_object('already_issued', false);
end $$;

-- One recorded payment = one receipt + one payment row + exactly one Phase 1 'sale' entry, in this single function body (one
-- transaction). A failure at any step raises and rolls ALL of it back, so none can exist without the others.
create or replace function doc_record_payment(
  p_profile_id uuid, p_actor_user_id uuid, p_invoice_id uuid, p_amount numeric, p_method text, p_reference text, p_paid_on date, p_client_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_currency text; v_digits int; v_inv bk_documents; v_existing bk_document_payments; v_today date; v_new_paid numeric;
  v_receipt bk_documents; v_payment_id uuid := gen_random_uuid(); v_entry jsonb; v_ref text;
begin
  v_currency := bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_client_request_id is null then raise exception 'request_id_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('docpay:' || p_profile_id::text || ':' || p_client_request_id::text, 0));
  select * into v_existing from bk_document_payments where profile_id = p_profile_id and client_request_id = p_client_request_id;
  if found then return bk_doc_payment_bundle(v_existing.id, 'duplicate', true); end if;     -- idempotent: never re-enters bookkeeping

  select * into v_inv from bk_documents where id = p_invoice_id and profile_id = p_profile_id and doc_type = 'invoice' for update;
  if not found then raise exception 'document_not_found'; end if;
  if v_inv.status not in ('issued', 'partially_paid') then raise exception 'invoice_not_payable'; end if;
  if v_inv.currency <> v_currency then raise exception 'currency_changed'; end if;
  v_digits := bk_currency_digits(v_currency);
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  if p_amount <> round(p_amount, v_digits) then raise exception 'amount_too_precise'; end if;
  if p_method is null or p_method not in ('cash', 'mobile_money', 'bank_transfer', 'card', 'other') then raise exception 'invalid_method'; end if;
  v_ref := bk_doc_blank_null(p_reference);
  if v_ref is not null and char_length(v_ref) > 100 then raise exception 'invalid_reference'; end if;
  v_today := (now() at time zone 'Africa/Douala')::date;
  if p_paid_on is null or p_paid_on > v_today or p_paid_on < v_inv.issue_date then raise exception 'invalid_paid_on'; end if;
  if p_amount > v_inv.total - v_inv.amount_paid then raise exception 'exceeds_balance'; end if;
  v_new_paid := v_inv.amount_paid + p_amount;

  -- the receipt: created as a draft, given its single line, then issued through the same core as invoices (RCT-YYYY-NNNN)
  insert into bk_documents (profile_id, doc_type, status, locale, currency, customer_snapshot, subtotal, discount_total, tax_total, total, parent_document_id, created_by)
  values (p_profile_id, 'receipt', 'draft', v_inv.locale, v_inv.currency, v_inv.customer_snapshot, p_amount, 0, 0, p_amount, v_inv.id, p_actor_user_id)
  returning * into v_receipt;
  insert into bk_document_lines (document_id, position, description, quantity, unit_price, gross_amount, discount_amount, tax_amount, line_total)
  values (v_receipt.id, 1, v_inv.number, 1, p_amount, p_amount, 0, 0, p_amount);
  v_receipt := bk_doc_issue_core(v_receipt, p_actor_user_id, v_inv.seller_snapshot,
    jsonb_build_object('payment_id', v_payment_id, 'method', p_method, 'reference', v_ref, 'paid_on', p_paid_on, 'amount', p_amount,
                       'balance_after', v_inv.total - v_new_paid, 'invoice_id', v_inv.id, 'invoice_number', v_inv.number), null);

  -- the ONE bookkeeping entry (Phase 1). Its idempotency key is this payment's own fresh id, so it can never collide with a manual
  -- entry. The description carries the invoice number only — no customer name in bookkeeping.
  v_entry := bk_record_entry(p_profile_id, p_actor_user_id, 'sale', p_amount, p_paid_on, 'invoice_payment', v_inv.number, true, null, null, null, v_payment_id);
  if (v_entry ->> 'duplicate')::boolean is true then raise exception 'bookkeeping_conflict'; end if;

  insert into bk_document_payments (id, profile_id, invoice_id, receipt_document_id, bk_entry_id, amount, currency, method, reference, paid_on,
                                    balance_after, client_request_id, created_by)
  values (v_payment_id, p_profile_id, v_inv.id, v_receipt.id, (v_entry -> 'entry' ->> 'id')::uuid, p_amount, v_inv.currency, p_method, v_ref, p_paid_on,
          v_inv.total - v_new_paid, p_client_request_id, p_actor_user_id);
  update bk_documents set amount_paid = v_new_paid, status = case when v_new_paid = total then 'paid' else 'partially_paid' end where id = v_inv.id;
  perform bk_doc_event(v_inv.id, p_profile_id, 'payment_recorded', p_actor_user_id,
    jsonb_build_object('payment_id', v_payment_id, 'receipt_id', v_receipt.id, 'amount', p_amount, 'balance_after', v_inv.total - v_new_paid));
  return bk_doc_payment_bundle(v_payment_id, 'duplicate', false);
end $$;

create or replace function doc_void_payment(p_profile_id uuid, p_actor_user_id uuid, p_payment_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pay bk_document_payments; v_inv bk_documents; v_new_paid numeric; v_reason text;
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_reason is null or btrim(p_reason) = '' or char_length(p_reason) > 300 then raise exception 'reason_required'; end if;
  v_reason := left(btrim(p_reason), 300);
  select * into v_pay from bk_document_payments where id = p_payment_id and profile_id = p_profile_id;
  if not found then raise exception 'payment_not_found'; end if;
  select * into v_inv from bk_documents where id = v_pay.invoice_id and profile_id = p_profile_id for update;      -- invoice first (lock order)
  select * into v_pay from bk_document_payments where id = p_payment_id for update;
  if v_pay.voided_at is not null then return bk_doc_payment_bundle(v_pay.id, 'already_voided', true); end if;
  perform bk_void_entry(p_profile_id, p_actor_user_id, v_pay.bk_entry_id, v_reason);      -- Phase 1 void (idempotent if it was already voided)
  update bk_document_payments set voided_at = now(), voided_by = p_actor_user_id, void_reason = v_reason where id = v_pay.id;
  update bk_documents set status = 'void', voided_at = now(), voided_by = p_actor_user_id, void_reason = v_reason where id = v_pay.receipt_document_id;
  v_new_paid := v_inv.amount_paid - v_pay.amount;
  update bk_documents set amount_paid = v_new_paid,
         status = case when v_new_paid = 0 then 'issued' when v_new_paid = total then 'paid' else 'partially_paid' end where id = v_inv.id;
  perform bk_doc_event(v_inv.id, p_profile_id, 'payment_voided', p_actor_user_id, jsonb_build_object('payment_id', v_pay.id, 'amount', v_pay.amount));
  perform bk_doc_event(v_pay.receipt_document_id, p_profile_id, 'voided', p_actor_user_id, jsonb_build_object('payment_id', v_pay.id));
  return bk_doc_payment_bundle(v_pay.id, 'already_voided', false);
end $$;

create or replace function doc_void_document(p_profile_id uuid, p_actor_user_id uuid, p_document_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_doc bk_documents; v_reason text;
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_reason is null or btrim(p_reason) = '' or char_length(p_reason) > 300 then raise exception 'reason_required'; end if;
  v_reason := left(btrim(p_reason), 300);
  select * into v_doc from bk_documents where id = p_document_id and profile_id = p_profile_id for update;
  if not found then raise exception 'document_not_found'; end if;
  if v_doc.doc_type = 'receipt' then raise exception 'use_void_payment'; end if;
  if v_doc.status = 'void' then return bk_doc_bundle(v_doc.id) || jsonb_build_object('already_voided', true); end if;
  if v_doc.amount_paid > 0 then raise exception 'invoice_has_payments'; end if;
  update bk_documents set status = 'void', voided_at = now(), voided_by = p_actor_user_id, void_reason = v_reason where id = v_doc.id;
  perform bk_doc_event(v_doc.id, p_profile_id, 'voided', p_actor_user_id, jsonb_build_object('number', v_doc.number));
  return bk_doc_bundle(v_doc.id) || jsonb_build_object('already_voided', false);
end $$;

create or replace function doc_create_share(p_profile_id uuid, p_actor_user_id uuid, p_document_id uuid, p_token_hash text, p_expires_in_days int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_doc bk_documents; v_share bk_document_shares; v_days int := coalesce(p_expires_in_days, 14);
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_token_hash'; end if;
  if v_days < 1 or v_days > 90 then raise exception 'invalid_expiry'; end if;
  select * into v_doc from bk_documents where id = p_document_id and profile_id = p_profile_id for update;
  if not found then raise exception 'document_not_found'; end if;
  if v_doc.status not in ('issued', 'partially_paid', 'paid') then raise exception 'document_not_shareable'; end if;
  if (select count(*) from bk_document_shares where document_id = v_doc.id and revoked_at is null and expires_at > now()) >= 5 then raise exception 'too_many_shares'; end if;
  insert into bk_document_shares (document_id, profile_id, token_hash, expires_at, created_by)
  values (v_doc.id, p_profile_id, p_token_hash, now() + make_interval(days => v_days), p_actor_user_id) returning * into v_share;
  perform bk_doc_event(v_doc.id, p_profile_id, 'share_created', p_actor_user_id, jsonb_build_object('share_id', v_share.id, 'expires_at', v_share.expires_at));
  return jsonb_build_object('share_id', v_share.id, 'document_id', v_doc.id, 'expires_at', v_share.expires_at);
end $$;

create or replace function doc_revoke_share(p_profile_id uuid, p_actor_user_id uuid, p_share_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_share bk_document_shares;
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  select * into v_share from bk_document_shares where id = p_share_id and profile_id = p_profile_id for update;
  if not found then raise exception 'share_not_found'; end if;
  if v_share.revoked_at is not null then return jsonb_build_object('share_id', v_share.id, 'already_revoked', true); end if;
  update bk_document_shares set revoked_at = now(), revoked_by = p_actor_user_id where id = v_share.id;
  perform bk_doc_event(v_share.document_id, p_profile_id, 'share_revoked', p_actor_user_id, jsonb_build_object('share_id', v_share.id));
  return jsonb_build_object('share_id', v_share.id, 'already_revoked', false);
end $$;

-- Public-route helper: the token IS the capability, so no owner check. Uniform null for unknown / revoked / expired. A shared
-- document stays reachable after a plan downgrade (history is never hidden); a voided document is returned with its void status.
create or replace function doc_resolve_share(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_share bk_document_shares; v_doc record;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into v_share from bk_document_shares where token_hash = p_token_hash for update;
  if not found or v_share.revoked_at is not null or v_share.expires_at <= now() then return null; end if;
  select d.id, d.profile_id, d.doc_type, d.status into v_doc from bk_documents d where d.id = v_share.document_id;
  update bk_document_shares set last_accessed_at = now(), access_count = access_count + 1 where id = v_share.id;
  return jsonb_build_object('document_id', v_doc.id, 'profile_id', v_doc.profile_id, 'doc_type', v_doc.doc_type, 'status', v_doc.status);
end $$;

create or replace function bk_doc_hash(p_document_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select bk_doc_hash_of(d) from bk_documents d where d.id = p_document_id
$$;

-- Same proven design as commerce_rate_limit_hit (keyed-hash subject, advisory lock, self-pruning), with its own kind whitelist.
create or replace function bk_doc_rate_limit_hit(p_kind text, p_subject_hash text, p_window_seconds int, p_max int) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int;
begin
  if p_kind is null or p_kind not in ('share_ip') or p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$'
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 172800 or p_max is null or p_max < 1 or p_max > 1000 then
    raise exception 'invalid_rate_limit_args';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bkdoc_rate:' || p_kind || ':' || p_subject_hash, 0));
  select count(*) into v_count from bk_document_rate_events where kind = p_kind and subject_hash = p_subject_hash
     and created_at > now() - make_interval(secs => p_window_seconds);
  if v_count >= p_max then return false; end if;
  insert into bk_document_rate_events (kind, subject_hash) values (p_kind, p_subject_hash);
  if random() < 0.02 then
    delete from bk_document_rate_events where id in (select id from bk_document_rate_events where created_at < now() - interval '2 days' limit 500);
  end if;
  return true;
end $$;

-- ============================================================================
-- 6. EXECUTE PRIVILEGES (explicit: nothing is left to Supabase's default grants)
-- ============================================================================
do $$
declare r record;
begin
  -- every Phase 2 function: no client role, and not even service_role, unless re-granted below
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in (
              'bk_doc_number', 'bk_doc_compute_line', 'bk_doc_blank_null', 'bk_doc_gate', 'bk_doc_event', 'bk_doc_clean_customer',
              'bk_doc_seller_snapshot', 'bk_doc_hash_of', 'bk_doc_bundle', 'bk_doc_payment_bundle', 'bk_doc_issue_core',
              'doc_upsert_business_profile', 'doc_save_draft', 'doc_issue', 'doc_record_payment', 'doc_void_payment', 'doc_void_document',
              'doc_create_share', 'doc_revoke_share', 'doc_resolve_share', 'bk_doc_hash', 'bk_doc_rate_limit_hit',
              'bk_business_profiles_guard', 'bk_documents_guard', 'bk_document_lines_guard', 'bk_document_counters_guard',
              'bk_document_payments_guard', 'bk_document_events_guard', 'bk_document_shares_guard')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
  end loop;
  -- only the entry points the trusted server routes call
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in (
              'doc_upsert_business_profile', 'doc_save_draft', 'doc_issue', 'doc_record_payment', 'doc_void_payment', 'doc_void_document',
              'doc_create_share', 'doc_revoke_share', 'doc_resolve_share', 'bk_doc_hash', 'bk_doc_rate_limit_hit')
  loop
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- ============================================================================
-- 7. ROW LEVEL SECURITY AND TABLE PRIVILEGES
-- ============================================================================
alter table bk_business_profiles enable row level security;
alter table bk_documents enable row level security;
alter table bk_document_lines enable row level security;
alter table bk_document_counters enable row level security;
alter table bk_document_payments enable row level security;
alter table bk_document_events enable row level security;
alter table bk_document_shares enable row level security;
alter table bk_document_rate_events enable row level security;

-- Supabase's defaults grant ALL on new public tables to anon, authenticated and service_role: revoke all, then grant back only SELECT.
-- There is deliberately NO INSERT/UPDATE/DELETE grant for any role: rows change only through the guarded functions above.
revoke all on bk_business_profiles, bk_documents, bk_document_lines, bk_document_counters, bk_document_payments, bk_document_events,
              bk_document_shares, bk_document_rate_events from anon, authenticated, service_role;
grant select on bk_business_profiles, bk_documents, bk_document_lines, bk_document_payments, bk_document_events to authenticated, service_role;
-- share metadata only: the token hash column is never readable by a client role
grant select (id, document_id, profile_id, expires_at, revoked_at, revoked_by, created_by, created_at, last_accessed_at, access_count)
  on bk_document_shares to authenticated, service_role;
-- bk_document_counters and bk_document_rate_events: no grant to anyone (reached only through the definer functions)

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'bk_business_profiles' and policyname = 'bk_business_profiles owner read') then
    create policy "bk_business_profiles owner read" on bk_business_profiles for select to authenticated
      using (exists (select 1 from profiles p where p.id = profile_id and p.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'bk_documents' and policyname = 'bk_documents owner read') then
    create policy "bk_documents owner read" on bk_documents for select to authenticated
      using (exists (select 1 from profiles p where p.id = profile_id and p.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'bk_document_lines' and policyname = 'bk_document_lines owner read') then
    create policy "bk_document_lines owner read" on bk_document_lines for select to authenticated
      using (exists (select 1 from bk_documents d join profiles p on p.id = d.profile_id where d.id = document_id and p.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'bk_document_payments' and policyname = 'bk_document_payments owner read') then
    create policy "bk_document_payments owner read" on bk_document_payments for select to authenticated
      using (exists (select 1 from profiles p where p.id = profile_id and p.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'bk_document_events' and policyname = 'bk_document_events owner read') then
    create policy "bk_document_events owner read" on bk_document_events for select to authenticated
      using (exists (select 1 from profiles p where p.id = profile_id and p.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'bk_document_shares' and policyname = 'bk_document_shares owner read') then
    create policy "bk_document_shares owner read" on bk_document_shares for select to authenticated
      using (exists (select 1 from profiles p where p.id = profile_id and p.user_id = auth.uid()));
  end if;
end $$;

commit;

-- ============================================================================
-- ROLLBACK (documented only; NOT part of the migration). Touches ONLY objects this migration created: name-exact, no CASCADE.
-- Safe only while the Phase 2 tables hold no real data (dropping them deletes invoices, receipts and payment records — export
-- first). It does not touch bk_entries: bookkeeping entries created by recorded payments remain (void them first through
-- doc_void_payment if the payments must be reversed before rolling back).
-- ============================================================================
--   begin;
--   drop function if exists doc_resolve_share(text);
--   drop function if exists doc_revoke_share(uuid, uuid, uuid);
--   drop function if exists doc_create_share(uuid, uuid, uuid, text, int);
--   drop function if exists doc_void_document(uuid, uuid, uuid, text);
--   drop function if exists doc_void_payment(uuid, uuid, uuid, text);
--   drop function if exists doc_record_payment(uuid, uuid, uuid, numeric, text, text, date, uuid);
--   drop function if exists doc_issue(uuid, uuid, uuid);
--   drop function if exists doc_save_draft(uuid, uuid, uuid, text, text, jsonb, date, text, text, boolean, jsonb, uuid, uuid);
--   drop function if exists doc_upsert_business_profile(uuid, uuid, text, text, text, text, text, text, text, text, int, text, int);
--   drop function if exists bk_doc_rate_limit_hit(text, text, int, int);
--   drop function if exists bk_doc_hash(uuid);
--   drop function if exists bk_doc_issue_core(bk_documents, uuid, jsonb, jsonb, date);   -- takes the table's row type: must go before the table
--   drop function if exists bk_doc_hash_of(bk_documents);                                -- same
--   drop table if exists bk_document_rate_events;
--   drop table if exists bk_document_payments;
--   drop table if exists bk_document_shares;
--   drop table if exists bk_document_events;
--   drop table if exists bk_document_lines;
--   drop table if exists bk_document_counters;
--   drop table if exists bk_documents;
--   drop table if exists bk_business_profiles;
--   drop function if exists bk_doc_payment_bundle(uuid, text, boolean);
--   drop function if exists bk_doc_bundle(uuid);
--   drop function if exists bk_doc_seller_snapshot(uuid);
--   drop function if exists bk_doc_clean_customer(jsonb);
--   drop function if exists bk_doc_event(uuid, uuid, text, uuid, jsonb);
--   drop function if exists bk_doc_gate(uuid, uuid);
--   drop function if exists bk_business_profiles_guard();
--   drop function if exists bk_documents_guard();
--   drop function if exists bk_document_lines_guard();
--   drop function if exists bk_document_counters_guard();
--   drop function if exists bk_document_payments_guard();
--   drop function if exists bk_document_events_guard();
--   drop function if exists bk_document_shares_guard();
--   drop function if exists bk_doc_compute_line(numeric, numeric, numeric, int, int);
--   drop function if exists bk_doc_blank_null(text);
--   drop function if exists bk_doc_number(text, int, int);
--   commit;
