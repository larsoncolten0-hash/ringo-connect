-- Business Toolkit — Phase 3 (Debtors, Credit Sales & Payment Reminders) — PROPOSED, NOT APPLIED.
--
-- Canonical design: docs/business-toolkit-phase3-debtors-reminders.md. Applied manually in the Supabase SQL editor, like every other
-- file in this folder. 2026-12-03 is the next slot (latest: 2026-12-02_documents_invoices_receipts.sql).
-- Run supabase/support/2026-12-03_debtors_reminders.preflight.sql first, and ...verify.sql afterwards.
--
-- What it changes
--   NEW   tables: bk_customers, bk_document_customer_links, bk_customer_events, bk_reminder_settings, bk_reminders
--   NEW   functions: the bk_customer_* / doc_* service-role functions and the bk_norm_* / bk_rem_* helpers listed in section 6,
--         plus the guard triggers.
--   NOTHING else. No Phase 1 or Phase 2 table, column, row, constraint, trigger, function or policy is modified. bk_documents,
--   bk_document_payments, bk_document_shares, bk_entries, email_suppressions, profiles, users and plans are only READ.
--
-- Debt model: the debt of a customer IS the outstanding balance (total - amount_paid) of an ISSUED invoice in bk_documents.
--   There is no debt ledger and no payment table here: payments stay in bk_document_payments (doc_record_payment / doc_void_payment),
--   and this migration creates ZERO bookkeeping entries (cash basis: issuing creates none, each recorded payment creates exactly one).
--
-- Depends on (checked below; the migration aborts with a clear message and changes nothing if any is missing):
--   Phase 1 + Phase 2 objects, email_suppressions, profiles(category, categories, is_demo, user_id), users.plan_id, plans.business_toolkit_enabled.
--
-- Design principles (same as Phases 1 and 2)
--   * Owner-only: RLS read policy = the profile's owner; every entry point re-checks owner + plan flag + demo through bk_doc_gate().
--     No client role may write; service_role holds SELECT only. Rows change only through the guarded functions below.
--   * Customers are a MERCHANT-OWNED contact book. They are never merged automatically and never linked to ringo_customers,
--     restaurant_customers, music_customers, community_subscribers or customer_followups. Linking an invoice never touches the
--     invoice's frozen customer snapshot.
--   * Reminders: append-only log doubling as the dedupe table. Email rows are inserted as 'claimed' BEFORE any send, so a crash can lose
--     an email but never send one twice. WhatsApp reminders are only ever 'prepared' (click-to-chat): nothing here says sent or delivered.
--   * Automatic reminders are OFF by default, need a business email (reply-to) to be enabled, only cover invoices due on or after the day
--     they were enabled, and never contain a share link (the raw token is not stored, by design in Phase 2).
--   * Every FK is ON DELETE RESTRICT; nothing is deleted; TRUNCATE is refused (Phase 1 guard reused).
--   * Idempotent to re-run: IF NOT EXISTS / CREATE OR REPLACE / guarded policies; triggers dropped and recreated only on the new tables.

begin;

-- ============================================================================
-- 0. DEPENDENCY CHECK
-- ============================================================================
do $$
begin
  if to_regclass('public.bk_documents') is null or to_regclass('public.bk_document_payments') is null
     or to_regclass('public.bk_document_shares') is null or to_regclass('public.bk_business_profiles') is null
     or to_regclass('public.email_suppressions') is null
     or to_regprocedure('public.bk_doc_gate(uuid,uuid)') is null
     or to_regprocedure('public.bk_doc_seller_snapshot(uuid)') is null
     or to_regprocedure('public.bk_truncate_guard()') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'plans' and column_name = 'business_toolkit_enabled')
     or (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name in ('id','user_id','is_demo','category','categories')) <> 5 then
    raise exception 'Phase 3 requires the Phase 1 and Phase 2 migrations, email_suppressions and the profiles/users/plans columns it reads';
  end if;
end $$;

-- ============================================================================
-- 1. PURE HELPERS
-- ============================================================================
-- Matching only (never display): digits, international form. Cameroon rule, as the existing click-to-chat helper: a 9-digit number
-- starting with 6 or 2 gets the 237 prefix. A leading 00 is dropped. Anything outside 7..15 digits is not a usable number.
create or replace function bk_norm_phone(p_phone text) returns text
language sql immutable as $$
  select case when d is null or d = '' then null
              when length(d) = 9 and left(d, 1) in ('6', '2') then '237' || d
              when length(d) between 7 and 15 then d
              else null end
    from (select regexp_replace(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '^00', '') as d) x
$$;

create or replace function bk_norm_email(p_email text) returns text
language sql immutable as $$
  select case when e is null or position('@' in e) <= 1 or char_length(e) > 200 or e ~ '\s' then null else e end
    from (select lower(btrim(coalesce(p_email, ''))) as e) x
$$;

create or replace function bk_rem_mask_email(p_email text) returns text
language sql immutable as $$
  select case when p_email is null or position('@' in p_email) <= 1 then null
              else left(p_email, 1) || '***' || substr(p_email, position('@' in p_email)) end
$$;

-- ============================================================================
-- 2. TABLES
-- ============================================================================
create table if not exists bk_customers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  phone text check (phone is null or char_length(phone) <= 40),
  email text check (email is null or (char_length(email) <= 200 and position('@' in email) > 1)),
  phone_normalized text check (phone_normalized is null or phone_normalized ~ '^[0-9]{7,15}$'),
  email_normalized text check (email_normalized is null or email_normalized = lower(email_normalized)),
  notes text check (notes is null or char_length(notes) <= 500),
  auto_reminders_paused boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.users(id) on delete restrict,
  client_request_id uuid,
  created_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete restrict,
  unique (profile_id, id),
  check ((archived_at is null) = (archived_by is null)),
  check ((phone is null) = (phone_normalized is null)),
  check ((email is null) = (email_normalized is null))
);
create unique index if not exists bk_customers_request_idx on bk_customers (profile_id, client_request_id) where client_request_id is not null;
create unique index if not exists bk_customers_phone_idx on bk_customers (profile_id, phone_normalized) where phone_normalized is not null and archived_at is null;
create unique index if not exists bk_customers_email_idx on bk_customers (profile_id, email_normalized) where email_normalized is not null and archived_at is null;
create index if not exists bk_customers_list_idx on bk_customers (profile_id, archived_at, name);

create table if not exists bk_document_customer_links (
  document_id uuid primary key,
  profile_id uuid not null references profiles(id) on delete restrict,
  customer_id uuid,                                   -- null = explicitly unlinked
  linked_at timestamptz not null default now(),
  linked_by uuid references public.users(id) on delete restrict,
  foreign key (profile_id, document_id) references bk_documents (profile_id, id) on delete restrict,
  foreign key (profile_id, customer_id) references bk_customers (profile_id, id) on delete restrict
);
create index if not exists bk_document_customer_links_customer_idx on bk_document_customer_links (profile_id, customer_id);

create table if not exists bk_customer_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete restrict,
  customer_id uuid not null,
  document_id uuid,
  event_type text not null check (event_type in ('customer_created', 'customer_updated', 'customer_archived', 'customer_restored',
                                                 'reminders_paused', 'reminders_resumed', 'document_linked', 'document_unlinked')),
  actor_user_id uuid references public.users(id) on delete restrict,
  details jsonb check (details is null or pg_column_size(details) <= 2048),
  created_at timestamptz not null default now(),
  foreign key (profile_id, customer_id) references bk_customers (profile_id, id) on delete restrict,
  foreign key (profile_id, document_id) references bk_documents (profile_id, id) on delete restrict
);
create index if not exists bk_customer_events_customer_idx on bk_customer_events (customer_id, created_at);
create index if not exists bk_customer_events_profile_idx on bk_customer_events (profile_id, created_at desc);

create table if not exists bk_reminder_settings (
  profile_id uuid primary key references profiles(id) on delete restrict,
  auto_email_enabled boolean not null default false,                                    -- OFF by default
  auto_enabled_at timestamptz,
  remind_before_days int check (remind_before_days is null or remind_before_days between 1 and 14),
  remind_on_due boolean not null default false,
  overdue_every_days int default 7 check (overdue_every_days is null or overdue_every_days between 3 and 60),
  max_auto_per_invoice int not null default 3 check (max_auto_per_invoice between 1 and 6),
  owner_alerts_enabled boolean not null default false,                                  -- OFF by default
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete restrict,
  check (auto_email_enabled = false or auto_enabled_at is not null)
);

create table if not exists bk_reminders (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete restrict,
  document_id uuid not null,
  customer_id uuid,                                   -- the link at the time of the reminder (snapshot)
  trigger_type text not null check (trigger_type in ('auto', 'manual')),
  channel text not null check (channel in ('email', 'whatsapp_manual', 'owner_alert')),
  kind text not null check (kind in ('before_due', 'due_today', 'overdue', 'manual')),
  status text not null check (status in ('claimed', 'sent', 'failed', 'suppressed', 'skipped', 'prepared')),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  client_request_id uuid,
  amount_due numeric(14,3) not null check (amount_due > 0),
  currency text not null check (currency = upper(currency) and char_length(currency) = 3),
  due_date date,
  days_overdue int check (days_overdue is null or days_overdue >= 0),
  include_link boolean not null default false,        -- whether the owner-supplied link was included; the token is never stored
  recipient_hint text check (recipient_hint is null or char_length(recipient_hint) <= 80),
  locale text not null check (locale in ('en', 'fr')),
  failure_code text check (failure_code is null or char_length(failure_code) <= 60),
  actor_user_id uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (profile_id, document_id) references bk_documents (profile_id, id) on delete restrict,
  foreign key (profile_id, customer_id) references bk_customers (profile_id, id) on delete restrict,
  unique (profile_id, dedupe_key),
  check ((channel = 'whatsapp_manual') = (status = 'prepared')),                        -- WhatsApp is only ever 'prepared'
  check (trigger_type <> 'auto' or (channel in ('email', 'owner_alert') and actor_user_id is null)),
  check ((kind = 'manual') = (trigger_type = 'manual')),
  check (channel <> 'owner_alert' or (kind = 'overdue' and trigger_type = 'auto')),
  check (trigger_type = 'auto' or client_request_id is not null),
  check (include_link = false or (trigger_type = 'manual' and channel <> 'owner_alert')),  -- automatic reminders never carry a link
  check ((status = 'claimed') = (completed_at is null))
);
create unique index if not exists bk_reminders_request_idx on bk_reminders (profile_id, client_request_id) where client_request_id is not null;
create index if not exists bk_reminders_doc_idx on bk_reminders (document_id, created_at);
create index if not exists bk_reminders_profile_idx on bk_reminders (profile_id, created_at);

-- ============================================================================
-- 3. INTEGRITY GUARDS
-- ============================================================================
create or replace function bk_customers_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'bk_customers: customers are never deleted; archive them instead'; end if;
  if new.id <> old.id or new.profile_id <> old.profile_id or new.created_at <> old.created_at or new.created_by is distinct from old.created_by
     or new.client_request_id is distinct from old.client_request_id then
    raise exception 'bk_customers: identity columns are immutable';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists bk_customers_guard_trg on bk_customers;
create trigger bk_customers_guard_trg before update or delete on bk_customers for each row execute function bk_customers_guard();

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
drop trigger if exists bk_document_customer_links_guard_trg on bk_document_customer_links;
create trigger bk_document_customer_links_guard_trg before insert or update or delete on bk_document_customer_links for each row execute function bk_document_customer_links_guard();

create or replace function bk_customer_events_guard() returns trigger language plpgsql as $$
begin
  raise exception 'bk_customer_events is append-only';
end $$;
drop trigger if exists bk_customer_events_guard_trg on bk_customer_events;
create trigger bk_customer_events_guard_trg before update or delete on bk_customer_events for each row execute function bk_customer_events_guard();

create or replace function bk_reminder_settings_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'bk_reminder_settings: rows are never deleted'; end if;
  if new.profile_id <> old.profile_id then raise exception 'bk_reminder_settings: identity is immutable'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists bk_reminder_settings_guard_trg on bk_reminder_settings;
create trigger bk_reminder_settings_guard_trg before update or delete on bk_reminder_settings for each row execute function bk_reminder_settings_guard();

-- A reminder row is a record of what was claimed/sent. Once inserted it only ever moves out of 'claimed', exactly once.
create or replace function bk_reminders_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'bk_reminders: reminders are never deleted'; end if;
  if new.id <> old.id or new.profile_id <> old.profile_id or new.document_id <> old.document_id or new.customer_id is distinct from old.customer_id
     or new.trigger_type <> old.trigger_type or new.channel <> old.channel or new.kind <> old.kind or new.dedupe_key <> old.dedupe_key
     or new.client_request_id is distinct from old.client_request_id or new.amount_due <> old.amount_due or new.currency <> old.currency
     or new.due_date is distinct from old.due_date or new.days_overdue is distinct from old.days_overdue or new.include_link <> old.include_link
     or new.recipient_hint is distinct from old.recipient_hint or new.locale <> old.locale or new.actor_user_id is distinct from old.actor_user_id
     or new.created_at <> old.created_at then
    raise exception 'bk_reminders: a reminder is immutable except for its outcome';
  end if;
  if old.status <> 'claimed' then raise exception 'bk_reminders: outcome already recorded'; end if;
  if new.status not in ('sent', 'failed', 'suppressed', 'skipped') then raise exception 'bk_reminders: a claimed reminder can only become sent, failed, suppressed or skipped'; end if;
  return new;
end $$;
drop trigger if exists bk_reminders_guard_trg on bk_reminders;
create trigger bk_reminders_guard_trg before update or delete on bk_reminders for each row execute function bk_reminders_guard();

drop trigger if exists bk_customers_truncate_guard_trg on bk_customers;
create trigger bk_customers_truncate_guard_trg before truncate on bk_customers for each statement execute function bk_truncate_guard();
drop trigger if exists bk_document_customer_links_truncate_guard_trg on bk_document_customer_links;
create trigger bk_document_customer_links_truncate_guard_trg before truncate on bk_document_customer_links for each statement execute function bk_truncate_guard();
drop trigger if exists bk_customer_events_truncate_guard_trg on bk_customer_events;
create trigger bk_customer_events_truncate_guard_trg before truncate on bk_customer_events for each statement execute function bk_truncate_guard();
drop trigger if exists bk_reminder_settings_truncate_guard_trg on bk_reminder_settings;
create trigger bk_reminder_settings_truncate_guard_trg before truncate on bk_reminder_settings for each statement execute function bk_truncate_guard();
drop trigger if exists bk_reminders_truncate_guard_trg on bk_reminders;
create trigger bk_reminders_truncate_guard_trg before truncate on bk_reminders for each statement execute function bk_truncate_guard();

-- ============================================================================
-- 4. INTERNAL HELPERS (not callable by any client role)
-- ============================================================================
create or replace function bk_customer_event(p_profile_id uuid, p_customer_id uuid, p_type text, p_actor uuid, p_document_id uuid, p_details jsonb) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into bk_customer_events (profile_id, customer_id, document_id, event_type, actor_user_id, details)
  values (p_profile_id, p_customer_id, p_document_id, p_type, p_actor, p_details)
$$;

-- Why an invoice cannot be reminded right now. NULL = fine. Shared by the manual and the automatic path.
create or replace function bk_rem_problem(p_doc bk_documents, p_for_auto boolean) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_link record;
begin
  if p_doc.doc_type <> 'invoice' or p_doc.status not in ('issued', 'partially_paid') then return 'invoice_not_open'; end if;
  if p_doc.total - p_doc.amount_paid <= 0 then return 'nothing_due'; end if;
  select c.archived_at, c.auto_reminders_paused into v_link
    from bk_document_customer_links l join bk_customers c on c.id = l.customer_id and c.profile_id = l.profile_id
   where l.document_id = p_doc.id;
  if found then
    if v_link.archived_at is not null then return 'customer_archived'; end if;
    if p_for_auto and v_link.auto_reminders_paused then return 'customer_paused'; end if;
  end if;
  return null;
end $$;

-- Email-specific problem: no usable address on the invoice, or the address is on the bounce/complaint suppression list.
create or replace function bk_rem_email_problem(p_doc bk_documents) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_email text := bk_norm_email(p_doc.customer_snapshot ->> 'email');
begin
  if v_email is null then return 'no_email'; end if;
  if exists (select 1 from email_suppressions s where lower(s.email) = v_email) then return 'email_suppressed'; end if;
  return null;
end $$;

create or replace function bk_rem_today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Douala')::date $$;

create or replace function bk_rem_day_start() returns timestamptz
language sql stable as $$ select (((now() at time zone 'Africa/Douala')::date)::timestamp at time zone 'Africa/Douala') $$;

-- customer-directed emails that count against a limit: claimed or sent (a failed/suppressed attempt reached nobody)
create or replace function bk_rem_email_count(p_profile_id uuid, p_document_id uuid, p_since timestamptz, p_auto_only boolean) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from bk_reminders r
   where r.profile_id = p_profile_id and r.channel = 'email' and r.status in ('claimed', 'sent')
     and (p_document_id is null or r.document_id = p_document_id) and r.created_at >= p_since
     and (p_auto_only is not true or r.trigger_type = 'auto')
$$;

create or replace function bk_rem_context(p_doc bk_documents, p_reminder_id uuid, p_kind text, p_due numeric) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'reminder_id', p_reminder_id, 'profile_id', p_doc.profile_id, 'document_id', p_doc.id, 'number', p_doc.number, 'locale', p_doc.locale,
    'currency', p_doc.currency, 'amount_due', p_due::text, 'due_date', p_doc.due_date, 'kind', p_kind,
    'days_overdue', case when p_doc.due_date is not null and bk_rem_today() > p_doc.due_date then bk_rem_today() - p_doc.due_date else 0 end,
    'to', bk_norm_email(p_doc.customer_snapshot ->> 'email'), 'customer_name', p_doc.customer_snapshot ->> 'name',
    'phone', bk_norm_phone(p_doc.customer_snapshot ->> 'phone'),
    'seller_name', bk_doc_seller_snapshot(p_doc.profile_id) ->> 'display_name',
    'reply_to', (select bp.email from bk_business_profiles bp where bp.profile_id = p_doc.profile_id))
$$;

-- ============================================================================
-- 5. SERVICE-ROLE FUNCTIONS
-- ============================================================================
-- ---- customers ------------------------------------------------------------
create or replace function bk_customer_save(
  p_profile_id uuid, p_actor_user_id uuid, p_customer_id uuid, p_name text, p_phone text, p_email text, p_notes text, p_client_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row bk_customers; v_dup bk_customers; v_phone text; v_email text; v_pn text; v_en text; v_notes text;
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_name is null or btrim(p_name) = '' or char_length(p_name) > 120 then raise exception 'invalid_customer_name'; end if;
  v_phone := nullif(btrim(coalesce(p_phone, '')), '');
  if v_phone is not null then
    if char_length(v_phone) > 40 then raise exception 'invalid_phone'; end if;
    v_pn := bk_norm_phone(v_phone);
    if v_pn is null then raise exception 'invalid_phone'; end if;
  end if;
  v_email := nullif(btrim(coalesce(p_email, '')), '');
  if v_email is not null then
    v_en := bk_norm_email(v_email);
    if v_en is null then raise exception 'invalid_email'; end if;
  end if;
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');
  if v_notes is not null and char_length(v_notes) > 500 then raise exception 'invalid_notes'; end if;

  if p_customer_id is null then
    if p_client_request_id is not null then
      perform pg_advisory_xact_lock(hashtextextended('bkcust:' || p_profile_id::text || ':' || p_client_request_id::text, 0));
      select * into v_row from bk_customers where profile_id = p_profile_id and client_request_id = p_client_request_id;
      if found then return jsonb_build_object('customer', to_jsonb(v_row), 'created', false, 'duplicate', true); end if;
    end if;
    -- an existing ACTIVE contact with the same phone or email: report it, never merge, never create a second one
    select * into v_dup from bk_customers
     where profile_id = p_profile_id and archived_at is null and ((v_pn is not null and phone_normalized = v_pn) or (v_en is not null and email_normalized = v_en)) limit 1;
    if found then return jsonb_build_object('created', false, 'duplicate', false, 'duplicate_of', jsonb_build_object('id', v_dup.id, 'name', v_dup.name)); end if;
    insert into bk_customers (profile_id, name, phone, email, phone_normalized, email_normalized, notes, client_request_id, created_by, updated_by)
    values (p_profile_id, btrim(p_name), v_phone, v_email, v_pn, v_en, v_notes, p_client_request_id, p_actor_user_id, p_actor_user_id) returning * into v_row;
    perform bk_customer_event(p_profile_id, v_row.id, 'customer_created', p_actor_user_id, null, null);
    return jsonb_build_object('customer', to_jsonb(v_row), 'created', true, 'duplicate', false);
  end if;

  select * into v_row from bk_customers where id = p_customer_id and profile_id = p_profile_id for update;
  if not found then raise exception 'customer_not_found'; end if;
  if v_row.archived_at is not null then raise exception 'customer_archived'; end if;
  select * into v_dup from bk_customers
   where profile_id = p_profile_id and archived_at is null and id <> v_row.id and ((v_pn is not null and phone_normalized = v_pn) or (v_en is not null and email_normalized = v_en)) limit 1;
  if found then return jsonb_build_object('created', false, 'duplicate', false, 'duplicate_of', jsonb_build_object('id', v_dup.id, 'name', v_dup.name)); end if;
  update bk_customers set name = btrim(p_name), phone = v_phone, email = v_email, phone_normalized = v_pn, email_normalized = v_en, notes = v_notes,
         updated_by = p_actor_user_id where id = v_row.id returning * into v_row;
  perform bk_customer_event(p_profile_id, v_row.id, 'customer_updated', p_actor_user_id, null, null);
  return jsonb_build_object('customer', to_jsonb(v_row), 'created', false, 'duplicate', false);
end $$;

create or replace function bk_customer_set_archived(p_profile_id uuid, p_actor_user_id uuid, p_customer_id uuid, p_archived boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row bk_customers;
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_archived is null then raise exception 'invalid_setting'; end if;
  select * into v_row from bk_customers where id = p_customer_id and profile_id = p_profile_id for update;
  if not found then raise exception 'customer_not_found'; end if;
  if (v_row.archived_at is not null) = p_archived then return jsonb_build_object('customer', to_jsonb(v_row), 'changed', false); end if;
  begin
    update bk_customers set archived_at = case when p_archived then now() else null end, archived_by = case when p_archived then p_actor_user_id else null end,
           updated_by = p_actor_user_id where id = v_row.id returning * into v_row;
  exception when unique_violation then
    raise exception 'duplicate_customer';       -- restoring would collide with an active contact that has the same phone or email
  end;
  perform bk_customer_event(p_profile_id, v_row.id, case when p_archived then 'customer_archived' else 'customer_restored' end, p_actor_user_id, null, null);
  return jsonb_build_object('customer', to_jsonb(v_row), 'changed', true);
end $$;

create or replace function bk_customer_set_auto_paused(p_profile_id uuid, p_actor_user_id uuid, p_customer_id uuid, p_paused boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row bk_customers;
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_paused is null then raise exception 'invalid_setting'; end if;
  select * into v_row from bk_customers where id = p_customer_id and profile_id = p_profile_id for update;
  if not found then raise exception 'customer_not_found'; end if;
  if v_row.auto_reminders_paused = p_paused then return jsonb_build_object('customer', to_jsonb(v_row), 'changed', false); end if;
  update bk_customers set auto_reminders_paused = p_paused, updated_by = p_actor_user_id where id = v_row.id returning * into v_row;
  perform bk_customer_event(p_profile_id, v_row.id, case when p_paused then 'reminders_paused' else 'reminders_resumed' end, p_actor_user_id, null, null);
  return jsonb_build_object('customer', to_jsonb(v_row), 'changed', true);
end $$;

-- ---- linking --------------------------------------------------------------
-- Links (or unlinks, with a null customer) an INVOICE to a contact. The invoice's frozen customer snapshot is never touched.
create or replace function doc_set_document_customer(p_profile_id uuid, p_actor_user_id uuid, p_document_id uuid, p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_doc bk_documents; v_cust bk_customers; v_old record; v_changed boolean := false; v_event_customer uuid;
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  select * into v_doc from bk_documents where id = p_document_id and profile_id = p_profile_id;
  if not found then raise exception 'document_not_found'; end if;
  if v_doc.doc_type <> 'invoice' then raise exception 'not_an_invoice'; end if;
  if p_customer_id is not null then
    select * into v_cust from bk_customers where id = p_customer_id and profile_id = p_profile_id;
    if not found then raise exception 'customer_not_found'; end if;
    if v_cust.archived_at is not null then raise exception 'customer_archived'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bklink:' || p_document_id::text, 0));
  select customer_id into v_old from bk_document_customer_links where document_id = p_document_id;
  if not found then
    if p_customer_id is not null then
      insert into bk_document_customer_links (document_id, profile_id, customer_id, linked_by) values (p_document_id, p_profile_id, p_customer_id, p_actor_user_id);
      v_changed := true;
    end if;
  elsif v_old.customer_id is distinct from p_customer_id then
    v_event_customer := v_old.customer_id;
    update bk_document_customer_links set customer_id = p_customer_id, linked_at = now(), linked_by = p_actor_user_id where document_id = p_document_id;
    v_changed := true;
  end if;
  if v_changed then
    if p_customer_id is not null then
      perform bk_customer_event(p_profile_id, p_customer_id, 'document_linked', p_actor_user_id, p_document_id, null);
    end if;
    if v_event_customer is not null then
      perform bk_customer_event(p_profile_id, v_event_customer, 'document_unlinked', p_actor_user_id, p_document_id, null);
    end if;
  end if;
  return jsonb_build_object('document_id', p_document_id, 'customer_id', p_customer_id, 'changed', v_changed);
end $$;

-- Read-only suggestions: ACTIVE contacts of the SAME business whose phone/email matches the invoice's snapshot. Never links anything.
create or replace function doc_suggest_customers(p_profile_id uuid, p_actor_user_id uuid, p_document_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_doc bk_documents; v_pn text; v_en text;
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  select * into v_doc from bk_documents where id = p_document_id and profile_id = p_profile_id;
  if not found then raise exception 'document_not_found'; end if;
  v_pn := bk_norm_phone(v_doc.customer_snapshot ->> 'phone');
  v_en := bk_norm_email(v_doc.customer_snapshot ->> 'email');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email,
             'match', case when v_pn is not null and c.phone_normalized = v_pn and v_en is not null and c.email_normalized = v_en then 'both'
                           when v_pn is not null and c.phone_normalized = v_pn then 'phone' else 'email' end) order by c.name)
      from (select * from bk_customers c0 where c0.profile_id = p_profile_id and c0.archived_at is null
               and ((v_pn is not null and c0.phone_normalized = v_pn) or (v_en is not null and c0.email_normalized = v_en)) order by c0.name limit 5) c
  ), '[]'::jsonb);
end $$;

-- ---- receivables (read-only, aggregated in SQL so PostgREST row caps never matter) ----------------------------------------
create or replace function doc_receivables_summary(p_profile_id uuid, p_actor_user_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cur text; v_today date; v_out jsonb;
begin
  v_cur := bk_doc_gate(p_profile_id, p_actor_user_id);
  v_today := bk_rem_today();
  with live_inv as (
    select d.id, d.currency, d.total - d.amount_paid as due, d.due_date,
           case when d.due_date is null then null else v_today - d.due_date end as days_over, l.customer_id
      from bk_documents d left join bk_document_customer_links l on l.document_id = d.id
     where d.profile_id = p_profile_id and d.doc_type = 'invoice' and d.status in ('issued', 'partially_paid') and d.total > d.amount_paid),
  bucketed as (
    select li.*, case when due_date is null then 'no_due_date' when days_over <= 0 then 'not_due' when days_over <= 30 then 'd1_30'
                      when days_over <= 60 then 'd31_60' when days_over <= 90 then 'd61_90' else 'd90_plus' end as b from live_inv li),
  per_cur as (
    select currency, sum(due) as outstanding, coalesce(sum(due) filter (where days_over > 0), 0) as overdue, count(*) as n,
           count(*) filter (where days_over > 0) as n_over,
           jsonb_build_object(
             'not_due',     jsonb_build_object('amount', coalesce(sum(due) filter (where b = 'not_due'), 0)::text,     'count', count(*) filter (where b = 'not_due')),
             'no_due_date', jsonb_build_object('amount', coalesce(sum(due) filter (where b = 'no_due_date'), 0)::text, 'count', count(*) filter (where b = 'no_due_date')),
             'd1_30',       jsonb_build_object('amount', coalesce(sum(due) filter (where b = 'd1_30'), 0)::text,       'count', count(*) filter (where b = 'd1_30')),
             'd31_60',      jsonb_build_object('amount', coalesce(sum(due) filter (where b = 'd31_60'), 0)::text,      'count', count(*) filter (where b = 'd31_60')),
             'd61_90',      jsonb_build_object('amount', coalesce(sum(due) filter (where b = 'd61_90'), 0)::text,      'count', count(*) filter (where b = 'd61_90')),
             'd90_plus',    jsonb_build_object('amount', coalesce(sum(due) filter (where b = 'd90_plus'), 0)::text,    'count', count(*) filter (where b = 'd90_plus'))
           ) as aging
      from bucketed group by currency),
  per_cust as (
    select currency, customer_id, sum(due) as outstanding, coalesce(sum(due) filter (where days_over > 0), 0) as overdue,
           count(*) as n, min(due_date) as oldest
      from live_inv group by currency, customer_id),
  cust_json as (
    select pc.currency,
           jsonb_agg(jsonb_build_object(
             'customer_id', pc.customer_id, 'name', bc.name, 'archived', bc.archived_at is not null, 'auto_paused', bc.auto_reminders_paused,
             'outstanding', pc.outstanding::text, 'overdue', pc.overdue::text, 'invoice_count', pc.n, 'oldest_due_date', pc.oldest,
             'last_reminder_at', (select max(r.created_at) from bk_reminders r
                                   where r.profile_id = p_profile_id and r.channel in ('email', 'whatsapp_manual') and r.status in ('sent', 'prepared')
                                     and r.document_id in (select li.id from live_inv li where li.customer_id = pc.customer_id and li.currency = pc.currency))
           ) order by pc.outstanding desc) as j
      from (select * from per_cust where customer_id is not null order by outstanding desc limit 100) pc
      join bk_customers bc on bc.id = pc.customer_id group by pc.currency)
  select jsonb_build_object('today', v_today, 'profile_currency', v_cur, 'currencies', coalesce(jsonb_agg(jsonb_build_object(
           'currency', p.currency, 'can_record_payment', p.currency = v_cur,
           'outstanding', p.outstanding::text, 'overdue', p.overdue::text, 'invoice_count', p.n, 'overdue_count', p.n_over, 'aging', p.aging,
           'customers', coalesce(cj.j, '[]'::jsonb),
           'unassigned', coalesce((select jsonb_build_object('outstanding', u.outstanding::text, 'overdue', u.overdue::text, 'invoice_count', u.n)
                                     from per_cust u where u.currency = p.currency and u.customer_id is null),
                                  jsonb_build_object('outstanding', '0', 'overdue', '0', 'invoice_count', 0))
         ) order by p.currency), '[]'::jsonb))
    into v_out from per_cur p left join cust_json cj on cj.currency = p.currency;
  return v_out;
end $$;

create or replace function doc_receivable_invoices(
  p_profile_id uuid, p_actor_user_id uuid, p_customer_id uuid, p_unassigned boolean, p_overdue_only boolean, p_currency text, p_limit int, p_offset int)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cur text; v_today date; v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100); v_offset int := greatest(coalesce(p_offset, 0), 0); v_out jsonb;
begin
  v_cur := bk_doc_gate(p_profile_id, p_actor_user_id);
  v_today := bk_rem_today();
  with f as (
    select d.*, l.customer_id as link_customer_id, d.total - d.amount_paid as due,
           case when d.due_date is not null and v_today > d.due_date then v_today - d.due_date else 0 end as days_over
      from bk_documents d left join bk_document_customer_links l on l.document_id = d.id
     where d.profile_id = p_profile_id and d.doc_type = 'invoice' and d.status in ('issued', 'partially_paid') and d.total > d.amount_paid
       and (p_customer_id is null or l.customer_id = p_customer_id)
       and (p_unassigned is not true or l.customer_id is null)
       and (p_overdue_only is not true or (d.due_date is not null and v_today > d.due_date))
       and (p_currency is null or d.currency = upper(p_currency))),
  page as (select f.*, count(*) over () as total_rows from f order by (days_over > 0) desc, due_date asc nulls last, number asc limit v_limit offset v_offset)
  select jsonb_build_object('items', coalesce(jsonb_agg(jsonb_build_object(
           'id', pg.id, 'number', pg.number, 'issue_date', pg.issue_date, 'due_date', pg.due_date, 'currency', pg.currency,
           'total', pg.total::text, 'amount_paid', pg.amount_paid::text, 'amount_due', pg.due::text,
           'overdue', pg.days_over > 0, 'days_overdue', pg.days_over, 'status', pg.status,
           'customer_id', pg.link_customer_id, 'customer_name', coalesce((select c.name from bk_customers c where c.id = pg.link_customer_id), pg.customer_snapshot ->> 'name'),
           'linked', pg.link_customer_id is not null,
           'has_email', bk_norm_email(pg.customer_snapshot ->> 'email') is not null, 'has_phone', bk_norm_phone(pg.customer_snapshot ->> 'phone') is not null,
           'can_record_payment', pg.currency = v_cur,
           'last_reminder_at', (select max(r.created_at) from bk_reminders r where r.document_id = pg.id and r.channel in ('email', 'whatsapp_manual') and r.status in ('sent', 'prepared')),
           'reminders_sent', (select count(*) from bk_reminders r where r.document_id = pg.id and r.channel = 'email' and r.status = 'sent')
         ) order by (pg.days_over > 0) desc, pg.due_date asc nulls last, pg.number asc), '[]'::jsonb),
         'total', coalesce(max(pg.total_rows), 0))
    into v_out from page pg;
  return v_out;
end $$;

create or replace function doc_customer_statement(p_profile_id uuid, p_actor_user_id uuid, p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cur text; v_today date; v_cust bk_customers; v_out jsonb;
begin
  v_cur := bk_doc_gate(p_profile_id, p_actor_user_id);
  v_today := bk_rem_today();
  select * into v_cust from bk_customers where id = p_customer_id and profile_id = p_profile_id;
  if not found then raise exception 'customer_not_found'; end if;
  with inv as (
    select d.id, d.number, d.status, d.currency, d.total, d.amount_paid, d.total - d.amount_paid as due, d.issue_date, d.due_date,
           (d.status in ('issued', 'partially_paid') and d.total > d.amount_paid and d.due_date is not null and v_today > d.due_date) as overdue
      from bk_document_customer_links l join bk_documents d on d.id = l.document_id and d.profile_id = l.profile_id
     where l.profile_id = p_profile_id and l.customer_id = p_customer_id and d.doc_type = 'invoice' and d.status <> 'draft'
     order by d.issue_date desc nulls last, d.number desc limit 200),
  pay as (
    select p.id, p.invoice_id, i.number as invoice_number, r.number as receipt_number, p.amount, p.currency, p.method, p.reference, p.paid_on, p.voided_at
      from bk_document_payments p join inv i on i.id = p.invoice_id join bk_documents r on r.id = p.receipt_document_id
     where p.profile_id = p_profile_id order by p.paid_on desc, p.created_at desc limit 500),
  tot as (
    select currency, coalesce(sum(due) filter (where status in ('issued', 'partially_paid')), 0) as outstanding,
           coalesce(sum(due) filter (where overdue), 0) as overdue from inv group by currency)
  select jsonb_build_object(
           'customer', to_jsonb(v_cust), 'profile_currency', v_cur,
           'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'status', i.status, 'currency', i.currency,
                          'total', i.total::text, 'amount_paid', i.amount_paid::text, 'amount_due', case when i.status in ('issued', 'partially_paid') then i.due::text else '0' end,
                          'issue_date', i.issue_date, 'due_date', i.due_date, 'overdue', i.overdue, 'can_record_payment', i.currency = v_cur) order by i.issue_date desc nulls last, i.number desc) from inv i), '[]'::jsonb),
           'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'invoice_id', p.invoice_id, 'invoice_number', p.invoice_number, 'receipt_number', p.receipt_number,
                          'amount', p.amount::text, 'currency', p.currency, 'method', p.method, 'reference', p.reference, 'paid_on', p.paid_on, 'voided', p.voided_at is not null)
                          order by p.paid_on desc) from pay p), '[]'::jsonb),
           'totals', coalesce((select jsonb_agg(jsonb_build_object('currency', t.currency, 'outstanding', t.outstanding::text, 'overdue', t.overdue::text) order by t.currency) from tot t), '[]'::jsonb))
    into v_out;
  return v_out;
end $$;

-- ---- share check (no access counter, no side effect) --------------------------------------------------------------
-- Does this token hash belong to a valid (not revoked, not expired) share link of THIS invoice of THIS business? Lets a manual reminder
-- include a link the owner already holds. The raw token is never stored or reconstructed anywhere.
create or replace function doc_check_share(p_profile_id uuid, p_actor_user_id uuid, p_document_id uuid, p_token_hash text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  return exists (select 1 from bk_document_shares s
                  where s.token_hash = p_token_hash and s.document_id = p_document_id and s.profile_id = p_profile_id
                    and s.revoked_at is null and s.expires_at > now());
end $$;

-- ---- settings ---------------------------------------------------------------------------------------------------------
create or replace function doc_upsert_reminder_settings(
  p_profile_id uuid, p_actor_user_id uuid, p_auto_email_enabled boolean, p_remind_before_days int, p_remind_on_due boolean,
  p_overdue_every_days int, p_max_auto_per_invoice int, p_owner_alerts_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old bk_reminder_settings; v_had boolean; v_enabled_at timestamptz; v_row bk_reminder_settings; v_bemail text;
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_auto_email_enabled is null or p_remind_on_due is null or p_owner_alerts_enabled is null then raise exception 'invalid_setting'; end if;
  if p_remind_before_days is not null and p_remind_before_days not between 1 and 14 then raise exception 'invalid_setting'; end if;
  if p_overdue_every_days is not null and p_overdue_every_days not between 3 and 60 then raise exception 'invalid_setting'; end if;
  if p_max_auto_per_invoice is null or p_max_auto_per_invoice not between 1 and 6 then raise exception 'invalid_setting'; end if;
  if p_auto_email_enabled then
    select email into v_bemail from bk_business_profiles where profile_id = p_profile_id;
    if v_bemail is null then raise exception 'business_email_required'; end if;
    if p_remind_before_days is null and p_remind_on_due is not true and p_overdue_every_days is null then raise exception 'no_reminder_timing'; end if;
  end if;
  select * into v_old from bk_reminder_settings where profile_id = p_profile_id for update;
  v_had := found;
  v_enabled_at := case when p_auto_email_enabled then (case when v_had and v_old.auto_email_enabled then v_old.auto_enabled_at else now() end) else null end;
  insert into bk_reminder_settings as s (profile_id, auto_email_enabled, auto_enabled_at, remind_before_days, remind_on_due, overdue_every_days,
                                         max_auto_per_invoice, owner_alerts_enabled, updated_by)
  values (p_profile_id, p_auto_email_enabled, v_enabled_at, p_remind_before_days, p_remind_on_due, p_overdue_every_days, p_max_auto_per_invoice,
          p_owner_alerts_enabled, p_actor_user_id)
  on conflict (profile_id) do update set auto_email_enabled = excluded.auto_email_enabled, auto_enabled_at = excluded.auto_enabled_at,
    remind_before_days = excluded.remind_before_days, remind_on_due = excluded.remind_on_due, overdue_every_days = excluded.overdue_every_days,
    max_auto_per_invoice = excluded.max_auto_per_invoice, owner_alerts_enabled = excluded.owner_alerts_enabled, updated_by = excluded.updated_by
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

-- ---- manual reminders -------------------------------------------------------------------------------------------------
-- Limits (platform constants): at least 24 h between customer emails of one invoice, at most 10 per invoice, at most 100 customer emails
-- per business per day (Douala day). The automatic path has its own, stricter budget (30/day) in doc_claim_due_reminders.
create or replace function doc_record_manual_reminder(
  p_profile_id uuid, p_actor_user_id uuid, p_document_id uuid, p_channel text, p_client_request_id uuid, p_share_token_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_doc bk_documents; v_existing bk_reminders; v_problem text; v_due numeric; v_link_cust uuid; v_include boolean := false; v_hint text; v_id uuid := gen_random_uuid();
  v_status text; v_phone text; v_last timestamptz; v_ctx jsonb; v_days int;
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_client_request_id is null then raise exception 'request_id_required'; end if;
  if p_channel is null or p_channel not in ('email', 'whatsapp_manual') then raise exception 'invalid_channel'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bkremreq:' || p_profile_id::text || ':' || p_client_request_id::text, 0));
  select * into v_existing from bk_reminders where profile_id = p_profile_id and client_request_id = p_client_request_id;
  if found then
    return jsonb_build_object('duplicate', true, 'reminder_id', v_existing.id, 'channel', v_existing.channel, 'status', v_existing.status, 'failure_code', v_existing.failure_code);
  end if;

  select * into v_doc from bk_documents where id = p_document_id and profile_id = p_profile_id and doc_type = 'invoice' for update;
  if not found then raise exception 'document_not_found'; end if;
  v_problem := bk_rem_problem(v_doc, false);
  if v_problem is not null then raise exception '%', v_problem; end if;
  v_due := v_doc.total - v_doc.amount_paid;

  if p_channel = 'email' then
    v_problem := bk_rem_email_problem(v_doc);
    if v_problem is not null then raise exception '%', v_problem; end if;
    select max(created_at) into v_last from bk_reminders where document_id = v_doc.id and channel = 'email' and status in ('claimed', 'sent');
    if v_last is not null and v_last > now() - interval '24 hours' then raise exception 'reminder_too_soon'; end if;
    if bk_rem_email_count(p_profile_id, v_doc.id, '-infinity'::timestamptz, false) >= 10 then raise exception 'invoice_reminder_cap'; end if;
    if bk_rem_email_count(p_profile_id, null, bk_rem_day_start(), false) >= 100 then raise exception 'daily_cap_reached'; end if;
    v_hint := bk_rem_mask_email(bk_norm_email(v_doc.customer_snapshot ->> 'email'));
    v_status := 'claimed';
  else
    v_phone := bk_norm_phone(v_doc.customer_snapshot ->> 'phone');
    if v_phone is null then
      select c.phone_normalized into v_phone from bk_document_customer_links l join bk_customers c on c.id = l.customer_id and c.profile_id = l.profile_id where l.document_id = v_doc.id;
    end if;
    if v_phone is null then raise exception 'no_phone'; end if;
    v_status := 'prepared';
  end if;

  if p_share_token_hash is not null then
    if not exists (select 1 from bk_document_shares s where s.token_hash = p_share_token_hash and s.document_id = v_doc.id and s.profile_id = p_profile_id
                      and s.revoked_at is null and s.expires_at > now()) then raise exception 'share_link_invalid'; end if;
    v_include := true;
  end if;

  select customer_id into v_link_cust from bk_document_customer_links where document_id = v_doc.id;
  v_days := case when v_doc.due_date is not null and bk_rem_today() > v_doc.due_date then bk_rem_today() - v_doc.due_date else 0 end;
  insert into bk_reminders (id, profile_id, document_id, customer_id, trigger_type, channel, kind, status, dedupe_key, client_request_id, amount_due, currency,
                            due_date, days_overdue, include_link, recipient_hint, locale, actor_user_id, completed_at)
  values (v_id, p_profile_id, v_doc.id, v_link_cust, 'manual', p_channel, 'manual', v_status, 'manual:' || p_client_request_id::text, p_client_request_id, v_due,
          v_doc.currency, v_doc.due_date, v_days, v_include, v_hint, v_doc.locale, p_actor_user_id, case when v_status = 'prepared' then now() else null end);
  v_ctx := bk_rem_context(v_doc, v_id, 'manual', v_due) || jsonb_build_object('include_link', v_include);
  return jsonb_build_object('duplicate', false, 'reminder_id', v_id, 'channel', p_channel, 'status', v_status, 'context', v_ctx);
end $$;

-- ---- outcome of a claimed reminder (manual email send or cron) --------------------------------------------------------
create or replace function doc_complete_reminder(p_profile_id uuid, p_reminder_id uuid, p_status text, p_failure_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row bk_reminders;
begin
  if p_status is null or p_status not in ('sent', 'failed', 'suppressed', 'skipped') then raise exception 'invalid_setting'; end if;
  select * into v_row from bk_reminders where id = p_reminder_id and profile_id = p_profile_id for update;
  if not found then raise exception 'reminder_not_found'; end if;
  if v_row.status <> 'claimed' then return jsonb_build_object('reminder_id', v_row.id, 'status', v_row.status, 'already_completed', true); end if;
  update bk_reminders set status = p_status, completed_at = now(), failure_code = left(nullif(btrim(coalesce(p_failure_code, '')), ''), 60)
   where id = v_row.id returning * into v_row;
  return jsonb_build_object('reminder_id', v_row.id, 'status', v_row.status, 'already_completed', false);
end $$;

-- A claim that never got an outcome (crash between claim and send) is closed as failed and is NEVER retried automatically: at most one
-- email per reminder, ever. Returns how many were closed.
create or replace function doc_expire_stale_reminder_claims(p_max_age_minutes int) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  update bk_reminders set status = 'failed', completed_at = now(), failure_code = 'stale_claim'
   where status = 'claimed' and created_at < now() - make_interval(mins => greatest(coalesce(p_max_age_minutes, 60), 5));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---- automatic reminders (cron) ---------------------------------------------------------------------------------------
-- Claims due automatic reminders ATOMICALLY (insert-before-send, unique dedupe key, row locks with SKIP LOCKED) and returns what to send.
-- Re-checked at claim time, for every row: settings on, owner plan flag, not a demo, Business & E-commerce category, a business reply-to
-- email, invoice open with a positive amount due, due date on/after the day automatic reminders were enabled, usable and non-suppressed
-- email, contact not paused/archived, per-invoice maximum, spacing, per-business daily budget (30 customer emails per Douala day, all
-- kinds counted). Automatic reminders never carry a share link. Owner alerts are claimed here too (first day an invoice is overdue).
create or replace function doc_claim_due_reminders(p_limit int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 200), 1), 500); v_today date := bk_rem_today(); v_day_start timestamptz := bk_rem_day_start();
  r record; d bk_documents; v_emails jsonb := '[]'::jsonb; v_alerts jsonb := '[]'::jsonb; v_n int := 0; v_kind text; v_key text; v_cycle int; v_due numeric;
  v_id uuid; v_last timestamptz; v_cust uuid; v_days int;
begin
  for r in
    select dd.id as doc_id, s.remind_before_days, s.remind_on_due, s.overdue_every_days, s.max_auto_per_invoice, s.profile_id
      from bk_reminder_settings s
      join profiles p on p.id = s.profile_id
      join users u on u.id = p.user_id
      left join plans pl on pl.id = u.plan_id
      join bk_documents dd on dd.profile_id = s.profile_id
     where s.auto_email_enabled and s.auto_enabled_at is not null
       and coalesce(pl.business_toolkit_enabled, false) and p.is_demo is not true
       and (p.category = 'business_ecommerce' or 'business_ecommerce' = any (coalesce(p.categories, '{}'::text[])))
       and exists (select 1 from bk_business_profiles bp where bp.profile_id = s.profile_id and bp.email is not null)
       and dd.doc_type = 'invoice' and dd.status in ('issued', 'partially_paid') and dd.total > dd.amount_paid and dd.due_date is not null
       and dd.due_date >= (s.auto_enabled_at at time zone 'Africa/Douala')::date
       and ((s.remind_before_days is not null and v_today = dd.due_date - s.remind_before_days)
         or (s.remind_on_due and v_today = dd.due_date)
         or (s.overdue_every_days is not null and v_today > dd.due_date))
     order by dd.profile_id, dd.due_date, dd.id
     limit v_limit * 3
       for update of dd skip locked
  loop
    exit when v_n >= v_limit;
    perform pg_advisory_xact_lock(hashtextextended('bkrem:' || r.profile_id::text, 0));
    select * into d from bk_documents where id = r.doc_id;       -- the row is already locked by the cursor above
    v_kind := null;
    if r.remind_before_days is not null and v_today = d.due_date - r.remind_before_days then v_kind := 'before_due'; v_key := 'auto:' || d.id::text || ':before:' || d.due_date::text;
    elsif r.remind_on_due and v_today = d.due_date then v_kind := 'due_today'; v_key := 'auto:' || d.id::text || ':due:' || d.due_date::text;
    elsif r.overdue_every_days is not null and v_today > d.due_date then
      v_kind := 'overdue'; v_cycle := (v_today - d.due_date) / r.overdue_every_days; v_key := 'auto:' || d.id::text || ':overdue:' || v_cycle::text;
    end if;
    continue when v_kind is null;
    continue when bk_rem_problem(d, true) is not null;
    continue when bk_rem_email_problem(d) is not null;
    continue when bk_rem_email_count(d.profile_id, d.id, '-infinity'::timestamptz, true) >= r.max_auto_per_invoice;
    continue when bk_rem_email_count(d.profile_id, null, v_day_start, false) >= 30;
    select max(created_at) into v_last from bk_reminders where document_id = d.id and channel = 'email' and status in ('claimed', 'sent');
    continue when v_last is not null and v_last > now() - case when v_kind = 'overdue' then make_interval(days => r.overdue_every_days) else interval '24 hours' end;

    v_due := d.total - d.amount_paid;
    v_days := case when v_today > d.due_date then v_today - d.due_date else 0 end;
    select customer_id into v_cust from bk_document_customer_links where document_id = d.id;
    v_id := null;
    insert into bk_reminders (profile_id, document_id, customer_id, trigger_type, channel, kind, status, dedupe_key, amount_due, currency, due_date, days_overdue,
                              include_link, recipient_hint, locale)
    values (d.profile_id, d.id, v_cust, 'auto', 'email', v_kind, 'claimed', v_key, v_due, d.currency, d.due_date, v_days, false,
            bk_rem_mask_email(bk_norm_email(d.customer_snapshot ->> 'email')), d.locale)
    on conflict (profile_id, dedupe_key) do nothing returning id into v_id;
    if v_id is null then continue; end if;
    v_emails := v_emails || jsonb_build_array(bk_rem_context(d, v_id, v_kind, v_due));
    v_n := v_n + 1;
  end loop;

  -- owner alerts: only on the first day an invoice is overdue, so enabling the setting never produces a backlog
  for r in
    select dd.id as doc_id, p.user_id as owner_user_id, s.profile_id
      from bk_reminder_settings s
      join profiles p on p.id = s.profile_id
      join users u on u.id = p.user_id
      left join plans pl on pl.id = u.plan_id
      join bk_documents dd on dd.profile_id = s.profile_id
     where s.owner_alerts_enabled and coalesce(pl.business_toolkit_enabled, false) and p.is_demo is not true
       and (p.category = 'business_ecommerce' or 'business_ecommerce' = any (coalesce(p.categories, '{}'::text[])))
       and dd.doc_type = 'invoice' and dd.status in ('issued', 'partially_paid') and dd.total > dd.amount_paid
       and dd.due_date is not null and dd.due_date = v_today - 1
     order by dd.profile_id, dd.id
     limit v_limit
  loop
    select * into d from bk_documents where id = r.doc_id;
    v_due := d.total - d.amount_paid;
    select customer_id into v_cust from bk_document_customer_links where document_id = d.id;
    v_id := null;
    insert into bk_reminders (profile_id, document_id, customer_id, trigger_type, channel, kind, status, dedupe_key, amount_due, currency, due_date, days_overdue,
                              include_link, locale)
    values (d.profile_id, d.id, v_cust, 'auto', 'owner_alert', 'overdue', 'claimed', 'owner:' || d.id::text || ':' || d.due_date::text, v_due, d.currency, d.due_date, 1, false, d.locale)
    on conflict (profile_id, dedupe_key) do nothing returning id into v_id;
    if v_id is null then continue; end if;
    v_alerts := v_alerts || jsonb_build_array(bk_rem_context(d, v_id, 'overdue', v_due) || jsonb_build_object('owner_user_id', r.owner_user_id));
  end loop;
  return jsonb_build_object('emails', v_emails, 'alerts', v_alerts);
end $$;

-- ============================================================================
-- 6. EXECUTE PRIVILEGES (explicit)
-- ============================================================================
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in (
              'bk_norm_phone', 'bk_norm_email', 'bk_rem_mask_email', 'bk_customer_event', 'bk_rem_problem', 'bk_rem_email_problem', 'bk_rem_today',
              'bk_rem_day_start', 'bk_rem_email_count', 'bk_rem_context',
              'bk_customer_save', 'bk_customer_set_archived', 'bk_customer_set_auto_paused', 'doc_set_document_customer', 'doc_suggest_customers',
              'doc_receivables_summary', 'doc_receivable_invoices', 'doc_customer_statement', 'doc_check_share', 'doc_upsert_reminder_settings',
              'doc_record_manual_reminder', 'doc_complete_reminder', 'doc_expire_stale_reminder_claims', 'doc_claim_due_reminders',
              'bk_customers_guard', 'bk_document_customer_links_guard', 'bk_customer_events_guard', 'bk_reminder_settings_guard', 'bk_reminders_guard')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in (
              'bk_customer_save', 'bk_customer_set_archived', 'bk_customer_set_auto_paused', 'doc_set_document_customer', 'doc_suggest_customers',
              'doc_receivables_summary', 'doc_receivable_invoices', 'doc_customer_statement', 'doc_check_share', 'doc_upsert_reminder_settings',
              'doc_record_manual_reminder', 'doc_complete_reminder', 'doc_expire_stale_reminder_claims', 'doc_claim_due_reminders')
  loop
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- ============================================================================
-- 7. ROW LEVEL SECURITY AND TABLE PRIVILEGES
-- ============================================================================
alter table bk_customers enable row level security;
alter table bk_document_customer_links enable row level security;
alter table bk_customer_events enable row level security;
alter table bk_reminder_settings enable row level security;
alter table bk_reminders enable row level security;

revoke all on bk_customers, bk_document_customer_links, bk_customer_events, bk_reminder_settings, bk_reminders from anon, authenticated, service_role;
grant select on bk_customers, bk_document_customer_links, bk_customer_events, bk_reminder_settings, bk_reminders to authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'bk_customers' and policyname = 'bk_customers owner read') then
    create policy "bk_customers owner read" on bk_customers for select to authenticated
      using (exists (select 1 from profiles p where p.id = profile_id and p.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'bk_document_customer_links' and policyname = 'bk_document_customer_links owner read') then
    create policy "bk_document_customer_links owner read" on bk_document_customer_links for select to authenticated
      using (exists (select 1 from profiles p where p.id = profile_id and p.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'bk_customer_events' and policyname = 'bk_customer_events owner read') then
    create policy "bk_customer_events owner read" on bk_customer_events for select to authenticated
      using (exists (select 1 from profiles p where p.id = profile_id and p.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'bk_reminder_settings' and policyname = 'bk_reminder_settings owner read') then
    create policy "bk_reminder_settings owner read" on bk_reminder_settings for select to authenticated
      using (exists (select 1 from profiles p where p.id = profile_id and p.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'bk_reminders' and policyname = 'bk_reminders owner read') then
    create policy "bk_reminders owner read" on bk_reminders for select to authenticated
      using (exists (select 1 from profiles p where p.id = profile_id and p.user_id = auth.uid()));
  end if;
end $$;

commit;

-- ============================================================================
-- ROLLBACK (documented only; NOT part of the migration). Touches ONLY objects this migration created: name-exact, no CASCADE.
-- Dropping the tables deletes contacts, links, settings and the reminder log (export first). It does not touch bk_documents,
-- bk_document_payments, bk_entries, email_delivery_logs or any Phase 1/2 object. Phase 3 functions that take the bk_documents row type
-- must be dropped BEFORE any later attempt to drop bk_documents (see the Phase 2 rollback).
-- ============================================================================
--   begin;
--   drop function if exists doc_claim_due_reminders(int);
--   drop function if exists doc_expire_stale_reminder_claims(int);
--   drop function if exists doc_complete_reminder(uuid, uuid, text, text);
--   drop function if exists doc_record_manual_reminder(uuid, uuid, uuid, text, uuid, text);
--   drop function if exists doc_upsert_reminder_settings(uuid, uuid, boolean, int, boolean, int, int, boolean);
--   drop function if exists doc_check_share(uuid, uuid, uuid, text);
--   drop function if exists doc_customer_statement(uuid, uuid, uuid);
--   drop function if exists doc_receivable_invoices(uuid, uuid, uuid, boolean, boolean, text, int, int);
--   drop function if exists doc_receivables_summary(uuid, uuid);
--   drop function if exists doc_suggest_customers(uuid, uuid, uuid);
--   drop function if exists doc_set_document_customer(uuid, uuid, uuid, uuid);
--   drop function if exists bk_customer_set_auto_paused(uuid, uuid, uuid, boolean);
--   drop function if exists bk_customer_set_archived(uuid, uuid, uuid, boolean);
--   drop function if exists bk_customer_save(uuid, uuid, uuid, text, text, text, text, uuid);
--   drop function if exists bk_rem_context(bk_documents, uuid, text, numeric);
--   drop function if exists bk_rem_email_count(uuid, uuid, timestamptz, boolean);
--   drop function if exists bk_rem_day_start();
--   drop function if exists bk_rem_today();
--   drop function if exists bk_rem_email_problem(bk_documents);
--   drop function if exists bk_rem_problem(bk_documents, boolean);
--   drop function if exists bk_customer_event(uuid, uuid, text, uuid, uuid, jsonb);
--   drop table if exists bk_reminders;
--   drop table if exists bk_reminder_settings;
--   drop table if exists bk_customer_events;
--   drop table if exists bk_document_customer_links;
--   drop table if exists bk_customers;
--   drop function if exists bk_reminders_guard();
--   drop function if exists bk_reminder_settings_guard();
--   drop function if exists bk_customer_events_guard();
--   drop function if exists bk_document_customer_links_guard();
--   drop function if exists bk_customers_guard();
--   drop function if exists bk_rem_mask_email(text);
--   drop function if exists bk_norm_email(text);
--   drop function if exists bk_norm_phone(text);
--   commit;
