-- Churches & Ministries category (Phase 0) — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Teaches the database the new category id `church_ministries` and its five church sub-types. Nothing else: no table, column, function, policy, trigger, privilege or row is
-- created, changed or removed, and no existing category or sub-type value is touched. Every row that is valid today stays valid (each new allow-list is the old one plus the new ids).
--
-- Why this file DROPS and re-adds constraints: 2026-09-12_business_categories.sql and 2026-09-27_category_subcategories.sql create their constraints only "if not exists", so editing
-- those files (or re-running them) would change nothing on a database that already has them. The only way to widen an existing CHECK is to replace it.
--
--   CHANGED  public.profiles         profiles_category_check                category in (16 values)          -> 17 values (+ church_ministries)
--   CHANGED  public.profiles         profiles_categories_check              categories <@ array (16 values)  -> 17 values
--   CHANGED  public.signup_requests  signup_requests_category_check         category in (16 values)          -> 17 values
--   CHANGED  public.signup_requests  signup_requests_categories_check       categories <@ array (16 values)  -> 17 values
--   CHANGED  public.profiles         profiles_subcategory_check             64 values                        -> 69 values (+ local_church, parish, ministry, fellowship, choir)
--
-- Keep these lists in sync with CATEGORY_IDS and the church_ministries subcategories in src/lib/categories.ts.
--
-- SELF-VERIFYING, one transaction: preconditions run first and abort the whole file if anything is not as reviewed (a missing table or column, a constraint that is missing, already
-- widened, or whose value list has drifted from the reviewed one, or a lock that cannot be taken quickly). Postconditions run last and abort if any of the five constraints does not
-- accept the new ids while still holding every old one. Any RAISE rolls everything back.
--
-- Depends on: 2026-09-12_business_categories.sql, 2026-09-27_category_subcategories.sql.
-- Preflight (read-only, run BEFORE): supabase/support/2026-12-26_church_category.preflight.sql
-- Verify    (read-only, run AFTER):  supabase/support/2026-12-26_church_category.verify.sql
-- Rollback: supabase/support/2026-12-26_church_category.rollback.sql (refuses to run while any row uses a church value).

begin;

set local lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 0. PRECONDITIONS
-- ----------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_n int;
  r record;
begin
  -- 0a. The two tables and the five columns exist.
  if to_regclass('public.profiles') is null or to_regclass('public.signup_requests') is null then
    raise exception 'church category precondition failed: public.profiles or public.signup_requests is missing';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public'
        and ((table_name = 'profiles' and column_name in ('category', 'categories', 'subcategory'))
          or (table_name = 'signup_requests' and column_name in ('category', 'categories')))) <> 5 then
    raise exception 'church category precondition failed: expected profiles.category/categories/subcategory and signup_requests.category/categories';
  end if;

  -- 0b. Each constraint exists, does not already allow the church values, and lists exactly the reviewed number of values
  --     (a drifted live list would otherwise be silently overwritten).
  for r in select * from (values
      ('profiles', 'profiles_category_check', 16),
      ('profiles', 'profiles_categories_check', 16),
      ('signup_requests', 'signup_requests_category_check', 16),
      ('signup_requests', 'signup_requests_categories_check', 16),
      ('profiles', 'profiles_subcategory_check', 64)
    ) as t(tbl, conname, expected_values)
  loop
    select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
      where c.conrelid = ('public.' || r.tbl)::regclass and c.conname = r.conname and c.contype = 'c';
    if v_def is null then
      raise exception 'church category precondition failed: constraint %.% not found', r.tbl, r.conname;
    end if;
    if v_def like '%church_ministries%' or v_def like '%local_church%' then
      raise exception 'church category precondition failed: % already allows the church values (already applied?)', r.conname;
    end if;
    select count(*) into v_n from regexp_matches(v_def, '''[a-z_]+''', 'g');
    if v_n <> r.expected_values then
      raise exception 'church category precondition failed: % lists % values, the reviewed list has % (the live constraint has drifted; review before applying)', r.conname, v_n, r.expected_values;
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 1. REPLACE the five constraints with the widened lists (every old value + the new ones)
-- ----------------------------------------------------------------------------
alter table public.profiles drop constraint profiles_category_check;
alter table public.profiles add constraint profiles_category_check check (
  category is null or category in (
    'music_entertainment', 'business_ecommerce', 'restaurant_food', 'real_estate',
    'transport_logistics', 'professional_services', 'beauty_wellness', 'health_medical',
    'education_training', 'travel_hospitality', 'events_experiences', 'creative_media',
    'freelancers_creators', 'construction_home_services', 'agriculture_agribusiness',
    'church_ministries', 'other'
  )
);

alter table public.profiles drop constraint profiles_categories_check;
alter table public.profiles add constraint profiles_categories_check check (
  categories <@ array[
    'music_entertainment', 'business_ecommerce', 'restaurant_food', 'real_estate',
    'transport_logistics', 'professional_services', 'beauty_wellness', 'health_medical',
    'education_training', 'travel_hospitality', 'events_experiences', 'creative_media',
    'freelancers_creators', 'construction_home_services', 'agriculture_agribusiness',
    'church_ministries', 'other'
  ]::text[]
);

alter table public.signup_requests drop constraint signup_requests_category_check;
alter table public.signup_requests add constraint signup_requests_category_check check (
  category is null or category in (
    'music_entertainment', 'business_ecommerce', 'restaurant_food', 'real_estate',
    'transport_logistics', 'professional_services', 'beauty_wellness', 'health_medical',
    'education_training', 'travel_hospitality', 'events_experiences', 'creative_media',
    'freelancers_creators', 'construction_home_services', 'agriculture_agribusiness',
    'church_ministries', 'other'
  )
);

alter table public.signup_requests drop constraint signup_requests_categories_check;
alter table public.signup_requests add constraint signup_requests_categories_check check (
  categories <@ array[
    'music_entertainment', 'business_ecommerce', 'restaurant_food', 'real_estate',
    'transport_logistics', 'professional_services', 'beauty_wellness', 'health_medical',
    'education_training', 'travel_hospitality', 'events_experiences', 'creative_media',
    'freelancers_creators', 'construction_home_services', 'agriculture_agribusiness',
    'church_ministries', 'other'
  ]::text[]
);

alter table public.profiles drop constraint profiles_subcategory_check;
alter table public.profiles add constraint profiles_subcategory_check check (
  subcategory is null or subcategory in (
    -- business_ecommerce
    'retailer', 'wholesaler', 'fashion_apparel', 'electronics', 'cosmetics_beauty', 'grocery',
    -- real_estate
    'agency', 'individual_owner', 'agent', 'developer', 'property_manager',
    -- transport_logistics
    'bus_agency', 'taxi_ride', 'delivery_courier', 'freight_cargo', 'movers', 'car_rental',
    -- professional_services (note: 'agency' shared with real_estate above, listed once)
    'consultant', 'lawyer', 'accountant', 'it_services',
    -- beauty_wellness
    'hair_salon', 'barber', 'nail_tech', 'makeup_artist', 'spa',
    -- health_medical
    'clinic', 'pharmacy', 'dental', 'laboratory',
    -- education_training
    'school', 'tutor', 'training_center', 'coach', 'online_courses',
    -- travel_hospitality
    'hotel', 'guest_house', 'travel_agency', 'tour_operator',
    -- events_experiences
    'event_organizer', 'concerts_shows', 'conferences', 'weddings', 'festivals',
    -- creative_media
    'photographer', 'videographer', 'graphic_designer', 'studio',
    -- freelancers_creators
    'youtuber', 'influencer', 'blogger', 'streamer', 'freelancer',
    -- construction_home_services
    'contractor', 'architect', 'plumber', 'electrician', 'painter',
    -- agriculture_agribusiness
    'farmer', 'cooperative', 'agro_dealer', 'livestock', 'food_producer',
    -- church_ministries (new)
    'local_church', 'parish', 'ministry', 'fellowship', 'choir',
    -- shared catch-all, every category above ends its own subcategories list with this same id
    'other'
  )
);

-- ----------------------------------------------------------------------------
-- 2. POSTCONDITIONS
-- ----------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_n int;
  v_missing text;
  v_old text[];
  -- every value the constraints allowed BEFORE this migration (the reviewed lists): each must still be allowed afterwards
  c_old_categories constant text[] := array[
    'music_entertainment', 'business_ecommerce', 'restaurant_food', 'real_estate',
    'transport_logistics', 'professional_services', 'beauty_wellness', 'health_medical',
    'education_training', 'travel_hospitality', 'events_experiences', 'creative_media',
    'freelancers_creators', 'construction_home_services', 'agriculture_agribusiness', 'other'
  ];
  c_old_subcategories constant text[] := array[
    'retailer', 'wholesaler', 'fashion_apparel', 'electronics',
    'cosmetics_beauty', 'grocery', 'agency', 'individual_owner',
    'agent', 'developer', 'property_manager', 'bus_agency',
    'taxi_ride', 'delivery_courier', 'freight_cargo', 'movers',
    'car_rental', 'consultant', 'lawyer', 'accountant',
    'it_services', 'hair_salon', 'barber', 'nail_tech',
    'makeup_artist', 'spa', 'clinic', 'pharmacy',
    'dental', 'laboratory', 'school', 'tutor',
    'training_center', 'coach', 'online_courses', 'hotel',
    'guest_house', 'travel_agency', 'tour_operator', 'event_organizer',
    'concerts_shows', 'conferences', 'weddings', 'festivals',
    'photographer', 'videographer', 'graphic_designer', 'studio',
    'youtuber', 'influencer', 'blogger', 'streamer',
    'freelancer', 'contractor', 'architect', 'plumber',
    'electrician', 'painter', 'farmer', 'cooperative',
    'agro_dealer', 'livestock', 'food_producer', 'other'
  ];
  r record;
begin
  -- 'kind' picks the old-value list explicitly by constraint (never by a pattern on the constraint name).
  for r in select * from (values
      ('profiles', 'profiles_category_check', 17, 'church_ministries', 'category'),
      ('profiles', 'profiles_categories_check', 17, 'church_ministries', 'category'),
      ('signup_requests', 'signup_requests_category_check', 17, 'church_ministries', 'category'),
      ('signup_requests', 'signup_requests_categories_check', 17, 'church_ministries', 'category'),
      ('profiles', 'profiles_subcategory_check', 69, 'local_church', 'subcategory')
    ) as t(tbl, conname, expected_values, new_value, kind)
  loop
    select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
      where c.conrelid = ('public.' || r.tbl)::regclass and c.conname = r.conname and c.contype = 'c' and c.convalidated;
    if v_def is null then
      raise exception 'church category postcondition failed: % is missing or not validated', r.conname;
    end if;
    if position('''' || r.new_value || '''' in v_def) = 0 then
      raise exception 'church category postcondition failed: % does not allow %', r.conname, r.new_value;
    end if;
    select count(*) into v_n from regexp_matches(v_def, '''[a-z_]+''', 'g');
    if v_n <> r.expected_values then
      raise exception 'church category postcondition failed: % lists % values, expected %', r.conname, v_n, r.expected_values;
    end if;
    v_old := case when r.kind = 'subcategory' then c_old_subcategories else c_old_categories end;
    select string_agg(o, ', ') into v_missing from unnest(v_old) as o where position('''' || o || '''' in v_def) = 0;
    if v_missing is not null then
      raise exception 'church category postcondition failed: % lost existing value(s): %', r.conname, v_missing;
    end if;
  end loop;
end $$;

commit;
