-- Customers created while running an MCP session may capture the actual outlet
-- position. Keep the existing RPC parameter names and append optional GPS fields
-- so callers that do not send location continue to work during rollout.

drop function if exists public.mcp_add_session_customer(
  text, text, text, text, text, text, text, text, jsonb
);

create or replace function public.mcp_add_session_customer(
  p_session_id text,
  p_customer_name text,
  p_route_customer_id text default null,
  p_customer_id text default null,
  p_phone text default null,
  p_area text default null,
  p_address text default null,
  p_note text default null,
  p_context jsonb default '{}'::jsonb,
  p_geo_lat double precision default null,
  p_geo_lng double precision default null,
  p_geo_accuracy double precision default null,
  p_geo_source text default null,
  p_google_maps_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_session public.mcp_route_sessions%rowtype;
  v_route public.mcp_routes%rowtype;
  v_route_customer public.mcp_route_customers%rowtype;
  v_sc public.mcp_session_customers%rowtype;
  v_existing public.mcp_session_customers%rowtype;
  v_route_customer_id text := nullif(btrim(coalesce(p_route_customer_id, '')), '');
  v_customer_id text := nullif(btrim(coalesce(p_customer_id, '')), '');
  v_customer_name text := nullif(btrim(coalesce(p_customer_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_phone_digits text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]+', '', 'g'), '');
  v_area text := nullif(btrim(coalesce(p_area, '')), '');
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_geo_source text := nullif(btrim(coalesce(p_geo_source, '')), '');
  v_google_maps_url text := nullif(btrim(coalesce(p_google_maps_url, '')), '');
  v_route_sort_order integer := 1;
  v_session_sort_order integer := 1;
  v_snapshot_count integer := 0;
  v_route_customer_created boolean := false;
  v_route_customer_reactivated boolean := false;
  v_now timestamptz := now();
begin
  if nullif(btrim(coalesce(p_session_id, '')), '') is null then
    raise exception 'session_id_required' using errcode = '23514';
  end if;

  if v_customer_name is null then
    raise exception 'customer_name_required' using errcode = '23514';
  end if;

  if (p_geo_lat is null) <> (p_geo_lng is null) then
    raise exception 'geo_coordinates_incomplete' using errcode = '23514';
  end if;

  if p_geo_lat is not null and (p_geo_lat < -90 or p_geo_lat > 90) then
    raise exception 'invalid_geo_lat' using errcode = '23514';
  end if;

  if p_geo_lng is not null and (p_geo_lng < -180 or p_geo_lng > 180) then
    raise exception 'invalid_geo_lng' using errcode = '23514';
  end if;

  if p_geo_accuracy is not null and p_geo_accuracy < 0 then
    raise exception 'invalid_geo_accuracy' using errcode = '23514';
  end if;

  if p_geo_lat is not null and p_geo_lng is not null then
    v_geo_source := coalesce(v_geo_source, 'browser');
    v_google_maps_url := coalesce(
      v_google_maps_url,
      'https://www.google.com/maps/search/?api=1&query=' || p_geo_lat::text || ',' || p_geo_lng::text
    );
  end if;

  -- The session row serializes snapshot insertion and protects sort order.
  select * into v_session
    from public.mcp_route_sessions
   where id = p_session_id
   for update;

  if not found then
    raise exception 'session_not_found' using errcode = '23503';
  end if;

  perform public.mcp_assert_session_mutable(v_session.id);

  -- The route row serializes route-customer matching/creation for this flow.
  select * into v_route
    from public.mcp_routes
   where id = v_session.route_id
   for update;

  if not found then
    raise exception 'route_not_found' using errcode = '23503';
  end if;

  if v_route_customer_id is not null then
    select * into v_route_customer
      from public.mcp_route_customers
     where id = v_route_customer_id
     for update;

    if not found then
      raise exception 'route_customer_not_found' using errcode = '23503';
    end if;

    if v_route_customer.route_id is distinct from v_session.route_id then
      raise exception 'route_customer_route_mismatch' using errcode = '23514';
    end if;
  else
    -- Prefer a phone match. Formatting differences do not create duplicates.
    if v_phone_digits is not null then
      select * into v_route_customer
        from public.mcp_route_customers
       where route_id = v_session.route_id
         and nullif(regexp_replace(coalesce(phone, ''), '[^0-9]+', '', 'g'), '') = v_phone_digits
       order by coalesce(active, true) desc, updated_at desc nulls last
       for update
       limit 1;
    end if;

    -- Without a phone, use exact normalized name plus address, or name plus area.
    if v_route_customer.id is null then
      select * into v_route_customer
        from public.mcp_route_customers
       where route_id = v_session.route_id
         and lower(btrim(customer_name)) = lower(v_customer_name)
         and (
           (v_address is not null and lower(btrim(coalesce(address, ''))) = lower(v_address))
           or
           (v_address is null and lower(btrim(coalesce(area, ''))) = lower(btrim(coalesce(v_area, v_session.area, ''))))
         )
       order by coalesce(active, true) desc, updated_at desc nulls last
       for update
       limit 1;
    end if;
  end if;

  if v_route_customer.id is not null then
    v_route_customer_reactivated := coalesce(v_route_customer.active, false) is false;

    update public.mcp_route_customers
       set customer_id = coalesce(v_customer_id, customer_id),
           customer_name = v_customer_name,
           phone = coalesce(v_phone, phone),
           area = coalesce(v_area, area, v_session.area),
           address = coalesce(v_address, address),
           active = true,
           note = coalesce(v_note, note),
           geo_lat = case when p_geo_lat is not null then p_geo_lat else geo_lat end,
           geo_lng = case when p_geo_lng is not null then p_geo_lng else geo_lng end,
           geo_accuracy = case when p_geo_lat is not null then p_geo_accuracy else geo_accuracy end,
           geo_captured_at = case when p_geo_lat is not null then v_now else geo_captured_at end,
           geo_source = case when p_geo_lat is not null then v_geo_source else geo_source end,
           google_maps_url = coalesce(v_google_maps_url, google_maps_url),
           raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object(
             'last_source', 'mcp_add_session_customer',
             'last_session_id', v_session.id,
             'location_captured', p_geo_lat is not null,
             'foundation_context', coalesce(p_context, '{}'::jsonb)
           ),
           updated_at = v_now
     where id = v_route_customer.id
     returning * into v_route_customer;
  else
    select coalesce(max(sort_order), 0) + 1
      into v_route_sort_order
      from public.mcp_route_customers
     where route_id = v_session.route_id;

    insert into public.mcp_route_customers (
      id,
      route_id,
      customer_id,
      customer_name,
      phone,
      area,
      address,
      sort_order,
      active,
      note,
      geo_lat,
      geo_lng,
      geo_accuracy,
      geo_captured_at,
      geo_source,
      google_maps_url,
      raw_payload,
      created_at,
      updated_at
    ) values (
      'mrc_' || replace(gen_random_uuid()::text, '-', ''),
      v_session.route_id,
      v_customer_id,
      v_customer_name,
      v_phone,
      coalesce(v_area, v_session.area),
      v_address,
      v_route_sort_order,
      true,
      coalesce(v_note, 'Thêm trực tiếp từ phiên đi tuyến'),
      p_geo_lat,
      p_geo_lng,
      p_geo_accuracy,
      case when p_geo_lat is not null then v_now else null end,
      case when p_geo_lat is not null then v_geo_source else null end,
      v_google_maps_url,
      jsonb_build_object(
        'source', 'mcp_add_session_customer',
        'created_from_session_id', v_session.id,
        'location_captured', p_geo_lat is not null,
        'foundation_context', coalesce(p_context, '{}'::jsonb)
      ),
      v_now,
      v_now
    )
    returning * into v_route_customer;

    v_route_customer_created := true;
  end if;

  v_route_customer_id := v_route_customer.id;

  -- A retry reuses the route customer and the existing session snapshot.
  select * into v_existing
    from public.mcp_session_customers
   where session_id = v_session.id
     and route_customer_id = v_route_customer_id;

  if v_existing.id is not null then
    perform public.mcp_recalc_route_session_counters(v_session.id);
    select * into v_session from public.mcp_route_sessions where id = v_session.id;
    select count(*)::integer into v_snapshot_count
      from public.mcp_session_customers
     where session_id = v_session.id;

    return jsonb_build_object(
      'routeCustomer', to_jsonb(v_route_customer),
      'sessionCustomer', to_jsonb(v_existing),
      'created', false,
      'createdSessionCustomer', false,
      'createdRouteCustomer', v_route_customer_created,
      'reactivatedRouteCustomer', v_route_customer_reactivated,
      'counters', jsonb_build_object(
        'session', to_jsonb(v_session),
        'snapshotCount', v_snapshot_count,
        'visitedCount', coalesce(v_session.visited_customers, 0),
        'orderCount', coalesce(v_session.order_count, 0),
        'testCount', coalesce(v_session.test_count, 0),
        'reportCount', coalesce(v_session.report_count, 0),
        'followupCount', coalesce(v_session.followup_count, 0)
      )
    );
  end if;

  select coalesce(max(sort_order), 0) + 1
    into v_session_sort_order
    from public.mcp_session_customers
   where session_id = v_session.id;

  insert into public.mcp_session_customers (
    id,
    session_id,
    route_id,
    route_customer_id,
    customer_id,
    customer_name,
    phone,
    area,
    address,
    sort_order,
    source,
    planned_status,
    visit_status,
    note,
    raw_payload,
    created_at,
    updated_at
  ) values (
    'msc_' || replace(gen_random_uuid()::text, '-', ''),
    v_session.id,
    v_session.route_id,
    v_route_customer.id,
    v_route_customer.customer_id,
    v_route_customer.customer_name,
    v_route_customer.phone,
    coalesce(v_route_customer.area, v_session.area),
    v_route_customer.address,
    v_session_sort_order,
    'added',
    'added',
    'pending',
    coalesce(v_note, 'Khách thêm trực tiếp trong phiên'),
    jsonb_build_object(
      'source', 'mcp_add_session_customer',
      'session_id', v_session.id,
      'route_customer_id', v_route_customer.id,
      'created_route_customer', v_route_customer_created,
      'location_captured', p_geo_lat is not null,
      'foundation_context', coalesce(p_context, '{}'::jsonb)
    ),
    v_now,
    v_now
  )
  returning * into v_sc;

  perform public.mcp_recalc_route_session_counters(v_session.id);

  select * into v_session
    from public.mcp_route_sessions
   where id = v_session.id;

  select count(*)::integer into v_snapshot_count
    from public.mcp_session_customers
   where session_id = v_session.id;

  return jsonb_build_object(
    'routeCustomer', to_jsonb(v_route_customer),
    'sessionCustomer', to_jsonb(v_sc),
    'created', true,
    'createdSessionCustomer', true,
    'createdRouteCustomer', v_route_customer_created,
    'reactivatedRouteCustomer', v_route_customer_reactivated,
    'counters', jsonb_build_object(
      'session', to_jsonb(v_session),
      'snapshotCount', v_snapshot_count,
      'visitedCount', coalesce(v_session.visited_customers, 0),
      'orderCount', coalesce(v_session.order_count, 0),
      'testCount', coalesce(v_session.test_count, 0),
      'reportCount', coalesce(v_session.report_count, 0),
      'followupCount', coalesce(v_session.followup_count, 0)
    )
  );
end;
$function$;

revoke all on function public.mcp_add_session_customer(
  text, text, text, text, text, text, text, text, jsonb,
  double precision, double precision, double precision, text, text
) from public, anon, authenticated;

grant execute on function public.mcp_add_session_customer(
  text, text, text, text, text, text, text, text, jsonb,
  double precision, double precision, double precision, text, text
) to service_role;

comment on function public.mcp_add_session_customer(
  text, text, text, text, text, text, text, text, jsonb,
  double precision, double precision, double precision, text, text
) is 'Atomically persists a customer and optional captured GPS to the route master and explicit active session; backend service role only.';
