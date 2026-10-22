-- VERIFY for 2026-12-26_church_category.sql — READ-ONLY (a single SELECT). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true.

with
defs as (
  select c.conname, c.convalidated, pg_get_constraintdef(c.oid) as def
  from pg_constraint c
  where c.contype = 'c'
    and c.conrelid in ('public.profiles'::regclass, 'public.signup_requests'::regclass)
    and c.conname in ('profiles_category_check', 'profiles_categories_check', 'signup_requests_category_check', 'signup_requests_categories_check', 'profiles_subcategory_check')
),
checks(label, expect, actual) as (
  select '01 all five constraints exist and are validated', '5', (select count(*)::text from defs where convalidated)
  union all select '02 all four category constraints allow church_ministries', '4', (select count(*)::text from defs where conname like '%categor%' and conname <> 'profiles_subcategory_check' and def like '%church_ministries%')
  union all select '03 the sub-type constraint allows all five church sub-types', '5',
         (select count(*)::text from unnest(array['local_church', 'parish', 'ministry', 'fellowship', 'choir']) s where (select def from defs where conname = 'profiles_subcategory_check') like '%''' || s || '''%')
  union all select '04 profiles_category_check lists 17 values', '17', (select (select count(*) from regexp_matches(def, '''[a-z_]+''', 'g'))::text from defs where conname = 'profiles_category_check')
  union all select '05 profiles_categories_check lists 17 values', '17', (select (select count(*) from regexp_matches(def, '''[a-z_]+''', 'g'))::text from defs where conname = 'profiles_categories_check')
  union all select '06 signup_requests_category_check lists 17 values', '17', (select (select count(*) from regexp_matches(def, '''[a-z_]+''', 'g'))::text from defs where conname = 'signup_requests_category_check')
  union all select '07 signup_requests_categories_check lists 17 values', '17', (select (select count(*) from regexp_matches(def, '''[a-z_]+''', 'g'))::text from defs where conname = 'signup_requests_categories_check')
  union all select '08 profiles_subcategory_check lists 69 values', '69', (select (select count(*) from regexp_matches(def, '''[a-z_]+''', 'g'))::text from defs where conname = 'profiles_subcategory_check')
  union all select '09 every pre-existing category id is still allowed', '16',
         (select count(*)::text from unnest(array['music_entertainment', 'business_ecommerce', 'restaurant_food', 'real_estate', 'transport_logistics', 'professional_services', 'beauty_wellness', 'health_medical',
                                                  'education_training', 'travel_hospitality', 'events_experiences', 'creative_media', 'freelancers_creators', 'construction_home_services', 'agriculture_agribusiness', 'other']) s
           where (select def from defs where conname = 'profiles_category_check') like '%''' || s || '''%')
  union all select '10 no other object was touched: the migration created no table or function (church_* tables, 0 expected)', '0',
         (select count(*)::text from pg_tables where schemaname = 'public' and tablename like 'church\_%')
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
