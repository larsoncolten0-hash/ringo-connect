-- Rollback for 2026-12-15_customer_location.sql. It restores the 2026-12-06 sale_record exactly, removes the 9-argument bk_customer_save overload and the column.
-- It REFUSES to run (and changes nothing) while any customer has a stored location, because dropping the column would silently erase data the owner typed.
-- Resolve that deliberately first (this script never edits or deletes a customer or a document). Receipts already issued keep the location frozen in their own
-- snapshot either way: nothing here touches bk_documents.
begin;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bk_customers' and column_name = 'address') then
    if exists (select 1 from bk_customers where address is not null) then
      raise exception 'customers with a stored location exist (bk_customers.address); clear or export them before rolling back';
    end if;
  end if;
end $$;

drop function if exists bk_customer_save(uuid, uuid, uuid, text, text, text, text, uuid, text);

create or replace function sale_record(
  p_profile_id uuid, p_actor_user_id uuid, p_locale text, p_lines jsonb, p_customer_id uuid, p_method text, p_sold_on date, p_notes text, p_client_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_currency text; v_digits int; v_today date; v_existing bk_documents; v_elem jsonb; v_ord bigint; v_txt text; v_pid uuid; v_prod record; v_qty numeric;
  v_unit numeric; v_calc record; v_desc text; v_rows jsonb[] := '{}'; v_total numeric := 0; v_summary text := ''; v_cust record; v_customer jsonb := '{}'::jsonb;
  v_entry jsonb; v_entry_id uuid; v_receipt bk_documents; v_moves jsonb := '[]'::jsonb; v_mv jsonb; r jsonb; v_sold_on date;
begin
  v_currency := bk_doc_gate(p_profile_id, p_actor_user_id);
  if p_client_request_id is null then raise exception 'request_id_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('sale:' || p_profile_id::text || ':' || p_client_request_id::text, 0));
  select * into v_existing from bk_documents where profile_id = p_profile_id and client_request_id = p_client_request_id;
  if found then
    if v_existing.doc_type <> 'receipt' or v_existing.source_type is distinct from 'sale' then raise exception 'request_id_conflict'; end if;
    return bk_doc_bundle(v_existing.id) || jsonb_build_object('duplicate', true, 'entry_id', v_existing.source_id, 'movements', '[]'::jsonb);
  end if;

  if p_locale is null or p_locale not in ('en', 'fr') then raise exception 'invalid_locale'; end if;
  if p_method is null or p_method not in ('cash', 'mobile_money', 'bank_transfer', 'card', 'other') then raise exception 'invalid_method'; end if;
  if p_notes is not null and char_length(p_notes) > 1000 then raise exception 'invalid_notes'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 then raise exception 'invalid_lines'; end if;
  if jsonb_array_length(p_lines) > 20 then raise exception 'too_many_lines'; end if;
  v_digits := bk_currency_digits(v_currency);
  v_today := (now() at time zone 'Africa/Douala')::date;
  v_sold_on := coalesce(p_sold_on, v_today);
  if v_sold_on > v_today or v_sold_on < date '2000-01-01' then raise exception 'invalid_sold_on'; end if;

  if p_customer_id is not null then
    select name, phone, email into v_cust from bk_customers where id = p_customer_id and profile_id = p_profile_id and archived_at is null;
    if not found then raise exception 'customer_not_found'; end if;
    v_customer := bk_doc_clean_customer(jsonb_build_object('name', v_cust.name, 'phone', v_cust.phone, 'email', v_cust.email));
  end if;

  -- validate and price every line first; nothing is written until all are valid
  for v_elem, v_ord in select e, o from jsonb_array_elements(p_lines) with ordinality as t(e, o) loop
    if jsonb_typeof(v_elem) <> 'object' then raise exception 'invalid_line'; end if;
    v_pid := null;
    if v_elem ? 'product_id' and jsonb_typeof(v_elem -> 'product_id') <> 'null' then
      v_txt := v_elem ->> 'product_id';
      if jsonb_typeof(v_elem -> 'product_id') <> 'string' or v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'invalid_product'; end if;
      v_pid := v_txt::uuid;
      select id, name, price into v_prod from products where id = v_pid and profile_id = p_profile_id;
      if not found then raise exception 'product_not_found'; end if;
      v_desc := left(btrim(v_prod.name), 300);
    else
      if jsonb_typeof(v_elem -> 'description') is distinct from 'string' then raise exception 'invalid_description'; end if;
      v_desc := v_elem ->> 'description';
      if char_length(btrim(v_desc)) not between 1 and 300 then raise exception 'invalid_description'; end if;
    end if;
    v_txt := v_elem ->> 'quantity';
    if v_pid is not null then
      if v_txt is null or v_txt !~ '^[0-9]{1,9}$' or v_txt::numeric < 1 then raise exception 'invalid_quantity'; end if;
    elsif v_txt is null or v_txt !~ '^[0-9]{1,9}(\.[0-9]{1,3})?$' then raise exception 'invalid_quantity';
    end if;
    v_qty := v_txt::numeric;
    v_txt := v_elem ->> 'unit_price';
    if v_txt is null and v_pid is not null then
      if v_prod.price is not null then v_txt := v_prod.price::text; end if;
    end if;
    if v_txt is null or v_txt !~ '^[0-9]{1,10}(\.[0-9]{1,3})?$' then raise exception 'invalid_unit_price'; end if;
    v_unit := v_txt::numeric;
    if v_unit <> round(v_unit, v_digits) then raise exception 'amount_too_precise'; end if;
    select * into v_calc from bk_doc_compute_line(v_qty, v_unit, 0, null, v_digits);
    v_total := v_total + v_calc.total;
    v_rows := v_rows || jsonb_build_object('position', v_ord, 'description', v_desc, 'quantity', v_qty, 'unit_price', v_unit, 'gross', v_calc.gross, 'total', v_calc.total, 'product_id', v_pid);
    if char_length(v_summary) < 440 then
      v_txt := v_qty::text;
      if position('.' in v_txt) > 0 then v_txt := trim(trailing '.' from trim(trailing '0' from v_txt)); end if;
      v_summary := v_summary || case when v_summary = '' then '' else ', ' end || left(v_desc, 60) || ' x' || v_txt;
    end if;
  end loop;
  if v_total <= 0 then raise exception 'zero_total'; end if;
  if v_total > 9999999999.999 then raise exception 'amount_too_large'; end if;

  -- 1. stock: only TRACKED products move (an untracked product has no count to invent). A shortage raises and undoes everything.
  for r in select x from unnest(v_rows) as x where x ->> 'product_id' is not null order by (x ->> 'position')::int loop
    if exists (select 1 from bk_stock_settings where product_id = (r ->> 'product_id')::uuid and profile_id = p_profile_id and active) then
      v_mv := inv_adjust_stock(p_profile_id, p_actor_user_id, (r ->> 'product_id')::uuid, 'sold_elsewhere', (r ->> 'quantity')::int, 'Recorded sale', null, null, null, null,
                               md5(p_client_request_id::text || ':' || (r ->> 'position'))::uuid);
      v_moves := v_moves || jsonb_build_array(v_mv -> 'movement');
    end if;
  end loop;

  -- 2. the ONE bookkeeping sale (its description carries product names only, never a customer)
  v_entry := bk_record_entry(p_profile_id, p_actor_user_id, 'sale', v_total, v_sold_on, null, left(v_summary, 500), true, null, null, null, p_client_request_id);
  if (v_entry ->> 'duplicate')::boolean is true then raise exception 'sale_conflict'; end if;
  v_entry_id := (v_entry -> 'entry' ->> 'id')::uuid;

  -- 3. the standalone receipt, issued through the same core as every other document
  insert into bk_documents (profile_id, doc_type, status, locale, currency, customer_snapshot, subtotal, discount_total, tax_total, total, notes,
                            source_type, source_id, client_request_id, created_by)
  values (p_profile_id, 'receipt', 'draft', p_locale, v_currency, v_customer, v_total, 0, 0, v_total, bk_doc_blank_null(p_notes),
          'sale', v_entry_id, p_client_request_id, p_actor_user_id)
  returning * into v_receipt;
  insert into bk_document_lines (document_id, position, description, quantity, unit_price, gross_amount, discount_amount, tax_amount, line_total, product_id)
  select v_receipt.id, (x ->> 'position')::int, x ->> 'description', (x ->> 'quantity')::numeric, (x ->> 'unit_price')::numeric, (x ->> 'gross')::numeric, 0, 0,
         (x ->> 'total')::numeric, nullif(x ->> 'product_id', '')::uuid
    from unnest(v_rows) as x;
  v_receipt := bk_doc_issue_core(v_receipt, p_actor_user_id, bk_doc_seller_snapshot(p_profile_id),
    jsonb_build_object('kind', 'sale', 'method', p_method, 'paid_on', v_sold_on, 'amount', v_total, 'entry_id', v_entry_id), null);

  -- 4. the optional customer
  if p_customer_id is not null then
    insert into bk_document_customer_links (document_id, profile_id, customer_id, linked_by) values (v_receipt.id, p_profile_id, p_customer_id, p_actor_user_id);
  end if;

  return bk_doc_bundle(v_receipt.id) || jsonb_build_object('duplicate', false, 'entry_id', v_entry_id, 'movements', v_moves);
end $$;

revoke all on function sale_record(uuid, uuid, text, jsonb, uuid, text, date, text, uuid) from public, anon, authenticated, service_role;
grant execute on function sale_record(uuid, uuid, text, jsonb, uuid, text, date, text, uuid) to service_role;

alter table bk_customers drop column if exists address;

commit;
