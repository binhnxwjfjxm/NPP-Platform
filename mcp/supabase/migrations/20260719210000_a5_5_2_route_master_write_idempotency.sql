create or replace function public.mcp_idempotent_create_route(
  p_route_name text,
  p_area text,
  p_weekday integer,
  p_note text,
  p_distributor_id text,
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
  v_route_id text;
  v_payload jsonb := jsonb_build_object(
    'routeName', p_route_name,
    'area', p_area,
    'weekday', p_weekday,
    'note', p_note,
    'distributorId', p_distributor_id
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'route.create',
    'POST',
    '/api/routes',
    'create_route',
    'route',
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

  v_data := public.mcp_create_route(
    p_route_name => p_route_name,
    p_area => p_area,
    p_weekday => p_weekday,
    p_note => p_note,
    p_distributor_id => p_distributor_id
  );

  v_route_id := coalesce(v_data ->> 'routeId', v_data ->> 'id');
  if nullif(btrim(coalesce(v_route_id, '')), '') is null then
    raise exception 'route_create_result_invalid' using errcode = 'P0001';
  end if;

  update public.mcp_routes as row
     set raw_payload = jsonb_set(
       coalesce(row.raw_payload, '{}'::jsonb),
       '{foundation_context}',
       coalesce(p_context, '{}'::jsonb),
       true
     )
   where row.id = v_route_id;

  if not found then
    raise exception 'route_not_found' using errcode = 'P0002';
  end if;

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    v_route_id
  );
end;
$function$;

create or replace function public.mcp_idempotent_update_route(
  p_route_id text,
  p_route_name text,
  p_area text,
  p_weekday integer,
  p_note text,
  p_active boolean,
  p_distributor_id text,
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
    'routeId', p_route_id,
    'routeName', p_route_name,
    'area', p_area,
    'weekday', p_weekday,
    'note', p_note,
    'active', p_active,
    'distributorId', p_distributor_id
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'route.update',
    'PATCH',
    '/api/routes/:id',
    'update_route',
    'route',
    p_route_id,
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

  v_data := public.mcp_update_route(
    p_route_id => p_route_id,
    p_route_name => p_route_name,
    p_area => p_area,
    p_weekday => p_weekday,
    p_note => p_note,
    p_active => p_active,
    p_distributor_id => p_distributor_id
  );

  update public.mcp_routes as row
     set raw_payload = jsonb_set(
       coalesce(row.raw_payload, '{}'::jsonb),
       '{foundation_context}',
       coalesce(p_context, '{}'::jsonb),
       true
     )
   where row.id = p_route_id;

  if not found then
    raise exception 'route_not_found' using errcode = 'P0002';
  end if;

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    p_route_id
  );
end;
$function$;

revoke execute on function public.mcp_idempotent_create_route(text, text, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_create_route(text, text, integer, text, text, jsonb) to service_role;

revoke execute on function public.mcp_idempotent_update_route(text, text, text, integer, text, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_update_route(text, text, text, integer, text, boolean, text, jsonb) to service_role;
