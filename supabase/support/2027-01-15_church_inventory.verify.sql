-- VERIFY for 2027-01-15_church_inventory.sql — READ-ONLY (a single SELECT, no write). Run once AFTER the migration is applied. Every row must show ok = true.

with
checks(label, expect, actual) as (
  select '01 inv_start_tracking accepts church_ministries', 'true',
         (select (pg_get_functiondef('public.inv_start_tracking(uuid,uuid,uuid,integer,integer,uuid)'::regprocedure) like '%church_ministries%')::text)
  union all select '02 it still accepts business_ecommerce', 'true',
         (select (pg_get_functiondef('public.inv_start_tracking(uuid,uuid,uuid,integer,integer,uuid)'::regprocedure) like '%business_ecommerce%')::text)
  union all select '03 it still raises category_not_enabled for other categories', 'true',
         (select (pg_get_functiondef('public.inv_start_tracking(uuid,uuid,uuid,integer,integer,uuid)'::regprocedure) like '%category_not_enabled%')::text)
  union all select '04 it is callable by no API role (0 expected)', '0',
         (select count(*)::text from unnest(array['anon', 'authenticated', 'public']) r where has_function_privilege(r, 'public.inv_start_tracking(uuid,uuid,uuid,integer,integer,uuid)', 'execute'))
  union all select '05 it is still security definer with a fixed search_path', 'true',
         (select (p.prosecdef and p.proconfig is not null)::text from pg_proc p where p.oid = 'public.inv_start_tracking(uuid,uuid,uuid,integer,integer,uuid)'::regprocedure)
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
