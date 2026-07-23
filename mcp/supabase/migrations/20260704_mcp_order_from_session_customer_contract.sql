-- MCP-6 Order contract: create a real order from a MCP session customer.
-- Inputs:
-- - p_session_customer_id: selected mcp_session_customers.id.
-- - p_items: JSON array with productName/product_name, quantity, unitPrice/unit_price, discount, unit, sku, note.
-- - p_note: order/visit note.
-- - p_status: order status, defaults to confirmed.
--
-- Output:
-- - inserts orders + order_items.
-- - creates or updates mcp_visits.
-- - links order_id into mcp_visits and mcp_session_customers.
-- - recalculates MCP session counters.

create or replace function public.mcp_create_order_from_session_customer(
  p_session_customer_id text,
  p_items jsonb,
  p_note text default null,
  p_status text default 'confirmed'
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  sc record;
  sess record;
  v_order_id text;
  v_order_code text;
  v_visit_id text;
  now_ts timestamptz := now();
  item jsonb;
  qty numeric;
  unit_price numeric;
  discount numeric;
  line_total numeric;
  subtotal numeric := 0;
  discount_total numeric := 0;
  item_count integer := 0;
begin
  if p_session_customer_id is null or length(trim(p_session_customer_id)) = 0 then
    raise exception 'session_customer_id_required' using errcode = '23514';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'order_items_required' using errcode = '23514';
  end if;

  select * into sc
    from public.mcp_session_customers
   where id = p_session_customer_id;

  if sc.id is null then
    raise exception 'session_customer_not_found' using errcode = '23503';
  end if;

  select * into sess
    from public.mcp_route_sessions
   where id = sc.session_id;

  if sess.id is null then
    raise exception 'session_not_found' using errcode = '23503';
  end if;

  v_order_id := 'order_' || replace(gen_random_uuid()::text, '-', '');
  v_order_code := 'MCP-' || to_char(sess.session_date, 'YYYYMMDD') || '-' || substr(v_order_id, 7, 6);

  for item in select value from jsonb_array_elements(p_items) loop
    if length(trim(coalesce(item ->> 'productName', item ->> 'product_name', ''))) = 0 then
      raise exception 'product_name_required' using errcode = '23514';
    end if;

    qty := greatest(coalesce(nullif(item ->> 'quantity', '')::numeric, 0), 0);
    unit_price := greatest(coalesce(nullif(item ->> 'unitPrice', '')::numeric, nullif(item ->> 'unit_price', '')::numeric, 0), 0);
    discount := greatest(coalesce(nullif(item ->> 'discount', '')::numeric, 0), 0);
    subtotal := subtotal + qty * unit_price;
    discount_total := discount_total + discount;
    item_count := item_count + 1;
  end loop;

  insert into public.orders (
    id, order_code, order_date, sales, customer_id, customer_name, customer_phone, area,
    delivery_address, source_type, source_id, status, subtotal, discount_total, grand_total,
    note, sync_status, raw_payload, created_at, updated_at
  ) values (
    v_order_id, v_order_code, sess.session_date, sess.sales, sc.customer_id, sc.customer_name, sc.phone, sc.area,
    sc.address, 'mcp_session_customer', sc.id, coalesce(nullif(p_status, ''), 'confirmed'), subtotal, discount_total, greatest(subtotal - discount_total, 0),
    p_note, 'synced', jsonb_build_object('source', 'mcp_create_order_from_session_customer', 'session_id', sc.session_id, 'session_customer_id', sc.id, 'route_id', sc.route_id), now_ts, now_ts
  );

  for item in select value from jsonb_array_elements(p_items) loop
    qty := greatest(coalesce(nullif(item ->> 'quantity', '')::numeric, 0), 0);
    unit_price := greatest(coalesce(nullif(item ->> 'unitPrice', '')::numeric, nullif(item ->> 'unit_price', '')::numeric, 0), 0);
    discount := greatest(coalesce(nullif(item ->> 'discount', '')::numeric, 0), 0);
    line_total := greatest(qty * unit_price - discount, 0);

    insert into public.order_items (
      id, order_id, product_id, product_name, sku, unit, quantity, unit_price, discount, line_total, note, raw_payload, created_at
    ) values (
      'order_item_' || replace(gen_random_uuid()::text, '-', ''),
      v_order_id,
      nullif(coalesce(item ->> 'productId', item ->> 'product_id'), ''),
      coalesce(item ->> 'productName', item ->> 'product_name'),
      nullif(item ->> 'sku', ''),
      nullif(item ->> 'unit', ''),
      qty,
      unit_price,
      discount,
      line_total,
      nullif(item ->> 'note', ''),
      item,
      now_ts
    );
  end loop;

  if sc.visit_id is not null then
    update public.mcp_visits
       set has_order = true,
           order_id = v_order_id,
           status = 'visited',
           note = coalesce(nullif(p_note, ''), note, 'Tạo đơn từ MCP'),
           updated_at = now_ts
     where id = sc.visit_id
     returning id into v_visit_id;
  end if;

  if v_visit_id is null then
    insert into public.mcp_visits (
      id, session_id, route_id, route_customer_id, visit_date, status, has_order, has_test, has_report,
      order_id, checkin_at, note, raw_payload, created_at, updated_at
    ) values (
      'mcv_' || replace(gen_random_uuid()::text, '-', ''),
      sc.session_id, sc.route_id, sc.route_customer_id, sess.session_date, 'visited', true, false, false,
      v_order_id, now_ts, coalesce(nullif(p_note, ''), 'Tạo đơn từ MCP'),
      jsonb_build_object('source', 'mcp_create_order_from_session_customer', 'session_customer_id', sc.id, 'order_id', v_order_id), now_ts, now_ts
    ) returning id into v_visit_id;
  end if;

  update public.mcp_session_customers
     set visit_status = 'visited',
         status_reason = null,
         visit_id = v_visit_id,
         order_id = v_order_id,
         note = coalesce(nullif(p_note, ''), note),
         updated_at = now_ts
   where id = sc.id;

  perform public.mcp_recalc_route_session_counters(sc.session_id);

  return jsonb_build_object(
    'orderId', v_order_id,
    'orderCode', v_order_code,
    'sessionCustomerId', sc.id,
    'visitId', v_visit_id,
    'subtotal', subtotal,
    'discountTotal', discount_total,
    'grandTotal', greatest(subtotal - discount_total, 0),
    'itemCount', item_count
  );
end;
$$;
