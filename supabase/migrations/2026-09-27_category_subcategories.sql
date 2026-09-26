-- Sub-category picker for every category OTHER than Music & Entertainment and Restaurant & Food
-- (which keep their own separate, unchanged music_role/restaurant_subcategory mechanisms — see
-- profiles_music_role_check in 2026-09-13_music_entertainment.sql and
-- profiles_restaurant_subcategory_check in 2026-09-15_restaurant_food.sql, both untouched here).
--
-- See src/lib/categories.ts's SubcategoryOption/getSubcategoryOption for the app-side definitions —
-- this single shared text column stores whichever category's sub-type a profile picked, the same
-- "one flat column, one flat CHECK allow-list" shape as restaurant_subcategory. A sub-type is only
-- ever meaningful together with the profile's own `category`/`categories` (e.g. "agency" only makes
-- sense read alongside real_estate or professional_services) — the app is responsible for only
-- offering/interpreting a subcategory value against its owning category's own subcategories list;
-- this column and its CHECK just constrain it to a known id, exactly like restaurant_subcategory
-- does for its own column.
--
-- Purely cosmetic wherever the app doesn't define a `booking` override for a given sub-type (see
-- SubcategoryOption.booking in categories.ts) — no gating anywhere, same as music_role/
-- restaurant_subcategory. Additive/idempotent, same convention as every migration since 2026-09-12.

alter table profiles add column if not exists subcategory text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_subcategory_check') then
    alter table profiles add constraint profiles_subcategory_check check (
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
        -- shared catch-all, every category above ends its own subcategories list with this same id
        'other'
      )
    );
  end if;
end $$;
