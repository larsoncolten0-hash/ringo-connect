-- VERIFY for 2026-12-15_customer_location.sql: READ-ONLY (a single SELECT). Run once AFTER applying the migration; every row must show ok = true.

with
col as (select * from information_schema.columns where table_schema = 'public' and table_name = 'bk_customers' and column_name = 'address'),
save_new as (select p.oid, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.oid = to_regprocedure('public.bk_customer_save(uuid, uuid, uuid, text, text, text, text, uuid, text)')),
save_old as (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.oid = to_regprocedure('public.bk_customer_save(uuid, uuid, uuid, text, text, text, text, uuid)')),
sale as (select p.oid, p.prosecdef, p.proconfig, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.oid = to_regprocedure('public.sale_record(uuid, uuid, text, jsonb, uuid, text, date, text, uuid)')),
checks(label, expect, actual) as (
  select '01 bk_customers.address exists, is text and nullable with no default', 'text|YES|', (select data_type || '|' || is_nullable || '|' || coalesce(column_default, '') from col)
  union all select '02 a length CHECK (<= 300) exists on it', 'true', (exists (select 1 from pg_constraint where conrelid = 'public.bk_customers'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%address%300%'))::text
  union all select '03 bk_customer_save: the NEW 9-argument overload exists, is SECURITY DEFINER with a pinned search_path', 'true|true',
         (select (count(*) = 1)::text || '|' || coalesce(bool_and(prosecdef and proconfig::text like '%search_path%')::text, 'false') from save_new)
  union all select '04 bk_customer_save: the ORIGINAL 8-argument function still exists (untouched)', '1', (select count(*)::text from save_old)
  union all select '05 sale_record exists once, SECURITY DEFINER with a pinned search_path, and now reads the customer address', 'true|true',
         (select (count(*) = 1 and bool_and(prosecdef and proconfig::text like '%search_path%'))::text || '|' || coalesce(bool_and(prosrc like '%v_cust.address%')::text, 'false') from sale)
  union all select '06 both functions are executable by service_role only', '2|0',
         (select count(*)::text from (select oid from save_new union all select oid from sale) f where has_function_privilege('service_role'::name, f.oid, 'execute'))
         || '|' || (select count(*)::text from (select oid from save_new union all select oid from sale) f where has_function_privilege('anon'::name, f.oid, 'execute') or has_function_privilege('authenticated'::name, f.oid, 'execute'))
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
