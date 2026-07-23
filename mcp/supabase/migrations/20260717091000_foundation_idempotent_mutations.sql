create or replace function public.mcp_idempotent_record_session_customer_result(
  p_session_customer_id text,
  p_result_type text,
  p_note text,
  p_order_id text,
  p_test_id text,
  p_report_id text,
  p_has_order boolean,
  p_has_test boolean,
  p_has_report boolean,
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
    'sessionCustomerId', p_session_customer_id,
    'resultType', p_result_type,
    'note', p_note,
    'orderId', p_order_id,
    'testId', p_test_id,
    'reportId', p_report_id,
    'hasOrder', p_has_order,
    'hasTest', p_has_test,
    'hasReport', p_has_report
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'session-customer.result.record',
    'POST',
    '/api/mcp-day/session-customer/result',
    'record_result',
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

  v_data := public.mcp_record_session_customer_result(
    p_session_customer_id => p_session_customer_id,
    p_result_type => p_result_type,
    p_note => p_note,
    p_order_id => p_order_id,
    p_test_id => p_test_id,
    p_report_id => p_report_id,
    p_has_order => p_has_order,
    p_has_test => p_has_test,
    p_has_report => p_has_report,
    p_context => p_context
  );

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    coalesce(v_data #>> '{sessionCustomer,id}', p_session_customer_id)
  );
end;
$function$;

create or replace function public.mcp_idempotent_add_session_customer(
  p_session_id text,
  p_customer_name text,
  p_route_customer_id text,
  p_customer_id text,
  p_phone text,
  p_area text,
  p_address text,
  p_note text,
  p_context jsonb,
  p_geo_lat double precision,
  p_geo_lng double precision,
  p_geo_accuracy double precision,
  p_geo_source text,
  p_google_maps_url text
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
    'sessionId', p_session_id,
    'customerName', p_customer_name,
    'routeCustomerId', p_route_customer_id,
    'customerId', p_customer_id,
    'phone', p_phone,
    'area', p_area,
    'address', p_address,
    'note', p_note,
    'geoLat', p_geo_lat,
    'geoLng', p_geo_lng,
    'geoAccuracy', p_geo_accuracy,
    'geoSource', p_geo_source,
    'googleMapsUrl', p_google_maps_url
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'session-customer.add',
    'POST',
    '/api/mcp-day/session-customer/add',
    'add_customer',
    'session_customer',
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

  v_data := public.mcp_add_session_customer(
    p_session_id => p_session_id,
    p_customer_name => p_customer_name,
    p_route_customer_id => p_route_customer_id,
    p_customer_id => p_customer_id,
    p_phone => p_phone,
    p_area => p_area,
    p_address => p_address,
    p_note => p_note,
    p_context => p_context,
    p_geo_lat => p_geo_lat,
    p_geo_lng => p_geo_lng,
    p_geo_accuracy => p_geo_accuracy,
    p_geo_source => p_geo_source,
    p_google_maps_url => p_google_maps_url
  );

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    v_data #>> '{sessionCustomer,id}'
  );
end;
$function$;

create or replace function public.mcp_idempotent_create_session_report_snapshot(
  p_session_id text,
  p_source text,
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
    'sessionId', p_session_id,
    'source', p_source
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'session-report.snapshot.create',
    'POST',
    '/api/mcp-session-report',
    'create_snapshot',
    'session_report',
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

  v_data := public.mcp_create_session_report_snapshot(
    p_session_id => p_session_id,
    p_source => p_source
  );

  update public.mcp_session_reports as report
     set raw_payload = jsonb_set(
       coalesce(report.raw_payload, '{}'::jsonb),
       '{foundation_context}',
       coalesce(p_context, '{}'::jsonb),
       true
     )
   where report.id = v_data ->> 'id'
   returning to_jsonb(report) into v_data;

  if v_data is null then
    raise exception 'session_report_not_found' using errcode = 'P0002';
  end if;

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    v_data ->> 'id'
  );
end;
$function$;

create or replace function public.mcp_idempotent_save_session_report_ai_result(
  p_session_id text,
  p_ai_result jsonb,
  p_analyzed_at timestamptz,
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
    'sessionId', p_session_id,
    'aiResult', p_ai_result,
    'analyzedAt', p_analyzed_at
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'session-report.ai-result.save',
    'POST',
    '/api/mcp-session-report/ai-result',
    'save_ai_result',
    'session_report',
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

  v_data := public.mcp_save_session_report_ai_result(
    p_session_id => p_session_id,
    p_ai_result => p_ai_result,
    p_analyzed_at => p_analyzed_at,
    p_context => p_context
  );

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    v_data #>> '{row,id}'
  );
end;
$function$;

create or replace function public.mcp_idempotent_update_field_check_result(
  p_result_id text,
  p_product_id text,
  p_product_name text,
  p_status text,
  p_note text,
  p_session_customer_id text,
  p_input_meta jsonb,
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
    'resultId', p_result_id,
    'productId', p_product_id,
    'productName', p_product_name,
    'status', p_status,
    'note', p_note,
    'sessionCustomerId', p_session_customer_id,
    'inputMeta', coalesce(p_input_meta, '{}'::jsonb)
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'field-check.result.update',
    'POST',
    '/api/field-checks/result',
    'update_result',
    'field_check_result',
    p_result_id,
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

  v_data := public.mcp_update_field_check_result(
    p_result_id => p_result_id,
    p_product_id => p_product_id,
    p_product_name => p_product_name,
    p_status => p_status,
    p_note => p_note,
    p_session_customer_id => p_session_customer_id,
    p_input_meta => p_input_meta,
    p_context => p_context
  );

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    coalesce(v_data ->> 'id', p_result_id)
  );
end;
$function$;

create or replace function public.mcp_idempotent_create_report_setting_group(
  p_group_key text,
  p_title text,
  p_group_type text,
  p_description text,
  p_sort_order integer,
  p_status text,
  p_meta jsonb,
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
    'groupKey', p_group_key,
    'title', p_title,
    'groupType', p_group_type,
    'description', p_description,
    'sortOrder', p_sort_order,
    'status', p_status,
    'meta', coalesce(p_meta, '{}'::jsonb)
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'report-setting.group.create',
    'POST',
    '/api/mcp-report-setting-groups',
    'create_group',
    'report_setting_group',
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

  v_data := public.mcp_create_report_setting_group(
    p_group_key => p_group_key,
    p_title => p_title,
    p_group_type => p_group_type,
    p_description => p_description,
    p_sort_order => p_sort_order,
    p_status => p_status,
    p_meta => p_meta,
    p_context => p_context
  );

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    v_data ->> 'id'
  );
end;
$function$;

create or replace function public.mcp_idempotent_update_report_setting_group(
  p_group_id text,
  p_patch jsonb,
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
    'groupId', p_group_id,
    'patch', coalesce(p_patch, '{}'::jsonb)
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'report-setting.group.update',
    'PATCH',
    '/api/mcp-report-setting-groups',
    'update_group',
    'report_setting_group',
    p_group_id,
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

  v_data := public.mcp_update_report_setting_group(
    p_group_id => p_group_id,
    p_patch => p_patch,
    p_context => p_context
  );

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    coalesce(v_data ->> 'id', p_group_id)
  );
end;
$function$;

create or replace function public.mcp_idempotent_create_report_setting_item(
  p_group_id text,
  p_item_key text,
  p_label text,
  p_value text,
  p_category text,
  p_brand_name text,
  p_product_id text,
  p_sort_order integer,
  p_status text,
  p_meta jsonb,
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
    'groupId', p_group_id,
    'itemKey', p_item_key,
    'label', p_label,
    'value', p_value,
    'category', p_category,
    'brandName', p_brand_name,
    'productId', p_product_id,
    'sortOrder', p_sort_order,
    'status', p_status,
    'meta', coalesce(p_meta, '{}'::jsonb)
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'report-setting.item.create',
    'POST',
    '/api/mcp-report-settings',
    'create_item',
    'report_setting_item',
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

  v_data := public.mcp_create_report_setting_item(
    p_group_id => p_group_id,
    p_item_key => p_item_key,
    p_label => p_label,
    p_value => p_value,
    p_category => p_category,
    p_brand_name => p_brand_name,
    p_product_id => p_product_id,
    p_sort_order => p_sort_order,
    p_status => p_status,
    p_meta => p_meta,
    p_context => p_context
  );

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    v_data ->> 'id'
  );
end;
$function$;

create or replace function public.mcp_idempotent_update_report_setting_item(
  p_item_id text,
  p_patch jsonb,
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
    'itemId', p_item_id,
    'patch', coalesce(p_patch, '{}'::jsonb)
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'report-setting.item.update',
    'PATCH',
    '/api/mcp-report-settings',
    'update_item',
    'report_setting_item',
    p_item_id,
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

  v_data := public.mcp_update_report_setting_item(
    p_item_id => p_item_id,
    p_patch => p_patch,
    p_context => p_context
  );

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    coalesce(v_data ->> 'id', p_item_id)
  );
end;
$function$;

revoke execute on function public.mcp_idempotent_record_session_customer_result(text, text, text, text, text, text, boolean, boolean, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_record_session_customer_result(text, text, text, text, text, text, boolean, boolean, boolean, jsonb) to service_role;

revoke execute on function public.mcp_idempotent_add_session_customer(text, text, text, text, text, text, text, text, jsonb, double precision, double precision, double precision, text, text) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_add_session_customer(text, text, text, text, text, text, text, text, jsonb, double precision, double precision, double precision, text, text) to service_role;

revoke execute on function public.mcp_idempotent_create_session_report_snapshot(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_create_session_report_snapshot(text, text, jsonb) to service_role;

revoke execute on function public.mcp_idempotent_save_session_report_ai_result(text, jsonb, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_save_session_report_ai_result(text, jsonb, timestamptz, jsonb) to service_role;

revoke execute on function public.mcp_idempotent_update_field_check_result(text, text, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_update_field_check_result(text, text, text, text, text, text, jsonb, jsonb) to service_role;

revoke execute on function public.mcp_idempotent_create_report_setting_group(text, text, text, text, integer, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_create_report_setting_group(text, text, text, text, integer, text, jsonb, jsonb) to service_role;

revoke execute on function public.mcp_idempotent_update_report_setting_group(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_update_report_setting_group(text, jsonb, jsonb) to service_role;

revoke execute on function public.mcp_idempotent_create_report_setting_item(text, text, text, text, text, text, text, integer, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_create_report_setting_item(text, text, text, text, text, text, text, integer, text, jsonb, jsonb) to service_role;

revoke execute on function public.mcp_idempotent_update_report_setting_item(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_update_report_setting_item(text, jsonb, jsonb) to service_role;
