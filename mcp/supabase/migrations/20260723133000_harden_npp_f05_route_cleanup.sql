-- Production hygiene hotfix: the guarded hard-delete owner must recognize the
-- current NPP F05 production-smoke prefix as well as the legacy MCP API prefix.
-- Matching remains exact and requires both the API Smoke area and reserved
-- prefixes on the route name/note before business-table rows are removed.

create or replace function public.mcp_delete_route_hard(p_route_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  r public.mcp_routes%rowtype;
  v_is_legacy_smoke boolean := false;
  v_is_npp_f05_smoke boolean := false;
  v_is_smoke boolean := false;
  v_route_customer_ids text[] := array[]::text[];
  v_session_ids text[] := array[]::text[];
  v_session_customer_ids text[] := array[]::text[];
  v_order_ids text[] := array[]::text[];
  v_test_file_ids text[] := array[]::text[];
  v_route_customers integer := 0;
  v_sessions integer := 0;
  v_session_customers integer := 0;
  v_visits integer := 0;
  v_followups integer := 0;
  v_session_reports integer := 0;
  v_orders integer := 0;
  v_order_items integer := 0;
  v_market_reports integer := 0;
  v_test_files integer := 0;
  v_test_file_products integer := 0;
  v_test_customers integer := 0;
  v_test_results integer := 0;
begin
  if nullif(btrim(coalesce(p_route_id, '')), '') is null then
    raise exception 'route_id_required' using errcode = '23514';
  end if;

  select * into r
    from public.mcp_routes
   where id = p_route_id
   for update;
  if not found then
    raise exception 'route_not_found' using errcode = '23503';
  end if;

  v_is_legacy_smoke := coalesce(r.area, '') = 'API Smoke'
    and coalesce(r.note, '') = 'temporary MCP v1 API smoke'
    and coalesce(r.route_name, '') ~ '^__MCP_V1_API_(FULL|SNAPSHOT_ONCE)__[0-9]{13}-[a-z0-9]{6}$';

  v_is_npp_f05_smoke := coalesce(r.area, '') = 'API Smoke'
    and left(coalesce(r.route_name, ''), length('__NPP_F05_RUNTIME_SMOKE__')) = '__NPP_F05_RUNTIME_SMOKE__'
    and left(coalesce(r.note, ''), length('__NPP_F05_RUNTIME_SMOKE__')) = '__NPP_F05_RUNTIME_SMOKE__';

  v_is_smoke := v_is_legacy_smoke or v_is_npp_f05_smoke;

  perform set_config('mcp.internal_hard_delete', 'on', true);

  select coalesce(array_agg(id), array[]::text[])
    into v_route_customer_ids
    from public.mcp_route_customers
   where route_id = p_route_id;

  select coalesce(array_agg(id), array[]::text[])
    into v_session_ids
    from public.mcp_route_sessions
   where route_id = p_route_id;

  select coalesce(array_agg(id), array[]::text[])
    into v_session_customer_ids
    from public.mcp_session_customers
   where route_id = p_route_id;

  if v_is_smoke then
    select coalesce(array_agg(id), array[]::text[])
      into v_order_ids
      from public.orders
     where order_date >= date '2099-01-01'
       and (
         sales = 'API Smoke'
         or (
           v_is_npp_f05_smoke
           and left(coalesce(note, ''), length('__NPP_F05_RUNTIME_SMOKE__')) = '__NPP_F05_RUNTIME_SMOKE__'
         )
       )
       and (
         raw_payload ->> 'route_id' = p_route_id
         or raw_payload ->> 'route_customer_id' = any(v_route_customer_ids)
         or raw_payload ->> 'routeCustomerId' = any(v_route_customer_ids)
         or raw_payload ->> 'session_id' = any(v_session_ids)
         or raw_payload ->> 'session_customer_id' = any(v_session_customer_ids)
       );

    delete from public.order_items where order_id = any(v_order_ids);
    get diagnostics v_order_items = row_count;
    delete from public.orders where id = any(v_order_ids);
    get diagnostics v_orders = row_count;

    select coalesce(array_agg(id), array[]::text[])
      into v_test_file_ids
      from public.test_files
     where test_date >= date '2099-01-01'
       and sales = 'API Smoke'
       and (
         raw_payload ->> 'route_id' = p_route_id
         or raw_payload ->> 'route_customer_id' = any(v_route_customer_ids)
         or raw_payload ->> 'routeCustomerId' = any(v_route_customer_ids)
         or raw_payload ->> 'session_id' = any(v_session_ids)
         or raw_payload ->> 'session_customer_id' = any(v_session_customer_ids)
       );

    delete from public.test_customer_results where file_id = any(v_test_file_ids);
    get diagnostics v_test_results = row_count;
    delete from public.test_customers where file_id = any(v_test_file_ids);
    get diagnostics v_test_customers = row_count;
    delete from public.test_file_products where file_id = any(v_test_file_ids);
    get diagnostics v_test_file_products = row_count;
    delete from public.test_files where id = any(v_test_file_ids);
    get diagnostics v_test_files = row_count;

    delete from public.market_reports
     where report_date >= date '2099-01-01'
       and sales = 'API Smoke'
       and (
         raw_payload ->> 'route_id' = p_route_id
         or raw_payload ->> 'route_customer_id' = any(v_route_customer_ids)
         or raw_payload ->> 'routeCustomerId' = any(v_route_customer_ids)
         or raw_payload ->> 'session_id' = any(v_session_ids)
         or raw_payload ->> 'session_customer_id' = any(v_session_customer_ids)
       );
    get diagnostics v_market_reports = row_count;

    delete from public.mcp_session_reports where route_id = p_route_id;
    get diagnostics v_session_reports = row_count;
  end if;

  select count(*) into v_followups from public.mcp_followups where route_id = p_route_id;
  select count(*) into v_session_customers from public.mcp_session_customers where route_id = p_route_id;
  select count(*) into v_visits from public.mcp_visits where route_id = p_route_id;
  select count(*) into v_sessions from public.mcp_route_sessions where route_id = p_route_id;
  select count(*) into v_route_customers from public.mcp_route_customers where route_id = p_route_id;

  delete from public.mcp_followups where route_id = p_route_id;
  delete from public.mcp_session_customers where route_id = p_route_id;
  delete from public.mcp_visits where route_id = p_route_id;
  delete from public.mcp_route_sessions where route_id = p_route_id;

  delete from public.mcp_route_order_template_items where template_id in (select id from public.mcp_route_order_templates where route_id = p_route_id);
  delete from public.mcp_route_test_template_items where template_id in (select id from public.mcp_route_test_templates where route_id = p_route_id);
  delete from public.mcp_route_skip_reason_template_items where template_id in (select id from public.mcp_route_skip_reason_templates where route_id = p_route_id);
  delete from public.mcp_route_order_templates where route_id = p_route_id;
  delete from public.mcp_route_test_templates where route_id = p_route_id;
  delete from public.mcp_route_report_templates where route_id = p_route_id;
  delete from public.mcp_route_followup_templates where route_id = p_route_id;
  delete from public.mcp_route_skip_reason_templates where route_id = p_route_id;
  delete from public.mcp_route_customer_add_rules where route_id = p_route_id;
  delete from public.mcp_route_customers where route_id = p_route_id;
  delete from public.mcp_routes where id = p_route_id;

  return jsonb_build_object(
    'deleted', true,
    'routeId', p_route_id,
    'routeName', r.route_name,
    'mode', 'hard_delete',
    'smokeCleanup', v_is_smoke,
    'smokeKind', case when v_is_npp_f05_smoke then 'npp_f05' when v_is_legacy_smoke then 'legacy_mcp_api' else null end,
    'deletedCounts', jsonb_build_object(
      'routeCustomers', v_route_customers,
      'sessions', v_sessions,
      'sessionCustomers', v_session_customers,
      'visits', v_visits,
      'followups', v_followups,
      'sessionReports', v_session_reports,
      'orders', v_orders,
      'orderItems', v_order_items,
      'marketReports', v_market_reports,
      'testFiles', v_test_files,
      'testFileProducts', v_test_file_products,
      'testCustomers', v_test_customers,
      'testResults', v_test_results
    )
  );
end;
$function$;

revoke all on function public.mcp_delete_route_hard(text) from public, anon, authenticated;
grant execute on function public.mcp_delete_route_hard(text) to service_role;

comment on function public.mcp_delete_route_hard(text) is
  'Hard-deletes one route. Business-table cleanup is enabled only for exact legacy MCP API smoke routes or exact reserved NPP F05 smoke routes.';
