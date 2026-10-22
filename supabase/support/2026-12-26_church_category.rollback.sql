-- ROLLBACK for 2026-12-26_church_category.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Puts the five constraints back to their pre-church lists (16 category values, 64 sub-type values). It REFUSES to run while any profile or signup request still uses a church
-- value, because re-adding the narrower constraint would fail on those rows (and silently rewriting a customer's category is not this file's call). Move or clear those rows first.
-- Touches no row. Safe to re-run: it aborts before changing anything if the church values are not allowed any more.
begin;

set local lock_timeout = '5s';

do $$
declare
  v_profiles bigint;
  v_requests bigint;
begin
  select count(*) into v_profiles from public.profiles
    where category = 'church_ministries' or 'church_ministries' = any(categories) or subcategory in ('local_church', 'parish', 'ministry', 'fellowship', 'choir');
  select count(*) into v_requests from public.signup_requests
    where category = 'church_ministries' or 'church_ministries' = any(categories);
  if v_profiles > 0 or v_requests > 0 then
    raise exception 'rollback refused: % profile(s) and % signup request(s) still use a church value; change them first', v_profiles, v_requests;
  end if;
end $$;

alter table public.profiles drop constraint if exists profiles_category_check;
alter table public.profiles add constraint profiles_category_check check (
  category is null or category in (
    'music_entertainment', 'business_ecommerce', 'restaurant_food', 'real_estate',
    'transport_logistics', 'professional_services', 'beauty_wellness', 'health_medical',
    'education_training', 'travel_hospitality', 'events_experiences', 'creative_media',
    'freelancers_creators', 'construction_home_services', 'agriculture_agribusiness', 'other'
  )
);

alter table public.profiles drop constraint if exists profiles_categories_check;
alter table public.profiles add constraint profiles_categories_check check (
  categories <@ array[
    'music_entertainment', 'business_ecommerce', 'restaurant_food', 'real_estate',
    'transport_logistics', 'professional_services', 'beauty_wellness', 'health_medical',
    'education_training', 'travel_hospitality', 'events_experiences', 'creative_media',
    'freelancers_creators', 'construction_home_services', 'agriculture_agribusiness', 'other'
  ]::text[]
);

alter table public.signup_requests drop constraint if exists signup_requests_category_check;
alter table public.signup_requests add constraint signup_requests_category_check check (
  category is null or category in (
    'music_entertainment', 'business_ecommerce', 'restaurant_food', 'real_estate',
    'transport_logistics', 'professional_services', 'beauty_wellness', 'health_medical',
    'education_training', 'travel_hospitality', 'events_experiences', 'creative_media',
    'freelancers_creators', 'construction_home_services', 'agriculture_agribusiness', 'other'
  )
);

alter table public.signup_requests drop constraint if exists signup_requests_categories_check;
alter table public.signup_requests add constraint signup_requests_categories_check check (
  categories <@ array[
    'music_entertainment', 'business_ecommerce', 'restaurant_food', 'real_estate',
    'transport_logistics', 'professional_services', 'beauty_wellness', 'health_medical',
    'education_training', 'travel_hospitality', 'events_experiences', 'creative_media',
    'freelancers_creators', 'construction_home_services', 'agriculture_agribusiness', 'other'
  ]::text[]
);

alter table public.profiles drop constraint if exists profiles_subcategory_check;
alter table public.profiles add constraint profiles_subcategory_check check (
  subcategory is null or subcategory in (
    'retailer', 'wholesaler', 'fashion_apparel', 'electronics', 'cosmetics_beauty', 'grocery',
    'agency', 'individual_owner', 'agent', 'developer', 'property_manager',
    'bus_agency', 'taxi_ride', 'delivery_courier', 'freight_cargo', 'movers', 'car_rental',
    'consultant', 'lawyer', 'accountant', 'it_services',
    'hair_salon', 'barber', 'nail_tech', 'makeup_artist', 'spa',
    'clinic', 'pharmacy', 'dental', 'laboratory',
    'school', 'tutor', 'training_center', 'coach', 'online_courses',
    'hotel', 'guest_house', 'travel_agency', 'tour_operator',
    'event_organizer', 'concerts_shows', 'conferences', 'weddings', 'festivals',
    'photographer', 'videographer', 'graphic_designer', 'studio',
    'youtuber', 'influencer', 'blogger', 'streamer', 'freelancer',
    'contractor', 'architect', 'plumber', 'electrician', 'painter',
    'farmer', 'cooperative', 'agro_dealer', 'livestock', 'food_producer',
    'other'
  )
);

commit;
