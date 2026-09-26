-- Digital Products V1 — schema foundation. PDF/ZIP downloadable products, additive on top of the
-- existing Shop (product_orders/product_order_items/create_product_order — see
-- 2026-11-02_product_checkout_foundation.sql). Nothing here changes existing behavior:
--   * product_type defaults to 'physical' — every existing product row is completely unaffected.
--   * The two new product_order_items columns are nullable snapshots (same shape as
--     name_snapshot/image_snapshot) — every existing order row gets NULL, meaning "not a digital
--     item," which is exactly what every existing (physical) order item already is.
--   * create_product_order() is widened (create or replace, same signature) to also snapshot the
--     product's digital file at purchase time — this is the SAME function, reproduced in full below
--     with only the INSERT INTO product_order_items list widened. No existing gate, check, stock
--     rule, or error path is touched.
--   * A new private storage bucket (digital-products) — the existing `uploads` (public) and
--     `protected-audio` (private) buckets are untouched. This mirrors protected-audio's own
--     RLS shape exactly: owner-only upload/manage, no public or authenticated read policy at all.
--     A customer's actual download NEVER reads this bucket directly — it always goes through a
--     server route (service role client, bypassing RLS entirely) that independently re-verifies the
--     order/entitlement before minting a short-lived signed URL. See the accompanying design notes
--     for the full download authorization flow (application code, not part of this migration).
--
-- Why the file is snapshotted onto product_order_items (not read live from products at download
-- time): a seller must be able to replace a digital file, or unpublish/edit the product, WITHOUT
-- retroactively changing what a past purchaser is entitled to — the same reason name_snapshot/
-- image_snapshot exist instead of a live join to `products`. A file "replace" therefore always
-- uploads to a brand-new storage path and only repoints products.digital_file_path going forward;
-- the OLD object is never deleted here (no automatic cleanup in V1 — see design notes), so every
-- existing order's snapshot keeps pointing at a real, still-downloadable object.
--
-- Additive/idempotent throughout, same convention as every migration since 2026-09-12.

-- ============================================================================
-- 1. PRODUCTS — product type + digital file metadata
-- ============================================================================
alter table products add column if not exists product_type text not null default 'physical';
alter table products add column if not exists digital_file_path text;       -- storage object path in `digital-products` (private) — NEVER a public URL
alter table products add column if not exists digital_file_name text;       -- original filename, for display + Content-Disposition
alter table products add column if not exists digital_file_size_bytes bigint;
alter table products add column if not exists digital_file_mime text;       -- normalized to exactly one of the two allowed values below

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_product_type_check') then
    alter table products add constraint products_product_type_check
      check (product_type in ('physical', 'digital'));
  end if;
  -- A physical product can NEVER carry digital file data — hard DB invariant, not just an app
  -- convention, so a bug in the editor can't accidentally leak a digital file onto a physical row
  -- (or vice versa: this also means a product cannot be "digital" with a physical inventory_count
  -- workflow silently reused — the two stay cleanly separated by construction).
  if not exists (select 1 from pg_constraint where conname = 'products_physical_no_digital_fields') then
    alter table products add constraint products_physical_no_digital_fields
      check (
        product_type <> 'physical'
        or (digital_file_path is null and digital_file_name is null
            and digital_file_size_bytes is null and digital_file_mime is null)
      );
  end if;
  -- V1: PDF or ZIP only. The application's centralized validator (not yet written — see design
  -- notes) normalizes whatever the browser/OS reports (e.g. 'application/x-zip-compressed',
  -- 'application/octet-stream' for a .zip on some systems) down to exactly one of these two
  -- canonical values before it ever reaches this column — so this CHECK stays a strict, meaningful
  -- allow-list of two values, not a loose one padded with fallback MIME types.
  if not exists (select 1 from pg_constraint where conname = 'products_digital_file_mime_check') then
    alter table products add constraint products_digital_file_mime_check
      check (digital_file_mime is null or digital_file_mime in ('application/pdf', 'application/zip'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_digital_file_size_check') then
    alter table products add constraint products_digital_file_size_check
      check (
        digital_file_size_bytes is null
        or (digital_file_size_bytes > 0 and digital_file_size_bytes <= 26214400) -- 25 MiB ceiling, defense in depth (see Decision A)
      );
  end if;
end $$;

-- ============================================================================
-- 2. PRODUCT ORDER ITEMS — immutable digital-file snapshot (mirrors name_snapshot/image_snapshot)
-- ============================================================================
alter table product_order_items add column if not exists digital_file_path_snapshot text;
alter table product_order_items add column if not exists digital_file_name_snapshot text;
-- No new CHECK needed: product_order_items_guard() already refuses ANY update to this table
-- (raise exception unconditionally) — the two new columns are automatically covered by that
-- existing blanket immutability, exactly like every other snapshot column already is.

-- ============================================================================
-- 3. create_product_order() — SAME function, SAME signature, reproduced in full. The only change
--    is the INSERT INTO product_order_items list at the very end, which now also snapshots the
--    product's digital file (NULL for a physical product, exactly as intended). Every gate, stock
--    rule, currency check and error path below is byte-for-byte identical to
--    2026-11-02_product_checkout_foundation.sql's original.
-- ============================================================================
create or replace function create_product_order(
  p_profile_id uuid, p_product_id uuid, p_quantity int, p_customer_id uuid,
  p_customer_name text, p_customer_phone text, p_customer_email text, p_customer_note text,
  p_reservation_minutes int default 30)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c_max_quantity constant int := 10;
  c_max_open_orders constant int := 3;
  v_settings record; v_profile record; v_product products;
  v_order product_orders; v_item product_order_items;
  v_phone text := btrim(coalesce(p_customer_phone, ''));
  v_currency text; v_subtotal numeric(12,2); v_expired uuid; v_reserved boolean := false;
begin
  if p_quantity is null or p_quantity < 1 then raise exception 'invalid_quantity'; end if;
  if p_quantity > c_max_quantity then raise exception 'quantity_exceeds_max'; end if;
  if p_reservation_minutes is null or p_reservation_minutes < 5 or p_reservation_minutes > 120 then
    raise exception 'invalid_reservation_window';
  end if;

  select commerce_enabled, commerce_commission_rate, fapshi_enabled into v_settings from platform_settings limit 1;
  if not found or v_settings.commerce_enabled is not true or v_settings.commerce_commission_rate is null then
    raise exception 'commerce_disabled';
  end if;
  if v_settings.fapshi_enabled is not true then
    raise exception 'payment_provider_unavailable';
  end if;

  select id, published, is_demo, currency, category, categories into v_profile from profiles where id = p_profile_id;
  if not found or v_profile.published is not true or v_profile.is_demo is true then
    raise exception 'profile_unavailable';
  end if;
  if v_profile.category = 'music_entertainment' or 'music_entertainment' = any(coalesce(v_profile.categories, '{}')) then
    raise exception 'music_profile_not_supported';
  end if;
  v_currency := upper(coalesce(nullif(btrim(v_profile.currency), ''), 'USD'));
  if v_currency <> 'XAF' then
    raise exception 'commerce_currency_unsupported';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_profile_id::text || ':' || v_phone, 0));
  if (select count(*) from product_orders
       where profile_id = p_profile_id and customer_phone = v_phone
         and status = 'awaiting_payment' and expires_at > now()) >= c_max_open_orders then
    raise exception 'too_many_open_orders';
  end if;

  for attempt in 1..2 loop
    update products
       set inventory_count = case when inventory_count is null then null else inventory_count - p_quantity end
     where id = p_product_id and profile_id = p_profile_id
       and available is not false
       and name is not null and btrim(name) <> ''
       and price is not null and price > 0
       and (inventory_count is null or inventory_count >= p_quantity)
    returning * into v_product;
    if found then v_reserved := true; exit; end if;
    if attempt = 1 then
      for v_expired in
        select o.id from product_orders o join product_order_items i on i.order_id = o.id
         where i.product_id = p_product_id and o.status = 'awaiting_payment'
           and o.stock_released_at is null and o.expires_at <= now()
         order by o.expires_at limit 25
      loop
        perform release_product_order_stock(v_expired, 'expired');
      end loop;
    end if;
  end loop;

  if not v_reserved then
    if exists (select 1 from products where id = p_product_id and profile_id = p_profile_id
                and available is not false and name is not null and btrim(name) <> ''
                and price is not null and price > 0) then
      raise exception 'insufficient_stock';
    end if;
    raise exception 'product_unavailable';
  end if;

  v_subtotal := v_product.price * p_quantity;

  insert into product_orders (profile_id, customer_id, customer_name, customer_phone, customer_email,
                              customer_note, currency, subtotal, total, expires_at)
  values (p_profile_id, p_customer_id, btrim(coalesce(p_customer_name, '')), v_phone,
          nullif(btrim(coalesce(p_customer_email, '')), ''), nullif(btrim(coalesce(p_customer_note, '')), ''),
          v_currency, v_subtotal, v_subtotal, now() + make_interval(mins => p_reservation_minutes))
  returning * into v_order;

  -- The only change from the original function: two more columns snapshotted from v_product, both
  -- NULL for a physical product (product_type = 'physical' guarantees v_product.digital_file_path
  -- is already NULL at the table level — see products_physical_no_digital_fields above).
  insert into product_order_items (order_id, product_id, name_snapshot, image_snapshot,
                                   unit_price_snapshot, quantity, line_total,
                                   digital_file_path_snapshot, digital_file_name_snapshot)
  values (v_order.id, v_product.id, left(v_product.name, 300),
          coalesce(nullif(v_product.image_urls[1], ''), nullif(v_product.image_url, '')),
          v_product.price, p_quantity, v_subtotal,
          v_product.digital_file_path, v_product.digital_file_name)
  returning * into v_item;

  return jsonb_build_object('order', to_jsonb(v_order), 'item', to_jsonb(v_item));
end $$;

revoke all on function create_product_order(uuid, uuid, int, uuid, text, text, text, text, int) from public, anon, authenticated;
grant execute on function create_product_order(uuid, uuid, int, uuid, text, text, text, text, int) to service_role;

-- ============================================================================
-- 4. STORAGE — new PRIVATE bucket for digital files. Same posture as protected-audio: owner-scoped
--    upload/manage under their own uid folder, NO read/select policy for anyone (not even
--    "authenticated") and NO anon policy at all. A signed-in seller's own dashboard (re-upload,
--    replace, remove) uses their own session against these policies; an actual customer download
--    NEVER touches this bucket via the client — it is always mediated by a server route using the
--    service-role client, which bypasses RLS and independently re-verifies the order first (see
--    design notes below).
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('digital-products', 'digital-products', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'digital-products owner upload'
  ) then
    create policy "digital-products owner upload" on storage.objects for insert
    with check (bucket_id = 'digital-products' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'digital-products owner manage'
  ) then
    create policy "digital-products owner manage" on storage.objects for all
    using (bucket_id = 'digital-products' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;

-- ============================================================================
-- ROLLBACK (documented only; NOT part of the migration — safe only while no real digital product
-- data exists yet, since dropping these columns/function version would lose that data).
-- ============================================================================
--   -- revert create_product_order to the 2026-11-02 version (byte-for-byte, minus the two new
--   -- INSERT columns) via the same create-or-replace mechanism, then:
--   alter table product_order_items drop column if exists digital_file_name_snapshot;
--   alter table product_order_items drop column if exists digital_file_path_snapshot;
--   alter table products drop constraint if exists products_digital_file_size_check;
--   alter table products drop constraint if exists products_digital_file_mime_check;
--   alter table products drop constraint if exists products_physical_no_digital_fields;
--   alter table products drop constraint if exists products_product_type_check;
--   alter table products drop column if exists digital_file_mime;
--   alter table products drop column if exists digital_file_size_bytes;
--   alter table products drop column if exists digital_file_name;
--   alter table products drop column if exists digital_file_path;
--   alter table products drop column if exists product_type;
--   -- storage policies/bucket left in place deliberately (dropping the bucket would need every
--   -- object removed first) — drop manually via the Supabase dashboard if truly rolling back.
