-- Add a route-master customer and, only by explicit caller choice, resolve the
-- same customer into one exact mutable route session in a single transaction.

create or replace function public.mcp_idempotent_add_route_customer(
  p_route_id text,
  p_customer_name text,
  p_phone text,
  p_area text,
  p_address text,
  p_sort_order integer,
  p_note text,
  p_customer_id text,
  p_geo_lat double precision,
  p_geo_lng double precision,
  p_geo_accuracy double precision,
  p_geo_source text,
  p_google_maps_url text,
  p_include_active_session boolean,
  p_active_session_id text,
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
  v_payload jsonb;
  v_route public.mcp_routes%rowtype;
  v_session public.mcp_route_sessions%rowtype;
  v_route_customer public.mcp_route_customers%rowtype;
  v_session_customer public.mcp_session_customers%rowtype;
  v_route_id text := nullif(btrim(coalesce(p_route_id, '')), '');
  v_customer_name text := nullif(btrim(coalesce(p_customer_name, '')), '');
  v_customer_id text := nullif(btrim(coalesce(p_customer_id, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_phone_digits text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]+', '', 'g'), '');
  v_area text := nullif(btrim(coalesce(p_area, '')), '');
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_active_session_id text := nullif(btrim(coalesce(p_active_session_id, '')), '');
  v_include_active_session boolean := coalesce(p_include_active_session, false);
  v_route_sort_order integer;
  v_session_sort_order integer;
  v_route_customer_created boolean := false;
  v_session_customer_created boolean := false;
  v_now timestamptz := now();
begin
  if v_route_id is null then
    raise exception 'route_id_required' using errcode = '23514';
  end if;
  if v_customer_name is null then
    raise exception 'customer_name_required' using errcode = '23514';
  end if;
  if v_include_active_session and v_active_session_id is null then
    raise exception 'active_session_id_required' using errcode = '23514';
  end if;
  if p_sort_order is not null and p_sort_order < 0 then
    raise exception 'invalid_sort_order' using errcode = '23514';
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

  v_payload := jsonb_build_object(
    'routeId', v_route_id,
    'customerName', v_customer_name,
    'phone', v_phone,
    'area', v_area,
    'address', v_address,
    'sortOrder', p_sort_order,
    'note', v_note,
    'customerId', v_customer_id,
    'geoLat', p_geo_lat,
    'geoLng', p_geo_lng,
    'geoAccuracy', p_geo_accuracy,
    'geoSource', nullif(btrim(coalesce(p_geo_source, '')), ''),
    'googleMapsUrl', nullif(btrim(coalesce(p_google_maps_url, '')), ''),
    'includeActiveSession', v_include_active_session,
    'activeSessionId', case when v_include_active_session then v_active_session_id else null end
  );

  v_claim := public.mcp_idempotency_begin(
    'route-customer.add',
    'POST',
    '/api/route-customers',
    'add_customer',
    'route_customer',
    null,
    v_payload,
    p_context,
    30
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

  -- Match the existing session-add flow lock order: session first, then route.
  -- This prevents a route->session / session->route deadlock between the two flows.
  if v_include_active_session then
    select * into v_session
      from public.mcp_route_sessions
     where id = v_active_session_id
     for update;

    if not found then
      raise exception 'active_session_not_found' using errcode = '23503';
    end if;
    if v_session.route_id is distinct from v_route_id then
      raise exception 'active_session_route_mismatch' using errcode = '23514';
    end if;
    if lower(coalesce(v_session.status, 'active')) in ('done', 'completed', 'cancelled', 'closed') then
      raise exception 'session_closed_read_only' using errcode = '23514';
    end if;

    perform public.mcp_assert_session_mutable(v_session.id);
  end if;

  select * into v_route
    from public.mcp_routes
   where id = v_route_id
   for update;

  if not found then
    raise exception 'route_not_found' using errcode = '23503';
  end if;

  -- Resolve the logical route customer while the route row serializes all
  -- concurrent add attempts for this route.
  if v_customer_id is not null then
    select * into v_route_customer
      from public.mcp_route_customers
     where route_id = v_route.id
       and customer_id = v_customer_id
     order by coalesce(active, true) desc, updated_at desc nulls last
     for update
     limit 1;
  end if;

  if v_route_customer.id is null and v_phone_digits is not null then
    select * into v_route_customer
      from public.mcp_route_customers
     where route_id = v_route.id
       and nullif(regexp_replace(coalesce(phone, ''), '[^0-9]+', '', 'g'), '') = v_phone_digits
     order by coalesce(active, true) desc, updated_at desc nulls last
     for update
     limit 1;
  end if;

  if v_route_customer.id is null then
    select * into v_route_customer
      from public.mcp_route_customers
     where route_id = v_route.id
       and lower(btrim(customer_name)) = lower(v_customer_name)
       and (
         (v_address is not null and lower(btrim(coalesce(address, ''))) = lower(v_address))
         or
         (v_address is null and lower(btrim(coalesce(area, ''))) = lower(btrim(coalesce(v_area, v_route.area, ''))))
       )
     order by coalesce(active, true) desc, updated_at desc nulls last
     for update
     limit 1;
  end if;

  if v_route_customer.id is null then
    if coalesce(p_sort_order, 0) > 0 then
      v_route_sort_order := p_sort_order;
    else
      select coalesce(max(sort_order), 0) + 1
        into v_route_sort_order
        from public.mcp_route_customers
       where route_id = v_route.id;
    end if;

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
      geo_source,
      geo_captured_at,
      google_maps_url,
      raw_payload,
      created_at,
      updated_at
    ) values (
      'mrc_' || replace(gen_random_uuid()::text, '-', ''),
      v_route.id,
      v_customer_id,
      v_customer_name,
      v_phone,
      coalesce(v_area, v_route.area),
      v_address,
      v_route_sort_order,
      true,
      v_note,
      p_geo_lat,
      p_geo_lng,
      p_geo_accuracy,
      nullif(btrim(coalesce(p_geo_source, '')), ''),
      case when p_geo_lat is not null and p_geo_lng is not null then v_now else null end,
      nullif(btrim(coalesce(p_google_maps_url, '')), ''),
      jsonb_build_object(
        'source', 'route_customer_explicit_sync',
        'foundation_context', coalesce(p_context, '{}'::jsonb)
      ),
      v_now,
      v_now
    )
    returning * into v_route_customer;

    v_route_customer_created := true;
  end if;

  if v_include_active_session then
    select * into v_session_customer
      from public.mcp_session_customers
     where session_id = v_session.id
       and route_customer_id = v_route_customer.id
     for update;

    if v_session_customer.id is null then
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
        v_route.id,
        v_route_customer.id,
        v_route_customer.customer_id,
        v_route_customer.customer_name,
        v_route_customer.phone,
        coalesce(v_route_customer.area, v_session.area, v_route.area),
        v_route_customer.address,
        v_session_sort_order,
        'added',
        'added',
        'pending',
        coalesce(v_note, 'Thêm từ tuyến cố định vào phiên đang chạy'),
        jsonb_build_object(
          'source', 'route_customer_explicit_sync',
          'session_id', v_session.id,
          'route_customer_id', v_route_customer.id,
          'foundation_context', coalesce(p_context, '{}'::jsonb)
        ),
        v_now,
        v_now
      )
      returning * into v_session_customer;

      v_session_customer_created := true;
      perform public.mcp_recalc_route_session_counters(v_session.id);
    end if;
  end if;

  v_data := jsonb_build_object(
    'routeCustomerId', v_route_customer.id,
    'sessionCustomerId', case when v_include_active_session then v_session_customer.id else null end,
    'activeSessionId', case when v_include_active_session then v_session.id else null end,
    'includedActiveSession', v_include_active_session,
    'createdRouteCustomer', v_route_customer_created,
    'createdSessionCustomer', v_session_customer_created,
    'reusedRouteCustomer', not v_route_customer_created,
    'reusedSessionCustomer', v_include_active_session and not v_session_customer_created
  );

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    v_route_customer.id
  );
end;
$function$;

revoke all on function public.mcp_idempotent_add_route_customer(
  text, text, text, text, text, integer, text, text,
  double precision, double precision, double precision, text, text,
  boolean, text, jsonb
) from public, anon, authenticated;

grant execute on function public.mcp_idempotent_add_route_customer(
  text, text, text, text, text, integer, text, text,
  double precision, double precision, double precision, text, text,
  boolean, text, jsonb
) to service_role;

comment on function public.mcp_idempotent_add_route_customer(
  text, text, text, text, text, integer, text, text,
  double precision, double precision, double precision, text, text,
  boolean, text, jsonb
) is 'Idempotently adds or resolves one route customer and optionally one exact mutable active-session snapshot; service-role only.';