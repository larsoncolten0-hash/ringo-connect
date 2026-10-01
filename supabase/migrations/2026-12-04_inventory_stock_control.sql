-- Business Toolkit — Phase 4 (Inventory & Stock Control) — PROPOSED, NOT APPLIED.
--
-- Canonical design: docs/business-toolkit-phase4-inventory.md. Applied manually in the Supabase SQL editor, like every other file in this
-- folder. 2026-12-04 is the next slot (latest: 2026-12-03_debtors_reminders.sql).
-- Run supabase/support/2026-12-04_inventory_stock_control.preflight.sql first, and ...verify.sql afterwards.
--
-- What it changes
--   NEW   tables: bk_stock_settings, bk_stock_movements
--   NEW   functions: the inv_* service-role functions and the bk_stock_* helpers/guards listed in section 6
--   NEW   ONE trigger on the EXISTING table products (section 4): bk_products_stock_guard_trg. It is the only change to an existing
--         object and it is narrowly scoped (see below). No existing function, table, column, constraint or policy is modified. The
--         checkout functions (create_product_order, release_product_order_stock), settlement, refunds, payments, Phase 1/2/3 objects
--         are only READ, never altered.
--
-- Balance model: the LIVE balance remains products.inventory_count (NULL = untracked / unlimited), exactly as checkout, the public pages and
--   Ringo AI already use it. There is no second balance. bk_stock_movements is the immutable audit ledger of the controlled Phase 4
--   operations; every controlled change updates the product count and writes its ledger row in ONE function, in one transaction, with the
--   before/after balances taken from the same atomic UPDATE (row-locked, so negative stock cannot happen and checkout's own reservation
--   UPDATE serialises against it).
--
-- Sales are NOT handled here: the existing reservation model is untouched (stock is decremented when a Shop order is created and returned by
--   the existing release lifecycle). Phase 4 only READS orders to display Reserved vs Sold and to validate a manual refund restock.
--
-- The products guard trigger (the one approved change to an existing table)
--   For a product that has an ACTIVE row in bk_stock_settings ("tracked"), a write to products.inventory_count that comes from an ordinary
--   client role (the browser/editor: role 'authenticated' or 'anon') keeps the OLD value (the rest of the row is saved normally, so the
--   editor never errors). Everything else is unaffected: untracked products behave exactly as before; trusted service-role operations
--   (create_product_order, release_product_order_stock, the Phase 4 functions, the music merch route) and the SQL editor are not touched.
--   The trigger fires only when inventory_count is in the UPDATE's column list and decides on the first line from the session role, so the
--   checkout hot path costs one setting read and can never raise.
--
-- Design principles (same as Phases 1–3)
--   * Owner-only, plan flag and demo check through bk_doc_gate(); Business & E-commerce category enforced here and in the app.
--   * No client role can write the new tables; service_role holds SELECT only; rows change only through the guarded functions.
--   * The ledger is append-only, survives product deletion (no foreign key to products, name snapshotted), and is never truncated.
--   * Idempotent to re-run (IF NOT EXISTS / CREATE OR REPLACE / guarded policies); the single transaction means nothing is half-applied.

begin;

-- ============================================================================
-- 0. DEPENDENCY CHECK
-- ============================================================================
do $$
begin
  if to_regclass('public.products') is null or to_regclass('public.product_orders') is null or to_regclass('public.product_order_items') is null
     or to_regprocedure('public.bk_doc_gate(uuid,uuid)') is null or to_regprocedure('public.bk_truncate_guard()') is null
     or to_regprocedure('public.bk_currency_digits(text)') is null
     or (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'products'
           and column_name in ('id', 'profile_id', 'name', 'inventory_count', 'product_type')) <> 5
     or (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'product_orders'
           and column_name in ('id', 'profile_id', 'status', 'stock_released_at', 'created_at', 'order_number')) <> 6
     or (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles'
           and column_name in ('id', 'user_id', 'is_demo', 'category', 'categories', 'currency')) <> 6 then
    raise exception 'Phase 4 requires the Phase 1-3 migrations, the Shop checkout tables and products(inventory_count, product_type)';
  end if;
end $$;

-- ============================================================================
-- 1. TABLES
-- ============================================================================
create table if not exists bk_stock_settings (
  product_id uuid primary key,                          -- deliberately NO foreign key: history must not depend on the product row
  profile_id uuid not null references profiles(id) on delete restrict,
  active boolean not null default true,                 -- true = tracked (the guard protects its count); false = tracking stopped
  low_stock_threshold int not null default 5 check (low_stock_threshold between 0 and 1000000),
  sku text check (sku is null or char_length(btrim(sku)) between 1 and 60),
  unit_cost numeric(14,3) check (unit_cost is null or unit_cost >= 0),              -- informational only, in cost_currency
  cost_currency text check (cost_currency is null or (cost_currency = upper(cost_currency) and char_length(cost_currency) = 3)),
  tracking_started_at timestamptz not null default now(),
  stopped_at timestamptz,
  created_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  check ((unit_cost is null) = (cost_currency is null)),
  check (unit_cost is null or unit_cost = round(unit_cost, bk_currency_digits(cost_currency))),
  check (active = (stopped_at is null))
);
create unique index if not exists bk_stock_settings_sku_idx on bk_stock_settings (profile_id, sku) where sku is not null and active;
create index if not exists bk_stock_settings_profile_idx on bk_stock_settings (profile_id, active);

create table if not exists bk_stock_movements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete restrict,
  product_id uuid not null,                             -- no foreign key (survives product deletion)
  product_name_snapshot text not null check (char_length(product_name_snapshot) between 1 and 300),
  kind text not null check (kind in ('opening', 'stock_in', 'increase', 'decrease', 'correction', 'damaged', 'lost', 'sold_elsewhere', 'return_restock', 'tracking_stopped')),
  qty_delta int not null,
  balance_before int check (balance_before is null or balance_before >= 0),
  balance_after int check (balance_after is null or balance_after >= 0),
  reason text check (reason is null or char_length(btrim(reason)) between 1 and 200),
  note text check (note is null or char_length(note) <= 500),
  unit_cost numeric(14,3) check (unit_cost is null or unit_cost >= 0),
  source_type text check (source_type is null or source_type in ('product_order', 'invoice')),
  source_id uuid,
  client_request_id uuid not null,
  created_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (profile_id, client_request_id),
  check ((source_type is null) = (source_id is null)),
  -- the balance chain: the opening has no "before", a stop has no "after", everything else moves by exactly qty_delta
  check ((kind = 'opening'          and balance_before is null and balance_after is not null and qty_delta = balance_after)
      or (kind = 'tracking_stopped' and balance_before is not null and balance_after is null and qty_delta = 0)
      or (kind not in ('opening', 'tracking_stopped') and balance_before is not null and balance_after is not null and qty_delta <> 0 and balance_after = balance_before + qty_delta)),
  -- direction by kind
  check (kind not in ('stock_in', 'increase', 'return_restock') or qty_delta > 0),
  check (kind not in ('decrease', 'damaged', 'lost', 'sold_elsewhere') or qty_delta < 0),
  -- a reason is mandatory where the movement is a judgement call
  check (kind not in ('increase', 'decrease', 'correction', 'sold_elsewhere') or reason is not null),
  -- a restock is always tied to the refunded order it comes from; only that and sold_elsewhere carry a source
  check (kind <> 'return_restock' or coalesce(source_type = 'product_order', false)),
  check (source_type is null or kind in ('return_restock', 'sold_elsewhere')),
  check (unit_cost is null or kind = 'stock_in')
);
create index if not exists bk_stock_movements_product_idx on bk_stock_movements (profile_id, product_id, created_at desc);
create index if not exists bk_stock_movements_profile_idx on bk_stock_movements (profile_id, created_at desc);
create index if not exists bk_stock_movements_source_idx on bk_stock_movements (profile_id, source_id) where source_id is not null;

-- ============================================================================
-- 2. INTEGRITY GUARDS
-- ============================================================================
create or replace function bk_stock_settings_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'bk_stock_settings: rows are never deleted; stop tracking instead'; end if;
  if new.product_id <> old.product_id or new.profile_id <> old.profile_id or new.created_at <> old.created_at or new.created_by is distinct from old.created_by then
    raise exception 'bk_stock_settings: identity columns are immutable';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists bk_stock_settings_guard_trg on bk_stock_settings;
create trigger bk_stock_settings_guard_trg before update or delete on bk_stock_settings for each row execute function bk_stock_settings_guard();

create or replace function bk_stock_movements_guard() returns trigger language plpgsql as $$
begin
  raise exception 'bk_stock_movements is append-only';
end $$;
drop trigger if exists bk_stock_movements_guard_trg on bk_stock_movements;
create trigger bk_stock_movements_guard_trg before update or delete on bk_stock_movements for each row execute function bk_stock_movements_guard();

drop trigger if exists bk_stock_settings_truncate_guard_trg on bk_stock_settings;
create trigger bk_stock_settings_truncate_guard_trg before truncate on bk_stock_settings for each statement execute function bk_truncate_guard();
drop trigger if exists bk_stock_movements_truncate_guard_trg on bk_stock_movements;
create trigger bk_stock_movements_truncate_guard_trg before truncate on bk_stock_movements for each statement execute function bk_truncate_guard();

-- ============================================================================
-- 3. HELPERS (not callable by any client role)
-- ============================================================================
create or replace function bk_stock_clean_text(p_text text, p_max int, p_code text) returns text
language plpgsql immutable as $$
declare v text := nullif(btrim(coalesce(p_text, '')), '');
begin
  if v is not null and char_length(v) > p_max then raise exception '%', p_code; end if;
  return v;
end $$;

-- ============================================================================
-- 4. THE ONE CHANGE TO AN EXISTING TABLE: protect a TRACKED product's count from ordinary client writes
-- ============================================================================
-- current_setting('role') is the session role the request runs as: 'authenticated'/'anon' for the browser through PostgREST,
-- 'service_role' for the trusted server, 'none'/'postgres' for the SQL editor. It is read FIRST and returns early for every trusted
-- caller, so create_product_order / release_product_order_stock / the Phase 4 functions are never affected and this can never raise.
create or replace function bk_products_stock_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('role', true), '') not in ('authenticated', 'anon') then return new; end if;
  if new.inventory_count is not distinct from old.inventory_count then return new; end if;
  if exists (select 1 from bk_stock_settings s where s.product_id = old.id and s.active) then
    new.inventory_count := old.inventory_count;       -- keep the real count; the rest of the row saves normally
  end if;
  return new;
end $$;
drop trigger if exists bk_products_stock_guard_trg on products;
create trigger bk_products_stock_guard_trg before update of inventory_count on products for each row execute function bk_products_stock_guard();

-- ============================================================================
-- 5. SERVICE-ROLE FUNCTIONS
-- ============================================================================
-- ---- start / adopt tracking --------------------------------------------------------------------------------------------------
-- A product with a legacy non-NULL count is ADOPTED at exactly that count (the opening movement mirrors it; a different quantity is
-- refused so a stale screen can never change stock). A product with a NULL count (unlimited) needs an explicit opening quantity.
create or replace function inv_start_tracking(
  p_profile_id uuid, p_actor_user_id uuid, p_product_id uuid, p_opening_qty int, p_low_stock_threshold int, p_client_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing bk_stock_movements; v_prod record; v_cat boolean; v_threshold int := coalesce(p_low_stock_threshold, 5); v_count int; v_mv bk_stock_movements;
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_client_request_id is null then raise exception 'request_id_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bkstock:' || p_profile_id::text || ':' || p_client_request_id::text, 0));
  select * into v_existing from bk_stock_movements where profile_id = p_profile_id and client_request_id = p_client_request_id;
  if found then return jsonb_build_object('duplicate', true, 'movement', to_jsonb(v_existing)); end if;

  select (p.category = 'business_ecommerce' or 'business_ecommerce' = any (coalesce(p.categories, '{}'::text[]))) into v_cat from profiles p where p.id = p_profile_id;
  if v_cat is not true then raise exception 'category_not_enabled'; end if;
  if v_threshold < 0 or v_threshold > 1000000 then raise exception 'invalid_threshold'; end if;
  if p_opening_qty is not null and (p_opening_qty < 0 or p_opening_qty > 1000000000) then raise exception 'invalid_quantity'; end if;

  select id, name, inventory_count, product_type into v_prod from products where id = p_product_id and profile_id = p_profile_id for update;
  if not found then raise exception 'product_not_found'; end if;
  if v_prod.product_type is distinct from 'physical' then raise exception 'digital_not_supported'; end if;
  if exists (select 1 from bk_stock_settings where product_id = p_product_id and active) then raise exception 'already_tracked'; end if;

  if v_prod.inventory_count is not null then
    if p_opening_qty is not null and p_opening_qty <> v_prod.inventory_count then raise exception 'count_mismatch'; end if;
    v_count := v_prod.inventory_count;
  else
    if p_opening_qty is null then raise exception 'opening_quantity_required'; end if;
    update products set inventory_count = p_opening_qty where id = p_product_id and profile_id = p_profile_id and inventory_count is null returning inventory_count into v_count;
    if v_count is null then raise exception 'stock_changed_retry'; end if;
  end if;

  insert into bk_stock_settings as s (product_id, profile_id, active, low_stock_threshold, tracking_started_at, stopped_at, created_by, updated_by)
  values (p_product_id, p_profile_id, true, v_threshold, now(), null, p_actor_user_id, p_actor_user_id)
  on conflict (product_id) do update set active = true, low_stock_threshold = excluded.low_stock_threshold, tracking_started_at = now(), stopped_at = null, updated_by = excluded.updated_by;

  insert into bk_stock_movements (profile_id, product_id, product_name_snapshot, kind, qty_delta, balance_before, balance_after, client_request_id, created_by)
  values (p_profile_id, p_product_id, left(v_prod.name, 300), 'opening', v_count, null, v_count, p_client_request_id, p_actor_user_id) returning * into v_mv;
  return jsonb_build_object('duplicate', false, 'product_id', p_product_id, 'balance', v_count, 'movement', to_jsonb(v_mv));
end $$;

-- ---- increase / decrease (stock received, manual, damaged, lost, sold elsewhere) -----------------------------------------------
create or replace function inv_adjust_stock(
  p_profile_id uuid, p_actor_user_id uuid, p_product_id uuid, p_kind text, p_quantity int, p_reason text, p_note text,
  p_source_type text, p_source_id uuid, p_unit_cost numeric, p_client_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_currency text; v_existing bk_stock_movements; v_delta int; v_reason text; v_note text; v_after int; v_name text; v_mv bk_stock_movements;
begin
  v_currency := bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_client_request_id is null then raise exception 'request_id_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bkstock:' || p_profile_id::text || ':' || p_client_request_id::text, 0));
  select * into v_existing from bk_stock_movements where profile_id = p_profile_id and client_request_id = p_client_request_id;
  if found then return jsonb_build_object('duplicate', true, 'movement', to_jsonb(v_existing)); end if;

  if p_kind is null or p_kind not in ('stock_in', 'increase', 'decrease', 'damaged', 'lost', 'sold_elsewhere') then raise exception 'invalid_kind'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 1000000 then raise exception 'invalid_quantity'; end if;
  v_reason := bk_stock_clean_text(p_reason, 200, 'invalid_reason');
  v_note := bk_stock_clean_text(p_note, 500, 'invalid_note');
  if v_reason is null and p_kind in ('increase', 'decrease', 'sold_elsewhere') then raise exception 'reason_required'; end if;
  if p_source_type is not null or p_source_id is not null then
    if p_kind <> 'sold_elsewhere' or p_source_type is distinct from 'invoice' or p_source_id is null
       or not exists (select 1 from bk_documents d where d.id = p_source_id and d.profile_id = p_profile_id and d.doc_type = 'invoice') then
      raise exception 'invalid_source';
    end if;
  end if;
  if p_unit_cost is not null then
    if p_kind <> 'stock_in' or p_unit_cost < 0 then raise exception 'invalid_unit_cost'; end if;
    if p_unit_cost <> round(p_unit_cost, bk_currency_digits(v_currency)) then raise exception 'amount_too_precise'; end if;
  end if;
  if not exists (select 1 from bk_stock_settings where product_id = p_product_id and profile_id = p_profile_id and active) then raise exception 'not_tracked'; end if;

  v_delta := case when p_kind in ('stock_in', 'increase') then p_quantity else -p_quantity end;
  -- ONE atomic, row-locked statement: the same pattern checkout's reservation uses, so it can neither go negative nor lose a concurrent update
  update products set inventory_count = inventory_count + v_delta
   where id = p_product_id and profile_id = p_profile_id and inventory_count is not null
     and inventory_count::bigint + v_delta >= 0 and inventory_count::bigint + v_delta <= 1000000000
  returning inventory_count, name into v_after, v_name;
  if not found then
    if not exists (select 1 from products where id = p_product_id and profile_id = p_profile_id and inventory_count is not null) then raise exception 'not_tracked'; end if;
    if v_delta > 0 then raise exception 'stock_limit_exceeded'; end if;
    raise exception 'insufficient_stock';
  end if;

  insert into bk_stock_movements (profile_id, product_id, product_name_snapshot, kind, qty_delta, balance_before, balance_after, reason, note, unit_cost,
                                  source_type, source_id, client_request_id, created_by)
  values (p_profile_id, p_product_id, left(v_name, 300), p_kind, v_delta, v_after - v_delta, v_after, v_reason, v_note, p_unit_cost,
          p_source_type, p_source_id, p_client_request_id, p_actor_user_id) returning * into v_mv;
  return jsonb_build_object('duplicate', false, 'product_id', p_product_id, 'balance', v_after, 'movement', to_jsonb(v_mv));
end $$;

-- ---- correction to a target count ----------------------------------------------------------------------------------------------
create or replace function inv_set_stock_count(
  p_profile_id uuid, p_actor_user_id uuid, p_product_id uuid, p_target int, p_reason text, p_note text, p_client_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_existing bk_stock_movements; v_reason text; v_note text; v_cur int; v_name text; v_mv bk_stock_movements;
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_client_request_id is null then raise exception 'request_id_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bkstock:' || p_profile_id::text || ':' || p_client_request_id::text, 0));
  select * into v_existing from bk_stock_movements where profile_id = p_profile_id and client_request_id = p_client_request_id;
  if found then return jsonb_build_object('duplicate', true, 'movement', to_jsonb(v_existing)); end if;

  if p_target is null or p_target < 0 or p_target > 1000000000 then raise exception 'invalid_quantity'; end if;
  v_reason := bk_stock_clean_text(p_reason, 200, 'invalid_reason');
  v_note := bk_stock_clean_text(p_note, 500, 'invalid_note');
  if v_reason is null then raise exception 'reason_required'; end if;
  if not exists (select 1 from bk_stock_settings where product_id = p_product_id and profile_id = p_profile_id and active) then raise exception 'not_tracked'; end if;

  select inventory_count, name into v_cur, v_name from products where id = p_product_id and profile_id = p_profile_id for update;       -- row lock: serialises with checkout
  if not found or v_cur is null then raise exception 'not_tracked'; end if;
  if v_cur = p_target then raise exception 'no_change'; end if;
  update products set inventory_count = p_target where id = p_product_id and profile_id = p_profile_id;

  insert into bk_stock_movements (profile_id, product_id, product_name_snapshot, kind, qty_delta, balance_before, balance_after, reason, note, client_request_id, created_by)
  values (p_profile_id, p_product_id, left(v_name, 300), 'correction', p_target - v_cur, v_cur, p_target, v_reason, v_note, p_client_request_id, p_actor_user_id) returning * into v_mv;
  return jsonb_build_object('duplicate', false, 'product_id', p_product_id, 'balance', p_target, 'movement', to_jsonb(v_mv));
end $$;

-- ---- manual restock of a REFUNDED Shop order's item ------------------------------------------------------------------------------
-- Only a refunded order qualifies; partial restocks are allowed; the total restocked for an order's product can never exceed the ordered
-- quantity (checked under the product row lock, so concurrent requests cannot both pass). Nothing here changes the order or any payment.
create or replace function inv_return_restock(
  p_profile_id uuid, p_actor_user_id uuid, p_order_id uuid, p_product_id uuid, p_quantity int, p_note text, p_client_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing bk_stock_movements; v_note text; v_status text; v_ordered int; v_done int; v_after int; v_name text; v_mv bk_stock_movements;
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_client_request_id is null then raise exception 'request_id_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bkstock:' || p_profile_id::text || ':' || p_client_request_id::text, 0));
  select * into v_existing from bk_stock_movements where profile_id = p_profile_id and client_request_id = p_client_request_id;
  if found then return jsonb_build_object('duplicate', true, 'movement', to_jsonb(v_existing)); end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 1000000 then raise exception 'invalid_quantity'; end if;
  v_note := bk_stock_clean_text(p_note, 500, 'invalid_note');
  select status into v_status from product_orders where id = p_order_id and profile_id = p_profile_id;
  if not found then raise exception 'order_not_found'; end if;
  if v_status <> 'refunded' then raise exception 'order_not_refunded'; end if;
  select coalesce(sum(quantity), 0)::int into v_ordered from product_order_items where order_id = p_order_id and product_id = p_product_id;
  if v_ordered = 0 then raise exception 'order_item_not_found'; end if;
  if not exists (select 1 from bk_stock_settings where product_id = p_product_id and profile_id = p_profile_id and active) then raise exception 'not_tracked'; end if;

  perform 1 from products where id = p_product_id and profile_id = p_profile_id for update;      -- serialise concurrent restocks of this product
  if not found then raise exception 'product_not_found'; end if;
  select coalesce(sum(qty_delta), 0)::int into v_done from bk_stock_movements
   where profile_id = p_profile_id and product_id = p_product_id and kind = 'return_restock' and source_type = 'product_order' and source_id = p_order_id;
  if v_done + p_quantity > v_ordered then raise exception 'exceeds_returnable'; end if;

  update products set inventory_count = inventory_count + p_quantity
   where id = p_product_id and profile_id = p_profile_id and inventory_count is not null and inventory_count::bigint + p_quantity <= 1000000000
  returning inventory_count, name into v_after, v_name;
  if not found then raise exception 'stock_limit_exceeded'; end if;

  insert into bk_stock_movements (profile_id, product_id, product_name_snapshot, kind, qty_delta, balance_before, balance_after, note, source_type, source_id, client_request_id, created_by)
  values (p_profile_id, p_product_id, left(v_name, 300), 'return_restock', p_quantity, v_after - p_quantity, v_after, v_note, 'product_order', p_order_id, p_client_request_id, p_actor_user_id)
  returning * into v_mv;
  return jsonb_build_object('duplicate', false, 'product_id', p_product_id, 'balance', v_after, 'movement', to_jsonb(v_mv));
end $$;

-- ---- stop tracking ------------------------------------------------------------------------------------------------------------------
-- The product becomes untracked / unlimited again (inventory_count NULL). The ledger is kept. A reservation still in flight is unaffected:
-- the existing release function only adds stock back where the count is not NULL.
create or replace function inv_stop_tracking(p_profile_id uuid, p_actor_user_id uuid, p_product_id uuid, p_note text, p_client_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_existing bk_stock_movements; v_note text; v_cur int; v_name text; v_mv bk_stock_movements;
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_client_request_id is null then raise exception 'request_id_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bkstock:' || p_profile_id::text || ':' || p_client_request_id::text, 0));
  select * into v_existing from bk_stock_movements where profile_id = p_profile_id and client_request_id = p_client_request_id;
  if found then return jsonb_build_object('duplicate', true, 'movement', to_jsonb(v_existing)); end if;

  v_note := bk_stock_clean_text(p_note, 500, 'invalid_note');
  if not exists (select 1 from bk_stock_settings where product_id = p_product_id and profile_id = p_profile_id and active) then raise exception 'not_tracked'; end if;
  select inventory_count, name into v_cur, v_name from products where id = p_product_id and profile_id = p_profile_id for update;
  if not found or v_cur is null then raise exception 'not_tracked'; end if;

  update bk_stock_settings set active = false, stopped_at = now(), updated_by = p_actor_user_id where product_id = p_product_id;
  update products set inventory_count = null where id = p_product_id and profile_id = p_profile_id;
  insert into bk_stock_movements (profile_id, product_id, product_name_snapshot, kind, qty_delta, balance_before, balance_after, note, client_request_id, created_by)
  values (p_profile_id, p_product_id, left(v_name, 300), 'tracking_stopped', 0, v_cur, null, v_note, p_client_request_id, p_actor_user_id) returning * into v_mv;
  return jsonb_build_object('duplicate', false, 'product_id', p_product_id, 'last_balance', v_cur, 'movement', to_jsonb(v_mv));
end $$;

-- ---- settings (threshold, SKU, optional unit cost) ---------------------------------------------------------------------------------
create or replace function inv_update_settings(
  p_profile_id uuid, p_actor_user_id uuid, p_product_id uuid, p_low_stock_threshold int, p_sku text, p_unit_cost numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_currency text; v_sku text; v_row bk_stock_settings;
begin
  v_currency := bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_low_stock_threshold is null or p_low_stock_threshold < 0 or p_low_stock_threshold > 1000000 then raise exception 'invalid_threshold'; end if;
  v_sku := bk_stock_clean_text(p_sku, 60, 'invalid_sku');
  if p_unit_cost is not null then
    if p_unit_cost < 0 then raise exception 'invalid_unit_cost'; end if;
    if p_unit_cost <> round(p_unit_cost, bk_currency_digits(v_currency)) then raise exception 'amount_too_precise'; end if;
  end if;
  select * into v_row from bk_stock_settings where product_id = p_product_id and profile_id = p_profile_id and active for update;
  if not found then raise exception 'not_tracked'; end if;
  begin
    update bk_stock_settings set low_stock_threshold = p_low_stock_threshold, sku = v_sku, unit_cost = p_unit_cost,
           cost_currency = case when p_unit_cost is null then null else v_currency end, updated_by = p_actor_user_id
     where product_id = p_product_id returning * into v_row;
  exception when unique_violation then
    raise exception 'duplicate_sku';
  end;
  return to_jsonb(v_row);
end $$;

-- ---- reads (aggregated in SQL; money and counts exact) ------------------------------------------------------------------------------
-- Reserved = units held by Shop orders still awaiting payment whose stock has not been released. Sold = units on paid/fulfilled orders
-- since tracking started. Both are READ from the existing orders; nothing is written.
-- drift: the live count differs from "last ledger balance + the order reservations/releases since" (e.g. the stock was edited outside
-- the inventory tools). Best effort: orders in flight at that very instant can make it flicker, so it is shown as "check this".
create or replace function inv_overview(p_profile_id uuid, p_actor_user_id uuid, p_filter text, p_limit int, p_offset int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cur text; v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100); v_offset int := greatest(coalesce(p_offset, 0), 0); v_out jsonb;
begin
  v_cur := bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_filter is not null and p_filter not in ('tracked', 'low', 'out', 'ok', 'untracked', 'legacy') then raise exception 'invalid_filter'; end if;
  with prod as (
    select p.id, p.name, p.inventory_count as cnt, p.available, s.low_stock_threshold as thr, s.sku, s.unit_cost, s.cost_currency, s.tracking_started_at,
           (s.product_id is not null) as tracked
      from products p left join bk_stock_settings s on s.product_id = p.id and s.profile_id = p.profile_id and s.active
     where p.profile_id = p_profile_id and p.product_type = 'physical'),
  res as (
    select i.product_id, sum(i.quantity)::int as q from product_order_items i join product_orders o on o.id = i.order_id
     where o.profile_id = p_profile_id and o.status = 'awaiting_payment' and o.stock_released_at is null and i.product_id is not null group by i.product_id),
  sold as (
    select i.product_id, sum(i.quantity)::int as q from product_order_items i join product_orders o on o.id = i.order_id join prod pr on pr.id = i.product_id
     where o.profile_id = p_profile_id and o.status in ('paid', 'fulfilled') and pr.tracked and o.created_at >= pr.tracking_started_at group by i.product_id),
  lm as (
    select distinct on (m.product_id) m.product_id, m.created_at, m.balance_after from bk_stock_movements m
     where m.profile_id = p_profile_id and m.product_id in (select id from prod where tracked) order by m.product_id, m.created_at desc, m.id desc),
  eff as (
    select lm.product_id, coalesce(sum(case when o.created_at > lm.created_at then -i.quantity else 0 end), 0)
                        + coalesce(sum(case when o.stock_released_at > lm.created_at then i.quantity else 0 end), 0) as e
      from lm join product_order_items i on i.product_id = lm.product_id join product_orders o on o.id = i.order_id and o.profile_id = p_profile_id
     group by lm.product_id),
  rws as (
    select pr.*, coalesce(res.q, 0) as reserved, coalesce(sold.q, 0) as sold_units, lm.balance_after as last_balance, lm.created_at as last_move_at,
           case when pr.tracked and lm.balance_after is not null then pr.cnt - (lm.balance_after + coalesce(eff.e, 0)) else 0 end as drift,
           case when not pr.tracked and pr.cnt is not null then 'legacy' when not pr.tracked then 'untracked'
                when pr.cnt = 0 then 'out' when pr.cnt <= pr.thr then 'low' else 'ok' end as state
      from prod pr left join res on res.product_id = pr.id left join sold on sold.product_id = pr.id left join lm on lm.product_id = pr.id left join eff on eff.product_id = pr.id),
  filtered as (
    select * from rws where p_filter is null or (p_filter = 'tracked' and tracked) or (p_filter in ('low', 'out', 'ok', 'untracked', 'legacy') and state = p_filter)),
  page as (
    select f.*, count(*) over () as total_rows from filtered f
     order by case state when 'out' then 0 when 'low' then 1 when 'ok' then 2 when 'legacy' then 3 else 4 end, name asc, id asc limit v_limit offset v_offset),
  summary as (
    select count(*) filter (where tracked) as tracked, count(*) filter (where state = 'out') as out_n, count(*) filter (where state = 'low') as low_n, count(*) filter (where state = 'ok') as ok_n,
           count(*) filter (where state = 'legacy') as legacy_n, count(*) filter (where state = 'untracked') as untracked_n,
           coalesce(sum(cnt::numeric * unit_cost) filter (where tracked and unit_cost is not null and cost_currency = v_cur), 0) as est_value,
           count(*) filter (where tracked and (unit_cost is null or cost_currency <> v_cur)) as value_excluded,
           count(*) filter (where tracked and drift <> 0) as drift_n
      from rws)
  select jsonb_build_object(
           'profile_currency', v_cur,
           'summary', (select jsonb_build_object('tracked', tracked, 'out', out_n, 'low', low_n, 'ok', ok_n, 'legacy', legacy_n, 'untracked', untracked_n,
                          'estimated_value', est_value::text, 'value_excluded', value_excluded, 'drift', drift_n) from summary),
           'total', coalesce((select max(total_rows) from page), 0),
           'items', coalesce((select jsonb_agg(jsonb_build_object(
                'product_id', pg.id, 'name', pg.name, 'available', pg.available is not false, 'state', pg.state, 'tracked', pg.tracked, 'count', pg.cnt,
                'low_stock_threshold', pg.thr, 'reserved', pg.reserved, 'sold_units', pg.sold_units, 'sku', pg.sku,
                'unit_cost', pg.unit_cost::text, 'cost_currency', pg.cost_currency,
                'estimated_value', case when pg.tracked and pg.unit_cost is not null and pg.cost_currency = v_cur then (pg.cnt::numeric * pg.unit_cost)::text else null end,
                'last_movement_at', pg.last_move_at, 'drift', pg.drift)
              order by case pg.state when 'out' then 0 when 'low' then 1 when 'ok' then 2 when 'legacy' then 3 else 4 end, pg.name asc, pg.id asc) from page pg), '[]'::jsonb))
    into v_out;
  return v_out;
end $$;

create or replace function inv_product_detail(p_profile_id uuid, p_actor_user_id uuid, p_product_id uuid, p_limit int, p_offset int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cur text; v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100); v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_prod record; v_set bk_stock_settings; v_reserved int; v_sold int; v_last record; v_eff int; v_drift int := 0; v_total int;
begin
  v_cur := bk_doc_gate(p_profile_id, p_actor_user_id);
  select id, name, inventory_count, available, product_type into v_prod from products where id = p_product_id and profile_id = p_profile_id;
  if not found then
    if not exists (select 1 from bk_stock_movements where product_id = p_product_id and profile_id = p_profile_id) then raise exception 'product_not_found'; end if;
  end if;
  select * into v_set from bk_stock_settings where product_id = p_product_id and profile_id = p_profile_id;
  select coalesce(sum(i.quantity), 0)::int into v_reserved from product_order_items i join product_orders o on o.id = i.order_id
   where i.product_id = p_product_id and o.profile_id = p_profile_id and o.status = 'awaiting_payment' and o.stock_released_at is null;
  select coalesce(sum(i.quantity), 0)::int into v_sold from product_order_items i join product_orders o on o.id = i.order_id
   where i.product_id = p_product_id and o.profile_id = p_profile_id and o.status in ('paid', 'fulfilled') and v_set.product_id is not null and v_set.active and o.created_at >= v_set.tracking_started_at;
  if v_set.product_id is not null and v_set.active then
    select balance_after, created_at into v_last from bk_stock_movements where profile_id = p_profile_id and product_id = p_product_id order by created_at desc, id desc limit 1;
    if v_last.balance_after is not null then
      select coalesce(sum(case when o.created_at > v_last.created_at then -i.quantity else 0 end), 0) + coalesce(sum(case when o.stock_released_at > v_last.created_at then i.quantity else 0 end), 0)
        into v_eff from product_order_items i join product_orders o on o.id = i.order_id where i.product_id = p_product_id and o.profile_id = p_profile_id;
      v_drift := coalesce(v_prod.inventory_count, 0) - (v_last.balance_after + coalesce(v_eff, 0));
    end if;
  end if;
  select count(*)::int into v_total from bk_stock_movements where profile_id = p_profile_id and product_id = p_product_id;
  return jsonb_build_object(
    'profile_currency', v_cur,
    'product', case when v_prod.id is null then null else jsonb_build_object('id', v_prod.id, 'name', v_prod.name, 'available', v_prod.available is not false, 'product_type', v_prod.product_type, 'count', v_prod.inventory_count) end,
    'tracked', coalesce(v_set.active, false),
    'legacy_count', (coalesce(v_set.active, false) = false and v_prod.inventory_count is not null),
    'settings', case when v_set.product_id is null then null else jsonb_build_object('active', v_set.active, 'low_stock_threshold', v_set.low_stock_threshold, 'sku', v_set.sku,
                    'unit_cost', v_set.unit_cost::text, 'cost_currency', v_set.cost_currency, 'tracking_started_at', v_set.tracking_started_at, 'stopped_at', v_set.stopped_at) end,
    'reserved', v_reserved, 'sold_units', v_sold, 'drift', v_drift,
    'estimated_value', case when v_set.active and v_set.unit_cost is not null and v_set.cost_currency = v_cur and v_prod.inventory_count is not null then (v_prod.inventory_count::numeric * v_set.unit_cost)::text else null end,
    'movement_total', v_total,
    'movements', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'qty_delta', m.qty_delta, 'balance_before', m.balance_before, 'balance_after', m.balance_after,
                    'reason', m.reason, 'note', m.note, 'unit_cost', m.unit_cost::text, 'source_type', m.source_type, 'source_id', m.source_id, 'created_at', m.created_at) order by m.created_at desc, m.id desc)
                 from (select * from bk_stock_movements where profile_id = p_profile_id and product_id = p_product_id order by created_at desc, id desc limit v_limit offset v_offset) m), '[]'::jsonb),
    'order_events', coalesce((select jsonb_agg(jsonb_build_object('order_number', x.order_number, 'status', x.status, 'quantity', x.quantity, 'reserved_at', x.created_at,
                    'released_at', x.stock_released_at, 'paid_at', x.paid_at, 'holding', (x.status = 'awaiting_payment' and x.stock_released_at is null)) order by x.created_at desc)
                 from (select o.order_number, o.status, i.quantity, o.created_at, o.stock_released_at, o.paid_at from product_order_items i join product_orders o on o.id = i.order_id
                        where i.product_id = p_product_id and o.profile_id = p_profile_id order by o.created_at desc limit 50) x), '[]'::jsonb));
end $$;

create or replace function inv_refunded_orders(p_profile_id uuid, p_actor_user_id uuid, p_product_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform bk_doc_gate(p_profile_id, p_actor_user_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object('order_id', x.id, 'order_number', x.order_number, 'ordered', x.ordered, 'restocked', x.restocked, 'returnable', greatest(x.ordered - x.restocked, 0), 'created_at', x.created_at)
                     order by x.created_at desc)
      from (select o.id, o.order_number, o.created_at, sum(i.quantity)::int as ordered,
                   coalesce((select sum(m.qty_delta) from bk_stock_movements m where m.profile_id = p_profile_id and m.product_id = p_product_id and m.kind = 'return_restock' and m.source_id = o.id), 0)::int as restocked
              from product_orders o join product_order_items i on i.order_id = o.id and i.product_id = p_product_id
             where o.profile_id = p_profile_id and o.status = 'refunded' group by o.id, o.order_number, o.created_at order by o.created_at desc limit 50) x), '[]'::jsonb);
end $$;

-- ============================================================================
-- 6. EXECUTE PRIVILEGES (explicit)
-- ============================================================================
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in (
              'bk_stock_clean_text', 'bk_stock_settings_guard', 'bk_stock_movements_guard', 'bk_products_stock_guard',
              'inv_start_tracking', 'inv_adjust_stock', 'inv_set_stock_count', 'inv_return_restock', 'inv_stop_tracking', 'inv_update_settings',
              'inv_overview', 'inv_product_detail', 'inv_refunded_orders')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in (
              'inv_start_tracking', 'inv_adjust_stock', 'inv_set_stock_count', 'inv_return_restock', 'inv_stop_tracking', 'inv_update_settings',
              'inv_overview', 'inv_product_detail', 'inv_refunded_orders')
  loop
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- ============================================================================
-- 7. ROW LEVEL SECURITY AND TABLE PRIVILEGES
-- ============================================================================
alter table bk_stock_settings enable row level security;
alter table bk_stock_movements enable row level security;
revoke all on bk_stock_settings, bk_stock_movements from anon, authenticated, service_role;
grant select on bk_stock_settings, bk_stock_movements to authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'bk_stock_settings' and policyname = 'bk_stock_settings owner read') then
    create policy "bk_stock_settings owner read" on bk_stock_settings for select to authenticated
      using (exists (select 1 from profiles p where p.id = profile_id and p.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'bk_stock_movements' and policyname = 'bk_stock_movements owner read') then
    create policy "bk_stock_movements owner read" on bk_stock_movements for select to authenticated
      using (exists (select 1 from profiles p where p.id = profile_id and p.user_id = auth.uid()));
  end if;
end $$;

commit;

-- ============================================================================
-- ROLLBACK (documented only; NOT part of the migration). Name-exact, no CASCADE. Order matters: the products trigger and its function go
-- FIRST (so products is exactly as before), then the functions, then the tables. Dropping the tables deletes the stock ledger and the
-- tracking settings (export first); it does NOT change any product's inventory_count (the live count simply stays as it is).
-- ============================================================================
--   begin;
--   drop trigger if exists bk_products_stock_guard_trg on products;
--   drop function if exists bk_products_stock_guard();
--   drop function if exists inv_refunded_orders(uuid, uuid, uuid);
--   drop function if exists inv_product_detail(uuid, uuid, uuid, int, int);
--   drop function if exists inv_overview(uuid, uuid, text, int, int);
--   drop function if exists inv_update_settings(uuid, uuid, uuid, int, text, numeric);
--   drop function if exists inv_stop_tracking(uuid, uuid, uuid, text, uuid);
--   drop function if exists inv_return_restock(uuid, uuid, uuid, uuid, int, text, uuid);
--   drop function if exists inv_set_stock_count(uuid, uuid, uuid, int, text, text, uuid);
--   drop function if exists inv_adjust_stock(uuid, uuid, uuid, text, int, text, text, text, uuid, numeric, uuid);
--   drop function if exists inv_start_tracking(uuid, uuid, uuid, int, int, uuid);
--   drop table if exists bk_stock_movements;
--   drop table if exists bk_stock_settings;
--   drop function if exists bk_stock_movements_guard();
--   drop function if exists bk_stock_settings_guard();
--   drop function if exists bk_stock_clean_text(text, int, text);
--   commit;
