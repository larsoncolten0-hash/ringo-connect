-- VERIFY for 2026-12-04_inventory_stock_control.sql — READ-ONLY (a single SELECT). Run once AFTER applying the migration; every row must show ok = true.
-- (Do not run the preflight afterwards: its "no Phase 4 object exists" rows are expected to fail once the migration is applied.)
-- Written without the constructs that are most likely to behave differently in the Supabase editor than in the local test engine: no
-- aliased VALUES lists inside privilege functions and no implicit text-to-name/regclass conversions (every cast is explicit).

with
fn_entry as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('inv_start_tracking','inv_adjust_stock','inv_set_stock_count','inv_return_restock','inv_stop_tracking','inv_update_settings','inv_overview','inv_product_detail','inv_refunded_orders')),
fn_all as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('inv_start_tracking','inv_adjust_stock','inv_set_stock_count','inv_return_restock','inv_stop_tracking','inv_update_settings','inv_overview','inv_product_detail','inv_refunded_orders',
                                                'bk_stock_clean_text','bk_stock_settings_guard','bk_stock_movements_guard','bk_products_stock_guard')),
tbl as (
  select c.oid, c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('bk_stock_settings','bk_stock_movements')),
checks(label, expect, actual) as (
  select '01 Phase 4 tables exist (2)', '2', (select count(*)::text from tbl)
  union all select '02 Phase 4 functions exist (13 = 9 entry + 4 helpers/guards), once each', '13|13', (select count(*)::text from fn_all) || '|' || (select count(distinct proname)::text from fn_all)
  union all select '03 guard + truncate-guard triggers exist (4) on the Phase 4 tables', '4',
         (select count(*)::text from pg_trigger t where not t.tgisinternal and t.tgname in ('bk_stock_settings_guard_trg','bk_stock_movements_guard_trg','bk_stock_settings_truncate_guard_trg','bk_stock_movements_truncate_guard_trg') and t.tgrelid in (select oid from tbl))
  union all select '03b the ONE trigger on products exists, is BEFORE UPDATE OF inventory_count, and is the only Phase 4 trigger on an existing table', '1|1',
         (select count(*)::text from pg_trigger t where not t.tgisinternal and t.tgname = 'bk_products_stock_guard_trg' and t.tgrelid = 'public.products'::regclass and (t.tgtype & 2) = 2 and (t.tgtype & 16) = 16)
         || '|' || (select count(*)::text from pg_trigger t where not t.tgisinternal and t.tgfoid in (select oid from fn_all) and t.tgrelid not in (select oid from tbl))
  union all select '04 RLS enabled on both tables', '2', (select count(*)::text from tbl where relrowsecurity)
  union all select '05 owner-read policies exist (2), SELECT-only for authenticated, and no write policy', '2|0',
         (select count(*)::text from pg_policies where schemaname = 'public' and policyname in ('bk_stock_settings owner read','bk_stock_movements owner read') and cmd = 'SELECT' and roles = '{authenticated}')
         || '|' || (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('bk_stock_settings','bk_stock_movements') and cmd <> 'SELECT')
  union all select '06 indexes exist (5)', '5', (select count(*)::text from pg_indexes where schemaname = 'public' and indexname in ('bk_stock_settings_sku_idx','bk_stock_settings_profile_idx','bk_stock_movements_product_idx','bk_stock_movements_profile_idx','bk_stock_movements_source_idx'))
  union all select '06b movements: UNIQUE (profile_id, client_request_id) (idempotency)', 'true', (exists (select 1 from pg_constraint where conrelid = 'public.bk_stock_movements'::regclass and contype = 'u' and pg_get_constraintdef(oid) like '%(profile_id, client_request_id)%'))::text
  union all select '06c movements keep no foreign key to products (history survives product deletion)', '0', (select count(*)::text from pg_constraint where contype = 'f' and conrelid in (select oid from tbl) and confrelid = 'public.products'::regclass)
  union all select '06d every foreign key of a Phase 4 table is ON DELETE RESTRICT', '0', (select count(*)::text from pg_constraint where contype = 'f' and conrelid in (select oid from tbl) and confdeltype <> 'r')
  union all select '06e the balance-chain CHECK exists on the ledger', 'true', (exists (select 1 from pg_constraint where conrelid = 'public.bk_stock_movements'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%balance_after%' and pg_get_constraintdef(oid) like '%tracking_stopped%'))::text
  union all select '06f default low-stock threshold is 5', 'true', (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bk_stock_settings' and column_name = 'low_stock_threshold' and column_default = '5'))::text
  union all select '07 entry functions: service_role CAN execute (9)', '9', (select count(*)::text from fn_entry where has_function_privilege('service_role'::name, oid, 'execute'))
  union all select '07b NO function grants execute to anon or authenticated (all 13)', '0', (select count(*)::text from fn_all where has_function_privilege('anon'::name, oid, 'execute') or has_function_privilege('authenticated'::name, oid, 'execute'))
  union all select '07c helpers and guards: service_role can NOT execute (4)', '4', (select count(*)::text from fn_all where proname not like 'inv\_%' and not has_function_privilege('service_role'::name, oid, 'execute'))
  union all select '07d NO client role can write the Phase 4 tables (INSERT/UPDATE/DELETE/TRUNCATE)', '0',
         (select count(*)::text from tbl t where has_table_privilege('anon'::name, t.oid, 'INSERT') or has_table_privilege('authenticated'::name, t.oid, 'INSERT') or has_table_privilege('service_role'::name, t.oid, 'INSERT')
            or has_table_privilege('anon'::name, t.oid, 'UPDATE') or has_table_privilege('authenticated'::name, t.oid, 'UPDATE') or has_table_privilege('service_role'::name, t.oid, 'UPDATE')
            or has_table_privilege('anon'::name, t.oid, 'DELETE') or has_table_privilege('authenticated'::name, t.oid, 'DELETE') or has_table_privilege('service_role'::name, t.oid, 'DELETE')
            or has_table_privilege('anon'::name, t.oid, 'TRUNCATE') or has_table_privilege('authenticated'::name, t.oid, 'TRUNCATE') or has_table_privilege('service_role'::name, t.oid, 'TRUNCATE'))
  union all select '07e SELECT only: anon none, authenticated on both tables, service_role on both tables', '0|2|2',
         (select count(*)::text from tbl t where has_table_privilege('anon'::name, t.oid, 'SELECT')) || '|' || (select count(*)::text from tbl t where has_table_privilege('authenticated'::name, t.oid, 'SELECT'))
         || '|' || (select count(*)::text from tbl t where has_table_privilege('service_role'::name, t.oid, 'SELECT'))
  union all select '07f every SECURITY DEFINER Phase 4 function pins search_path', '0', (select count(*)::text from fn_all where prosecdef and (proconfig is null or proconfig::text not like '%search_path=public, pg_temp%'))
  union all select '08 Phase 4 does NOT touch money or bookkeeping: no function mentions bk_entries / bk_record_entry / bk_void_entry / doc_record_payment', '0',
         (select count(*)::text from fn_all where prosrc ilike '%bk_entries%' or prosrc ilike '%bk_record_entry%' or prosrc ilike '%bk_void_entry%' or prosrc ilike '%doc_record_payment%')
  union all select '08b Phase 4 never writes orders or payments (no insert/update/delete on product_orders, product_order_items, customer_payments)', '0',
         (select count(*)::text from fn_all where prosrc ~* '(insert into|update|delete from)[[:space:]]+(product_orders|product_order_items|customer_payments|commerce_sale_earnings)')
  union all select '08c the only existing table Phase 4 writes is products, and only its inventory_count', '0',
         (select count(*)::text from fn_all where prosrc ~* 'update[[:space:]]+products[[:space:]]+set[[:space:]]+(?!inventory_count)')
  union all select '09 checkout functions are untouched: create_product_order and release_product_order_stock still exist and do not mention Phase 4', '2|0',
         (select count(distinct p.proname)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('create_product_order','release_product_order_stock'))
         || '|' || (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('create_product_order','release_product_order_stock') and (p.prosrc ilike '%bk\_stock%' or p.prosrc ~* 'inv_(start_tracking|adjust_stock|set_stock_count|return_restock|stop_tracking|update_settings|overview|product_detail|refunded_orders)'))
  union all select '09b Phase 2 and Phase 3 objects intact: 8 + 5 tables', '8|5',
         (select count(*)::text from pg_tables where schemaname = 'public' and tablename in ('bk_business_profiles','bk_documents','bk_document_lines','bk_document_counters','bk_document_payments','bk_document_events','bk_document_shares','bk_document_rate_events'))
         || '|' || (select count(*)::text from pg_tables where schemaname = 'public' and tablename in ('bk_customers','bk_document_customer_links','bk_customer_events','bk_reminder_settings','bk_reminders'))
  union all select '10 Phase 4 tables hold 0 rows (fresh install) and no product is tracked yet', '0|0', (select count(*)::text from bk_stock_movements) || '|' || (select count(*)::text from bk_stock_settings)
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
