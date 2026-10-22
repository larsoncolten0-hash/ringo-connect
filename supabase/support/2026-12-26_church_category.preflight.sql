-- PREFLIGHT for 2026-12-26_church_category.sql — READ-ONLY (a single SELECT). FOR OWNER REVIEW; run BEFORE applying the migration.
-- Every row must show ok = true. It proves the five constraints exist with the reviewed number of values and do not yet allow the church values.
-- Also run the second SELECT at the bottom and read the live definitions: they must list only ids that exist in src/lib/categories.ts.

with
defs as (
  select c.conname, pg_get_constraintdef(c.oid) as def
  from pg_constraint c
  where c.contype = 'c'
    and c.conrelid in ('public.profiles'::regclass, 'public.signup_requests'::regclass)
    and c.conname in ('profiles_category_check', 'profiles_categories_check', 'signup_requests_category_check', 'signup_requests_categories_check', 'profiles_subcategory_check')
),
checks(label, expect, actual) as (
  select '01 all five constraints exist', '5', (select count(*)::text from defs)
  union all select '02 none of them allows the church values yet (0 expected)', '0', (select count(*)::text from defs where def like '%church_ministries%' or def like '%local_church%')
  union all select '03 profiles_category_check lists 16 values', '16', (select (select count(*) from regexp_matches(def, '''[a-z_]+''', 'g'))::text from defs where conname = 'profiles_category_check')
  union all select '04 profiles_categories_check lists 16 values', '16', (select (select count(*) from regexp_matches(def, '''[a-z_]+''', 'g'))::text from defs where conname = 'profiles_categories_check')
  union all select '05 signup_requests_category_check lists 16 values', '16', (select (select count(*) from regexp_matches(def, '''[a-z_]+''', 'g'))::text from defs where conname = 'signup_requests_category_check')
  union all select '06 signup_requests_categories_check lists 16 values', '16', (select (select count(*) from regexp_matches(def, '''[a-z_]+''', 'g'))::text from defs where conname = 'signup_requests_categories_check')
  union all select '07 profiles_subcategory_check lists 64 values', '64', (select (select count(*) from regexp_matches(def, '''[a-z_]+''', 'g'))::text from defs where conname = 'profiles_subcategory_check')
  union all select '08 no profile or signup request already carries a church value (0 expected)', '0',
         ((select count(*) from public.profiles where category = 'church_ministries' or 'church_ministries' = any(categories) or subcategory in ('local_church', 'parish', 'ministry', 'fellowship', 'choir'))
        + (select count(*) from public.signup_requests where category = 'church_ministries' or 'church_ministries' = any(categories)))::text
)
select label, expect, actual, (expect = actual) as ok from checks order by label;

-- For reading: the live definitions as they are today.
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conname in ('profiles_category_check', 'profiles_categories_check', 'signup_requests_category_check', 'signup_requests_categories_check', 'profiles_subcategory_check');
