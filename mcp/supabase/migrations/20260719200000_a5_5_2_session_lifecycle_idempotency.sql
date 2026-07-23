create or replace function public.mcp_idempotent_open_route_session(
  p_route_id text,
  p_session_date date,
  p_owner text,
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
  v_session_id text;
  v_payload jsonb := jsonb_build_object(
    'routeId', p_route_id,
    'sessionDate', p_session_date,
    'owner', p_owner
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'route-session.open',
    'POST',
    '/api/mcp-day/open-session',
    'open_session',
    'route_session',
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

  v_data := public.mcp_open_route_session(
    p_route_id => p_route_id,
    p_session_date => p_session_date,
    p_owner => p_owner
  );

  v_session_id := v_data #>> '{session,id}';
  if nullif(btrim(coalesce(v_session_id, '')), '') is null then
    raise exception 'route_session_open_result_invalid' using errcode = 'P0001';
  end if;

  update public.mcp_route_sessions as row
     set raw_payload = jsonb_set(
       coalesce(row.raw_payload, '{}'::jsonb),
       '{foundation_context}',
       coalesce(p_context, '{}'::jsonb),
       true
     )
   where row.id = v_session_id;

  if not found then
    raise exception 'route_session_not_found' using errcode = 'P0002';
  end if;

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    v_session_id
  );
end;
$function$;

create or replace function public.mcp_idempotent_set_session_customer_status(
  p_session_customer_id text,
  p_visit_status text,
  p_status_reason text,
  p_note text,
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
  v_session_customer_id text;
  v_visit_id text;
  v_payload jsonb := jsonb_build_object(
    'sessionCustomerId', p_session_customer_id,
    'visitStatus', p_visit_status,
    'statusReason', p_status_reason,
    'note', p_note
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'session-customer.status.update',
    'POST',
    '/api/mcp-day/session-customer/status',
    'update_status',
    'session_customer',
    p_session_customer_id,
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

  v_data := public.mcp_set_session_customer_status(
    p_session_customer_id => p_session_customer_id,
    p_visit_status => p_visit_status,
    p_status_reason => p_status_reason,
    p_note => p_note
  );

  v_session_customer_id := coalesce(v_data ->> 'sessionCustomerId', p_session_customer_id);
  v_visit_id := v_data ->> 'visitId';

  update public.mcp_session_customers as row
     set raw_payload = jsonb_set(
       coalesce(row.raw_payload, '{}'::jsonb),
       '{foundation_context}',
       coalesce(p_context, '{}'::jsonb),
       true
     )
   where row.id = v_session_customer_id;

  if not found then
    raise exception 'session_customer_not_found' using errcode = 'P0002';
  end if;

  if nullif(btrim(coalesce(v_visit_id, '')), '') is not null then
    update public.mcp_visits as row
       set raw_payload = jsonb_set(
         coalesce(row.raw_payload, '{}'::jsonb),
         '{foundation_context}',
         coalesce(p_context, '{}'::jsonb),
         true
       )
     where row.id = v_visit_id;
  end if;

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    v_session_customer_id
  );
end;
$function$;

create or replace function public.mcp_idempotent_update_route_session(
  p_session_id text,
  p_session_date date,
  p_status text,
  p_note text,
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
  v_snapshot_id text;
  v_payload jsonb := jsonb_build_object(
    'sessionId', p_session_id,
    'sessionDate', p_session_date,
    'status', p_status,
    'note', p_note
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'route-session.update',
    'PATCH',
    '/api/mcp-sessions/:id',
    'update_session',
    'route_session',
    p_session_id,
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

  v_data := public.mcp_update_route_session(
    p_session_id => p_session_id,
    p_session_date => p_session_date,
    p_status => p_status,
    p_note => p_note
  );

  update public.mcp_route_sessions as row
     set raw_payload = jsonb_set(
       coalesce(row.raw_payload, '{}'::jsonb),
       '{foundation_context}',
       coalesce(p_context, '{}'::jsonb),
       true
     )
   where row.id = p_session_id;

  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;

  v_snapshot_id := v_data #>> '{snapshot,id}';
  if nullif(btrim(coalesce(v_snapshot_id, '')), '') is not null then
    update public.mcp_session_reports as row
       set raw_payload = jsonb_set(
         coalesce(row.raw_payload, '{}'::jsonb),
         '{foundation_context}',
         coalesce(p_context, '{}'::jsonb),
         true
       )
     where row.id = v_snapshot_id;
  end if;

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    p_session_id
  );
end;
$function$;

create or replace function public.mcp_idempotent_delete_empty_route_session(
  p_session_id text,
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
    'sessionId', p_session_id
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'route-session.delete-empty',
    'DELETE',
    '/api/mcp-sessions/:id',
    'delete_empty_session',
    'route_session',
    p_session_id,
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

  v_data := public.mcp_delete_empty_route_session(
    p_session_id => p_session_id
  );

  if coalesce((v_data ->> 'deleted')::boolean, false) is not true then
    raise exception 'session_delete_not_applied' using errcode = 'P0001';
  end if;

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    p_session_id
  );
end;
$function$;

revoke execute on function public.mcp_idempotent_open_route_session(text, date, text, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_open_route_session(text, date, text, jsonb) to service_role;

revoke execute on function public.mcp_idempotent_set_session_customer_status(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_set_session_customer_status(text, text, text, text, jsonb) to service_role;

revoke execute on function public.mcp_idempotent_update_route_session(text, date, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_update_route_session(text, date, text, text, jsonb) to service_role;

revoke execute on function public.mcp_idempotent_delete_empty_route_session(text, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_delete_empty_route_session(text, jsonb) to service_role;
