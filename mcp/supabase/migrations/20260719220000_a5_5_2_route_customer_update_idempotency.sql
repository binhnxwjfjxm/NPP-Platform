create or replace function public.mcp_idempotent_update_route_customer(
  p_route_customer_id text,
  p_customer_name text,
  p_phone text,
  p_area text,
  p_address text,
  p_sort_order integer,
  p_note text,
  p_active boolean,
  p_geo_lat double precision,
  p_geo_lng double precision,
  p_geo_accuracy double precision,
  p_geo_source text,
  p_google_maps_url text,
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
    'routeCustomerId', p_route_customer_id,
    'customerName', p_customer_name,
    'phone', p_phone,
    'area', p_area,
    'address', p_address,
    'sortOrder', p_sort_order,
    'note', p_note,
    'active', p_active,
    'geoLat', p_geo_lat,
    'geoLng', p_geo_lng,
    'geoAccuracy', p_geo_accuracy,
    'geoSource', p_geo_source,
    'googleMapsUrl', p_google_maps_url
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'route-customer.update',
    'PATCH',
    '/api/route-customers/:id',
    'update_route_customer',
    'route_customer',
    p_route_customer_id,
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

  v_data := public.mcp_update_route_customer(
    p_route_customer_id => p_route_customer_id,
    p_customer_name => p_customer_name,
    p_phone => p_phone,
    p_area => p_area,
    p_address => p_address,
    p_sort_order => p_sort_order,
    p_note => p_note,
    p_active => p_active,
    p_geo_lat => p_geo_lat,
    p_geo_lng => p_geo_lng,
    p_geo_accuracy => p_geo_accuracy,
    p_geo_source => p_geo_source,
    p_google_maps_url => p_google_maps_url
  );

  update public.mcp_route_customers as row
     set raw_payload = jsonb_set(
       coalesce(row.raw_payload, '{}'::jsonb),
       '{foundation_context}',
       coalesce(p_context, '{}'::jsonb),
       true
     )
   where row.id = p_route_customer_id;

  if not found then
    raise exception 'route_customer_not_found' using errcode = 'P0002';
  end if;

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    p_route_customer_id
  );
end;
$function$;

revoke execute on function public.mcp_idempotent_update_route_customer(
  text,
  text,
  text,
  text,
  text,
  integer,
  text,
  boolean,
  double precision,
  double precision,
  double precision,
  text,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.mcp_idempotent_update_route_customer(
  text,
  text,
  text,
  text,
  text,
  integer,
  text,
  boolean,
  double precision,
  double precision,
  double precision,
  text,
  text,
  jsonb
) to service_role;
