-- PREFLIGHT for 2026-12-04_inventory_stock_control.sql — READ-ONLY (only SELECTs). Safe to run in the Supabase SQL editor at any time.
-- Every row must say ok = true; any ok = false means STOP and report it before applying the migration.

with checks(label, expect, actual) as (
  -- 1. Phases 1-3 and the Shop checkout are in place (the migration reads them and aborts without them)
  select 'Phase 2 gate bk_doc_gate(uuid,uuid) exists', 'true', (to_regprocedure('public.bk_doc_gate(uuid,uuid)') is not null)::text
  union all select 'bk_truncate_guard() exists', 'true', (to_regprocedure('public.bk_truncate_guard()') is not null)::text
  union all select 'bk_currency_digits(text) exists', 'true', (to_regprocedure('public.bk_currency_digits(text)') is not null)::text
  union all select 'bk_documents exists (invoice source check)', 'true', (to_regclass('public.bk_documents') is not null)::text
  union all select 'Phase 3 tables exist (5)', '5', (select count(*)::text from pg_tables where schemaname = 'public' and tablename in ('bk_customers','bk_document_customer_links','bk_customer_events','bk_reminder_settings','bk_reminders'))
  union all select 'Shop tables exist (product_orders, product_order_items)', '2', (select count(*)::text from pg_tables where schemaname = 'public' and tablename in ('product_orders','product_order_items'))
  union all select 'checkout functions exist (create_product_order, release_product_order_stock)', '2', (select count(distinct p.proname)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('create_product_order','release_product_order_stock'))
  -- 2. columns the new SQL reads or writes
  union all select 'products(id,profile_id,name,inventory_count,product_type)', '5', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name in ('id','profile_id','name','inventory_count','product_type'))
  union all select 'products.inventory_count is integer', 'true', (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'inventory_count' and data_type = 'integer'))::text
  union all select 'product_orders(id,profile_id,status,stock_released_at,created_at,order_number)', '6', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'product_orders' and column_name in ('id','profile_id','status','stock_released_at','created_at','order_number'))
  union all select 'profiles(id,user_id,is_demo,category,categories,currency)', '6', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name in ('id','user_id','is_demo','category','categories','currency'))
  -- 3. nothing this migration creates exists yet
  union all select 'no Phase 4 table exists', '0', (select count(*)::text from pg_tables where schemaname = 'public' and tablename in ('bk_stock_settings','bk_stock_movements'))
  union all select 'no Phase 4 function exists', '0', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (
         'bk_stock_clean_text','bk_stock_settings_guard','bk_stock_movements_guard','bk_products_stock_guard','inv_start_tracking','inv_adjust_stock','inv_set_stock_count','inv_return_restock','inv_stop_tracking','inv_update_settings','inv_overview','inv_product_detail','inv_refunded_orders'))
  union all select 'products has no trigger named bk_products_stock_guard_trg yet', '0', (select count(*)::text from pg_trigger where tgname = 'bk_products_stock_guard_trg' and not tgisinternal)
  -- 4. the data the new guard and the adoption flow will meet
  union all select 'no existing negative inventory_count', '0', (select count(*)::text from products where inventory_count < 0)
  union all select 'roles anon,authenticated,service_role', '3', (select count(*)::text from pg_roles where rolname in ('anon','authenticated','service_role'))
)
select label, expect, actual, (expect = actual) as ok from checks;

-- Informational (not pass/fail): how many existing products already carry a count and will show up as "legacy counts" awaiting adoption.
select count(*) filter (where inventory_count is not null) as products_with_a_count, count(*) as products_total from products;
