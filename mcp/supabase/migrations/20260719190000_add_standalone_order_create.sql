create or replace function public.mcp_create_order(
  p_customer_mode text,
  p_route_customer_id text,
  p_customer_name text,
  p_customer_phone text,
  p_area text,
  p_delivery_address text,
  p_sales text,
  p_items jsonb,
  p_note text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_mode text := lower(btrim(coalesce(p_customer_mode, '')));
  v_status text := lower(btrim(coalesce(p_status, 'confirmed')));
  v_customer record;
  v_order_id text := 'order_' || replace(gen_random_uuid()::text, '-', '');
  v_order_code text;
  v_now timestamptz := now();
  v_customer_id text;
  v_customer_name text;
  v_customer_phone text;
  v_area text;
  v_delivery_address text;
  v_route_customer_id text;
  v_route_id text;
  v_route_name text;
  v_sales text := coalesce(nullif(btrim(coalesce(p_sales, '')), ''), 'Sale');
  v_item jsonb;
  v_product_name text;
  v_quantity numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_discount_total numeric := 0;
  v_item_count integer := 0;
begin
  if v_mode not in ('existing', 'manual') then
    raise exception 'invalid_customer_mode' using errcode = '23514';
  end if;

  if v_status not in ('draft', 'confirmed') then
    raise exception 'invalid_order_status' using errcode = '23514';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'order_items_required' using errcode = '23514';
  end if;

  if v_mode = 'existing' then
    if nullif(btrim(coalesce(p_route_customer_id, '')), '') is null then
      raise exception 'route_customer_id_required' using errcode = '23514';
    end if;

    select
      rc.id,
      rc.route_id,
      rc.customer_id,
      rc.customer_name,
      rc.phone,
      rc.area,
      rc.address,
      rc.active,
      r.route_name
    into v_customer
    from public.mcp_route_customers rc
    left join public.mcp_routes r on r.id = rc.route_id
    where rc.id = btrim(p_route_customer_id)
    for share of rc;

    if v_customer.id is null then
      raise exception 'route_customer_not_found' using errcode = '23503';
    end if;
    if v_customer.active is false then
      raise exception 'route_customer_inactive' using errcode = '23514';
    end if;

    v_route_customer_id := v_customer.id;
    v_route_id := v_customer.route_id;
    v_route_name := coalesce(v_customer.route_name, v_customer.area, 'Khách đã có');
    v_customer_id := coalesce(v_customer.customer_id, v_customer.id);
    v_customer_name := v_customer.customer_name;
    v_customer_phone := v_customer.phone;
    v_area := v_customer.area;
    v_delivery_address := v_customer.address;
  else
    v_customer_name := nullif(btrim(coalesce(p_customer_name, '')), '');
    if v_customer_name is null then
      raise exception 'customer_name_required' using errcode = '23514';
    end if;

    v_customer_phone := nullif(btrim(coalesce(p_customer_phone, '')), '');
    v_area := nullif(btrim(coalesce(p_area, '')), '');
    v_delivery_address := nullif(btrim(coalesce(p_delivery_address, '')), '');
    v_route_name := coalesce(v_area, 'Khách nhập nhanh');
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product_name := nullif(btrim(coalesce(v_item ->> 'productName', v_item ->> 'product_name', '')), '');
    if v_product_name is null then
      raise exception 'product_name_required' using errcode = '23514';
    end if;

    begin
      v_quantity := nullif(coalesce(v_item ->> 'quantity', ''), '')::numeric;
      v_unit_price := coalesce(nullif(v_item ->> 'unitPrice', '')::numeric, nullif(v_item ->> 'unit_price', '')::numeric, 0);
      v_discount := coalesce(nullif(v_item ->> 'discount', '')::numeric, 0);
    exception when invalid_text_representation then
      raise exception 'invalid_order_item_number' using errcode = '23514';
    end;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'quantity_required' using errcode = '23514';
    end if;
    if v_unit_price < 0 then
      raise exception 'invalid_unit_price' using errcode = '23514';
    end if;
    if v_discount < 0 or v_discount > v_quantity * v_unit_price then
      raise exception 'invalid_discount' using errcode = '23514';
    end if;

    v_subtotal := v_subtotal + v_quantity * v_unit_price;
    v_discount_total := v_discount_total + v_discount;
    v_item_count := v_item_count + 1;
  end loop;

  v_order_code := 'ORD-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(v_order_id, 7, 6));

  insert into public.orders (
    id,
    order_code,
    order_date,
    sales,
    customer_id,
    customer_name,
    customer_phone,
    area,
    delivery_address,
    source_type,
    source_id,
    status,
    subtotal,
    discount_total,
    grand_total,
    note,
    sync_status,
    raw_payload,
    created_at,
    updated_at
  ) values (
    v_order_id,
    v_order_code,
    current_date,
    v_sales,
    v_customer_id,
    v_customer_name,
    v_customer_phone,
    v_area,
    v_delivery_address,
    'orders_tab',
    v_route_customer_id,
    v_status,
    v_subtotal,
    v_discount_total,
    greatest(v_subtotal - v_discount_total, 0),
    nullif(btrim(coalesce(p_note, '')), ''),
    'synced',
    jsonb_build_object(
      'source', 'mcp_create_order',
      'customerMode', v_mode,
      'routeCustomerId', v_route_customer_id,
      'routeId', v_route_id,
      'routeName', v_route_name
    ),
    v_now,
    v_now
  );

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := nullif(coalesce(v_item ->> 'quantity', ''), '')::numeric;
    v_unit_price := coalesce(nullif(v_item ->> 'unitPrice', '')::numeric, nullif(v_item ->> 'unit_price', '')::numeric, 0);
    v_discount := coalesce(nullif(v_item ->> 'discount', '')::numeric, 0);
    v_line_total := greatest(v_quantity * v_unit_price - v_discount, 0);

    insert into public.order_items (
      id,
      order_id,
      product_id,
      variant_id,
      product_name,
      sku,
      unit,
      quantity,
      unit_price,
      discount,
      line_total,
      note,
      raw_payload,
      created_at
    ) values (
      'order_item_' || replace(gen_random_uuid()::text, '-', ''),
      v_order_id,
      nullif(coalesce(v_item ->> 'productId', v_item ->> 'product_id'), ''),
      nullif(coalesce(v_item ->> 'variantId', v_item ->> 'variant_id'), ''),
      coalesce(v_item ->> 'productName', v_item ->> 'product_name'),
      nullif(v_item ->> 'sku', ''),
      nullif(v_item ->> 'unit', ''),
      v_quantity,
      v_unit_price,
      v_discount,
      v_line_total,
      nullif(v_item ->> 'note', ''),
      v_item,
      v_now
    );
  end loop;

  return jsonb_build_object(
    'orderId', v_order_id,
    'orderCode', v_order_code,
    'orderDate', current_date,
    'customerMode', v_mode,
    'routeCustomerId', v_route_customer_id,
    'customerName', v_customer_name,
    'routeName', v_route_name,
    'owner', v_sales,
    'status', v_status,
    'subtotal', v_subtotal,
    'discountTotal', v_discount_total,
    'grandTotal', greatest(v_subtotal - v_discount_total, 0),
    'itemCount', v_item_count
  );
end;
$function$;

create or replace function public.mcp_idempotent_create_order(
  p_customer_mode text,
  p_route_customer_id text,
  p_customer_name text,
  p_customer_phone text,
  p_area text,
  p_delivery_address text,
  p_sales text,
  p_items jsonb,
  p_note text,
  p_status text,
  p_context jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_claim jsonb;
  v_data jsonb;
  v_payload jsonb := jsonb_build_object(
    'customerMode', p_customer_mode,
    'routeCustomerId', p_route_customer_id,
    'customerName', p_customer_name,
    'customerPhone', p_customer_phone,
    'area', p_area,
    'deliveryAddress', p_delivery_address,
    'sales', p_sales,
    'items', coalesce(p_items, '[]'::jsonb),
    'note', p_note,
    'status', p_status
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'order.create',
    'POST',
    '/api/orders',
    'create_order',
    'order',
    null,
    v_payload,
    p_context,
    60
  );

  if v_claim ->> 'mode' = 'replay' then
    return jsonb_build_object(
      'data', v_claim -> 'responsePayload',
      'meta', jsonb_build_object(
        'idempotency', jsonb_build_object(
          'replayed', true,
          'originalRequestId', v_claim ->> 'originalRequestId'
        )
      )
    );
  end if;

  v_data := public.mcp_create_order(
    p_customer_mode => p_customer_mode,
    p_route_customer_id => p_route_customer_id,
    p_customer_name => p_customer_name,
    p_customer_phone => p_customer_phone,
    p_area => p_area,
    p_delivery_address => p_delivery_address,
    p_sales => p_sales,
    p_items => p_items,
    p_note => p_note,
    p_status => p_status
  );

  update public.orders as row
     set raw_payload = jsonb_set(
       coalesce(row.raw_payload, '{}'::jsonb),
       '{foundation_context}',
       coalesce(p_context, '{}'::jsonb),
       true
     )
   where row.id = v_data ->> 'orderId';

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    201,
    v_data,
    v_data ->> 'orderId'
  );
end;
$function$;

revoke execute on function public.mcp_create_order(text, text, text, text, text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.mcp_create_order(text, text, text, text, text, text, text, jsonb, text, text) to service_role;

revoke execute on function public.mcp_idempotent_create_order(text, text, text, text, text, text, text, jsonb, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_create_order(text, text, text, text, text, text, text, jsonb, text, text, jsonb) to service_role;
