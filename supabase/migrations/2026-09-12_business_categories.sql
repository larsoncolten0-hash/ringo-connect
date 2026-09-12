-- Business categories (see src/lib/categories.ts for the id list + what each
-- one defaults to — this migration only stores the selection, it doesn't
-- know what a category "means"; that's kept in application code so the two
-- never have to be migrated in lockstep).
--
-- `category` = the single primary category chosen at signup (drives label/
-- default copy). `categories` = every category the creator has attached to
-- their page, including the primary one — shown as-is, no special meaning
-- beyond "this page is also relevant to these". Both are nullable/empty on
-- existing rows; nothing here changes behavior for a profile that hasn't
-- picked one yet.
--
-- Uses ADD COLUMN IF NOT EXISTS throughout: this repo's migration history is
-- incomplete relative to the live schema (several existing tables/columns —
-- signup_requests, addons, profiles.currency, etc. — have no creating
-- migration checked in), so additive/idempotent statements are the safe
-- default here rather than assuming this file is applied against a schema
-- that matches supabase/schema.sql exactly.

alter table profiles add column if not exists category text;
alter table profiles add column if not exists categories text[] not null default '{}';

alter table signup_requests add column if not exists category text;
alter table signup_requests add column if not exists categories text[] not null default '{}';

-- Keep this list in sync with CATEGORY_IDS in src/lib/categories.ts.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_category_check'
  ) then
    alter table profiles add constraint profiles_category_check check (
      category is null or category in (
        'music_entertainment', 'business_ecommerce', 'restaurant_food', 'real_estate',
        'transport_logistics', 'professional_services', 'beauty_wellness', 'health_medical',
        'education_training', 'travel_hospitality', 'events_experiences', 'creative_media',
        'freelancers_creators', 'construction_home_services', 'agriculture_agribusiness', 'other'
      )
    );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_categories_check'
  ) then
    alter table profiles add constraint profiles_categories_check check (
      categories <@ array[
        'music_entertainment', 'business_ecommerce', 'restaurant_food', 'real_estate',
        'transport_logistics', 'professional_services', 'beauty_wellness', 'health_medical',
        'education_training', 'travel_hospitality', 'events_experiences', 'creative_media',
        'freelancers_creators', 'construction_home_services', 'agriculture_agribusiness', 'other'
      ]::text[]
    );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'signup_requests_category_check'
  ) then
    alter table signup_requests add constraint signup_requests_category_check check (
      category is null or category in (
        'music_entertainment', 'business_ecommerce', 'restaurant_food', 'real_estate',
        'transport_logistics', 'professional_services', 'beauty_wellness', 'health_medical',
        'education_training', 'travel_hospitality', 'events_experiences', 'creative_media',
        'freelancers_creators', 'construction_home_services', 'agriculture_agribusiness', 'other'
      )
    );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'signup_requests_categories_check'
  ) then
    alter table signup_requests add constraint signup_requests_categories_check check (
      categories <@ array[
        'music_entertainment', 'business_ecommerce', 'restaurant_food', 'real_estate',
        'transport_logistics', 'professional_services', 'beauty_wellness', 'health_medical',
        'education_training', 'travel_hospitality', 'events_experiences', 'creative_media',
        'freelancers_creators', 'construction_home_services', 'agriculture_agribusiness', 'other'
      ]::text[]
    );
  end if;
end $$;
