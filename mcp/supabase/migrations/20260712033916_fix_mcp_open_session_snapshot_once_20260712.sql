-- Freeze the route-customer snapshot strictly at first session creation.
-- Also enforce read-only closed sessions for DELETE operations while keeping
-- controlled hard-delete RPCs functional through a transaction-local flag.

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
  v_snapshot_count integer := 0;
  v_active_route_customers integer := 0;
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

  if v_created then
    v_backfill := public.mcp_backfill_session_customers_from_route(v_session.id, true);
    perform public.mcp_recalc_route_session_counters(v_session.id);
  else
    select * into v_session
      from public.mcp_route_sessions
     where route_id = p_route_id
       and session_date = p_session_date
     for update;

    if v_session.id is null then
      raise exception 'route_session_create_failed' using errcode = 'P0001';
    end if;

    select count(*)::integer into v_snapshot_count
      from public.mcp_session_customers
     where session_id = v_session.id;

    select count(*)::integer into v_active_route_customers
      from public.mcp_route_customers
     where route_id = v_session.route_id
       and coalesce(active, true) is true;

    v_backfill := jsonb_build_object(
      'sessionId', v_session.id,
      'routeId', v_session.route_id,
      'beforeCount', v_snapshot_count,
      'insertedCount', 0,
      'activeRouteCustomers', v_active_route_customers,
      'skipped', 'existing_session_snapshot_frozen'
    );
  end if;

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

drop trigger if exists mcp_session_customers_block_closed_mutation on public.mcp_session_customers;
create trigger mcp_session_customers_block_closed_mutation
before insert or update or delete on public.mcp_session_customers
for each row execute function public.mcp_block_closed_session_child_mutation();

drop trigger if exists mcp_visits_block_closed_mutation on public.mcp_visits;
create trigger mcp_visits_block_closed_mutation
before insert or update or delete on public.mcp_visits
for each row execute function public.mcp_block_closed_session_child_mutation();

drop trigger if exists mcp_followups_block_closed_mutation on public.mcp_followups;
create trigger mcp_followups_block_closed_mutation
before insert or update or delete on public.mcp_followups
for each row execute function public.mcp_block_closed_session_child_mutation();

create or replace function public.mcp_delete_empty_route_session(p_session_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  sess public.mcp_route_sessions%rowtype;
  v_snapshot_count integer := 0;
  v_snapshot_activity_count integer := 0;
  v_visit_count integer := 0;
  v_followup_count integer := 0;
  v_report_count integer := 0;
  v_snapshot_deleted integer := 0;
  v_visit_deleted integer := 0;
  v_session_deleted integer := 0;
begin
  if nullif(trim(p_session_id), '') is null then
    raise exception 'session_id_required' using errcode = '23514';
  end if;

  select *
    into sess
    from public.mcp_route_sessions
   where id = p_session_id
   for update;

  if not found then
    raise exception 'session_not_found' using errcode = '23503';
  end if;

  if lower(coalesce(sess.status, '')) in ('done', 'completed') then
    raise exception 'session_closed_cannot_delete' using errcode = '23514';
  end if;

  select
    count(*),
    count(*) filter (
      where coalesce(visit_status, 'pending') <> 'pending'
         or visit_id is not null
         or order_id is not null
         or test_id is not null
         or report_id is not null
         or coalesce(followup_count, 0) > 0
    )
    into v_snapshot_count, v_snapshot_activity_count
    from public.mcp_session_customers
   where session_id = sess.id;

  select count(*)
    into v_visit_count
    from public.mcp_visits
   where session_id = sess.id;

  select count(*)
    into v_followup_count
    from public.mcp_followups
   where session_id = sess.id;

  select count(*)
    into v_report_count
    from public.mcp_session_reports
   where session_id = sess.id;

  if v_snapshot_activity_count > 0
     or v_visit_count > 0
     or v_followup_count > 0
     or v_report_count > 0
     or coalesce(sess.visited_customers, 0) > 0
     or coalesce(sess.order_count, 0) > 0
     or coalesce(sess.test_count, 0) > 0
     or coalesce(sess.report_count, 0) > 0
     or coalesce(sess.followup_count, 0) > 0
  then
    raise exception 'session_has_activity_cancel_instead'
      using errcode = '23514',
            detail = jsonb_build_object(
              'snapshotActivityCount', v_snapshot_activity_count,
              'visitCount', v_visit_count,
              'followupCount', v_followup_count,
              'reportCount', v_report_count,
              'orderCount', coalesce(sess.order_count, 0),
              'testCount', coalesce(sess.test_count, 0)
            )::text;
  end if;

  perform set_config('mcp.internal_hard_delete', 'on', true);

  delete from public.mcp_visits
   where session_id = sess.id;
  get diagnostics v_visit_deleted = row_count;

  delete from public.mcp_session_customers
   where session_id = sess.id;
  get diagnostics v_snapshot_deleted = row_count;

  delete from public.mcp_route_sessions
   where id = sess.id;
  get diagnostics v_session_deleted = row_count;

  if v_session_deleted <> 1 then
    raise exception 'session_delete_not_applied' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'id', sess.id,
    'deleted', true,
    'snapshotCount', v_snapshot_count,
    'snapshotDeleted', v_snapshot_deleted,
    'visitDeleted', v_visit_deleted
  );
end;
$function$;

revoke all on function public.mcp_open_route_session(text, date, text) from public, anon, authenticated;
grant execute on function public.mcp_open_route_session(text, date, text) to service_role;
revoke all on function public.mcp_delete_empty_route_session(text) from public, anon, authenticated;
grant execute on function public.mcp_delete_empty_route_session(text) to service_role;
