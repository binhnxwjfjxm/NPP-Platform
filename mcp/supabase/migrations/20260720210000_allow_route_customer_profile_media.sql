alter table public.mcp_outlet_media
  alter column session_id drop not null;

create or replace function public.mcp_prepare_outlet_media_upload(
  p_installation_id text,
  p_route_customer_id text,
  p_session_id text,
  p_client_upload_id text,
  p_mime_type text,
  p_expected_byte_size bigint,
  p_geo_lat double precision default null,
  p_geo_lng double precision default null,
  p_geo_accuracy double precision default null,
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
  v_media public.mcp_outlet_media%rowtype;
  v_active_media_count integer;
  v_media_id text;
  v_extension text;
  v_object_key text;
begin
  if nullif(btrim(coalesce(p_installation_id, '')), '') is null then
    raise exception 'installation_id_required' using errcode = '23514';
  end if;
  if nullif(btrim(coalesce(p_route_customer_id, '')), '') is null then
    raise exception 'route_customer_id_required' using errcode = '23514';
  end if;
  if nullif(btrim(coalesce(p_client_upload_id, '')), '') is null then
    raise exception 'client_upload_id_required' using errcode = '23514';
  end if;
  if p_mime_type not in ('image/jpeg', 'image/webp', 'image/png') then
    raise exception 'invalid_media_mime_type' using errcode = '23514';
  end if;
  if p_expected_byte_size is null or p_expected_byte_size < 1 or p_expected_byte_size > 5242880 then
    raise exception 'invalid_media_byte_size' using errcode = '23514';
  end if;
  if (p_geo_lat is null) <> (p_geo_lng is null) then
    raise exception 'geo_coordinates_incomplete' using errcode = '23514';
  end if;

  if nullif(btrim(coalesce(p_session_id, '')), '') is not null then
    select * into v_session
      from public.mcp_route_sessions
     where id = p_session_id
     for update;
    if not found then raise exception 'session_not_found' using errcode = '23503'; end if;
    perform public.mcp_assert_session_mutable(v_session.id);
  end if;

  select * into v_route_customer
    from public.mcp_route_customers
   where id = p_route_customer_id
   for update;
  if not found then raise exception 'route_customer_not_found' using errcode = '23503'; end if;

  if nullif(btrim(coalesce(p_session_id, '')), '') is not null
     and v_route_customer.route_id is distinct from v_session.route_id then
    raise exception 'route_customer_route_mismatch' using errcode = '23514';
  end if;

  select * into v_media
    from public.mcp_outlet_media
   where installation_id = p_installation_id
     and client_upload_id = p_client_upload_id
   for update;

  if found then
    if v_media.route_customer_id is distinct from p_route_customer_id
       or v_media.session_id is distinct from nullif(btrim(coalesce(p_session_id, '')), '')
       or v_media.mime_type is distinct from p_mime_type
       or v_media.expected_byte_size is distinct from p_expected_byte_size then
      raise exception 'outlet_media_upload_conflict' using errcode = '23505';
    end if;
    return to_jsonb(v_media);
  end if;

  select count(*) into v_active_media_count
    from public.mcp_outlet_media
   where installation_id = p_installation_id
     and route_customer_id = p_route_customer_id
     and status in ('pending', 'ready', 'deleting', 'delete_failed');

  if v_active_media_count >= 3 then
    raise exception 'outlet_media_limit_reached' using errcode = '23514';
  end if;

  v_media_id := 'mom_' || replace(gen_random_uuid()::text, '-', '');
  v_extension := case p_mime_type when 'image/webp' then 'webp' when 'image/png' then 'png' else 'jpg' end;
  v_object_key := format(
    'mcp-plan/outlets/%s/%s/%s.%s',
    regexp_replace(p_installation_id, '[^a-zA-Z0-9._-]+', '_', 'g'),
    regexp_replace(p_route_customer_id, '[^a-zA-Z0-9._-]+', '_', 'g'),
    v_media_id,
    v_extension
  );

  insert into public.mcp_outlet_media (
    id, installation_id, route_customer_id, session_id, object_key,
    mime_type, expected_byte_size, client_upload_id, captured_by,
    geo_lat, geo_lng, geo_accuracy, raw_payload
  ) values (
    v_media_id, p_installation_id, p_route_customer_id,
    nullif(btrim(coalesce(p_session_id, '')), ''), v_object_key,
    p_mime_type, p_expected_byte_size, p_client_upload_id,
    nullif(btrim(coalesce(p_context ->> 'actorId', '')), ''),
    p_geo_lat, p_geo_lng, p_geo_accuracy,
    jsonb_build_object('foundation_context', coalesce(p_context, '{}'::jsonb))
  ) returning * into v_media;

  return to_jsonb(v_media);
end;
$function$;

revoke all on function public.mcp_prepare_outlet_media_upload(text, text, text, text, text, bigint, double precision, double precision, double precision, jsonb)
  from public, anon, authenticated;
grant execute on function public.mcp_prepare_outlet_media_upload(text, text, text, text, text, bigint, double precision, double precision, double precision, jsonb)
  to service_role;