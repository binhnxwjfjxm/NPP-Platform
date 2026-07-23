begin;

-- Route sessions are operational daily runs. A route cannot be operated by two
-- active sessions at once. Lock writes while historical duplicate state is
-- normalized and the invariant is installed.
lock table public.mcp_route_sessions in share row exclusive mode;

do $migration$
declare
  v_duplicate record;
  v_session public.mcp_route_sessions%rowtype;
  v_has_activity boolean;
begin
  for v_duplicate in
    with ranked as (
      select
        id,
        row_number() over (
          partition by route_id
          order by session_date desc, created_at desc, id desc
        ) as active_rank
      from public.mcp_route_sessions
      where lower(coalesce(status, 'active')) = 'active'
    )
    select id
    from ranked
    where active_rank > 1
    order by id
  loop
    perform public.mcp_recalc_route_session_counters(v_duplicate.id);

    select *
      into v_session
      from public.mcp_route_sessions
     where id = v_duplicate.id
     for update;

    if not found or lower(coalesce(v_session.status, 'active')) <> 'active' then
      continue;
    end if;

    v_has_activity :=
      coalesce(v_session.visited_customers, 0) > 0
      or coalesce(v_session.order_count, 0) > 0
      or coalesce(v_session.test_count, 0) > 0
      or coalesce(v_session.report_count, 0) > 0
      or coalesce(v_session.followup_count, 0) > 0
      or exists (
        select 1
          from public.mcp_visits
         where session_id = v_session.id
      )
      or exists (
        select 1
          from public.mcp_session_customers
         where session_id = v_session.id
           and (
             checkin_at is not null
             or visit_status in ('visited', 'skipped', 'cancelled')
             or visit_id is not null
             or order_id is not null
             or test_id is not null
             or report_id is not null
             or coalesce(followup_count, 0) > 0
           )
      );

    if v_has_activity then
      -- Use the canonical close path so counters and the report snapshot stay
      -- consistent. Existing visit/check-in/result/order/report/follow-up rows
      -- are preserved.
      perform public.mcp_update_route_session(
        v_session.id,
        v_session.session_date,
        'done',
        null
      );
    else
      -- An abandoned session with no operational activity is cancelled rather
      -- than represented as a completed field run.
      perform public.mcp_update_route_session(
        v_session.id,
        v_session.session_date,
        'cancelled',
        null
      );
    end if;
  end loop;
end;
$migration$;

create unique index if not exists mcp_route_sessions_one_active_per_route_uidx
  on public.mcp_route_sessions (route_id)
  where lower(coalesce(status, 'active')) = 'active';

comment on index public.mcp_route_sessions_one_active_per_route_uidx is
  'Operational invariant: a route has at most one active session. Historical duplicate actives are normalized before this index is installed.';

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
  v_previous public.mcp_route_sessions%rowtype;
  v_same_date_exists boolean := false;
  v_previous_has_activity boolean := false;
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

  -- Match the Foundation mutation lock order: session first, then route. This
  -- avoids route->session / session->route deadlocks with add-customer flows.
  select *
    into v_session
    from public.mcp_route_sessions
   where route_id = p_route_id
     and session_date = p_session_date
   for update;
  v_same_date_exists := found;

  if not v_same_date_exists then
    select *
      into v_previous
      from public.mcp_route_sessions
     where route_id = p_route_id
       and lower(coalesce(status, 'active')) = 'active'
     order by session_date desc, created_at desc, id desc
     for update
     limit 1;
  end if;

  select *
    into v_route
    from public.mcp_routes
   where id = p_route_id
   for update;

  if not found then
    raise exception 'route_not_found' using errcode = '23503';
  end if;
  if coalesce(v_route.active, true) is false then
    raise exception 'route_inactive' using errcode = '23514';
  end if;

  if v_same_date_exists then
    select count(*)::integer
      into v_snapshot_count
      from public.mcp_session_customers
     where session_id = v_session.id;

    select count(*)::integer
      into v_active_route_customers
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
  else
    -- Opening a newer daily run is an explicit lifecycle boundary. Finalize an
    -- older active run first, preserving all child rows and creating the normal
    -- close-session report snapshot when that run contains activity.
    if v_previous.id is not null and v_previous.session_date < p_session_date then
      perform public.mcp_recalc_route_session_counters(v_previous.id);

      select *
        into v_previous
        from public.mcp_route_sessions
       where id = v_previous.id
       for update;

      v_previous_has_activity :=
        coalesce(v_previous.visited_customers, 0) > 0
        or coalesce(v_previous.order_count, 0) > 0
        or coalesce(v_previous.test_count, 0) > 0
        or coalesce(v_previous.report_count, 0) > 0
        or coalesce(v_previous.followup_count, 0) > 0
        or exists (
          select 1
            from public.mcp_visits
           where session_id = v_previous.id
        )
        or exists (
          select 1
            from public.mcp_session_customers
           where session_id = v_previous.id
             and (
               checkin_at is not null
               or visit_status in ('visited', 'skipped', 'cancelled')
               or visit_id is not null
               or order_id is not null
               or test_id is not null
               or report_id is not null
               or coalesce(followup_count, 0) > 0
             )
        );

      if v_previous_has_activity then
        perform public.mcp_update_route_session(
          v_previous.id,
          v_previous.session_date,
          'done',
          null
        );
      else
        perform public.mcp_update_route_session(
          v_previous.id,
          v_previous.session_date,
          'cancelled',
          null
        );
      end if;
    end if;

    insert into public.mcp_route_sessions (
      id,
      route_id,
      route_name,
      session_date,
      weekday,
      sales,
      area,
      status,
      planned_customers,
      visited_customers,
      order_count,
      test_count,
      report_count,
      followup_count,
      note,
      sync_status,
      raw_payload,
      created_at,
      updated_at
    ) values (
      'mrs_' || replace(gen_random_uuid()::text, '-', ''),
      v_route.id,
      coalesce(nullif(btrim(v_route.route_name), ''), v_route.id),
      p_session_date,
      extract(dow from p_session_date)::integer,
      coalesce(nullif(btrim(coalesce(p_owner, '')), ''), 'Sale'),
      v_route.area,
      'active',
      0,
      0,
      0,
      0,
      0,
      0,
      'Opened by MCP VPS backend',
      'synced',
      jsonb_build_object(
        'source', 'mcp_open_route_session',
        'route_snapshot', to_jsonb(v_route)
      ),
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
      select *
        into v_session
        from public.mcp_route_sessions
       where route_id = p_route_id
         and session_date = p_session_date
       for update;

      if v_session.id is null then
        raise exception 'route_session_create_failed' using errcode = 'P0001';
      end if;

      select count(*)::integer
        into v_snapshot_count
        from public.mcp_session_customers
       where session_id = v_session.id;

      select count(*)::integer
        into v_active_route_customers
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
  end if;

  select *
    into v_session
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

commit;
