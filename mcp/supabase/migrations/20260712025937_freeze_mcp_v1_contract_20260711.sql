-- MCP v1 core contract.
-- Production was applied through Supabase migration freeze_mcp_v1_contract_20260711.

create unique index if not exists mcp_route_sessions_route_date_uidx
on public.mcp_route_sessions(route_id, session_date);

create unique index if not exists mcp_session_customers_session_route_customer_uidx
on public.mcp_session_customers(session_id, route_customer_id)
where route_customer_id is not null;

create or replace function public.mcp_assert_session_mutable(p_session_id text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_status text;
begin
  if current_setting('mcp.internal_hard_delete', true) = 'on' then
    return;
  end if;

  if nullif(btrim(coalesce(p_session_id, '')), '') is null then
    raise exception 'session_id_required' using errcode = '23514';
  end if;

  select lower(coalesce(status, 'active'))
    into v_status
    from public.mcp_route_sessions
   where id = p_session_id;

  if not found then
    raise exception 'session_not_found' using errcode = '23503';
  end if;

  if v_status in ('done', 'completed', 'cancelled') then
    raise exception 'session_closed_read_only' using errcode = '23514';
  end if;
end;
$function$;

create or replace function public.mcp_block_closed_session_child_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_session_id text;
begin
  v_session_id := case when tg_op = 'DELETE' then old.session_id else new.session_id end;
  perform public.mcp_assert_session_mutable(v_session_id);
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists mcp_session_customers_block_closed_mutation on public.mcp_session_customers;
create trigger mcp_session_customers_block_closed_mutation
before insert or update on public.mcp_session_customers
for each row execute function public.mcp_block_closed_session_child_mutation();

drop trigger if exists mcp_visits_block_closed_mutation on public.mcp_visits;
create trigger mcp_visits_block_closed_mutation
before insert or update on public.mcp_visits
for each row execute function public.mcp_block_closed_session_child_mutation();

drop trigger if exists mcp_followups_block_closed_mutation on public.mcp_followups;
create trigger mcp_followups_block_closed_mutation
before insert or update on public.mcp_followups
for each row execute function public.mcp_block_closed_session_child_mutation();

create or replace function public.mcp_open_route_session(
  p_route_id text,
  p_session_date date,
  p_owner text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_route public.mcp_routes%rowtype;
  v_session public.mcp_route_sessions%rowtype;
  v_created boolean := false;
  v_backfill jsonb;
  v_now timestamptz := now();
begin
  if nullif(btrim(coalesce(p_route_id, '')), '') is null then
    raise exception 'route_id_required' using errcode = '23514';
  end if;
  if p_session_date is null then
    raise exception 'session_date_required' using errcode = '23514';
  end if;

  select * into v_route
    from public.mcp_routes
   where id = p_route_id;

  if not found then
    raise exception 'route_not_found' using errcode = '23503';
  end if;
  if coalesce(v_route.active, true) is false then
    raise exception 'route_inactive' using errcode = '23514';
  end if;

  insert into public.mcp_route_sessions (
    id, route_id, route_name, session_date, weekday, sales, area, status,
    planned_customers, visited_customers, order_count, test_count, report_count,
    followup_count, note, sync_status, raw_payload, created_at, updated_at
  ) values (
    'mrs_' || replace(gen_random_uuid()::text, '-', ''),
    v_route.id,
    coalesce(nullif(btrim(v_route.route_name), ''), v_route.id),
    p_session_date,
    extract(dow from p_session_date)::integer,
    coalesce(nullif(btrim(coalesce(p_owner, '')), ''), 'Sale'),
    v_route.area,
    'active',
    0, 0, 0, 0, 0, 0,
    'Opened by MCP VPS backend',
    'synced',
    jsonb_build_object('source', 'mcp_open_route_session', 'route_snapshot', to_jsonb(v_route)),
    v_now,
    v_now
  )
  on conflict (route_id, session_date) do nothing
  returning * into v_session;

  v_created := found;

  if not v_created then
    select * into v_session
      from public.mcp_route_sessions
     where route_id = p_route_id
       and session_date = p_session_date
     for update;
  end if;

  if v_session.id is null then
    raise exception 'route_session_create_failed' using errcode = 'P0001';
  end if;

  -- only_if_empty preserves the original route snapshot when the session is reopened.
  v_backfill := public.mcp_backfill_session_customers_from_route(v_session.id, true);
  perform public.mcp_recalc_route_session_counters(v_session.id);

  select * into v_session
    from public.mcp_route_sessions
   where id = v_session.id;

  return jsonb_build_object(
    'created', v_created,
    'session', jsonb_build_object(
      'id', v_session.id,
      'sessionId', v_session.id,
      'routeId', v_session.route_id,
      'routeName', v_session.route_name,
      'sessionDate', v_session.session_date,
      'date', v_session.session_date,
      'weekday', v_session.weekday,
      'owner', coalesce(v_session.sales, 'Sale'),
      'area', v_session.area,
      'status', case when v_session.status = 'completed' then 'done' else v_session.status end,
      'plannedCustomers', coalesce(v_session.planned_customers, 0),
      'visitedCustomers', coalesce(v_session.visited_customers, 0),
      'orderCount', coalesce(v_session.order_count, 0),
      'testCount', coalesce(v_session.test_count, 0),
      'reportCount', coalesce(v_session.report_count, 0),
      'followupCount', coalesce(v_session.followup_count, 0),
      'note', v_session.note,
      'createdAt', v_session.created_at,
      'updatedAt', v_session.updated_at
    ),
    'backfill', v_backfill
  );
end;
$function$;

create or replace function public.mcp_set_session_customer_status(
  p_session_customer_id text,
  p_visit_status text,
  p_status_reason text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_sc public.mcp_session_customers%rowtype;
  v_sess public.mcp_route_sessions%rowtype;
  v_visit public.mcp_visits%rowtype;
  v_status text;
  v_reason text;
  v_now timestamptz := now();
  v_has_activity boolean := false;
begin
  if nullif(btrim(coalesce(p_session_customer_id, '')), '') is null then
    raise exception 'session_customer_id_required' using errcode = '23514';
  end if;

  v_status := lower(coalesce(nullif(btrim(coalesce(p_visit_status, '')), ''), 'visited'));
  if v_status not in ('pending', 'visited', 'skipped', 'cancelled') then
    raise exception 'invalid_visit_status' using errcode = '23514';
  end if;

  v_reason := nullif(btrim(coalesce(p_status_reason, '')), '');
  if v_status in ('skipped', 'cancelled') and v_reason is null then
    raise exception 'status_reason_required' using errcode = '23514';
  end if;

  select * into v_sc
    from public.mcp_session_customers
   where id = p_session_customer_id
   for update;
  if not found then
    raise exception 'session_customer_not_found' using errcode = '23503';
  end if;

  select * into v_sess
    from public.mcp_route_sessions
   where id = v_sc.session_id
   for share;
  if not found then
    raise exception 'session_not_found' using errcode = '23503';
  end if;

  perform public.mcp_assert_session_mutable(v_sess.id);

  v_has_activity := v_sc.order_id is not null
                 or v_sc.test_id is not null
                 or v_sc.report_id is not null
                 or coalesce(v_sc.followup_count, 0) > 0;

  if v_status <> 'visited' and v_has_activity then
    raise exception 'session_customer_has_activity' using errcode = '23514';
  end if;

  if v_sc.visit_id is not null then
    select * into v_visit from public.mcp_visits where id = v_sc.visit_id for update;
    if v_visit.id is not null and v_status <> 'visited'
       and (coalesce(v_visit.has_order, false) or coalesce(v_visit.has_test, false) or coalesce(v_visit.has_report, false)) then
      raise exception 'session_customer_has_activity' using errcode = '23514';
    end if;
  end if;

  if v_status = 'visited' then
    if v_visit.id is null then
      insert into public.mcp_visits (
        id, session_id, route_id, route_customer_id, visit_date, status,
        has_order, has_test, has_report, checkin_at, note, raw_payload,
        created_at, updated_at
      ) values (
        'mcv_' || replace(gen_random_uuid()::text, '-', ''),
        v_sc.session_id,
        v_sc.route_id,
        v_sc.route_customer_id,
        v_sess.session_date,
        'visited',
        false, false, false,
        v_now,
        coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Đã ghé'),
        jsonb_build_object('source', 'mcp_set_session_customer_status', 'session_customer_id', v_sc.id),
        v_now,
        v_now
      ) returning * into v_visit;
    else
      update public.mcp_visits
         set visit_date = v_sess.session_date,
             status = 'visited',
             checkin_at = coalesce(checkin_at, v_now),
             note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note, 'Đã ghé'),
             updated_at = v_now
       where id = v_visit.id
       returning * into v_visit;
    end if;
  elsif v_visit.id is not null then
    update public.mcp_visits
       set visit_date = v_sess.session_date,
           status = v_status,
           note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), v_reason, note),
           updated_at = v_now
     where id = v_visit.id
     returning * into v_visit;
  end if;

  update public.mcp_session_customers
     set visit_status = v_status,
         status_reason = case when v_status in ('skipped', 'cancelled') then v_reason else null end,
         visit_id = case when v_status = 'visited' then v_visit.id else visit_id end,
         note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note),
         updated_at = v_now
   where id = v_sc.id
   returning * into v_sc;

  perform public.mcp_recalc_route_session_counters(v_sc.session_id);

  return jsonb_build_object(
    'sessionCustomer', to_jsonb(v_sc),
    'visit', case when v_visit.id is null then null else to_jsonb(v_visit) end,
    'sessionId', v_sc.session_id,
    'sessionCustomerId', v_sc.id,
    'visitId', v_visit.id,
    'visitStatus', v_status
  );
end;
$function$;

-- Snapshot source stays DB-owned so closing a session never depends on Vercel secrets.
create or replace function public.mcp_create_session_report_snapshot(
  p_session_id text,
  p_source text default 'close_session'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_source jsonb;
  v_session jsonb;
  v_customers jsonb;
  v_reports jsonb;
  v_orders jsonb;
  v_tests jsonb;
  v_followups jsonb;
  v_overview jsonb;
  v_sections jsonb;
  v_kpis jsonb;
  v_planned integer;
  v_visited integer;
  v_skipped integer;
  v_pending integer;
  v_score integer;
  v_health text;
  v_now timestamptz := now();
  v_row public.mcp_session_reports%rowtype;
begin
  if nullif(btrim(coalesce(p_session_id, '')), '') is null then
    raise exception 'session_id_required' using errcode = '23514';
  end if;

  perform public.mcp_recalc_route_session_counters(p_session_id);
  v_source := public.mcp_get_session_report_source(p_session_id, null, null);
  v_session := v_source -> 'session';
  if v_session is null or v_session = 'null'::jsonb then
    raise exception 'session_not_found' using errcode = '23503';
  end if;

  v_customers := coalesce(v_source -> 'customers', '[]'::jsonb);
  v_reports := coalesce(v_source -> 'reports', '[]'::jsonb);
  v_orders := coalesce(v_source -> 'orders', '[]'::jsonb);
  v_tests := coalesce(v_source -> 'tests', '[]'::jsonb);
  v_followups := coalesce(v_source -> 'followups', '[]'::jsonb);

  v_planned := jsonb_array_length(v_customers);
  select count(*)::integer,
         count(*) filter (where coalesce(value ->> 'visit_status', 'pending') in ('skipped', 'cancelled'))::integer
    into v_visited, v_skipped
    from jsonb_array_elements(v_customers)
   where coalesce(value ->> 'visit_status', 'pending') in ('visited', 'skipped', 'cancelled');
  select count(*)::integer into v_visited
    from jsonb_array_elements(v_customers)
   where coalesce(value ->> 'visit_status', 'pending') = 'visited';
  v_pending := greatest(v_planned - v_visited - v_skipped, 0);

  v_overview := jsonb_build_object(
    'planned', v_planned,
    'visited', v_visited,
    'pending', v_pending,
    'skipped', v_skipped,
    'observations', jsonb_array_length(v_reports),
    'orders', jsonb_array_length(v_orders),
    'tests', jsonb_array_length(v_tests),
    'followups', jsonb_array_length(v_followups)
  );

  v_kpis := jsonb_build_array(
    jsonb_build_object('label', 'Khách', 'value', v_planned, 'hint', v_visited || ' đã ghé · ' || v_pending || ' chờ'),
    jsonb_build_object('label', 'Quan sát', 'value', jsonb_array_length(v_reports), 'hint', 'Input cho BC phiên'),
    jsonb_build_object('label', 'Đơn/Test', 'value', jsonb_array_length(v_orders) || '/' || jsonb_array_length(v_tests), 'hint', 'Trong phiên'),
    jsonb_build_object('label', 'Follow-up', 'value', jsonb_array_length(v_followups), 'hint', v_skipped || ' bỏ qua')
  );

  v_sections := jsonb_build_object(
    'overview', v_overview,
    'observations', v_reports,
    'orders', v_orders,
    'tests', v_tests,
    'followups', v_followups,
    'customers', v_customers
  );

  v_score := case when v_planned = 0 then 0 else least(100,
    round((v_visited::numeric / v_planned::numeric) * 70)::integer
    + least(30, (jsonb_array_length(v_orders) + jsonb_array_length(v_tests) + jsonb_array_length(v_reports) + jsonb_array_length(v_followups)) * 5)
  ) end;
  v_health := case when v_score >= 80 then 'good' when v_score >= 50 then 'watch' else 'risk' end;

  insert into public.mcp_session_reports (
    session_id, route_id, route_name, session_date, sales, status, snapshot_source,
    schema_version, kpis, overview, sections, customer_details, insights, score,
    health, warnings, recommended_actions, ai_prompt_context, summary_text,
    raw_payload, snapshot_at, updated_at
  ) values (
    p_session_id,
    v_session ->> 'route_id',
    v_session ->> 'route_name',
    (v_session ->> 'session_date')::date,
    v_session ->> 'sales',
    'snapshot',
    coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'close_session'),
    'mcp.session-report.snapshot.v2',
    v_kpis,
    v_overview,
    v_sections,
    v_customers,
    jsonb_build_object('summary', case when v_health = 'good' then 'Phiên có độ phủ tốt.' when v_health = 'watch' then 'Phiên cần theo dõi thêm.' else 'Phiên có độ phủ hoặc dữ liệu thấp.' end),
    v_score,
    v_health,
    case when v_pending > 0 then jsonb_build_array('Còn ' || v_pending || ' khách chưa xử lý trong phiên.') else '[]'::jsonb end,
    case when v_pending > 0 then jsonb_build_array(jsonb_build_object('type', 'route_coverage', 'priority', 'high', 'action', 'Rà lại khách chưa xử lý.')) else '[]'::jsonb end,
    jsonb_build_object('task', 'mcp_session_report_analysis', 'source', v_source),
    'BC phiên ' || coalesce(v_session ->> 'route_name', v_session ->> 'route_id') || ' - ' || (v_session ->> 'session_date'),
    jsonb_build_object('source', v_source, 'overview', v_overview, 'sections', v_sections),
    v_now,
    v_now
  )
  on conflict (session_id) do update set
    route_id = excluded.route_id,
    route_name = excluded.route_name,
    session_date = excluded.session_date,
    sales = excluded.sales,
    status = excluded.status,
    snapshot_source = excluded.snapshot_source,
    schema_version = excluded.schema_version,
    kpis = excluded.kpis,
    overview = excluded.overview,
    sections = excluded.sections,
    customer_details = excluded.customer_details,
    insights = excluded.insights,
    score = excluded.score,
    health = excluded.health,
    warnings = excluded.warnings,
    recommended_actions = excluded.recommended_actions,
    ai_prompt_context = excluded.ai_prompt_context,
    summary_text = excluded.summary_text,
    raw_payload = excluded.raw_payload,
    snapshot_at = excluded.snapshot_at,
    updated_at = excluded.updated_at
  returning * into v_row;

  return to_jsonb(v_row);
end;
$function$;

create or replace function public.mcp_update_route_session(
  p_session_id text,
  p_session_date date default null,
  p_status text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_sess public.mcp_route_sessions%rowtype;
  v_old_date date;
  v_status text;
  v_date date;
  v_now timestamptz := now();
  v_snapshot jsonb := null;
begin
  if nullif(btrim(coalesce(p_session_id, '')), '') is null then
    raise exception 'session_id_required' using errcode = '23514';
  end if;

  select * into v_sess
    from public.mcp_route_sessions
   where id = p_session_id
   for update;
  if not found then
    raise exception 'session_not_found' using errcode = '23503';
  end if;

  if lower(coalesce(v_sess.status, 'active')) in ('done', 'completed', 'cancelled') then
    raise exception 'session_closed_read_only' using errcode = '23514';
  end if;

  v_old_date := v_sess.session_date;
  v_status := lower(coalesce(nullif(btrim(coalesce(p_status, '')), ''), v_sess.status, 'active'));
  if v_status = 'completed' then v_status := 'done'; end if;
  if v_status not in ('active', 'done', 'cancelled') then
    raise exception 'invalid_session_status' using errcode = '23514';
  end if;
  v_date := coalesce(p_session_date, v_old_date);

  if v_date <> v_old_date then
    update public.mcp_visits
       set visit_date = v_date,
           updated_at = v_now
     where session_id = v_sess.id;
  end if;

  update public.mcp_route_sessions
     set session_date = v_date,
         weekday = extract(dow from v_date)::integer,
         status = v_status,
         note = case when p_note is null then note else nullif(btrim(p_note), '') end,
         updated_at = v_now
   where id = v_sess.id
   returning * into v_sess;

  perform public.mcp_recalc_route_session_counters(v_sess.id);

  if v_status = 'done' then
    v_snapshot := public.mcp_create_session_report_snapshot(v_sess.id, 'close_session');
  end if;

  return jsonb_build_object(
    'id', v_sess.id,
    'routeId', v_sess.route_id,
    'routeName', v_sess.route_name,
    'sessionDate', v_sess.session_date,
    'status', v_status,
    'note', coalesce(v_sess.note, ''),
    'snapshot', v_snapshot
  );
end;
$function$;

create or replace function public.mcp_set_route_session_status(
  p_route_id text,
  p_session_date date,
  p_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_session_id text;
begin
  if nullif(btrim(coalesce(p_route_id, '')), '') is null then
    raise exception 'route_id_required' using errcode = '23514';
  end if;
  if p_session_date is null then
    raise exception 'session_date_required' using errcode = '23514';
  end if;

  select id into v_session_id
    from public.mcp_route_sessions
   where route_id = p_route_id
     and session_date = p_session_date;
  if not found then
    raise exception 'route_session_not_found' using errcode = '23503';
  end if;

  return public.mcp_update_route_session(v_session_id, p_session_date, p_status, p_note);
end;
$function$;

create or replace function public.mcp_delete_route_customer_hard(p_route_customer_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row public.mcp_route_customers%rowtype;
  v_followups integer := 0;
  v_session_customers integer := 0;
  v_visits integer := 0;
  v_route_customers integer := 0;
begin
  if nullif(btrim(coalesce(p_route_customer_id, '')), '') is null then
    raise exception 'route_customer_id_required' using errcode = '23514';
  end if;

  select * into v_row
    from public.mcp_route_customers
   where id = p_route_customer_id
   for update;
  if not found then
    raise exception 'route_customer_not_found' using errcode = '23503';
  end if;

  perform set_config('mcp.internal_hard_delete', 'on', true);

  delete from public.mcp_followups where route_customer_id = v_row.id;
  get diagnostics v_followups = row_count;
  delete from public.mcp_session_customers where route_customer_id = v_row.id;
  get diagnostics v_session_customers = row_count;
  delete from public.mcp_visits where route_customer_id = v_row.id;
  get diagnostics v_visits = row_count;
  delete from public.mcp_route_customers where id = v_row.id;
  get diagnostics v_route_customers = row_count;

  if v_route_customers <> 1 then
    raise exception 'route_customer_delete_not_applied' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'deleted', true,
    'mode', 'hard_delete',
    'routeCustomerId', v_row.id,
    'routeId', v_row.route_id,
    'customerName', v_row.customer_name,
    'deletedCounts', jsonb_build_object(
      'followups', v_followups,
      'sessionCustomers', v_session_customers,
      'visits', v_visits,
      'routeCustomers', v_route_customers
    )
  );
end;
$function$;

alter function public.mcp_create_followup_from_session_customer(text, text, date, text, text, text, text) security definer;
alter function public.mcp_create_test_from_session_customer(text, text, text, jsonb, text, text) security definer;
alter function public.mcp_create_report_from_session_customer(text, text, text, text, text, text, text, text, text, text, text, text, jsonb, text[], text[], text[]) security definer;

-- Mutation RPCs are callable only by the VPS service role.
do $block$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'mcp_open_route_session',
         'mcp_set_session_customer_status',
         'mcp_create_session_report_snapshot',
         'mcp_update_route_session',
         'mcp_set_route_session_status',
         'mcp_create_order_from_session_customer',
         'mcp_create_test_from_session_customer',
         'mcp_create_report_from_session_customer',
         'mcp_create_followup_from_session_customer',
         'mcp_backfill_session_customers_from_route',
         'mcp_delete_empty_route_session',
         'mcp_create_route',
         'mcp_update_route',
         'mcp_delete_route_hard',
         'mcp_create_route_customer',
         'mcp_update_route_customer',
         'mcp_delete_route_customer_hard'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.signature);
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;
end;
$block$;
