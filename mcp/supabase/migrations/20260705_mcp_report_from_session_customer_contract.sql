-- MCP-7 Report contract: create a market report from a MCP session customer.
-- Input fields cover report type, content, price, competitor, display, stock,
-- demand, opportunity, risk, and next action.
-- Output links report_id into mcp_visits and mcp_session_customers.

create or replace function public.mcp_create_report_from_session_customer(
  p_session_customer_id text,
  p_report_type text default 'general',
  p_content text default null,
  p_price_summary text default null,
  p_competitor_summary text default null,
  p_display_summary text default null,
  p_stock_summary text default null,
  p_demand_summary text default null,
  p_opportunity_summary text default null,
  p_risk_summary text default null,
  p_next_action text default null,
  p_note text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  sc record;
  sess record;
  v_report_id text;
  v_visit_id text;
  v_report_type text;
  v_company_summary text;
  v_note text;
  now_ts timestamptz := now();
begin
  if p_session_customer_id is null or length(trim(p_session_customer_id)) = 0 then
    raise exception 'session_customer_id_required' using errcode = '23514';
  end if;

  v_report_type := coalesce(nullif(trim(coalesce(p_report_type, '')), ''), 'general');
  v_note := coalesce(nullif(trim(coalesce(p_content, '')), ''), nullif(trim(coalesce(p_note, '')), ''));

  if v_note is null
     and nullif(trim(coalesce(p_price_summary, '')), '') is null
     and nullif(trim(coalesce(p_competitor_summary, '')), '') is null
     and nullif(trim(coalesce(p_display_summary, '')), '') is null
     and nullif(trim(coalesce(p_stock_summary, '')), '') is null
     and nullif(trim(coalesce(p_demand_summary, '')), '') is null
     and nullif(trim(coalesce(p_opportunity_summary, '')), '') is null
     and nullif(trim(coalesce(p_risk_summary, '')), '') is null
     and nullif(trim(coalesce(p_next_action, '')), '') is null then
    raise exception 'report_content_required' using errcode = '23514';
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

  v_company_summary := concat_ws(E'\n',
    nullif(trim(coalesce(p_display_summary, '')), ''),
    nullif(trim(coalesce(p_stock_summary, '')), '')
  );
  if v_company_summary = '' then
    v_company_summary := null;
  end if;

  v_report_id := 'report_' || replace(gen_random_uuid()::text, '-', '');

  insert into public.market_reports (
    id, report_date, sales, market_area, route_name, market_type, total_shops,
    competitor_summary, price_summary, demand_summary, company_product_summary,
    opportunity_summary, risk_summary, next_action, note, sync_status, raw_payload,
    created_at, updated_at
  ) values (
    v_report_id, sess.session_date, sess.sales, coalesce(sc.area, sess.area), sess.route_name, v_report_type, 1,
    nullif(trim(coalesce(p_competitor_summary, '')), ''),
    nullif(trim(coalesce(p_price_summary, '')), ''),
    nullif(trim(coalesce(p_demand_summary, '')), ''),
    v_company_summary,
    nullif(trim(coalesce(p_opportunity_summary, '')), ''),
    nullif(trim(coalesce(p_risk_summary, '')), ''),
    nullif(trim(coalesce(p_next_action, '')), ''),
    v_note,
    'synced',
    jsonb_build_object(
      'source', 'mcp_create_report_from_session_customer',
      'session_id', sc.session_id,
      'session_customer_id', sc.id,
      'route_id', sc.route_id,
      'route_customer_id', sc.route_customer_id,
      'customer_id', sc.customer_id,
      'report_type', v_report_type,
      'display_summary', nullif(trim(coalesce(p_display_summary, '')), ''),
      'stock_summary', nullif(trim(coalesce(p_stock_summary, '')), '')
    ),
    now_ts, now_ts
  );

  if sc.visit_id is not null then
    update public.mcp_visits
       set has_report = true,
           report_id = v_report_id,
           status = 'visited',
           note = coalesce(v_note, note, 'Tao bao cao tu MCP'),
           updated_at = now_ts
     where id = sc.visit_id
     returning id into v_visit_id;
  end if;

  if v_visit_id is null then
    insert into public.mcp_visits (
      id, session_id, route_id, route_customer_id, visit_date, status, has_order, has_test, has_report,
      report_id, checkin_at, note, raw_payload, created_at, updated_at
    ) values (
      'mcv_' || replace(gen_random_uuid()::text, '-', ''),
      sc.session_id, sc.route_id, sc.route_customer_id, sess.session_date, 'visited', false, false, true,
      v_report_id, now_ts, coalesce(v_note, 'Tao bao cao tu MCP'),
      jsonb_build_object('source', 'mcp_create_report_from_session_customer', 'session_customer_id', sc.id, 'report_id', v_report_id),
      now_ts, now_ts
    ) returning id into v_visit_id;
  end if;

  update public.mcp_session_customers
     set visit_status = 'visited',
         status_reason = null,
         visit_id = v_visit_id,
         report_id = v_report_id,
         note = coalesce(v_note, note),
         updated_at = now_ts
   where id = sc.id;

  perform public.mcp_recalc_route_session_counters(sc.session_id);

  return jsonb_build_object(
    'reportId', v_report_id,
    'reportType', v_report_type,
    'sessionCustomerId', sc.id,
    'visitId', v_visit_id
  );
end;
$$;
