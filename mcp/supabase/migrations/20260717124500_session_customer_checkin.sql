alter table public.mcp_session_customers
  add column if not exists checkin_lat double precision,
  add column if not exists checkin_lng double precision,
  add column if not exists checkin_accuracy double precision,
  add column if not exists checkin_at timestamptz,
  add column if not exists checkin_source text;

do $block$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'mcp_session_customers_checkin_pair_check'
       and conrelid = 'public.mcp_session_customers'::regclass
  ) then
    alter table public.mcp_session_customers
      add constraint mcp_session_customers_checkin_pair_check
      check (
        (checkin_lat is null and checkin_lng is null and checkin_at is null)
        or
        (checkin_lat is not null and checkin_lng is not null and checkin_at is not null)
      );
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'mcp_session_customers_checkin_lat_check'
       and conrelid = 'public.mcp_session_customers'::regclass
  ) then
    alter table public.mcp_session_customers
      add constraint mcp_session_customers_checkin_lat_check
      check (checkin_lat is null or checkin_lat between -90 and 90);
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'mcp_session_customers_checkin_lng_check'
       and conrelid = 'public.mcp_session_customers'::regclass
  ) then
    alter table public.mcp_session_customers
      add constraint mcp_session_customers_checkin_lng_check
      check (checkin_lng is null or checkin_lng between -180 and 180);
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'mcp_session_customers_checkin_accuracy_check'
       and conrelid = 'public.mcp_session_customers'::regclass
  ) then
    alter table public.mcp_session_customers
      add constraint mcp_session_customers_checkin_accuracy_check
      check (checkin_accuracy is null or checkin_accuracy >= 0);
  end if;
end;
$block$;

create index if not exists mcp_session_customers_checkin_at_idx
  on public.mcp_session_customers (checkin_at desc)
  where checkin_at is not null;

create or replace function public.mcp_set_session_customer_checkin(
  p_session_customer_id text,
  p_checked_in boolean,
  p_geo_lat double precision default null,
  p_geo_lng double precision default null,
  p_geo_accuracy double precision default null,
  p_geo_source text default null,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_sc public.mcp_session_customers%rowtype;
  v_now timestamptz := now();
  v_source text := nullif(btrim(coalesce(p_geo_source, '')), '');
  v_context jsonb := coalesce(p_context, '{}'::jsonb);
  v_raw_payload jsonb;
begin
  if nullif(btrim(coalesce(p_session_customer_id, '')), '') is null then
    raise exception 'session_customer_id_required' using errcode = '23514';
  end if;
  if p_checked_in is null then
    raise exception 'checked_in_required' using errcode = '23514';
  end if;
  if jsonb_typeof(v_context) <> 'object' then
    raise exception 'invalid_context' using errcode = '23514';
  end if;

  if p_checked_in then
    if p_geo_lat is null or p_geo_lng is null then
      raise exception 'checkin_coordinates_required' using errcode = '23514';
    end if;
    if p_geo_lat < -90 or p_geo_lat > 90 then
      raise exception 'invalid_geo_lat' using errcode = '23514';
    end if;
    if p_geo_lng < -180 or p_geo_lng > 180 then
      raise exception 'invalid_geo_lng' using errcode = '23514';
    end if;
    if p_geo_accuracy is not null and p_geo_accuracy < 0 then
      raise exception 'invalid_geo_accuracy' using errcode = '23514';
    end if;
    v_source := coalesce(v_source, 'browser_manual');
  elsif p_geo_lat is not null or p_geo_lng is not null or p_geo_accuracy is not null then
    raise exception 'checkin_coordinates_not_allowed' using errcode = '23514';
  end if;

  select *
    into v_sc
    from public.mcp_session_customers
   where id = p_session_customer_id
   for update;

  if not found then
    raise exception 'session_customer_not_found' using errcode = 'P0002';
  end if;

  perform public.mcp_assert_session_mutable(v_sc.session_id);

  v_raw_payload := coalesce(v_sc.raw_payload, '{}'::jsonb) - 'sales_checkin';
  if p_checked_in then
    v_raw_payload := v_raw_payload || jsonb_build_object(
      'sales_checkin', jsonb_build_object(
        'lat', p_geo_lat,
        'lng', p_geo_lng,
        'accuracy', p_geo_accuracy,
        'capturedAt', v_now,
        'source', v_source
      )
    );
  end if;
  v_raw_payload := v_raw_payload || jsonb_build_object(
    'sales_checkin_last_action', case when p_checked_in then 'checked_in' else 'removed' end,
    'sales_checkin_context', v_context
  );

  update public.mcp_session_customers
     set checkin_lat = case when p_checked_in then p_geo_lat else null end,
         checkin_lng = case when p_checked_in then p_geo_lng else null end,
         checkin_accuracy = case when p_checked_in then p_geo_accuracy else null end,
         checkin_at = case when p_checked_in then v_now else null end,
         checkin_source = case when p_checked_in then v_source else null end,
         raw_payload = v_raw_payload,
         updated_at = v_now
   where id = v_sc.id
   returning * into v_sc;

  return jsonb_build_object(
    'sessionCustomer', to_jsonb(v_sc),
    'sessionCustomerId', v_sc.id,
    'checkedIn', v_sc.checkin_at is not null,
    'checkinAt', v_sc.checkin_at,
    'geoLat', v_sc.checkin_lat,
    'geoLng', v_sc.checkin_lng,
    'geoAccuracy', v_sc.checkin_accuracy,
    'geoSource', v_sc.checkin_source
  );
end;
$function$;

create or replace function public.mcp_idempotent_set_session_customer_checkin(
  p_session_customer_id text,
  p_checked_in boolean,
  p_geo_lat double precision,
  p_geo_lng double precision,
  p_geo_accuracy double precision,
  p_geo_source text,
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
    'checkedIn', p_checked_in,
    'geoLat', p_geo_lat,
    'geoLng', p_geo_lng,
    'geoAccuracy', p_geo_accuracy,
    'geoSource', p_geo_source
  );
begin
  v_claim := public.mcp_idempotency_begin(
    'session-customer.checkin.set',
    'POST',
    '/api/mcp-day/session-customer/checkin',
    case when p_checked_in then 'checkin' else 'remove_checkin' end,
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

  v_data := public.mcp_set_session_customer_checkin(
    p_session_customer_id => p_session_customer_id,
    p_checked_in => p_checked_in,
    p_geo_lat => p_geo_lat,
    p_geo_lng => p_geo_lng,
    p_geo_accuracy => p_geo_accuracy,
    p_geo_source => p_geo_source,
    p_context => p_context
  );

  return public.mcp_idempotency_complete(
    (v_claim ->> 'recordId')::uuid,
    200,
    v_data,
    p_session_customer_id
  );
end;
$function$;

revoke all on function public.mcp_set_session_customer_checkin(text, boolean, double precision, double precision, double precision, text, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.mcp_idempotent_set_session_customer_checkin(text, boolean, double precision, double precision, double precision, text, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_idempotent_set_session_customer_checkin(text, boolean, double precision, double precision, double precision, text, jsonb) to service_role;
