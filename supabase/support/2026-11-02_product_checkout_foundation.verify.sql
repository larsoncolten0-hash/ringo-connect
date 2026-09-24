-- ============================================================================
-- STAGING VERIFICATION for the Product Checkout database layer
-- (2026-11-02_product_checkout_foundation.sql, and — if applied — 2026-11-03_commerce_abuse_protection.sql)
--
-- *** RUN ON STAGING ONLY. DO NOT RUN ON PRODUCTION. ***  Not run yet: staging does not exist.
--
-- It seeds FAKE rows (fake auth users, profiles, products, orders, payments, earnings), exercises the
-- checks below, prints one result table, and then ROLLS EVERYTHING BACK — nothing persists. It refuses
-- to start unless you acknowledge you are on staging (line marked  <<< EDIT ME >>>) and the project
-- looks like a fresh test project (no commerce rows, fewer than 25 auth users).
--
-- Run it in the Supabase SQL Editor of the STAGING project as ONE run. Every row must say ok = true.
-- PART 2 at the bottom (concurrency) needs two SQL Editor tabs and is manual.
--
-- If the fake-user insert fails because your Auth schema needs more columns, create two users in the
-- dashboard (Authentication -> Users) and replace the two `v_creator` / `v_other` assignments with
-- their ids; the rest of the script is unchanged.
--
-- Covers: structure and grants; RLS as anon, as an authenticated owner, as an authenticated stranger and
-- as the service role; atomic stock reservation (no oversell); the open-order cap; exactly-once stock
-- release; order and payment state machines; immutability; one live payment per order; exactly-once
-- earnings; and the abuse limiter.
-- ============================================================================

begin;

select set_config('app.verify_confirm_staging', 'NOT-CONFIRMED', true);   -- <<< EDIT ME >>> change NOT-CONFIRMED to I-AM-ON-STAGING

create temp table _v (n serial primary key, name text not null, ok boolean not null, detail text);

create or replace function pg_temp.chk(p_name text, p_ok boolean, p_detail text default '') returns void
language plpgsql as $$ begin insert into _v (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail); end $$;

-- Runs a statement as postgres and returns the exception MESSAGE (or NULL when it succeeded).
-- The statement runs in a sub-transaction, so a failing statement leaves no trace.
create or replace function pg_temp.err(p_sql text) returns text
language plpgsql as $$ begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

-- Runs a statement as a database role (anon / authenticated / service_role), optionally with a JWT sub.
-- Returns 'OK:<first column of a SELECT>' / 'OK:done' or 'ERR:<sqlstate>' (42501 = permission denied).
create or replace function pg_temp.run_as(p_role text, p_sub uuid, p_sql text) returns text
language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', case when p_sub is null then '' else json_build_object('sub', p_sub, 'role', p_role)::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
  execute format('set local role %I', p_role);
  begin
    if p_sql ~* '^\s*select' then execute p_sql into v; else execute p_sql; v := 'done'; end if;
    v := 'OK:' || coalesce(v, 'null');
  exception when others then
    v := 'ERR:' || sqlstate;
  end;
  reset role;
  return v;
end $$;

do $$
declare
  v_creator uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_profile uuid := gen_random_uuid();   -- non-music, XAF, published: eligible
  v_music   uuid := gen_random_uuid();
  v_usd     uuid := gen_random_uuid();
  v_hidden  uuid := gen_random_uuid();
  v_prod uuid; v_prod2 uuid; v_res jsonb; v_o1 uuid; v_o2 uuid; v_o3 uuid; v_pay1 uuid; v_pay2 uuid;
  v_stock int; v_n int; v_msg text; v_t text;
  v_hash text := repeat('a', 64);
  v_hash2 text := repeat('b', 64);

  -- creates a product with the given stock on profile p_profile (price 5000 XAF)
  mk_prod uuid;
begin
  -- ------------------------------------------------------------------ guards
  if coalesce(current_setting('app.verify_confirm_staging', true), '') <> 'I-AM-ON-STAGING' then
    raise exception 'Refusing to run: edit the set_config line at the top to I-AM-ON-STAGING (staging projects only).';
  end if;
  if exists (select 1 from product_orders) or exists (select 1 from customer_payments) or exists (select 1 from commerce_sale_earnings) then
    raise exception 'Refusing to run: the commerce tables already contain rows. This does not look like a fresh staging project.';
  end if;
  if (select count(*) from auth.users) >= 25 then
    raise exception 'Refusing to run: 25 or more auth users. This does not look like a fresh staging project.';
  end if;
  if not exists (select 1 from platform_settings) then
    raise exception 'Seed a platform_settings row first (the staging setup step), then re-run.';
  end if;

  -- ------------------------------------------------------------------ fake data (rolled back at the end)
  insert into auth.users (id, email) values (v_creator, 'verify-creator@example.invalid'), (v_other, 'verify-other@example.invalid');
  insert into public.users (id, email) values (v_creator, 'verify-creator@example.invalid'), (v_other, 'verify-other@example.invalid');
  insert into profiles (id, user_id, username, name, published, currency, category, categories, is_demo) values
    (v_profile, v_creator, 'verify-shop',   'Verify Shop',   true,  'XAF', 'business_ecommerce', array['business_ecommerce'], false),
    (v_music,   v_creator, 'verify-music',  'Verify Music',  true,  'XAF', 'music_entertainment', array['music_entertainment'], false),
    (v_usd,     v_creator, 'verify-usd',    'Verify USD',    true,  'USD', 'business_ecommerce', array['business_ecommerce'], false),
    (v_hidden,  v_creator, 'verify-hidden', 'Verify Hidden', false, 'XAF', 'business_ecommerce', array['business_ecommerce'], false);
  update platform_settings set commerce_enabled = true, commerce_commission_rate = 0.10, fapshi_enabled = true;

  -- ================================================================== A. STRUCTURE AND GRANTS
  perform pg_temp.chk('tables exist (4)', (select count(*) = 4 from information_schema.tables where table_schema = 'public' and table_name in ('product_orders','product_order_items','customer_payments','commerce_sale_earnings')));
  perform pg_temp.chk('RLS enabled on all 4 tables', (select count(*) = 4 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('product_orders','product_order_items','customer_payments','commerce_sale_earnings') and c.relrowsecurity));
  perform pg_temp.chk('functions exist', to_regprocedure('create_product_order(uuid,uuid,int,uuid,text,text,text,text,int)') is not null and to_regprocedure('release_product_order_stock(uuid,text)') is not null);
  perform pg_temp.chk('anon/authenticated CANNOT execute create_product_order or release_product_order_stock',
    not has_function_privilege('anon', 'create_product_order(uuid,uuid,int,uuid,text,text,text,text,int)', 'execute')
    and not has_function_privilege('authenticated', 'create_product_order(uuid,uuid,int,uuid,text,text,text,text,int)', 'execute')
    and not has_function_privilege('anon', 'release_product_order_stock(uuid,text)', 'execute')
    and not has_function_privilege('authenticated', 'release_product_order_stock(uuid,text)', 'execute'));
  perform pg_temp.chk('service_role CAN execute both functions', has_function_privilege('service_role', 'create_product_order(uuid,uuid,int,uuid,text,text,text,text,int)', 'execute') and has_function_privilege('service_role', 'release_product_order_stock(uuid,text)', 'execute'));
  perform pg_temp.chk('only 3 SELECT policies exist, all for authenticated owners; none allow writes',
    (select count(*) = 3 from pg_policies where schemaname = 'public' and tablename in ('product_orders','product_order_items','commerce_sale_earnings') and cmd = 'SELECT')
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('product_orders','product_order_items','customer_payments','commerce_sale_earnings') and cmd in ('INSERT','UPDATE','DELETE','ALL'))
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_payments'));
  perform pg_temp.chk('the 4 guard triggers exist', (select count(*) = 4 from pg_trigger t where not t.tgisinternal and t.tgname in ('product_orders_guard_trg','product_order_items_guard_trg','customer_payments_guard_trg','commerce_sale_earnings_guard_trg')));
  perform pg_temp.chk('one-live-payment-per-order partial unique index exists', exists (select 1 from pg_indexes where indexname = 'customer_payments_one_live_idx'));

  -- ================================================================== B. create_product_order (as owner) — gates, price, stock
  insert into products (id, profile_id, name, price, available, inventory_count) values (gen_random_uuid(), v_profile, 'Verify Widget', 5000, true, 5) returning id into v_prod;
  v_res := create_product_order(v_profile, v_prod, 2, null, 'Test Buyer', '677000001', null, null);
  v_o1 := (v_res->'order'->>'id')::uuid;
  select inventory_count into v_stock from products where id = v_prod;
  perform pg_temp.chk('order created: stock 5 -> 3, total = database price x quantity (10000), status awaiting_payment, one item snapshot',
    v_stock = 3 and (v_res->'order'->>'total')::numeric = 10000 and v_res->'order'->>'status' = 'awaiting_payment'
    and (select count(*) = 1 and min(unit_price_snapshot) = 5000 and min(name_snapshot) = 'Verify Widget' from product_order_items where order_id = v_o1));
  perform pg_temp.chk('quantity 0 rejected', pg_temp.err(format('select create_product_order(%L,%L,0,null,''A'',''677000002'',null,null)', v_profile, v_prod)) = 'invalid_quantity');
  perform pg_temp.chk('quantity over the cap (11) rejected', pg_temp.err(format('select create_product_order(%L,%L,11,null,''A'',''677000002'',null,null)', v_profile, v_prod)) = 'quantity_exceeds_max');
  perform pg_temp.chk('empty customer name rolls the whole transaction back (stock unchanged)', pg_temp.err(format('select create_product_order(%L,%L,1,null,'' '',''677000002'',null,null)', v_profile, v_prod)) is not null and (select inventory_count from products where id = v_prod) = 3);
  insert into products (id, profile_id, name, price, available, inventory_count) values (gen_random_uuid(), v_music, 'Music thing', 5000, true, 5) returning id into mk_prod;
  perform pg_temp.chk('music profile refused', pg_temp.err(format('select create_product_order(%L,%L,1,null,''A'',''677000003'',null,null)', v_music, mk_prod)) = 'music_profile_not_supported');
  insert into products (id, profile_id, name, price, available, inventory_count) values (gen_random_uuid(), v_usd, 'USD thing', 5000, true, 5) returning id into mk_prod;
  perform pg_temp.chk('non-XAF profile refused (XAF only)', pg_temp.err(format('select create_product_order(%L,%L,1,null,''A'',''677000003'',null,null)', v_usd, mk_prod)) = 'commerce_currency_unsupported');
  insert into products (id, profile_id, name, price, available, inventory_count) values (gen_random_uuid(), v_hidden, 'Hidden thing', 5000, true, 5) returning id into mk_prod;
  perform pg_temp.chk('unpublished profile refused', pg_temp.err(format('select create_product_order(%L,%L,1,null,''A'',''677000003'',null,null)', v_hidden, mk_prod)) = 'profile_unavailable');
  insert into products (id, profile_id, name, price, available, inventory_count) values (gen_random_uuid(), v_profile, 'Unavailable', 5000, false, 5) returning id into mk_prod;
  perform pg_temp.chk('unavailable product refused', pg_temp.err(format('select create_product_order(%L,%L,1,null,''A'',''677000003'',null,null)', v_profile, mk_prod)) = 'product_unavailable');
  update platform_settings set commerce_enabled = false;
  perform pg_temp.chk('commerce switched off -> refused', pg_temp.err(format('select create_product_order(%L,%L,1,null,''A'',''677000004'',null,null)', v_profile, v_prod)) = 'commerce_disabled');
  update platform_settings set commerce_enabled = true, commerce_commission_rate = null;
  perform pg_temp.chk('no commission rate set -> refused', pg_temp.err(format('select create_product_order(%L,%L,1,null,''A'',''677000004'',null,null)', v_profile, v_prod)) = 'commerce_disabled');
  update platform_settings set commerce_commission_rate = 0.10, fapshi_enabled = false;
  perform pg_temp.chk('Fapshi disabled -> refused', pg_temp.err(format('select create_product_order(%L,%L,1,null,''A'',''677000004'',null,null)', v_profile, v_prod)) = 'payment_provider_unavailable');
  update platform_settings set fapshi_enabled = true;

  -- ================================================================== C. open-order cap (3 per profile + contact number)
  insert into products (id, profile_id, name, price, available, inventory_count) values (gen_random_uuid(), v_profile, 'Cap widget', 1000, true, 50) returning id into v_prod2;
  for i in 1..3 loop perform create_product_order(v_profile, v_prod2, 1, null, 'Capper', '677111111', null, null); end loop;
  perform pg_temp.chk('4th open order for the same number is refused (too_many_open_orders), stock not consumed', pg_temp.err(format('select create_product_order(%L,%L,1,null,''Capper'',''677111111'',null,null)', v_profile, v_prod2)) = 'too_many_open_orders' and (select inventory_count from products where id = v_prod2) = 47);
  perform pg_temp.chk('a different number is unaffected by the cap', pg_temp.err(format('select create_product_order(%L,%L,1,null,''Other'',''677111112'',null,null)', v_profile, v_prod2)) is null);

  -- ================================================================== D. no oversell (sequential; PART 2 covers true concurrency)
  insert into products (id, profile_id, name, price, available, inventory_count) values (gen_random_uuid(), v_profile, 'Scarce', 2000, true, 5) returning id into mk_prod;
  perform create_product_order(v_profile, mk_prod, 2, null, 'S1', '677222221', null, null);
  perform create_product_order(v_profile, mk_prod, 2, null, 'S2', '677222222', null, null);
  perform pg_temp.chk('stock 5: 2+2 reserved, a third order for 2 is refused (insufficient_stock), 1 left', pg_temp.err(format('select create_product_order(%L,%L,2,null,''S3'',''677222223'',null,null)', v_profile, mk_prod)) = 'insufficient_stock' and (select inventory_count from products where id = mk_prod) = 1);
  perform pg_temp.chk('the last unit can still be taken, then stock is exactly 0 (never negative)', pg_temp.err(format('select create_product_order(%L,%L,1,null,''S4'',''677222224'',null,null)', v_profile, mk_prod)) is null and (select inventory_count from products where id = mk_prod) = 0);

  -- ================================================================== E. exactly-once stock release
  insert into products (id, profile_id, name, price, available, inventory_count) values (gen_random_uuid(), v_profile, 'Releasable', 3000, true, 10) returning id into mk_prod;
  v_res := create_product_order(v_profile, mk_prod, 3, null, 'R1', '677333331', null, null); v_o2 := (v_res->'order'->>'id')::uuid;
  perform pg_temp.chk('stock 10 -> 7 after reserving 3', (select inventory_count from products where id = mk_prod) = 7);
  perform pg_temp.chk('release as "expired" BEFORE the reservation ends does nothing (false, stock unchanged)', release_product_order_stock(v_o2, 'expired') = false and (select inventory_count from products where id = mk_prod) = 7);
  update product_orders set expires_at = now() - interval '1 minute' where id = v_o2;
  perform pg_temp.chk('release once the reservation ended: true, stock back to 10, order expired, stock_released_at set', release_product_order_stock(v_o2, 'expired') = true and (select inventory_count from products where id = mk_prod) = 10 and (select status = 'expired' and stock_released_at is not null from product_orders where id = v_o2));
  perform pg_temp.chk('a second release is a no-op (false, stock still 10) — exactly once', release_product_order_stock(v_o2, 'expired') = false and release_product_order_stock(v_o2, 'cancelled') = false and (select inventory_count from products where id = mk_prod) = 10);
  v_res := create_product_order(v_profile, mk_prod, 2, null, 'R2', '677333332', null, null); v_o3 := (v_res->'order'->>'id')::uuid;
  perform pg_temp.chk('cancel releases immediately, once (stock back to 10)', release_product_order_stock(v_o3, 'cancelled') = true and release_product_order_stock(v_o3, 'cancelled') = false and (select inventory_count from products where id = mk_prod) = 10);
  v_res := create_product_order(v_profile, mk_prod, 2, null, 'R3', '677333333', null, null); v_o3 := (v_res->'order'->>'id')::uuid;
  update product_orders set status = 'paid', paid_at = now() where id = v_o3;
  perform pg_temp.chk('a paid order never has its stock released', release_product_order_stock(v_o3, 'cancelled') = false and (select inventory_count from products where id = mk_prod) = 8);

  -- ================================================================== F. state machines and immutability
  v_res := create_product_order(v_profile, mk_prod, 1, null, 'F1', '677444441', null, null); v_o1 := (v_res->'order'->>'id')::uuid;
  perform pg_temp.chk('order: awaiting_payment -> paid is allowed', pg_temp.err(format('update product_orders set status=''paid'', paid_at=now() where id=%L', v_o1)) is null);
  perform pg_temp.chk('order: paid -> awaiting_payment is refused', pg_temp.err(format('update product_orders set status=''awaiting_payment'' where id=%L', v_o1)) like '%illegal status transition%');
  perform pg_temp.chk('order: paid -> fulfilled allowed; fulfilled -> paid refused', pg_temp.err(format('update product_orders set status=''fulfilled'' where id=%L', v_o1)) is null and pg_temp.err(format('update product_orders set status=''paid'' where id=%L', v_o1)) like '%illegal status transition%');
  perform pg_temp.chk('order: total / customer phone / profile are immutable', pg_temp.err(format('update product_orders set total = 1 where id=%L', v_o1)) like '%immutable%' and pg_temp.err(format('update product_orders set customer_phone = ''677999999'' where id=%L', v_o1)) like '%immutable%');
  perform pg_temp.chk('order: a "paid" status without paid_at is refused by the table check', pg_temp.err(format('insert into product_orders (profile_id, customer_name, customer_phone, currency, subtotal, total, status, expires_at) values (%L, ''x'', ''677000000'', ''XAF'', 1, 1, ''paid'', now())', v_profile)) is not null);
  perform pg_temp.chk('order item: snapshots cannot be updated', pg_temp.err(format('update product_order_items set quantity = 9 where order_id = %L', v_o1)) like '%immutable snapshots%');
  v_res := create_product_order(v_profile, mk_prod, 1, null, 'F2', '677444442', null, null); v_o2 := (v_res->'order'->>'id')::uuid;
  update product_orders set expires_at = now() - interval '1 minute' where id = v_o2; perform release_product_order_stock(v_o2, 'expired');
  perform pg_temp.chk('order: expired -> paid (late confirmation) allowed',
    pg_temp.err(format('update product_orders set status=''paid'', paid_at=now() where id=%L', v_o2)) is null);
  v_res := create_product_order(v_profile, mk_prod, 1, null, 'F3', '677444443', null, null); v_o3 := (v_res->'order'->>'id')::uuid; perform release_product_order_stock(v_o3, 'cancelled');
  perform pg_temp.chk('order: cancelled -> paid refused, cancelled -> payment_review allowed', pg_temp.err(format('update product_orders set status=''paid'', paid_at=now() where id=%L', v_o3)) like '%illegal status transition%' and pg_temp.err(format('update product_orders set status=''payment_review'' where id=%L', v_o3)) is null);

  -- payments
  v_pay1 := gen_random_uuid();
  v_res := create_product_order(v_profile, mk_prod, 1, null, 'P1', '677555551', null, null); v_o1 := (v_res->'order'->>'id')::uuid;
  insert into customer_payments (id, provider, external_id, target_type, target_id, profile_id, amount, currency, payer_medium, expires_at)
    values (v_pay1, 'fapshi', 'pp-' || v_pay1, 'product_order', v_o1, v_profile, 3000, 'XAF', 'mobile money', now() + interval '15 minutes');
  perform pg_temp.chk('payment: a second LIVE attempt for the same order is refused (unique index)', pg_temp.err(format('insert into customer_payments (provider, external_id, target_type, target_id, profile_id, amount, currency, expires_at) values (''fapshi'', ''pp-dup-%s'', ''product_order'', %L, %L, 3000, ''XAF'', now() + interval ''15 minutes'')', v_pay1, v_o1, v_profile)) like '%duplicate key%');
  perform pg_temp.chk('payment: initiated -> pending with a transaction id is allowed; the transaction id then cannot change', pg_temp.err(format('update customer_payments set status=''pending'', provider_transaction_id=''TX1'' where id=%L', v_pay1)) is null and pg_temp.err(format('update customer_payments set provider_transaction_id=''TX2'' where id=%L', v_pay1)) like '%immutable%');
  perform pg_temp.chk('payment: amount, currency and target are immutable', pg_temp.err(format('update customer_payments set amount = 1 where id=%L', v_pay1)) like '%immutable%');
  perform pg_temp.chk('payment: "succeeded" needs confirmed_at (table check)', pg_temp.err(format('update customer_payments set status=''succeeded'' where id=%L', v_pay1)) is not null and pg_temp.err(format('update customer_payments set status=''succeeded'', confirmed_at=now() where id=%L', v_pay1)) is null);
  perform pg_temp.chk('payment: succeeded -> failed refused', pg_temp.err(format('update customer_payments set status=''failed'' where id=%L', v_pay1)) like '%illegal status transition%');
  v_pay2 := gen_random_uuid();
  insert into customer_payments (id, provider, external_id, target_type, target_id, profile_id, amount, currency, expires_at, status)
    values (v_pay2, 'fapshi', 'pp-' || v_pay2, 'product_order', v_o3, v_profile, 3000, 'XAF', now() + interval '15 minutes', 'expired');
  perform pg_temp.chk('payment: expired -> succeeded (late provider confirmation) allowed; failed -> succeeded refused',
    pg_temp.err(format('update customer_payments set status=''succeeded'', confirmed_at=now() where id=%L', v_pay2)) is null
    and pg_temp.err(format('update customer_payments set status=''failed'' where id=%L', v_pay2)) like '%illegal status transition%');

  -- ================================================================== G. exactly-once earnings
  update product_orders set status = 'paid', paid_at = now() where id = v_o1;
  insert into commerce_sale_earnings (order_id, payment_id, profile_id, creator_user_id, gross_amount, commission_rate, platform_fee, net_amount, currency)
    values (v_o1, v_pay1, v_profile, v_creator, 3000, 0.10, 300, 2700, 'XAF');
  perform pg_temp.chk('earning: exactly one row per order (a second earning for the same order is refused)', pg_temp.err(format('insert into commerce_sale_earnings (order_id, payment_id, profile_id, creator_user_id, gross_amount, commission_rate, platform_fee, net_amount, currency) values (%L, %L, %L, %L, 3000, 0.10, 300, 2700, ''XAF'')', v_o1, v_pay2, v_profile, v_creator)) like '%duplicate key%');
  perform pg_temp.chk('earning: exactly one row per payment (the same payment cannot fund another order)', pg_temp.err(format('insert into commerce_sale_earnings (order_id, payment_id, profile_id, creator_user_id, gross_amount, commission_rate, platform_fee, net_amount, currency) values (%L, %L, %L, %L, 3000, 0.10, 300, 2700, ''XAF'')', v_o2, v_pay1, v_profile, v_creator)) like '%duplicate key%');
  perform pg_temp.chk('earning: gross must equal fee + net (table check)', pg_temp.err(format('insert into commerce_sale_earnings (order_id, payment_id, profile_id, creator_user_id, gross_amount, commission_rate, platform_fee, net_amount, currency) values (%L, %L, %L, %L, 3000, 0.10, 300, 2000, ''XAF'')', v_o2, v_pay2, v_profile, v_creator)) is not null);
  perform pg_temp.chk('earning: amounts and rate are immutable; only status may change (recorded -> reversed)', pg_temp.err(format('update commerce_sale_earnings set gross_amount = 9 where order_id=%L', v_o1)) like '%only status may change%' and pg_temp.err(format('update commerce_sale_earnings set status=''reversed'' where order_id=%L', v_o1)) is null);
  perform pg_temp.chk('earning: exactly one row exists for the order', (select count(*) from commerce_sale_earnings where order_id = v_o1) = 1);

  -- ================================================================== H. ROW LEVEL SECURITY AND GRANTS BY ROLE
  -- anon: no access to anything
  perform pg_temp.chk('anon: cannot read orders / items / earnings / payments (permission denied)',
    pg_temp.run_as('anon', null, 'select count(*) from product_orders') = 'ERR:42501' and pg_temp.run_as('anon', null, 'select count(*) from product_order_items') = 'ERR:42501'
    and pg_temp.run_as('anon', null, 'select count(*) from commerce_sale_earnings') = 'ERR:42501' and pg_temp.run_as('anon', null, 'select count(*) from customer_payments') = 'ERR:42501');
  perform pg_temp.chk('anon: cannot write, and cannot call the order / release functions',
    pg_temp.run_as('anon', null, format('insert into product_orders (profile_id, customer_name, customer_phone, currency, subtotal, total, expires_at) values (%L, ''x'', ''677000000'', ''XAF'', 1, 1, now())', v_profile)) = 'ERR:42501'
    and pg_temp.run_as('anon', null, format('select create_product_order(%L,%L,1,null,''A'',''677000009'',null,null)', v_profile, v_prod2)) = 'ERR:42501'
    and pg_temp.run_as('anon', null, format('select release_product_order_stock(%L,''cancelled'')', v_o1)) = 'ERR:42501');
  -- authenticated owner: reads own orders/items/earnings only; never payments; never writes
  perform pg_temp.chk('authenticated OWNER: sees their own order, item and earning', pg_temp.run_as('authenticated', v_creator, format('select count(*) from product_orders where id = %L', v_o1)) = 'OK:1'
    and pg_temp.run_as('authenticated', v_creator, format('select count(*) from product_order_items where order_id = %L', v_o1)) = 'OK:1'
    and pg_temp.run_as('authenticated', v_creator, format('select count(*) from commerce_sale_earnings where order_id = %L', v_o1)) = 'OK:1');
  perform pg_temp.chk('authenticated STRANGER (another creator): sees zero of them', pg_temp.run_as('authenticated', v_other, format('select count(*) from product_orders where id = %L', v_o1)) = 'OK:0'
    and pg_temp.run_as('authenticated', v_other, format('select count(*) from product_order_items where order_id = %L', v_o1)) = 'OK:0'
    and pg_temp.run_as('authenticated', v_other, format('select count(*) from commerce_sale_earnings where order_id = %L', v_o1)) = 'OK:0');
  perform pg_temp.chk('authenticated: can NEVER read customer_payments (owner or not)', pg_temp.run_as('authenticated', v_creator, 'select count(*) from customer_payments') = 'ERR:42501' and pg_temp.run_as('authenticated', v_other, 'select count(*) from customer_payments') = 'ERR:42501');
  perform pg_temp.chk('authenticated owner: cannot insert / update / delete on any of the 4 tables',
    pg_temp.run_as('authenticated', v_creator, format('update product_orders set status = ''paid'', paid_at = now() where id = %L', v_o3)) = 'ERR:42501'
    and pg_temp.run_as('authenticated', v_creator, format('delete from product_orders where id = %L', v_o1)) = 'ERR:42501'
    and pg_temp.run_as('authenticated', v_creator, format('update commerce_sale_earnings set status = ''reversed'' where order_id = %L', v_o1)) = 'ERR:42501'
    and pg_temp.run_as('authenticated', v_creator, format('insert into commerce_sale_earnings (order_id, payment_id, profile_id, creator_user_id, gross_amount, commission_rate, platform_fee, net_amount, currency) values (%L, %L, %L, %L, 100, 0.1, 10, 90, ''XAF'')', v_o3, v_pay2, v_profile, v_creator)) = 'ERR:42501'
    and pg_temp.run_as('authenticated', v_creator, format('update product_order_items set quantity = 9 where order_id = %L', v_o1)) = 'ERR:42501');
  perform pg_temp.chk('authenticated: cannot call create_product_order or release_product_order_stock', pg_temp.run_as('authenticated', v_creator, format('select create_product_order(%L,%L,1,null,''A'',''677000009'',null,null)', v_profile, v_prod2)) = 'ERR:42501' and pg_temp.run_as('authenticated', v_creator, format('select release_product_order_stock(%L,''cancelled'')', v_o1)) = 'ERR:42501');
  -- service role: full server access
  perform pg_temp.chk('service_role: can call create_product_order (stock reserved) and read all four tables',
    pg_temp.run_as('service_role', null, format('select create_product_order(%L,%L,1,null,''Svc'',''677666661'',null,null)::text', v_profile, v_prod2)) like 'OK:%'
    and pg_temp.run_as('service_role', null, 'select count(*) from customer_payments') = 'OK:2'
    and pg_temp.run_as('service_role', null, 'select count(*) from commerce_sale_earnings') = 'OK:1'
    and pg_temp.run_as('service_role', null, 'select count(*) from product_orders') ~ '^OK:[0-9]+$');
  perform pg_temp.chk('service_role: can write a payment status (server path) but the guard triggers still apply to it', pg_temp.run_as('service_role', null, format('update customer_payments set status = ''failed'' where id = %L', v_pay1)) = 'ERR:P0001');

  -- ================================================================== I. ABUSE LIMITER (only when 2026-11-03_commerce_abuse_protection.sql is applied)
  if to_regprocedure('commerce_rate_limit_hit(text,text,int,int)') is null then
    perform pg_temp.chk('abuse limiter: SKIPPED - 2026-11-03_commerce_abuse_protection.sql not applied', true, 'apply it, then re-run this script');
  else
    perform pg_temp.chk('limiter: 3 allowed then refused at max=3; the refusal is NOT recorded (3 rows)',
      (select bool_and(commerce_rate_limit_hit('pay_phone', v_hash, 600, 3)) from generate_series(1,3))
      and commerce_rate_limit_hit('pay_phone', v_hash, 600, 3) = false
      and (select count(*) = 3 from commerce_rate_events where kind = 'pay_phone' and subject_hash = v_hash));
    perform pg_temp.chk('limiter: another subject and another kind are counted separately', commerce_rate_limit_hit('pay_phone', v_hash2, 600, 3) = true and commerce_rate_limit_hit('pay_ip', v_hash, 600, 3) = true);
    update commerce_rate_events set created_at = now() - interval '11 minutes' where kind = 'pay_phone' and subject_hash = v_hash;
    perform pg_temp.chk('limiter: events older than the window stop counting', commerce_rate_limit_hit('pay_phone', v_hash, 600, 3) = true);
    perform pg_temp.chk('limiter: rejects bad arguments', pg_temp.err('select commerce_rate_limit_hit(''nope'', repeat(''a'',64), 600, 3)') = 'invalid_rate_limit_args' and pg_temp.err('select commerce_rate_limit_hit(''pay_ip'', ''203.0.113.7'', 600, 3)') = 'invalid_rate_limit_args' and pg_temp.err('select commerce_rate_limit_hit(''pay_ip'', repeat(''a'',64), 0, 3)') = 'invalid_rate_limit_args');
    perform pg_temp.chk('limiter: the table refuses a raw (non-hash) subject', pg_temp.err('insert into commerce_rate_events (kind, subject_hash) values (''pay_ip'', ''203.0.113.7'')') is not null);
    perform pg_temp.chk('limiter: anon and authenticated can neither call it nor read the table', pg_temp.run_as('anon', null, format('select commerce_rate_limit_hit(''pay_ip'', %L, 600, 3)', v_hash)) = 'ERR:42501' and pg_temp.run_as('authenticated', v_creator, format('select commerce_rate_limit_hit(''pay_ip'', %L, 600, 3)', v_hash)) = 'ERR:42501' and pg_temp.run_as('anon', null, 'select count(*) from commerce_rate_events') = 'ERR:42501' and pg_temp.run_as('authenticated', v_creator, 'select count(*) from commerce_rate_events') = 'ERR:42501');
    perform pg_temp.chk('limiter: service_role can call it', pg_temp.run_as('service_role', null, format('select commerce_rate_limit_hit(''order_ip'', %L, 600, 10)', v_hash2)) = 'OK:true');
    perform pg_temp.chk('limiter: RLS on, no policies', (select c.relrowsecurity from pg_class c where c.relname = 'commerce_rate_events' and c.relnamespace = 'public'::regnamespace) and not exists (select 1 from pg_policies where tablename = 'commerce_rate_events'));
  end if;
end $$;

-- Every row must say ok = true. (all_ok summarises.)
select n, name, ok, detail from _v
union all select 999999, '>>> ALL CHECKS PASSED', (select bool_and(ok) from _v), (select count(*) filter (where not ok) || ' failing of ' || count(*) from _v)
order by n;

rollback;   -- nothing above persists: fake users, profiles, products, orders, payments, earnings and settings changes are all discarded

-- ============================================================================
-- PART 2 — MANUAL: true concurrent stock reservation (two SQL Editor tabs, STAGING ONLY)
-- ============================================================================
-- This part commits fake rows; clean them up with the DELETE block at the end. Do it once staging is seeded
-- with an eligible profile (see the staging setup plan): let <PROFILE> and <PRODUCT> be that profile and a
-- product with inventory_count = 1 and price 5000.
--
--   Tab A:  begin;
--           select create_product_order('<PROFILE>', '<PRODUCT>', 1, null, 'Racer A', '677900001', null, null);
--           -- do NOT commit yet; leave the tab open.
--   Tab B:  select create_product_order('<PROFILE>', '<PRODUCT>', 1, null, 'Racer B', '677900002', null, null);
--           -- this call BLOCKS (it is waiting for tab A's row lock on the product).
--   Tab A:  commit;
--   Tab B:  -- unblocks and must FAIL with:  insufficient_stock
--
--   Expected end state:  select inventory_count from products where id = '<PRODUCT>';   -- 0 (never negative)
--                        select count(*) from product_orders where customer_phone in ('677900001','677900002');  -- 1
--   Repeat with Tab A ending in  rollback;  instead: tab B must then SUCCEED and stock ends at 0.
--
-- Cleanup (staging only): delete the test orders and restore the stock you set:
--   delete from product_orders where customer_phone in ('677900001','677900002');
--   update products set inventory_count = 1 where id = '<PRODUCT>';
