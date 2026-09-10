-- Multi-image catalog photos — up to 3 photos per product (shop item,
-- service, merch, listing, etc.) and per menu item, so a customer can
-- scroll through them on the public page instead of seeing just one cover
-- photo. See src/components/ImageGallery.tsx (public, scrollable display)
-- and src/components/editor/ImageGalleryUploadField.tsx (dashboard upload).
--
-- `image_url` is kept as the first entry of `image_urls` on every write
-- from the editor (see ProductRow.tsx / MenuItemRow.tsx) so every existing
-- reader of the single-cover-image column that hasn't been updated to the
-- gallery (e.g. FeaturedMenuSection's homepage teaser, cart line items,
-- signup-request approval) keeps working unchanged.
--
-- Additive/idempotent, same pattern as every migration since 2026-09-12.

alter table products add column if not exists image_urls text[] not null default '{}'::text[];
alter table menu_items add column if not exists image_urls text[] not null default '{}'::text[];

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_image_urls_max3') then
    alter table products add constraint products_image_urls_max3
      check (array_length(image_urls, 1) is null or array_length(image_urls, 1) <= 3);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'menu_items_image_urls_max3') then
    alter table menu_items add constraint menu_items_image_urls_max3
      check (array_length(image_urls, 1) is null or array_length(image_urls, 1) <= 3);
  end if;
end $$;

-- Backfill: every row that already has a single cover photo starts its
-- gallery with that same photo, so nothing already uploaded disappears
-- from view once the public page switches to reading image_urls.
update products set image_urls = array[image_url] where image_url is not null and image_urls = '{}';
update menu_items set image_urls = array[image_url] where image_url is not null and image_urls = '{}';
