-- A5.2: replace the public mcp-day-8b3 write chain with service-role-only
-- PostgreSQL transactions owned by the backend boundary.

create or replace function public.mcp_record_session_customer_result(
  p_session_customer_id text,
  p_result_type text default null,
  p_note text default null,
  p_order_id text default null,
  p_test_id text default null,
  p_report_id text default null,
  p_has_order boolean default null,
  p_has_test boolean default null,
  p_has_report boolean default null,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_sc public.mcp_session_customers%rowtype;
  v_visit public.mcp_visits%rowtype;
  v_session public.mcp_route_sessions%rowtype;
  v_result_type text := lower(nullif(btrim(coalesce(p_result_type, '')), ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_order_id text;
  v_test_id text;
  v_report_id text;
  v_has_order boolean;
  v_has_test boolean;
  v_has_report boolean;
  v_created_visit boolean := false;
  v_snapshot_count integer := 0;
  v_now timestamptz := now();
begin
  if nullif(btrim(coalesce(p_session_customer_id, '')), '') is null then
    raise exception 'session_customer_id_required' using errcode = '23514';
  end if;

  if v_result_type is not null and v_result_type not in ('order', 'test', 'report') then
    raise exception 'invalid_result_type' using errcode = '23514';
  end if;

  if v_result_type is null
     and v_note is null
     and nullif(btrim(coalesce(p_order_id, '')), '') is null
     and nullif(btrim(coalesce(p_test_id, '')), '') is null
     and nullif(btrim(coalesce(p_report_id, '')), '') is null
     and p_has_order is null
     and p_has_test is null
     and p_has_report is null then
    raise exception 'result_required' using errcode = '23514';
  end if;

  select * into v_sc
    from public.mcp_session_customers
   where id = p_session_customer_id
   for update;

  if not found then
    raise exception 'session_customer_not_found' using errcode = '23503';
  end if;

  select * into v_session
    from public.mcp_route_sessions
   where id = v_sc.session_id
   for share;

  if not found then
    raise exception 'session_not_found' using errcode = '23503';
  end if;

  perform public.mcp_assert_session_mutable(v_session.id);

  if v_sc.visit_id is not null then
    select * into v_visit
      from public.mcp_visits
     where id = v_sc.visit_id
     for update;
  end if;

  if v_visit.id is null then
    insert into public.mcp_visits (
      id,
      session_id,
      route_id,
      route_customer_id,
      visit_date,
      status,
      has_order,
      has_test,
      has_report,
      checkin_at,
      note,
      raw_payload,
      created_at,
      updated_at
    ) values (
      'mcv_' || replace(gen_random_uuid()::text, '-', ''),
      v_sc.session_id,
      v_sc.route_id,
      v_sc.route_customer_id,
      v_session.session_date,
      'visited',
      false,
      false,
      false,
      v_now,
      coalesce(v_note, v_sc.note, 'Đã ghi kết quả'),
      jsonb_build_object(
        'source', 'mcp_record_session_customer_result',
        'session_customer_id', v_sc.id,
        'foundation_context', coalesce(p_context, '{}'::jsonb)
      ),
      v_now,
      v_now
    )
    returning * into v_visit;

    v_created_visit := true;
  end if;

  v_order_id := coalesce(
    nullif(btrim(coalesce(p_order_id, '')), ''),
    v_sc.order_id,
    v_visit.order_id
  );
  v_test_id := coalesce(
    nullif(btrim(coalesce(p_test_id, '')), ''),
    v_sc.test_id,
    v_visit.test_id
  );
  v_report_id := coalesce(
    nullif(btrim(coalesce(p_report_id, '')), ''),
    v_sc.report_id,
    v_visit.report_id
  );

  -- Result flags are monotonic. An explicit false cannot erase activity that
  -- already exists or contradict a linked business record.
  v_has_order := coalesce(v_visit.has_order, false)
                 or v_order_id is not null
                 or v_result_type = 'order'
                 or coalesce(p_has_order, false);
  v_has_test := coalesce(v_visit.has_test, false)
                or v_test_id is not null
                or v_result_type = 'test'
                or coalesce(p_has_test, false);
  v_has_report := coalesce(v_visit.has_report, false)
                  or v_report_id is not null
                  or v_result_type = 'report'
                  or coalesce(p_has_report, false);

  update public.mcp_visits
     set visit_date = v_session.session_date,
         status = 'visited',
         has_order = v_has_order,
         has_test = v_has_test,
         has_report = v_has_report,
         order_id = v_order_id,
         test_id = v_test_id,
         report_id = v_report_id,
         checkin_at = coalesce(checkin_at, v_now),
         note = coalesce(v_note, note, v_sc.note, 'Đã ghi kết quả'),
         raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object(
           'last_result_source', 'mcp_record_session_customer_result',
           'last_result_context', coalesce(p_context, '{}'::jsonb)
         ),
         updated_at = v_now
   where id = v_visit.id
   returning * into v_visit;

  update public.mcp_session_customers
     set visit_status = 'visited',
         status_reason = null,
         visit_id = v_visit.id,
         order_id = v_order_id,
         test_id = v_test_id,
         report_id = v_report_id,
         note = coalesce(v_note, note),
         raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object(
           'last_result_source', 'mcp_record_session_customer_result',
           'last_result_context', coalesce(p_context, '{}'::jsonb)
         ),
         updated_at = v_now
   where id = v_sc.id
   returning * into v_sc;

  perform public.mcp_recalc_route_session_counters(v_sc.session_id);

  select * into v_session
    from public.mcp_route_sessions
   where id = v_sc.session_id;

  select count(*)::integer into v_snapshot_count
    from public.mcp_session_customers
   where session_id = v_sc.session_id;

  return jsonb_build_object(
    'sessionCustomer', to_jsonb(v_sc),
    'visit', to_jsonb(v_visit),
    'createdVisit', v_created_visit,
    'counters', jsonb_build_object(
      'session', to_jsonb(v_session),
      'snapshotCount', v_snapshot_count,
      'visitedCount', coalesce(v_session.visited_customers, 0),
      'orderCount', coalesce(v_session.order_count, 0),
      'testCount', coalesce(v_session.test_count, 0),
      'reportCount', coalesce(v_session.report_count, 0),
      'followupCount', coalesce(v_session.followup_count, 0)
    )
  );
end;
$function$;

create or replace function public.mcp_add_session_customer(
  p_session_id text,
  p_customer_name text,
  p_route_customer_id text default null,
  p_customer_id text default null,
  p_phone text default null,
  p_area text default null,
  p_address text default null,
  p_note text default null,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_session public.mcp_route_sessions%rowtype;
  v_route_customer public.mcp_route_customers%rowtype;
  v_sc public.mcp_session_customers%rowtype;
  v_existing public.mcp_session_customers%rowtype;
  v_route_customer_id text := nullif(btrim(coalesce(p_route_customer_id, '')), '');
  v_customer_name text := nullif(btrim(coalesce(p_customer_name, '')), '');
  v_sort_order integer := 1;
  v_snapshot_count integer := 0;
  v_now timestamptz := now();
begin
  if nullif(btrim(coalesce(p_session_id, '')), '') is null then
    raise exception 'session_id_required' using errcode = '23514';
  end if;

  if v_customer_name is null then
    raise exception 'customer_name_required' using errcode = '23514';
  end if;

  -- The session row is the serialization lock for add operations in one
  -- session. It protects max(sort_order) and the duplicate check below.
  select * into v_session
    from public.mcp_route_sessions
   where id = p_session_id
   for update;

  if not found then
    raise exception 'session_not_found' using errcode = '23503';
  end if;

  perform public.mcp_assert_session_mutable(v_session.id);

  if v_route_customer_id is not null then
    select * into v_route_customer
      from public.mcp_route_customers
     where id = v_route_customer_id
     for share;

    if not found then
      raise exception 'route_customer_not_found' using errcode = '23503';
    end if;

    if v_route_customer.route_id is distinct from v_session.route_id then
      raise exception 'route_customer_route_mismatch' using errcode = '23514';
    end if;

    -- Do not lock the existing snapshot here. result/status mutations lock the
    -- snapshot before the session row; taking the reverse pair would deadlock.
    -- The session lock plus the unique partial index serializes add retries.
    select * into v_existing
      from public.mcp_session_customers
     where session_id = v_session.id
       and route_customer_id = v_route_customer_id;

    if v_existing.id is not null then
      perform public.mcp_recalc_route_session_counters(v_session.id);
      select * into v_session from public.mcp_route_sessions where id = v_session.id;
      select count(*)::integer into v_snapshot_count
        from public.mcp_session_customers
       where session_id = v_session.id;

      return jsonb_build_object(
        'sessionCustomer', to_jsonb(v_existing),
        'created', false,
        'counters', jsonb_build_object(
          'session', to_jsonb(v_session),
          'snapshotCount', v_snapshot_count,
          'visitedCount', coalesce(v_session.visited_customers, 0),
          'orderCount', coalesce(v_session.order_count, 0),
          'testCount', coalesce(v_session.test_count, 0),
          'reportCount', coalesce(v_session.report_count, 0),
          'followupCount', coalesce(v_session.followup_count, 0)
        )
      );
    end if;
  end if;

  select coalesce(max(sort_order), 0) + 1
    into v_sort_order
    from public.mcp_session_customers
   where session_id = v_session.id;

  insert into public.mcp_session_customers (
    id,
    session_id,
    route_id,
    route_customer_id,
    customer_id,
    customer_name,
    phone,
    area,
    address,
    sort_order,
    source,
    planned_status,
    visit_status,
    note,
    raw_payload,
    created_at,
    updated_at
  ) values (
    'msc_' || replace(gen_random_uuid()::text, '-', ''),
    v_session.id,
    v_session.route_id,
    v_route_customer_id,
    coalesce(
      nullif(btrim(coalesce(p_customer_id, '')), ''),
      v_route_customer.customer_id
    ),
    v_customer_name,
    coalesce(nullif(btrim(coalesce(p_phone, '')), ''), v_route_customer.phone),
    coalesce(nullif(btrim(coalesce(p_area, '')), ''), v_route_customer.area, v_session.area),
    coalesce(nullif(btrim(coalesce(p_address, '')), ''), v_route_customer.address),
    v_sort_order,
    'added',
    'added',
    'pending',
    coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Khách phát sinh trong phiên'),
    jsonb_build_object(
      'source', 'mcp_add_session_customer',
      'session_id', v_session.id,
      'route_customer_id', v_route_customer_id,
      'foundation_context', coalesce(p_context, '{}'::jsonb)
    ),
    v_now,
    v_now
  )
  returning * into v_sc;

  perform public.mcp_recalc_route_session_counters(v_session.id);

  select * into v_session
    from public.mcp_route_sessions
   where id = v_session.id;

  select count(*)::integer into v_snapshot_count
    from public.mcp_session_customers
   where session_id = v_session.id;

  return jsonb_build_object(
    'sessionCustomer', to_jsonb(v_sc),
    'created', true,
    'counters', jsonb_build_object(
      'session', to_jsonb(v_session),
      'snapshotCount', v_snapshot_count,
      'visitedCount', coalesce(v_session.visited_customers, 0),
      'orderCount', coalesce(v_session.order_count, 0),
      'testCount', coalesce(v_session.test_count, 0),
      'reportCount', coalesce(v_session.report_count, 0),
      'followupCount', coalesce(v_session.followup_count, 0)
    )
  );
end;
$function$;

revoke all on function public.mcp_record_session_customer_result(
  text, text, text, text, text, text, boolean, boolean, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.mcp_record_session_customer_result(
  text, text, text, text, text, text, boolean, boolean, boolean, jsonb
) to service_role;

revoke all on function public.mcp_add_session_customer(
  text, text, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.mcp_add_session_customer(
  text, text, text, text, text, text, text, text, jsonb
) to service_role;

comment on function public.mcp_record_session_customer_result(
  text, text, text, text, text, text, boolean, boolean, boolean, jsonb
) is 'A5.2 atomic session customer result mutation; backend service role only.';

comment on function public.mcp_add_session_customer(
  text, text, text, text, text, text, text, text, jsonb
) is 'A5.2 atomic explicit-session customer add mutation; backend service role only.';
