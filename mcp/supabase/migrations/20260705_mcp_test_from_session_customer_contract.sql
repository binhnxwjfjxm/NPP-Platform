-- MCP-6 Test contract: create test results from a MCP session customer.
-- Inputs:
-- - p_session_customer_id: selected mcp_session_customers.id.
-- - p_file_id: existing test_files.id, optional.
-- - p_file_title: quick-created test file title when p_file_id is empty.
-- - p_results: JSON array with productId/product_id or productName/product_name, status, note.
-- - p_note: shared test/visit note.
-- - p_status: default result/customer status.
--
-- Output:
-- - uses or creates test_files.
-- - uses or creates test_file_products.
-- - creates or updates test_customers.
-- - inserts test_customer_results.
-- - creates or updates mcp_visits.
-- - links test_id into mcp_visits and mcp_session_customers.
-- - recalculates MCP session counters.

create or replace function public.mcp_create_test_from_session_customer(
  p_session_customer_id text,
  p_file_id text default null,
  p_file_title text default null,
  p_results jsonb default '[]'::jsonb,
  p_note text default null,
  p_status text default 'tested'
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  sc record;
  sess record;
  v_file_id text;
  v_file_title text;
  v_test_customer_id text;
  v_visit_id text;
  v_test_id text;
  item jsonb;
  v_product_id text;
  v_product_name text;
  v_result_status text;
  v_result_note text;
  result_count integer := 0;
  now_ts timestamptz := now();
begin
  if p_session_customer_id is null or length(trim(p_session_customer_id)) = 0 then
    raise exception 'session_customer_id_required' using errcode = '23514';
  end if;

  if p_results is null or jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) = 0 then
    raise exception 'test_results_required' using errcode = '23514';
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

  v_file_id := nullif(trim(coalesce(p_file_id, '')), '');

  if v_file_id is not null then
    select id, title into v_file_id, v_file_title
      from public.test_files
     where id = v_file_id
       and deleted_at is null;

    if v_file_id is null then
      raise exception 'test_file_not_found' using errcode = '23503';
    end if;
  else
    v_file_id := 'test_file_' || replace(gen_random_uuid()::text, '-', '');
    v_file_title := coalesce(nullif(trim(coalesce(p_file_title, '')), ''), 'MCP Test - ' || sc.customer_name || ' - ' || sess.session_date::text);

    insert into public.test_files (
      id, title, test_date, sales, note, status, sync_status, raw_payload, created_at, updated_at
    ) values (
      v_file_id, v_file_title, sess.session_date, sess.sales, p_note, 'active', 'synced',
      jsonb_build_object('source', 'mcp_create_test_from_session_customer', 'session_id', sc.session_id, 'session_customer_id', sc.id, 'route_id', sc.route_id),
      now_ts, now_ts
    );
  end if;

  select id into v_test_customer_id
    from public.test_customers
   where file_id = v_file_id
     and deleted_at is null
     and raw_payload ->> 'session_customer_id' = sc.id
   order by created_at asc
   limit 1;

  if v_test_customer_id is null then
    v_test_customer_id := 'test_customer_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.test_customers (
      id, file_id, customer_name, phone, area, status, note, sync_status, raw_payload, created_at, updated_at
    ) values (
      v_test_customer_id, v_file_id, sc.customer_name, sc.phone, sc.area, coalesce(nullif(trim(coalesce(p_status, '')), ''), 'tested'), p_note, 'synced',
      jsonb_build_object('source', 'mcp_create_test_from_session_customer', 'session_id', sc.session_id, 'session_customer_id', sc.id, 'route_customer_id', sc.route_customer_id, 'customer_id', sc.customer_id),
      now_ts, now_ts
    );
  else
    update public.test_customers
       set status = coalesce(nullif(trim(coalesce(p_status, '')), ''), status, 'tested'),
           note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note),
           updated_at = now_ts
     where id = v_test_customer_id;
  end if;

  for item in select value from jsonb_array_elements(p_results) loop
    v_product_id := nullif(trim(coalesce(item ->> 'productId', item ->> 'product_id', '')), '');
    v_product_name := nullif(trim(coalesce(item ->> 'productName', item ->> 'product_name', '')), '');

    if v_product_id is not null then
      select product_name into v_product_name
        from public.test_file_products
       where id = v_product_id
         and file_id = v_file_id
         and deleted_at is null;

      if v_product_name is null then
        raise exception 'test_product_not_found' using errcode = '23503';
      end if;
    else
      if v_product_name is null then
        raise exception 'product_name_required' using errcode = '23514';
      end if;

      select id into v_product_id
        from public.test_file_products
       where file_id = v_file_id
         and deleted_at is null
         and lower(product_name) = lower(v_product_name)
       order by sort_order asc, created_at asc
       limit 1;

      if v_product_id is null then
        v_product_id := 'test_product_' || replace(gen_random_uuid()::text, '-', '');
        insert into public.test_file_products (
          id, file_id, product_name, sort_order, status, sync_status, raw_payload, created_at, updated_at
        ) values (
          v_product_id, v_file_id, v_product_name, result_count + 1, 'active', 'synced',
          jsonb_build_object('source', 'mcp_create_test_from_session_customer', 'session_customer_id', sc.id),
          now_ts, now_ts
        );
      end if;
    end if;

    v_result_status := coalesce(nullif(trim(coalesce(item ->> 'status', '')), ''), coalesce(nullif(trim(coalesce(p_status, '')), ''), 'tested'));
    v_result_note := nullif(trim(coalesce(item ->> 'note', '')), '');

    insert into public.test_customer_results (
      id, file_id, customer_id, product_id, product_name, status, note, sync_status, raw_payload, created_at, updated_at
    ) values (
      'test_result_' || replace(gen_random_uuid()::text, '-', ''),
      v_file_id, v_test_customer_id, v_product_id, v_product_name, v_result_status, v_result_note,
      'synced', item || jsonb_build_object('source', 'mcp_create_test_from_session_customer', 'session_customer_id', sc.id), now_ts, now_ts
    ) returning id into v_test_id;

    result_count := result_count + 1;
  end loop;

  if result_count = 0 or v_test_id is null then
    raise exception 'test_results_required' using errcode = '23514';
  end if;

  if sc.visit_id is not null then
    update public.mcp_visits
       set has_test = true,
           test_id = v_test_id,
           status = 'visited',
           note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note, 'Tạo test từ MCP'),
           updated_at = now_ts
     where id = sc.visit_id
     returning id into v_visit_id;
  end if;

  if v_visit_id is null then
    insert into public.mcp_visits (
      id, session_id, route_id, route_customer_id, visit_date, status, has_order, has_test, has_report,
      test_id, checkin_at, note, raw_payload, created_at, updated_at
    ) values (
      'mcv_' || replace(gen_random_uuid()::text, '-', ''),
      sc.session_id, sc.route_id, sc.route_customer_id, sess.session_date, 'visited', false, true, false,
      v_test_id, now_ts, coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Tạo test từ MCP'),
      jsonb_build_object('source', 'mcp_create_test_from_session_customer', 'session_customer_id', sc.id, 'test_id', v_test_id, 'file_id', v_file_id), now_ts, now_ts
    ) returning id into v_visit_id;
  end if;

  update public.mcp_session_customers
     set visit_status = 'visited',
         status_reason = null,
         visit_id = v_visit_id,
         test_id = v_test_id,
         note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note),
         updated_at = now_ts
   where id = sc.id;

  perform public.mcp_recalc_route_session_counters(sc.session_id);

  return jsonb_build_object(
    'fileId', v_file_id,
    'fileTitle', v_file_title,
    'testCustomerId', v_test_customer_id,
    'testId', v_test_id,
    'resultCount', result_count,
    'sessionCustomerId', sc.id,
    'visitId', v_visit_id
  );
end;
$$;
