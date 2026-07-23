create or replace function public.mcp_idempotent_create_order_from_session_customer(
  p_session_customer_id text,
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
    'sessionCustomerId', p_session_customer_id,
    'items', coalesce(p_items, '[]'::jsonb),
    'note', p_note,
    'status', p_status
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'session-customer.order.create',
    'POST',
    '/api/mcp-day/session-customer/order',
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

  v_data := public.mcp_create_order_from_session_customer(
    p_session_customer_id => p_session_customer_id,
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
    200,
    v_data,
    v_data ->> 'orderId'
  );
end;
$function$;

create or replace function public.mcp_idempotent_create_test_from_session_customer(
  p_session_customer_id text,
  p_file_id text,
  p_file_title text,
  p_results jsonb,
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
    'sessionCustomerId', p_session_customer_id,
    'fileId', p_file_id,
    'fileTitle', p_file_title,
    'results', coalesce(p_results, '[]'::jsonb),
    'note', p_note,
    'status', p_status
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'session-customer.test.create',
    'POST',
    '/api/mcp-day/session-customer/test',
    'create_test',
    'test_result',
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

  v_data := public.mcp_create_test_from_session_customer(
    p_session_customer_id => p_session_customer_id,
    p_file_id => p_file_id,
    p_file_title => p_file_title,
    p_results => p_results,
    p_note => p_note,
    p_status => p_status
  );

  update public.test_customer_results as row
     set raw_payload = jsonb_set(
       coalesce(row.raw_payload, '{}'::jsonb),
       '{foundation_context}',
       coalesce(p_context, '{}'::jsonb),
       true
     )
   where row.id = v_data ->> 'testId';

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    v_data ->> 'testId'
  );
end;
$function$;

create or replace function public.mcp_idempotent_create_report_from_session_customer(
  p_session_customer_id text,
  p_report_type text,
  p_content text,
  p_price_summary text,
  p_competitor_summary text,
  p_display_summary text,
  p_stock_summary text,
  p_demand_summary text,
  p_opportunity_summary text,
  p_risk_summary text,
  p_next_action text,
  p_note text,
  p_raw_payload jsonb,
  p_selected_competitor_ids text[],
  p_selected_used_product_ids text[],
  p_selected_setting_item_ids text[],
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
    'reportType', p_report_type,
    'content', p_content,
    'priceSummary', p_price_summary,
    'competitorSummary', p_competitor_summary,
    'displaySummary', p_display_summary,
    'stockSummary', p_stock_summary,
    'demandSummary', p_demand_summary,
    'opportunitySummary', p_opportunity_summary,
    'riskSummary', p_risk_summary,
    'nextAction', p_next_action,
    'note', p_note,
    'rawPayload', coalesce(p_raw_payload, '{}'::jsonb),
    'selectedCompetitorIds', to_jsonb(coalesce(p_selected_competitor_ids, array[]::text[])),
    'selectedUsedProductIds', to_jsonb(coalesce(p_selected_used_product_ids, array[]::text[])),
    'selectedSettingItemIds', to_jsonb(coalesce(p_selected_setting_item_ids, array[]::text[]))
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'session-customer.report.create',
    'POST',
    '/api/mcp-day/session-customer/report',
    'create_report',
    'market_report',
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

  v_data := public.mcp_create_report_from_session_customer(
    p_session_customer_id => p_session_customer_id,
    p_report_type => p_report_type,
    p_content => p_content,
    p_price_summary => p_price_summary,
    p_competitor_summary => p_competitor_summary,
    p_display_summary => p_display_summary,
    p_stock_summary => p_stock_summary,
    p_demand_summary => p_demand_summary,
    p_opportunity_summary => p_opportunity_summary,
    p_risk_summary => p_risk_summary,
    p_next_action => p_next_action,
    p_note => p_note,
    p_raw_payload => p_raw_payload,
    p_selected_competitor_ids => p_selected_competitor_ids,
    p_selected_used_product_ids => p_selected_used_product_ids,
    p_selected_setting_item_ids => p_selected_setting_item_ids
  );

  update public.market_reports as row
     set raw_payload = jsonb_set(
       coalesce(row.raw_payload, '{}'::jsonb),
       '{foundation_context}',
       coalesce(p_context, '{}'::jsonb),
       true
     )
   where row.id = v_data ->> 'reportId';

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    v_data ->> 'reportId'
  );
end;
$function$;

create or replace function public.mcp_idempotent_create_followup_from_session_customer(
  p_session_customer_id text,
  p_title text,
  p_due_date date,
  p_priority text,
  p_owner text,
  p_note text,
  p_followup_type text,
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
    'title', p_title,
    'dueDate', p_due_date,
    'priority', p_priority,
    'owner', p_owner,
    'note', p_note,
    'followupType', p_followup_type
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'session-customer.followup.create',
    'POST',
    '/api/mcp-day/session-customer/followup',
    'create_followup',
    'followup',
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

  v_data := public.mcp_create_followup_from_session_customer(
    p_session_customer_id => p_session_customer_id,
    p_title => p_title,
    p_due_date => p_due_date,
    p_priority => p_priority,
    p_owner => p_owner,
    p_note => p_note,
    p_followup_type => p_followup_type
  );

  update public.mcp_followups as row
     set raw_payload = jsonb_set(
       coalesce(row.raw_payload, '{}'::jsonb),
       '{foundation_context}',
       coalesce(p_context, '{}'::jsonb),
       true
     )
   where row.id = v_data ->> 'followupId';

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    v_data ->> 'followupId'
  );
end;
$function$;

revoke execute on function public.mcp_idempotent_create_order_from_session_customer(text, jsonb, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_create_order_from_session_customer(text, jsonb, text, text, jsonb) to service_role;

revoke execute on function public.mcp_idempotent_create_test_from_session_customer(text, text, text, jsonb, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_create_test_from_session_customer(text, text, text, jsonb, text, text, jsonb) to service_role;

revoke execute on function public.mcp_idempotent_create_report_from_session_customer(text, text, text, text, text, text, text, text, text, text, text, text, jsonb, text[], text[], text[], jsonb) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_create_report_from_session_customer(text, text, text, text, text, text, text, text, text, text, text, text, jsonb, text[], text[], text[], jsonb) to service_role;

revoke execute on function public.mcp_idempotent_create_followup_from_session_customer(text, text, date, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_create_followup_from_session_customer(text, text, date, text, text, text, text, jsonb) to service_role;
